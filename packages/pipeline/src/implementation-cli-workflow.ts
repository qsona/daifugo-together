import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { QueuedImplementation } from '@daifugo/server';

import type { PipelineJobPort } from './implementation-driver.js';
import {
  ImplementationApiError,
  type RuleReleasePort,
} from './implementation-api.js';
import type { ProcessPort, ProcessResult } from './process.js';

const RELEASE_REMINDER_MS = 48 * 60 * 60 * 1_000;

export async function runTransient(
  process: ProcessPort,
  input: Parameters<ProcessPort['run']>[0],
  options: {
    allowExitCodes?: number[];
    attempts?: number;
    wait?: (delayMs: number) => Promise<void>;
  } = {},
): Promise<ProcessResult> {
  const allowExitCodes = options.allowExitCodes ?? [0];
  const attempts = options.attempts ?? 3;
  const wait =
    options.wait ??
    ((delayMs) =>
      new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      }));
  let last: ProcessResult | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await process.run(input);
    if (
      !last.timedOut &&
      last.exitCode !== null &&
      allowExitCodes.includes(last.exitCode)
    ) {
      return last;
    }
    if (attempt < attempts) await wait(100 * 2 ** (attempt - 1));
  }
  return last!;
}

function failed(result: ProcessResult): boolean {
  return result.timedOut || result.exitCode !== 0;
}

export function repositoryOwner(repositoryUrl: string): string | null {
  return (
    /github\.com[/:]([^/]+)\/[^/]+(?:\.git)?$/u.exec(repositoryUrl)?.[1] ?? null
  );
}

