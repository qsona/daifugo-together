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
        },
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
  onTransition?: (
    previous: RoomState,
    transition: RoomTransition,
    closeReason?: RoomCloseReason,
  ) => void;
  onError?: (error: unknown) => void;
}

interface ScheduledRoomTimer {
  fingerprint: string;
  kind: 'intermission' | 'setResult' | 'turn';
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
    if (
      !Number.isFinite(this.#aiDelayMinMs) ||
      !Number.isFinite(this.#aiDelayMaxMs) ||
      this.#aiDelayMinMs < 0 ||
      this.#aiDelayMaxMs < this.#aiDelayMinMs
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
    if (
      state.phase === 'playing' &&
      state.engine?.phase.name === 'interimResult'
    ) {
      return {
        fingerprint: `${state.engine.setId}:interim:${state.engine.phase.gameIndex}`,
        delayMs: state.engine.config.interimAutoAdvanceMs,
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
    if (
      this.#decideTurn &&
      state.phase === 'playing' &&
      state.engine?.phase.name === 'gameInProgress' &&
      state.engine.currentGame?.public.phase === 'awaitingPlay' &&
      state.engine.currentGame.public.turn
    ) {
      const memberId = state.engine.currentGame.public.turn;
      const member = state.members.find(
        (candidate) => candidate.memberId === memberId,
      );
      if (!member) return undefined;
      const automated = member.isAI || member.departed;
      if (!automated && state.turnDeadlineAt === null) return undefined;
      return {
        fingerprint: `${state.engine.setId}:turn:${state.turnSeq}:${memberId}`,
        delayMs: automated
          ? this.#aiDelay()
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
        previous.phase === 'setResult'
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
      const memberId = previous.engine?.currentGame?.public.turn;
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

  #aiDelay(): number {
    let sample = 0.5;
    try {
      const value = this.#random();
      if (Number.isFinite(value)) {
        sample = Math.max(0, Math.min(1, value));
      }
    } catch {
      // Stable midpoint fallback keeps the room progressing.
    }
    return Math.round(
      this.#aiDelayMinMs + (this.#aiDelayMaxMs - this.#aiDelayMinMs) * sample,
    );
  }
}
