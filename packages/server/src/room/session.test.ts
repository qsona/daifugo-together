import { describe, expect, it } from 'vitest';

import { InMemorySessionStore } from './session.js';

describe('InMemorySessionStore', () => {
  it('未知tokenには新しい匿名identityを発行し、既知tokenだけを復元する', () => {
    let id = 0;
    const store = new InMemorySessionStore({
      createUserId: () => `user-${++id}`,
      createToken: () => `token-${String(id).padStart(16, '0')}`,
      createDisplayName: (sequence) => `ゲスト${sequence}`,
    });
    const first = store.resolve(undefined);
    const restored = store.resolve(first.userToken);
    const invalid = store.resolve('unknown-token');

    expect(first).toEqual({
      userId: 'user-1',
      userToken: 'token-0000000000000001',
      displayName: 'ゲスト1',
      registered: false,
    });
    expect(restored).toEqual(first);
    expect(restored).not.toBe(first);
    expect(invalid.userId).toBe('user-2');
    expect(invalid.userToken).not.toBe(first.userToken);
  });

  it('表示名変更後の復元へ反映し、外部からsession参照を変更できない', () => {
    const store = new InMemorySessionStore({
      createUserId: () => 'user-1',
      createToken: () => 'token-000000000001',
    });
    const session = store.resolve(undefined);
    session.displayName = '外部変更';
    expect(store.resolve(session.userToken).displayName).not.toBe('外部変更');

    expect(store.rename(session.userToken, '新しい名前')).toBe(true);
    expect(store.resolve(session.userToken).displayName).toBe('新しい名前');
    expect(store.rename('missing', '無効')).toBe(false);
  });

  it('短いtokenや衝突を採用しない', () => {
    const candidates = [
      'short',
      'token-000000000001',
      'token-000000000001',
      'token-000000000002',
    ];
    const store = new InMemorySessionStore({
      createUserId: (() => {
        let id = 0;
        return () => `user-${++id}`;
      })(),
      createToken: () => candidates.shift() ?? 'token-000000000003',
    });
    const first = store.resolve(undefined);
    const second = store.resolve(undefined);

    expect(first.userToken).toBe('token-000000000001');
    expect(second.userToken).toBe('token-000000000002');
  });

  it('既定匿名名は人数が2桁になっても10文字以内に保つ', () => {
    let id = 0;
    const store = new InMemorySessionStore({
      createUserId: () => `user-${++id}`,
      createToken: () => `token-${String(id).padStart(16, '0')}`,
    });
    const names = Array.from(
      { length: 12 },
      () => store.resolve(undefined).displayName,
    );
    expect(names.every((name) => [...name].length <= 10)).toBe(true);
    expect(names[9]).toBe('ゲスト00000A');
  });
});