export async function verifyGitHubPublisher(options: {
  process: ProcessPort;
  repositoryUrl: string;
  additionalAllowedAuthors?: string;
  cwd: string;
}): Promise<string> {
  const owner = repositoryOwner(options.repositoryUrl);
  if (!owner)
    throw new Error('RULE_REPOSITORY_URL must be a GitHub repository');
  const result = await runTransient(options.process, {
    command: 'gh',
    args: ['api', 'user', '--jq', '.login'],
    cwd: options.cwd,
    timeoutMs: 60_000,
  });
  if (failed(result)) {
    throw new Error(result.stderr.trim() || 'could not inspect gh login');
  }
  const login = result.stdout.trim();
  const allowed = new Set(
    [owner, ...(options.additionalAllowedAuthors ?? '').split(',')]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  if (!allowed.has(login.toLowerCase())) {
    throw new Error(`gh login ${login} is not allowed to publish rule PRs`);
  }
  return login;
}

export async function recordMergedImplementation(options: {
  jobs: Pick<PipelineJobPort, 'resume' | 'update'>;
  process: ProcessPort;
  cwd: string;
  jobId: number;
  wait?: (delayMs: number) => Promise<void>;
}): Promise<{
  status: 'recorded' | 'already_recorded';
  job: QueuedImplementation['job'];
}> {
  const item = await options.jobs.resume(options.jobId);
  if (!item) throw new Error('merge job was not found');
  const job = item.job;
  if (
    (job.phase !== 'pr_open' &&
      job.phase !== 'merged' &&
      job.phase !== 'done') ||
    job.prNumber === null ||
    job.headSha === null
  ) {
    throw new Error('job is not awaiting or recording a PR merge');
  }
  const viewed = await runTransient(
    options.process,
    {
      command: 'gh',
      args: [
        'pr',
        'view',
        String(job.prNumber),
        '--json',
        'state,mergedAt,mergeCommit,headRefOid',
      ],
      cwd: options.cwd,
      timeoutMs: 60_000,
    },
    {
      ...(options.wait ? { wait: options.wait } : {}),
    },
  );
  if (failed(viewed)) {
    throw new Error(viewed.stderr.trim() || 'could not inspect merged PR');
  }
  const pr = JSON.parse(viewed.stdout) as {
    state?: string;
    mergedAt?: string | null;
    headRefOid?: string;
    mergeCommit?: { oid?: string } | null;
  };
  const mergeSha = pr.mergeCommit?.oid;
  if (
    pr.state !== 'MERGED' ||
    typeof pr.mergedAt !== 'string' ||
    !mergeSha ||
    !/^[0-9a-f]{40}$/u.test(mergeSha) ||
    !pr.headRefOid ||
    !/^[0-9a-f]{40}$/u.test(pr.headRefOid)
  ) {
    throw new Error('PR has not been merged with a verifiable merge commit');
  }
  const reviewedHeadMatches = pr.headRefOid === job.headSha;
  const legacyMergeStoredAsHead =
    (job.phase === 'merged' || job.phase === 'done') &&
    job.mergeSha === null &&
    job.headSha === mergeSha;
  if (!reviewedHeadMatches && !legacyMergeStoredAsHead) {
    throw new Error('merged PR head does not match the reviewed job head');
  }
  if (job.phase === 'merged' || job.phase === 'done') {
    if (job.mergeSha === null) {
      const updated = await options.jobs.update(job.id, {
        from: job.phase,
        to: job.phase,
        mergeSha,
        ...(legacyMergeStoredAsHead ? { headSha: pr.headRefOid } : {}),
      });
      if (updated.status !== 'updated') {
        throw new Error(`merge backfill failed: ${updated.status}`);
      }
      return { status: 'recorded', job: updated.job };
    }
    if (job.mergeSha !== mergeSha) {
      throw new Error('recorded merge commit does not match GitHub');
    }
    return { status: 'already_recorded', job };
  }
  const updated = await options.jobs.update(job.id, {
    from: 'pr_open',
    to: 'merged',
    mergeSha,
  });
  if (updated.status !== 'updated') {
    throw new Error(`merge transition failed: ${updated.status}`);
  }
  return { status: 'recorded', job: updated.job };
}

export type ReleaseDeployedRuleResult =
  | {
      status: 'ready' | 'released' | 'already_released';
      jobId: number;
      ruleId: string;
    }
  | {
      status: 'pending';
      jobId: number;
      ruleId: string;
      reason: 'not_deployed' | 'provenance_mismatch' | 'api_unavailable';
      reminder: boolean;
    };

export async function releaseDeployedRule(options: {
  jobs: Pick<PipelineJobPort, 'resume'>;
  rules: RuleReleasePort;
  jobId: number;
  maxWaitMs?: number;
  pollIntervalMs?: number;
  enable?: boolean;
  now?: () => number;
  wait?: (delayMs: number) => Promise<void>;
}): Promise<ReleaseDeployedRuleResult> {
  const item = await options.jobs.resume(options.jobId);
  if (!item) throw new Error('release job was not found');
  const job = item.job;
  if (
    (job.phase !== 'merged' && job.phase !== 'done') ||
    job.prNumber === null ||
    job.mergeSha === null
  ) {
    throw new Error('job is not ready for deployed rule release');
  }
  const now = options.now ?? Date.now;
  const wait =
    options.wait ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      }));
  const maxWaitMs = options.maxWaitMs ?? 15 * 60 * 1_000;
  const pollIntervalMs = options.pollIntervalMs ?? 10_000;
  const startedAt = now();
  let reason: Extract<
    ReleaseDeployedRuleResult,
    { status: 'pending' }
  >['reason'];
  while (true) {
    try {
      const lookup = await options.rules.get(job.ruleId);
      if (lookup.status === 'found') {
        const current = lookup.versions.find(
          (version) => version.isCurrent && version.revertedAt === null,
        );
        const provenanceMatches =
          current !== undefined &&
          current.prNumber === job.prNumber &&
          current.mergeSha === job.mergeSha &&
          typeof current.bundleHash === 'string' &&
          /^[0-9a-f]{64}$/u.test(current.bundleHash);
        if (provenanceMatches) {
          if (job.phase === 'done') {
            return {
              status: 'already_released',
              jobId: job.id,
              ruleId: job.ruleId,
            };
          }
          const pendingEnable =
            lookup.rule.status === 'disabled' &&
            lookup.rule.disabledReason === 'pending_enable';
          const idempotentEnable = lookup.rule.status === 'active';
          if (!pendingEnable && !idempotentEnable) {
            throw new Error(
              `deployed rule is not pending enable: ${lookup.rule.status}/${String(
                lookup.rule.disabledReason,
              )}`,
            );
          }
          if (options.enable === false) {
            return {
              status: 'ready',
              jobId: job.id,
              ruleId: job.ruleId,
            };
          }
          const enabled = await options.rules.enable(job.ruleId);
          if (
            (enabled.status === 'updated' || enabled.status === 'unchanged') &&
            enabled.rule.status === 'active'
          ) {
            return {
              status: 'released',
              jobId: job.id,
              ruleId: job.ruleId,
            };
          }
          if (enabled.status !== 'not_found') {
            throw new Error(
              `rule enable failed: ${enabled.status}${
                'error' in enabled ? `/${enabled.error}` : ''
              }`,
            );
          }
          reason = 'not_deployed';
        } else {
          reason = 'provenance_mismatch';
        }
      } else {
        reason = 'not_deployed';
      }
    } catch (error) {
      if (
        (error instanceof Error &&
          (error.message.startsWith('deployed rule is not pending enable') ||
            error.message.startsWith('rule enable failed'))) ||
        (error instanceof ImplementationApiError &&
          error.status !== undefined &&
          ![404, 429, 500, 502, 503, 504].includes(error.status))
      ) {
        throw error;
      }
      reason = 'api_unavailable';
    }
    if (now() - startedAt >= maxWaitMs) {
      return {
        status: 'pending',
        jobId: job.id,
        ruleId: job.ruleId,
        reason,
        reminder: now() - job.updatedAt >= RELEASE_REMINDER_MS,
      };
    }
    await wait(Math.min(pollIntervalMs, maxWaitMs - (now() - startedAt)));
  }
}

