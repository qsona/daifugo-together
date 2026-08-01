import type { NotificationView } from '@daifugo/core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NotificationsScreen } from './NotificationsScreen';

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
});
