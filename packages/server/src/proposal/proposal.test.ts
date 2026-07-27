import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CreateProposalResponse } from '@daifugo/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createAppServer, type AppServer } from '../app-server.js';
import { SqlitePersistence } from '../persistence.js';
import {
  type ProposalSignalRecorder,
  ProposalSubmissionService,
} from './submission.js';

const apps: AppServer[] = [];
const persistenceInstances: SqlitePersistence[] = [];
const directories: string[] = [];
const NOOP_SIGNALS: ProposalSignalRecorder = {
  analyze: () => ({ commit: () => undefined }),
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const persistence of persistenceInstances.splice(0)) persistence.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function postJson(
  url: string,
  token: string,
  body: unknown,
): Promise<{ status: number | undefined; body: CreateProposalResponse }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const outgoing = request(
      url,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (response) => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () => {
          resolve({
            status: response.statusCode,
            body: JSON.parse(responseBody) as CreateProposalResponse,
          });
        });
      },
    );
    outgoing.on('error', reject);
    outgoing.end(payload);
  });
}

describe('proposal vertical slice', () => {
  it('認証済みユーザーがローカル提案をAPIから保存し、後続キューで参照できる', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'daifugo-proposal-'));
    directories.push(directory);
    const persistence = new SqlitePersistence(
      join(directory, 'proposal.sqlite'),
      {
        createUserId: () => 'author-1',
        createToken: () => 'proposal-token-0001',
      },
    );
    persistenceInstances.push(persistence);
    const session = persistence.sessions.resolve(undefined);
    const app = createAppServer({
      webDistDir: directory,
      proposals: new ProposalSubmissionService(persistence.proposals, {
        signals: NOOP_SIGNALS,
        now: () => 1_000,
        createId: () => '00000000Z8AAAAAAAAAAAAAAAA',
      }),
    });
    apps.push(app);
    const port = await app.listen(0, '127.0.0.1');

    const response = await postJson(
      `http://127.0.0.1:${String(port)}/api/proposals`,
      session.userToken,
      {
        kind: 'local',
        prefectureCode: '11',
        name: '8切り',
        body: '8を出すと場が流れる。',
      },
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      outcome: 'accepted',
      proposal: {
        id: '00000000Z8AAAAAAAAAAAAAAAA',
        kind: 'local',
        prefectureCode: '11',
        prefectureName: '埼玉県',
        name: '8切り',
        body: '8を出すと場が流れる。',
        status: 'screening',
      },
    });
    expect(
      persistence.proposals.queue({
        eligibleIds: (candidates) =>
          new Set(candidates.map((candidate) => candidate.id)),
      }),
    ).toEqual([
      {
        id: '00000000Z8AAAAAAAAAAAAAAAA',
        authorId: 'author-1',
        kind: 'local',
        prefectureCode: '11',
        name: '8切り',
        body: '8を出すと場が流れる。',
        createdAt: 1_000,
      },
    ]);
  });

  it('HTTP境界でmethod・認証・JSON・body上限・区分整合を拒否する', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'daifugo-proposal-http-'));
    directories.push(directory);
    const persistence = new SqlitePersistence(
      join(directory, 'proposal.sqlite'),
      {
        createUserId: () => 'author-http',
        createToken: () => 'proposal-token-http',
      },
    );
    persistenceInstances.push(persistence);
    const session = persistence.sessions.resolve(undefined);
    const app = createAppServer({
      webDistDir: directory,
      proposals: new ProposalSubmissionService(persistence.proposals, {
        signals: NOOP_SIGNALS,
      }),
    });
    apps.push(app);
    const port = await app.listen(0, '127.0.0.1');
    const url = `http://127.0.0.1:${String(port)}/api/proposals`;

    const method = await fetch(url);
    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('POST');

    const unauthorized = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'original',
        name: '名前',
        body: '本文',
      }),
    });
    expect(unauthorized.status).toBe(401);

    const invalidJson = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.userToken}` },
      body: '{',
    });
    expect(invalidJson.status).toBe(400);
    await expect(invalidJson.json()).resolves.toEqual({
      error: 'invalid_json',
    });

    const tooLarge = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.userToken}` },
      body: JSON.stringify({ body: 'x'.repeat(9 * 1024) }),
    });
    expect(tooLarge.status).toBe(413);

    const invalidCombination = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.userToken}` },
      body: JSON.stringify({
        kind: 'original',
        prefectureCode: '13',
        name: '名前',
        body: '本文',
      }),
    });
    expect(invalidCombination.status).toBe(400);
    await expect(invalidCombination.json()).resolves.toMatchObject({
      error: 'validation_failed',
      fields: [{ field: 'prefectureCode', code: 'not_allowed' }],
    });
  });

  it('検査済み資格がない旧screening行はE7キューへ出さない', () => {
    const persistence = new SqlitePersistence(':memory:', {
      createUserId: () => 'author-legacy',
      createToken: () => 'proposal-token-legacy',
    });
    persistenceInstances.push(persistence);
    const session = persistence.sessions.resolve(undefined);
    const service = new ProposalSubmissionService(persistence.proposals, {
      signals: NOOP_SIGNALS,
      now: () => 2_000,
      createId: () => '00000001YGAAAAAAAAAAAAAAAA',
    });

    return expect(
      service
        .submit({
          token: session.userToken,
          ip: '127.0.0.1',
          body: {
            kind: 'original',
            name: '旧提案',
            body: 'E6導入前に保存された提案',
          },
        })
        .then(() => {
          const candidateId = '00000001YGAAAAAAAAAAAAAAAA';
          expect(
            persistence.proposals.queue({
              eligibleIds: () => new Set(),
            }),
          ).toEqual([]);
          expect(
            persistence.proposals.queue({
              eligibleIds: () => new Set([candidateId]),
            }),
          ).toEqual([
            expect.objectContaining({
              id: candidateId,
              name: '旧提案',
            }),
          ]);
        }),
    ).resolves.toBeUndefined();
  });

  it('許可した状態遷移だけを冪等に適用し、終端patchを検証する', async () => {
    const persistence = new SqlitePersistence(':memory:', {
      createUserId: () => 'author-transition',
      createToken: () => 'proposal-token-transition',
    });
    persistenceInstances.push(persistence);
    const session = persistence.sessions.resolve(undefined);
    const service = new ProposalSubmissionService(persistence.proposals, {
      signals: NOOP_SIGNALS,
      now: () => 3_000,
      createId: () => '00000002XRAAAAAAAAAAAAAAAA',
    });
    await service.submit({
      token: session.userToken,
      ip: '127.0.0.1',
      body: {
        kind: 'original',
        name: '完成テスト',
        body: '状態を順に進める。',
      },
    });
    const id = '00000002XRAAAAAAAAAAAAAAAA';

    expect(
      persistence.proposals.transitionProposal(
        id,
        'screening',
        'released',
        { ruleId: 'rule-1' },
        3_100,
      ),
    ).toBe('forbidden');
    expect(
      persistence.proposals.transitionProposal(
        id,
        'screening',
        'implementing',
        { reasonCode: 'ignored' },
        3_100,
      ),
    ).toBe('forbidden');
    expect(
      persistence.proposals.transitionProposal(
        id,
        'screening',
        'implementing',
        {},
        3_100,
      ),
    ).toBe('transitioned');
    expect(
      persistence.proposals.transitionProposal(
        id,
        'screening',
        'implementing',
        {},
        3_100,
      ),
    ).toBe('noop');
    expect(
      persistence.proposals.transitionProposal(
        id,
        'implementing',
        'released',
        {},
        3_200,
      ),
    ).toBe('forbidden');
    expect(
      persistence.proposals.transitionProposal(
        id,
        'implementing',
        'released',
        { ruleId: ' rule-1 ' },
        3_200,
      ),
    ).toBe('transitioned');
    expect(persistence.proposals.findById(id)).toMatchObject({
      status: 'released',
      ruleId: 'rule-1',
      reasonCode: null,
      statusChangedAt: 3_200,
    });
    expect(
      persistence.proposals.transitionProposal(
        id,
        'released',
        'rejected',
        { reasonCode: 'other', reasonText: '戻さない' },
        3_300,
      ),
    ).toBe('forbidden');
  });

  it('failedを終端化し、失敗確定後は同内容の再提案を許可する', async () => {
    const persistence = new SqlitePersistence(':memory:', {
      createUserId: () => 'author-retry',
      createToken: () => 'proposal-token-retry',
    });
    persistenceInstances.push(persistence);
    const session = persistence.sessions.resolve(undefined);
    const ids = ['00000003X0AAAAAAAAAAAAAAAA', '00000003X1AAAAAAAAAAAAAAAA'];
    const service = new ProposalSubmissionService(persistence.proposals, {
      signals: NOOP_SIGNALS,
      now: () => 4_000,
      createId: () => ids.shift()!,
    });
    const request = {
      kind: 'original',
      name: '再挑戦',
      body: '失敗したら一度だけ再挑戦する。',
    } as const;
    const first = await service.submit({
      token: session.userToken,
      ip: '127.0.0.1',
      body: request,
    });
    expect(first.body).toMatchObject({
      outcome: 'accepted',
      proposal: { id: '00000003X0AAAAAAAAAAAAAAAA' },
    });
    const id = '00000003X0AAAAAAAAAAAAAAAA';
    expect(
      persistence.proposals.transitionProposal(
        id,
        'screening',
        'implementing',
        {},
        4_100,
      ),
    ).toBe('transitioned');
    expect(
      persistence.proposals.transitionProposal(
        id,
        'implementing',
        'failed',
        {
          reasonCode: 'implementation_failed',
          reasonText: '実装に失敗しました',
        },
        4_200,
      ),
    ).toBe('transitioned');

    expect(
      persistence.proposals.transitionProposal(
        id,
        'failed',
        'implementing',
        {},
        4_300,
      ),
    ).toBe('forbidden');
    expect(persistence.proposals.findById(id)).toMatchObject({
      status: 'failed',
      attemptCount: 1,
      reasonCode: 'implementation_failed',
      reasonText: '実装に失敗しました',
    });

    const resubmitted = await service.submit({
      token: session.userToken,
      ip: '127.0.0.1',
      body: request,
    });
    expect(resubmitted.body).toMatchObject({
      outcome: 'accepted',
      proposal: { id: '00000003X1AAAAAAAAAAAAAAAA' },
    });
  });

  it('rejected・releasedの終端後は同内容を新しい提案として受け付ける', async () => {
    const persistence = new SqlitePersistence(':memory:', {
      createUserId: () => 'author-terminal',
      createToken: () => 'proposal-token-terminal',
    });
    persistenceInstances.push(persistence);
    const session = persistence.sessions.resolve(undefined);
    const ids = [
      '00000004W0AAAAAAAAAAAAAAAA',
      '00000004W1AAAAAAAAAAAAAAAA',
      '00000004W2AAAAAAAAAAAAAAAA',
      '00000004W3AAAAAAAAAAAAAAAA',
    ];
    const service = new ProposalSubmissionService(persistence.proposals, {
      signals: NOOP_SIGNALS,
      now: () => 5_000,
      createId: () => ids.shift()!,
    });
    const rejectedRequest = {
      kind: 'original',
      name: '却下後の再提案',
      body: '却下された内容をもう一度提案する。',
    } as const;
    const releasedRequest = {
      kind: 'original',
      name: '公開後の再提案',
      body: '公開された内容をもう一度提案する。',
    } as const;

    const rejected = await service.submit({
      token: session.userToken,
      ip: '127.0.0.1',
      body: rejectedRequest,
    });
    expect(rejected.body).toMatchObject({
      outcome: 'accepted',
      proposal: { id: '00000004W0AAAAAAAAAAAAAAAA' },
    });
    expect(
      persistence.proposals.transitionProposal(
        '00000004W0AAAAAAAAAAAAAAAA',
        'screening',
        'rejected',
        { reasonCode: 'out_of_scope', reasonText: 'ルールではありません' },
        5_100,
      ),
    ).toBe('transitioned');
    expect(
      (
        await service.submit({
          token: session.userToken,
          ip: '127.0.0.1',
          body: rejectedRequest,
        })
      ).body,
    ).toMatchObject({
      outcome: 'accepted',
      proposal: { id: '00000004W1AAAAAAAAAAAAAAAA' },
    });

    const released = await service.submit({
      token: session.userToken,
      ip: '127.0.0.1',
      body: releasedRequest,
    });
    expect(released.body).toMatchObject({
      outcome: 'accepted',
      proposal: { id: '00000004W2AAAAAAAAAAAAAAAA' },
    });
    expect(
      persistence.proposals.transitionProposal(
        '00000004W2AAAAAAAAAAAAAAAA',
        'screening',
        'implementing',
        {},
        5_200,
      ),
    ).toBe('transitioned');
    expect(
      persistence.proposals.transitionProposal(
        '00000004W2AAAAAAAAAAAAAAAA',
        'implementing',
        'released',
        { ruleId: 'released-rule' },
        5_300,
      ),
    ).toBe('transitioned');
    expect(
      (
        await service.submit({
          token: session.userToken,
          ip: '127.0.0.1',
          body: releasedRequest,
        })
      ).body,
    ).toMatchObject({
      outcome: 'accepted',
      proposal: { id: '00000004W3AAAAAAAAAAAAAAAA' },
    });
  });
});
