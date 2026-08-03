import { describe, expect, test } from 'vitest';

import { AdminAuthService, FakeAdminAuthProvider } from './auth.js';

function fixture(options: { now?: () => number } = {}) {
  const provider = new FakeAdminAuthProvider();
  let sequence = 0;
  const service = new AdminAuthService({
    provider,
    publicOrigin: 'https://daifugo.example',
    allowedEmail: 'mori.jmk@gmail.com',
    sessionSecret: 'session-secret-that-is-definitely-long-enough',
    createValue: () => `${String(++sequence)}-${'x'.repeat(64)}`,
    ...options,
  });
  return { provider, service };
}

describe('AdminAuthService', () => {
  test('許可メールのGoogle identityだけに署名済みsessionを発行する', async () => {
    const { provider, service } = fixture();
    provider.setIdentity('allowed-code', {
      subject: 'google-subject',
      email: 'MORI.JMK@gmail.com',
      emailVerified: true,
    });
    const begun = await service.begin();
    expect(begun.status).toBe('ready');
    if (begun.status !== 'ready') return;
    const authUrl = new URL(begun.authUrl);
    expect(authUrl.searchParams.get('scope')).toBe('openid email');
    expect(authUrl.searchParams.get('redirect_uri')).toBe(
      'https://daifugo.example/auth/google/callback',
    );

    const completed = await service.callback(
      new URLSearchParams({
        code: 'allowed-code',
        state: authUrl.searchParams.get('state') ?? '',
      }),
      begun.flowNonce,
    );

    expect(completed.status).toBe('authorized');
    if (completed.status !== 'authorized') return;
    expect(service.sessionEmail(completed.session)).toBe('mori.jmk@gmail.com');
    expect(service.sessionEmail(`${completed.session}tampered`)).toBeNull();
  });

  test('別メールと未確認メールを拒否する', async () => {
    const { provider, service } = fixture();
    provider.setIdentity('other-code', {
      subject: 'other-subject',
      email: 'someone@example.com',
      emailVerified: true,
    });
    const other = await service.begin();
    if (other.status !== 'ready') return;
    await expect(
      service.callback(
        new URLSearchParams({
          code: 'other-code',
          state: new URL(other.authUrl).searchParams.get('state') ?? '',
        }),
        other.flowNonce,
      ),
    ).resolves.toEqual({ status: 'denied' });

    provider.setIdentity('unverified-code', {
      subject: 'unverified-subject',
      email: 'mori.jmk@gmail.com',
      emailVerified: false,
    });
    const unverified = await service.begin();
    if (unverified.status !== 'ready') return;
    await expect(
      service.callback(
        new URLSearchParams({
          code: 'unverified-code',
          state: new URL(unverified.authUrl).searchParams.get('state') ?? '',
        }),
        unverified.flowNonce,
      ),
    ).resolves.toEqual({ status: 'denied' });
  });

  test('期限切れflowとsessionを受け付けない', async () => {
    let now = 1_000;
    const { provider, service } = fixture({ now: () => now });
    provider.setIdentity('code', {
      subject: 'subject',
      email: 'mori.jmk@gmail.com',
      emailVerified: true,
    });
    const begun = await service.begin();
    if (begun.status !== 'ready') return;
    now += 10 * 60 * 1_000;
    await expect(
      service.callback(
        new URLSearchParams({
          code: 'code',
          state: new URL(begun.authUrl).searchParams.get('state') ?? '',
        }),
        begun.flowNonce,
      ),
    ).resolves.toEqual({ status: 'expired' });
  });
});
