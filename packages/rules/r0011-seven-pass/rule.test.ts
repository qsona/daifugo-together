import type {
  Card,
  CardRank,
  Play,
  PlayerStatus,
  RuleContext,
} from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { rule } from './rule.js';

const seats = ['p1', 'p2', 'p3', 'p4'];
const ranking: CardRank[] = [
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
  'A',
  '2',
];

function card(id: string, rank: CardRank): Card {
  return { kind: 'natural', id, suit: 'spade', rank };
}

function joker(id = 'JK0'): Card {
  return { kind: 'joker', id, index: id === 'JK0' ? 0 : 1 };
}

function play(cards: Card[]): Play {
  return {
    kind: cards.length === 1 ? 'single' : 'set',
    cards,
    count: cards.length,
    repRank:
      cards.find((candidate) => candidate.kind === 'natural')?.rank ?? 'joker',
  };
}

function context(
  options: {
    hand?: Card[];
    direction?: 1 | -1;
    statuses?: Partial<Record<string, PlayerStatus>>;
    currentPlay?: Play;
  } = {},
): RuleContext {
  const currentPlay = options.currentPlay ?? play([card('S07', '7')]);
  return {
    contractVersion: 2,
    game: {
      gameIndex: 0,
      activeRuleIds: ['r0011-seven-pass'],
      seats,
      direction: options.direction ?? 1,
      turn: 'p1',
      players: seats.map((id) => ({
        id,
        hand: id === 'p1' ? (options.hand ?? [card('S03', '3')]) : [],
        status: options.statuses?.[id] ?? 'active',
        standing: null,
      })),
      field: {
        current: { play: currentPlay, by: 'p1' },
        passedSinceLastPlay: [],
      },
      discard: [],
      history: [],
      strength: { ranking },
    },
    setHistory: [],
    memory: { game: {}, set: {} },
    rng: { next: () => 0, int: () => 0 },
  };
}

function afterPlay(
  ruleContext: RuleContext,
  currentPlay: Play,
  input?: { kind: 'cards'; choiceId: string; cardIds: string[] },
) {
  return rule.hooks.afterPlay?.(ruleContext, currentPlay, input) ?? [];
}

