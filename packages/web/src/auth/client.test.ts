import { describe, expect, it, vi } from 'vitest';

import { AuthClient } from './client';

describe('AuthClient', () => {
  it('beginは現在のtokenをBearerにだけ載せる', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ authUrl: 'https://accounts.example.test' }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    const client = new AuthClient(
      'https://game.example.test',
      { getItem: () => 'current-secret-token' },
      fetcher,
    );

    await expect(client.begin()).resolves.toBe('https://accounts.example.test');
    expect(fetcher).toHaveBeenCalledWith(
      'https://game.example.test/api/auth/begin',
      {
        method: 'POST',
        headers: { authorization: 'Bearer current-secret-token' },
      },
    );
  });

  it('completeはottをbodyで引き換え、URLへ載せない', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          outcome: 'switched',
          userToken: 'restored-token',
          displayName: 'ゲスト1',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = new AuthClient(
      'https://game.example.test',
      { getItem: () => null },
      fetcher,
    );

    await expect(client.complete('one-time-code')).resolves.toMatchObject({
      outcome: 'switched',
      userToken: 'restored-token',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://game.example.test/api/auth/complete',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ott: 'one-time-code' }),
      }),
    );
    expect(fetcher.mock.calls[0]?.[0]).not.toContain('one-time-code');
  });

  it('storage取得が拒否されてもbegin画面を壊さない', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ authUrl: 'https://accounts.example.test' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    const client = new AuthClient(
      'https://game.example.test',
      {
        getItem: () => {
          throw new Error('storage blocked');
        },
      },
      fetcher,
    );

    await expect(client.begin()).resolves.toBe('https://accounts.example.test');
    expect(fetcher).toHaveBeenCalledWith(
      'https://game.example.test/api/auth/begin',
      { method: 'POST', headers: {} },
    );
  });
});
