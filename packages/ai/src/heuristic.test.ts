import { BASE_STRENGTH_ORDER, CARD_RANKS } from '@daifugo/core';
import type { Play } from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { sortPlaysWeakFirst, weakestPlay } from './heuristic.js';

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
