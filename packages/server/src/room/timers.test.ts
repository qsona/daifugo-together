import { describe, expect, it } from 'vitest';

import { createRoomState, reduceRoom } from './reducer.js';
import { RoomManager } from './manager.js';
import {
  RoomLifecycleTimerCoordinator,
  RoomTimerCoordinator,
  type RoomTimerAuthority,
} from './timers.js';
import type { RoomAction, RoomState, RoomTransition } from './types.js';

interface FakeTimer {
  callback: () => void;
  delayMs: number;
  cleared: boolean;
}

function state(): RoomState {
  return createRoomState({
    roomId: 'room-1',
    inviteCode: 'ABCD-2345',
    owner: {
      memberId: 'member-1',
      userId: 'user-1',
      displayName: 'ホスト',
    },
    now: 0,
  });
}

function accepted(next: RoomState): RoomTransition {
  return { state: next, events: [], accepted: true };
}

function authority(initial: RoomState): {
  api: RoomTimerAuthority;
  actions: RoomAction[];
  set(next: RoomState): void;
} {
  let current: RoomState | undefined = initial;
  const actions: RoomAction[] = [];
  return {
    api: {
      get: () => current,
      apply: (_roomId, action) => {
        actions.push(action);
        if (!current) return undefined;
        if (action.type === 'advanceIntermission') {
          current = { ...current, phase: 'playing', engine: null };
        } else if (action.type === 'expireSetResult') {
          current = { ...current, phase: 'closed', members: [] };
        } else {
          current = {
            ...current,
            turnSeq: current.turnSeq + 1,
            engine: null,
          };
        }
        return accepted(current);
      },
    },
    actions,
    set(next) {
      current = next;
    },
  };
}

function setResult(base: RoomState, respondBy: number): RoomState {
  return {
    ...base,
    phase: 'setResult',
    setRespondBy: respondBy,
  };
}

