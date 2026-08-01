import type { NotificationView } from '@daifugo/core';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotificationsScreen } from './NotificationsScreen';

afterEach(cleanup);

const item: NotificationView = {
  id: 1,
  type: 'proposal_released',
  payload: { proposalName: '革命' },
  title: '提案がルールになったよ！',
  body: '「革命」が、みんなの対局で遊べるようになりました。',
  url: '/proposals/mine',
  priority: 'highest',
  createdAt: Date.now(),
  readAt: null,
  openedAt: null,
  openedVia: null,
};

describe('NotificationsScreen', () => {
  it('一覧・すべて既読・タップ遷移を提供する', async () => {
    const opened = vi.fn(async () => undefined);
    const readAll = vi.fn(async () => undefined);
    const onOpen = vi.fn();
    const onUnreadCountChange = vi.fn();
    render(
      <NotificationsScreen
        api={{
          list: async () => ({ items: [item], unreadCount: 1 }),
          opened,
          readAll,
        }}
        onBack={() => undefined}
        onOpen={onOpen}
        onSettings={() => undefined}
        onUnreadCountChange={onUnreadCountChange}
      />,
    );
    expect(await screen.findByText('提案がルールになったよ！')).toBeTruthy();
    const share = screen.getByRole('link', { name: '𝕏 じまんする' });
    expect(new URL(share.getAttribute('href')!).searchParams.get('text')).toBe(
      '提案したルール「革命」が、みんなでつくろう大富豪に実装されました',
    );
    expect(onUnreadCountChange).toHaveBeenCalledWith(1);
    await userEvent.click(screen.getByRole('button', { name: 'すべて既読' }));
    expect(readAll).toHaveBeenCalledOnce();
    expect(onUnreadCountChange).toHaveBeenLastCalledWith(0);
    await userEvent.click(
      screen.getByRole('button', { name: /提案がルールになったよ/u }),
    );
    await waitFor(() => expect(opened).toHaveBeenCalledWith(1, 'center'));
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ id: item.id, url: item.url }),
    );
  });

  it('不採用通知にはシェア導線を出さない', async () => {
    render(
      <NotificationsScreen
        api={{
          list: async () => ({
            items: [{ ...item, type: 'proposal_rejected' }],
            unreadCount: 1,
          }),
          opened: async () => undefined,
          readAll: async () => undefined,
        }}
        onBack={() => undefined}
        onOpen={() => undefined}
        onSettings={() => undefined}
        onUnreadCountChange={() => undefined}
      />,
    );
    expect(await screen.findByText('提案がルールになったよ！')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /じまん/u })).toBeNull();
  });
});
