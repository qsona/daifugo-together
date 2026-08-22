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
  it.each([0, 1, 2])('自然な7が%d枚では発動しない', (count) => {
    const currentPlay =
      count === 0
        ? play([card('S03', '3')])
        : play(['S07', 'H07'].slice(0, count).map((id) => card(id, '7')));
    expect(
      afterPlay(context(currentPlay, [card('S03', '3')]), currentPlay),
    ).toEqual([]);
  });

  it.each([3, 4])('自然な7が%d枚なら正確に1枚を必須選択する', (count) => {
    const currentPlay = play(
      ['S07', 'H07', 'D07', 'C07'].slice(0, count).map((id) => card(id, '7')),
    );
    expect(
      afterPlay(
        context(currentPlay, [card('S03', '3'), card('S04', '4')]),
        currentPlay,
      ),
    ).toEqual([
      {
        type: 'requestChoice',
        player: 'p1',
        choiceId: 'lucky_seven_choice',
        from: { kind: 'hand', player: 'p1' },
        cards: { kind: 'all' },
        count: 1,
        messageKey: 'lucky_seven_choice',
      },
    ]);
  });

  it('選んだ1枚を場へ追加せず捨て札へ移す', () => {
    const currentPlay = play([
      card('S07', '7'),
      card('H07', '7'),
      card('D07', '7'),
    ]);
    expect(
      afterPlay(context(currentPlay, [card('S03', '3')]), currentPlay, {
        kind: 'cards',
        choiceId: 'lucky_seven_choice',
        cardIds: ['S03'],
      }),
    ).toEqual([
      {
        type: 'moveCards',
        from: { kind: 'hand', player: 'p1' },
        to: { kind: 'discard' },
        cards: { kind: 'specific', cardIds: ['S03'] },
      },
    ]);
  });

  it('自然な7が2枚とジョーカーでは発動しない', () => {
    const currentPlay = play([card('S07', '7'), card('H07', '7'), joker()]);
    expect(
      afterPlay(context(currentPlay, [card('S03', '3')]), currentPlay),
    ).toEqual([]);
  });

  it('自然な7が3枚とジョーカーでは1枚を要求する', () => {
    const currentPlay = play([
      card('S07', '7'),
      card('H07', '7'),
      card('D07', '7'),
      joker(),
    ]);
    expect(
      afterPlay(context(currentPlay, [card('S03', '3')]), currentPlay),
    ).toMatchObject([{ type: 'requestChoice', count: 1 }]);
  });

  it('自然な7を3枚以上出して残り手札が0枚なら選択を要求しない', () => {
    const currentPlay = play([
      card('S07', '7'),
      card('H07', '7'),
      card('D07', '7'),
    ]);
    expect(afterPlay(context(currentPlay, []), currentPlay)).toEqual([]);
  });

  it.each([
    ['要求枚数より多い', ['S03', 'S04']],
    ['残り手札にないカード', ['C09']],
  ])('%s応答は受理せずカードを捨てない', (_label, cardIds) => {
    const currentPlay = play([
      card('S07', '7'),
      card('H07', '7'),
      card('D07', '7'),
    ]);
    expect(
      afterPlay(
        context(currentPlay, [card('S03', '3'), card('S04', '4')]),
        currentPlay,
        { kind: 'cards', choiceId: 'lucky_seven_choice', cardIds },
      ),
    ).toEqual([]);
  });

  it('別のchoiceIdへの応答ではカードを捨てない', () => {
    const currentPlay = play([
      card('S07', '7'),
      card('H07', '7'),
      card('D07', '7'),
    ]);
    expect(
      afterPlay(context(currentPlay, [card('S03', '3')]), currentPlay, {
        kind: 'cards',
        choiceId: 'other_choice',
        cardIds: ['S03'],
      }),
    ).toEqual([]);
  });
});