describe('RoomTimerCoordinator', () => {
  it('ゲーム間リザルトをサーバー確定時刻まで待ち、再syncで15秒へ戻さない', () => {
    const started = reduceRoom(
      state(),
      {
        type: 'start',
        memberId: 'member-1',
        now: 1_000,
        setSeed: 'intermission-timer-set',
      },
      { random: () => 0.999_999 },
    ).state;
    const intermission: RoomState = {
      ...started,
      engine: {
        ...started.engine!,
        phase: { name: 'interimResult', gameIndex: 0 },
      },
      intermissionEndsAt: 16_000,
      turnDeadlineAt: null,
    };
    const room = authority(intermission);
    const timers: FakeTimer[] = [];
    let now = 5_000;
    const coordinator = new RoomTimerCoordinator(room.api, {
      now: () => now,
      setTimer: (callback, delayMs) => {
        const timer = { callback, delayMs, cleared: false };
        timers.push(timer);
        return timer;
      },
    });

    coordinator.sync(intermission);
    expect(timers[0]?.delayMs).toBe(11_000);
    now = 9_000;
    coordinator.sync(intermission);
    expect(timers).toHaveLength(1);

    now = 16_000;
    timers[0]?.callback();
    expect(room.actions).toEqual([
      { type: 'advanceIntermission', now: 16_000 },
    ]);
  });

  it('同じsetResultへ再syncしても期限を延長せず、1回だけexpireする', () => {
    const timers: FakeTimer[] = [];
    const transitions: RoomTransition[] = [];
    const room = authority(setResult(state(), 1_500));
    let now = 1_000;
    const coordinator = new RoomTimerCoordinator(room.api, {
      now: () => now,
      createSetSeed: () => 'next-seed',
      setTimer: (callback, delayMs) => {
        const timer = { callback, delayMs, cleared: false };
        timers.push(timer);
        return timer;
      },
      clearTimer: (handle) => {
        (handle as FakeTimer).cleared = true;
      },
      onTransition: (_previous, transition) => transitions.push(transition),
    });

    coordinator.sync(room.api.get('room-1')!);
    now = 1_200;
    coordinator.sync(room.api.get('room-1')!);
    expect(timers).toHaveLength(1);
    expect(timers[0]?.delayMs).toBe(500);

    now = 1_500;
    timers[0]?.callback();
    timers[0]?.callback();
    expect(room.actions).toEqual([
      {
        type: 'expireSetResult',
        now: 1_500,
        setSeed: 'next-seed',
      },
    ]);
    expect(transitions).toHaveLength(1);
    expect(coordinator.size).toBe(0);
  });

  it('状態fingerprintが変わると旧timerを解除し、古いcallbackをno-opにする', () => {
    const timers: FakeTimer[] = [];
    const base = state();
    const room = authority(setResult(base, 2_000));
    const coordinator = new RoomTimerCoordinator(room.api, {
      now: () => 1_000,
      setTimer: (callback, delayMs) => {
        const timer = { callback, delayMs, cleared: false };
        timers.push(timer);
        return timer;
      },
      clearTimer: (handle) => {
        (handle as FakeTimer).cleared = true;
      },
    });
    coordinator.sync(room.api.get('room-1')!);
    const replacement = setResult(base, 3_000);
    room.set(replacement);
    coordinator.sync(replacement);

    expect(timers).toHaveLength(2);
    expect(timers[0]?.cleared).toBe(true);
    timers[0]?.callback();
    expect(room.actions).toEqual([]);
    coordinator.close();
    expect(timers[1]?.cleared).toBe(true);
    expect(coordinator.size).toBe(0);
  });

  it('AI手番を0.8秒以上遅延し、決定後も同じturnSeqなら1回だけ適用する', async () => {
    const started = reduceRoom(
      state(),
      {
        type: 'start',
        memberId: 'member-1',
        now: 1_000,
        setSeed: 'timer-ai-set',
      },
      { random: () => 0.999_999 },
    ).state;
    const memberId = started.engine!.currentGame!.public.turn!;
    const automated: RoomState = {
      ...started,
      members: started.members.map((member) =>
        member.memberId === memberId
          ? {
              ...member,
              isAI: true,
              userId: null,
              controller: 'ai',
            }
          : member,
      ),
      turnDeadlineAt: null,
    };
    const room = authority(automated);
    const timers: FakeTimer[] = [];
    let transitioned!: () => void;
    const transitionDone = new Promise<void>((resolve) => {
      transitioned = resolve;
    });
    const coordinator = new RoomTimerCoordinator(room.api, {
      now: () => 2_000,
      random: () => 0,
      decideTurn: async () => ['D03'],
      setTimer: (callback, delayMs) => {
        const timer = { callback, delayMs, cleared: false };
        timers.push(timer);
        return timer;
      },
      onTransition: () => transitioned(),
    });

    coordinator.sync(automated);
    expect(timers[0]?.delayMs).toBe(800);
    timers[0]?.callback();
    await transitionDone;
    expect(room.actions).toEqual([
      {
        type: 'autoAct',
        memberId,
        turnSeq: automated.turnSeq,
        cards: ['D03'],
        reason: 'ai',
        now: 2_000,
      },
    ]);
  });

  it('AI決定中に本人操作でturnSeqが進んだら、古い決定を破棄する', async () => {
    const started = reduceRoom(
      state(),
      {
        type: 'start',
        memberId: 'member-1',
        now: 1_000,
        setSeed: 'stale-ai-set',
      },
      { random: () => 0.999_999 },
    ).state;
    const memberId = started.engine!.currentGame!.public.turn!;
    const automated: RoomState = {
      ...started,
      members: started.members.map((member) =>
        member.memberId === memberId
          ? { ...member, isAI: true, userId: null, controller: 'ai' }
          : member,
      ),
      turnDeadlineAt: null,
    };
    const room = authority(automated);
    const timers: FakeTimer[] = [];
    let resolveDecision!: (cards: string[]) => void;
    const decision = new Promise<string[]>((resolve) => {
      resolveDecision = resolve;
    });
    let markStarted!: () => void;
    const decisionStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const coordinator = new RoomTimerCoordinator(room.api, {
      decideTurn: async () => {
        markStarted();
        return decision;
      },
      aiDelayMinMs: 0,
      aiDelayMaxMs: 0,
      setTimer: (callback, delayMs) => {
        const timer = { callback, delayMs, cleared: false };
        timers.push(timer);
        return timer;
      },
    });

    coordinator.sync(automated);
    timers[0]?.callback();
    await decisionStarted;
    room.set({ ...automated, turnSeq: automated.turnSeq + 1 });
    resolveDecision(['D03']);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(room.actions).toEqual([]);
  });

  it('同じ手番中のdisconnect/reconnectで15秒・60秒timerへ張り替える', () => {
    const started = reduceRoom(
      state(),
      {
        type: 'start',
        memberId: 'member-1',
        now: 1_000,
        setSeed: 'connection-timer-set',
      },
      { random: () => 0.999_999 },
    ).state;
    const memberId = started.engine!.currentGame!.public.turn!;
    const connected: RoomState = {
      ...started,
      members: started.members.map((member) =>
        member.memberId === memberId
          ? {
              ...member,
              isAI: false,
              userId: 'timer-user',
              connected: true,
              controller: 'human',
              departed: false,
              disconnectedAt: null,
              waitingDisconnectExpiresAt: null,
            }
          : member,
      ),
      turnDeadlineAt: 61_000,
    };
    const room = authority(connected);
    const timers: FakeTimer[] = [];
    let now = 2_000;
    const coordinator = new RoomTimerCoordinator(room.api, {
      now: () => now,
      decideTurn: async () => null,
      setTimer: (callback, delayMs) => {
        const timer = { callback, delayMs, cleared: false };
        timers.push(timer);
        return timer;
      },
      clearTimer: (handle) => {
        (handle as FakeTimer).cleared = true;
      },
    });
    coordinator.sync(connected);
    expect(timers[0]?.delayMs).toBe(59_000);

    const disconnected = reduceRoom(connected, {
      type: 'disconnect',
      memberId,
      now,
    }).state;
    room.set(disconnected);
    coordinator.sync(disconnected);
    expect(timers[0]?.cleared).toBe(true);
    expect(timers[1]?.delayMs).toBe(15_000);

    now = 3_000;
    const reconnected = reduceRoom(disconnected, {
      type: 'reconnect',
      memberId,
      now,
    }).state;
    room.set(reconnected);
    coordinator.sync(reconnected);
    expect(timers[1]?.cleared).toBe(true);
    expect(timers[2]?.delayMs).toBe(60_000);
  });

  it('waiting切断猶予をlobby TTLより先に発火する', () => {
    const base = state();
    const waiting: RoomState = {
      ...base,
      members: base.members.map((member) => ({
        ...member,
        connected: false,
        disconnectedAt: 1_000,
        waitingDisconnectExpiresAt: 61_000,
      })),
    };
    const room = authority(waiting);
    const timers: FakeTimer[] = [];
    let now = 1_000;
    const coordinator = new RoomLifecycleTimerCoordinator(room.api, {
      now: () => now,
      createSetSeed: () => 'lifecycle-seed',
      setTimer: (callback, delayMs) => {
        const timer = { callback, delayMs, cleared: false };
        timers.push(timer);
        return timer;
      },
    });

    coordinator.sync(waiting);
    expect(timers[0]?.delayMs).toBe(60_000);
    now = 61_000;
    timers[0]?.callback();
    expect(room.actions[0]).toEqual({
      type: 'expireWaitingMember',
      memberId: 'member-1',
      expectedAt: 61_000,
      now: 61_000,
      setSeed: 'lifecycle-seed',
    });
  });

  it('lobby TTLとabandonで破棄した部屋のtimer・room・indexを残さない', () => {
    for (const scenario of ['lobbyExpired', 'abandoned'] as const) {
      let now = 0;
      let roomSequence = 0;
      const manager = new RoomManager({
        now: () => now,
        createRoomId: () => `${scenario}-room-${++roomSequence}`,
        createMemberId: () => `${scenario}-member-${++roomSequence}`,
        randomIndex: () => 0,
        reducer: {
          lobbyTtlMs: 100,
          abandonTimeoutMs: 100,
          random: () => 0.999_999,
        },
      });
      const created = manager.create({
        userId: `${scenario}-user`,
        displayName: 'ホスト',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) continue;
      const roomId = created.value.room.roomId;
      const inviteCode = created.value.room.inviteCode;
      if (scenario === 'abandoned') {
        now = 10;
        expect(
          manager.apply(roomId, {
            type: 'start',
            memberId: created.value.member.memberId,
            now,
            setSeed: 'abandon-set',
          })?.accepted,
        ).toBe(true);
        now = 20;
        expect(
          manager.apply(roomId, {
            type: 'disconnect',
            memberId: created.value.member.memberId,
            now,
          })?.accepted,
        ).toBe(true);
      }

      const timers: FakeTimer[] = [];
      const coordinator = new RoomLifecycleTimerCoordinator(manager, {
        now: () => now,
        setTimer: (callback, delayMs) => {
          const timer = { callback, delayMs, cleared: false };
          timers.push(timer);
          return timer;
        },
        clearTimer: (handle) => {
          (handle as FakeTimer).cleared = true;
        },
      });
      coordinator.sync(manager.get(roomId)!);
      expect(coordinator.size).toBe(1);
      now = scenario === 'lobbyExpired' ? 100 : 120;
      timers[0]!.callback();

      expect(coordinator.size).toBe(0);
      expect(manager.size).toBe(0);
      expect(manager.findByUser(`${scenario}-user`)).toBeUndefined();
      expect(
        manager.join(inviteCode, {
          userId: `${scenario}-other`,
          displayName: '参加者',
        }),
      ).toEqual({ ok: false, code: 'ROOM_NOT_FOUND' });
      timers[0]!.callback();
      expect(manager.size).toBe(0);
    }
  });
});
