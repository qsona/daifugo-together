import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { QueuedImplementation } from '@daifugo/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
      resume: () => null,
      update: (_jobId, input) => {
        const value = input as {
          from: typeof current.phase;
          to: typeof current.phase;
          branch?: string;
          scaffoldSha?: string;
          promptVersion?: string;
          prNumber?: number;
          headSha?: string;
        };
        if (current.phase !== value.from) {
          return { status: 'conflict', error: 'stale_job_phase' };
        }
        current = {
          ...current,
          phase: value.to,
          branch: value.branch ?? current.branch,
          scaffoldSha: value.scaffoldSha ?? current.scaffoldSha,
          promptVersion: value.promptVersion ?? current.promptVersion,
          prNumber: value.prNumber ?? current.prNumber,
          headSha: value.headSha ?? current.headSha,
          updatedAt: 2,
        };
        return { status: 'updated', job: current };
      },
      retry: () => ({ status: 'invalid', error: 'unexpected_retry' }),
      fail: () => ({ status: 'invalid', error: 'unexpected_failure' }),
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
        inspect: async () => [],
        recoverImplementation: async () => null,
        publishImplementation: async () => ({
          prNumber: 42,
          headSha: 'b'.repeat(40),
        }),
      },
      runner: {
        run: async ({ directory }) => {
          await writeFile(
            join(directory, 'rule.ts'),
            'export const rule = { hooks: {} };\n',
          );
          await writeFile(
            join(directory, 'rule.test.ts'),
            "import { it } from 'vitest';\nit('generated', () => {});\n",
          );
          return { status: 'completed' };
        },
      },
    });

    expect(result).toMatchObject({
      status: 'ready',
      proposalId: 'proposal-1',
      job: {
        phase: 'pr_open',
        branch: 'rule/r0001-yagiri',
        scaffoldSha: 'a'.repeat(40),
        prNumber: 42,
        headSha: 'b'.repeat(40),
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
          "import { it } from 'vitest';\nit('generated', () => {});\n",
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
      ruleId: 'r0001-yagiri',
      proposalId: 'proposal-1',
      prefecture: '埼玉県',
    });
    expect(
      JSON.parse(await readFile(result.scaffold.specPath, 'utf8')),
    ).toEqual(queued().spec);
  });

  it('生成commit/PR後の応答消失はCodexを再実行せずpr_openを回復する', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipeline-rules-'));
    directories.push(root);
    const item = queued();
    item.job = {
      ...item.job,
      phase: 'implementing',
      branch: 'rule/r0001-yagiri',
      scaffoldSha: 'a'.repeat(40),
      promptVersion: 'cx02-v3',
    };
    const run = vi.fn<CodexRunner['run']>();
    const result = await runNextImplementation({
      item,
      jobs: {
        next: () => null,
        resume: () => item,
        retry: () => ({ status: 'invalid', error: 'unexpected_retry' }),
        fail: () => ({ status: 'invalid', error: 'unexpected_failure' }),
        update: (_jobId, input) => {
          const value = input as { from: string; to: string };
          return value.from === 'implementing' && value.to === 'pr_open'
            ? {
                status: 'updated',
                job: {
                  ...item.job,
                  phase: 'pr_open',
                  prNumber: 42,
                  headSha: 'b'.repeat(40),
                },
              }
            : { status: 'invalid', error: 'unexpected_update' };
        },
      },
      publisher: {
        publish: async () => ({
          branch: 'rule/r0001-yagiri',
          scaffoldSha: 'a'.repeat(40),
        }),
        recoverImplementation: async () => ({
          prNumber: 42,
          headSha: 'b'.repeat(40),
        }),
        inspect: async () => {
          throw new Error('inspection should have been recovered');
        },
        publishImplementation: async () => {
          throw new Error('implementation should not be republished');
        },
      },
      runner: { run },
      rulesRoot: root,
      promptPath: 'packages/pipeline/prompts/implement.md',
    });

    expect(result).toMatchObject({
      status: 'ready',
      job: { phase: 'pr_open', prNumber: 42 },
    });
    expect(run).not.toHaveBeenCalled();
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
          await writeFile(
            join(directory, 'rule.ts'),
            [
              "import fs from 'fs';",
              "export { PipelineJobService } from '@daifugo/server';",
              'const stamp = Date.now();',
              'const roll = Math.random();',
              'process.exit(stamp + roll);',
            ].join('\n'),
          );
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
        'rule.ts: imports forbidden module fs',
        'rule.ts: imports forbidden module @daifugo/server',
        'rule.ts: contains forbidden token Date.now',
        'rule.ts: contains forbidden token Math.random',
        'rule.ts: contains forbidden token process.',
      ]),
    });
  });
});
