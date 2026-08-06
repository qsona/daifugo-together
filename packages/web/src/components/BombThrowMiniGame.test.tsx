import type { MultiplayerGameView } from '@daifugo/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BombThrowMiniGame } from './BombThrowMiniGame';

const game: NonNullable<MultiplayerGameView['miniGame']> = {
  id: 'mini-1',
  kind: 'bomb_throw_15',
  phase: 'playing',
  elapsedMs: 6_000,
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
    expect(screen.getByLabelText('あなた（自分）').dataset.you).toBe('true');
    expect(screen.getByLabelText('あなた（自分）').textContent).toContain(
      'YOU',
    );
    expect(screen.getByLabelText('相手').dataset.you).toBeUndefined();
  });

  it('最初の1秒はリアルボンバーのカットインだけを表示する', () => {
    render(
      <BombThrowMiniGame
        game={{ ...game, phase: 'countdown', elapsedMs: 400 }}
        yourSeat={0}
        names={{ 0: 'あなた' }}
        onCommand={vi.fn()}
      />,
    );

    expect(screen.getByText('リアルボンバー')).toBeTruthy();
    expect(screen.getByText('BOMB THROW BATTLE')).toBeTruthy();
    expect(screen.queryByText('爆弾を投げて相手に当てろ！')).toBeNull();
  });

  it.each([
    [1_000, '3秒後に開始'],
    [2_000, '2秒後に開始'],
    [3_000, '1秒後に開始'],
  ])('遊び方を示しながら3カウントする (%i ms)', (elapsedMs, label) => {
    render(
      <BombThrowMiniGame
        game={{ ...game, phase: 'countdown', elapsedMs }}
        yourSeat={0}
        names={{ 0: 'あなた' }}
        onCommand={vi.fn()}
      />,
    );

    expect(screen.getByText('爆弾を投げて相手に当てろ！')).toBeTruthy();
    expect(screen.getByText('「YOU」のカードがあなた！')).toBeTruthy();
    expect(screen.getByText('爆弾：Space・Enter・THROW')).toBeTruthy();
    expect(screen.getByLabelText(label)).toBeTruthy();
  });

  it('観戦者にはYOU表示を付けない', () => {
    render(
      <BombThrowMiniGame
        game={game}
        yourSeat={null}
        names={{ 0: 'プレイヤー1', 1: 'プレイヤー2' }}
        onCommand={vi.fn()}
      />,
    );

    expect(screen.queryByText('YOU')).toBeNull();
    expect(document.querySelector('[data-you="true"]')).toBeNull();
  });

  it('説明とカウント中は操作コマンドを送らない', () => {
    const onCommand = vi.fn();
    render(
      <BombThrowMiniGame
        game={{ ...game, phase: 'countdown', elapsedMs: 1_400 }}
        yourSeat={0}
        names={{ 0: 'あなた' }}
        onCommand={onCommand}
      />,
    );

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: ' ' });

    expect(onCommand).not.toHaveBeenCalled();
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

  it('スマホ用十字キーを長押しし、指を離すか外すと停止する', () => {
    const onCommand = vi.fn();
    render(
      <BombThrowMiniGame
        game={game}
        yourSeat={0}
        names={{ 0: 'あなた' }}
        onCommand={onCommand}
      />,
    );

    const up = screen.getByRole('button', { name: '上へ移動' });
    fireEvent.pointerDown(up, { pointerId: 1 });
    fireEvent.pointerUp(up, { pointerId: 1 });
    fireEvent.pointerDown(up, { pointerId: 2 });
    fireEvent.pointerLeave(up, { pointerId: 2 });

    expect(onCommand).toHaveBeenNthCalledWith(1, { direction: 'up' });
    expect(onCommand).toHaveBeenNthCalledWith(2, { direction: 'stop' });
    expect(onCommand).toHaveBeenNthCalledWith(3, { direction: 'up' });
    expect(onCommand).toHaveBeenNthCalledWith(4, { direction: 'stop' });
  });

  it('スマホ用の爆弾ボタンで投擲する', () => {
    const onCommand = vi.fn();
    render(
      <BombThrowMiniGame
        game={game}
        yourSeat={0}
        names={{ 0: 'あなた' }}
        onCommand={onCommand}
      />,
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: '爆弾を投げる' }));

    expect(onCommand).toHaveBeenCalledWith({ throwBomb: true });
  });
});
