import { describe, expect, it } from 'vitest';

import { orderPlayCards, type Play } from './play.js';

const natural = (rank: '3' | '4' | '5' | '6' | '7', id = rank) => ({
  kind: 'natural' as const,
  id,
  suit: 'spade' as const,
  rank,
});

const joker = (index: 0 | 1) => ({
  kind: 'joker' as const,
  id: `JK${String(index)}`,
  index,
});

function sequence(cards: Play['cards'], repRank: Play['repRank']): Play {
  return {
    kind: 'sequence',
    cards,
    count: cards.length,
    repRank,
  };
}

describe('orderPlayCards', () => {
  it('sequenceの内部順をそのまま表示順として使う', () => {
    const play = sequence(
      [natural('4'), joker(0), natural('6'), natural('7')],
      '7',
    );

    expect(orderPlayCards(play).map((card) => card.id)).toEqual([
      '4',
      'JK0',
      '6',
      '7',
    ]);
  });

  it('sequence以外は従来のカード順を維持する', () => {
    const play: Play = {
      kind: 'set',
      cards: [natural('4'), joker(0)],
      count: 2,
      repRank: '4',
    };

    expect(orderPlayCards(play).map((card) => card.id)).toEqual(['4', 'JK0']);
  });
});
