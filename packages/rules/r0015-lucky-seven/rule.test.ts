import type { Card, CardRank, Play, RuleContext } from '@daifugo/core';
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

function context(currentPlay: Play, hand: Card[]): RuleContext {
  return {
    contractVersion: 2,
    game: {
      gameIndex: 0,
      seats,
      direction: 1,
      turn: 'p1',
      players: seats.map((id) => ({
        id,
        hand: id === 'p1' ? hand : [],
        status: 'active',
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

describe('ラッキー7', () => {
  it('自然な7を2枚出すと残り手札から正確に2枚を必須選択する', () => {
    const currentPlay = play([card('S07', '7'), card('H07', '7')]);
    const effects = afterPlay(
      context(currentPlay, [card('S03', '3'), card('S04', '4')]),
      currentPlay,
    );

    expect(effects).toEqual([
      {
        type: 'requestChoice',
        player: 'p1',
        choiceId: 'lucky_seven_choice',
        from: { kind: 'hand', player: 'p1' },
        cards: { kind: 'all' },
        count: 2,
        messageKey: 'lucky_seven_choice',
      },
    ]);
  });

  it('選んだ2枚を場へ追加せず捨て札へ移す', () => {
    const currentPlay = play([card('S07', '7'), card('H07', '7')]);
    const effects = afterPlay(
      context(currentPlay, [card('S03', '3'), card('S04', '4')]),
      currentPlay,
      {
        kind: 'cards',
        choiceId: 'lucky_seven_choice',
        cardIds: ['S03', 'S04'],
      },
    );

    expect(effects).toEqual([
      {
        type: 'moveCards',
        from: { kind: 'hand', player: 'p1' },
        to: { kind: 'discard' },
        cards: { kind: 'specific', cardIds: ['S03', 'S04'] },
      },
    ]);
  });

  it('自然な7を3枚出すと正確に3枚を選んで捨てる', () => {
    const currentPlay = play([
      card('S07', '7'),
      card('H07', '7'),
      card('D07', '7'),
    ]);
    const ruleContext = context(currentPlay, [
      card('S03', '3'),
      card('S04', '4'),
      card('S05', '5'),
    ]);

    expect(afterPlay(ruleContext, currentPlay)).toMatchObject([
      { type: 'requestChoice', count: 3 },
    ]);
    expect(
      afterPlay(ruleContext, currentPlay, {
        kind: 'cards',
        choiceId: 'lucky_seven_choice',
        cardIds: ['S03', 'S04', 'S05'],
      }),
    ).toMatchObject([
      {
        type: 'moveCards',
        to: { kind: 'discard' },
        cards: { kind: 'specific', cardIds: ['S03', 'S04', 'S05'] },
      },
    ]);
  });

  it('自然な7が1枚だけなら選択も移動も要求しない', () => {
    const currentPlay = play([card('S07', '7')]);
    expect(
      afterPlay(context(currentPlay, [card('S03', '3')]), currentPlay),
    ).toEqual([]);
  });

  it('自然な7が1枚とジョーカーの組では発動しない', () => {
    const currentPlay = play([card('S07', '7'), joker()]);
    expect(
      afterPlay(context(currentPlay, [card('S03', '3')]), currentPlay),
    ).toEqual([]);
  });

  it('ジョーカーを含む場合も自然な7だけを発動枚数に数える', () => {
    const currentPlay = play([card('S07', '7'), card('H07', '7'), joker()]);
    expect(
      afterPlay(
        context(currentPlay, [
          card('S03', '3'),
          card('S04', '4'),
          card('S05', '5'),
        ]),
        currentPlay,
      ),
    ).toMatchObject([{ type: 'requestChoice', count: 2 }]);
  });

  it('残り手札が自然な7の枚数より少ない場合は残り手札をすべて要求する', () => {
    const currentPlay = play([
      card('S07', '7'),
      card('H07', '7'),
      card('D07', '7'),
    ]);
    expect(
      afterPlay(
        context(currentPlay, [card('S03', '3'), card('S04', '4')]),
        currentPlay,
      ),
    ).toMatchObject([{ type: 'requestChoice', count: 2 }]);
  });

  it('自然な7を2枚以上出して残り手札が0枚なら選択を要求しない', () => {
    const currentPlay = play([card('S07', '7'), card('H07', '7')]);
    expect(afterPlay(context(currentPlay, []), currentPlay)).toEqual([]);
  });

  it.each([
    ['要求枚数より少ない', ['S03']],
    ['同じカードが重複', ['S03', 'S03']],
    ['残り手札にないカードを含む', ['S03', 'C09']],
  ])('%s応答は受理せずカードを捨てない', (_label, cardIds) => {
    const currentPlay = play([card('S07', '7'), card('H07', '7')]);
    const effects = afterPlay(
      context(currentPlay, [card('S03', '3'), card('S04', '4')]),
      currentPlay,
      {
        kind: 'cards',
        choiceId: 'lucky_seven_choice',
        cardIds,
      },
    );
    expect(effects).toEqual([]);
  });

  it('別のchoiceIdへの応答ではカードを捨てない', () => {
    const currentPlay = play([card('S07', '7'), card('H07', '7')]);
    const effects = afterPlay(
      context(currentPlay, [card('S03', '3'), card('S04', '4')]),
      currentPlay,
      {
        kind: 'cards',
        choiceId: 'other_choice',
        cardIds: ['S03', 'S04'],
      },
    );

    expect(effects).toEqual([]);
  });

  it('選択を省略した呼び出しではmoveCardsせず必ずrequestChoiceを返す', () => {
    const currentPlay = play([card('S07', '7'), card('H07', '7')]);
    expect(
      afterPlay(
        context(currentPlay, [card('S03', '3'), card('S04', '4')]),
        currentPlay,
      ),
    ).toMatchObject([{ type: 'requestChoice', count: 2 }]);
  });

  it('7渡しで2枚処理後でも十分な手札があればラッキー7で別の2枚を要求する', () => {
    const currentPlay = play([card('S07', '7'), card('H07', '7')]);
    const beforeSevenPass = context(currentPlay, [
      card('S03', '3'),
      card('S04', '4'),
      card('S05', '5'),
      card('S06', '6'),
    ]);
    const afterSevenPass = context(currentPlay, [
      card('S05', '5'),
      card('S06', '6'),
    ]);

    expect(afterPlay(beforeSevenPass, currentPlay)).toMatchObject([
      { type: 'requestChoice', count: 2 },
    ]);
    expect(afterPlay(afterSevenPass, currentPlay)).toMatchObject([
      { type: 'requestChoice', count: 2 },
    ]);
  });
});
