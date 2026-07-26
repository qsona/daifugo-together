import { randomUUID } from 'node:crypto';

import type { RoomCloseReason } from './protocol.js';
import type { RoomState, RoomTransition } from './types.js';

export interface RoomTimerAuthority {
  get(roomId: string): RoomState | undefined;
  apply(
    roomId: string,
    action:
      | { type: 'advanceIntermission'; now: number }
      | { type: 'expireSetResult'; now: number; setSeed: string },
  ): RoomTransition | undefined;
}

export interface RoomTimerOptions {
  now?: () => number;
  createSetSeed?: () => string;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onTransition?: (
    previous: RoomState,
    transition: RoomTransition,
    closeReason?: RoomCloseReason,
  ) => void;
  onError?: (error: unknown) => void;
}

interface ScheduledRoomTimer {
  fingerprint: string;
  handle: unknown;
}

export class RoomTimerCoordinator {
  readonly #authority: RoomTimerAuthority;
  readonly #now: () => number;
  readonly #createSetSeed: () => string;
  readonly #setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;
  readonly #onTransition: NonNullable<RoomTimerOptions['onTransition']>;
  readonly #onError: NonNullable<RoomTimerOptions['onError']>;
  readonly #scheduled = new Map<string, ScheduledRoomTimer>();

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
    const specification = this.#specification(state);
    const existing = this.#scheduled.get(state.roomId);
    if (!specification) {
      this.clearRoom(state.roomId);
      return;
    }
    if (existing?.fingerprint === specification.fingerprint) {
      return;
    }
    if (existing) {
      this.#clearTimer(existing.handle);
    }
    const handle = this.#setTimer(
      () => this.#fire(state.roomId, specification.fingerprint),
      specification.delayMs,
    );
    this.#scheduled.set(state.roomId, {
      fingerprint: specification.fingerprint,
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
    for (const roomId of [...this.#scheduled.keys()]) {
      this.clearRoom(roomId);
    }
  }

  #specification(
    state: RoomState,
  ): { fingerprint: string; delayMs: number } | undefined {
    if (
      state.phase === 'playing' &&
      state.engine?.phase.name === 'interimResult'
    ) {
      return {
        fingerprint: `${state.engine.setId}:interim:${state.engine.phase.gameIndex}`,
        delayMs: state.engine.config.interimAutoAdvanceMs,
      };
    }
    if (state.phase === 'setResult' && state.setRespondBy !== null) {
      return {
        fingerprint: `${state.engine?.setId ?? state.roomId}:setResult:${state.setRespondBy}`,
        delayMs: Math.max(0, state.setRespondBy - this.#now()),
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
}