describe('7渡し', () => {
  it('自然な7を1枚出すと残り手札から正確に1枚を必須選択する', () => {
    const currentPlay = play([card('S07', '7')]);
    const effects = afterPlay(context({ currentPlay }), currentPlay);

    expect(effects).toEqual([
      {
        type: 'requestChoice',
        player: 'p1',
        choiceId: 'seven_pass_choice',
        from: { kind: 'hand', player: 'p1' },
        cards: { kind: 'all' },
        count: 1,
        messageKey: 'seven_pass_choice',
      },
    ]);
  });

  it('選んだ1枚を現在の進行方向で次のプレイヤーへ渡す', () => {
    const currentPlay = play([card('S07', '7')]);
    const effects = afterPlay(context({ currentPlay }), currentPlay, {
      kind: 'cards',
      choiceId: 'seven_pass_choice',
      cardIds: ['S03'],
    });

    expect(effects).toEqual([
      {
        type: 'moveCards',
        from: { kind: 'hand', player: 'p1' },
        to: { kind: 'hand', player: 'p2' },
        cards: { kind: 'specific', cardIds: ['S03'] },
      },
    ]);
  });

  it('自然な7を2枚出すと正確に2枚を選んで渡す', () => {
    const currentPlay = play([card('S07', '7'), card('H07', '7')]);
    const ruleContext = context({
      currentPlay,
      hand: [card('S03', '3'), card('S04', '4'), card('S05', '5')],
    });

    expect(afterPlay(ruleContext, currentPlay)).toMatchObject([
      { type: 'requestChoice', count: 2 },
    ]);
    expect(
      afterPlay(ruleContext, currentPlay, {
        kind: 'cards',
        choiceId: 'seven_pass_choice',
        cardIds: ['S03', 'S04'],
      }),
    ).toMatchObject([
      {
        type: 'moveCards',
        to: { kind: 'hand', player: 'p2' },
        cards: { kind: 'specific', cardIds: ['S03', 'S04'] },
      },
    ]);
  });

  it('逆方向では逆隣のプレイヤーへ渡す', () => {
    const currentPlay = play([card('S07', '7')]);
    const effects = afterPlay(
      context({ currentPlay, direction: -1 }),
      currentPlay,
      {
        kind: 'cards',
        choiceId: 'seven_pass_choice',
        cardIds: ['S03'],
      },
    );

    expect(effects).toMatchObject([
      { type: 'moveCards', to: { kind: 'hand', player: 'p4' } },
    ]);
  });

  it('次の席が終了済みなら現在の進行方向で次のactiveプレイヤーへ渡す', () => {
    const currentPlay = play([card('S07', '7')]);
    const effects = afterPlay(
      context({ currentPlay, statuses: { p2: 'finished' } }),
      currentPlay,
      {
        kind: 'cards',
        choiceId: 'seven_pass_choice',
        cardIds: ['S03'],
      },
    );

    expect(effects).toMatchObject([
      { type: 'moveCards', to: { kind: 'hand', player: 'p3' } },
    ]);
  });

  it('7を含まない手では選択も移動も要求しない', () => {
    const currentPlay = play([card('S08', '8')]);
    expect(afterPlay(context({ currentPlay }), currentPlay)).toEqual([]);
  });

  it('ジョーカーだけを7の代用にしても発動枚数に数えない', () => {
    const currentPlay = play([joker()]);
    expect(afterPlay(context({ currentPlay }), currentPlay)).toEqual([]);
  });

  it('自然な7とジョーカーの組では自然な7だけを発動枚数に数える', () => {
    const currentPlay = play([card('S07', '7'), joker()]);
    expect(afterPlay(context({ currentPlay }), currentPlay)).toMatchObject([
      { type: 'requestChoice', count: 1 },
    ]);
  });

  it('7から10の階段では10捨てと同時発動しても自然な7の1枚分を要求する', () => {
    const currentPlay: Play = {
      kind: 'sequence',
      cards: [
        card('S07', '7'),
        card('S08', '8'),
        card('S09', '9'),
        card('S10', '10'),
      ],
      count: 4,
      repRank: '10',
    };

    expect(afterPlay(context({ currentPlay }), currentPlay)).toMatchObject([
      { type: 'requestChoice', count: 1 },
    ]);
  });

  it('残り手札が7の枚数より少ない場合は残り手札をすべて要求する', () => {
    const currentPlay = play([card('S07', '7'), card('H07', '7')]);
    expect(
      afterPlay(
        context({ currentPlay, hand: [card('S03', '3')] }),
        currentPlay,
      ),
    ).toMatchObject([{ type: 'requestChoice', count: 1 }]);
  });

  it('7を出して残り手札が0枚なら選択を要求しない', () => {
    const currentPlay = play([card('S07', '7')]);
    expect(afterPlay(context({ currentPlay, hand: [] }), currentPlay)).toEqual(
      [],
    );
  });

  it.each([
    ['要求枚数より少ない', ['S03']],
    ['同じカードが重複', ['S03', 'S03']],
    ['残り手札にないカードを含む', ['S03', 'C09']],
  ])('%s応答は受理せずカードを移動しない', (_label, cardIds) => {
    const currentPlay = play([card('S07', '7'), card('H07', '7')]);
    const effects = afterPlay(
      context({
        currentPlay,
        hand: [card('S03', '3'), card('S04', '4')],
      }),
      currentPlay,
      {
        kind: 'cards',
        choiceId: 'seven_pass_choice',
        cardIds,
      },
    );
    expect(effects).toEqual([]);
  });

  it('別のchoiceIdへの応答ではカードを移動しない', () => {
    const currentPlay = play([card('S07', '7')]);
    const effects = afterPlay(context({ currentPlay }), currentPlay, {
      kind: 'cards',
      choiceId: 'other_choice',
      cardIds: ['S03'],
    });

    expect(effects).toEqual([]);
  });

  it('選択を省略した呼び出しではmoveCardsせず必ずrequestChoiceを返す', () => {
    const currentPlay = play([card('S07', '7')]);
    expect(afterPlay(context({ currentPlay }), currentPlay)).toMatchObject([
      { type: 'requestChoice', count: 1 },
    ]);
  });

  it('ラッキー7で2枚処理後でも十分な手札があれば7渡しで別の2枚を要求する', () => {
    const currentPlay = play([card('S07', '7'), card('H07', '7')]);
    const beforeLuckySeven = context({
      currentPlay,
      hand: [
        card('S03', '3'),
        card('S04', '4'),
        card('S05', '5'),
        card('S06', '6'),
      ],
    });
    const afterLuckySeven = context({
      currentPlay,
      hand: [card('S05', '5'), card('S06', '6')],
    });

    expect(afterPlay(beforeLuckySeven, currentPlay)).toMatchObject([
      { type: 'requestChoice', count: 2 },
    ]);
    expect(afterPlay(afterLuckySeven, currentPlay)).toMatchObject([
      { type: 'requestChoice', count: 2 },
    ]);
  });
});
