import type { BinaryQuizMiniGameView } from '@daifugo/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BinaryQuizMiniGame } from './BinaryQuizMiniGame';

const game: BinaryQuizMiniGameView = {
  id: 'quiz-1',
  kind: 'binary_quiz_race',
  phase: 'answering',
  round: 2,
  elapsedMs: 5_000,
  phaseElapsedMs: 1_000,
  roundDurationMs: 4_000,
  defaultOption: 'a',
  targetScore: 3,
  maxRounds: 12,
  question: {
    id: 'general_v1_001',
    prompt: '2 + 2 はどちら？',
    options: [
      { id: 'a', label: '4' },
      { id: 'b', label: '5' },
    ],
  },
  hasAnswered: false,
  scores: [
    { seat: 0, score: 1 },
    { seat: 1, score: 0 },
  ],
  lastRound: null,
  winnerSeats: [],
};

describe('BinaryQuizMiniGame', () => {
  afterEach(cleanup);

  it('問題、選択肢、権威残り時間、得点を表示して回答を送る', () => {
    const onAnswer = vi.fn();
    render(
      <BinaryQuizMiniGame
        game={game}
        yourSeat={0}
        names={{ 0: 'あなた', 1: '相手' }}
        onAnswer={onAnswer}
      />,
    );

    expect(screen.getByText('2 + 2 はどちら？')).toBeTruthy();
    expect(screen.getByText('3.0')).toBeTruthy();
    expect(
      screen.getByText('4秒以内にAかBを選んでください。未回答はAになります。'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'A: 4' }));
    expect(onAnswer).toHaveBeenCalledWith(2, 'a');
  });

  it('回答後は再回答を無効にし、確定前の正解を表示しない', () => {
    render(
      <BinaryQuizMiniGame
        game={{ ...game, hasAnswered: true }}
        yourSeat={0}
        names={{ 0: 'あなた' }}
        onAnswer={vi.fn()}
      />,
    );

    expect(
      (screen.getByRole('button', { name: 'A: 4' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByText('✓')).toBeNull();
  });

  it('同時到達した勝者全員を表示する', () => {
    render(
      <BinaryQuizMiniGame
        game={{
          ...game,
          phase: 'result',
          question: { ...game.question!, correctOption: 'a' },
          winnerSeats: [0, 1],
        }}
        yourSeat={0}
        names={{ 0: 'あなた', 1: '相手' }}
        onAnswer={vi.fn()}
      />,
    );

    expect(screen.getByText('勝者: あなた、相手')).toBeTruthy();
  });
});
