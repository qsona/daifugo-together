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
