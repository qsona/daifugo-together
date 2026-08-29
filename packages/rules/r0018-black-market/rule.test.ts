import type {
  Card,
  CardRank,
  GameConfig,
  GameState,
  JokerCard,
  NaturalCard,
  Play,
  RuleContext,
  RuleModule,
  RuleRuntime,
  Suit,
} from '@daifugo/core';
import {
  BASE_STRENGTH_ORDER,
  createInProcessRuleChainPort,
  reduceGame,
  seedRng,
} from '@daifugo/core';
import { describe, expect, it, vi } from 'vitest';

const { rule } = (await vi.importActual('./rule.js')) as { rule: RuleModule };
const seats = ['p1', 'p2', 'p3', 'p4'];
const natural = (
  suit: Suit,
  rank: CardRank,
  id = `${suit}-${rank}`,
): NaturalCard => ({
  kind: 'natural',
  id,
  suit,
  rank,
});
const joker = (index: 0 | 1 = 0): JokerCard => ({
  kind: 'joker',
  id: `joker-${String(index)}`,
  index,
});
function play(...cards: Card[]): Play {
  const first = cards.find(
    (card): card is NaturalCard => card.kind === 'natural',
  );
  return {
    kind: cards.length === 1 ? 'single' : 'set',
    cards,
    count: cards.length,
    repRank: first?.rank ?? 'joker',
  };
}
function context(
  hands: Record<string, Card[]>,
  statuses: Record<string, 'active' | 'finished'> = {},
  revolution = false,
): RuleContext {
  return {
    contractVersion: 2,
    game: {
      gameIndex: 0,
      ruleIds: [rule.meta.ruleId],
      seats,
      direction: 1,
      turn: 'p1',
      players: seats.map((id) => ({
        id,
        hand: hands[id] ?? [],
        status: statuses[id] ?? 'active',
        standing: null,
      })),
      field: {
        current: { by: 'p1', play: play(natural('spade', 'A')) },
        passedSinceLastPlay: [],
      },
      discard: [],
      history: [],
      strength: { ...BASE_STRENGTH_ORDER, revolution },
    },
    setHistory: [],
    memory: { game: {}, set: {} },
    rng: { next: () => 0.5, int: () => 0 },
  };
}
const threeAces = play(
  natural('spade', 'A', 'S-A'),
  natural('heart', 'A', 'H-A'),
  natural('club', 'A', 'C-A'),
);

function engineFixture(): {
  config: GameConfig;
  state: GameState;
  runtime: RuleRuntime;
} {
  const config: GameConfig = {
    gameIndex: 0,
    seats,
    gameSeed: 'black-market-test',
    ruleChain: [
      {
        ruleId: rule.meta.ruleId,
        name: rule.meta.name,
        position: 0,
        priority: { score: 0, activatedAt: 0, ruleId: rule.meta.ruleId },
        bundleHash: 'black-market-test',
        contractVersion: 2,
      },
    ],
  };
  const player = (id: string, hand: Card[]) => ({
    id,
    hand,
    status: 'active' as const,
    skipCount: 0,
  });
  const state: GameState = {
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
      rng: seedRng('black-market-test'),
      hookCalls: {},
    },
    players: {
      p1: player('p1', [
        ...threeAces.cards,
        natural('spade', '3', 'S-3'),
        natural('heart', '4', 'H-4'),
      ]),
      p2: player('p2', [
        natural('spade', 'K', 'S-K'),
        natural('heart', '2', 'H-2'),
        joker(),
      ]),
      p3: player('p3', [
        natural('spade', '5', 'S-5'),
        natural('heart', '5', 'H-5'),
      ]),
      p4: player('p4', [natural('spade', '6', 'S-6')]),
    },
  };
  return {
    config,
    state,
    runtime: {
      port: createInProcessRuleChainPort([rule]),
      setHistory: [],
      setMemory: {},
    },
  };
}

