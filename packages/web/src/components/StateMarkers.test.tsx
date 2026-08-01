import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FieldStateChips, StateRibbons } from './StateMarkers';
import type { GameStatusMarker } from './StateMarkers';
import styles from './StateMarkers.module.css';
import suitStyles from './SuitMark.module.css';

const ENTERING_CLASS = styles.entering;
const EXITING_CLASS = styles.exiting;
const FADING_CLASS = styles.fading;
if (!ENTERING_CLASS || !EXITING_CLASS || !FADING_CLASS) {
  throw new Error('entering / exiting / fading class is required');
}

const REVOLUTION: GameStatusMarker = {
  ruleId: 'r-kakumei',
  name: '革命',
  scope: 'game',
};

const BINDING: GameStatusMarker = {
  ruleId: 'r-shibari',
  name: 'しばり',
  scope: 'field',
  suits: ['spade', 'heart'],
};

describe('継続状態のマーカー', () => {
  afterEach(cleanup);

  it('局リボンをルール名だけのボタンとして出す', () => {
    render(<StateRibbons statuses={[REVOLUTION]} />);

    const ribbon = screen.getByRole('button', {
      name: '革命 — 継続中。タップで説明',
    });
    expect(ribbon.textContent).toBe('革命');
  });

  it('場チップにスートの図形を先頭から並べ、スートごとに色を分ける', () => {
    render(<FieldStateChips statuses={[BINDING]} />);

    const chip = screen.getByRole('button', {
      name: 'スペード・ハートのしばり — 継続中。タップで説明',
    });
    // スートは図形(SuitMark)なので、読み上げ文字列は名前だけになる。
    expect(chip.textContent).toBe('しばり');

    const marks = chip.querySelectorAll('svg');
    expect(marks.length).toBe(2);
    // 図形は装飾なので読み上げには出さない(名前は aria-label が持つ)。
    for (const mark of marks) {
      expect(mark.getAttribute('aria-hidden')).toBe('true');
    }
    // 4 色デッキの色は札と同じ規律。♠ と ♥ が別の色クラスになる。
    expect(marks[0]?.classList.contains(String(suitStyles.spade))).toBe(true);
    expect(marks[1]?.classList.contains(String(suitStyles.heart))).toBe(true);
  });

  it('タップでそのルールの詳細導線を呼ぶ', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <>
        <StateRibbons statuses={[REVOLUTION]} onOpen={onOpen} />
        <FieldStateChips statuses={[BINDING]} onOpen={onOpen} />
      </>,
    );

    await user.click(screen.getByRole('button', { name: /^革命/ }));
    await user.click(screen.getByRole('button', { name: /しばり/ }));

    expect(onOpen.mock.calls).toEqual([['r-kakumei'], ['r-shibari']]);
  });

  it('初期描画では登場演出を付けず、あとから増えた状態にだけ付ける', () => {
    const { rerender } = render(<StateRibbons statuses={[REVOLUTION]} />);
    const existing = screen.getByRole('button', { name: /^革命/ });
    expect(existing.classList.contains(ENTERING_CLASS)).toBe(false);

    rerender(
      <StateRibbons
        statuses={[
          REVOLUTION,
          { ruleId: 'r-11back', name: '11バック', scope: 'game' },
        ]}
      />,
    );

    expect(
      screen
        .getByRole('button', { name: /^革命/ })
        .classList.contains(ENTERING_CLASS),
    ).toBe(false);
    expect(
      screen
        .getByRole('button', { name: /^11バック/ })
        .classList.contains(ENTERING_CLASS),
    ).toBe(true);
  });

  it('局リボンは状態が消えると退場演出のあいだだけ残る', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<StateRibbons statuses={[REVOLUTION]} />);
      rerender(<StateRibbons statuses={[]} />);

      const leaving = screen.getByRole('button', { name: /^革命/ });
      expect(leaving.classList.contains(EXITING_CLASS)).toBe(true);

      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(screen.queryByRole('button', { name: /^革命/ })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('場の保持中は消えた場チップを静止させたまま残し、保持が解けてから吸い込む', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <FieldStateChips statuses={[BINDING]} hold />,
      );
      rerender(<FieldStateChips statuses={[]} hold />);

      const held = screen.getByRole('button', { name: /しばり/ });
      expect(held.classList.contains(EXITING_CLASS)).toBe(false);

      rerender(<FieldStateChips statuses={[]} hold={false} isFlushing />);
      expect(
        screen
          .getByRole('button', { name: /しばり/ })
          .classList.contains(EXITING_CLASS),
      ).toBe(true);

      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(screen.queryByRole('button', { name: /しばり/ })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('退場中の状態が戻ってきても key を重複させない', () => {
    const errors = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      const { rerender } = render(<FieldStateChips statuses={[BINDING]} />);
      rerender(<FieldStateChips statuses={[]} />);
      rerender(<FieldStateChips statuses={[BINDING]} />);

      const chips = screen.getAllByRole('button', { name: /しばり/ });
      expect(chips.length).toBe(1);
      expect(chips[0]?.classList.contains(EXITING_CLASS)).toBe(false);
      expect(chips[0]?.classList.contains(FADING_CLASS)).toBe(false);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it('場流しを伴わない消滅はフェードで引く', () => {
    const { rerender } = render(<FieldStateChips statuses={[BINDING]} />);
    rerender(<FieldStateChips statuses={[]} />);

    const leaving = screen.getByRole('button', { name: /しばり/ });
    expect(leaving.classList.contains(FADING_CLASS)).toBe(true);
    expect(leaving.classList.contains(EXITING_CLASS)).toBe(false);
  });

  it('退場は 1 件ずつ数え、後続の退場で先行分の期限を延ばさない', () => {
    vi.useFakeTimers();
    try {
      const second = {
        ruleId: 'r-11back',
        name: '11バック',
        scope: 'field',
      } as const;
      const { rerender } = render(
        <FieldStateChips statuses={[BINDING, second]} />,
      );
      rerender(<FieldStateChips statuses={[second]} />);

      act(() => {
        vi.advanceTimersByTime(200);
      });
      rerender(<FieldStateChips statuses={[]} />);

      // 先行分は自分の 320ms で消える(後続に引きずられない)。
      act(() => {
        vi.advanceTimersByTime(140);
      });
      expect(screen.queryByRole('button', { name: /しばり/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /11バック/ })).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByRole('button', { name: /11バック/ })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('局リボンは 2 枚までを段重ねし、3 件目からは「+N」で一覧へ送る', async () => {
    const user = userEvent.setup();
    const onOverflow = vi.fn();
    render(
      <StateRibbons
        statuses={[
          REVOLUTION,
          { ruleId: 'r-11back', name: '11バック', scope: 'game' },
          { ruleId: 'r-shukketsu', name: '出血', scope: 'game' },
        ]}
        onOverflow={onOverflow}
      />,
    );

    expect(screen.queryByRole('button', { name: /^出血/ })).toBeNull();
    const more = screen.getByRole('button', {
      name: 'ほか1件。タップでルール一覧',
    });
    expect(more.textContent).toBe('+1');

    await user.click(more);
    expect(onOverflow).toHaveBeenCalledTimes(1);
  });

  it('「+N」の枠に退場中のリボンを混ぜない', () => {
    const second = {
      ruleId: 'r-11back',
      name: '11バック',
      scope: 'game',
    } as const;
    const third = {
      ruleId: 'r-shukketsu',
      name: '出血',
      scope: 'game',
    } as const;
    const { rerender } = render(
      <StateRibbons statuses={[REVOLUTION, second, third]} />,
    );
    expect(
      screen.getByRole('button', { name: /タップでルール一覧/ }),
    ).toBeTruthy();

    rerender(<StateRibbons statuses={[REVOLUTION, second]} />);

    // 現行は 2 件なので「+N」は消え、3 件目は退場を演じてから消える。
    expect(
      screen.queryByRole('button', { name: /タップでルール一覧/ }),
    ).toBeNull();
    const leaving = screen.getByRole('button', { name: /^出血/ });
    expect(leaving.classList.contains(EXITING_CLASS)).toBe(true);
  });
});
