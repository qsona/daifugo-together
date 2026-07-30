import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerToClientEvents } from '@daifugo/core';
import { io as createClient } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAppServer, type AppServer } from './app-server.js';
import { FakeAuthProvider } from './auth/provider.js';
import { AuthService } from './auth/service.js';
import { SqlitePersistence } from './persistence.js';

const apps: AppServer[] = [];
const directories: string[] = [];
const persistenceInstances: SqlitePersistence[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const persistence of persistenceInstances.splice(0)) persistence.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fetchText(url: string): Promise<{
  status: number | undefined;
  body: string;
  contentType: string | undefined;
}> {
  return new Promise((resolve, reject) => {
    const outgoing = request(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve({
          status: response.statusCode,
          body,
          contentType: response.headers['content-type'],
        });
      });
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

describe('production app server', () => {
  it('OAuth開始・callback・ott引換を同一originで提供する', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'daifugo-web-dist-'));
    directories.push(directory);
    const persistence = new SqlitePersistence(':memory:', {
      createUserId: () => 'auth-user',
      createToken: () => 'auth-user-token-valid',
    });
    persistenceInstances.push(persistence);
    const session = persistence.sessions.resolve(undefined);
    const provider = new FakeAuthProvider();
    provider.setSubject('google-code', 'google-sub');
    let value = 0;
    const app = createAppServer({
      webDistDir: directory,
      auth: new AuthService(persistence.auth, {
        provider,
        publicOrigin: 'http://127.0.0.1',
        createValue: () => `${String(++value)}-${'x'.repeat(64)}`,
      }),
    });
    apps.push(app);
    const port = await app.listen(0, '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${String(port)}`;

    const begun = await fetch(`${baseUrl}/api/auth/begin`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.userToken}` },
    });
    expect(begun.status).toBe(200);
    const flowCookie = begun.headers.get('set-cookie');
    expect(flowCookie).toContain('__Host-daifugo-auth-flow=');
    expect(flowCookie).toContain('HttpOnly');
    expect(flowCookie).toContain('Secure');
    expect(flowCookie).toContain('SameSite=None');
    const { authUrl } = (await begun.json()) as { authUrl: string };
    expect(new URL(authUrl).searchParams.get('response_mode')).toBe(
      'form_post',
    );
    const state = new URL(authUrl).searchParams.get('state');
    const callbackUrl = `${baseUrl}/auth/google/callback`;
    expect(callbackUrl).not.toContain('code=');
    const callback = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        cookie: flowCookie?.split(';')[0] ?? '',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code: 'google-code',
        state: state ?? '',
      }),
      redirect: 'manual',
    });
    expect(callback.status).toBe(302);
    expect(callback.headers.get('set-cookie')).toContain('Max-Age=0');
    const location = callback.headers.get('location') ?? '';
    expect(location).not.toContain('google-code');
    expect(location).not.toContain(session.userToken);
    const ott = new URLSearchParams(new URL(location).hash.split('?')[1]).get(
      'ott',
    );
    const completed = await fetch(`${baseUrl}/auth/google/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ott: ott ?? '' }),
      redirect: 'manual',
    });
    expect(completed.status).toBe(303);
    expect(completed.headers.get('location')).toBe('/menu#/auth/result');
    expect(completed.headers.get('location')).not.toContain(session.userToken);
    expect(completed.headers.get('set-cookie')).toContain(
      '__Secure-daifugo-auth-result=',
    );
    expect(completed.headers.get('set-cookie')).toContain('Path=/menu');
    expect(completed.headers.get('set-cookie')).toContain('SameSite=Strict');
  });

  it('ブラウザのOAuth開始はtokenをURLへ載せずGoogleへredirectする', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'daifugo-web-dist-'));
    directories.push(directory);
    const persistence = new SqlitePersistence(':memory:', {
      createUserId: () => 'browser-auth-user',
      createToken: () => 'browser-auth-token-valid',
    });
    persistenceInstances.push(persistence);
    const session = persistence.sessions.resolve(undefined);
    const app = createAppServer({
      webDistDir: directory,
      auth: new AuthService(persistence.auth, {
        provider: new FakeAuthProvider(),
        publicOrigin: 'http://127.0.0.1',
        createValue: () => `browser-${'x'.repeat(64)}`,
      }),
    });
    apps.push(app);
    const port = await app.listen(0, '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${String(port)}`;

    const begun = await fetch(`${baseUrl}/auth/google/begin`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ userToken: session.userToken }),
      redirect: 'manual',
    });

    expect(begun.status).toBe(303);
    expect(begun.headers.get('location')).toContain(
      'https://accounts.example.test',
    );
    expect(begun.headers.get('location')).not.toContain(session.userToken);
    expect(begun.headers.get('set-cookie')).toContain(
      '__Host-daifugo-auth-flow=',
    );
  });

  it('提案POSTはbody解析より認証・停止判定を先に行う', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'daifugo-web-dist-'));
    directories.push(directory);
    const submit = vi.fn();
    const app = createAppServer({
      webDistDir: directory,
      proposals: {
        authorize: (token) =>
          token === 'suspended-token'
            ? {
                status: 403 as const,
                body: {
                  error: 'proposal_suspended' as const,
                  suspendedUntil: 20_000,
                },
              }
            : {
                status: 401 as const,
                body: { error: 'unauthorized' as const },
              },
        submit,
        mine: async () => ({
          status: 401 as const,
          body: { error: 'unauthorized' as const },
        }),
        seen: async () => ({
          status: 401 as const,
          body: { error: 'unauthorized' as const },
        }),
      },
    });
    apps.push(app);
    const port = await app.listen(0, '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${String(port)}`;

    const unauthorized = await fetch(`${baseUrl}/api/proposals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({
      error: 'unauthorized',
    });

    const suspended = await fetch(`${baseUrl}/api/proposals`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer suspended-token',
        'content-type': 'application/json',
      },
      body: '{',
    });
    expect(suspended.status).toBe(403);
    await expect(suspended.json()).resolves.toEqual({
      error: 'proposal_suspended',
      suspendedUntil: 20_000,
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it('SPA fallbackを配信し、同じoriginでSocket.IO sessionを確立する', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'daifugo-web-dist-'));
    directories.push(directory);
    writeFileSync(
      join(directory, 'index.html'),
      '<!doctype html><title>Daifugo Together</title>',
    );
    const app = createAppServer({ webDistDir: directory });
    apps.push(app);
    const port = await app.listen(0, '127.0.0.1');
    const url = `http://127.0.0.1:${String(port)}`;

    await expect(fetchText(`${url}/rooms/example`)).resolves.toEqual({
      status: 200,
      body: '<!doctype html><title>Daifugo Together</title>',
      contentType: 'text/html; charset=utf-8',
    });

    const client = createClient(url, {
      transports: ['websocket'],
      reconnection: false,
    });
    const ready = await new Promise<
      Parameters<ServerToClientEvents['session:ready']>[0]
    >((resolve) => client.once('session:ready', resolve));
    expect(ready.room).toBeNull();
    expect(ready.userToken.length).toBeGreaterThanOrEqual(16);
    client.disconnect();
  });

  it('/healthはDB疎通とdrain状態を返し、drain中も200を保つ', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'daifugo-web-dist-'));
    directories.push(directory);
    const app = createAppServer({
      webDistDir: directory,
      checkDatabase: () => true,
    });
    apps.push(app);
    const port = await app.listen(0, '127.0.0.1');
    const url = `http://127.0.0.1:${String(port)}`;

    await expect(fetchText(`${url}/health`)).resolves.toEqual({
      status: 200,
      body: '{"status":"ok","db":"ok"}',
      contentType: 'application/json; charset=utf-8',
    });

    await app.beginDrain();

    await expect(fetchText(`${url}/health`)).resolves.toEqual({
      status: 200,
      body: '{"status":"draining","db":"ok"}',
      contentType: 'application/json; charset=utf-8',
    });
  });

  it('/healthはDB疎通に失敗すると503を返す', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'daifugo-web-dist-'));
    directories.push(directory);
    const app = createAppServer({
      webDistDir: directory,
      checkDatabase: () => false,
    });
    apps.push(app);
    const port = await app.listen(0, '127.0.0.1');

    await expect(
      fetchText(`http://127.0.0.1:${String(port)}/health`),
    ).resolves.toEqual({
      status: 503,
      body: '{"status":"error","db":"error"}',
      contentType: 'application/json; charset=utf-8',
    });
  });

  it('公開ルール図鑑APIを認証なしで返し、IP単位で読み取りを制限する', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'daifugo-web-dist-'));
    directories.push(directory);
    const app = createAppServer({
      webDistDir: directory,
      now: () => 1_000,
      ruleCatalogRateLimit: { maxAttempts: 1, windowMs: 60_000 },
      ruleCatalog: {
        list: () => ({
          status: 200,
          body: {
            summary: {
              implemented: 1,
              active: 1,
              removed: 0,
              prefectureCoverage: 0,
            },
            page: { total: 1, limit: 30, offset: 0 },
            items: [
              {
                id: 'r1',
                name: '8切り',
                description: '8を出すと場が流れます。',
                kind: 'original',
                prefecture: null,
                status: 'active',
                priority: null,
                popularity: null,
                implementedAt: '2026-07-27T00:00:00.000Z',
                removedAt: null,
              },
            ],
          },
        }),
      },
    });
    apps.push(app);
    const port = await app.listen(0, '127.0.0.1');
    const url = `http://127.0.0.1:${String(port)}/api/rules`;

    const first = await fetchText(url);
    expect(first.status).toBe(200);
    expect(JSON.parse(first.body)).toMatchObject({
      summary: { implemented: 1, active: 1 },
      items: [{ id: 'r1', name: '8切り' }],
    });
    await expect(fetchText(url)).resolves.toMatchObject({
      status: 429,
      body: '{"error":"rate_limited"}',
    });
  });

  it('ルール図鑑の読み取り障害を500へ閉じ込める', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'daifugo-web-dist-'));
    directories.push(directory);
    const app = createAppServer({
      webDistDir: directory,
      ruleCatalog: {
        list: () => {
          throw new Error('database unavailable');
        },
      },
    });
    apps.push(app);
    const port = await app.listen(0, '127.0.0.1');
    await expect(
      fetchText(`http://127.0.0.1:${String(port)}/api/rules`),
    ).resolves.toMatchObject({ status: 500 });
  });

  it('本人向けカード一覧と異議申し立てAPIを認証付きで公開する', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'daifugo-web-dist-'));
    directories.push(directory);
    const app = createAppServer({
      webDistDir: directory,
      gateway: {
        sessions: {
          resolve: () => ({
            userId: 'suspended-user',
            userToken: 'valid-token',
            displayName: '停止中プレイヤー',
            registered: false,
          }),
          rename: () => true,
        },
      },
      yellowCards: {
        summary: (token) =>
          token === 'valid-token'
            ? {
                status: 200,
                body: {
                  active: 0,
                  limit: 2,
                  cards: [
                    {
                      id: 7,
                      issuedAt: 1_000,
                      status: 'consumed',
                      expiresAt: 2_000,
                      appeal: null,
                    },
                  ],
                  suspension: {
                    level: 1,
                    startsAt: 1_000,
                    endsAt: 2_000,
                  },
                },
              }
            : { status: 401, body: { error: 'unauthorized' } },
        appeal: ({ token, cardId }) =>
          token === 'valid-token' && cardId === 7
            ? { status: 201, body: { appealId: 9, status: 'open' } }
            : { status: 404, body: { error: 'not_found' } },
      },
    });
    apps.push(app);
    const port = await app.listen(0, '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${String(port)}`;

    const unauthorized = await fetch(`${baseUrl}/api/me/yellow-cards`);
    expect(unauthorized.status).toBe(401);

    const summary = await fetch(`${baseUrl}/api/me/yellow-cards`, {
      headers: { authorization: 'Bearer valid-token' },
    });
    expect(summary.status).toBe(200);
    await expect(summary.json()).resolves.toMatchObject({
      active: 0,
      cards: [{ id: 7, status: 'consumed' }],
      suspension: { level: 1 },
    });

    const appealed = await fetch(`${baseUrl}/api/yellow-cards/7/appeal`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ comment: '誤検出です' }),
    });
    expect(appealed.status).toBe(201);
    await expect(appealed.json()).resolves.toEqual({
      appealId: 9,
      status: 'open',
    });

    const client = createClient(baseUrl, {
      transports: ['websocket'],
      auth: { userToken: 'valid-token' },
      reconnection: false,
    });
    const ready = await new Promise<
      Parameters<ServerToClientEvents['session:ready']>[0]
    >((resolve) => client.once('session:ready', resolve));
    expect(ready.userToken).toBe('valid-token');
    client.disconnect();
  });

  it('ローカル判定ツール向けAPIを専用Bearerで保護する', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'daifugo-web-dist-'));
    directories.push(directory);
    const record = vi.fn(() => ({
      status: 'recorded' as const,
      checkId: 3,
      result: {
        finalVerdict: 'pass' as const,
        layers: {
          layer0: { invisibleChars: false, lengthExceeded: false },
          layer1: { hard: [], soft: [] },
          layer2: {
            hasCodeFence: false,
            hasUrl: false,
            hasBase64Like: false,
            langSwitch: false,
            systemVocabDensity: false,
            trailingDirective: false,
          },
          llm: {
            verdict: 'clean' as const,
            reason: 'clean',
            evidence: null,
            evidenceVerified: false,
            model: 'gpt-5.6-sol',
            latencyMs: 1,
          },
        },
        detectorVersion: 'test',
        inputText: 'text',
        normalizedText: 'text',
        inputHash: 'hash',
        reviewFlag: false,
      },
    }));
    const recordAi = vi.fn(() => ({ status: 'not_found' as const }));
    const approveSpec = vi.fn(() => ({ status: 'not_found' as const }));
    const amendSpec = vi.fn(() => ({ status: 'not_found' as const }));
    const nextJob = vi.fn(() => null);
    const pendingCx = vi.fn(() => []);
    const updateJob = vi.fn(() => ({
      status: 'updated' as const,
      job: {
        id: 1,
        proposalId: 'proposal-1',
        phase: 'implementing' as const,
        attempt: 1,
        implementationAttempt: 1,
        ciRerun: 0,
        ruleId: 'r0001-yagiri',
        slug: 'yagiri',
        branch: 'rule/r0001-yagiri',
        prNumber: null,
        headSha: null,
        mergeSha: null,
        scaffoldSha: null,
        promptVersion: 'cx02-v3',
        errorCode: null,
        errorNote: null,
        createdAt: 1,
        updatedAt: 2,
      },
    }));
    const failJob = vi.fn(() => ({
      status: 'failed' as const,
      job: {
        ...updateJob().job,
        phase: 'failed' as const,
        errorCode: 'inspect_violation',
        errorNote: 'unexpected file',
      },
    }));
    const retryJob = vi.fn(() => ({
      status: 'retried' as const,
      job: {
        ...updateJob().job,
        phase: 'implementing' as const,
        attempt: 2,
        branch: null,
        scaffoldSha: null,
        promptVersion: null,
      },
    }));
    const app = createAppServer({
      webDistDir: directory,
      adminScreening: {
        token: 'admin-token',
        service: {
          pending: () => [],
          record,
        },
      },
      adminPipeline: {
        token: 'admin-token',
        service: {
          pending: pendingCx,
          pendingConfirmations: () => [],
          recordAi,
          confirmE6Rejection: () => ({ status: 'not_found' }),
          confirmCxRejection: () => ({ status: 'not_found' }),
          approveSpec,
          amendSpec,
        },
        jobs: {
          next: nextJob,
          active: () => [
            {
              ...updateJob().job,
              phase: 'merged',
              prNumber: 42,
              headSha: 'b'.repeat(40),
              mergeSha: 'c'.repeat(40),
              updatedAt: 1,
            },
          ],
          resume: () => null,
          update: updateJob,
          retry: retryJob,
          fail: failJob,
        },
      },
    });
    apps.push(app);
    const port = await app.listen(0, '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${String(port)}`;

    const unauthorized = await fetch(`${baseUrl}/admin/pipeline/screening`);
    expect(unauthorized.status).toBe(401);
    const pending = await fetch(`${baseUrl}/admin/pipeline/screening`, {
      headers: { authorization: 'Bearer admin-token' },
    });
    expect(pending.status).toBe(200);
    await expect(pending.json()).resolves.toEqual({ items: [] });
    expect(pendingCx).toHaveBeenLastCalledWith(undefined, undefined);

    const rejudge = await fetch(
      `${baseUrl}/admin/pipeline/screening?promptVersion=cx01-v4`,
      { headers: { authorization: 'Bearer admin-token' } },
    );
    expect(rejudge.status).toBe(200);
    await expect(rejudge.json()).resolves.toEqual({ items: [] });
    expect(pendingCx).toHaveBeenLastCalledWith(undefined, 'cx01-v4');

    const checked = await fetch(`${baseUrl}/admin/proposals/proposal-1/check`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        verdict: 'clean',
        reason: 'clean',
        evidence: null,
        model: 'gpt-5.6-sol',
        latencyMs: 1,
      }),
    });
    expect(checked.status).toBe(200);
    expect(record).toHaveBeenCalledWith('proposal-1', {
      verdict: 'clean',
      reason: 'clean',
      evidence: null,
      model: 'gpt-5.6-sol',
      latencyMs: 1,
    });

    const judged = await fetch(`${baseUrl}/admin/proposals/proposal-1/judge`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'record_ai',
        payload: { verdict: 'approve' },
      }),
    });
    expect(judged.status).toBe(404);
    expect(recordAi).toHaveBeenCalledWith('proposal-1', {
      verdict: 'approve',
    });

    const approved = await fetch(
      `${baseUrl}/admin/proposals/proposal-1/approve-spec`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ judgementId: 1, actor: 'developer', spec: {} }),
      },
    );
    expect(approved.status).toBe(404);
    expect(approveSpec).toHaveBeenCalledWith('proposal-1', {
      judgementId: 1,
      actor: 'developer',
      spec: {},
    });

    const amended = await fetch(
      `${baseUrl}/admin/proposals/proposal-1/amend-spec`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          jobId: 6,
          judgementId: 2,
          actor: 'developer',
          spec: {},
        }),
      },
    );
    expect(amended.status).toBe(404);
    expect(amendSpec).toHaveBeenCalledWith('proposal-1', {
      jobId: 6,
      judgementId: 2,
      actor: 'developer',
      spec: {},
    });

    const next = await fetch(`${baseUrl}/admin/pipeline/next`, {
      headers: { authorization: 'Bearer admin-token' },
    });
    expect(next.status).toBe(200);
    await expect(next.json()).resolves.toEqual({
      item: null,
      warnings: [
        'REMINDER: job 1 (r0001-yagiri) has awaited enablement for over 48 hours',
      ],
    });
    expect(nextJob).toHaveBeenCalledOnce();

    const updated = await fetch(`${baseUrl}/admin/pipeline/jobs/1/update`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: 'queued',
        to: 'implementing',
        branch: 'rule/r0001-yagiri',
        scaffoldSha: 'a'.repeat(40),
        promptVersion: 'cx02-v3',
      }),
    });
    expect(updated.status).toBe(200);
    expect(updateJob).toHaveBeenCalledWith(1, {
      from: 'queued',
      to: 'implementing',
      branch: 'rule/r0001-yagiri',
      scaffoldSha: 'a'.repeat(40),
      promptVersion: 'cx02-v3',
    });

    const retried = await fetch(`${baseUrl}/admin/pipeline/jobs/1/retry`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: 'implementing',
        expectedAttempt: 1,
        expectedImplementationAttempt: 1,
        kind: 'administrative',
      }),
    });
    expect(retried.status).toBe(200);
    expect(retryJob).toHaveBeenCalledWith(1, {
      from: 'implementing',
      expectedAttempt: 1,
      expectedImplementationAttempt: 1,
      kind: 'administrative',
    });

    const failed = await fetch(`${baseUrl}/admin/pipeline/jobs/1/fail`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: 'implementing',
        errorCode: 'inspect_violation',
        errorNote: 'unexpected file',
      }),
    });
    expect(failed.status).toBe(200);
    expect(failJob).toHaveBeenCalledWith(1, {
      from: 'implementing',
      errorCode: 'inspect_violation',
      errorNote: 'unexpected file',
    });
  });

  it('ルール単位の照会・disable・enable APIを専用Bearerで保護する', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'daifugo-web-dist-'));
    directories.push(directory);
    const rule = {
      id: 'r0001-yagiri',
      slug: 'yagiri',
      name: '8切り',
      description: '8を出すと場が流れる',
      kind: 'original' as const,
      prefecture: null,
      proposalId: 'proposal-1',
      status: 'active' as const,
      disabledReason: null,
      activatedAt: 1,
      ratingUp: 0,
      ratingDown: 0,
      popularityScore: 0.5,
      popularityUpdatedAt: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const get = vi.fn((ruleId: string) =>
      ruleId === 'missing'
        ? ({ status: 'not_found' } as const)
        : {
            status: 'found' as const,
            rule,
            versions: [],
            incidents: [],
            releaseReady: true,
          },
    );
    const disable = vi.fn((ruleId: string, body: unknown) =>
      ruleId === 'removed'
        ? ({ status: 'conflict', error: 'rule_removed' } as const)
        : (body as { reason?: string }).reason !== 'manual'
          ? ({ status: 'invalid', error: 'invalid_reason' } as const)
          : ({
              status: 'updated',
              rule: {
                ...rule,
                status: 'disabled',
                disabledReason: 'manual',
              },
            } as const),
    );
    const enable = vi.fn((ruleId: string) =>
      ruleId === 'removed'
        ? ({ status: 'conflict', error: 'rule_removed' } as const)
        : ({ status: 'updated', rule } as const),
    );
    const priority = vi.fn(() => [
      {
        ruleId: rule.id,
        up: 0,
        down: 0,
        popularityScore: 0.5,
        priorityRank: 1,
        activatedAt: 1,
        popularityUpdatedAt: null,
      },
    ]);
    const conflicts = vi.fn(() => [
      {
        id: 1,
        setId: 'set 1',
        gameIndex: 0,
        playSeq: 0,
        hook: 'onGameStart',
        conflictKey: 'rank',
        adoptedRuleId: rule.id,
        entries: [{ ruleId: rule.id }],
        createdAt: 1,
      },
    ]);
    const snapshot = vi.fn(() => [
      {
        ruleId: rule.id,
        position: 1,
        bundleHash: 'bundle',
        popularityScore: 0.75,
      },
    ]);
    const app = createAppServer({
      webDistDir: directory,
      adminRules: {
        token: 'admin-token',
        service: {
          get,
          disable,
          enable,
          priority,
          conflicts,
          snapshot,
        },
      },
    });
    apps.push(app);
    const port = await app.listen(0, '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${String(port)}`;

    expect((await fetch(`${baseUrl}/admin/rules/r0001-yagiri`)).status).toBe(
      401,
    );
    const found = await fetch(`${baseUrl}/admin/rules/r0001-yagiri`, {
      headers: { authorization: 'Bearer admin-token' },
    });
    expect(found.status).toBe(200);
    await expect(found.json()).resolves.toEqual({
      status: 'found',
      rule,
      versions: [],
      incidents: [],
      releaseReady: true,
    });

    const disabled = await fetch(
      `${baseUrl}/admin/rules/r0001-yagiri/disable`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ reason: 'manual' }),
      },
    );
    expect(disabled.status).toBe(200);
    expect(disable).toHaveBeenCalledWith('r0001-yagiri', {
      reason: 'manual',
    });

    const enabled = await fetch(`${baseUrl}/admin/rules/r0001-yagiri/enable`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin-token' },
    });
    expect(enabled.status).toBe(200);
    expect(enable).toHaveBeenCalledWith('r0001-yagiri');

    expect(
      (
        await fetch(`${baseUrl}/admin/rules/missing`, {
          headers: { authorization: 'Bearer admin-token' },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(`${baseUrl}/admin/rules/removed/enable`, {
          method: 'POST',
          headers: { authorization: 'Bearer admin-token' },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await fetch(`${baseUrl}/admin/rules/r0001-yagiri/disable`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer admin-token',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ reason: 'auto_incident' }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${baseUrl}/admin/rules/r0001-yagiri`, {
          method: 'DELETE',
          headers: { authorization: 'Bearer admin-token' },
        })
      ).status,
    ).toBe(405);
    const malformed = await fetch(`${baseUrl}/admin/rules/%E0%A4%A`, {
      headers: { authorization: 'Bearer admin-token' },
    });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({
      error: 'invalid_path_encoding',
    });

    const priorities = await fetch(`${baseUrl}/api/admin/rules/priority`, {
      headers: { authorization: 'Bearer admin-token' },
    });
    expect(priorities.status).toBe(200);
    await expect(priorities.json()).resolves.toEqual({
      items: [
        {
          ruleId: rule.id,
          up: 0,
          down: 0,
          popularityScore: 0.5,
          priorityRank: 1,
          activatedAt: 1,
          popularityUpdatedAt: null,
        },
      ],
    });

    const conflictEvents = await fetch(
      `${baseUrl}/api/admin/conflict-events?setId=set%201&ruleId=${rule.id}&limit=5`,
      { headers: { authorization: 'Bearer admin-token' } },
    );
    expect(conflictEvents.status).toBe(200);
    expect(conflicts).toHaveBeenCalledWith({
      setId: 'set 1',
      ruleId: rule.id,
      limit: 5,
    });

    const setSnapshot = await fetch(
      `${baseUrl}/api/admin/sets/set%201/snapshot`,
      { headers: { authorization: 'Bearer admin-token' } },
    );
    expect(setSnapshot.status).toBe(200);
    expect(snapshot).toHaveBeenCalledWith('set 1');
  });

  it('セット評価APIへBearerと増分更新を渡す', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'daifugo-web-dist-'));
    directories.push(directory);
    const get = vi.fn(() => ({
      status: 200 as const,
      body: { setRating: null, ruleVotes: [] },
    }));
    const update = vi.fn(() => ({
      status: 200 as const,
      body: {
        status: 'updated',
        state: { setRating: 'fun', ruleVotes: [] },
        eliminatedRuleIds: [],
      },
    }));
    const app = createAppServer({
      webDistDir: directory,
      evaluations: { get, update },
    });
    apps.push(app);
    const port = await app.listen(0, '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${String(port)}`;

    const loaded = await fetch(`${baseUrl}/api/sets/set%201/evaluation`, {
      headers: { authorization: 'Bearer user-token' },
    });
    expect(loaded.status).toBe(200);
    expect(get).toHaveBeenCalledWith('user-token', 'set 1');

    const saved = await fetch(`${baseUrl}/api/sets/set%201/evaluation`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer user-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ setRating: 'fun' }),
    });
    expect(saved.status).toBe(200);
    expect(update).toHaveBeenCalledWith('user-token', 'set 1', {
      setRating: 'fun',
    });
  });
});
