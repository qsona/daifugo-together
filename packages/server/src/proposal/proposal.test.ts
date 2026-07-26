import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CreateProposalResponse } from '@daifugo/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createAppServer, type AppServer } from '../app-server.js';
import { SqlitePersistence } from '../persistence.js';
import { ProposalSubmissionService } from './submission.js';

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
    expect(persistence.proposals.queue()).toEqual([
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
});
