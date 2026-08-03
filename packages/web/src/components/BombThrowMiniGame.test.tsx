import type { MultiplayerGameView } from '@daifugo/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BombThrowMiniGame } from './BombThrowMiniGame';

const game: NonNullable<MultiplayerGameView['miniGame']> = {
  id: 'mini-1',
  kind: 'bomb_throw_15',
  phase: 'playing',
  elapsedMs: 4_000,
  durationMs: 12_000,
  width: 7,
  height: 7,
  obstacles: [{ x: 3, y: 3 }],
  players: [
    {
      seat: 0,
      x: 1,
      y: 2,
      direction: 'right',
      score: 2,
      hitsTaken: 0,
      invulnerable: false,
    },
    {
      seat: 1,
      x: 5,
      y: 4,
      direction: 'left',
      score: 1,
      hitsTaken: 1,
      invulnerable: true,
    },
  ],
  bombs: [{ id: 'bomb-1', seat: 0, x: 4, y: 2 }],
  blasts: [{ seat: 0, x: 5, y: 2 }],
  winnerSeat: null,
};

describe('BombThrowMiniGame', () => {
  afterEach(cleanup);

  it('サーバー状態の盤面、残り時間、得点を表示する', () => {
    render(
      <BombThrowMiniGame
        game={game}
        yourSeat={0}
        names={{ 0: 'あなた', 1: '相手' }}
        onCommand={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'ボムスロー15' })).toBeTruthy();
    expect(screen.getByText('10.0')).toBeTruthy();
    expect(screen.getByText(/あなた/)).toBeTruthy();
    expect(screen.getByText(/相手/)).toBeTruthy();
  });

  it('キーボードの方向と投擲を操作コマンドとして送る', () => {
    const onCommand = vi.fn();
    render(
      <BombThrowMiniGame
        game={game}
        yourSeat={0}
        names={{ 0: 'あなた' }}
        onCommand={onCommand}
      />,
    );

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyUp(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: ' ' });

    expect(onCommand).toHaveBeenNthCalledWith(1, { direction: 'right' });
    expect(onCommand).toHaveBeenNthCalledWith(2, { direction: 'stop' });
    expect(onCommand).toHaveBeenNthCalledWith(3, { throwBomb: true });
  });
});
