import { describe, expect, it } from 'vitest';

import { CX_JUDGE_CORPUS } from './judge-corpus.js';

describe('CX-01 evaluation corpus', () => {
  it('A4〜C3のrejectとA1〜A3のneeds_review境界、approve境界を含む', () => {
    for (const subtype of [
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
    // A2〜A3（語彙外の状態・エンジン拡張）は契約拡張候補なので needs_review
    for (const id of ['A2', 'A3']) {
      expect(
        CX_JUDGE_CORPUS.find((c) => c.id === id)?.expected.verdict,
        id,
      ).toBe('needs_review');
    }
    // A1（カード選択＋相手選択の二段階入力）は contract v2 で表現できるので approve
    expect(
      CX_JUDGE_CORPUS.find((c) => c.id === 'A1')?.expected.verdict,
      'A1',
    ).toBe('approve');
    expect(
      CX_JUDGE_CORPUS.filter(({ expected }) => expected.verdict === 'approve')
        .length,
    ).toBeGreaterThanOrEqual(8);
    expect(
      CX_JUDGE_CORPUS.filter(
        ({ expected }) => expected.verdict === 'needs_review',
      ).length,
    ).toBeGreaterThanOrEqual(6);
    expect(CX_JUDGE_CORPUS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CX_JUDGE_CORPUS.map(({ id }) => id)).size).toBe(
      CX_JUDGE_CORPUS.length,
    );
  });
});
