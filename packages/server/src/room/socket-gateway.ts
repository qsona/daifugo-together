import { randomUUID } from 'node:crypto';

import type { Server, Socket } from 'socket.io';

import { RoomManager } from './manager.js';
import type {
  Ack,
  ClientToServerEvents,
  ErrorCode,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
  RoomCloseReason,
} from './protocol.js';
import { InMemorySessionStore } from './session.js';
import type { RoomState, RoomTransition } from './types.js';
import { viewFor } from './view.js';

export type RoomSocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

type RoomSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export interface RoomSocketGatewayOptions {
  rooms?: RoomManager;
  sessions?: InMemorySessionStore;
  now?: () => number;
  createSetSeed?: () => string;
  onError?: (error: unknown) => void;
}

export interface RoomSocketGateway {
  rooms: RoomManager;
  sessions: InMemorySessionStore;
  close(): void;
}

function failure<T>(code: ErrorCode, message?: string): Ack<T> {
  return message === undefined
    ? { ok: false, code }
    : { ok: false, code, message };
}

function safeAck<T>(
  ack: ((result: Ack<T>) => void) | undefined,
  value: Ack<T>,
) {
  try {
    ack?.(value);
  } catch {
    // A client ack callback is outside the authoritative transition boundary.
  }
}

function roomFailure(
  transition: RoomTransition | undefined,
): Ack<Record<string, never>> | undefined {
  if (!transition) {
    return failure('ROOM_NOT_FOUND');
  }
  if (!transition.accepted) {
    return failure(transition.error?.code ?? 'INTERNAL_ERROR');
  }
  return undefined;
}

function validTurnSeq(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validCards(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 4 &&
    value.every((card) => typeof card === 'string' && card.length > 0)
  );
}

function validDisplayName(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  return (
    trimmed.length >= 1 &&
    trimmed.length <= 20 &&
    ![...trimmed].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127;
    })
  );
}

