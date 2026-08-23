import { describe, expect, it } from 'vitest';

import { BINARY_QUIZ_QUESTION_SET_IDS, binaryQuizQuestion } from './catalog.js';

describe('二択クイズ問題カタログ', () => {
  it('general_v1から同じseedで同じ未出題問題を選ぶ', () => {
    const input = {
      questionSet: 'general_v1',
      seed: 'same-seed',
      round: 1,
      usedQuestionIds: [],
    };

    expect(binaryQuizQuestion(input)).toEqual(binaryQuizQuestion(input));
    expect(BINARY_QUIZ_QUESTION_SET_IDS).toContain('general_v1');
  });

  it('使用済み問題を再出題せず、不明なsetはnullにする', () => {
    const first = binaryQuizQuestion({
      questionSet: 'general_v1',
      seed: 'seed',
      round: 1,
      usedQuestionIds: [],
    });
    const second = binaryQuizQuestion({
      questionSet: 'general_v1',
      seed: 'seed',
      round: 2,
      usedQuestionIds: first ? [first.id] : [],
    });

    expect(first).not.toBeNull();
    expect(second?.id).not.toBe(first?.id);
    expect(
      binaryQuizQuestion({
        questionSet: 'missing',
        seed: 'seed',
        round: 1,
        usedQuestionIds: [],
      }),
    ).toBeNull();
  });
});
