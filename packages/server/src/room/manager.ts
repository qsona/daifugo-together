import { randomInt, randomUUID } from 'node:crypto';

import type { RoomMode, RuleChainEntry } from '@daifugo/core';

import { createRoomState, reduceRoom } from './reducer.js';
import type {
  RoomAction,
  RoomMember,
  RoomReducerOptions,
  RoomState,
  RoomTransition,
} from './types.js';

const INVITE_CODE_LENGTH = 5;
const INVITE_CODE_SPACE = 10 ** INVITE_CODE_LENGTH;
const MAX_INVITE_ATTEMPTS = 64;

export interface RoomUser {
  userId: string;
  displayName: string;
}

export interface RoomManagerOptions {
  now?: () => number;
  createRoomId?: () => string;
  createMemberId?: () => string;
  randomIndex?: (maxExclusive: number) => number;
  availableRules?: (setId?: string) => RuleChainEntry[];
  reducer?: RoomReducerOptions;
  persistence?: RoomPersistencePort;
}

export interface RoomPersistencePort {
  commit(
    previous: RoomState,
    action: RoomAction,
    transition: RoomTransition,
  ): void;
}

export type RoomManagerErrorCode =
  | 'ALREADY_IN_ROOM'
  | 'ROOM_FULL'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_IN_GAME'
  | 'INVITE_SPACE_EXHAUSTED';

export type RoomManagerResult<T> =
  { ok: true; value: T } | { ok: false; code: RoomManagerErrorCode };

export interface RoomMembership {
  room: RoomState;
  member: RoomMember;
}

export interface RoomSweepResult {
  previous: RoomState;
  transition: RoomTransition;
  closeReason?: 'lobbyExpired' | 'abandoned' | 'setEndedNoContinue';
}

export interface WaitingRuleRefresh {
  previous: RoomState;
  transition: RoomTransition;
}

export function normalizeInviteCode(input: string): string {
  return input.trim();
}

