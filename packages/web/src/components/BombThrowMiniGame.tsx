import type { MultiplayerGameView, SeatId } from '@daifugo/core';
import { useEffect } from 'react';

import styles from './BombThrowMiniGame.module.css';

type MiniGame = NonNullable<MultiplayerGameView['miniGame']>;
type Direction = MiniGame['players'][number]['direction'];

const SUITS = ['♠', '♥', '♦', '♣'] as const;

export interface BombThrowMiniGameProps {
  game: MiniGame;
  yourSeat: SeatId | null;
  names: Partial<Record<SeatId, string>>;
  onCommand: (input: { direction?: Direction; throwBomb?: boolean }) => void;
}

function remainingSeconds(game: MiniGame): string {
  const remaining =
    game.phase === 'countdown'
      ? 2_000 - game.elapsedMs
      : game.phase === 'playing'
        ? 2_000 + game.durationMs - game.elapsedMs
        : 0;
  return (Math.max(0, remaining) / 1_000).toFixed(1);
}

export function BombThrowMiniGame({
  game,
  yourSeat,
  names,
  onCommand,
}: BombThrowMiniGameProps) {
  const participating = game.players.some((player) => player.seat === yourSeat);

  useEffect(() => {
    if (!participating || game.phase === 'result') return undefined;
    const directionByKey: Partial<Record<string, Direction>> = {
      ArrowUp: 'up',
      w: 'up',
      ArrowDown: 'down',
      s: 'down',
      ArrowLeft: 'left',
      a: 'left',
      ArrowRight: 'right',
      d: 'right',
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = directionByKey[event.key];
      if (direction) {
        event.preventDefault();
        if (!event.repeat) onCommand({ direction });
      } else if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (!event.repeat) onCommand({ throwBomb: true });
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (directionByKey[event.key]) onCommand({ direction: 'stop' });
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [game.phase, onCommand, participating]);

  return (
    <div className={styles.backdrop} role="dialog" aria-label="ボムスロー15">
      <section className={styles.panel}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>REAL BOMBER · ♠ ♥ ♦ ♣</p>
            <h2>ボムスロー15</h2>
          </div>
          <strong className={styles.timer}>
            {game.phase === 'countdown'
              ? 'READY'
              : game.phase === 'playing'
                ? remainingSeconds(game)
                : 'RESULT'}
          </strong>
        </header>

        <div
          className={styles.arena}
          style={{
            gridTemplateColumns: `repeat(${String(game.width)}, 1fr)`,
            gridTemplateRows: `repeat(${String(game.height)}, 1fr)`,
          }}
        >
          {Array.from({ length: game.width * game.height }, (_, index) => (
            <span key={`cell-${String(index)}`} className={styles.cell} />
          ))}
          {game.obstacles.map((obstacle) => (
            <span
              key={`obstacle-${String(obstacle.x)}-${String(obstacle.y)}`}
              className={styles.obstacle}
              style={{ gridColumn: obstacle.x + 1, gridRow: obstacle.y + 1 }}
            >
              ♠
            </span>
          ))}
          {game.bombs.map((bomb) => (
            <span
              key={bomb.id}
              className={styles.bomb}
              style={{ gridColumn: bomb.x + 1, gridRow: bomb.y + 1 }}
            />
          ))}
          {game.blasts.map((blast, index) => (
            <span
              key={`blast-${String(blast.x)}-${String(blast.y)}-${String(index)}`}
              className={styles.blast}
              style={{ gridColumn: blast.x + 1, gridRow: blast.y + 1 }}
            >
              {SUITS[blast.seat]}
            </span>
          ))}
          {game.players.map((player) => (
            <span
              key={player.seat}
              className={`${styles.player} ${player.invulnerable ? styles.invulnerable : ''}`}
              data-seat={player.seat}
              style={{ gridColumn: player.x + 1, gridRow: player.y + 1 }}
              aria-label={
                names[player.seat] ?? `プレイヤー${String(player.seat + 1)}`
              }
            >
              {SUITS[player.seat]}
            </span>
          ))}
          {game.phase === 'countdown' && (
            <div className={styles.curtain}>爆弾を投げて命中させろ！</div>
          )}
          {game.phase === 'result' && game.winnerSeat !== null && (
            <div className={styles.curtain}>
              <span className={styles.winnerSuit}>
                {SUITS[game.winnerSeat]}
              </span>
              {names[game.winnerSeat] ??
                `プレイヤー${String(game.winnerSeat + 1)}`}
              の勝ち！
            </div>
          )}
        </div>

        <div className={styles.scoreboard}>
          {[...game.players]
            .sort((a, b) => b.score - a.score || a.hitsTaken - b.hitsTaken)
            .map((player) => (
              <span key={player.seat} data-seat={player.seat}>
                {SUITS[player.seat]}{' '}
                {names[player.seat] ?? `P${String(player.seat + 1)}`}{' '}
                <b>{player.score}</b>
              </span>
            ))}
        </div>

        {participating && game.phase !== 'result' ? (
          <div className={styles.controls}>
            <div className={styles.dpad}>
              <button
                onPointerDown={() => onCommand({ direction: 'up' })}
                onPointerUp={() => onCommand({ direction: 'stop' })}
              >
                ▲
              </button>
              <button
                onPointerDown={() => onCommand({ direction: 'left' })}
                onPointerUp={() => onCommand({ direction: 'stop' })}
              >
                ◀
              </button>
              <button
                onPointerDown={() => onCommand({ direction: 'down' })}
                onPointerUp={() => onCommand({ direction: 'stop' })}
              >
                ▼
              </button>
              <button
                onPointerDown={() => onCommand({ direction: 'right' })}
                onPointerUp={() => onCommand({ direction: 'stop' })}
              >
                ▶
              </button>
            </div>
            <button
              className={styles.throwButton}
              onPointerDown={() => onCommand({ throwBomb: true })}
            >
              THROW
            </button>
          </div>
        ) : (
          <p className={styles.spectating}>対戦を観戦中…</p>
        )}
      </section>
    </div>
  );
}
