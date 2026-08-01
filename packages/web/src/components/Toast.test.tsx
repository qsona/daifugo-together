import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Toast } from './Toast';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Toast', () => {
  it('durationを渡したときだけ自動退場する', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <Toast duration={3_000} onDismiss={onDismiss}>
        完了
      </Toast>,
    );
    act(() => vi.advanceTimersByTime(3_180));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('durationなしでは既存用途の表示を保つ', () => {
    vi.useFakeTimers();
    render(<Toast>あがり</Toast>);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText('あがり')).toBeTruthy();
  });
});
