import { describe, expect, it } from 'vitest';

import { computePopularityScore, POPULARITY_PRIOR } from './score.js';

describe('popularity score', () => {
  it.each([
    [0, 0, 0.5],
    [1, 0, 6 / 11],
    [0, 1, 5 / 11],
    [2, 1, 7 / 13],
    [20, 80, 25 / 110],
  ])('up=%i down=%i を Beta(5,5) で平滑化する', (up, down, expected) => {
    expect(computePopularityScore(up, down)).toBeCloseTo(expected, 12);
  });

  it('定数を正準値として公開し、不正な票数を拒否する', () => {
    expect(POPULARITY_PRIOR).toEqual({ alpha: 5, beta: 5 });
    expect(() => computePopularityScore(-1, 0)).toThrow(
      'Popularity counts must be non-negative integers',
    );
    expect(() => computePopularityScore(0.5, 0)).toThrow(
      'Popularity counts must be non-negative integers',
    );
  });
});
