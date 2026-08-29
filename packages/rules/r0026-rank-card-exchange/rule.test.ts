import {
  BASE_STRENGTH_ORDER,
  createInProcessRuleChainPort,
  reduceGame,
  startGame,
  type Card,
  type CardRank,
  type RuleChainEntry,
  type RuleContext,
  type RuleModule,
  type RuleRuntime,
  type Standings,
} from '@daifugo/core';
import { describe, expect, it, vi } from 'vitest';

const { rule } = (await vi.importActual('./rule.js')) as { rule: RuleModule };

const natural = (id: string, rank: CardRank): Card => ({
  kind: 'natural',
  id,
  suit: id.startsWith('D')
    ? 'diamond'
    : id.startsWith('H')
      ? 'heart'
      : id.startsWith('C')
        ? 'club'
        : 'spade',
  rank,
});

const joker = (id: 'JK0' | 'JK1', index: 0 | 1): Card => ({
  kind: 'joker',
  id,
  index,
});

function context(
  input: {
    winner?: string;
    loser?: string;
    winnerHand?: Card[];
    loserHand?: Card[];
    revolution?: boolean;
  } = {},
): RuleContext {
  return {
    contractVersion: 2,
    game: {
      gameIndex: 1,
      ruleIds: [rule.meta.ruleId],
      seats: ['p1', 'p2', 'p3', 'p4'],
      direction: 1,
      turn: 'p2',
      players: [
        {
          id: 'p1',
          hand: input.winnerHand ?? [natural('S03', '3')],
          status: 'active',
          standing: null,
        },
        {
          id: 'p2',
          hand: [natural('S04', '4')],
          status: 'active',
          standing: null,
        },
        {
          id: 'p3',
          hand: [natural('S05', '5')],
          status: 'active',
          standing: null,
        },
        {
          id: 'p4',
          hand: input.loserHand ?? [natural('S02', '2')],
          status: 'active',
          standing: null,
        },
      ],
      field: { passedSinceLastPlay: [] },
      discard: [],
      history: [],
      strength: {
        ...BASE_STRENGTH_ORDER,
        revolution: input.revolution ?? false,
      },
    },
    setHistory: [],
    memory: {
      game: {},
      set: {
        ...(input.winner ? { previousWinner: input.winner } : {}),
        ...(input.loser ? { previousLoser: input.loser } : {}),
      },
    },
    rng: { next: () => 0.5, int: () => 0 },
  } as RuleContext;
}

const standings: Standings = {
  standings: [
    { player: 'p2', standing: 2, title: '富豪' },
    { player: 'p4', standing: 4, title: '大貧民' },
    { player: 'p1', standing: 1, title: '大富豪' },
    { player: 'p3', standing: 3, title: '貧民' },
  ],
};

const entry: RuleChainEntry = {
  ruleId: rule.meta.ruleId,
  name: rule.meta.name,
  position: 0,
  priority: { score: 0, activatedAt: 0, ruleId: rule.meta.ruleId },
  bundleHash: 'rank-card-exchange-test',
  contractVersion: 2,
};

