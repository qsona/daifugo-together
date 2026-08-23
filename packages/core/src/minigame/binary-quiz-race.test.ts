import { describe, expect, it } from 'vitest';

import {
  advanceBinaryQuizRace,
  answerBinaryQuiz,
  binaryQuizRaceComplete,
  binaryQuizRaceResult,
  createBinaryQuizRace,
  setBinaryQuizQuestion,
  type BinaryQuizQuestion,
  type BinaryQuizRaceState,
} from './binary-quiz-race.js';

function question(round: number, correctOption: 'a' | 'b' = 'a') {
  return {
    id: `question_${String(round)}`,
    prompt: `問題${String(round)}`,
    options: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    correctOption,
  } satisfies BinaryQuizQuestion;
}

function start(
  input: {
    targetScore?: number;
    maxRounds?: number;
    roundDurationMs?: number;
  } = {},
): BinaryQuizRaceState {
  return createBinaryQuizRace({
    id: 'quiz',
    seed: 'seed',
    participants: ['p1', 'p2', 'p3'],
    questionSet: 'general_v1',
    defaultOption: 'a',
    roundDurationMs: input.roundDurationMs ?? 1_000,
    targetScore: input.targetScore ?? 3,
    maxRounds: input.maxRounds ?? 12,
  });
}

function finishRound(
  state: BinaryQuizRaceState,
  answers: Record<string, 'a' | 'b'>,
  correctOption: 'a' | 'b' = 'a',
): BinaryQuizRaceState {
  let next = setBinaryQuizQuestion(state, {
    round: state.round,
    question: question(state.round, correctOption),
  });
  for (const [playerId, option] of Object.entries(answers)) {
    next = answerBinaryQuiz(next, {
      playerId,
      round: next.round,
      option,
    });
  }
  next = advanceBinaryQuizRace(next, { deltaMs: next.roundDurationMs });
  return advanceBinaryQuizRace(next, { deltaMs: 1_000 });
}

describe('二択クイズレース', () => {
  it('回答を締切まで非公開状態に保持し、未回答を既定のAとして採点する', () => {
    let state = setBinaryQuizQuestion(start(), {
      round: 1,
      question: question(1, 'a'),
    });
    state = answerBinaryQuiz(state, {
      playerId: 'p1',
      round: 1,
      option: 'b',
    });

    expect(state.answers).toEqual({ p1: 'b' });
    state = advanceBinaryQuizRace(state, { deltaMs: 1_000 });

    expect(state.phase).toBe('reveal');
    expect(state.lastRound?.answers).toEqual({ p1: 'b', p2: 'a', p3: 'a' });
    expect(state.scores).toEqual({ p1: 0, p2: 1, p3: 1 });
  });

  it('同じラウンドで目標点へ達した全員を勝者として返す', () => {
    let state = start({ targetScore: 3 });
    state = finishRound(state, { p1: 'a', p2: 'a', p3: 'b' });
    state = finishRound(state, { p1: 'a', p2: 'a', p3: 'b' });
    state = finishRound(state, { p1: 'a', p2: 'a', p3: 'b' });

    expect(state.phase).toBe('result');
    expect(state.winnerPlayerIds).toEqual(['p1', 'p2']);
    state = advanceBinaryQuizRace(state, { deltaMs: 1_000 });
    expect(binaryQuizRaceComplete(state)).toBe(true);
    expect(binaryQuizRaceResult(state)).toEqual({
      miniGameId: 'quiz',
      winnerPlayerIds: ['p1', 'p2'],
      scores: { p1: { score: 3 }, p2: { score: 3 }, p3: { score: 0 } },
    });
  });

  it('最大ラウンドでは最高得点者全員を勝者にして必ず終了する', () => {
    let state = start({ maxRounds: 3 });
    state = finishRound(state, { p1: 'a', p2: 'b', p3: 'b' });
    state = finishRound(state, { p1: 'b', p2: 'a', p3: 'b' });
    state = finishRound(state, { p1: 'b', p2: 'b', p3: 'b' });

    expect(state.phase).toBe('result');
    expect(state.scores).toEqual({ p1: 1, p2: 1, p3: 0 });
    expect(state.winnerPlayerIds).toEqual(['p1', 'p2']);
  });

  it('AI回答は同じseedと参加者なら決定的である', () => {
    const run = () => {
      let state = setBinaryQuizQuestion(start(), {
        round: 1,
        question: question(1),
      });
      state = advanceBinaryQuizRace(state, {
        automatedPlayerIds: ['p1', 'p2', 'p3'],
      });
      return state.answers;
    };

    expect(run()).toEqual(run());
    expect(Object.keys(run())).toHaveLength(3);
  });

  it('同じ問題ID、同じプレイヤーの再回答、古いラウンド回答を受理しない', () => {
    let state = setBinaryQuizQuestion(start(), {
      round: 1,
      question: question(1),
    });
    state = answerBinaryQuiz(state, {
      playerId: 'p1',
      round: 1,
      option: 'a',
    });
    const duplicate = answerBinaryQuiz(state, {
      playerId: 'p1',
      round: 1,
      option: 'b',
    });
    const stale = answerBinaryQuiz(state, {
      playerId: 'p2',
      round: 0,
      option: 'b',
    });

    expect(duplicate).toBe(state);
    expect(stale).toBe(state);
  });
});
