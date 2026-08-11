import { BASE_STRENGTH_ORDER, CARD_RANKS } from '@daifugo/core';
import type { Play } from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import {
  chooseHeuristicPlay,
  sortPlaysWeakFirst,
  weakestPlay,
} from './heuristic.js';

function singlePlay(
  repRank: Play['repRank'],
  cardId: string,
  kind: Play['kind'] = 'single',
): Play {
  return {
    kind,
    cards: [
      repRank === 'joker'
        ? { kind: 'joker', id: cardId, index: 0 }
        : { kind: 'natural', id: cardId, suit: 'spade', rank: repRank },
    ],
    count: 1,
    repRank,
  };
}

describe('sortPlaysWeakFirst', () => {
  it("sorts repRank 'joker' as the strongest play", () => {
    const plays = [
      singlePlay('joker', 'JK0'),
      singlePlay('2', 'S02'),
      singlePlay('3', 'S03'),
    ];
    const sorted = sortPlaysWeakFirst(plays, BASE_STRENGTH_ORDER);
    expect(sorted.map((play) => play.repRank)).toEqual(['3', '2', 'joker']);
  });

  it("keeps 'joker' strongest even when the ranking is inverted", () => {
    const inverted = { ranking: [...CARD_RANKS].reverse() };
    const plays = [
      singlePlay('joker', 'JK0'),
      singlePlay('3', 'S03'),
      singlePlay('2', 'S02'),
    ];
    const sorted = sortPlaysWeakFirst(plays, inverted);
    expect(sorted.map((play) => play.repRank)).toEqual(['2', '3', 'joker']);
  });
});

describe('weakestPlay', () => {
  it("never picks a 'joker' play while a natural play exists", () => {
    const plays = [singlePlay('joker', 'JK0'), singlePlay('2', 'S02')];
    expect(weakestPlay(plays).repRank).toBe('2');
    expect(weakestPlay(plays, true).repRank).toBe('2');
  });
});

describe('chooseHeuristicPlay', () => {
  it('2だけを最後に残す弱い手より、2を先に処理する', () => {
    const four = singlePlay('4', 'S04');
    const two = singlePlay('2', 'S02');
    const hand = [four.cards[0]!, two.cards[0]!];

    expect(
      chooseHeuristicPlay([four, two], hand, BASE_STRENGTH_ORDER).repRank,
    ).toBe('2');
  });

  it('2・8だけが残る手を避けられるなら避ける', () => {
    const four = singlePlay('4', 'S04');
    const eight = singlePlay('8', 'S08');
    const two = singlePlay('2', 'S02');
    const hand = [four.cards[0]!, eight.cards[0]!, two.cards[0]!];

    expect(
      chooseHeuristicPlay([four, eight, two], hand, BASE_STRENGTH_ORDER)
        .repRank,
    ).toBe('8');
  });

  it('全候補が3・8・2・Jokerだけを残す場合も合法手を返す', () => {
    const three = singlePlay('3', 'S03');
    const eight = singlePlay('8', 'S08');
    const joker = singlePlay('joker', 'JK0');
    const hand = [three.cards[0]!, eight.cards[0]!, joker.cards[0]!];

    expect(
      chooseHeuristicPlay([three, eight, joker], hand, BASE_STRENGTH_ORDER)
        .repRank,
    ).toBe('3');
  });
});
