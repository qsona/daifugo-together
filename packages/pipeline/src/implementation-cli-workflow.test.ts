import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  PipelineJob,
  QueuedImplementation,
  StoredRule,
  StoredRuleVersion,
} from '@daifugo/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PipelineJobPort } from './implementation-driver.js';
import type { RuleReleasePort } from './implementation-api.js';
import {
  prepareImplementationRetry,
  prepareImplementationWorkspace,
  recordMergedImplementation,
  releaseDeployedRule,
  removeCompletedWorkspace,
  runTransient,
  validatePreparedWorkspace,
  verifyGitHubPublisher,
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
      mergeSha: null,
      scaffoldSha: 'a'.repeat(40),
      promptVersion: 'cx02-v3',
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
          mergeSha: null,
          scaffoldSha: null,
          promptVersion: null,
        },
      };
    },
  };
}

function storedRule(
  status: StoredRule['status'] = 'disabled',
  disabledReason: StoredRule['disabledReason'] = 'pending_enable',
): StoredRule {
  return {
    id: 'r0001-yagiri',
    slug: 'yagiri',
    name: '八切り',
    description: '8を含むプレイの直後に場を流す。',
    kind: 'local',
    prefecture: '埼玉県',
    proposalId: 'proposal-1',
    status,
    disabledReason,
    activatedAt: status === 'active' ? 1 : null,
    ratingUp: 0,
    ratingDown: 0,
    popularityScore: 0.5,
    popularityUpdatedAt: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function storedVersion(
  options: Partial<StoredRuleVersion> = {},
): StoredRuleVersion {
  return {
    id: 1,
    ruleId: 'r0001-yagiri',
    version: 1,
    contractVersion: 1,
    prNumber: 42,
    mergeSha: 'c'.repeat(40),
    bundleHash: 'd'.repeat(64),
    isCurrent: true,
    revertedAt: null,
    createdAt: 1,
    ...options,
  };
}

describe('implementation CLI workflow', () => {
  it('submit対象workspaceをwork root直下のprepare生成名に限定する', () => {
    expect(
      validatePreparedWorkspace('/tmp/rules/daifugo-rule-abc123', '/tmp/rules'),
    ).toBe('/tmp/rules/daifugo-rule-abc123');
    expect(() => validatePreparedWorkspace('/tmp/rules', '/tmp/rules')).toThrow(
      'prepared daifugo-rule directory',
    );
    expect(() =>
      validatePreparedWorkspace(
        '/tmp/rules/nested/daifugo-rule-abc123',
        '/tmp/rules',
      ),
    ).toThrow('prepared daifugo-rule directory');
  });

  it('repository ownerまたは追加allowlistのgh loginだけを許可する', async () => {
    const ownerProcess = processPort(async () =>
      result(0, { stdout: 'qsona\n' }),
    );
    await expect(
      verifyGitHubPublisher({
        process: ownerProcess,
        repositoryUrl: 'git@github.com:qsona/daifugo-together.git',
        cwd: '/repo',
      }),
    ).resolves.toBe('qsona');

    const pipelineProcess = processPort(async () =>
      result(0, { stdout: 'pipeline-bot\n' }),
    );
    await expect(
      verifyGitHubPublisher({
        process: pipelineProcess,
        repositoryUrl: 'https://github.com/qsona/daifugo-together.git',
        additionalAllowedAuthors: 'pipeline-bot',
        cwd: '/repo',
      }),
    ).resolves.toBe('pipeline-bot');
    await expect(
      verifyGitHubPublisher({
        process: pipelineProcess,
        repositoryUrl: 'https://github.com/qsona/daifugo-together.git',
        cwd: '/repo',
      }),
    ).rejects.toThrow('is not allowed to publish rule PRs');
  });

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

  it('GitHubのreview済みheadとmerge commitを照合してmergedを記録する', async () => {
    const current = item('pr_open', {
      prNumber: 42,
      headSha: 'b'.repeat(40),
    });
    const updates: unknown[] = [];
    const jobs: Pick<PipelineJobPort, 'resume' | 'update'> = {
      resume: () => current,
      update: (_jobId, input) => {
        updates.push(input);
        return {
          status: 'updated',
          job: {
            ...current.job,
            phase: 'merged',
            mergeSha: 'c'.repeat(40),
          },
        };
      },
    };
    const process = processPort(async () =>
      result(0, {
        stdout: JSON.stringify({
          state: 'MERGED',
          mergedAt: '2026-07-27T00:00:00Z',
          headRefOid: 'b'.repeat(40),
          mergeCommit: { oid: 'c'.repeat(40) },
        }),
      }),
    );

    await expect(
      recordMergedImplementation({
        jobs,
        process,
        cwd: '/repo',
        jobId: 1,
      }),
    ).resolves.toMatchObject({
      status: 'recorded',
      job: { phase: 'merged', mergeSha: 'c'.repeat(40) },
    });
    expect(updates).toEqual([
      {
        from: 'pr_open',
        to: 'merged',
        mergeSha: 'c'.repeat(40),
      },
    ]);
    expect(process.inputs[0]).toMatchObject({
      command: 'gh',
      args: [
        'pr',
        'view',
        '42',
        '--json',
        'state,mergedAt,mergeCommit,headRefOid',
      ],
    });
  });

  it('異なるPR headを拒否し、記録済みmergeは副作用なく再検証する', async () => {
    const current = item('pr_open', {
      prNumber: 42,
      headSha: 'b'.repeat(40),
    });
    const mismatched = processPort(async () =>
      result(0, {
        stdout: JSON.stringify({
          state: 'MERGED',
          mergedAt: '2026-07-27T00:00:00Z',
          headRefOid: 'd'.repeat(40),
          mergeCommit: { oid: 'c'.repeat(40) },
        }),
      }),
    );
    const update = vi.fn();
    await expect(
      recordMergedImplementation({
        jobs: { resume: () => current, update },
        process: mismatched,
        cwd: '/repo',
        jobId: 1,
      }),
    ).rejects.toThrow('reviewed job head');
    expect(update).not.toHaveBeenCalled();

    const recorded = item('merged', {
      prNumber: 42,
      headSha: 'b'.repeat(40),
      mergeSha: 'c'.repeat(40),
    });
    const matching = processPort(async () =>
      result(0, {
        stdout: JSON.stringify({
          state: 'MERGED',
          mergedAt: '2026-07-27T00:00:00Z',
          headRefOid: 'b'.repeat(40),
          mergeCommit: { oid: 'c'.repeat(40) },
        }),
      }),
    );
    await expect(
      recordMergedImplementation({
        jobs: { resume: () => recorded, update },
        process: matching,
        cwd: '/repo',
        jobId: 1,
      }),
    ).resolves.toMatchObject({ status: 'already_recorded' });
    expect(update).not.toHaveBeenCalled();
  });

  it('deployと一時API障害を待ち、provenance一致後にruleを有効化する', async () => {
    const current = item('merged', {
      prNumber: 42,
      headSha: 'b'.repeat(40),
      mergeSha: 'c'.repeat(40),
      updatedAt: 1_000,
    });
    let now = 1_000;
    const get = vi
      .fn<RuleReleasePort['get']>()
      .mockResolvedValueOnce({ status: 'not_found' })
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce({
        status: 'found',
        rule: storedRule(),
        versions: [storedVersion()],
        releaseReady: true,
      });
    const enable = vi.fn<RuleReleasePort['enable']>().mockResolvedValue({
      status: 'updated',
      rule: storedRule('active', null),
    });

    await expect(
      releaseDeployedRule({
        jobs: { resume: () => current },
        rules: { get, enable },
        jobId: 1,
        maxWaitMs: 2_000,
        pollIntervalMs: 100,
        now: () => now,
        wait: async (delay) => {
          now += delay;
        },
      }),
    ).resolves.toEqual({
      status: 'released',
      jobId: 1,
      ruleId: 'r0001-yagiri',
    });
    expect(get).toHaveBeenCalledTimes(3);
    expect(enable).toHaveBeenCalledOnce();
  });

  it('provenance不一致を有効化せずpendingとして返し、48時間超を通知する', async () => {
    const now = 48 * 60 * 60 * 1_000 + 2;
    const current = item('merged', {
      prNumber: 42,
      mergeSha: 'c'.repeat(40),
      updatedAt: 1,
    });
    const enable = vi.fn<RuleReleasePort['enable']>();

    await expect(
      releaseDeployedRule({
        jobs: { resume: () => current },
        rules: {
          get: async () => ({
            status: 'found',
            rule: storedRule(),
            versions: [storedVersion({ mergeSha: 'e'.repeat(40) })],
            releaseReady: true,
          }),
          enable,
        },
        jobId: 1,
        maxWaitMs: 0,
        now: () => now,
      }),
    ).resolves.toEqual({
      status: 'pending',
      jobId: 1,
      ruleId: 'r0001-yagiri',
      reason: 'provenance_mismatch',
      reminder: true,
    });
    expect(enable).not.toHaveBeenCalled();
  });

  it('readiness確認はprovenance一致をreadyとして返すだけで有効化しない', async () => {
    const current = item('merged', {
      prNumber: 42,
      mergeSha: 'c'.repeat(40),
    });
    const enable = vi.fn<RuleReleasePort['enable']>();

    await expect(
      releaseDeployedRule({
        jobs: { resume: () => current },
        rules: {
          get: async () => ({
            status: 'found',
            rule: storedRule(),
            versions: [storedVersion()],
            releaseReady: true,
          }),
          enable,
        },
        jobId: 1,
        enable: false,
        maxWaitMs: 0,
      }),
    ).resolves.toEqual({
      status: 'ready',
      jobId: 1,
      ruleId: 'r0001-yagiri',
    });
    expect(enable).not.toHaveBeenCalled();
  });

  it('起動中registryが同期を拒否したruleはreadyにせず有効化しない', async () => {
    const current = item('merged', {
      prNumber: 42,
      mergeSha: 'c'.repeat(40),
    });
    const enable = vi.fn<RuleReleasePort['enable']>();

    await expect(
      releaseDeployedRule({
        jobs: { resume: () => current },
        rules: {
          get: async () => ({
            status: 'found',
            rule: storedRule(),
            versions: [storedVersion()],
            releaseReady: false,
          }),
          enable,
        },
        jobId: 1,
        enable: false,
        maxWaitMs: 0,
      }),
    ).resolves.toMatchObject({
      status: 'pending',
      reason: 'provenance_mismatch',
    });
    expect(enable).not.toHaveBeenCalled();
  });

  it('enable応答消失後のactive ruleを冪等に再確認してreleaseを完了する', async () => {
    const current = item('merged', {
      prNumber: 42,
      mergeSha: 'c'.repeat(40),
    });
    let now = 0;
    const get = vi
      .fn<RuleReleasePort['get']>()
      .mockResolvedValueOnce({
        status: 'found',
        rule: storedRule(),
        versions: [storedVersion()],
        releaseReady: true,
      })
      .mockResolvedValueOnce({
        status: 'found',
        rule: storedRule('active', null),
        versions: [storedVersion()],
        releaseReady: true,
      });
    const enable = vi
      .fn<RuleReleasePort['enable']>()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({
        status: 'unchanged',
        rule: storedRule('active', null),
      });

    await expect(
      releaseDeployedRule({
        jobs: { resume: () => current },
        rules: { get, enable },
        jobId: 1,
        maxWaitMs: 100,
        pollIntervalMs: 10,
        now: () => now,
        wait: async (delay) => {
          now += delay;
        },
      }),
    ).resolves.toMatchObject({ status: 'released' });
    expect(enable).toHaveBeenCalledTimes(2);
  });

  it('done jobは手動disable後も再有効化せずrelease済みとして扱う', async () => {
    const current = item('done', {
      prNumber: 42,
      mergeSha: 'c'.repeat(40),
    });
    const enable = vi.fn<RuleReleasePort['enable']>();

    await expect(
      releaseDeployedRule({
        jobs: { resume: () => current },
        rules: {
          get: async () => ({
            status: 'found',
            rule: storedRule('disabled', 'manual'),
            versions: [storedVersion()],
            releaseReady: true,
          }),
          enable,
        },
        jobId: 1,
        maxWaitMs: 0,
      }),
    ).resolves.toMatchObject({ status: 'already_released' });
    expect(enable).not.toHaveBeenCalled();
  });

  it('恒久APIエラーと不正なrule状態を再試行せず拒否する', async () => {
    const current = item('merged', {
      prNumber: 42,
      mergeSha: 'c'.repeat(40),
    });
    const { ImplementationApiError } = await import('./implementation-api.js');
    await expect(
      releaseDeployedRule({
        jobs: { resume: () => current },
        rules: {
          get: async () => {
            throw new ImplementationApiError('unauthorized', 401);
          },
          enable: vi.fn(),
        },
        jobId: 1,
        maxWaitMs: 0,
      }),
    ).rejects.toThrow('unauthorized');

    await expect(
      releaseDeployedRule({
        jobs: { resume: () => current },
        rules: {
          get: async () => ({
            status: 'found',
            rule: storedRule('disabled', 'manual'),
            versions: [storedVersion()],
            releaseReady: true,
          }),
          enable: vi.fn(),
        },
        jobId: 1,
        maxWaitMs: 0,
      }),
    ).rejects.toThrow('deployed rule is not pending enable');
  });

  it('旧DBのmerged jobだけをGitHub再検証後に同phaseでbackfillする', async () => {
    const legacy = item('merged', {
      prNumber: 42,
      headSha: 'c'.repeat(40),
      mergeSha: null,
    });
    const update = vi.fn(() => ({
      status: 'updated' as const,
      job: { ...legacy.job, mergeSha: 'c'.repeat(40) },
    }));
    const process = processPort(async () =>
      result(0, {
        stdout: JSON.stringify({
          state: 'MERGED',
          mergedAt: '2026-07-27T00:00:00Z',
          headRefOid: 'b'.repeat(40),
          mergeCommit: { oid: 'c'.repeat(40) },
        }),
      }),
    );

    await expect(
      recordMergedImplementation({
        jobs: { resume: () => legacy, update },
        process,
        cwd: '/repo',
        jobId: 1,
      }),
    ).resolves.toMatchObject({
      status: 'recorded',
      job: { phase: 'merged', mergeSha: 'c'.repeat(40) },
    });
    expect(update).toHaveBeenCalledWith(1, {
      from: 'merged',
      to: 'merged',
      headSha: 'b'.repeat(40),
      mergeSha: 'c'.repeat(40),
    });
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
