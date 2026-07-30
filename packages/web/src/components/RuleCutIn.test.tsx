import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RuleCutIn } from './RuleCutIn';

const EIGHT_CUT = [
  { ruleId: 'r0001-eight-cut', name: '8切り', isFirstSeen: false },
];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('カットインの一拍', () => {
  it('一拍のあいだはリボンを出さず、出した札を見せる時間を作る', () => {
    vi.useFakeTimers();
    render(<RuleCutIn activations={EIGHT_CUT} onDone={() => undefined} />);

    expect(screen.queryByText('8切り')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText('8切り')).toBeTruthy();
  });

  it('一拍のぶんだけonDoneが後ろにずれる', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<RuleCutIn activations={EIGHT_CUT} onDone={onDone} />);

    act(() => {
      vi.advanceTimersByTime(1_049);
    });
    expect(onDone).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('一拍のあいだもタップでスキップできる', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<RuleCutIn activations={EIGHT_CUT} onDone={onDone} />);

    screen.getByRole('button', { name: '演出をとばす' }).click();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
