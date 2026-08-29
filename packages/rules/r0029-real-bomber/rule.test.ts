import type {
  Card,
  GameConfig,
  GameState,
  Play,
  RuleContext,
  RuleRuntime,
} from '@daifugo/core';
import {
  BASE_STRENGTH_ORDER,
  BOMB_THROW_COUNTDOWN_MS,
  BOMB_THROW_PLAY_MS,
  BOMB_THROW_RESULT_MS,
  BOMB_THROW_TICK_MS,
  createInProcessRuleChainPort,
  reduceGame,
  seedRng,
} from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { rule } from './rule.js';

const four: Card = {
  kind: 'natural',
  id: 'S04',
  suit: 'spade',
  rank: '4',
};
const trigger: Play = { kind: 'single', cards: [four], count: 1, repRank: '4' };

function context(
  hands: Record<string, Card[]> = {},
  setMemory: Record<string, unknown> = {},
): RuleContext {
  return {
    contractVersion: 2,
    game: {
      gameIndex: 0,
      ruleIds: [rule.meta.ruleId],
      seats: ['p1', 'p2', 'p3', 'p4'],
      direction: 1,
      turn: 'p2',
      players: ['p1', 'p2', 'p3', 'p4'].map((id) => ({
        id,
        hand: hands[id] ?? [
          { kind: 'natural', id: `${id}-5`, suit: 'heart', rank: '5' },
        ],
        status: 'active' as const,
        standing: null,
      })),
      field: { current: { play: trigger, by: 'p1' }, passedSinceLastPlay: [] },
      discard: [],
      history: [],
      strength: BASE_STRENGTH_ORDER,
    },
    setHistory: [],
    memory: { game: {}, set: setMemory },
    rng: { next: () => 0.5, int: () => 42 },
  } as RuleContext;
}

function natural(id: string, rank: '4' | '5' | '6' | '7'): Card {
  const suit = {
    S: 'spade',
    H: 'heart',
    C: 'club',
    D: 'diamond',
  }[id[0]!];
  if (!suit) throw new Error(`Unknown suit: ${id}`);
  return { kind: 'natural', id, suit, rank } as Card;
}

function engineFixture(
  participantCount = 4,
  gameIndex = 0,
  triggerRank: '4' | '5' = '4',
): { config: GameConfig; state: GameState; runtime: RuleRuntime } {
  const seats = ['p1', 'p2', 'p3', 'p4'];
  const hands: Record<string, Card[]> = {
    p1: [natural(`S0${triggerRank}`, triggerRank), natural('H05', '5')],
    p2: [natural('H04', '4'), natural('C06', '6')],
    p3: [natural('C04', '4'), natural('D06', '6')],
    p4: [natural('D04', '4'), natural('S07', '7')],
  };
  for (let index = participantCount; index < seats.length; index += 1) {
    hands[seats[index]!] = [];
  }
  return {
    config: {
      gameIndex,
      seats,
      gameSeed: `real-bomber-${String(gameIndex)}-${String(participantCount)}`,
      ruleChain: [
        {
          ruleId: rule.meta.ruleId,
          name: rule.meta.name,
          position: 0,
          priority: {
            score: 0,
            activatedAt: 0,
            ruleId: rule.meta.ruleId,
          },
          bundleHash: 'real-bomber-test',
          contractVersion: rule.meta.contractVersion,
        },
      ],
    },
    state: {
      public: {
        phase: 'awaitingPlay',
        direction: 1,
        turn: 'p1',
        field: { passedSinceLastPlay: [] },
        discard: [],
        standingsTaken: [],
        history: [],
        firedRules: [],
        turnCount: 0,
      },
      private: {
        excluded: [],
        memory: {},
        rng: seedRng('real-bomber-test'),
        hookCalls: {},
      },
      players: Object.fromEntries(
        seats.map((id) => [
          id,
          { id, hand: hands[id]!, status: 'active' as const, skipCount: 0 },
        ]),
      ),
    },
    runtime: {
      port: createInProcessRuleChainPort([rule]),
      setHistory: [],
      setMemory: {},
    },
  };
}

