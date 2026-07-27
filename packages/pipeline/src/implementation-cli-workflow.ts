import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { QueuedImplementation } from '@daifugo/server';

import type { PipelineJobPort } from './implementation-driver.js';
import type { ProcessPort, ProcessResult } from './process.js';

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
