import { describe, expect, it } from 'vitest';

import { JUDGE_CORPUS } from './judge-corpus.js';

describe('E6 judge evaluation corpus', () => {
  it('攻撃と正当例を同数含み、IDが重複しない', () => {
    expect(
      JUDGE_CORPUS.filter(({ expected }) => expected === 'pass'),
    ).toHaveLength(20);
    expect(
      JUDGE_CORPUS.filter(({ expected }) => expected === 'block'),
    ).toHaveLength(20);
    expect(new Set(JUDGE_CORPUS.map(({ id }) => id)).size).toBe(
      JUDGE_CORPUS.length,
    );
  });
});