export class RoomManager {
  readonly #rooms = new Map<string, RoomState>();
  readonly #byInvite = new Map<string, string>();
  readonly #byUser = new Map<string, string>();
  readonly #options: {
    now: () => number;
    createRoomId: () => string;
    createMemberId: () => string;
    randomIndex: (maxExclusive: number) => number;
    availableRules: ((setId?: string) => RuleChainEntry[]) | undefined;
    reducer: RoomReducerOptions | undefined;
    persistence: RoomPersistencePort | undefined;
  };

  constructor(options: RoomManagerOptions = {}) {
    this.#options = {
      now: options.now ?? Date.now,
      createRoomId: options.createRoomId ?? randomUUID,
      createMemberId: options.createMemberId ?? randomUUID,
      randomIndex: options.randomIndex ?? randomInt,
      availableRules: options.availableRules,
      reducer: options.reducer,
      persistence: options.persistence,
    };
  }

  get size(): number {
    return this.#rooms.size;
  }

  roomIds(): string[] {
    return [...this.#rooms.keys()];
  }

  get(roomId: string): RoomState | undefined {
    return this.#rooms.get(roomId);
  }

  findByUser(userId: string): RoomMembership | undefined {
    const roomId = this.#byUser.get(userId);
    if (!roomId) {
      return undefined;
    }
    const room = this.#rooms.get(roomId);
    const member = room?.members.find(
      (candidate) => candidate.userId === userId && !candidate.departed,
    );
    if (!room || !member) {
      if (this.#byUser.get(userId) === roomId) {
        this.#byUser.delete(userId);
      }
      return undefined;
    }
    return { room, member };
  }

  refreshWaitingRules(): WaitingRuleRefresh[] {
    if (!this.#options.availableRules) return [];
    const nextRules = this.#options.availableRules();
    const encoded = JSON.stringify(nextRules);
    const refreshed: WaitingRuleRefresh[] = [];
    for (const roomId of this.roomIds()) {
      const previous = this.#rooms.get(roomId);
      if (
        previous?.phase !== 'waiting' ||
        previous.mode !== 'community' ||
        JSON.stringify(previous.availableRules) === encoded
      ) {
        continue;
      }
      const transition = this.apply(roomId, {
        type: 'refreshRules',
        availableRules: nextRules,
      });
      if (transition?.accepted) refreshed.push({ previous, transition });
    }
    return refreshed;
  }

  sweep(
    now: number,
    createSetSeed: () => string = randomUUID,
  ): RoomSweepResult[] {
    const results: RoomSweepResult[] = [];
    for (const roomId of this.roomIds()) {
      let room = this.#rooms.get(roomId);
      if (!room) continue;
      if (room.phase === 'waiting' && room.lobbyExpiresAt <= now) {
        const transition = this.apply(roomId, {
          type: 'expireRoom',
          reason: 'lobbyExpired',
          expectedAt: room.lobbyExpiresAt,
          now,
        });
        if (transition?.accepted) {
          results.push({
            previous: room,
            transition,
            closeReason: 'lobbyExpired',
          });
        }
        continue;
      }
      while (room?.phase === 'waiting') {
        const expired = room.members
          .filter(
            (member) =>
              !member.isAI &&
              !member.connected &&
              member.waitingDisconnectExpiresAt !== null &&
              member.waitingDisconnectExpiresAt <= now,
          )
          .sort(
            (left, right) =>
              left.waitingDisconnectExpiresAt! -
              right.waitingDisconnectExpiresAt!,
          )[0];
        if (!expired?.waitingDisconnectExpiresAt) break;
        const previous = room;
        const transition = this.apply(roomId, {
          type: 'expireWaitingMember',
          memberId: expired.memberId,
          expectedAt: expired.waitingDisconnectExpiresAt,
          now,
          setSeed: createSetSeed(),
        });
        if (!transition?.accepted) break;
        results.push({ previous, transition });
        room = this.#rooms.get(roomId);
      }
      room = this.#rooms.get(roomId);
      if (
        room?.phase === 'playing' &&
        room.abandonAt !== null &&
        room.abandonAt <= now
      ) {
        const transition = this.apply(roomId, {
          type: 'expireRoom',
          reason: 'abandoned',
          expectedAt: room.abandonAt,
          now,
        });
        if (transition?.accepted) {
          results.push({
            previous: room,
            transition,
            closeReason: 'abandoned',
          });
        }
      } else if (
        room?.phase === 'setResult' &&
        room.setRespondBy !== null &&
        room.setRespondBy <= now
      ) {
        const transition = this.apply(roomId, {
          type: 'expireSetResult',
          now,
          setSeed: createSetSeed(),
        });
        if (transition?.accepted) {
          results.push({
            previous: room,
            transition,
            ...(transition.state.phase === 'closed'
              ? { closeReason: 'setEndedNoContinue' as const }
              : {}),
          });
        }
      }
    }
    return results;
  }

  create(
    user: RoomUser,
    input: { mode: RoomMode } = { mode: 'community' },
  ): RoomManagerResult<RoomMembership> {
    if (this.findByUser(user.userId)) {
      return { ok: false, code: 'ALREADY_IN_ROOM' };
    }
    const inviteCode = this.#newInviteCode();
    if (!inviteCode) {
      return { ok: false, code: 'INVITE_SPACE_EXHAUSTED' };
    }
    const room = createRoomState({
      roomId: this.#options.createRoomId(),
      inviteCode,
      mode: input.mode,
      owner: {
        memberId: this.#options.createMemberId(),
        userId: user.userId,
        displayName: user.displayName,
      },
      availableRules:
        input.mode === 'basic' ? [] : (this.#options.availableRules?.() ?? []),
      now: this.#options.now(),
      ...(this.#options.reducer?.lobbyTtlMs === undefined
        ? {}
        : { lobbyTtlMs: this.#options.reducer.lobbyTtlMs }),
    });
    this.#rooms.set(room.roomId, room);
    this.#byInvite.set(room.inviteCode, room.roomId);
    this.#byUser.set(user.userId, room.roomId);
    return { ok: true, value: { room, member: room.members[0]! } };
  }

  join(inviteCode: string, user: RoomUser): RoomManagerResult<RoomMembership> {
    if (this.findByUser(user.userId)) {
      return { ok: false, code: 'ALREADY_IN_ROOM' };
    }
    const roomId = this.#byInvite.get(normalizeInviteCode(inviteCode));
    const room = roomId ? this.#rooms.get(roomId) : undefined;
    if (!room) {
      return { ok: false, code: 'ROOM_NOT_FOUND' };
    }
    if (room.phase !== 'waiting') {
      return { ok: false, code: 'ROOM_IN_GAME' };
    }
    const memberId = this.#options.createMemberId();
    const transition = reduceRoom(room, {
      type: 'join',
      member: {
        memberId,
        userId: user.userId,
        displayName: user.displayName,
      },
      now: this.#options.now(),
    });
    if (!transition.accepted) {
      return {
        ok: false,
        code:
          transition.error?.code === 'ALREADY_IN_ROOM'
            ? 'ALREADY_IN_ROOM'
            : transition.error?.code === 'ROOM_FULL'
              ? 'ROOM_FULL'
              : 'ROOM_IN_GAME',
      };
    }
    this.#rooms.set(room.roomId, transition.state);
    this.#byUser.set(user.userId, room.roomId);
    const member = transition.state.members.find(
      (candidate) => candidate.memberId === memberId,
    )!;
    return { ok: true, value: { room: transition.state, member } };
  }

  apply(roomId: string, action: RoomAction): RoomTransition | undefined {
    const room = this.#rooms.get(roomId);
    if (!room) {
      return undefined;
    }
    const reducer =
      room.mode === 'community' && this.#options.availableRules
        ? {
            ...this.#options.reducer,
            availableRulesForSet: (setId: string) =>
              this.#options.availableRules!(setId),
          }
        : this.#options.reducer;
    const transition = reduceRoom(room, action, reducer);
    if (!transition.accepted) {
      return transition;
    }
    this.#options.persistence?.commit(room, action, transition);
    if (
      room.engine &&
      (transition.state.engine?.setId !== room.engine.setId ||
        transition.state.phase === 'closed')
    ) {
      this.#options.reducer?.releaseRulePort?.(room.engine.setId);
    }
    this.#rooms.set(roomId, transition.state);
    if (action.type === 'leave') {
      const leaving = room.members.find(
        (member) => member.memberId === action.memberId,
      );
      if (leaving?.userId && this.#byUser.get(leaving.userId) === roomId) {
        this.#byUser.delete(leaving.userId);
      }
    }
    const nextMemberIds = new Set(
      transition.state.members.map((member) => member.memberId),
    );
    for (const member of room.members) {
      if (
        member.userId &&
        (!nextMemberIds.has(member.memberId) ||
          transition.state.members.find(
            (candidate) => candidate.memberId === member.memberId,
          )?.departed) &&
        this.#byUser.get(member.userId) === roomId
      ) {
        this.#byUser.delete(member.userId);
      }
    }
    if (transition.state.phase === 'closed') {
      this.#removeClosed(transition.state);
    }
    return transition;
  }

  #newInviteCode(): string | undefined {
    for (let attempt = 0; attempt < MAX_INVITE_ATTEMPTS; attempt += 1) {
      const sampled = this.#options.randomIndex(INVITE_CODE_SPACE);
      const safeIndex =
        Number.isInteger(sampled) && sampled >= 0 && sampled < INVITE_CODE_SPACE
          ? sampled
          : 0;
      const code = String(safeIndex).padStart(INVITE_CODE_LENGTH, '0');
      if (!this.#byInvite.has(code)) {
        return code;
      }
    }
    return undefined;
  }

  #removeClosed(room: RoomState): void {
    this.#rooms.delete(room.roomId);
    if (this.#byInvite.get(room.inviteCode) === room.roomId) {
      this.#byInvite.delete(room.inviteCode);
    }
    for (const member of room.members) {
      if (member.userId && this.#byUser.get(member.userId) === room.roomId) {
        this.#byUser.delete(member.userId);
      }
    }
  }
}
