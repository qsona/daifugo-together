import { afterEach, describe, expect, it } from 'vitest';

import { SqlitePersistence } from '../persistence.js';
import { FakeAuthProvider } from './provider.js';
import { AuthService } from './service.js';

const instances: SqlitePersistence[] = [];

afterEach(() => {
  for (const instance of instances.splice(0)) instance.close();
});

function setup(now = 1_000) {
  let sequence = 0;
  const persistence = new SqlitePersistence(':memory:', {
    createUserId: () => `user-${String(++sequence)}`,
    createToken: () => `token-${String(sequence)}`.padEnd(20, 'x'),
    createDisplayName: (value) => `ゲスト${String(value)}`,
  });
  instances.push(persistence);
  const provider = new FakeAuthProvider();
  let value = 0;
  const service = new AuthService(persistence.auth, {
    provider,
    publicOrigin: 'https://game.example.test',
    now: () => now,
    createValue: () => `${String(++value)}-${'x'.repeat(64)}`,
  });
  return { persistence, provider, service };
}

async function authorize(
  service: AuthService,
  provider: FakeAuthProvider,
  token: string,
  code: string,
  subject: string,
) {
  provider.setSubject(code, subject);
  const begun = await service.begin(token);
  if (begun.status !== 200) throw new Error('begin failed');
  const state = new URL(begun.body.authUrl).searchParams.get('state');
  if (!state) throw new Error('state missing');
  return service.callback(
    new URLSearchParams({ code, state }),
    begun.flowNonce,
  );
}

function ottFrom(location: string): string {
  const query = new URL(location).hash.split('?')[1] ?? '';
  const ott = new URLSearchParams(query).get('ott');
  if (!ott) throw new Error('ott missing');
  return ott;
}

