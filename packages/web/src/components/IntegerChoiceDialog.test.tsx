import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IntegerChoiceDialog } from './IntegerChoiceDialog';

describe('IntegerChoiceDialog', () => {
  afterEach(cleanup);

  it('4〜12を8から選び、スライダーと増減ボタンで整数変更して確定する', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <IntegerChoiceDialog
        title="ギロチン時計"
        message="何回目のパスで落としますか？"
        min={4}
        max={12}
        defaultValue={8}
        onConfirm={onConfirm}
      />,
    );

    const slider = screen.getByRole('slider', { name: 'パス回数' });
    expect(slider.getAttribute('min')).toBe('4');
    expect(slider.getAttribute('max')).toBe('12');
    expect(screen.getByText('8回目')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '1増やす' }));
    expect(screen.getByText('9回目')).toBeTruthy();

    fireEvent.change(slider, { target: { value: '12' } });
    expect(
      (screen.getByRole('button', { name: '1増やす' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: '12回目に決定' }));
    expect(onConfirm).toHaveBeenCalledWith(12);
  });
});
