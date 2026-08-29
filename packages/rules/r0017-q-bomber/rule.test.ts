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

function context(hands: Record<string, Card[]>, actor = 'p1'): RuleContext {
  return {
    contractVersion: 2,
    game: {
      gameIndex: 0,
      ruleIds: [rule.meta.ruleId],
      seats,
      direction: 1,
      turn: actor,
      players: seats.map((id) => ({
        id,
        hand: hands[id] ?? [],
        status: 'active' as const,
        standing: null,
      })),
      field: {
        current: { by: actor, play: play(natural('spade', 'Q')) },
        passedSinceLastPlay: [],
      },
      discard: [],
      history: [],
      strength: BASE_STRENGTH_ORDER,
    },
    setHistory: [],
    memory: { game: {}, set: {} },
    rng: { next: () => 0.5, int: () => 0 },
  };
}

function engineFixture(): {
  config: GameConfig;
  state: GameState;
  runtime: RuleRuntime;
} {
  const config: GameConfig = {
    gameIndex: 0,
    seats,
    gameSeed: 'q-bomber-test',
    ruleChain: [
      {
        ruleId: rule.meta.ruleId,
        name: rule.meta.name,
        position: 0,
        priority: { score: 0, activatedAt: 0, ruleId: rule.meta.ruleId },
        bundleHash: 'q-bomber-test',
        contractVersion: rule.meta.contractVersion,
      },
    ],
  };
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
      rng: seedRng('q-bomber-test'),
      hookCalls: {},
    },
    players: {
      p1: {
        id: 'p1',
        hand: [
          natural('spade', 'Q', 'S-Q'),
          natural('heart', '3', 'H-3'),
          natural('club', '4', 'C-4'),
        ],
        status: 'active',
        skipCount: 0,
      },
      p2: {
        id: 'p2',
        hand: [natural('spade', '5', 'S-5'), natural('heart', '5', 'H-5')],
        status: 'active',
        skipCount: 0,
      },
      p3: {
        id: 'p3',
        hand: [natural('spade', '6', 'S-6'), natural('heart', '6', 'H-6')],
        status: 'active',
        skipCount: 0,
      },
      p4: {
        id: 'p4',
        hand: [natural('spade', '7', 'S-7')],
        status: 'active',
        skipCount: 0,
      },
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

describe('Q-ボンバー', () => {
  it('meta.jsonと同じメタデータを公開する', () => {
    expect(rule.meta).toEqual({
      ruleId: 'r0017-q-bomber',
      name: 'Q-ボンバー',
      description:
        '自然なQを含む手を出すと、そのQの枚数分まで、全プレイヤーがそれぞれ自分の手札からカードを選び、選ばれたカードを捨て札へ移す。出した本人も対象に含む。',
      kind: 'local',
      prefecture: '東京都',
      proposalId: '01KZ1F7X5MRKH0T7ENDPGS0W6E',
      contractVersion: 2,
      messages: {
        q_bomber_choice: 'Q-ボンバーで捨てるカードを選んでください',
      },
    });
  });

  it('自然なQの枚数分を全員へ要求し、少ない手札は残り全部にする', () => {
    const hands = {
      p1: [natural('spade', '3'), natural('heart', '3'), natural('club', '3')],
      p2: [natural('spade', '4'), natural('heart', '4')],
      p3: [natural('spade', '5')],
      p4: [],
    };

    expect(
      rule.hooks.afterPlay?.(
        context(hands),
        play(natural('spade', 'Q'), natural('heart', 'Q')),
      ),
    ).toMatchObject([
      {
        type: 'requestChoice',
        player: 'p1',
        choiceId: 'q_bomber_0',
        count: 2,
        simultaneous: true,
        additionalChoices: [
          { player: 'p2', choiceId: 'q_bomber_1', count: 2 },
          { player: 'p3', choiceId: 'q_bomber_2', count: 1 },
        ],
      },
    ]);
  });

  it('Qなしでは発動せず、ジョーカーをQ枚数に数えない', () => {
    const hands = { p1: [natural('spade', '3')] };
    expect(
      rule.hooks.afterPlay?.(context(hands), play(natural('spade', 'J'))),
    ).toEqual([]);
    expect(
      rule.hooks.afterPlay?.(
        context(hands),
        play(natural('spade', 'Q'), joker()),
      ),
    ).toMatchObject([{ count: 1 }]);
    expect(rule.hooks.afterPlay?.(context(hands), play(joker()))).toEqual([]);
  });

  it('各応答をchoiceIdに対応する本人の手札から捨て札へ移す', () => {
    expect(
      rule.hooks.afterPlay?.(
        context({ p2: [natural('spade', '5', 'S-5')] }),
        play(natural('spade', 'Q')),
        { kind: 'cards', choiceId: 'q_bomber_1', cardIds: ['S-5'] },
      ),
    ).toEqual([
      {
        type: 'moveCards',
        from: { kind: 'hand', player: 'p2' },
        to: { kind: 'discard' },
        cards: { kind: 'specific', cardIds: ['S-5'] },
      },
    ]);
  });

  it('全員が順不同で同時に選べて、全員確定までカードを公開・移動しない', () => {
    const { config, state, runtime } = engineFixture();
    let transition = reduceGame(
      config,
      state,
      { type: 'play', player: 'p1', cards: ['S-Q'] },
      runtime,
    );
    expect(transition.state.private.pendingChoice).toMatchObject({
      simultaneousChoices: [
        { player: 'p1', optionCardIds: ['H-3', 'C-4'] },
        { player: 'p2', optionCardIds: ['S-5', 'H-5'] },
        { player: 'p3', optionCardIds: ['S-6', 'H-6'] },
        { player: 'p4', optionCardIds: ['S-7'] },
      ],
      submittedChoices: [],
    });

    const wrongHand = reduceGame(
      config,
      transition.state,
      {
        type: 'ruleInput',
        player: 'p1',
        choiceId: 'q_bomber_0',
        cardIds: ['S-5'],
      },
      runtime,
    );
    expect(wrongHand.rejections[0]?.code).toBe('INVALID_RULE_CHOICE');

    const responses = [
      ['p2', 'q_bomber_1', 'S-5'],
      ['p4', 'q_bomber_3', 'S-7'],
      ['p1', 'q_bomber_0', 'H-3'],
      ['p3', 'q_bomber_2', 'S-6'],
    ] as const;
    for (const [player, choiceId, cardId] of responses) {
      transition = reduceGame(
        config,
        transition.state,
        { type: 'ruleInput', player, choiceId, cardIds: [cardId] },
        { ...runtime, setMemory: transition.setMemory ?? {} },
      );
      expect(transition.rejections).toEqual([]);
      if (player !== 'p3') {
        expect(transition.state.public.phase).toBe('awaitingChoice');
        expect(transition.state.public.discard).toEqual([]);
        expect(transition.state.players.p4?.hand.map(({ id }) => id)).toEqual([
          'S-7',
        ]);
        expect(
          transition.events.some(({ type }) => type === 'turnChanged'),
        ).toBe(false);
      }
    }

    expect(transition.state.private.pendingChoice).toBeUndefined();
    expect(transition.state.public.phase).toBe('awaitingPlay');
    expect(transition.state.public.turn).toBe('p2');
    expect(transition.state.public.discard.map(({ id }) => id)).toEqual([
      'H-3',
      'S-5',
      'S-6',
      'S-7',
    ]);
    expect(transition.state.players.p4).toMatchObject({
      hand: [],
      status: 'finished',
    });
    expect(transition.state.players.p4?.standing).not.toBeNull();
  });
});
