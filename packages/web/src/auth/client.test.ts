import { describe, expect, it, vi } from 'vitest';

import { AuthClient } from './client';

describe('AuthClient', () => {
  it('beginはBearerとcredentials付きでAPIを呼び、返されたURLへ移る', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ authUrl: 'https://accounts.example/' }), {
          status: 200,
        }),
    );
    const navigate = vi.fn();
    const client = new AuthClient(
      'https://game.example.test',
      fetcher as typeof fetch,
      navigate,
    );

    await client.begin('current-secret-token');

    expect(fetcher).toHaveBeenCalledWith(
      'https://game.example.test/api/auth/begin',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: { authorization: 'Bearer current-secret-token' },
      }),
    );
    expect(navigate).toHaveBeenCalledWith('https://accounts.example/');
  });

  it('beginのHTTP statusを例外に保つ', async () => {
    const client = new AuthClient(
      'https://game.example.test',
      vi.fn(async () => new Response('{}', { status: 503 })) as typeof fetch,
      vi.fn(),
    );
    await expect(client.begin('token')).rejects.toMatchObject({
      status: 503,
    });
  });

  it('completeはottをJSONで送り結果を返す', async () => {
    const result = {
      outcome: 'switched' as const,
      userToken: 'restored-token',
      displayName: 'ゲスト000001',
    };
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify(result), { status: 200 }),
    );
    const client = new AuthClient(
      'https://game.example.test',
      fetcher as typeof fetch,
      vi.fn(),
    );

    await expect(client.complete('one-time-code')).resolves.toEqual(result);
    expect(fetcher).toHaveBeenCalledWith(
      'https://game.example.test/api/auth/complete',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ ott: 'one-time-code' }),
      }),
    );
  });
});
