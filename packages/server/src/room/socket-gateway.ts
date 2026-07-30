import { randomUUID } from 'node:crypto';

import {
  createAiPlayer,
  DEFAULT_THINK_BUDGET,
  NORMAL_DIFFICULTY,
  type AiPlayer,
  type AiRuleBundleRef,
} from '@daifugo/ai';
import {
  buildPlayerSnapshot,
  clientPayloadSchemas,
  enumerateLegalPlays,
  NO_RULE_CHAIN_PORT,
  type CardId,
  type RuleChainEntry,
  type RuleChainPort,
  type RuleRuntime,
} from '@daifugo/core';
import type { Server, Socket } from 'socket.io';

import {
  runAiTurn,
  withResolvedRuleBundles,
  type AiTurnLog,
  type AiTurnMetric,
} from '../ai-turn.js';
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
import { FixedWindowRateLimiter } from './rate-limit.js';
import { InMemorySessionStore, type SessionStore } from './session.js';
import {
  RoomLifecycleTimerCoordinator,
  RoomTimerCoordinator,
} from './timers.js';
import type { RoomTimerOptions } from './timers.js';
import { setSeedForRoomStart } from './tutorial.js';
import type { RoomReducerOptions, RoomState, RoomTransition } from './types.js';
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
  sessions?: SessionStore;
  now?: () => number;
  createSetSeed?: () => string;
  ai?: AiPlayer;
  rulePort?: RuleChainPort;
  rulePortForSet?: (setId: string) => RuleChainPort;
  resolveRuleMessage?: RoomReducerOptions['resolveRuleMessage'];
  effectiveRuleChainForSet?: (
    setId: string,
    entries: readonly RuleChainEntry[],
  ) => RuleChainEntry[];
  aiRuleBundles?: (entries: readonly RuleChainEntry[]) => AiRuleBundleRef[];
  decideTurn?: (state: RoomState, memberId: string) => Promise<CardId[] | null>;
  timers?: Pick<
    RoomTimerOptions,
    | 'setTimer'
    | 'clearTimer'
    | 'random'
    | 'aiDelayMinMs'
    | 'aiDelayMaxMs'
    | 'basicAiDelayMinMs'
    | 'basicAiDelayMaxMs'
  >;
  joinRateLimit?: {
    maxAttempts: number;
    windowMs: number;
  };
  sweepIntervalMs?: number;
  onError?: (error: unknown) => void;
  onAiLog?: (log: AiTurnLog) => void;
  onAiMetric?: (metric: AiTurnMetric) => void;
}

export interface RoomSocketGateway {
  rooms: RoomManager;
  sessions: SessionStore;
  refreshWaitingRules(): number;
  beginDrain(): Promise<void>;
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
    return failure(transition.error?.code ?? 'INTERNAL');
  }
  return undefined;
}

function projectRuleMemory(
  memory: RuleRuntime['setMemory'],
  entries: readonly RuleChainEntry[],
): RuleRuntime['setMemory'] {
  const active = new Set(entries.map((entry) => entry.ruleId));
  return Object.fromEntries(
    Object.entries(memory)
      .filter(([ruleId]) => active.has(ruleId))
      .map(([ruleId, namespace]) => [ruleId, structuredClone(namespace)]),
  );
}