function completeRealBomber(participantCount = 4) {
  const { config, state, runtime } = engineFixture(participantCount);
  let transition = reduceGame(
    config,
    state,
    { type: 'play', player: 'p1', cards: ['S04'] },
    runtime,
  );
  if (participantCount > 1) {
    expect(transition.state.private.pendingChoice).toMatchObject({
      kind: 'miniGame',
      choiceId: 'real_bomber_bomb_throw',
    });
    const ticksUntilComplete =
      (BOMB_THROW_COUNTDOWN_MS + BOMB_THROW_PLAY_MS + BOMB_THROW_RESULT_MS) /
      BOMB_THROW_TICK_MS;
    for (let index = 0; index < ticksUntilComplete; index += 1) {
      const miniGame = transition.state.private.pendingChoice?.miniGameState;
      expect(miniGame).toBeDefined();
      transition = reduceGame(
        config,
        transition.state,
        {
          type: 'miniGameTick',
          player: 'p1',
          miniGameId: miniGame!.id,
          automatedPlayerIds: ['p1', 'p2', 'p3', 'p4'].slice(
            0,
            participantCount,
          ),
        },
        { ...runtime, setMemory: transition.setMemory ?? {} },
      );
      expect(transition.rejections).toEqual([]);
    }
  }

  const pending = transition.state.private.pendingChoice;
  expect(pending).toMatchObject({
    kind: 'cards',
    choiceId: expect.stringMatching(/^real_bomber_discard_s[0-3]$/u),
  });
  if (!pending || pending.kind !== 'cards') {
    throw new Error('Real bomber did not reach the winner card choice');
  }
  const { optionCardIds, count } = pending;
  if (!optionCardIds || count === undefined) {
    throw new Error('Real bomber card choice is incomplete');
  }
  const selected = optionCardIds.slice(0, count);
  expect(selected).toHaveLength(count);
  return reduceGame(
    config,
    transition.state,
    {
      type: 'ruleInput',
      player: pending.player,
      choiceId: pending.choiceId,
      cardIds: selected,
    },
    { ...runtime, setMemory: transition.setMemory ?? {} },
  );
}

