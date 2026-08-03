import { randomUUID } from 'node:crypto';

import type { CardId } from '@daifugo/core';

import type { RoomCloseReason } from './protocol.js';
import type { RoomState, RoomTransition } from './types.js';

export interface RoomTimerAuthority {
  get(roomId: string): RoomState | undefined;
  apply(
    roomId: string,
    action:
      | { type: 'advanceIntermission'; now: number }
      | { type: 'expireSetResult'; now: number; setSeed: string }
      | {
          type: 'autoAct';
          memberId: string;
          turnSeq: number;
          cards: CardId[] | null;
          reason: 'ai' | 'turnTimeout';
          now: number;
        }
      | {
          type: 'expireWaitingMember';
          memberId: string;
          now: number;
          expectedAt: number;
          setSeed: string;
        }
      | {
          type: 'expireRoom';
          reason: 'lobbyExpired' | 'abandoned';
          now: number;
          expectedAt: number;
        }
      | { type: 'miniGameTick'; miniGameId: string; now: number },
  ): RoomTransition | undefined;
}

export interface RoomTimerOptions {
  now?: () => number;
  createSetSeed?: () => string;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  decideTurn?: (state: RoomState, memberId: string) => Promise<CardId[] | null>;
  random?: () => number;
  aiDelayMinMs?: number;
  aiDelayMaxMs?: number;
  basicAiDelayMinMs?: number;
  basicAiDelayMaxMs?: number;
  onTransition?: (
    previous: RoomState,
    transition: RoomTransition,
    closeReason?: RoomCloseReason,
  ) => void;
  onError?: (error: unknown) => void;
}

interface LifecycleTimerSpecification {
  fingerprint: string;
  dueAt: number;
  action:
    | {
        type: 'expireWaitingMember';
        memberId: string;
        expectedAt: number;
      }
    | {
        type: 'expireRoom';
        reason: 'lobbyExpired' | 'abandoned';
        expectedAt: number;
      };
}

interface ScheduledRoomTimer {
  fingerprint: string;
  kind: 'intermission' | 'setResult' | 'turn' | 'miniGame' | 'lifecycle';
  handle: unknown;
}

export class RoomTimerCoordinator {
  readonly #authority: RoomTimerAuthority;
  readonly #now: () => number;
  readonly #createSetSeed: () => string;
  readonly #setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;
  readonly #decideTurn: RoomTimerOptions['decideTurn'];
  readonly #random: () => number;
  readonly #aiDelayMinMs: number;
  readonly #aiDelayMaxMs: number;
  readonly #basicAiDelayMinMs: number;
  readonly #basicAiDelayMaxMs: number;
  readonly #onTransition: NonNullable<RoomTimerOptions['onTransition']>;
  readonly #onError: NonNullable<RoomTimerOptions['onError']>;
  readonly #scheduled = new Map<string, ScheduledRoomTimer>();
  readonly #inFlight = new Set<string>();
  #closed = false;