export function attachRoomSocketGateway(
  io: RoomSocketServer,
  options: RoomSocketGatewayOptions = {},
): RoomSocketGateway {
  const now = options.now ?? Date.now;
  const rooms =
    options.rooms ??
    new RoomManager({
      now,
      ...(options.rulePort ? { reducer: { rulePort: options.rulePort } } : {}),
    });
  const sessions = options.sessions ?? new InMemorySessionStore();
  const createSetSeed = options.createSetSeed ?? randomUUID;
  const activeByUser = new Map<string, RoomSocket>();
  const readySocketIds = new Set<string>();
  const ai = options.ai ?? createAiPlayer();
  const ownsAi = options.ai === undefined;
  let draining = false;
  let drainPromise: Promise<void> | undefined;
  let resolveDrain: (() => void) | undefined;
  const joinRateLimiter = new FixedWindowRateLimiter(
    options.joinRateLimit ?? { maxAttempts: 10, windowMs: 60_000 },
  );
  const ruleViewOptions = (state: RoomState) => {
    const setId = state.engine?.setId;
    const rulePort =
      (setId === undefined ? undefined : options.rulePortForSet?.(setId)) ??
      options.rulePort;
    return {
      ...(rulePort ? { rulePort } : {}),
      ...(options.resolveRuleMessage
        ? { resolveRuleMessage: options.resolveRuleMessage }
        : {}),
    };
  };

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
      if (!target || !readySocketIds.has(target.id)) {
        continue;
      }
      try {
        target.emit(
          'room:state',
          viewFor(state, member.memberId, ruleViewOptions(state)),
        );
      } catch (error) {
        report(error);
      }
    }
  };

  const settleDrainIfReady = (): void => {
    if (
      draining &&
      !rooms.roomIds().some((roomId) => rooms.get(roomId)?.phase === 'playing')
    ) {
      resolveDrain?.();
      resolveDrain = undefined;
    }
  };

  const emitTransition = (
    previous: RoomState,
    transition: RoomTransition,
    closeReason: RoomCloseReason = 'noHumans',
  ): void => {
    if (transition.state.phase !== 'closed') {
      emitState(transition.state);
    } else {
      for (const member of previous.members) {
        if (member.userId) {
          activeByUser.get(member.userId)?.emit('room:closed', {
            reason: closeReason,
          });
        }
      }
    }
    settleDrainIfReady();
  };
  const lifecycleTimers = new RoomLifecycleTimerCoordinator(rooms, {
    ...options.timers,
    now,
    createSetSeed,
    onTransition: (previous, transition, reason) => {
      emitTransition(previous, transition, reason);
      phaseTimers.sync(transition.state);
    },
    onError: report,
  });
  const phaseTimers = new RoomTimerCoordinator(rooms, {
    ...options.timers,
    now,
    createSetSeed,
    decideTurn:
      options.decideTurn ??
      (async (state, memberId) => {
        const engine = state.engine;
        const game = engine?.currentGame;
        if (!engine || !game || engine.phase.name !== 'gameInProgress') {
          return null;
        }
        const gameIndex = engine.phase.gameIndex;
        const runtime: RuleRuntime = {
          port:
            options.rulePortForSet?.(engine.setId) ??
            options.rulePort ??
            NO_RULE_CHAIN_PORT,
          setHistory: engine.results,
          setMemory: engine.setMemory,
        };
        const pending = game.private.pendingChoice;
        if (
          game.public.phase === 'awaitingChoice' &&
          pending?.player === memberId
        ) {
          return [...pending.optionCardIds].sort().slice(0, pending.count);
        }
        const effectiveRules = () =>
          options.effectiveRuleChainForSet?.(engine.setId, engine.ruleChain) ??
          engine.ruleChain;
        let ruleChain = effectiveRules();
        let config = {
          gameIndex,
          seats: engine.members.map((member) => member.id),
          gameSeed: `${engine.setSeed}:${gameIndex}`,
          ruleChain,
        };
        const legalPlays = enumerateLegalPlays(config, game, memberId, runtime);
        if (legalPlays.length === 0) return null;
        ruleChain = effectiveRules();
        config = { ...config, ruleChain };
        const view = buildPlayerSnapshot(
          config,
          game,
          {
            setId: engine.setId,
            setPhase: engine.phase,
            members: engine.members,
            setResults: engine.results,
          },
          memberId,
          runtime,
        );
        ruleChain = effectiveRules();
        const ruleContext = {
          ruleChain: structuredClone(ruleChain),
          bundles: [] as AiRuleBundleRef[],
          gameSeed: config.gameSeed,
          gameMemory: projectRuleMemory(game.private.memory, ruleChain),
          hookCalls: structuredClone(game.private.hookCalls),
          setMemory: projectRuleMemory(engine.setMemory, ruleChain),
        };
        const resolveBundles = options.aiRuleBundles;
        const turnAi = resolveBundles
          ? withResolvedRuleBundles(ai, resolveBundles)
          : ai;
        const result = await runAiTurn({
          ai: turnAi,
          input: {
            view,
            legalPlays,
            budget: {
              ...DEFAULT_THINK_BUDGET,
              maxPlayouts: 16,
            },
            seed: `${engine.setSeed}:room:${gameIndex}:${state.turnSeq}:${memberId}`,
            difficulty: NORMAL_DIFFICULTY,
            ruleContext,
          },
          fallbackPlay: () => legalPlays[0]!,
          animationDelay: { minMs: 0, maxMs: 0 },
          ...(options.onAiLog ? { onLog: options.onAiLog } : {}),
          ...(options.onAiMetric ? { onMetric: options.onAiMetric } : {}),
        });
        return result.decision.play.cards.map((card) => card.id);
      }),
    onTransition: (previous, transition, reason) => {
      emitTransition(previous, transition, reason);
      lifecycleTimers.sync(transition.state);
    },
    onError: report,
  });
  const publishTransition = (
    previous: RoomState,
    transition: RoomTransition,
    closeReason?: RoomCloseReason,
  ): void => {
    emitTransition(previous, transition, closeReason);
    phaseTimers.sync(transition.state);
    lifecycleTimers.sync(transition.state);
  };
  const sweepTimer = setInterval(() => {
    try {
      for (const result of rooms.sweep(now(), createSetSeed)) {
        publishTransition(
          result.previous,
          result.transition,
          result.closeReason,
        );
      }
    } catch (error) {
      report(error);
    }
  }, options.sweepIntervalMs ?? 60_000);
  sweepTimer.unref();

  const handleUnexpected = <T>(
    error: unknown,
    ack: ((result: Ack<T>) => void) | undefined,
  ): void => {
    report(error);
    safeAck(ack, failure('INTERNAL'));
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
        now: now(),
      });
      if (reconnected?.accepted) {
        publishTransition(membership.room, reconnected);
        membership = rooms.findByUser(session.userId);
      }
    }
    socket.emit('session:ready', {
      ...session,
      room: membership
        ? viewFor(membership.room, membership.member.memberId, {
            reconnect: true,
            ...ruleViewOptions(membership.room),
          })
        : null,
    });
    readySocketIds.add(socket.id);

    socket.on('room:create', (payload, ack) => {
      try {
        const parsed = clientPayloadSchemas['room:create'].safeParse(payload);
        if (!parsed.success) {
          safeAck(ack, failure('BAD_PAYLOAD'));
          return;
        }
        if (draining) {
          safeAck(ack, failure('INTERNAL', 'server is draining'));
          return;
        }
        const created = rooms.create(session, {
          mode: parsed.data.mode ?? 'community',
        });
        if (!created.ok) {
          safeAck(ack, failure(created.code));
          return;
        }
        emitState(created.value.room);
        lifecycleTimers.sync(created.value.room);
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
        if (draining) {
          safeAck(ack, failure('INTERNAL', 'server is draining'));
          return;
        }
        if (!joinRateLimiter.allow(socket.handshake.address, now())) {
          safeAck(ack, failure('RATE_LIMITED'));
          return;
        }
        const parsed = clientPayloadSchemas['room:join'].safeParse(payload);
        if (!parsed.success) {
          safeAck(ack, failure('BAD_PAYLOAD'));
          return;
        }
        const joined = rooms.join(parsed.data.inviteCode, session);
        if (!joined.ok) {
          safeAck(ack, failure(joined.code));
          return;
        }
        emitState(joined.value.room);
        lifecycleTimers.sync(joined.value.room);
        safeAck(ack, {
          ok: true,
          value: { roomId: joined.value.room.roomId },
        });
      } catch (error) {
        handleUnexpected(error, ack);
      }
    });

    socket.on('room:leave', (payload, ack) => {
      try {
        if (!clientPayloadSchemas['room:leave'].safeParse(payload).success) {
          safeAck(ack, failure('BAD_PAYLOAD'));
          return;
        }
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
        publishTransition(
          current.room,
          transition!,
          current.room.phase === 'setResult'
            ? 'setEndedNoContinue'
            : current.room.phase === 'playing'
              ? 'abandoned'
              : 'noHumans',
        );
        safeAck(ack, { ok: true, value: {} });
      } catch (error) {
        handleUnexpected(error, ack);
      }
    });

    socket.on('room:start', (payload, ack) => {
      try {
        if (!clientPayloadSchemas['room:start'].safeParse(payload).success) {
          safeAck(ack, failure('BAD_PAYLOAD'));
          return;
        }
        if (draining) {
          safeAck(ack, failure('INTERNAL', 'server is draining'));
          return;
        }
        const current = rooms.findByUser(session.userId);
        if (!current) {
          safeAck(ack, failure('NOT_IN_ROOM'));
          return;
        }
        const transition = rooms.apply(current.room.roomId, {
          type: 'start',
          memberId: current.member.memberId,
          now: now(),
          setSeed: setSeedForRoomStart(current.room, createSetSeed),
        });
        const error = roomFailure(transition);
        if (error) {
          safeAck(ack, error);
          return;
        }
        publishTransition(current.room, transition!);
        safeAck(ack, { ok: true, value: {} });
      } catch (error) {
        handleUnexpected(error, ack);
      }
    });

    socket.on('room:continue', (payload, ack) => {
      try {
        if (!clientPayloadSchemas['room:continue'].safeParse(payload).success) {
          safeAck(ack, failure('BAD_PAYLOAD'));
          return;
        }
        if (draining) {
          safeAck(ack, failure('INTERNAL', 'server is draining'));
          return;
        }
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
        publishTransition(current.room, transition!);
        safeAck(ack, { ok: true, value: {} });
      } catch (error) {
        handleUnexpected(error, ack);
      }
    });

    socket.on('game:play', (payload, ack) => {
      try {
        const parsed = clientPayloadSchemas['game:play'].safeParse(payload);
        if (!parsed.success) {
          safeAck(ack, failure('BAD_PAYLOAD'));
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
          turnSeq: parsed.data.turnSeq,
          cards: [...parsed.data.cards],
          now: now(),
        });
        const error = roomFailure(transition);
        if (error) {
          safeAck(ack, error);
          return;
        }
        publishTransition(current.room, transition!);
        safeAck(ack, { ok: true, value: {} });
      } catch (error) {
        handleUnexpected(error, ack);
      }
    });

    socket.on('game:ruleInput', (payload, ack) => {
      try {
        const parsed =
          clientPayloadSchemas['game:ruleInput'].safeParse(payload);
        if (!parsed.success) {
          safeAck(ack, failure('BAD_PAYLOAD'));
          return;
        }
        const current = rooms.findByUser(session.userId);
        if (!current) {
          safeAck(ack, failure('NOT_IN_ROOM'));
          return;
        }
        const transition = rooms.apply(current.room.roomId, {
          type: 'ruleInput',
          memberId: current.member.memberId,
          turnSeq: parsed.data.turnSeq,
          choiceId: parsed.data.choiceId,
          cardIds: [...parsed.data.cardIds],
          now: now(),
        });
        const error = roomFailure(transition);
        if (error) {
          safeAck(ack, error);
          return;
        }
        publishTransition(current.room, transition!);
        safeAck(ack, { ok: true, value: {} });
      } catch (error) {
        handleUnexpected(error, ack);
      }
    });

    socket.on('game:pass', (payload, ack) => {
      try {
        const parsed = clientPayloadSchemas['game:pass'].safeParse(payload);
        if (!parsed.success) {
          safeAck(ack, failure('BAD_PAYLOAD'));
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
          turnSeq: parsed.data.turnSeq,
          now: now(),
        });
        const error = roomFailure(transition);
        if (error) {
          safeAck(ack, error);
          return;
        }
        publishTransition(current.room, transition!);
        safeAck(ack, { ok: true, value: {} });
      } catch (error) {
        handleUnexpected(error, ack);
      }
    });

    socket.on('sync:request', (payload, ack) => {
      try {
        if (!clientPayloadSchemas['sync:request'].safeParse(payload).success) {
          safeAck(ack, failure('BAD_PAYLOAD'));
          return;
        }
        const current = rooms.findByUser(session.userId);
        if (!current) {
          safeAck(ack, failure('NOT_IN_ROOM'));
          return;
        }
        socket.emit(
          'room:state',
          viewFor(current.room, current.member.memberId, {
            reconnect: true,
            ...ruleViewOptions(current.room),
          }),
        );
        safeAck(ack, { ok: true, value: {} });
      } catch (error) {
        handleUnexpected(error, ack);
      }
    });

    socket.on('user:rename', (payload, ack) => {
      try {
        const parsed = clientPayloadSchemas['user:rename'].safeParse(payload);
        if (!parsed.success) {
          safeAck(ack, failure('BAD_PAYLOAD'));
          return;
        }
        const displayName = parsed.data.displayName;
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
          publishTransition(current.room, transition!);
        }
        if (!sessions.rename(session.userToken, displayName)) {
          safeAck(ack, failure('INTERNAL'));
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
      readySocketIds.delete(socket.id);
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
          now: now(),
        });
        if (transition?.accepted) {
          publishTransition(current.room, transition);
        }
      } catch (error) {
        report(error);
      }
    });
  });

  return {
    rooms,
    sessions,
    refreshWaitingRules() {
      const refreshed = rooms.refreshWaitingRules();
      for (const { transition } of refreshed) emitState(transition.state);
      return refreshed.length;
    },
    beginDrain() {
      if (drainPromise) return drainPromise;
      draining = true;
      drainPromise = new Promise<void>((resolve) => {
        resolveDrain = resolve;
      });
      for (const roomId of rooms.roomIds()) {
        const previous = rooms.get(roomId);
        if (previous?.phase !== 'playing') continue;
        const transition = rooms.apply(roomId, {
          type: 'requestDrain',
          now: now(),
        });
        if (transition?.accepted) {
          publishTransition(previous, transition);
        }
      }
      settleDrainIfReady();
      return drainPromise;
    },
    close() {
      clearInterval(sweepTimer);
      phaseTimers.close();
      lifecycleTimers.close();
      if (ownsAi) {
        void ai.close().catch(report);
      }
      for (const socket of activeByUser.values()) {
        socket.disconnect(true);
      }
      activeByUser.clear();
      readySocketIds.clear();
    },
  };
}
