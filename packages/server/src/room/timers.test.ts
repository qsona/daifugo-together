import { describe, expect, it } from 'vitest';

import { createRoomState, reduceRoom } from './reducer.js';
import { RoomTimerCoordinator, type RoomTimerAuthority } from './timers.js';
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
});