describe('AuthService', () => {
  it('匿名行へsubを紐付け、ottを単回で引き換える', async () => {
    const { persistence, provider, service } = setup();
    const anonymous = persistence.sessions.resolve(undefined);

    const location = await authorize(
      service,
      provider,
      anonymous.userToken,
      'link-code',
      'google-link',
    );
    expect(location).not.toContain(anonymous.userToken);
    expect(location).not.toContain('link-code');
    const ott = ottFrom(location);
    expect(service.complete(ott)).toEqual({
      status: 200,
      body: {
        outcome: 'linked',
        userToken: anonymous.userToken,
        displayName: anonymous.displayName,
      },
    });
    expect(service.complete(ott)).toEqual({
      status: 410,
      body: { error: 'invalid_or_expired_ott' },
    });
    expect(persistence.sessions.resolve(anonymous.userToken).registered).toBe(
      true,
    );
  });

  it('登録済みsubへ切り替え、同じ本人ならalreadyにする', async () => {
    const { persistence, provider, service } = setup();
    const registered = persistence.sessions.resolve(undefined);
    persistence.auth.complete(registered.userId, 'google-existing', 1);
    const otherDevice = persistence.sessions.resolve(undefined);

    const switched = service.complete(
      ottFrom(
        await authorize(
          service,
          provider,
          otherDevice.userToken,
          'switch-code',
          'google-existing',
        ),
      ),
    );
    expect(switched).toMatchObject({
      status: 200,
      body: { outcome: 'switched', userToken: registered.userToken },
    });

    const already = service.complete(
      ottFrom(
        await authorize(
          service,
          provider,
          registered.userToken,
          'already-code',
          'google-existing',
        ),
      ),
    );
    expect(already).toMatchObject({
      status: 200,
      body: { outcome: 'already', userToken: registered.userToken },
    });
  });

  it('登録済み端末で未登録subを使うと新規登録行へ切り替える', async () => {
    const { persistence, provider, service } = setup();
    const current = persistence.sessions.resolve(undefined);
    persistence.auth.complete(current.userId, 'google-current', 1);

    const completed = service.complete(
      ottFrom(
        await authorize(
          service,
          provider,
          current.userToken,
          'family-code',
          'google-family',
        ),
      ),
    );
    expect(completed).toMatchObject({
      status: 200,
      body: { outcome: 'switched' },
    });
    if (completed.status !== 200) throw new Error('completion failed');
    expect(completed.body.userToken).not.toBe(current.userToken);
    expect(
      persistence.sessions.resolve(completed.body.userToken).registered,
    ).toBe(true);
  });

  it('未設定・未認証・state不一致を閉じ、失敗時はottを発行しない', async () => {
    const { persistence, provider, service } = setup();
    const anonymous = persistence.sessions.resolve(undefined);
    await expect(service.begin(null)).resolves.toMatchObject({ status: 401 });
    await expect(
      new AuthService(persistence.auth, {
        publicOrigin: 'https://game.example.test',
      }).begin(anonymous.userToken),
    ).resolves.toEqual({
      status: 503,
      body: { error: 'auth_unavailable' },
    });

    const begun = await service.begin(anonymous.userToken);
    if (begun.status !== 200) throw new Error('begin failed');
    provider.setSubject('bad-state-code', 'google-bad-state');
    const failed = await service.callback(
      new URLSearchParams({ code: 'bad-state-code', state: 'wrong' }),
      begun.flowNonce,
    );
    expect(failed).toBe(
      'https://game.example.test/#/auth/complete?error=expired',
    );
    expect(
      persistence.auth.complete('missing-user', 'google-new', 1),
    ).toBeNull();
  });

  it('開始したブラウザと異なるnonceではアカウントを紐付けない', async () => {
    const { persistence, provider, service } = setup();
    const anonymous = persistence.sessions.resolve(undefined);
    const begun = await service.begin(anonymous.userToken);
    if (begun.status !== 200) throw new Error('begin failed');
    const state = new URL(begun.body.authUrl).searchParams.get('state');
    if (!state) throw new Error('state missing');
    provider.setSubject('cross-browser-code', 'google-victim');

    await expect(
      service.callback(
        new URLSearchParams({ code: 'cross-browser-code', state }),
        'different-browser-nonce',
      ),
    ).resolves.toBe('https://game.example.test/#/auth/complete?error=expired');
    expect(persistence.sessions.resolve(anonymous.userToken).registered).toBe(
      false,
    );
    await expect(
      service.callback(
        new URLSearchParams({ code: 'cross-browser-code', state }),
        begun.flowNonce,
      ),
    ).resolves.toBe('https://game.example.test/#/auth/complete?error=expired');
  });

  it('拒否と期限境界を閉じ、期限内のottだけを引き換える', async () => {
    let now = 1_000;
    const { persistence, provider } = setup();
    let value = 0;
    const service = new AuthService(persistence.auth, {
      provider,
      publicOrigin: 'https://game.example.test',
      now: () => now,
      createValue: () => `${String(++value)}-${'x'.repeat(64)}`,
    });
    const anonymous = persistence.sessions.resolve(undefined);
    const denied = await service.begin(anonymous.userToken);
    if (denied.status !== 200) throw new Error('begin failed');
    const deniedState = new URL(denied.body.authUrl).searchParams.get('state');
    await expect(
      service.callback(
        new URLSearchParams({
          error: 'access_denied',
          state: deniedState ?? '',
        }),
        denied.flowNonce,
      ),
    ).resolves.toContain('error=denied');

    const expired = await service.begin(anonymous.userToken);
    if (expired.status !== 200) throw new Error('begin failed');
    const expiredState = new URL(expired.body.authUrl).searchParams.get(
      'state',
    );
    provider.setSubject('expired-code', 'google-expired');
    now += 10 * 60 * 1_000;
    await expect(
      service.callback(
        new URLSearchParams({
          code: 'expired-code',
          state: expiredState ?? '',
        }),
        expired.flowNonce,
      ),
    ).resolves.toContain('error=expired');

    now += 1;
    const fresh = await service.begin(anonymous.userToken);
    if (fresh.status !== 200) throw new Error('begin failed');
    const freshState = new URL(fresh.body.authUrl).searchParams.get('state');
    provider.setSubject('fresh-code', 'google-fresh');
    const location = await service.callback(
      new URLSearchParams({ code: 'fresh-code', state: freshState ?? '' }),
      fresh.flowNonce,
    );
    const ott = ottFrom(location);
    now += 60 * 1_000;
    expect(service.complete(ott)).toMatchObject({ status: 410 });
  });
});
