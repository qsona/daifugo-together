import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import {
  HttpPipelineJobPort,
  HttpRuleReleasePort,
  ImplementationApiError,
} from './implementation-api.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

const item = {
  job: {
    id: 1,
    proposalId: 'proposal-1',
    phase: 'queued',
    attempt: 1,
    implementationAttempt: 1,
    ciRerun: 0,
    ruleId: 'r0001-yagiri',
    slug: 'yagiri',
    branch: null,
    prNumber: null,
    headSha: null,
    mergeSha: null,
    scaffoldSha: null,
    promptVersion: null,
    errorCode: null,
    errorNote: null,
    createdAt: 1,
    updatedAt: 1,
  },
  proposal: {
    id: 'proposal-1',
    kind: 'local',
    prefectureCode: '11',
    prefecture: '埼玉県',
    name: '八切り',
    body: '8を出したら場を流す。',
  },
  passedCheckId: 2,
  approvedJudgementId: 3,
  spec: {
    specVersion: 1,
    name: '八切り',
    summary: '8を含むプレイの直後に場を流す。',
    hooks: ['afterPlay'],
    effects: ['clearField'],
    testPoints: ['8で発動する'],
    notes: '',
    source: {
      kind: 'local',
      title: '八切り',
      body: '8を出したら場を流す。',
    },
  },
  scaffoldMeta: { slug: 'yagiri', messages: {} },
} as const;

async function listen(
  handler: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => void | Promise<void>,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  return `http://127.0.0.1:${String(address.port)}`;
}

describe('HttpPipelineJobPort', () => {
  it('Bearer認証付きでnext/update/failを実API契約に送る', async () => {
    const requests: Array<{
      path: string;
      authorization: string | undefined;
      body: string;
    }> = [];
    const baseUrl = await listen(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += String(chunk);
      requests.push({
        path: request.url ?? '',
        authorization: request.headers.authorization,
        body,
      });
      response.setHeader('content-type', 'application/json');
      if (request.url === '/admin/pipeline/next') {
        response.end(
          JSON.stringify({
            item,
            warnings: ['job 9 (r0009-old) is already pr_open'],
          }),
        );
      } else if (
        request.method === 'GET' &&
        request.url === '/admin/pipeline/jobs/1'
      ) {
        response.end(
          JSON.stringify({
            item: {
              ...item,
              job: {
                ...item.job,
                phase: 'implementing',
                branch: 'rule/r0001-yagiri',
                scaffoldSha: 'a'.repeat(40),
                promptVersion: 'cx02-v3',
              },
            },
          }),
        );
      } else if (request.url?.endsWith('/update')) {
        response.end(JSON.stringify({ status: 'updated', job: item.job }));
      } else if (request.url?.endsWith('/retry')) {
        response.end(JSON.stringify({ status: 'retried', job: item.job }));
      } else {
        response.end(JSON.stringify({ status: 'failed', job: item.job }));
      }
    });
    const warnings: string[] = [];
    const jobs = new HttpPipelineJobPort({
      baseUrl: `${baseUrl}/`,
      token: 'local-admin-token',
      onWarning: (warning) => warnings.push(warning),
    });

    await expect(jobs.next()).resolves.toEqual(item);
    expect(warnings).toEqual(['job 9 (r0009-old) is already pr_open']);
    await expect(jobs.resume(1)).resolves.toMatchObject({
      job: { phase: 'implementing' },
    });
    await expect(
      jobs.update(1, { from: 'queued', to: 'implementing' }),
    ).resolves.toMatchObject({ status: 'updated' });
    await expect(
      jobs.retry(1, {
        from: 'implementing',
        expectedAttempt: 1,
        expectedImplementationAttempt: 1,
        kind: 'administrative',
      }),
    ).resolves.toMatchObject({ status: 'retried' });
    await expect(
      jobs.fail(1, { from: 'implementing', errorCode: 'infra' }),
    ).resolves.toMatchObject({ status: 'failed' });
    expect(requests).toEqual([
      {
        path: '/admin/pipeline/next',
        authorization: 'Bearer local-admin-token',
        body: '',
      },
      {
        path: '/admin/pipeline/jobs/1',
        authorization: 'Bearer local-admin-token',
        body: '',
      },
      {
        path: '/admin/pipeline/jobs/1/update',
        authorization: 'Bearer local-admin-token',
        body: '{"from":"queued","to":"implementing"}',
      },
      {
        path: '/admin/pipeline/jobs/1/retry',
        authorization: 'Bearer local-admin-token',
        body: '{"from":"implementing","expectedAttempt":1,"expectedImplementationAttempt":1,"kind":"administrative"}',
      },
      {
        path: '/admin/pipeline/jobs/1/fail',
        authorization: 'Bearer local-admin-token',
        body: '{"from":"implementing","errorCode":"infra"}',
      },
    ]);
  });

  it('不正なnext応答とHTTPエラーを処理開始前に拒否する', async () => {
    let count = 0;
    const baseUrl = await listen((_request, response) => {
      response.setHeader('content-type', 'application/json');
      count += 1;
      if (count === 1) {
        response.end(JSON.stringify({ item: { job: { phase: 'queued' } } }));
      } else {
        response.statusCode = 401;
        response.end(JSON.stringify({ error: 'unauthorized' }));
      }
    });
    const jobs = new HttpPipelineJobPort({ baseUrl, token: 'wrong' });

    await expect(jobs.next()).rejects.toThrow('invalid queued implementation');
    await expect(jobs.next()).rejects.toMatchObject({
      message: 'unauthorized',
      status: 401,
    } satisfies Partial<ImplementationApiError>);
  });
});