describe('リアルボンバー', () => {
  it('自然な4のsingleで独立ミニゲームを要求する', () => {
    expect(rule.hooks.afterPlay?.(context(), trigger)).toEqual([
      {
        type: 'requestChoice',
        kind: 'miniGame',
        player: 'p1',
        choiceId: 'real_bomber_bomb_throw',
        miniGame: 'bomb_throw_15',
        participants: ['p1', 'p2', 'p3', 'p4'],
        durationMs: 12_000,
        seed: '16',
        messageKey: 'real_bomber_start',
      },
    ]);
  });

  it('set、別ランク、ジョーカーでは発動しない', () => {
    const other: Play = {
      kind: 'single',
      cards: [{ kind: 'natural', id: 'S05', suit: 'spade', rank: '5' }],
      count: 1,
      repRank: '5',
    };
    const set: Play = {
      kind: 'set',
      cards: [four, { ...four, id: 'H04', suit: 'heart' }],
      count: 2,
      repRank: '4',
    };
    const joker: Play = {
      kind: 'single',
      cards: [{ kind: 'joker', id: 'JK0', index: 0 }],
      count: 1,
      repRank: 'joker',
    };
    expect(rule.hooks.afterPlay?.(context(), other)).toEqual([]);
    expect(rule.hooks.afterPlay?.(context(), set)).toEqual([]);
    expect(rule.hooks.afterPlay?.(context(), joker)).toEqual([]);
  });

  it('ミニゲームの勝者IDだけを受け、勝者に最大2枚を選ばせる', () => {
    const effects = rule.hooks.afterPlay?.(
      context({
        p3: [
          { kind: 'natural', id: 'C06', suit: 'club', rank: '6' },
          { kind: 'natural', id: 'D07', suit: 'diamond', rank: '7' },
          { kind: 'natural', id: 'S08', suit: 'spade', rank: '8' },
        ],
      }),
      trigger,
      {
        kind: 'miniGameResult',
        choiceId: 'real_bomber_bomb_throw',
        miniGameId: 'runtime-owned',
        winnerPlayerId: 'p3',
        scores: { p3: { score: 2, hitsTaken: 0 } },
      },
    );
    expect(effects).toEqual([
      {
        type: 'requestChoice',
        player: 'p3',
        choiceId: 'real_bomber_discard_s2',
        from: { kind: 'hand', player: 'p3' },
        cards: { kind: 'all' },
        count: 2,
        messageKey: 'real_bomber_discard',
      },
    ]);
  });

  it('選んだカードを捨て、勝者を通知する', () => {
    expect(
      rule.hooks.afterPlay?.(context(), trigger, {
        kind: 'cards',
        choiceId: 'real_bomber_discard_s1',
        cardIds: ['p2-5'],
      }),
    ).toEqual([
      {
        type: 'moveCards',
        from: { kind: 'hand', player: 'p2' },
        to: { kind: 'discard' },
        cards: { kind: 'specific', cardIds: ['p2-5'] },
      },
      {
        type: 'announce',
        messageKey: 'real_bomber_result',
        params: { winner: 'プレイヤー2' },
      },
      {
        type: 'setMemory',
        scope: 'set',
        key: 'fired',
        value: true,
        silent: true,
      },
    ]);
  });

  it('同じsetで発動済みなら同じゲームでも後続ゲームでも発動しない', () => {
    expect(
      rule.hooks.afterPlay?.(context({}, { fired: true }), trigger),
    ).toEqual([]);
    expect(
      rule.hooks.afterPlay?.(
        {
          ...context({}, { fired: true }),
          game: { ...context().game, gameIndex: 2 },
        },
        trigger,
      ),
    ).toEqual([]);
  });

  it('新しい空のsetメモリでは再び1回発動できる', () => {
    expect(rule.hooks.afterPlay?.(context({}, {}), trigger)).toMatchObject([
      { type: 'requestChoice', kind: 'miniGame' },
    ]);
  });

  it.each([4, 1])(
    '%i人参加の完了経路で発動済みsetメモリを保存する',
    (participantCount) => {
      const completed = completeRealBomber(participantCount);
      expect(completed.rejections).toEqual([]);
      expect(completed.state.private.pendingChoice).toBeUndefined();
      expect(completed.setMemory).toEqual({
        [rule.meta.ruleId]: { fired: true },
      });
      expect(completed.state.public.discard.length).toBeGreaterThan(0);
    },
  );

  it('エンジン遷移後の同じゲームと後続ゲームでは抑止し、新しいsetでは再発動する', () => {
    const completed = completeRealBomber();
    const firedMemory = completed.setMemory ?? {};

    for (const gameIndex of [0, 1]) {
      const fixture = engineFixture(4, gameIndex);
      const suppressed = reduceGame(
        fixture.config,
        fixture.state,
        { type: 'play', player: 'p1', cards: ['S04'] },
        { ...fixture.runtime, setMemory: firedMemory },
      );
      expect(suppressed.rejections).toEqual([]);
      expect(suppressed.state.private.pendingChoice).toBeUndefined();
      expect(suppressed.setMemory).toEqual(firedMemory);
    }

    const nextSet = engineFixture();
    const refired = reduceGame(
      nextSet.config,
      nextSet.state,
      { type: 'play', player: 'p1', cards: ['S04'] },
      nextSet.runtime,
    );
    expect(refired.state.private.pendingChoice).toMatchObject({
      kind: 'miniGame',
      choiceId: 'real_bomber_bomb_throw',
    });
  });

  it('条件外プレイはsetの発動回数を消費しない', () => {
    const outside = engineFixture(4, 0, '5');
    const ignored = reduceGame(
      outside.config,
      outside.state,
      { type: 'play', player: 'p1', cards: ['S05'] },
      outside.runtime,
    );
    expect(ignored.rejections).toEqual([]);
    expect(ignored.setMemory).toEqual({});

    const triggerFixture = engineFixture();
    const triggered = reduceGame(
      triggerFixture.config,
      triggerFixture.state,
      { type: 'play', player: 'p1', cards: ['S04'] },
      { ...triggerFixture.runtime, setMemory: ignored.setMemory ?? {} },
    );
    expect(triggered.state.private.pendingChoice).toMatchObject({
      kind: 'miniGame',
    });
  });
});
