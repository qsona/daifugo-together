import { randomInt, randomUUID } from 'node:crypto';

import type { RuleChainEntry } from '@daifugo/core';

import { createRoomState, reduceRoom } from './reducer.js';
import type {
  RoomAction,
  RoomMember,
  RoomReducerOptions,
  RoomState,
  RoomTransition,
} from './types.js';

const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const INVITE_RAW_LENGTH = 8;
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
  availableRules?: () => RuleChainEntry[];
  reducer?: RoomReducerOptions;
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

export function normalizeInviteCode(input: string): string {
  const raw = input.toUpperCase().replaceAll(/[^A-Z0-9]/g, '');
  return raw.length === INVITE_RAW_LENGTH
    ? `${raw.slice(0, 4)}-${raw.slice(4)}`
    : input.toUpperCase().trim();
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
    availableRules: (() => RuleChainEntry[]) | undefined;
    reducer: RoomReducerOptions | undefined;
  };

  constructor(options: RoomManagerOptions = {}) {
    this.#options = {
      now: options.now ?? Date.now,
      createRoomId: options.createRoomId ?? randomUUID,
      createMemberId: options.createMemberId ?? randomUUID,
      randomIndex: options.randomIndex ?? randomInt,
      availableRules: options.availableRules,
      reducer: options.reducer,
    };
  }

  get size(): number {
    return this.#rooms.size;
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

  create(user: RoomUser): RoomManagerResult<RoomMembership> {
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
      owner: {
        memberId: this.#options.createMemberId(),
        userId: user.userId,
        displayName: user.displayName,
      },
      availableRules: this.#options.availableRules?.() ?? [],
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
    const effectiveAction =
      (action.type === 'continue' ||
        action.type === 'leave' ||
        action.type === 'expireSetResult') &&
      this.#options.availableRules
        ? {
            ...action,
            availableRules: this.#options.availableRules(),
          }
        : action;
    const transition = reduceRoom(room, effectiveAction, this.#options.reducer);
    if (!transition.accepted) {
      return transition;
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
      let raw = '';
      for (let index = 0; index < INVITE_RAW_LENGTH; index += 1) {
        const sampled = this.#options.randomIndex(INVITE_ALPHABET.length);
        const safeIndex =
          Number.isInteger(sampled) &&
          sampled >= 0 &&
          sampled < INVITE_ALPHABET.length
            ? sampled
            : 0;
        raw += INVITE_ALPHABET[safeIndex];
      }
      const code = normalizeInviteCode(raw);
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