describe('HttpRuleReleasePort', () => {
  it('Bearer認証付きでruleを取得し、有効化する', async () => {
    const requests: Array<{
      method: string | undefined;
      path: string;
      authorization: string | undefined;
    }> = [];
    const rule = {
      id: 'r0001-yagiri',
      slug: 'yagiri',
      name: '八切り',
      description: '8を含むプレイの直後に場を流す。',
      kind: 'local',
      prefecture: '埼玉県',
      proposalId: 'proposal-1',
      status: 'disabled',
      disabledReason: 'pending_enable',
      createdAt: 1,
      updatedAt: 1,
    };
    const baseUrl = await listen((request, response) => {
      requests.push({
        method: request.method,
        path: request.url ?? '',
        authorization: request.headers.authorization,
      });
      response.setHeader('content-type', 'application/json');
      if (request.method === 'GET') {
        response.end(
          JSON.stringify({
            status: 'found',
            rule,
            releaseReady: true,
            versions: [
              {
                id: 1,
                ruleId: rule.id,
                version: 1,
                contractVersion: 1,
                prNumber: 42,
                mergeSha: 'c'.repeat(40),
                bundleHash: 'd'.repeat(64),
                isCurrent: true,
                revertedAt: null,
                createdAt: 1,
              },
            ],
          }),
        );
      } else {
        response.end(
          JSON.stringify({
            status: 'updated',
            rule: { ...rule, status: 'active', disabledReason: null },
          }),
        );
      }
    });
    const rules = new HttpRuleReleasePort({
      baseUrl: `${baseUrl}/`,
      token: 'local-admin-token',
    });

    await expect(rules.get('r0001-yagiri')).resolves.toMatchObject({
      status: 'found',
      rule: { status: 'disabled' },
    });
    await expect(rules.enable('r0001-yagiri')).resolves.toMatchObject({
      status: 'updated',
      rule: { status: 'active' },
    });
    expect(requests).toEqual([
      {
        method: 'GET',
        path: '/admin/rules/r0001-yagiri',
        authorization: 'Bearer local-admin-token',
      },
      {
        method: 'POST',
        path: '/admin/rules/r0001-yagiri/enable',
        authorization: 'Bearer local-admin-token',
      },
    ]);
  });

  it('not_found/conflictを契約値として返し、不正応答を拒否する', async () => {
    let count = 0;
    const baseUrl = await listen((_request, response) => {
      response.setHeader('content-type', 'application/json');
      count += 1;
      if (count === 1) {
        response.statusCode = 404;
        response.end(JSON.stringify({ status: 'not_found' }));
      } else if (count === 2) {
        response.statusCode = 409;
        response.end(
          JSON.stringify({ status: 'conflict', error: 'release_pending' }),
        );
      } else {
        response.end(
          JSON.stringify({ status: 'found', rule: {}, versions: [] }),
        );
      }
    });
    const rules = new HttpRuleReleasePort({ baseUrl, token: 'token' });

    await expect(rules.get('missing')).resolves.toEqual({
      status: 'not_found',
    });
    await expect(rules.enable('pending')).resolves.toEqual({
      status: 'conflict',
      error: 'release_pending',
    });
    await expect(rules.get('invalid')).rejects.toThrow(
      'invalid rule lookup response',
    );
  });
});
