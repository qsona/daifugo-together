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

  it('iOSのタブではPush非対応ではなくホーム画面追加を案内する', async () => {
    // iOS の Safari タブには Notification も PushManager も無い。
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
      serviceWorker: { getRegistration: vi.fn(async () => undefined) },
    });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ available: true, vapidPublicKey: 'AQ' }),
          { status: 200 },
        ),
    );
    const client = new PushClient(
      'https://game.example.test',
      { getItem: () => 'user-token', setItem: () => undefined },
      fetcher,
    );

    await expect(client.offer()).resolves.toBe('install');
    await expect(client.subscribeProposalResults()).resolves.toBe(
      'ios_install_required',
    );
  });

  it('提示を断った端末には追加案内も出さない', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'iPhone',
      platform: 'iPhone',
      maxTouchPoints: 5,
      serviceWorker: { getRegistration: vi.fn(async () => undefined) },
    });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    const fetcher = vi.fn<typeof fetch>();
    const client = new PushClient(
      'https://game.example.test',
      { getItem: () => '1', setItem: () => undefined },
      fetcher,
    );
    await expect(client.offer()).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('ホーム画面アプリからの起動は1セッションに1回だけ記録する', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'iPhone',
      platform: 'iPhone',
      maxTouchPoints: 5,
    });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith('/api/push/config')
        ? new Response(
            JSON.stringify({ available: true, vapidPublicKey: 'AQ' }),
          )
        : new Response(null, { status: 204 }),
    );
    const client = new PushClient(
      'https://game.example.test',
      { getItem: () => 'user-token', setItem: () => undefined },
      fetcher,
    );

    await client.reportInstalled();
    await client.reportInstalled();
    const installed = fetcher.mock.calls.filter(([input]) =>
      String(input).endsWith('/api/push/installed'),
    );
    expect(installed).toHaveLength(1);
    expect(installed[0]![1]).toMatchObject({ method: 'POST' });
  });

  it('タブから開いているときは起動を記録しない', async () => {
    vi.stubGlobal('navigator', { userAgent: 'desktop', platform: 'test' });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    const fetcher = vi.fn<typeof fetch>();
    await new PushClient(
      'https://game.example.test',
      { getItem: () => 'user-token', setItem: () => undefined },
      fetcher,
    ).reportInstalled();
    expect(fetcher).not.toHaveBeenCalled();
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
