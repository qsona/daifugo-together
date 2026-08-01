import { describe, expect, it, vi } from 'vitest';

import { NotificationClient } from './client';

describe('NotificationClient', () => {
  it('Bearer付きで一覧・Push開封・全件既読を送る', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [], unreadCount: 0 }), {
          status: 200,
        }),
      )
      .mockResolvedValue(new Response(null, { status: 204 }));
    const client = new NotificationClient(
      'https://game.example.test',
      { getItem: () => 'user-token' },
      fetcher,
    );
    await expect(client.list()).resolves.toEqual({ items: [], unreadCount: 0 });
    await client.opened(7, 'push');
    await client.readAll();
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://game.example.test/api/notifications/7/opened',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer user-token',
        }),
        body: JSON.stringify({ via: 'push' }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      'https://game.example.test/api/notifications/read-all',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
