import type {
  Card,
  CardRank,
  GameConfig,
  GameState,
  RuleModule,
  RuleRuntime,
  Suit,
} from '@daifugo/core';
import {
  createInProcessRuleChainPort,
  reduceGame,
  seedRng,
} from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { rule as eightCut } from '../r0001-eight-cut/rule.js';
import { rule as sevenPass } from '../r0011-seven-pass/rule.js';
import { rule as luckySeven } from '../r0015-lucky-seven/rule.js';
import { rule as bomberman } from '../r0027-bomberman/rule.js';

const seats = ['p1', 'p2', 'p3', 'p4'];
const modules: RuleModule[] = [eightCut, sevenPass, luckySeven, bomberman];

function natural(suit: Suit, rank: CardRank, id: string): Card {
  return { kind: 'natural', suit, rank, id };
}

function fixture(remainingCards: number): {
  config: GameConfig;
  state: GameState;
  runtime: RuleRuntime;
} {
  const sequence = [
    natural('spade', '6', 'S-6'),
    natural('spade', '7', 'S-7'),
    natural('spade', '8', 'S-8'),
    natural('spade', '9', 'S-9'),
  ];
  const remainder = [
    natural('heart', '3', 'H-3'),
    natural('heart', '4', 'H-4'),
    natural('heart', '5', 'H-5'),
    natural('heart', '6', 'H-6'),
    natural('heart', '7', 'H-7'),
  ].slice(0, remainingCards);
  const config: GameConfig = {
    gameIndex: 0,
    seats,
    gameSeed: 'rule-interaction',
    ruleChain: modules.map((module, position) => ({
      ruleId: module.meta.ruleId,
      name: module.meta.name,
      position,
      priority: {
        score: 1 - position / 10,
        activatedAt: position,
        ruleId: module.meta.ruleId,
      },
      bundleHash: `interaction-${module.meta.ruleId}`,
      contractVersion: module.meta.contractVersion,
      ...(module.meta.engineFeatures
        ? { engineFeatures: module.meta.engineFeatures }
        : {}),
    })),
  };
  return {
    config,
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
        rng: seedRng('rule-interaction'),
        hookCalls: {},
      },
      players: {
        p1: {
          id: 'p1',
          hand: [...sequence, ...remainder],
          status: 'active',
          skipCount: 0,
        },
        p2: {
          id: 'p2',
          hand: [natural('club', '3', 'C-3')],
          status: 'active',
          skipCount: 0,
        },
        p3: {
          id: 'p3',
          hand: [natural('club', '4', 'C-4')],
          status: 'active',
          skipCount: 0,
        },
        p4: {
          id: 'p4',
          hand: [natural('club', '5', 'C-5')],
          status: 'active',
          skipCount: 0,
        },
      },
    },
    runtime: {
      port: createInProcessRuleChainPort(modules),
      setHistory: [],
      setMemory: {},
    },
  };
}

describe('ルール間の追加入力', () => {
  it.each([
    { afterSequence: 4, afterSevenPass: 3 },
    { afterSequence: 5, afterSevenPass: 4 },
  ])(
    '6789後に$afterSequence枚なら7渡し後の$afterSevenPass枚からボンバーマンで1枚を選ぶ',
    ({ afterSequence, afterSevenPass }) => {
      const { config, state, runtime } = fixture(afterSequence);
      let transition = reduceGame(
        config,
        state,
        {
          type: 'play',
          player: 'p1',
          cards: ['S-6', 'S-7', 'S-8', 'S-9'],
        },
        runtime,
      );
      expect(transition.state.private.pendingChoice).toMatchObject({
        ruleId: sevenPass.meta.ruleId,
        count: 1,
      });

      transition = reduceGame(
        config,
        transition.state,
        {
          type: 'ruleInput',
          player: 'p1',
          choiceId: 'seven_pass_choice',
          cardIds: ['H-3'],
        },
        runtime,
      );

      expect(transition.rejections).toEqual([]);
      expect(transition.state.players.p1?.hand).toHaveLength(afterSevenPass);
      expect(transition.state.private.ruleNotices).toContainEqual({
        id: 1,
        ruleId: sevenPass.meta.ruleId,
        messageKey: 'seven_pass_received',
        params: { cards: '♥3' },
        players: ['p2'],
      });
      expect(transition.state.private.pendingChoice).toMatchObject({
        ruleId: bomberman.meta.ruleId,
        choiceId: 'bomberman_discard',
        count: 1,
      });
    },
  );

  it('7を3枚出すと7渡しで3枚渡した後にラッキー7で残る1枚を捨てる', () => {
    const { config, state, runtime } = fixture(4);
    const sevens = [
      natural('spade', '7', 'S-7'),
      natural('heart', '7', 'H-7'),
      natural('diamond', '7', 'D-7'),
    ];
    state.players.p1!.hand = [
      ...sevens,
      natural('club', '3', 'C-3'),
      natural('club', '4', 'C-4'),
      natural('club', '5', 'C-5'),
      natural('club', '6', 'C-6'),
    ];

    let transition = reduceGame(
      config,
      state,
      { type: 'play', player: 'p1', cards: sevens.map(({ id }) => id) },
      runtime,
    );
    expect(transition.state.private.pendingChoice).toMatchObject({
      ruleId: sevenPass.meta.ruleId,
      count: 3,
    });

    transition = reduceGame(
      config,
      transition.state,
      {
        type: 'ruleInput',
        player: 'p1',
        choiceId: 'seven_pass_choice',
        cardIds: ['C-3', 'C-4', 'C-5'],
      },
      runtime,
    );
    expect(transition.state.players.p1?.hand.map(({ id }) => id)).toEqual([
      'C-6',
    ]);
    expect(transition.state.private.pendingChoice).toMatchObject({
      ruleId: luckySeven.meta.ruleId,
      choiceId: 'lucky_seven_choice',
      count: 1,
    });

    transition = reduceGame(
      config,
      transition.state,
      {
        type: 'ruleInput',
        player: 'p1',
        choiceId: 'lucky_seven_choice',
        cardIds: ['C-6'],
      },
      runtime,
    );
    expect(transition.rejections).toEqual([]);
    expect(transition.state.players.p1?.hand).toEqual([]);
    expect(transition.state.public.discard.map(({ id }) => id)).toContain(
      'C-6',
    );
  });

  it('7渡しで残り手札が尽きたらラッキー7の選択を要求しない', () => {
    const { config, state, runtime } = fixture(3);
    const sevens = [
      natural('spade', '7', 'S-7'),
      natural('heart', '7', 'H-7'),
      natural('diamond', '7', 'D-7'),
    ];
    state.players.p1!.hand = [
      ...sevens,
      natural('club', '3', 'C-3'),
      natural('club', '4', 'C-4'),
      natural('club', '5', 'C-5'),
    ];

    let transition = reduceGame(
      config,
      state,
      { type: 'play', player: 'p1', cards: sevens.map(({ id }) => id) },
      runtime,
    );
    transition = reduceGame(
      config,
      transition.state,
      {
        type: 'ruleInput',
        player: 'p1',
        choiceId: 'seven_pass_choice',
        cardIds: ['C-3', 'C-4', 'C-5'],
      },
      runtime,
    );

    expect(transition.rejections).toEqual([]);
    expect(transition.state.players.p1?.hand).toEqual([]);
    expect(transition.state.private.pendingChoice).toBeUndefined();
  });
});
