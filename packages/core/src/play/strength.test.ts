import { describe, expect, it } from 'vitest';

import {
  BASE_STRENGTH_ORDER,
  compareRanks,
  rankPosition,
  type StrengthOrder,
} from './strength.js';

describe('StrengthOrder comparisonOverrides', () => {
  it('指定した2ランク間だけ通常の位置関係を上書きする', () => {
    const order: StrengthOrder = {
      ...BASE_STRENGTH_ORDER,
      comparisonOverrides: [{ stronger: '3', weaker: 'joker' }],
    };

    expect(compareRanks('3', 'joker', order)).toBeGreaterThan(0);
    expect(compareRanks('joker', '3', order)).toBeLessThan(0);
    expect(compareRanks('4', 'joker', order)).toBeLessThan(0);
    expect(rankPosition('joker', order)).toBe(order.ranking.length);
  });

  it('同じ組への複数指定は配列の後方を優先する', () => {
    const order: StrengthOrder = {
      ...BASE_STRENGTH_ORDER,
      comparisonOverrides: [
        { stronger: '3', weaker: 'joker' },
        { stronger: 'joker', weaker: '3' },
      ],
    };

    expect(compareRanks('joker', '3', order)).toBeGreaterThan(0);
    expect(compareRanks('3', 'joker', order)).toBeLessThan(0);
  });
});
