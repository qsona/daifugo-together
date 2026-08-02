import type {
  Card,
  CardRank,
  GameConfig,
  GameState,
  JokerCard,
  NaturalCard,
  Play,
  RuleContext,
  RuleInput,
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
  const firstNatural = cards.find(
    (card): card is NaturalCard => card.kind === 'natural',
  );
  return {
    kind: cards.length === 1 ? 'single' : 'set',
    cards,
    count: cards.length,
    repRank: firstNatural?.rank ?? 'joker',
  };
}

function context(remainingHand: Card[], actor = 'p1'): RuleContext {
  return {
    contractVersion: 2,
    game: {
      gameIndex: 0,
      seats: ['p1', 'p2', 'p3', 'p4'],
      direction: 1,
      turn: actor,
      players: [
        { id: actor, hand: remainingHand, status: 'active', standing: null },
        { id: 'p2', hand: [], status: 'active', standing: null },
        { id: 'p3', hand: [], status: 'active', standing: null },
        { id: 'p4', hand: [], status: 'active', standing: null },
      ],
      field: {
        current: {
          by: actor,
          play: play(natural('spade', '10')),
        },
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

const choice = (
  count: number,
  actor = 'p1',
): ReturnType<NonNullable<RuleModule['hooks']['afterPlay']>> => [
  {
    type: 'requestChoice',
    player: actor,
    choiceId: 'ten_discard',
    from: { kind: 'hand', player: actor },
    cards: { kind: 'all' },
    count,
    messageKey: 'ten_discard_choice',
  },
];

function engineFixture(): {
  config: GameConfig;
  state: GameState;
  runtime: RuleRuntime;
} {
  return {
    config: {
      gameIndex: 0,
      seats: ['p1', 'p2', 'p3', 'p4'],
      gameSeed: 'ten-discard-test',
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
          bundleHash: 'ten-discard-test',
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
        rng: seedRng('ten-discard-test'),
        hookCalls: {},
      },
      players: {
        p1: {
          id: 'p1',
          hand: [natural('spade', '10', 'S10'), natural('heart', '3', 'H03')],
          status: 'active',
          skipCount: 0,
        },
        p2: {
          id: 'p2',
          hand: [natural('spade', '4', 'S04')],
          status: 'active',
          skipCount: 0,
        },
        p3: {
          id: 'p3',
          hand: [natural('spade', '5', 'S05')],
          status: 'active',
          skipCount: 0,
        },
        p4: {
          id: 'p4',
          hand: [natural('spade', '6', 'S06')],
          status: 'active',
          skipCount: 0,
        },
      },
    },
    runtime: {
      port: createInProcessRuleChainPort([rule]),
      setHistory: [],
      setMemory: {},
    },
  };
}

describe('10捨て', () => {
  it('meta.jsonと同じメタデータを公開する', () => {
    expect(rule.meta).toEqual({
      ruleId: 'r0010-ten-discard',
      name: '10捨て',
      description:
        '自然なランク10を含む手を出したプレイヤーは、その手に含まれる10の枚数と残り手札枚数の小さい方と同じ枚数のカードを、残り手札から必ず選んで捨て札へ移す。',
      kind: 'local',
      prefecture: '東京都',
      proposalId: '01KYSWRBH3YEVTAFC5NTR0TJ41',
      contractVersion: 2,
      messages: {
        ten_discard_choice: '10捨て: 捨てるカードを選んでください。',
      },
    });
  });

  it('自然な10を1枚出すと残り手札から1枚の選択を必須にする', () => {
    const remaining = [natural('heart', '3'), natural('club', '4')];

    expect(
      rule.hooks.afterPlay?.(context(remaining), play(natural('spade', '10'))),
    ).toEqual(choice(1));
  });

  it('自然な10を複数枚出すと同じ枚数を選択させる', () => {
    const remaining = [
      natural('heart', '3'),
      natural('club', '4'),
      natural('diamond', '5'),
    ];

    expect(
      rule.hooks.afterPlay?.(
        context(remaining),
        play(natural('spade', '10'), natural('heart', '10')),
      ),
    ).toEqual(choice(2));
  });

  it('残り手札が10の枚数より少ない場合は残りすべてを選択させる', () => {
    const remaining = [natural('heart', '3')];

    expect(
      rule.hooks.afterPlay?.(
        context(remaining),
        play(
          natural('spade', '10'),
          natural('heart', '10'),
          natural('diamond', '10'),
        ),
      ),
    ).toEqual(choice(1));
  });

  it('10を出して残り手札が0枚になった場合は選択を要求しない', () => {
    expect(
      rule.hooks.afterPlay?.(context([]), play(natural('spade', '10'))),
    ).toEqual([]);
  });

  it('自然な10を含まないプレイでは選択を要求しない', () => {
    expect(
      rule.hooks.afterPlay?.(
        context([natural('heart', '3')]),
        play(natural('spade', '9')),
      ),
    ).toEqual([]);
  });

  it('ジョーカーは10の代用でも発動枚数に数えない', () => {
    const remaining = [
      natural('heart', '3'),
      natural('club', '4'),
      natural('diamond', '5'),
    ];

    expect(
      rule.hooks.afterPlay?.(
        context(remaining),
        play(natural('spade', '10'), joker()),
      ),
    ).toEqual(choice(1));
    expect(rule.hooks.afterPlay?.(context(remaining), play(joker()))).toEqual(
      [],
    );
  });

  it('有効な選択応答のカードだけを手札から捨て札へ移す', () => {
    const currentPlay = play(natural('spade', '10'));
    const input: RuleInput = {
      kind: 'cards',
      choiceId: 'ten_discard',
      cardIds: ['H03'],
    };

    expect(
      rule.hooks.afterPlay?.(
        context([natural('heart', '3', 'H03')]),
        currentPlay,
        input,
      ),
    ).toEqual([
      {
        type: 'moveCards',
        from: { kind: 'hand', player: 'p1' },
        to: { kind: 'discard' },
        cards: { kind: 'specific', cardIds: ['H03'] },
      },
    ]);
  });

  it('別choiceIdの応答では処理を進めず、追加入力も要求しない', () => {
    expect(
      rule.hooks.afterPlay?.(
        context([natural('heart', '3')]),
        play(natural('spade', '10')),
        { kind: 'cards', choiceId: 'other', cardIds: ['heart-3'] },
      ),
    ).toEqual([]);
  });

  it('選択を省略できず、有効な応答で捨て札への移動とあがりを完了する', () => {
    const { config, state, runtime } = engineFixture();
    const waiting = reduceGame(
      config,
      state,
      { type: 'play', player: 'p1', cards: ['S10'] },
      runtime,
    );

    expect(waiting.rejections).toEqual([]);
    expect(waiting.state.public.phase).toBe('awaitingChoice');
    expect(waiting.state.public.turn).toBe('p1');
    expect(waiting.state.public.field.current?.play.cards).toEqual([
      natural('spade', '10', 'S10'),
    ]);
    expect(waiting.state.private.pendingChoice).toMatchObject({
      player: 'p1',
      choiceId: 'ten_discard',
      optionCardIds: ['H03'],
      count: 1,
    });

    const invalid = reduceGame(
      config,
      waiting.state,
      {
        type: 'ruleInput',
        player: 'p1',
        choiceId: 'ten_discard',
        cardIds: [],
      },
      runtime,
    );
    expect(invalid.rejections[0]?.code).toBe('INVALID_RULE_CHOICE');
    expect(invalid.state).toBe(waiting.state);

    const completed = reduceGame(
      config,
      waiting.state,
      {
        type: 'ruleInput',
        player: 'p1',
        choiceId: 'ten_discard',
        cardIds: ['H03'],
      },
      runtime,
    );
    expect(completed.rejections).toEqual([]);
    expect(completed.state.public.phase).toBe('awaitingPlay');
    expect(completed.state.public.turn).toBe('p2');
    expect(completed.state.public.discard).toEqual([
      natural('heart', '3', 'H03'),
    ]);
    expect(completed.state.public.field.current?.play.cards).toEqual([
      natural('spade', '10', 'S10'),
    ]);
    expect(completed.state.players.p1?.hand).toEqual([]);
    expect(completed.state.players.p1?.status).toBe('finished');
    expect(completed.state.players.p1?.standing).toBe(1);
  });
});
