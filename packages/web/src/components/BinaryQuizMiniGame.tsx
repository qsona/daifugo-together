import type { BinaryQuizMiniGameView, SeatId } from '@daifugo/core';

import { Button } from './Button';
import styles from './BinaryQuizMiniGame.module.css';

export interface BinaryQuizMiniGameProps {
  game: BinaryQuizMiniGameView;
  yourSeat: SeatId | null;
  names: Partial<Record<SeatId, string>>;
  onAnswer: (round: number, option: 'a' | 'b') => void;
}

function remainingSeconds(game: BinaryQuizMiniGameView): string {
  if (game.phase !== 'answering') return '';
  return (
    Math.max(0, game.roundDurationMs - game.phaseElapsedMs) / 1_000
  ).toFixed(1);
}

export function BinaryQuizMiniGame({
  game,
  yourSeat,
  names,
  onAnswer,
}: BinaryQuizMiniGameProps) {
  const participating = game.scores.some(({ seat }) => seat === yourSeat);
  const correctOption = game.question?.correctOption;
  const winnerNames = game.winnerSeats.map(
    (seat) => names[seat] ?? `プレイヤー${String(seat + 1)}`,
  );

  return (
    <div className={styles.backdrop} role="dialog" aria-label="二択クイズ">
      <section className={styles.panel}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>BINARY QUIZ RACE</p>
            <h2>二択クイズ</h2>
          </div>
          <strong className={styles.timer}>
            {game.phase === 'answering'
              ? remainingSeconds(game)
              : `${String(game.round)} / ${String(game.maxRounds)}`}
          </strong>
        </header>

        <div className={styles.scoreboard} aria-label="得点">
          {game.scores.map(({ seat, score }) => (
            <span key={seat} data-you={seat === yourSeat ? 'true' : undefined}>
              {names[seat] ?? `P${String(seat + 1)}`} <b>{score}</b>
            </span>
          ))}
        </div>

        <div className={styles.question}>
          {game.question ? (
            <>
              <p className={styles.round}>QUESTION {String(game.round)}</p>
              <h3>{game.question.prompt}</h3>
              <div className={styles.options}>
                {game.question.options.map((option) => {
                  const correct =
                    correctOption !== undefined && option.id === correctOption;
                  return (
                    <Button
                      key={option.id}
                      block
                      variant={option.id === 'a' ? 'primary' : 'secondary'}
                      disabled={
                        !participating ||
                        game.phase !== 'answering' ||
                        game.hasAnswered
                      }
                      aria-label={`${option.id.toUpperCase()}: ${option.label}`}
                      data-correct={correct ? 'true' : undefined}
                      onClick={() => onAnswer(game.round, option.id)}
                    >
                      <strong>{option.id.toUpperCase()}</strong> {option.label}
                      {correct ? ' ✓' : ''}
                    </Button>
                  );
                })}
              </div>
            </>
          ) : (
            <p className={styles.waiting}>次の問題を準備中…</p>
          )}
        </div>

        <footer className={styles.footer}>
          {game.phase === 'answering' && game.hasAnswered
            ? '回答しました。全員の締切を待っています。'
            : game.phase === 'reveal'
              ? game.lastRound?.correctSeats.length
                ? `正解: ${game.lastRound.correctSeats
                    .map(
                      (seat) => names[seat] ?? `プレイヤー${String(seat + 1)}`,
                    )
                    .join('、')}`
                : 'この問題の正解者はいませんでした。'
              : game.phase === 'result'
                ? `勝者: ${winnerNames.join('、')}`
                : `${String(game.roundDurationMs / 1_000)}秒以内にAかBを選んでください。未回答は${game.defaultOption.toUpperCase()}になります。`}
        </footer>
      </section>
    </div>
  );
}
