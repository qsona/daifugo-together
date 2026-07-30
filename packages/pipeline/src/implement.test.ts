import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PipelineJob, QueuedImplementation } from '@daifugo/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  prepareImplementation,
  submitPreparedImplementation,
  type PipelineJobPort,
  type ScaffoldPublisher,
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

function jobs(initial: QueuedImplementation): PipelineJobPort & {
  current: () => PipelineJob;
} {
  let current = initial.job;
  return {
    current: () => current,
    next: () => (current.phase === 'queued' ? initial : null),
    resume: () => ({ ...initial, job: current }),
    update: (_jobId, input) => {
      const value = input as {
        from: PipelineJob['phase'];
        to: PipelineJob['phase'];
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
        updatedAt: current.updatedAt + 1,
      };
      return { status: 'updated', job: current };
    },
    retry: () => ({ status: 'invalid', error: 'unexpected_retry' }),
    fail: () => ({ status: 'invalid', error: 'unexpected_failure' }),
  };
}

async function writeGenerated(directory: string): Promise<void> {
  await writeFile(
    join(directory, 'rule.ts'),
    'export const rule = { meta: {}, hooks: {} };\n',
  );
  await writeFile(
    join(directory, 'rule.test.ts'),
    "import { it } from 'vitest';\nit('generated', () => {});\n",
  );
}

