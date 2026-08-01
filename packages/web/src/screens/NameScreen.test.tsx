import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NameScreen } from './NameScreen';

afterEach(cleanup);

describe('NameScreen', () => {
  it('現在名をプリセットし、コードポイント10文字で切り詰めて保存する', async () => {
    const rename = vi.fn(async () => undefined);
    const onBack = vi.fn();
    render(
      <NameScreen
        displayName="たろう"
        connection="ready"
        rename={rename}
        onBack={onBack}
      />,
    );
    const input = screen.getByLabelText<HTMLInputElement>('なまえ');
    expect(input.value).toBe('たろう');
    await userEvent.clear(input);
    await userEvent.type(input, '😀😀😀😀😀😀😀😀😀😀😀');
    expect(input.value).toBe('😀😀😀😀😀😀😀😀😀😀');
    expect(screen.getByText('10 / 10')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'これにする' }));
    expect(rename).toHaveBeenCalledWith(input.value);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('空白と制御文字を区別し、接続前は保存させない', async () => {
    const rename = vi.fn(async () => undefined);
    render(
      <NameScreen
        displayName="たろう"
        connection="connecting"
        rename={rename}
        onBack={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('なまえ');
    await userEvent.clear(input);
    await userEvent.type(input, '   ');
    expect(screen.getByText('なまえを入れてください')).toBeTruthy();
    await userEvent.clear(input);
    fireEvent.change(input, { target: { value: 'たろう\t' } });
    expect(screen.getByText('使えない文字が入っています')).toBeTruthy();
    expect(
      screen.getByText('サーバーとつながるまで待ってください'),
    ).toBeTruthy();
    expect(rename).not.toHaveBeenCalled();
  });
});
