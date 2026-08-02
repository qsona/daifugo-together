import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InviteCode } from './InviteCode';

const shareDescriptor = Object.getOwnPropertyDescriptor(navigator, 'share');
const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  'clipboard',
);

afterEach(() => {
  cleanup();
  restoreNavigatorProperty('share', shareDescriptor);
  restoreNavigatorProperty('clipboard', clipboardDescriptor);
});

describe('InviteCode', () => {
  it('Web Share APIが使えるときは招待文とリンクを共有する', async () => {
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: share,
    });

    render(
      <InviteCode code="01234" inviteUrl="https://example.com/?room=01234" />,
    );

    expect(screen.queryByLabelText('招待リンク')).toBeNull();
    expect(screen.getByText('部屋コード')).toBeTruthy();

    fireEvent.click(screen.getByText('QRコードを表示'));
    expect(
      screen.getByRole('img', {
        name: '友だちが参加するためのQRコード',
      }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: '📤 リンクを共有する' }),
    );
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({
        text: '大富豪しよう。この部屋に入って: https://example.com/?room=01234',
      }),
    );
  });

  it('Web Share APIがないときは同じ位置でコピーして完了を伝える', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(
      <InviteCode code="01234" inviteUrl="https://example.com/?room=01234" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'リンクをコピー' }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('https://example.com/?room=01234'),
    );
    expect(await screen.findByText('コピーしました')).toBeTruthy();
  });
});

function restoreNavigatorProperty(
  key: 'share' | 'clipboard',
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(navigator, key, descriptor);
  } else {
    Reflect.deleteProperty(navigator, key);
  }
}