describe('CX-02 interactive-session implementation', () => {
  it('prepare後に通常セッションの生成物をsubmitしてPRへ進める', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'pipeline-workspace-'));
    directories.push(workspace);
    const item = queued();
    const jobPort = jobs(item);
    const publishImplementation = vi.fn(async () => ({
      prNumber: 42,
      headSha: 'b'.repeat(40),
    }));
    const publisher: ScaffoldPublisher = {
      publish: async ({ scaffold }) => {
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
      publishImplementation,
    };

    const prepared = await prepareImplementation({
      item,
      jobs: jobPort,
      publisher,
      rulesRoot: join(workspace, 'packages/rules'),
    });
    expect(prepared).toMatchObject({
      status: 'prepared',
      job: {
        phase: 'implementing',
        promptVersion: 'cx02-v4',
        scaffoldSha: 'a'.repeat(40),
      },
    });
    if (prepared.status !== 'prepared') return;
    await writeGenerated(prepared.scaffold.directory);

    const submitted = await submitPreparedImplementation({
      item: { ...item, job: jobPort.current() },
      jobs: jobPort,
      publisher,
      verifier: { verify: async () => [] },
      workspace,
      rulesRoot: join(workspace, 'packages/rules'),
    });
    expect(submitted).toMatchObject({
      status: 'ready',
      job: {
        phase: 'pr_open',
        prNumber: 42,
        headSha: 'b'.repeat(40),
      },
    });
    expect(publishImplementation).toHaveBeenCalledOnce();
  });

  it('旧cx02-v3の中断jobを同じattemptでprepare再開できる', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'pipeline-workspace-'));
    directories.push(workspace);
    const item = queued();
    item.job = {
      ...item.job,
      phase: 'implementing',
      branch: 'rule/r0001-yagiri',
      scaffoldSha: 'a'.repeat(40),
      promptVersion: 'cx02-v3',
    };
    const update = vi.fn<PipelineJobPort['update']>();
    const result = await prepareImplementation({
      item,
      jobs: {
        next: () => null,
        resume: () => item,
        update,
        retry: () => ({ status: 'invalid', error: 'unexpected_retry' }),
        fail: () => ({ status: 'invalid', error: 'unexpected_failure' }),
      },
      publisher: {
        publish: async () => ({
          branch: 'rule/r0001-yagiri',
          scaffoldSha: 'a'.repeat(40),
        }),
        recoverImplementation: async () => null,
        inspect: async () => [],
        publishImplementation: async () => {
          throw new Error('not submitted');
        },
      },
      rulesRoot: join(workspace, 'packages/rules'),
    });
    expect(result).toMatchObject({
      status: 'prepared',
      job: { attempt: 1, promptVersion: 'cx02-v3' },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('scaffold改変・範囲外ファイル・禁止tokenをsubmit前検収で止める', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'pipeline-workspace-'));
    directories.push(workspace);
    const item = queued();
    item.job = {
      ...item.job,
      phase: 'implementing',
      branch: 'rule/r0001-yagiri',
      scaffoldSha: 'a'.repeat(40),
      promptVersion: 'cx02-v4',
    };
    const rulesRoot = join(workspace, 'packages/rules');
    const prepared = await prepareImplementation({
      item,
      jobs: jobs(item),
      publisher: {
        publish: async () => ({
          branch: 'rule/r0001-yagiri',
          scaffoldSha: 'a'.repeat(40),
        }),
        recoverImplementation: async () => null,
        inspect: async () => [],
        publishImplementation: async () => {
          throw new Error('not submitted');
        },
      },
      rulesRoot,
    });
    if (prepared.status !== 'prepared') return;
    await writeFile(prepared.scaffold.specPath, '{}\n');
    await writeFile(
      join(prepared.scaffold.directory, 'rule.ts'),
      "import fs from 'fs';\nprocess.exit(1);\n",
    );
    await writeFile(
      join(prepared.scaffold.directory, 'rule.test.ts'),
      'export {};\n',
    );
    await writeFile(
      join(prepared.scaffold.directory, 'extra.ts'),
      'export {};\n',
    );
    const verify = vi.fn(async () => []);
    const result = await submitPreparedImplementation({
      item,
      jobs: jobs(item),
      publisher: {
        publish: async () => {
          throw new Error('already prepared');
        },
        inspect: async () => ['git: unexpected path'],
        recoverImplementation: async () => null,
        publishImplementation: async () => {
          throw new Error('not submitted');
        },
      },
      verifier: { verify },
      workspace,
      rulesRoot,
    });
    expect(result).toMatchObject({
      status: 'inspect_failed',
      violations: expect.arrayContaining([
        'SPEC.json: scaffold content was modified',
        'extra.ts: unexpected generated path',
        'rule.ts: imports forbidden module fs',
        'rule.ts: contains forbidden token process.',
        'git: unexpected path',
      ]),
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it('生成commit後の応答消失は再commitせずPRとpr_openを回復する', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'pipeline-workspace-'));
    directories.push(workspace);
    const item = queued();
    item.job = {
      ...item.job,
      phase: 'implementing',
      branch: 'rule/r0001-yagiri',
      scaffoldSha: 'a'.repeat(40),
      promptVersion: 'cx02-v4',
    };
    const jobPort = jobs(item);
    const rulesRoot = join(workspace, 'packages/rules');
    const prepared = await prepareImplementation({
      item,
      jobs: jobPort,
      publisher: {
        publish: async () => ({
          branch: 'rule/r0001-yagiri',
          scaffoldSha: 'a'.repeat(40),
        }),
        recoverImplementation: async () => null,
        inspect: async () => [],
        publishImplementation: async () => {
          throw new Error('not submitted');
        },
      },
      rulesRoot,
    });
    if (prepared.status !== 'prepared') return;
    await writeGenerated(prepared.scaffold.directory);
    const publishImplementation =
      vi.fn<ScaffoldPublisher['publishImplementation']>();
    const result = await submitPreparedImplementation({
      item: { ...item, job: jobPort.current() },
      jobs: jobPort,
      publisher: {
        publish: async () => {
          throw new Error('already prepared');
        },
        inspect: async () => [],
        recoverImplementation: async () => ({
          prNumber: 42,
          headSha: 'b'.repeat(40),
        }),
        publishImplementation,
      },
      verifier: { verify: async () => [] },
      workspace,
      rulesRoot,
    });
    expect(result).toMatchObject({
      status: 'ready',
      job: { phase: 'pr_open', prNumber: 42 },
    });
    expect(publishImplementation).not.toHaveBeenCalled();
  });

  it('pr_openを同じattemptで再開し既存PRのhead SHAを更新する', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'pipeline-workspace-'));
    directories.push(workspace);
    const item = queued();
    item.job = {
      ...item.job,
      phase: 'pr_open',
      branch: 'rule/r0001-yagiri',
      scaffoldSha: 'a'.repeat(40),
      promptVersion: 'cx02-v4',
      prNumber: 42,
      headSha: 'b'.repeat(40),
    };
    const jobPort = jobs(item);
    const rulesRoot = join(workspace, 'packages/rules');
    const prepared = await prepareImplementation({
      item,
      jobs: jobPort,
      publisher: {
        publish: async () => ({
          branch: 'rule/r0001-yagiri',
          scaffoldSha: 'a'.repeat(40),
        }),
        recoverImplementation: async () => null,
        inspect: async () => [],
        publishImplementation: async () => {
          throw new Error('not submitted');
        },
      },
      rulesRoot,
    });
    expect(prepared).toMatchObject({
      status: 'prepared',
      job: { phase: 'pr_open', attempt: 1, prNumber: 42 },
    });
    if (prepared.status !== 'prepared') return;
    await writeGenerated(prepared.scaffold.directory);

    const result = await submitPreparedImplementation({
      item: { ...item, job: jobPort.current() },
      jobs: jobPort,
      publisher: {
        publish: async () => {
          throw new Error('already prepared');
        },
        inspect: async () => [],
        recoverImplementation: async () => null,
        publishImplementation: async () => ({
          prNumber: 42,
          headSha: 'c'.repeat(40),
        }),
      },
      verifier: { verify: async () => [] },
      workspace,
      rulesRoot,
    });

    expect(result).toMatchObject({
      status: 'ready',
      job: {
        phase: 'pr_open',
        attempt: 1,
        prNumber: 42,
        headSha: 'c'.repeat(40),
      },
    });
  });
});
