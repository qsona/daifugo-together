import { useEffect, useState } from 'react';

import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEMO_HAND, DEMO_SEATS } from '../fixtures/demo';

import markerStyles from '../components/StateMarkers.module.css';

import {
  GameScreen,
  type CardDiscardNotice,
  type SeatFinish,
} from './GameScreen';

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
      onQuit={() => undefined}
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

  it('入力待ちでは発動中のルールと選択枚数を案内し、パスを無効にする', () => {
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
        playLabel="10捨てで2枚捨てる"
        actionRuleName="10捨て"
        actionPrompt="カードを2枚選んでください"
        onViewRules={() => undefined}
        onQuit={() => undefined}
        onOpenActivation={() => undefined}
        onToggleCard={() => undefined}
        onPlay={() => undefined}
        onPass={() => undefined}
      />,
    );

    expect(screen.getByRole('status', { name: '10捨て 発動中' })).toBeTruthy();
    expect(screen.getByText('カードを2枚選んでください')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'パス' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(
      screen
        .getByRole('button', { name: '10捨てで2枚捨てる' })
        .hasAttribute('disabled'),
    ).toBe(true);
  });
});

describe('10捨ての結果表示', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('新しく捨てた札をカード面つきで表示し、数秒で消す', () => {
    vi.useFakeTimers();
    const notice: CardDiscardNotice = {
      id: 'game-1:history-5',
      ruleName: '10捨て',
      playerName: 'あなた',
      cards: [
        { id: 'S03', suit: 'spade', rank: '3' },
        { id: 'H07', suit: 'heart', rank: '7' },
      ],
    };
    const { rerender } = render(
      <GameScreen {...game([]).props} discardNotices={[]} />,
    );

    rerender(<GameScreen {...game([]).props} discardNotices={[notice]} />);

    expect(screen.getByText('あなたの10捨て')).toBeTruthy();
    expect(screen.getByText('捨てたカード')).toBeTruthy();
    const result = screen.getByRole('status', {
      name: 'あなたが10捨てで捨てたカード',
    });
    expect(within(result).getByLabelText('スペードの3')).toBeTruthy();
    expect(within(result).getByLabelText('ハートの7')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(3200);
    });
    expect(screen.queryByText('あなたの10捨て')).toBeNull();
  });

  it('再接続時に履歴へ既にある捨て札は再表示しない', () => {
    const notice: CardDiscardNotice = {
      id: 'game-1:history-5',
      ruleName: '10捨て',
      playerName: 'プレイヤーB',
      cards: [{ id: 'D04', suit: 'diamond', rank: '4' }],
    };

    render(<GameScreen {...game([]).props} discardNotices={[notice]} />);

    expect(screen.queryByText('プレイヤーBの10捨て')).toBeNull();
  });
});

