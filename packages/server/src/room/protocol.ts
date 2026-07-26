import type { CardId } from '@daifugo/core';

import type { PlayerRoomView, RoomErrorCode } from './types.js';

export type Ack<T> =
  { ok: true; value: T } | { ok: false; code: ErrorCode; message?: string };

export type ErrorCode =
  | RoomErrorCode
  | 'ROOM_NOT_FOUND'
  | 'ROOM_IN_GAME'
  | 'INVITE_SPACE_EXHAUSTED'
  | 'INTERNAL_ERROR';

export type RoomCloseReason =
  'noHumans' | 'lobbyExpired' | 'abandoned' | 'setEndedNoContinue';

export interface ClientToServerEvents {
  'room:create': (
    payload: Record<string, never>,
    ack: (result: Ack<{ roomId: string; inviteCode: string }>) => void,
  ) => void;
  'room:join': (
    payload: { inviteCode: string },
    ack: (result: Ack<{ roomId: string }>) => void,
  ) => void;
  'room:leave': (
    payload: Record<string, never>,
    ack: (result: Ack<Record<string, never>>) => void,
  ) => void;
  'room:start': (
    payload: Record<string, never>,
    ack: (result: Ack<Record<string, never>>) => void,
  ) => void;
  'room:continue': (
    payload: Record<string, never>,
    ack: (result: Ack<Record<string, never>>) => void,
  ) => void;
  'game:play': (
    payload: { turnSeq: number; cards: CardId[] },
    ack: (result: Ack<Record<string, never>>) => void,
  ) => void;
  'game:pass': (
    payload: { turnSeq: number },
    ack: (result: Ack<Record<string, never>>) => void,
  ) => void;
  'sync:request': (
    payload: Record<string, never>,
    ack: (result: Ack<Record<string, never>>) => void,
  ) => void;
  'user:rename': (
    payload: { displayName: string },
    ack: (result: Ack<Record<string, never>>) => void,
  ) => void;
}

export interface ServerToClientEvents {
  'session:ready': (payload: {
    userId: string;
    userToken: string;
    displayName: string;
    room: PlayerRoomView | null;
  }) => void;
  'room:state': (payload: PlayerRoomView) => void;
  'room:closed': (payload: { reason: RoomCloseReason }) => void;
  'session:superseded': (payload: Record<string, never>) => void;
}

export type InterServerEvents = Record<never, never>;

export interface SocketData {
  session: {
    userId: string;
    userToken: string;
    displayName: string;
  };
}