describe('ブラックマーケット', () => {
  it('meta.jsonと同じメタデータを公開する', () => {
    expect(rule.meta).toEqual({
      ruleId: 'r0018-black-market',
      name: 'ブラックマーケット',
      description:
        '自然なAを3枚組で出すと、出したプレイヤーが交換相手1人と自分の残り手札2枚を選び、その2枚と相手の手札で自然な強さ順が最も強い2枚を同時に交換する。',
      kind: 'local',
      prefecture: '東京都',
      proposalId: '01KZ1FD5DANCDY208648PASMF0',
      contractVersion: 2,
      messages: {
        black_market_target: '交換する相手を選んでください',
        black_market_cards: '相手に渡すカードを2枚選んでください',
      },
    });
  });

  it('自然なAの3枚組で、自分と抜けた人と手札不足を除いた相手選択を要求する', () => {
    const hands = {
      p1: [natural('spade', '3'), natural('heart', '4')],
      p2: [natural('spade', '5'), natural('heart', '5')],
      p3: [natural('spade', '6'), natural('heart', '6')],
      p4: [natural('spade', '7')],
    };
    expect(
      rule.hooks.afterPlay?.(context(hands, { p3: 'finished' }), threeAces),
    ).toEqual([
      {
        type: 'requestChoice',
        player: 'p1',
        choiceId: 'black_market_target',
        players: ['p2'],
        messageKey: 'black_market_target',
      },
    ]);
  });

  it('相手選択後に自分の残り手札2枚を要求する', () => {
    const hands = {
      p1: [natural('spade', '3'), natural('heart', '4')],
      p2: [natural('spade', '5'), natural('heart', '5')],
    };
    expect(
      rule.hooks.afterPlay?.(context(hands), threeAces, {
        kind: 'player',
        choiceId: 'black_market_target',
        playerId: 'p2',
      }),
    ).toMatchObject([
      {
        type: 'requestChoice',
        player: 'p1',
        choiceId: 'black_market_cards_1',
        count: 2,
      },
    ]);
  });

  it('A不足・Aなし・ジョーカー代用・残り手札不足では発動しない', () => {
    const hands = {
      p1: [natural('spade', '3')],
      p2: [natural('spade', '5'), natural('heart', '5')],
    };
    expect(
      rule.hooks.afterPlay?.(context(hands), play(natural('spade', 'A'))),
    ).toEqual([]);
    expect(
      rule.hooks.afterPlay?.(
        context(hands),
        play(
          natural('spade', 'K'),
          natural('heart', 'K'),
          natural('club', 'K'),
        ),
      ),
    ).toEqual([]);
    expect(
      rule.hooks.afterPlay?.(
        context(hands),
        play(natural('spade', 'A'), natural('heart', 'A'), joker()),
      ),
    ).toEqual([]);
  });

  it('革命中も通常順でJokerと2を選び、選択した自分の2枚と交換する', () => {
    const hands = {
      p1: [natural('spade', '3', 'S-3'), natural('heart', '4', 'H-4')],
      p2: [natural('spade', 'K', 'S-K'), natural('heart', '2', 'H-2'), joker()],
    };
    expect(
      rule.hooks.afterPlay?.(context(hands, {}, true), threeAces, {
        kind: 'cards',
        choiceId: 'black_market_cards_1',
        cardIds: ['S-3', 'H-4'],
      }),
    ).toEqual([
      {
        type: 'moveCards',
        from: { kind: 'hand', player: 'p1' },
        to: { kind: 'hand', player: 'p2' },
        cards: { kind: 'specific', cardIds: ['S-3', 'H-4'] },
      },
      {
        type: 'moveCards',
        from: { kind: 'hand', player: 'p2' },
        to: { kind: 'hand', player: 'p1' },
        cards: { kind: 'specific', cardIds: ['joker-0', 'H-2'] },
      },
    ]);
  });

  it('二段階入力の完了まで手番を止め、交換前の手札を基準に両方向を同じtransitionで交換する', () => {
    const { config, state, runtime } = engineFixture();
    let transition = reduceGame(
      config,
      state,
      { type: 'play', player: 'p1', cards: ['S-A', 'H-A', 'C-A'] },
      runtime,
    );
    expect(transition.state.private.pendingChoice).toMatchObject({
      kind: 'player',
      optionPlayerIds: ['p2', 'p3'],
    });
    transition = reduceGame(
      config,
      transition.state,
      {
        type: 'ruleInput',
        player: 'p1',
        choiceId: 'black_market_target',
        playerId: 'p2',
      },
      runtime,
    );
    expect(transition.state.public.phase).toBe('awaitingChoice');
    expect(transition.state.private.pendingChoice).toMatchObject({
      kind: 'cards',
      choiceId: 'black_market_cards_1',
      optionCardIds: ['S-3', 'H-4'],
    });
    transition = reduceGame(
      config,
      transition.state,
      {
        type: 'ruleInput',
        player: 'p1',
        choiceId: 'black_market_cards_1',
        cardIds: ['S-3', 'H-4'],
      },
      { ...runtime, setMemory: transition.setMemory ?? {} },
    );
    expect(transition.rejections).toEqual([]);
    expect(transition.state.public.turn).toBe('p2');
    expect(
      transition.state.players.p1?.hand.map(({ id }) => id).sort(),
    ).toEqual(['H-2', 'joker-0']);
    expect(
      transition.state.players.p2?.hand.map(({ id }) => id).sort(),
    ).toEqual(['H-4', 'S-3', 'S-K']);
    expect(
      transition.events.filter(({ type }) => type === 'cardsMoved'),
    ).toHaveLength(2);
  });
});
