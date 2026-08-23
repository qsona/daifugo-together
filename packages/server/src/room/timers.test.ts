import { describe, expect, it } from 'vitest';
import {
  createBombThrowMiniGame,
  createInProcessRuleChainPort,
  type RuleChainEntry,
} from '@daifugo/core';
import { loadRuleCodeBundles } from '@daifugo/rules';

import { createRoomState, reduceRoom } from './reducer.js';
import { RoomManager } from './manager.js';
import {
  RoomLifecycleTimerCoordinator,
  RoomTimerCoordinator,
  type RoomTimerAuthority,
} from './timers.js';
import type {
  RoomAction,
  RoomReducerOptions,
  RoomState,
  RoomTransition,
} from './types.js';

interface FakeTimer {
  callback: () => void;
  delayMs: number;
  cleared: boolean;
}

function state(): RoomState {
  return createRoomState({
    roomId: 'room-1',
    inviteCode: '01234',
    mode: 'community',
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

function reducingAuthority(
  initial: RoomState,
  options: RoomReducerOptions,
): {
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
        const transition = reduceRoom(current, action, options);
        if (transition.accepted) current = transition.state;
        return transition;
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
  it('切断AI代行の7渡しは接続が揺れるたび期限が延び、100秒超後に自動回答する', async () => {
    const sevenPass = (await loadRuleCodeBundles()).find(
      ({ module }) => module.meta.ruleId === 'r0011-seven-pass',
    );
    expect(sevenPass).toBeDefined();
    if (!sevenPass) return;

    const entry: RuleChainEntry = {
      ruleId: sevenPass.module.meta.ruleId,
      name: sevenPass.module.meta.name,
      position: 0,
      priority: {
        score: 0,
        activatedAt: 0,
        ruleId: sevenPass.module.meta.ruleId,
      },
      bundleHash: sevenPass.bundleHash,
      contractVersion: sevenPass.module.meta.contractVersion,
    };
    const port = createInProcessRuleChainPort([sevenPass.module]);
    const reducerOptions: RoomReducerOptions = {
      random: () => 0.999_999,
      rulePort: port,
    };
    let waiting = state();
    for (let index = 2; index <= 4; index += 1) {
      const joined = reduceRoom(waiting, {
        type: 'join',
        member: {
          memberId: `member-${String(index)}`,
          userId: `user-${String(index)}`,
          displayName: `プレイヤー${String(index)}`,
        },
        now: index,
      });
      expect(joined.accepted).toBe(true);
      waiting = joined.state;
    }
    const started = reduceRoom(
      waiting,
      {
        type: 'start',
        memberId: 'member-1',
        now: 1_000,
        setSeed: 'seven-pass-disconnect-1',
        availableRules: [entry],
      },
      reducerOptions,
    ).state;
    const actorId = started.engine!.currentGame!.public.turn!;
    const seven = started.engine!.currentGame!.players[actorId]!.hand.find(
      (card) => card.kind === 'natural' && card.rank === '7',
    );
    expect(actorId).toBe('member-3');
    expect(seven?.id).toBe('C07');
    if (!seven) return;

    const disconnected = reduceRoom(
      started,
      { type: 'disconnect', memberId: actorId, now: 2_000 },
      reducerOptions,
    ).state;
    expect(
      disconnected.members.find((member) => member.memberId === actorId),
    ).toMatchObject({ connected: false, aiActing: true, controller: 'ai' });
    expect(disconnected.turnDeadlineAt).toBe(7_000);

    let now = 2_000;
    const room = reducingAuthority(disconnected, reducerOptions);
    const timers: FakeTimer[] = [];
    const automaticallySelected: string[][] = [];
    const coordinator = new RoomTimerCoordinator(room.api, {
      now: () => now,
      decideTurn: async (roomState, memberId) => {
        const pending = roomState.engine?.currentGame?.private.pendingChoice;
        if (pending) {
          const cards = [...(pending.optionCardIds ?? [])]
            .sort()
            .slice(0, pending.count ?? 0);
          automaticallySelected.push(cards);
          return cards;
        }
        expect(memberId).toBe(actorId);
        return [seven.id];
      },
      setTimer: (callback, delayMs) => {
        const timer = { callback, delayMs, cleared: false };
        timers.push(timer);
        return timer;
      },
      clearTimer: (handle) => {
        (handle as FakeTimer).cleared = true;
      },
    });

    coordinator.sync(disconnected);
    expect(timers[0]?.delayMs).toBe(5_000);

    now = 7_000;
    timers[0]?.callback();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const awaitingChoice = room.api.get(disconnected.roomId)!;
    expect(awaitingChoice.engine?.currentGame?.public.phase).toBe(
      'awaitingChoice',
    );
    expect(
      awaitingChoice.engine?.currentGame?.private.pendingChoice,
    ).toMatchObject({
      ruleId: 'r0011-seven-pass',
      player: actorId,
      choiceId: 'seven_pass_choice',
      count: 1,
    });
    expect(awaitingChoice.turnDeadlineAt).toBe(12_000);
    expect(timers[1]?.delayMs).toBe(5_000);

    const changeConnection = (type: 'disconnect' | 'reconnect', at: number) => {
      now = at;
      const transition = reduceRoom(
        room.api.get(disconnected.roomId)!,
        { type, memberId: actorId, now },
        reducerOptions,
      );
      expect(transition.accepted).toBe(true);
      room.set(transition.state);
      coordinator.sync(transition.state);
      return transition.state;
    };

    const reconnectedOnce = changeConnection('reconnect', 10_000);
    expect(reconnectedOnce.turnDeadlineAt).toBe(70_000);
    expect(timers[1]?.cleared).toBe(true);
    expect(timers[2]?.delayMs).toBe(60_000);

    const disconnectedAgain = changeConnection('disconnect', 69_000);
    expect(disconnectedAgain.turnDeadlineAt).toBe(74_000);
    expect(timers[2]?.cleared).toBe(true);
    expect(timers[3]?.delayMs).toBe(5_000);

    const reconnectedAgain = changeConnection('reconnect', 72_000);
    expect(reconnectedAgain.turnDeadlineAt).toBe(132_000);
    expect(timers[3]?.cleared).toBe(true);
    expect(timers[4]?.delayMs).toBe(60_000);

    const finallyDisconnected = changeConnection('disconnect', 103_500);
    expect(finallyDisconnected.turnDeadlineAt).toBe(108_500);
    expect(timers[4]?.cleared).toBe(true);
    expect(timers[5]?.delayMs).toBe(5_000);
    expect(108_500 - 7_000).toBe(101_500);

    const targetId = awaitingChoice.members.find(
      (member) => member.seatId === 3,
    )!.memberId;
    const targetHandBefore = awaitingChoice.engine!.currentGame!.players[
      targetId
    ]!.hand.map((card) => card.id);

    now = 108_500;
    timers[5]?.callback();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const advanced = room.api.get(disconnected.roomId)!;
    const passedCard = automaticallySelected[0]?.[0];
    expect(passedCard).toBeDefined();
    expect(advanced.engine?.currentGame?.private.pendingChoice).toBeUndefined();
    expect(advanced.engine?.currentGame?.public.phase).toBe('awaitingPlay');
    expect(advanced.engine?.currentGame?.public.turn).toBe(targetId);
    expect(
      advanced.engine?.currentGame?.players[actorId]?.hand.map(
        (card) => card.id,
      ),
    ).not.toContain(passedCard);
    expect(
      advanced.engine?.currentGame?.players[targetId]?.hand.map(
        (card) => card.id,
      ),
    ).toEqual(expect.arrayContaining([...targetHandBefore, passedCard!]));
    expect(room.actions).toEqual([
      expect.objectContaining({
        type: 'autoAct',
        memberId: actorId,
        cards: ['C07'],
        reason: 'ai',
      }),
      expect.objectContaining({
        type: 'autoAct',
        memberId: actorId,
        cards: [passedCard],
        reason: 'ai',
      }),
    ]);
  });

  it('同時選択では未回答AIを人間待ちでブロックせずautoActする', async () => {
    const basic = createRoomState({
      roomId: 'simultaneous-ai-choice',
      inviteCode: '01005',
      mode: 'basic',
      owner: {
        memberId: 'member-1',
        userId: 'user-1',
        displayName: 'ホスト',
      },
      now: 0,
    });
    const started = reduceRoom(
      basic,
      {
        type: 'start',
        memberId: 'member-1',
        now: 1_000,
        setSeed: 'simultaneous-ai-choice-set',
      },
      { random: () => 0.999_999 },
    ).state;
    const human = started.members.find((member) => !member.isAI)!;
    const ai = started.members.find((member) => member.isAI)!;
    const game = started.engine!.currentGame!;
    const humanCard = game.players[human.memberId]!.hand[0]!;
    const aiCard = game.players[ai.memberId]!.hand[0]!;
    const choices = [
      {
        kind: 'cards' as const,
        ruleId: 'r-simultaneous-fixture',
        player: human.memberId,
        choiceId: 'human-choice',
        messageKey: 'choose',
        optionCardIds: [humanCard.id],
        count: 1,
        simultaneous: true,
      },
      {
        kind: 'cards' as const,
        ruleId: 'r-simultaneous-fixture',
        player: ai.memberId,
        choiceId: 'ai-choice',
        messageKey: 'choose',
        optionCardIds: [aiCard.id],
        count: 1,
        simultaneous: true,
      },
    ];
    const awaiting: RoomState = {
      ...started,
      engine: {
        ...started.engine!,
        currentGame: {
          ...game,
          public: { ...game.public, phase: 'awaitingChoice' },
          private: {
            ...game.private,
            pendingChoice: {
              ...choices[0]!,
              simultaneousChoices: choices,
              submittedChoices: [],
            },
          },
        },
      },
    };
    const room = authority(awaiting);
    const timers: FakeTimer[] = [];
    const decided: string[] = [];
    const coordinator = new RoomTimerCoordinator(room.api, {
      decideTurn: async (_state, memberId) => {
        decided.push(memberId);
        return [aiCard.id];
      },
      aiDelayMinMs: 0,
      aiDelayMaxMs: 0,
      basicAiDelayMinMs: 0,
      basicAiDelayMaxMs: 0,
      setTimer: (callback, delayMs) => {
        const timer = { callback, delayMs, cleared: false };
        timers.push(timer);
        return timer;
      },
    });

    coordinator.sync(awaiting);
    expect(timers[0]?.delayMs).toBe(0);
    timers[0]?.callback();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(decided).toEqual([ai.memberId]);
    expect(room.actions).toEqual([
      {
        type: 'autoAct',
        memberId: ai.memberId,
        turnSeq: awaiting.turnSeq,
        cards: [aiCard.id],
        reason: 'ai',
        now: expect.any(Number),
      },
    ]);
  });

  it('ミニゲーム中は通常手番timerより優先して200msごとに権威tickを送る', () => {
    const started = reduceRoom(
      state(),
      {
        type: 'start',
        memberId: 'member-1',
        now: 1_000,
        setSeed: 'mini-game-timer-set',
      },
      { random: () => 0.999_999 },
    ).state;
    const participantIds = started.members
      .filter((member) => member.seatId !== null)
      .slice(0, 2)
      .map((member) => member.memberId);
    const miniGameState = createBombThrowMiniGame({
      id: 'mini-game-1',
      seed: 'seed',
      participants: participantIds,
    });
    const withMiniGame: RoomState = {
      ...started,
      engine: {
        ...started.engine!,
        currentGame: {
          ...started.engine!.currentGame!,
          public: {
            ...started.engine!.currentGame!.public,
            phase: 'awaitingChoice',
          },
          private: {
            ...started.engine!.currentGame!.private,
            pendingChoice: {
              kind: 'miniGame',
              ruleId: 'r-mini-game',
              player: participantIds[0]!,
              choiceId: 'mini_game',
              messageKey: 'start',
              participants: participantIds,
              miniGame: 'bomb_throw_15',
              durationMs: 12_000,
              seed: 'seed',
              miniGameState,
            },
          },
        },
      },
      turnDeadlineAt: null,
    };
    const room = authority(withMiniGame);
    const timers: FakeTimer[] = [];
    const coordinator = new RoomTimerCoordinator(room.api, {
      now: () => 2_000,
      decideTurn: async () => null,
      setTimer: (callback, delayMs) => {
        const timer = { callback, delayMs, cleared: false };
        timers.push(timer);
        return timer;
      },
    });

    coordinator.sync(withMiniGame);
    expect(timers[0]?.delayMs).toBe(200);
    timers[0]?.callback();
    expect(room.actions).toEqual([
      { type: 'miniGameTick', miniGameId: 'mini-game-1', now: 2_000 },
    ]);
  });

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

  it('きほんの1人AI戦だけAIの間合いを3〜4.5秒にし、他の部屋の既定値は変えない', () => {
    const started = reduceRoom(
      state(),
      {
        type: 'start',
        memberId: 'member-1',
        now: 1_000,
        setSeed: 'timer-mode-set',
      },
      { random: () => 0.999_999 },
    ).state;
    const memberId = started.members.find((member) => member.isAI)!.memberId;
    const automated: RoomState = {
      ...started,
      engine: {
        ...started.engine!,
        currentGame: {
          ...started.engine!.currentGame!,
          public: {
            ...started.engine!.currentGame!.public,
            turn: memberId,
          },
        },
      },
      turnDeadlineAt: null,
    };
    const delays = (roomState: RoomState, random = 0) => {
      const room = authority(roomState);
      const timers: FakeTimer[] = [];
      const coordinator = new RoomTimerCoordinator(room.api, {
        random: () => random,
        decideTurn: async () => ['D03'],
        setTimer: (callback, delayMs) => {
          const timer = { callback, delayMs, cleared: false };
          timers.push(timer);
          return timer;
        },
      });
      coordinator.sync(roomState);
      return timers[0]?.delayMs;
    };

    expect(delays(automated)).toBe(800);
    expect(delays({ ...automated, mode: 'basic' })).toBe(3_000);
    expect(delays({ ...automated, mode: 'basic' }, 1)).toBe(4_500);

    const secondHuman = {
      ...automated.members.find((member) => !member.isAI)!,
      memberId: 'member-2',
      userId: 'user-2',
      seatId: 2 as const,
      isHost: false,
    };
    expect(
      delays({
        ...automated,
        mode: 'basic',
        members: [...automated.members, secondHuman],
      }),
    ).toBe(800);
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

  it('同じ手番中のdisconnect/reconnectで5秒・60秒timerへ張り替える', () => {
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
    expect(timers[1]?.delayMs).toBe(5_000);

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
