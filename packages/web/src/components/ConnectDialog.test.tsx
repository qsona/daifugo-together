import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConnectDialog } from './ConnectDialog';

afterEach(cleanup);

describe('ConnectDialog', () => {
  it('なまえ編集中は外側の操作を止め、ack後に表示名を更新する', async () => {
    let resolveRename: (() => void) | undefined;
    const rename = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRename = resolve;
        }),
    );
    const user = userEvent.setup();
    render(
      <ConnectDialog
        displayName="ゲスト000001"
        connectionReady
        pending={false}
        rename={rename}
        onProceed={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '変える' }));
    expect(screen.queryByRole('button', { name: 'もどる' })).toBeNull();
    expect(
      screen
        .getByRole('button', { name: 'Googleへ進む' })
        .hasAttribute('disabled'),
    ).toBe(true);

    const input = screen.getByLabelText<HTMLInputElement>('なまえ');
    await user.clear(input);
    await user.type(input, 'たろう');
    await user.click(screen.getByRole('button', { name: 'これにする' }));
    expect(rename).toHaveBeenCalledWith('たろう');
    expect(
      screen.getByRole('button', { name: '保存中…' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.queryByText('たろう')).toBeNull();

    resolveRename?.();
    expect(await screen.findByText('たろう')).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Googleへ進む' })
        .hasAttribute('disabled'),
    ).toBe(false);
    await user.click(screen.getByRole('button', { name: '変える' }));
    expect(screen.getByLabelText<HTMLInputElement>('なまえ').value).toBe(
      'たろう',
    );
  });

  it('改名失敗後も以前のなまえで認証へ進める', async () => {
    const onProceed = vi.fn();
    const user = userEvent.setup();
    render(
      <ConnectDialog
        displayName="ゲスト000001"
        connectionReady
        pending={false}
        rename={vi.fn(async () => Promise.reject(new Error('offline')))}
        onProceed={onProceed}
        onBack={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '変える' }));
    const input = screen.getByLabelText<HTMLInputElement>('なまえ');
    await user.clear(input);
    await user.type(input, 'たろう');
    await user.click(screen.getByRole('button', { name: 'これにする' }));
    expect(await screen.findByText(/保存できませんでした/)).toBeTruthy();
    expect(input.value).toBe('たろう');

    await user.click(screen.getByRole('button', { name: 'やめる' }));
    await user.click(screen.getByRole('button', { name: 'Googleへ進む' }));
    expect(onProceed).toHaveBeenCalledOnce();
  });
});
