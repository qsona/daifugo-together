import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog } from './Dialog';

afterEach(cleanup);

describe('Dialogの閉じる手段', () => {
  it('閉じるボタン・スクリム・Escの3経路でonCloseを呼ぶ', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(
      <Dialog title="この対局のルール" onClose={onClose}>
        <p>本文</p>
      </Dialog>,
    );

    await user.click(screen.getByRole('button', { name: '閉じる' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(container.firstElementChild as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('モーダルの中のタップでは閉じない', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Dialog title="この対局のルール" onClose={onClose}>
        <p>本文</p>
      </Dialog>,
    );

    await user.click(screen.getByText('本文'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('onCloseが無ければ閉じるボタンを出さない', () => {
    render(
      <Dialog title="警告">
        <p>本文</p>
      </Dialog>,
    );

    expect(screen.queryByRole('button', { name: '閉じる' })).toBeNull();
  });
});
