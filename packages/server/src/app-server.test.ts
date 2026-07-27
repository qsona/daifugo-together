import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerToClientEvents } from '@daifugo/core';
import { io as createClient } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAppServer, type AppServer } from './app-server.js';

const apps: AppServer[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
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
    const nextJob = vi.fn(() => null);
    const updateJob = vi.fn(() => ({
      status: 'updated' as const,
      job: {
        id: 1,
        proposalId: 'proposal-1',
        phase: 'implementing' as const,
        attempt: 1,
        ciRerun: 0,
        ruleId: 'r0001-yagiri',
        slug: 'yagiri',
        branch: 'rule/r0001-yagiri',
        prNumber: null,
        headSha: null,
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
          pending: () => [],
          pendingConfirmations: () => [],
          recordAi,
          confirmE6Rejection: () => ({ status: 'not_found' }),
          confirmCxRejection: () => ({ status: 'not_found' }),
          approveSpec,
        },
        jobs: {
          next: nextJob,
          active: () => [],
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

    const next = await fetch(`${baseUrl}/admin/pipeline/next`, {
      headers: { authorization: 'Bearer admin-token' },
    });
    expect(next.status).toBe(200);
    await expect(next.json()).resolves.toEqual({ item: null, warnings: [] });
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
      }),
    });
    expect(retried.status).toBe(200);
    expect(retryJob).toHaveBeenCalledWith(1, {
      from: 'implementing',
      expectedAttempt: 1,
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
});