export function attachRoomSocketGateway(
  io: RoomSocketServer,
  options: RoomSocketGatewayOptions = {},
): RoomSocketGateway {
  const rooms = options.rooms ?? new RoomManager();
  const sessions = options.sessions ?? new InMemorySessionStore();
  const now = options.now ?? Date.now;
  const createSetSeed = options.createSetSeed ?? randomUUID;
  const activeByUser = new Map<string, RoomSocket>();

  const report = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Error observation is best effort.
    }
  };

  const emitState = (state: RoomState): void => {
    if (state.phase === 'closed') return;
    for (const member of state.members) {
      if (!member.userId || member.departed) {
        continue;
      }
      const target = activeByUser.get(member.userId);
      if (!target) {
        continue;
      }
      try {
        target.emit('room:state', viewFor(state, member.memberId));
      } catch (error) {
        report(error);
      }
    }
  };

  const emitTransition = (
    previous: RoomState,
    transition: RoomTransition,
    closeReason: RoomCloseReason = 'noHumans',
  ): void => {
    if (transition.state.phase !== 'closed') {
      emitState(transition.state);
      return;
    }
    for (const member of previous.members) {
      if (member.userId) {
        activeByUser.get(member.userId)?.emit('room:closed', {
          reason: closeReason,
        });
      }
    }
  };

  const handleUnexpected = <T>(
    error: unknown,
    ack: ((result: Ack<T>) => void) | undefined,
  ): void => {
    report(error);
    safeAck(ack, failure('INTERNAL_ERROR'));
  };

  io.on('connection', (socket) => {
    const session = sessions.resolve(socket.handshake.auth?.userToken);
    socket.data.session = session;
    const superseded = activeByUser.get(session.userId);
    activeByUser.set(session.userId, socket);
    if (superseded && superseded.id !== socket.id) {
      superseded.emit('session:superseded', {});
      superseded.disconnect(true);
    }

    let membership = rooms.findByUser(session.userId);
    if (membership && !membership.member.connected) {
      const reconnected = rooms.apply(membership.room.roomId, {
        type: 'reconnect',
        memberId: membership.member.memberId,
      });
      if (reconnected?.accepted) {
        emitState(reconnected.state);
        membership = rooms.findByUser(session.userId);
      }
    }
    socket.emit('session:ready', {
      ...session,
      room: membership
        ? viewFor(membership.room, membership.member.memberId, {
            reconnect: true,
          })
        : null,
    });

    socket.on('room:create', (_payload, ack) => {
      try {
        const created = rooms.create(session);
        if (!created.ok) {
          safeAck(ack, failure(created.code));
          return;
        }
        emitState(created.value.room);
        safeAck(ack, {
          ok: true,
          value: {
            roomId: created.value.room.roomId,
            inviteCode: created.value.room.inviteCode,
          },
        });
      } catch (error) {
        handleUnexpected(error, ack);
      }
    });

    socket.on('room:join', (payload, ack) => {
      try {
        if (!payload || typeof payload.inviteCode !== 'string') {
          safeAck(ack, failure('ROOM_NOT_FOUND'));
          return;
        }
        const joined = rooms.join(payload.inviteCode, session);
        if (!joined.ok) {
          safeAck(ack, failure(joined.code));
          return;
        }
        emitState(joined.value.room);
        safeAck(ack, {
          ok: true,
          value: { roomId: joined.value.room.roomId },
        });
      } catch (error) {
        handleUnexpected(error, ack);
      }
    });

    socket.on('room:leave', (_payload, ack) => {
      try {
        const current = rooms.findByUser(session.userId);
        if (!current) {
          safeAck(ack, failure('NOT_IN_ROOM'));
          return;
        }
        const transition = rooms.apply(current.room.roomId, {
          type: 'leave',
          memberId: current.member.memberId,
          now: now(),
          setSeed: createSetSeed(),
        });
        const error = roomFailure(transition);
        if (error) {
          safeAck(ack, error);
          return;
        }
        emitTransition(
          current.room,
          transition!,
          current.room.phase === 'setResult'
            ? 'setEndedNoContinue'
            : 'noHumans',
        );
        safeAck(ack, { ok: true, value: {} });
      } catch (error) {
        handleUnexpected(error, ack);
      }
    });

    socket.on('room:start', (_payload, ack) => {
      try {
        const current = rooms.findByUser(session.userId);
        if (!current) {
          safeAck(ack, failure('NOT_IN_ROOM'));
          return;
        }
        const transition = rooms.apply(current.room.roomId, {
          type: 'start',
          memberId: current.member.memberId,
          now: now(),
          setSeed: createSetSeed(),
        });
        const error = roomFailure(transition);
        if (error) {
          safeAck(ack, error);
          return;
        }
        emitState(transition!.state);
        safeAck(ack, { ok: true, value: {} });
      } catch (error) {
        handleUnexpected(error, ack);
      }
    });

    socket.on('room:continue', (_payload, ack) => {
      try {
        const current = rooms.findByUser(session.userId);
        if (!current) {
          safeAck(ack, failure('NOT_IN_ROOM'));
          return;
        }
        const transition = rooms.apply(current.room.roomId, {
          type: 'continue',
          memberId: current.member.memberId,
          now: now(),
          setSeed: createSetSeed(),
        });
        const error = roomFailure(transition);
        if (error) {
          safeAck(ack, error);
          return;
        }
        emitTransition(current.room, transition!);
        safeAck(ack, { ok: true, value: {} });
      } catch (error) {
        handleUnexpected(error, ack);
      }
    });

    socket.on('game:play', (payload, ack) => {
      try {
        if (
          !payload ||
          !validTurnSeq(payload.turnSeq) ||
          !validCards(payload.cards)
        ) {
          safeAck(ack, failure('ILLEGAL_PLAY'));
          return;
        }
        const current = rooms.findByUser(session.userId);
        if (!current) {
          safeAck(ack, failure('NOT_IN_ROOM'));
          return;
        }
        const transition = rooms.apply(current.room.roomId, {
          type: 'play',
          memberId: current.member.memberId,
          turnSeq: payload.turnSeq,
          cards: [...payload.cards],
          now: now(),
        });
        const error = roomFailure(transition);
        if (error) {
          safeAck(ack, error);
          return;
        }
        emitState(transition!.state);
        safeAck(ack, { ok: true, value: {} });
      } catch (error) {
        handleUnexpected(error, ack);
      }
    });

    socket.on('game:pass', (payload, ack) => {
      try {
        if (!payload || !validTurnSeq(payload.turnSeq)) {
          safeAck(ack, failure('ILLEGAL_PLAY'));
          return;
        }
        const current = rooms.findByUser(session.userId);
        if (!current) {
          safeAck(ack, failure('NOT_IN_ROOM'));
          return;
        }
        const transition = rooms.apply(current.room.roomId, {
          type: 'pass',
          memberId: current.member.memberId,
          turnSeq: payload.turnSeq,
          now: now(),
        });
        const error = roomFailure(transition);
        if (error) {
          safeAck(ack, error);
          return;
        }
        emitState(transition!.state);
        safeAck(ack, { ok: true, value: {} });
      } catch (error) {
        handleUnexpected(error, ack);
      }
    });

    socket.on('sync:request', (_payload, ack) => {
      try {
        const current = rooms.findByUser(session.userId);
        if (!current) {
          safeAck(ack, failure('NOT_IN_ROOM'));
          return;
        }
        socket.emit(
          'room:state',
          viewFor(current.room, current.member.memberId, {
            reconnect: true,
          }),
        );
        safeAck(ack, { ok: true, value: {} });
      } catch (error) {
        handleUnexpected(error, ack);
      }
    });

    socket.on('user:rename', (payload, ack) => {
      try {
        if (!payload || !validDisplayName(payload.displayName)) {
          safeAck(ack, failure('INVALID_NAME'));
          return;
        }
        const displayName = payload.displayName.trim();
        const current = rooms.findByUser(session.userId);
        if (current) {
          const transition = rooms.apply(current.room.roomId, {
            type: 'rename',
            memberId: current.member.memberId,
            displayName,
          });
          const error = roomFailure(transition);
          if (error) {
            safeAck(ack, error);
            return;
          }
          emitState(transition!.state);
        }
        if (!sessions.rename(session.userToken, displayName)) {
          safeAck(ack, failure('INTERNAL_ERROR'));
          return;
        }
        session.displayName = displayName;
        socket.data.session.displayName = displayName;
        safeAck(ack, { ok: true, value: {} });
      } catch (error) {
        handleUnexpected(error, ack);
      }
    });

    socket.on('disconnect', () => {
      if (activeByUser.get(session.userId) !== socket) {
        return;
      }
      activeByUser.delete(session.userId);
      const current = rooms.findByUser(session.userId);
      if (!current) {
        return;
      }
      try {
        const transition = rooms.apply(current.room.roomId, {
          type: 'disconnect',
          memberId: current.member.memberId,
        });
        if (transition?.accepted) {
          emitTransition(current.room, transition);
        }
      } catch (error) {
        report(error);
      }
    });
  });

  return {
    rooms,
    sessions,
    close() {
      for (const socket of activeByUser.values()) {
        socket.disconnect(true);
      }
      activeByUser.clear();
    },
  };
}