describe('対象者限定ルール通知', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('自分に届いた最新通知だけを表示し、時間経過で引く', () => {
    vi.useFakeTimers();
    render(
      <GameScreen
        {...game([]).props}
        privateRuleNotices={[
          {
            id: 1,
            ruleId: 'r-secret',
            name: '大富豪殺人事件',
            message: '2とジョーカーを出さずに、場を3回流してください。',
          },
        ]}
      />,
    );

    expect(
      screen.getByText('2とジョーカーを出さずに、場を3回流してください。'),
    ).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(6200);
    });
    expect(
      screen.queryByText('2とジョーカーを出さずに、場を3回流してください。'),
    ).toBeNull();
  });

  it('次のゲームでは通知IDが1に戻っても表示する', () => {
    const firstNotice = {
      id: 1,
      ruleId: 'r-secret',
      name: '秘密ルール',
      message: '第1戦の通知',
    };
    const { rerender } = render(
      <GameScreen
        {...game([]).props}
        gameLabel="第1戦"
        privateRuleNotices={[firstNotice]}
      />,
    );

    rerender(
      <GameScreen
        {...game([]).props}
        gameLabel="第2戦"
        privateRuleNotices={[{ ...firstNotice, message: '第2戦の通知' }]}
      />,
    );

    expect(screen.getByText('第2戦の通知')).toBeTruthy();
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

describe('継続状態の常設表示', () => {
  afterEach(cleanup);

  const STATUSES = [
    { ruleId: 'r-kakumei', name: '革命', scope: 'game' },
    {
      ruleId: 'r-shibari',
      name: 'しばり',
      scope: 'field',
      suits: ['spade'],
    },
  ] as const;

  it('局リボンと場チップを卓に出し、タップで詳細導線を呼ぶ', async () => {
    const user = userEvent.setup();
    const onOpenActivation = vi.fn();
    render(
      <GameScreen
        {...game([]).props}
        statuses={STATUSES}
        onOpenActivation={onOpenActivation}
      />,
    );

    const table = screen.getByRole('region', { name: '卓' });
    const ribbon = within(table).getByRole('button', {
      name: '革命 — 継続中。タップで説明',
    });
    const chip = within(table).getByRole('button', {
      name: 'スペードのしばり — 継続中。タップで説明',
    });
    // スートは図形(SuitMark)なので、チップの文字はルール名だけ。
    expect(chip.textContent).toBe('しばり');

    await user.click(ribbon);
    await user.click(chip);

    expect(onOpenActivation.mock.calls).toEqual([['r-kakumei'], ['r-shibari']]);
  });

  it('マーカーが出ているルールの発動チップは出さず、一発ものだけ残す', () => {
    const { rerender } = render(
      <GameScreen
        {...game([]).props}
        statuses={STATUSES}
        lastActivation={{ ruleId: 'r-kakumei', name: '革命', count: 1 }}
      />,
    );
    expect(screen.queryByRole('button', { name: '革命' })).toBeNull();

    rerender(
      <GameScreen
        {...game([]).props}
        statuses={STATUSES}
        lastActivation={{ ruleId: 'r-8giri', name: '8切り', count: 1 }}
      />,
    );
    expect(screen.getByRole('button', { name: '8切り' })).toBeTruthy();
  });

  it('反転中は誰にでも目盛りを出し、戻れば(非チュートリアルでは)消す', () => {
    const { rerender } = render(
      <GameScreen {...game([]).props} strengthInverted />,
    );
    expect(
      screen.getByLabelText('カードの強さ: 左がつよい、右がよわい'),
    ).toBeTruthy();

    rerender(<GameScreen {...game([]).props} strengthInverted={false} />);
    expect(
      screen.queryByLabelText('カードの強さ: 左がよわい、右がつよい'),
    ).toBeNull();
  });

  it('チュートリアル表示は通常向きのまま残る', () => {
    render(<GameScreen {...game([]).props} showStrengthScale />);
    const scale = screen.getByLabelText('カードの強さ: 左がよわい、右がつよい');
    expect(scale.textContent).toBe('よわい← →つよい');
  });
});

describe('カットインと継続マーカーの順序', () => {
  afterEach(cleanup);

  const REVOLUTION = {
    ruleId: 'r-kakumei',
    name: '革命',
    scope: 'game',
  } as const;

  /**
   * App と同じ順序を再現する。スナップショットの statuses が先に更新され、
   * カットインの再生フラグはそのあとの effect で立つ(App の volley 積みと同じ)。
   */
  function CutInHarness({
    statuses,
    done = false,
  }: {
    statuses: readonly (typeof REVOLUTION)[];
    done?: boolean;
  }) {
    const [playing, setPlaying] = useState(false);
    useEffect(() => {
      if (statuses.length > 0 && !done) setPlaying(true);
    }, [statuses, done]);
    useEffect(() => {
      if (done) setPlaying(false);
    }, [done]);
    return (
      <GameScreen
        {...game([]).props}
        statuses={statuses}
        isCutInPlaying={playing}
      />
    );
  }

  it('カットイン再生中はマーカーを出さず、引けてからポップさせる', () => {
    const { rerender } = render(<CutInHarness statuses={[]} />);

    // 状態が載ったレンダリングでは、まだ再生フラグが立っていない。ここで
    // 先走ってリボンを出すと「発動 → 継続」の順序が壊れる。
    rerender(<CutInHarness statuses={[REVOLUTION]} />);
    expect(screen.queryByRole('button', { name: /^革命/ })).toBeNull();

    rerender(<CutInHarness statuses={[REVOLUTION]} done />);
    const ribbon = screen.getByRole('button', {
      name: '革命 — 継続中。タップで説明',
    });
    expect(ribbon.classList.contains(String(markerStyles.entering))).toBe(true);
  });
});
