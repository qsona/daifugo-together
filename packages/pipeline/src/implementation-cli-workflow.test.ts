import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PipelineJob, QueuedImplementation } from '@daifugo/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PipelineJobPort } from './implementation-driver.js';
import {
  prepareImplementationRetry,
  prepareImplementationWorkspace,
  removeCompletedWorkspace,
  runTransient,
} from './implementation-cli-workflow.js';
import type { ProcessPort, ProcessResult } from './process.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function result(
  exitCode: number | null,
  options: Partial<ProcessResult> = {},
): ProcessResult {
  return {
    exitCode,
    stdout: '',
    stderr: '',
    timedOut: false,
    ...options,
  };
}

function item(
  phase: PipelineJob['phase'],
  options: Partial<PipelineJob> = {},
): QueuedImplementation {
  return {
    job: {
      id: 1,
      proposalId: 'proposal-1',
      phase,
      attempt: 1,
      ciRerun: 0,
      ruleId: 'r0001-yagiri',
      slug: 'yagiri',
      branch: 'rule/r0001-yagiri',
      prNumber: null,
      headSha: null,
      scaffoldSha: 'a'.repeat(40),
      promptVersion: 'cx02-v2',
      errorCode: null,
      errorNote: null,
      createdAt: 1,
      updatedAt: 1,
      ...options,
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
  };
}

function processPort(
  run: ProcessPort['run'],
): ProcessPort & { inputs: Parameters<ProcessPort['run']>[0][] } {
  const inputs: Parameters<ProcessPort['run']>[0][] = [];
  return {
    inputs,
    run: async (input) => {
      inputs.push(input);
      return run(input);
    },
  };
}

function retryJobs(
  current: QueuedImplementation,
  onRetry?: () => void,
): Pick<PipelineJobPort, 'resume' | 'retry'> & { retryCalls: unknown[] } {
  const retryCalls: unknown[] = [];
  return {
    retryCalls,
    resume: () => current,
    retry: (_jobId, input) => {
      retryCalls.push(input);
      onRetry?.();
      return {
        status: 'retried',
        job: {
          ...current.job,
          phase: 'implementing',
          attempt: 2,
          branch: null,
          prNumber: null,
          headSha: null,
          scaffoldSha: null,
          promptVersion: null,
        },
      };
    },
  };
}

describe('implementation CLI workflow', () => {
  it('transient commandを最大3回、指数バックオフ付きで再試行する', async () => {
    const waits: number[] = [];
    let calls = 0;
    const process = processPort(async () => {
      calls += 1;
      return calls < 3 ? result(1) : result(0);
    });

    await expect(
      runTransient(
        process,
        { command: 'git', args: ['fetch'], cwd: '/repo', timeoutMs: 1_000 },
        { wait: async (delay) => void waits.push(delay) },
      ),
    ).resolves.toMatchObject({ exitCode: 0 });
    expect(calls).toBe(3);
    expect(waits).toEqual([100, 200]);
  });

  it('pr_open attempt 1を旧PR close、旧branch delete後にattempt 2へ進める', async () => {
    const previous = item('pr_open', { prNumber: 42 });
    let cleanupComplete = false;
    const jobs = retryJobs(previous, () => {
      expect(cleanupComplete).toBe(true);
    });
    const process = processPort(async (input) => {
      if (input.command === 'gh' && input.args[1] === 'view') {
        return result(0, { stdout: '{"state":"OPEN"}' });
      }
      if (input.command === 'git' && input.args[0] === 'push') {
        cleanupComplete = true;
      }
      return result(0);
    });

    await expect(
      prepareImplementationRetry({
        jobs,
        process,
        repositoryUrl: 'git@example.test:rules.git',
        cwd: '/repo',
        jobId: 1,
        wait: async () => {},
      }),
    ).resolves.toMatchObject({
      job: {
        phase: 'implementing',
        attempt: 2,
        branch: null,
        scaffoldSha: null,
      },
    });
    expect(process.inputs).toEqual([
      expect.objectContaining({
        command: 'gh',
        args: ['pr', 'view', '42', '--json', 'state'],
      }),
      expect.objectContaining({
        command: 'gh',
        args: [
          'pr',
          'close',
          '42',
          '--comment',
          'Closing failed implementation attempt before developer-authorized retry.',
        ],
      }),
      expect.objectContaining({
        command: 'git',
        args: [
          'ls-remote',
          '--exit-code',
          '--heads',
          'git@example.test:rules.git',
          'refs/heads/rule/r0001-yagiri',
        ],
      }),
      expect.objectContaining({
        command: 'git',
        args: [
          'push',
          'git@example.test:rules.git',
          '--delete',
          'rule/r0001-yagiri',
        ],
      }),
    ]);
    expect(jobs.retryCalls).toEqual([{ from: 'pr_open', expectedAttempt: 1 }]);
  });

  it('途中応答消失後は完了済みcleanupを安全に飛ばしてCASを再開する', async () => {
    const previous = item('pr_open', { prNumber: 42 });
    const jobs = retryJobs(previous);
    let invocation = 1;
    const process = processPort(async (input) => {
      if (input.command === 'gh' && input.args[1] === 'view') {
        return result(0, {
          stdout: invocation === 1 ? '{"state":"OPEN"}' : '{"state":"CLOSED"}',
        });
      }
      if (
        invocation === 1 &&
        input.command === 'git' &&
        input.args[0] === 'ls-remote'
      ) {
        return result(1, { stderr: 'temporary remote failure' });
      }
      return result(0);
    });

    await expect(
      prepareImplementationRetry({
        jobs,
        process,
        repositoryUrl: 'repo',
        cwd: '/repo',
        jobId: 1,
        wait: async () => {},
      }),
    ).rejects.toThrow('temporary remote failure');
    expect(jobs.retryCalls).toHaveLength(0);

    invocation = 2;
    await expect(
      prepareImplementationRetry({
        jobs,
        process,
        repositoryUrl: 'repo',
        cwd: '/repo',
        jobId: 1,
        wait: async () => {},
      }),
    ).resolves.toMatchObject({ job: { attempt: 2 } });
    expect(
      process.inputs.filter(
        (input) => input.command === 'gh' && input.args[1] === 'close',
      ),
    ).toHaveLength(1);
    expect(jobs.retryCalls).toHaveLength(1);
  });

  it('旧branchが既に無ければdeleteを飛ばしてretryする', async () => {
    const previous = item('implementing');
    const jobs = retryJobs(previous);
    const process = processPort(async (input) =>
      input.command === 'git' && input.args[0] === 'ls-remote'
        ? result(2)
        : result(0),
    );

    await prepareImplementationRetry({
      jobs,
      process,
      repositoryUrl: 'repo',
      cwd: '/repo',
      jobId: 1,
      wait: async () => {},
    });

    expect(process.inputs).toHaveLength(1);
    expect(process.inputs[0]?.args[0]).toBe('ls-remote');
    expect(jobs.retryCalls).toHaveLength(1);
  });

  it('cleanupが3回失敗した場合はjob attemptを進めない', async () => {
    const previous = item('pr_open', { prNumber: 42 });
    const jobs = retryJobs(previous);
    const process = processPort(async (input) =>
      input.command === 'gh' && input.args[1] === 'view'
        ? result(0, { stdout: '{"state":"OPEN"}' })
        : result(1, { stderr: 'close failed' }),
    );

    await expect(
      prepareImplementationRetry({
        jobs,
        process,
        repositoryUrl: 'repo',
        cwd: '/repo',
        jobId: 1,
        wait: async () => {},
      }),
    ).rejects.toThrow('close failed');
    expect(
      process.inputs.filter(
        (input) => input.command === 'gh' && input.args[1] === 'close',
      ),
    ).toHaveLength(3);
    expect(jobs.retryCalls).toHaveLength(0);
  });

  it('retry CAS成功後の応答消失はattempt 2を副作用なしで返す', async () => {
    const retried = item('implementing', {
      attempt: 2,
      branch: null,
      scaffoldSha: null,
      promptVersion: null,
    });
    const retry = vi.fn<PipelineJobPort['retry']>();
    const process = processPort(async () => result(0));

    await expect(
      prepareImplementationRetry({
        jobs: { resume: () => retried, retry },
        process,
        repositoryUrl: 'repo',
        cwd: '/repo',
        jobId: 1,
      }),
    ).resolves.toEqual(retried);
    expect(process.inputs).toHaveLength(0);
    expect(retry).not.toHaveBeenCalled();
  });

  it('scaffold固定後のattempt 2は2回目のretryを拒否する', async () => {
    const secondAttempt = item('implementing', {
      attempt: 2,
      branch: 'rule/r0001-yagiri-a2',
      scaffoldSha: 'b'.repeat(40),
    });
    const retry = vi.fn<PipelineJobPort['retry']>();
    const process = processPort(async () => result(0));

    await expect(
      prepareImplementationRetry({
        jobs: { resume: () => secondAttempt, retry },
        process,
        repositoryUrl: 'repo',
        cwd: '/repo',
        jobId: 1,
      }),
    ).rejects.toThrow('job is not eligible for one implementation retry');
    expect(process.inputs).toHaveLength(0);
    expect(retry).not.toHaveBeenCalled();
  });

  it('clone/installの一時失敗を回復し、成功workspaceを明示的に削除する', async () => {
    const workRoot = await mkdtemp(join(tmpdir(), 'implementation-work-'));
    directories.push(workRoot);
    let cloneCalls = 0;
    let installCalls = 0;
    const process = processPort(async (input) => {
      if (input.command === 'git') {
        cloneCalls += 1;
        return cloneCalls < 3 ? result(1) : result(0);
      }
      installCalls += 1;
      return installCalls < 3 ? result(1) : result(0);
    });

    const workspace = await prepareImplementationWorkspace({
      process,
      repositoryUrl: 'repo',
      workRoot,
      wait: async () => {},
    });
    expect(cloneCalls).toBe(3);
    expect(installCalls).toBe(3);
    await expect(access(workspace)).resolves.toBeUndefined();

    await removeCompletedWorkspace(workspace);
    await expect(access(workspace)).rejects.toThrow();
  });

  it('workspace準備が恒久失敗した場合は一時directoryを残さない', async () => {
    const workRoot = await mkdtemp(join(tmpdir(), 'implementation-work-'));
    directories.push(workRoot);
    const process = processPort(async () =>
      result(1, { stderr: 'clone failed' }),
    );

    await expect(
      prepareImplementationWorkspace({
        process,
        repositoryUrl: 'repo',
        workRoot,
        wait: async () => {},
      }),
    ).rejects.toThrow('clone failed');
    await expect(readdir(workRoot)).resolves.toEqual([]);
  });
});
