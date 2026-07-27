import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { QueuedImplementation } from '@daifugo/server';
import { afterEach, describe, expect, it } from 'vitest';

import { implementQueuedRule, type CodexRunner } from './implement.js';
import {
  runNextImplementation,
  type PipelineJobPort,
} from './implementation-driver.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function queued(): QueuedImplementation {
  return {
    job: {
      id: 1,
      proposalId: 'proposal-1',
      phase: 'queued',
      attempt: 1,
      ciRerun: 0,
      ruleId: 'r0001',
      slug: 'yagiri',
      branch: null,
      prNumber: null,
      headSha: null,
      scaffoldSha: null,
      promptVersion: 'cx01-v1',
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
      testPoints: ['8で発動する', '8以外では発動しない'],
      notes: '',
      source: {
        kind: 'local',
        title: '八切り',
        body: '8を出したら場を流す。',
      },
    },
    scaffoldMeta: { slug: 'yagiri', messages: {} },
  };
}

describe('CX-02 implementation vertical slice', () => {
  it('queued jobをscaffold固定後にclaimし、FakeCodex生成結果を提案へ結びつける', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipeline-rules-'));
    directories.push(root);
    const item = queued();
    let current = item.job;
    const jobs: PipelineJobPort = {
      next: () => (current.phase === 'queued' ? item : null),
      update: (_jobId, input) => {
        const value = input as {
          from: 'queued';
          to: 'implementing';
          branch: string;
          scaffoldSha: string;
        };
        if (current.phase !== value.from) {
          return { status: 'conflict', error: 'stale_job_phase' };
        }
        current = {
          ...current,
          phase: value.to,
          branch: value.branch,
          scaffoldSha: value.scaffoldSha,
          updatedAt: 2,
        };
        return { status: 'updated', job: current };
      },
    };
    const result = await runNextImplementation({
      jobs,
      rulesRoot: root,
      promptPath: 'packages/pipeline/prompts/implement.md',
      publisher: {
        publish: async ({ item: publishedItem, scaffold }) => {
          expect(publishedItem.proposal.id).toBe('proposal-1');
          await expect(readFile(scaffold.metaPath, 'utf8')).resolves.toContain(
            '"proposalId": "proposal-1"',
          );
          return {
            branch: 'rule/r0001-yagiri',
            scaffoldSha: 'a'.repeat(40),
          };
        },
      },
      runner: {
        run: async ({ directory }) => {
          await writeFile(
            join(directory, 'rule.ts'),
            'export const rule = { hooks: {} };\n',
          );
          await writeFile(
            join(directory, 'rule.test.ts'),
            'export const cases = ["fires", "does not fire", "boundary"];\n',
          );
          return { status: 'completed' };
        },
      },
    });

    expect(result).toMatchObject({
      status: 'ready',
      proposalId: 'proposal-1',
      job: {
        phase: 'implementing',
        branch: 'rule/r0001-yagiri',
        scaffoldSha: 'a'.repeat(40),
      },
    });
    expect(jobs.next()).toBeNull();
  });

  it('承認SPECを不変scaffoldにし、FakeCodex成果物を検収する', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipeline-rules-'));
    directories.push(root);
    const runner: CodexRunner = {
      run: async ({ directory }) => {
        await writeFile(
          join(directory, 'rule.ts'),
          'export const rule = { hooks: {} };\n',
        );
        await writeFile(
          join(directory, 'rule.test.ts'),
          'export const cases = ["fires", "does not fire", "boundary"];\n',
        );
        return { status: 'completed' };
      },
    };
    const result = await implementQueuedRule({
      item: queued(),
      rulesRoot: root,
      promptPath: 'packages/pipeline/prompts/implement.md',
      runner,
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(
      JSON.parse(await readFile(result.scaffold.metaPath, 'utf8')),
    ).toMatchObject({
      id: 'r0001',
      slug: 'yagiri',
      proposalId: 'proposal-1',
      prefecture: '埼玉県',
    });
    expect(
      JSON.parse(await readFile(result.scaffold.specPath, 'utf8')),
    ).toEqual(queued().spec);
  });

  it('scaffold改変・範囲外ファイル・禁止tokenを検収で止める', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipeline-rules-'));
    directories.push(root);
    const result = await implementQueuedRule({
      item: queued(),
      rulesRoot: root,
      promptPath: 'packages/pipeline/prompts/implement.md',
      runner: {
        run: async ({ directory }) => {
          await writeFile(join(directory, 'SPEC.json'), '{}\n');
          await writeFile(join(directory, 'rule.ts'), 'process.exit(0);\n');
          await writeFile(join(directory, 'rule.test.ts'), 'export {};\n');
          await writeFile(join(directory, 'extra.ts'), 'export {};\n');
          return { status: 'completed' };
        },
      },
    });
    expect(result).toMatchObject({
      status: 'inspect_failed',
      violations: expect.arrayContaining([
        'SPEC.json: scaffold content was modified',
        'extra.ts: unexpected generated path',
        'rule.ts: contains forbidden token process.',
      ]),
    });
  });
});