describe('カード交換', () => {
  it('meta.jsonと同じメタデータを公開する', () => {
    expect(rule.meta).toEqual({
      ruleId: 'r0026-rank-card-exchange',
      name: 'カード交換',
      description:
        '2ゲーム目以降の開始時、前ゲームの大富豪は自分の配られた手札から1枚を先に選び、そのカードと前ゲームの大貧民が持つ自然な強さ順で最も強い1枚を同時に交換する。',
      kind: 'local',
      proposalId: '01KZ1KGGYDTKDM9AN9W4NQ3YNS',
      contractVersion: 2,
      messages: {
        exchange_card_choice: '大貧民に渡すカードを1枚選んでください',
      },
    });
  });

  it('初回ゲームでは交換を行わない', () => {
    expect(rule.hooks.onGameStart?.(context())).toEqual([]);
  });

  it('ゲーム終了時に1位と最下位をset memoryへ記録する', () => {
    expect(rule.hooks.onGameEnd?.(context(), standings)).toEqual([
      {
        type: 'setMemory',
        scope: 'set',
        key: 'previousWinner',
        value: 'p1',
        silent: true,
      },
      {
        type: 'setMemory',
        scope: 'set',
        key: 'previousLoser',
        value: 'p4',
        silent: true,
      },
    ]);
  });

  it('前ゲームの1位に配札後の手札から1枚を選ばせる', () => {
    expect(
      rule.hooks.onGameStart?.(context({ winner: 'p1', loser: 'p4' })),
    ).toEqual([
      {
        type: 'requestChoice',
        player: 'p1',
        choiceId: 'exchange_card',
        from: { kind: 'hand', player: 'p1' },
        cards: { kind: 'all' },
        count: 1,
        messageKey: 'exchange_card_choice',
      },
    ]);
  });

  it('革命中でも自然順の最強札を選び、ジョーカーを2より優先する', () => {
    const result = rule.hooks.onGameStart?.(
      context({
        winner: 'p1',
        loser: 'p4',
        loserHand: [natural('S02', '2'), joker('JK1', 1)],
        revolution: true,
      }),
      { kind: 'cards', choiceId: 'exchange_card', cardIds: ['S03'] },
    );
    expect(result).toEqual([
      {
        type: 'moveCards',
        from: { kind: 'hand', player: 'p1' },
        to: { kind: 'hand', player: 'p4' },
        cards: { kind: 'specific', cardIds: ['S03'] },
      },
      {
        type: 'moveCards',
        from: { kind: 'hand', player: 'p4' },
        to: { kind: 'hand', player: 'p1' },
        cards: { kind: 'specific', cardIds: ['JK1'] },
      },
    ]);
  });

  it('最強ランクが同じならカードIDが小さい1枚を選ぶ', () => {
    const result = rule.hooks.onGameStart?.(
      context({
        winner: 'p1',
        loser: 'p4',
        loserHand: [natural('S02', '2'), natural('C02', '2')],
      }),
      { kind: 'cards', choiceId: 'exchange_card', cardIds: ['S03'] },
    );
    expect(result?.[1]).toMatchObject({
      cards: { kind: 'specific', cardIds: ['C02'] },
    });
  });

  it('実エンジンで選択完了まで開始を保留し、両手札の枚数を保って同時交換する', () => {
    const config = {
      gameIndex: 1,
      seats: ['p1', 'p2', 'p3', 'p4'],
      gameSeed: 'rank-card-exchange-integration',
      ruleChain: [entry],
    };
    const runtime: RuleRuntime = {
      port: createInProcessRuleChainPort([rule]),
      setHistory: [],
      setMemory: {
        [rule.meta.ruleId]: { previousWinner: 'p1', previousLoser: 'p4' },
      },
    };
    const started = startGame(config, runtime);
    const selected = started.state.private.pendingChoice?.optionCardIds?.[0];
    const loserBefore = started.state.players.p4?.hand ?? [];
    const winnerBefore = started.state.players.p1?.hand ?? [];

    expect(started.state.public.phase).toBe('awaitingChoice');
    expect(started.events.map(({ type }) => type)).toEqual(['gameStarted']);
    expect(started.state.private.pendingChoice).toMatchObject({
      hook: 'onGameStart',
      player: 'p1',
      choiceId: 'exchange_card',
    });
    expect(selected).toBeDefined();
    if (!selected) return;

    const completed = reduceGame(
      config,
      started.state,
      {
        type: 'ruleInput',
        player: 'p1',
        choiceId: 'exchange_card',
        cardIds: [selected],
      },
      runtime,
    );

    expect(completed.rejections).toEqual([]);
    expect(completed.state.public.phase).toBe('awaitingPlay');
    expect(completed.state.private.pendingChoice).toBeUndefined();
    expect(completed.state.players.p1?.hand).toHaveLength(winnerBefore.length);
    expect(completed.state.players.p4?.hand).toHaveLength(loserBefore.length);
    expect(
      completed.state.players.p1?.hand.some(({ id }) => id === selected),
    ).toBe(false);
    expect(
      completed.state.players.p4?.hand.some(({ id }) => id === selected),
    ).toBe(true);
    expect(
      Object.values(completed.state.players).reduce(
        (total, player) => total + player.hand.length,
        0,
      ),
    ).toBe(52);
  });
});