export async function prepareImplementationRetry(options: {
  jobs: Pick<PipelineJobPort, 'resume' | 'retry'>;
  process: ProcessPort;
  repositoryUrl: string;
  cwd: string;
  jobId: number;
  wait?: (delayMs: number) => Promise<void>;
}): Promise<QueuedImplementation> {
  const item = await options.jobs.resume(options.jobId);
  if (!item) throw new Error('retry job was not found');
  const previous = item.job;
  if (
    previous.phase === 'implementing' &&
    previous.attempt === 2 &&
    previous.branch === null &&
    previous.scaffoldSha === null
  ) {
    return item;
  }
  if (
    (previous.phase !== 'implementing' && previous.phase !== 'pr_open') ||
    previous.attempt !== 1 ||
    !previous.branch
  ) {
    throw new Error('job is not eligible for one implementation retry');
  }
  const transient = (
    input: Parameters<ProcessPort['run']>[0],
    allowExitCodes = [0],
  ) =>
    runTransient(options.process, input, {
      allowExitCodes,
      ...(options.wait ? { wait: options.wait } : {}),
    });
  if (previous.prNumber !== null) {
    const viewed = await transient({
      command: 'gh',
      args: ['pr', 'view', String(previous.prNumber), '--json', 'state'],
      cwd: options.cwd,
      timeoutMs: 60_000,
    });
    if (failed(viewed)) {
      throw new Error(viewed.stderr.trim() || 'could not inspect prior PR');
    }
    const state = JSON.parse(viewed.stdout) as { state?: string };
    if (state.state === 'OPEN') {
      const closed = await transient({
        command: 'gh',
        args: [
          'pr',
          'close',
          String(previous.prNumber),
          '--comment',
          'Closing failed implementation attempt before developer-authorized retry.',
        ],
        cwd: options.cwd,
        timeoutMs: 60_000,
      });
      if (failed(closed)) {
        throw new Error(closed.stderr.trim() || 'could not close prior PR');
      }
    }
  }
  const remoteBranch = await transient(
    {
      command: 'git',
      args: [
        'ls-remote',
        '--exit-code',
        '--heads',
        options.repositoryUrl,
        `refs/heads/${previous.branch}`,
      ],
      cwd: options.cwd,
      timeoutMs: 60_000,
    },
    [0, 2],
  );
  if (remoteBranch.exitCode === 0) {
    const deleted = await transient({
      command: 'git',
      args: ['push', options.repositoryUrl, '--delete', previous.branch],
      cwd: options.cwd,
      timeoutMs: 60_000,
    });
    if (failed(deleted)) {
      throw new Error(deleted.stderr.trim() || 'could not delete prior branch');
    }
  } else if (remoteBranch.exitCode !== 2 || remoteBranch.timedOut) {
    throw new Error(
      remoteBranch.stderr.trim() || 'could not inspect prior branch',
    );
  }
  const retried = await options.jobs.retry(previous.id, {
    from: previous.phase,
    expectedAttempt: previous.attempt,
  });
  if (retried.status !== 'retried') {
    throw new Error(`retry transition failed: ${retried.status}`);
  }
  return { ...item, job: retried.job };
}

export async function prepareImplementationWorkspace(options: {
  process: ProcessPort;
  repositoryUrl: string;
  workRoot: string;
  wait?: (delayMs: number) => Promise<void>;
}): Promise<string> {
  await mkdir(options.workRoot, { recursive: true });
  const workspace = await mkdtemp(join(options.workRoot, 'daifugo-rule-'));
  try {
    const transient = (input: Parameters<ProcessPort['run']>[0]) =>
      runTransient(options.process, input, {
        ...(options.wait ? { wait: options.wait } : {}),
      });
    const clone = await transient({
      command: 'git',
      args: [
        'clone',
        '--depth=1',
        '--branch',
        'main',
        options.repositoryUrl,
        workspace,
      ],
      cwd: options.workRoot,
      timeoutMs: 3 * 60_000,
    });
    if (failed(clone)) {
      throw new Error(clone.stderr.trim() || 'git clone failed');
    }
    const install = await transient({
      command: 'pnpm',
      args: ['install', '--frozen-lockfile'],
      cwd: workspace,
      timeoutMs: 10 * 60_000,
    });
    if (failed(install)) {
      throw new Error(install.stderr.trim() || 'pnpm install failed');
    }
    return workspace;
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
}

export async function removeCompletedWorkspace(
  workspace: string,
): Promise<void> {
  await rm(workspace, { recursive: true, force: true });
}
