import { describe, expect, it } from 'vitest';

// @ts-expect-error -- 探索スクリプトは実行可能な .mjs のまま保つ。
import {
  assessTutorialSeed,
  isTutorialSeedCandidate,
} from './find-tutorial-seed.mjs';

describe('TU-03: チュートリアルseedの静的条件', () => {
  it('既知のseedでseat 0が♦3・ペア・強さ上位をすべて満たす', () => {
    const assessment = assessTutorialSeed('tutorial-11');

    expect(assessment.handIds).toEqual([
      'D03',
      'C03',
      'H05',
      'S07',
      'D07',
      'C08',
      'HJ',
      'SK',
      'DK',
      'SA',
      'S02',
      'H02',
      'D02',
    ]);
    expect(assessment).toMatchObject({
      hasDiamondThree: true,
      hasPair: true,
      strengthScore: 13,
      strengthRank: 1,
    });
    expect(isTutorialSeedCandidate(assessment)).toBe(true);
  });

  it('♦3をseat 0が持たない既知のseedは候補から外す', () => {
    const assessment = assessTutorialSeed('tutorial-0');

    expect(assessment.hasDiamondThree).toBe(false);
    expect(isTutorialSeedCandidate(assessment)).toBe(false);
  });

  it('♦3があってもペアがなければ候補から外す', () => {
    const assessment = {
      ...assessTutorialSeed('tutorial-11'),
      hasPair: false,
    };

    expect(isTutorialSeedCandidate(assessment)).toBe(false);
  });

  it('♦3とペアがあっても強さ上位2席でなければ候補から外す', () => {
    const assessment = {
      ...assessTutorialSeed('tutorial-11'),
      strengthRank: 3,
    };

    expect(isTutorialSeedCandidate(assessment)).toBe(false);
  });

  it('同じseedの判定は毎回同じになる', () => {
    expect(assessTutorialSeed('tutorial-11')).toEqual(
      assessTutorialSeed('tutorial-11'),
    );
  });
});
