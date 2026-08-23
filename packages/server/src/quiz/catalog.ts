import {
  binaryQuizQuestionValid,
  type BinaryQuizQuestion,
} from '@daifugo/core';

import { matchPatterns } from '../injection/patterns.js';

const GENERAL_V1 = [
  {
    id: 'general_v1_001',
    prompt: '2 + 2 はどちら？',
    options: [
      { id: 'a', label: '4' },
      { id: 'b', label: '5' },
    ],
    correctOption: 'a',
  },
  {
    id: 'general_v1_002',
    prompt: '三角形の辺はいくつ？',
    options: [
      { id: 'a', label: '3本' },
      { id: 'b', label: '4本' },
    ],
    correctOption: 'a',
  },
  {
    id: 'general_v1_003',
    prompt: '1ダースはいくつ？',
    options: [
      { id: 'a', label: '10個' },
      { id: 'b', label: '12個' },
    ],
    correctOption: 'b',
  },
  {
    id: 'general_v1_004',
    prompt: '1キロメートルは何メートル？',
    options: [
      { id: 'a', label: '100メートル' },
      { id: 'b', label: '1000メートル' },
    ],
    correctOption: 'b',
  },
  {
    id: 'general_v1_005',
    prompt: '正方形の角はいくつ？',
    options: [
      { id: 'a', label: '4つ' },
      { id: 'b', label: '5つ' },
    ],
    correctOption: 'a',
  },
  {
    id: 'general_v1_006',
    prompt: '1週間は何日？',
    options: [
      { id: 'a', label: '7日' },
      { id: 'b', label: '8日' },
    ],
    correctOption: 'a',
  },
  {
    id: 'general_v1_007',
    prompt: '水が凍る温度はどちら？',
    options: [
      { id: 'a', label: '0℃' },
      { id: 'b', label: '100℃' },
    ],
    correctOption: 'a',
  },
  {
    id: 'general_v1_008',
    prompt: '地球の衛星はどちら？',
    options: [
      { id: 'a', label: '月' },
      { id: 'b', label: '火星' },
    ],
    correctOption: 'a',
  },
  {
    id: 'general_v1_009',
    prompt: 'ハートのカードの色はどちら？',
    options: [
      { id: 'a', label: '赤' },
      { id: 'b', label: '黒' },
    ],
    correctOption: 'a',
  },
  {
    id: 'general_v1_010',
    prompt: '通常のトランプでスートはいくつ？',
    options: [
      { id: 'a', label: '4種類' },
      { id: 'b', label: '5種類' },
    ],
    correctOption: 'a',
  },
  {
    id: 'general_v1_011',
    prompt: '五角形の辺はいくつ？',
    options: [
      { id: 'a', label: '5本' },
      { id: 'b', label: '6本' },
    ],
    correctOption: 'a',
  },
  {
    id: 'general_v1_012',
    prompt: '100 ÷ 4 はどちら？',
    options: [
      { id: 'a', label: '20' },
      { id: 'b', label: '25' },
    ],
    correctOption: 'b',
  },
] as const satisfies readonly BinaryQuizQuestion[];

const QUESTION_SETS = {
  general_v1: GENERAL_V1,
} as const satisfies Readonly<Record<string, readonly BinaryQuizQuestion[]>>;

export const BINARY_QUIZ_QUESTION_SET_IDS = Object.freeze(
  Object.keys(QUESTION_SETS),
);

function hash(value: string): number {
  let result = 2_166_136_261;
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0;
}

function validateQuestionSets(): void {
  for (const [setId, questions] of Object.entries(QUESTION_SETS)) {
    if (questions.length < 12) {
      throw new Error(`Binary quiz question set ${setId} needs 12 questions`);
    }
    if (new Set(questions.map(({ id }) => id)).size !== questions.length) {
      throw new Error(`Binary quiz question set ${setId} has duplicate ids`);
    }
    for (const question of questions) {
      if (!binaryQuizQuestionValid(question)) {
        throw new Error(
          `Binary quiz question is invalid: ${JSON.stringify(question)}`,
        );
      }
      const visibleText = [
        question.prompt,
        ...question.options.map(({ label }) => label),
      ];
      if (visibleText.some((text) => matchPatterns(text).hard.length > 0)) {
        throw new Error(`Binary quiz question ${question.id} is unsafe`);
      }
    }
  }
}

validateQuestionSets();

export function binaryQuizQuestion(input: {
  questionSet: string;
  seed: string;
  round: number;
  usedQuestionIds: readonly string[];
}): BinaryQuizQuestion | null {
  const questions =
    QUESTION_SETS[input.questionSet as keyof typeof QUESTION_SETS];
  if (!questions) return null;
  const used = new Set(input.usedQuestionIds);
  const next = questions
    .filter(({ id }) => !used.has(id))
    .toSorted(
      (left, right) =>
        hash(`${input.seed}:${String(input.round)}:${left.id}`) -
          hash(`${input.seed}:${String(input.round)}:${right.id}`) ||
        left.id.localeCompare(right.id),
    )[0];
  return next ? structuredClone(next) : null;
}