  constructor(authority: RoomTimerAuthority, options: RoomTimerOptions = {}) {
    this.#authority = authority;
    this.#now = options.now ?? Date.now;
    this.#createSetSeed = options.createSetSeed ?? randomUUID;
    this.#setTimer =
      options.setTimer ??
      ((callback, delayMs) => setTimeout(callback, delayMs));
    this.#clearTimer =
      options.clearTimer ??
      ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.#decideTurn = options.decideTurn;
    this.#random = options.random ?? Math.random;
    this.#aiDelayMinMs = options.aiDelayMinMs ?? 800;
    this.#aiDelayMaxMs = options.aiDelayMaxMs ?? 2_500;
    this.#basicAiDelayMinMs = options.basicAiDelayMinMs ?? 3_000;
    this.#basicAiDelayMaxMs = options.basicAiDelayMaxMs ?? 4_500;
    if (
      !Number.isFinite(this.#aiDelayMinMs) ||
      !Number.isFinite(this.#aiDelayMaxMs) ||
      this.#aiDelayMinMs < 0 ||
      this.#aiDelayMaxMs < this.#aiDelayMinMs ||
      !Number.isFinite(this.#basicAiDelayMinMs) ||
      !Number.isFinite(this.#basicAiDelayMaxMs) ||
      this.#basicAiDelayMinMs < 0 ||
      this.#basicAiDelayMaxMs < this.#basicAiDelayMinMs
    ) {
      throw new Error('Invalid AI room delay range');
    }
    this.#onTransition = options.onTransition ?? (() => {});
    this.#onError = options.onError ?? (() => {});
  }

  get size(): number {
    return this.#scheduled.size;
  }

  sync(state: RoomState): void {
    if (this.#closed) return;
    const specification = this.#specification(state);
    const existing = this.#scheduled.get(state.roomId);
    if (!specification) {
      this.clearRoom(state.roomId);
      return;
    }
    if (existing?.fingerprint === specification.fingerprint) {
      return;
    }
    if (this.#inFlight.has(specification.fingerprint)) return;
    if (existing) {
      this.#clearTimer(existing.handle);
    }
    const handle = this.#setTimer(
      () => this.#fire(state.roomId, specification.fingerprint),
      specification.delayMs,
    );
    this.#scheduled.set(state.roomId, {
      fingerprint: specification.fingerprint,
      kind: specification.kind,
      handle,
    });
  }

  clearRoom(roomId: string): void {
    const existing = this.#scheduled.get(roomId);
    if (!existing) return;
    this.#clearTimer(existing.handle);
    this.#scheduled.delete(roomId);
  }

  close(): void {
    this.#closed = true;
    for (const roomId of [...this.#scheduled.keys()]) {
      this.clearRoom(roomId);
    }
  }

  #specification(state: RoomState):
    | {
        fingerprint: string;
        delayMs: number;
        kind: ScheduledRoomTimer['kind'];
      }
    | undefined {
    const miniGame =
      state.phase === 'playing' && state.engine?.phase.name === 'gameInProgress'
        ? state.engine.currentGame?.private.pendingChoice?.miniGameState
        : undefined;
    if (miniGame) {
      return {
        fingerprint: `${state.engine!.setId}:miniGame:${miniGame.id}:${miniGame.elapsedMs}`,
        delayMs: 200,
        kind: 'miniGame',
      };
    }
    if (
      state.phase === 'playing' &&
      state.engine?.phase.name === 'interimResult'
    ) {
      return {
        fingerprint: `${state.engine.setId}:interim:${state.engine.phase.gameIndex}:${String(state.intermissionEndsAt)}`,
        delayMs: Math.max(
          0,
          (state.intermissionEndsAt ??
            this.#now() + state.engine.config.interimAutoAdvanceMs) -
            this.#now(),
        ),
        kind: 'intermission',
      };
    }
    if (state.phase === 'setResult' && state.setRespondBy !== null) {
      return {
        fingerprint: `${state.engine?.setId ?? state.roomId}:setResult:${state.setRespondBy}`,
        delayMs: Math.max(0, state.setRespondBy - this.#now()),
        kind: 'setResult',
      };
    }
    const turnMemberId =
      state.engine?.currentGame?.public.phase === 'awaitingChoice'
        ? state.engine.currentGame.private.pendingChoice?.player
        : state.engine?.currentGame?.public.turn;
    if (
      this.#decideTurn &&
      state.phase === 'playing' &&
      state.engine?.phase.name === 'gameInProgress' &&
      (state.engine.currentGame?.public.phase === 'awaitingPlay' ||
        state.engine.currentGame?.public.phase === 'awaitingChoice') &&
      turnMemberId
    ) {
      const memberId = turnMemberId;
      const member = state.members.find(
        (candidate) => candidate.memberId === memberId,
      );
      if (!member) return undefined;
      const automated = member.isAI || member.departed;
      if (!automated && state.turnDeadlineAt === null) return undefined;
      return {
        fingerprint: [
          state.engine.setId,
          'turn',
          state.turnSeq,
          memberId,
          member.connected ? 'connected' : 'disconnected',
          member.controller,
          member.departed ? 'departed' : 'present',
          state.turnDeadlineAt ?? 'ai-delay',
        ].join(':'),
        delayMs: automated
          ? this.#aiDelay(state)
          : Math.max(0, state.turnDeadlineAt! - this.#now()),
        kind: 'turn',
      };
    }
    return undefined;
  }

  #fire(roomId: string, fingerprint: string): void {
    const scheduled = this.#scheduled.get(roomId);
    if (scheduled?.fingerprint !== fingerprint) return;
    this.#scheduled.delete(roomId);
    if (scheduled.kind === 'turn') {
      this.#inFlight.add(fingerprint);
      void this.#fireTurn(roomId, fingerprint).finally(() => {
        this.#inFlight.delete(fingerprint);
        const latest = this.#authority.get(roomId);
        if (latest) this.sync(latest);
      });
      return;
    }
    try {
      const previous = this.#authority.get(roomId);
      if (!previous) return;
      const current = this.#specification(previous);
      if (current?.fingerprint !== fingerprint) {
        this.sync(previous);
        return;
      }
      const transition =
        scheduled.kind === 'miniGame'
          ? this.#authority.apply(roomId, {
              type: 'miniGameTick',
              miniGameId:
                previous.engine?.currentGame?.private.pendingChoice
                  ?.miniGameState?.id ?? '',
              now: this.#now(),
            })
          : previous.phase === 'setResult'
            ? this.#authority.apply(roomId, {
                type: 'expireSetResult',
                now: this.#now(),
                setSeed: this.#createSetSeed(),
              })
            : this.#authority.apply(roomId, {
                type: 'advanceIntermission',
                now: this.#now(),
              });
      if (!transition?.accepted) {
        const latest = this.#authority.get(roomId);
        if (latest) this.sync(latest);
        return;
      }
      this.#onTransition(
        previous,
        transition,
        previous.phase === 'setResult' ? 'setEndedNoContinue' : undefined,
      );
      this.sync(transition.state);
    } catch (error) {
      this.#onError(error);
      const latest = this.#authority.get(roomId);
      if (latest) this.sync(latest);
    }
  }

  async #fireTurn(roomId: string, fingerprint: string): Promise<void> {
    try {
      const previous = this.#authority.get(roomId);
      if (!previous || this.#closed || !this.#decideTurn) return;
      const specification = this.#specification(previous);
      if (specification?.fingerprint !== fingerprint) return;
      const game = previous.engine?.currentGame;
      const memberId =
        game?.public.phase === 'awaitingChoice'
          ? game.private.pendingChoice?.player
          : game?.public.turn;
      if (!memberId) return;
      const cards = await this.#decideTurn(previous, memberId);
      const latest = this.#authority.get(roomId);
      if (!latest || this.#closed) return;
      if (this.#specification(latest)?.fingerprint !== fingerprint) return;
      const member = latest.members.find(
        (candidate) => candidate.memberId === memberId,
      );
      if (!member) return;
      const transition = this.#authority.apply(roomId, {
        type: 'autoAct',
        memberId,
        turnSeq: latest.turnSeq,
        cards,
        reason:
          member.isAI || member.departed || !member.connected
            ? 'ai'
            : 'turnTimeout',
        now: this.#now(),
      });
      if (!transition?.accepted) return;
      this.#onTransition(previous, transition);
    } catch (error) {
      this.#onError(error);
    }
  }

  #aiDelay(state: RoomState): number {
    let sample = 0.5;
    try {
      const value = this.#random();
      if (Number.isFinite(value)) {
        sample = Math.max(0, Math.min(1, value));
      }
    } catch {
      // Stable midpoint fallback keeps the room progressing.
    }
    const isBasicSolo =
      state.mode === 'basic' &&
      state.members.filter((member) => !member.isAI && !member.departed)
        .length === 1;
    const minMs = isBasicSolo ? this.#basicAiDelayMinMs : this.#aiDelayMinMs;
    const maxMs = isBasicSolo ? this.#basicAiDelayMaxMs : this.#aiDelayMaxMs;
    return Math.round(minMs + (maxMs - minMs) * sample);
  }
}

