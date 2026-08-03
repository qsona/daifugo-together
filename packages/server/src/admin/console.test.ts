import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { createAppServer, type AppServer } from '../app-server.js';
import { SqlitePersistence } from '../persistence.js';
import { AdminAuthService, FakeAdminAuthProvider } from './auth.js';
import { AdminConsole } from './console.js';

const apps: AppServer[] = [];
const persistenceInstances: SqlitePersistence[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const persistence of persistenceInstances.splice(0)) persistence.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function basic(): string {
  return `Basic ${Buffer.from('mori:basic-password-that-is-long-enough').toString('base64')}`;
}

describe('AdminConsole', () => {
  test('Basic認証と許可Googleアカウントの二段階で管理画面を保護する', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'daifugo-admin-console-'));
    directories.push(directory);
    writeFileSync(join(directory, 'index.html'), '<h1>public app</h1>');
    const persistence = new SqlitePersistence(':memory:', {
      createUserId: () => 'user-1',
      createToken: () => 'user-token-that-is-valid',
    });
    persistenceInstances.push(persistence);
    persistence.sessions.resolve(undefined);
    const provider = new FakeAdminAuthProvider();
    provider.setIdentity('allowed-code', {
      subject: 'admin-subject',
      email: 'mori.jmk@gmail.com',
      emailVerified: true,
    });
    let sequence = 0;
    const adminConsole = new AdminConsole({
      repository: persistence.admin,
      auth: new AdminAuthService({
        provider,
        publicOrigin: 'http://127.0.0.1',
        allowedEmail: 'mori.jmk@gmail.com',
        sessionSecret: 'session-secret-that-is-definitely-long-enough',
        createValue: () => `${String(++sequence)}-${'x'.repeat(64)}`,
      }),
      basicUsername: 'mori',
      basicPassword: 'basic-password-that-is-long-enough',
    });
    const app = createAppServer({ webDistDir: directory, adminConsole });
    apps.push(app);
    const port = await app.listen(0, '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${String(port)}`;

    const withoutBasic = await fetch(`${baseUrl}/admin`);
    expect(withoutBasic.status).toBe(401);
    expect(withoutBasic.headers.get('www-authenticate')).toContain(
      'Daifugo Admin',
    );

    const login = await fetch(`${baseUrl}/admin`, {
      headers: { authorization: basic() },
    });
    expect(login.status).toBe(200);
    await expect(login.text()).resolves.toContain(
      'href="/admin/auth/google/begin"',
    );

    const begun = await fetch(`${baseUrl}/admin/auth/google/begin`, {
      headers: { authorization: basic() },
      redirect: 'manual',
    });
    expect(begun.status).toBe(303);
    const flowCookie = begun.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect(flowCookie).toContain('__Host-daifugo-admin-flow=');
    const authUrl = new URL(begun.headers.get('location') ?? '');

    const callback = await fetch(`${baseUrl}/auth/google/callback`, {
      method: 'POST',
      headers: {
        cookie: flowCookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code: 'allowed-code',
        state: authUrl.searchParams.get('state') ?? '',
      }),
      redirect: 'manual',
    });
    expect(callback.status).toBe(303);
    expect(callback.headers.get('location')).toBe('/admin');
    const sessionCookie = callback.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('__Host-daifugo-admin-session='))
      ?.split(';')[0];
    expect(sessionCookie).toBeDefined();

    const dashboard = await fetch(`${baseUrl}/admin`, {
      headers: {
        authorization: basic(),
        cookie: sessionCookie ?? '',
      },
    });
    expect(dashboard.status).toBe(200);
    await expect(dashboard.text()).resolves.toContain('管理コンソール');

    const overview = await fetch(`${baseUrl}/admin/api/overview`, {
      headers: {
        authorization: basic(),
        cookie: sessionCookie ?? '',
      },
    });
    expect(overview.status).toBe(200);
    await expect(overview.json()).resolves.toMatchObject({
      database: { users: { total: 1, guests: 1 } },
      traffic: null,
    });
  });

  test('Google sessionがない管理APIを拒否する', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'daifugo-admin-api-'));
    directories.push(directory);
    writeFileSync(join(directory, 'index.html'), '<h1>public app</h1>');
    const persistence = new SqlitePersistence(':memory:');
    persistenceInstances.push(persistence);
    const adminConsole = new AdminConsole({
      repository: persistence.admin,
      auth: new AdminAuthService({
        publicOrigin: 'http://127.0.0.1',
        allowedEmail: 'mori.jmk@gmail.com',
        sessionSecret: 'session-secret-that-is-definitely-long-enough',
      }),
      basicUsername: 'mori',
      basicPassword: 'basic-password-that-is-long-enough',
    });
    const app = createAppServer({ webDistDir: directory, adminConsole });
    apps.push(app);
    const port = await app.listen(0, '127.0.0.1');

    const response = await fetch(
      `http://127.0.0.1:${String(port)}/admin/api/users`,
      { headers: { authorization: basic() } },
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'google_login_required',
    });
  });
});
