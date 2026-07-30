import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
      onOpenActivation={() => undefined}
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

describe('contract v2 choice UI', () => {
  afterEach(cleanup);

  it('入力待ちでは選択枚数を案内し、パスを無効にして捨てる操作を表示する', () => {
    render(
      <GameScreen
        gameLabel="第1戦"
        activeRuleCount={1}
        seats={DEMO_SEATS}
        leadSeatName={null}
        activations={[]}
        onCutInDone={() => undefined}
        lastActivation={null}
        hand={DEMO_HAND}
        selectedCardIds={[]}
        isMyTurn
        canPlay={false}
        canPass={false}
        playLabel="えらんだ2枚を捨てる"
        actionPrompt="10捨て: カードを2枚選んでください"
        onViewRules={() => undefined}
        onOpenActivation={() => undefined}
        onToggleCard={() => undefined}
        onPlay={() => undefined}
        onPass={() => undefined}
      />,
    );

    expect(screen.getByText('10捨て: カードを2枚選んでください')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'パス' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(
      screen
        .getByRole('button', { name: 'えらんだ2枚を捨てる' })
        .hasAttribute('disabled'),
    ).toBe(true);
  });
});

describe('DS-04: 自分の手番が手札トレイで分かる', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('自分の番は手札トレイに「あなたの番」と残り時間バーを出す', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    render(<GameScreen {...game([]).props} isMyTurn turnDeadlineAt={61_000} />);

    const tray = screen.getByLabelText('あなたの手札');
    expect(within(tray).getByText('あなたの番')).toBeTruthy();
    const timer = within(tray).getByRole('timer', { name: '手番 残り60秒' });
    expect(timer.textContent).toBe('');
    expect(
      timer
        .querySelector<HTMLElement>('[style]')
        ?.style.getPropertyValue('--turn-remaining'),
    ).toBe('1');

    act(() => {
      vi.advanceTimersByTime(51_000);
    });
    expect(
      within(tray).getByRole('timer', { name: '手番 残り9秒' }),
    ).toBeTruthy();
  });

  it('相手の番では残り時間バーを出さない', () => {
    render(
      <GameScreen
        {...game([]).props}
        isMyTurn={false}
        turnDeadlineAt={61_000}
      />,
    );

    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.queryByText('あなたの番')).toBeNull();
  });

  it('相手の番でも自分の札は読める', () => {
    render(<GameScreen {...game([]).props} isMyTurn={false} />);

    expect(screen.getByRole('button', { name: 'クラブの3' })).toBeTruthy();
  });
});

describe('TU-02: 出せるカード案内', () => {
  afterEach(cleanup);

  it('dimmedのカードをタップしても選択せず、拒否フィードバックだけを返す', async () => {
    const user = userEvent.setup();
    const onToggleCard = vi.fn();
    const onDimmedCardTap = vi.fn();
    render(
      <GameScreen
        {...game([]).props}
        isMyTurn
        cardHints={new Map([['h-c3', 'dimmed']])}
        onToggleCard={onToggleCard}
        onDimmedCardTap={onDimmedCardTap}
      />,
    );

    const card = screen.getByRole('button', { name: 'クラブの3' });
    expect(card.getAttribute('aria-disabled')).toBe('true');

    await user.click(card);

    expect(onToggleCard).not.toHaveBeenCalled();
    expect(onDimmedCardTap).toHaveBeenCalledWith('h-c3');
  });
});