export class RoomLifecycleTimerCoordinator {
  readonly #authority: RoomTimerAuthority;
  readonly #now: () => number;
  readonly #createSetSeed: () => string;
  readonly #setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;
  readonly #onTransition: NonNullable<RoomTimerOptions['onTransition']>;
  readonly #onError: NonNullable<RoomTimerOptions['onError']>;
  readonly #scheduled = new Map<string, ScheduledRoomTimer>();
  #closed = false;

  constructor(authority: RoomTimerAuthority, options: RoomTimerOptions = {}) {
    this.#authority = authority;
    this.#now = options.now ?? Date.now;
    this.#createSetSeed = options.createSetSeed ?? randomUUID;
    this.#setTimer =
      options.setTimer ??
      ((callback, delayMs) => setTimeout(callback, delayMs));
    this.#clearTimer =
      options.clearTimer ??
      ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.#onTransition = options.onTransition ?? (() => {});
    this.#onError = options.onError ?? (() => {});
  }

  get size(): number {
    return this.#scheduled.size;
  }

  sync(state: RoomState): void {
    if (this.#closed) return;
    const specification = this.#specification(state);
    const existing = this.#scheduled.get(state.roomId);
    if (!specification) {
      this.clearRoom(state.roomId);
      return;
    }
    if (existing?.fingerprint === specification.fingerprint) return;
    if (existing) this.#clearTimer(existing.handle);
    const handle = this.#setTimer(
      () => this.#fire(state.roomId, specification.fingerprint),
      Math.max(0, specification.dueAt - this.#now()),
    );
    this.#scheduled.set(state.roomId, {
      fingerprint: specification.fingerprint,
      kind: 'lifecycle',
      handle,
    });
  }

  clearRoom(roomId: string): void {
    const existing = this.#scheduled.get(roomId);
    if (!existing) return;
    this.#clearTimer(existing.handle);
    this.#scheduled.delete(roomId);
  }

  close(): void {
    this.#closed = true;
    for (const roomId of [...this.#scheduled.keys()]) {
      this.clearRoom(roomId);
    }
  }

  #specification(state: RoomState): LifecycleTimerSpecification | undefined {
    if (state.phase === 'waiting') {
      const candidates: LifecycleTimerSpecification[] = [
        {
          fingerprint: `${state.roomId}:lobby:${state.lobbyExpiresAt}`,
          dueAt: state.lobbyExpiresAt,
          action: {
            type: 'expireRoom',
            reason: 'lobbyExpired',
            expectedAt: state.lobbyExpiresAt,
          },
        },
        ...state.members.flatMap((member) =>
          !member.isAI &&
          !member.connected &&
          member.waitingDisconnectExpiresAt !== null
            ? [
                {
                  fingerprint: `${state.roomId}:waiting:${member.memberId}:${member.waitingDisconnectExpiresAt}`,
                  dueAt: member.waitingDisconnectExpiresAt,
                  action: {
                    type: 'expireWaitingMember' as const,
                    memberId: member.memberId,
                    expectedAt: member.waitingDisconnectExpiresAt,
                  },
                },
              ]
            : [],
        ),
      ];
      return candidates.sort((left, right) => left.dueAt - right.dueAt)[0];
    }
    if (state.phase === 'playing' && state.abandonAt !== null) {
      return {
        fingerprint: `${state.roomId}:abandon:${state.abandonAt}`,
        dueAt: state.abandonAt,
        action: {
          type: 'expireRoom',
          reason: 'abandoned',
          expectedAt: state.abandonAt,
        },
      };
    }
    return undefined;
  }

  #fire(roomId: string, fingerprint: string): void {
    const scheduled = this.#scheduled.get(roomId);
    if (scheduled?.fingerprint !== fingerprint) return;
    this.#scheduled.delete(roomId);
    try {
      const previous = this.#authority.get(roomId);
      if (!previous || this.#closed) return;
      const specification = this.#specification(previous);
      if (specification?.fingerprint !== fingerprint) {
        this.sync(previous);
        return;
      }
      const transition =
        specification.action.type === 'expireWaitingMember'
          ? this.#authority.apply(roomId, {
              ...specification.action,
              now: this.#now(),
              setSeed: this.#createSetSeed(),
            })
          : this.#authority.apply(roomId, {
              ...specification.action,
              now: this.#now(),
            });
      if (!transition?.accepted) {
        const latest = this.#authority.get(roomId);
        if (latest) this.sync(latest);
        return;
      }
      this.#onTransition(
        previous,
        transition,
        specification.action.type === 'expireRoom'
          ? specification.action.reason
          : undefined,
      );
      this.sync(transition.state);
    } catch (error) {
      this.#onError(error);
      const latest = this.#authority.get(roomId);
      if (latest) this.sync(latest);
    }
  }
}
