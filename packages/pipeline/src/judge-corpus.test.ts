import { describe, expect, it } from 'vitest';

import { CX_JUDGE_CORPUS } from './judge-corpus.js';

describe('CX-01 evaluation corpus', () => {
  it('A1〜C3を各1件以上とapprove/needs_review境界を含む', () => {
    for (const subtype of [
      'A1',
      'A2',
      'A3',
      'A4',
      'B1',
      'B2',
      'B3',
      'B4',
      'B5',
      'C1',
      'C2',
      'C3',
    ]) {
      expect(
        CX_JUDGE_CORPUS.some(
          ({ expected }) => expected.rejectSubtype === subtype,
        ),
        subtype,
      ).toBe(true);
    }
    expect(
      CX_JUDGE_CORPUS.filter(({ expected }) => expected.verdict === 'approve')
        .length,
    ).toBeGreaterThanOrEqual(8);
    expect(
      CX_JUDGE_CORPUS.filter(
        ({ expected }) => expected.verdict === 'needs_review',
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(CX_JUDGE_CORPUS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CX_JUDGE_CORPUS.map(({ id }) => id)).size).toBe(
      CX_JUDGE_CORPUS.length,
    );
  });
});
