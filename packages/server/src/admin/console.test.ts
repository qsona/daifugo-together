import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { createAppServer, type AppServer } from '../app-server.js';
import { SqlitePersistence } from '../persistence.js';
import { NotificationService } from '../notification/service.js';
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
    const user = persistence.sessions.resolve(undefined);
    const provider = new FakeAdminAuthProvider();
    provider.setIdentity('allowed-code', {
      subject: 'admin-subject',
      email: 'mori.jmk@gmail.com',
      emailVerified: true,
    });
    let sequence = 0;
    const adminRule = {
      id: 'r0001-admin-rule',
      slug: 'admin-rule',
      name: '管理画面テストルール',
      description: '管理画面から公開できるルールです。',
      kind: 'original' as const,
      prefecture: null,
      proposalId: 'proposal-admin-rule',
      status: 'disabled' as const,
      disabledReason: 'pending_enable' as const,
      activatedAt: null,
      ratingUp: 0,
      ratingDown: 0,
      popularityScore: 0.5,
      popularityUpdatedAt: null,
      createdAt: 123,
      updatedAt: 123,
    };
    const getRule = vi.fn(() => ({
      status: 'found' as const,
      rule: adminRule,
      versions: [],
      incidents: [],
      releaseReady: true,
    }));
    const enableRule = vi.fn(() => ({
      status: 'updated' as const,
      rule: {
        ...adminRule,
        status: 'active' as const,
        disabledReason: null,
        activatedAt: 456,
      },
    }));
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
      notifications: new NotificationService(persistence.notifications, {
        now: () => 123,
      }),
      rules: {
        priority: () => [
          {
            ruleId: adminRule.id,
            up: adminRule.ratingUp,
            down: adminRule.ratingDown,
            popularityScore: adminRule.popularityScore,
            priorityRank: null,
            activatedAt: adminRule.activatedAt,
            popularityUpdatedAt: adminRule.popularityUpdatedAt,
          },
        ],
        get: getRule,
        enable: enableRule,
      },
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
    expect(callback.status).toBe(200);
    expect(callback.headers.get('location')).toBeNull();
    await expect(callback.text()).resolves.toContain(
      '<meta http-equiv="refresh" content="0;url=/admin">',
    );
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
    const dashboardHtml = await dashboard.text();
    expect(dashboardHtml).toContain('管理コンソール');
    expect(dashboardHtml).toContain('直近24時間');
    expect(dashboardHtml).toContain('直近14日間のゲーム数');

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

    const rejected = await fetch(`${baseUrl}/admin/api/announcements`, {
      method: 'POST',
      headers: {
        authorization: basic(),
        cookie: sessionCookie ?? '',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: '外部リンク',
        body: '許可されないリンクです',
        url: 'https://example.com',
      }),
    });
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toEqual({
      error: 'invalid_announcement_url',
    });

    const published = await fetch(`${baseUrl}/admin/api/announcements`, {
      method: 'POST',
      headers: {
        authorization: basic(),
        cookie: sessionCookie ?? '',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: '新しいお知らせ',
        body: 'みんなに届く本文です。',
        url: '/rules',
      }),
    });
    expect(published.status).toBe(201);
    await expect(published.json()).resolves.toMatchObject({
      item: {
        title: '新しいお知らせ',
        recipientCount: 1,
        createdBy: 'mori.jmk@gmail.com',
      },
    });
    expect(
      persistence.notifications.list(user.userId, 123).items[0],
    ).toMatchObject({
      type: 'announcement',
      title: '新しいお知らせ',
      body: 'みんなに届く本文です。',
      url: '/rules',
    });

    const history = await fetch(`${baseUrl}/admin/api/announcements`, {
      headers: {
        authorization: basic(),
        cookie: sessionCookie ?? '',
      },
    });
    expect(history.status).toBe(200);
    await expect(history.json()).resolves.toMatchObject({
      items: [{ title: '新しいお知らせ', recipientCount: 1 }],
    });

    const rules = await fetch(`${baseUrl}/admin/api/rules`, {
      headers: {
        authorization: basic(),
        cookie: sessionCookie ?? '',
      },
    });
    expect(rules.status).toBe(200);
    await expect(rules.json()).resolves.toMatchObject({
      items: [
        {
          id: 'r0001-admin-rule',
          status: 'disabled',
          disabledReason: 'pending_enable',
          releaseReady: true,
        },
      ],
    });

    const publishedRule = await fetch(
      `${baseUrl}/admin/api/rules/r0001-admin-rule/publish`,
      {
        method: 'POST',
        headers: {
          authorization: basic(),
          cookie: sessionCookie ?? '',
        },
      },
    );
    expect(publishedRule.status).toBe(200);
    await expect(publishedRule.json()).resolves.toMatchObject({
      status: 'updated',
    });
    expect(enableRule).toHaveBeenCalledWith('r0001-admin-rule');
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
