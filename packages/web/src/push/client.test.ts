import { afterEach, describe, expect, it, vi } from 'vitest';

import { PushClient } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PushClient', () => {
  it('ユーザー操作を保って許諾を先に要求し、購読と初期設定を保存する', async () => {
    const order: string[] = [];
    const subscription = {
      toJSON: () => ({
        endpoint: 'https://push.example.test/client',
        keys: { p256dh: 'key', auth: 'auth' },
      }),
    };
    const pushManager = {
      getSubscription: vi.fn(async () => null),
      subscribe: vi.fn(async () => subscription),
    };
    vi.stubGlobal('navigator', {
      userAgent: 'desktop-test',
      platform: 'test',
      maxTouchPoints: 0,
      serviceWorker: {
        getRegistration: vi.fn(async () => ({ pushManager })),
      },
    });
    vi.stubGlobal('PushManager', class PushManager {});
    vi.stubGlobal('Notification', {
      permission: 'default',
      requestPermission: vi.fn(async () => {
        order.push('permission');
        return 'granted';
      }),
    });
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/push/config')) {
        order.push('config');
        return new Response(
          JSON.stringify({ available: true, vapidPublicKey: 'AQ' }),
          { status: 200 },
        );
      }
      if (url.endsWith('/api/push/preferences')) {
        return new Response(
          JSON.stringify({
            preferences: {
              proposal_released: true,
              proposal_rejected: true,
              proposal_failed: true,
            },
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 204 });
    });
    const client = new PushClient(
      'https://game.example.test',
      { getItem: () => 'user-token', setItem: () => undefined },
      fetcher,
    );

    await expect(client.subscribeProposalResults()).resolves.toBe('subscribed');
    expect(order).toEqual(['permission', 'config']);
    expect(pushManager.subscribe).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('Service Worker登録が無いときは購読解除を待ち続けない', async () => {
    vi.stubGlobal('navigator', {
      serviceWorker: { getRegistration: vi.fn(async () => undefined) },
    });
    const client = new PushClient(
      'https://game.example.test',
      { getItem: () => 'user-token', setItem: () => undefined },
      vi.fn<typeof fetch>(),
    );
    await expect(client.disableThisDevice()).resolves.toBeUndefined();
  });
});
