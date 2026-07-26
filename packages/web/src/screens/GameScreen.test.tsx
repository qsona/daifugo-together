import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEMO_HAND, DEMO_SEATS } from '../fixtures/demo';

import { GameScreen, type SeatFinish } from './GameScreen';

const FINISH_B: SeatFinish = {
  seat: 1,
  name: 'プレイヤーB',
  isSelf: false,
  rank: 1,
  title: '大富豪',
};

const FINISH_SELF: SeatFinish = {
  seat: 0,
  name: 'あなた',
  isSelf: true,
  rank: 2,
  title: '富豪',
};

function game(finishes: readonly SeatFinish[]) {
  return (
    <GameScreen
      gameLabel="第1戦"
      activeRuleCount={31}
      seats={DEMO_SEATS}
      leadSeatName={null}
      finishes={finishes}
      activations={[]}
      onCutInDone={() => undefined}
      lastActivation={null}
      hand={DEMO_HAND}
      selectedCardIds={[]}
      isMyTurn={false}
      onViewRules={() => undefined}
      onToggleCard={() => undefined}
      onPlay={() => undefined}
      onPass={() => undefined}
    />
  );
}

describe('T1: あがりの認知', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('あがりが増えた瞬間だけ告知を出し、数秒で引く', () => {
    vi.useFakeTimers();
    const { rerender } = render(game([]));

    expect(screen.queryByText(/であがり/)).toBeNull();

    rerender(game([FINISH_B]));
    expect(screen.getByText('プレイヤーBが1位であがり!')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText(/であがり/)).toBeNull();
  });

  it('自分があがったときは「あなた」表記にする', () => {
    const { rerender } = render(game([FINISH_B]));

    rerender(game([FINISH_B, FINISH_SELF]));

    expect(screen.getByText('あなたが2位であがり!')).toBeTruthy();
  });

  it('同じ更新で複数人があがったときは最新の1件だけを告知する', () => {
    const { rerender } = render(game([]));

    rerender(game([FINISH_B, FINISH_SELF]));

    expect(screen.getByText('あなたが2位であがり!')).toBeTruthy();
    expect(screen.queryByText('プレイヤーBが1位であがり!')).toBeNull();
  });

  /*
   * 再接続では全量スナップショットが届き、履歴の playerFinished がまとめて入る。
   * 告知は「初回描画時点の件数」を基準に増分だけを出すので、
   * 既にあがっていた分が演出し直されることはない。
   */
  it('初回描画時点で既にあるあがりは告知しない(再接続で再演出しない)', () => {
    render(game([FINISH_B, FINISH_SELF]));

    expect(screen.queryByText(/であがり/)).toBeNull();
  });
});

describe('DS-04: 手番残り時間バー', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('残り時間をテキスト本文ではなく左基点のバーで示す', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    render(<GameScreen {...game([]).props} turnDeadlineAt={61_000} />);

    const timer = screen.getByRole('timer', { name: '手番 残り60秒' });
    expect(timer.textContent).toBe('');
    expect(
      timer
        .querySelector<HTMLElement>('[style]')
        ?.style.getPropertyValue('--turn-remaining'),
    ).toBe('1');

    act(() => {
      vi.advanceTimersByTime(51_000);
    });
    expect(screen.getByRole('timer', { name: '手番 残り9秒' })).toBeTruthy();
  });
});
