import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { QueuedImplementation } from '@daifugo/server';

import { SubscriptionCodexRunner } from './codex-runner.js';
import { GitImplementationPublisher } from './git-publisher.js';
import { HttpPipelineJobPort } from './implementation-api.js';
import { runNextImplementation } from './implementation-driver.js';
import { SpawnProcessPort } from './process.js';
import type { ProcessResult } from './process.js';

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function runTransient(
  commands: SpawnProcessPort,
  input: Parameters<SpawnProcessPort['run']>[0],
): Promise<ProcessResult> {
  let last: ProcessResult | undefined;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    last = await commands.run(input);
    if (!last.timedOut && last.exitCode === 0) return last;
    if (attempt < 3) {
      await new Promise((resolve) =>
        setTimeout(resolve, 100 * 2 ** (attempt - 1)),
      );
    }
  }
  return last!;
}

async function main(): Promise<void> {
  const baseUrl = requiredEnvironment('ADMIN_PIPELINE_URL');
  const token = requiredEnvironment('ADMIN_PIPELINE_TOKEN');
  const repositoryUrl = requiredEnvironment('RULE_REPOSITORY_URL');
  const jobs = new HttpPipelineJobPort({
    baseUrl,
    token,
    onWarning: (warning) => process.stderr.write(`WARNING: ${warning}\n`),
  });
  const commands = new SpawnProcessPort();
  if (process.argv[2] === 'fail') {
    const jobId = Number(process.argv[3]);
    const from = process.argv[4];
    const errorCode = process.argv[5];
    const errorNote = process.argv[6];
    if (!Number.isSafeInteger(jobId) || jobId <= 0 || !from || !errorCode) {
      throw new Error(
        'usage: implement-cli fail JOB_ID FROM ERROR_CODE [ERROR_NOTE]',
      );
    }
    const result = await jobs.fail(jobId, {
      from,
      errorCode,
      ...(errorNote ? { errorNote } : {}),
    });
    process.stdout.write(`${JSON.stringify({ result })}\n`);
    return;
  }
  const retryId =
    process.argv[2] === 'retry' ? Number(process.argv[3]) : undefined;
  let retryItem: QueuedImplementation | null = null;
  if (retryId !== undefined) {
    if (!Number.isSafeInteger(retryId) || retryId <= 0) {
      throw new Error('usage: implement-cli retry JOB_ID');
    }
    retryItem = await jobs.resume(retryId);
    if (!retryItem) throw new Error('retry job was not found');
    const previous = retryItem.job;
    if (
      (previous.phase !== 'implementing' && previous.phase !== 'pr_open') ||
      previous.attempt !== 1 ||
      !previous.branch
    ) {
      throw new Error('job is not eligible for one implementation retry');
    }
    if (previous.prNumber !== null) {
      const viewed = await runTransient(commands, {
        command: 'gh',
        args: ['pr', 'view', String(previous.prNumber), '--json', 'state'],
        cwd: process.cwd(),
        timeoutMs: 60_000,
      });
      if (viewed.exitCode !== 0 || viewed.timedOut) {
        throw new Error(viewed.stderr.trim() || 'could not inspect prior PR');
      }
      const state = JSON.parse(viewed.stdout) as { state?: string };
      if (state.state === 'OPEN') {
        const closed = await runTransient(commands, {
          command: 'gh',
          args: [
            'pr',
            'close',
            String(previous.prNumber),
            '--comment',
            'Closing failed implementation attempt before developer-authorized retry.',
          ],
          cwd: process.cwd(),
          timeoutMs: 60_000,
        });
        if (closed.exitCode !== 0 || closed.timedOut) {
          throw new Error(closed.stderr.trim() || 'could not close prior PR');
        }
      }
    }
    const remoteBranch = await runTransient(commands, {
      command: 'git',
      args: [
        'ls-remote',
        '--exit-code',
        '--heads',
        repositoryUrl,
        `refs/heads/${previous.branch}`,
      ],
      cwd: process.cwd(),
      timeoutMs: 60_000,
    });
    if (remoteBranch.exitCode === 0) {
      const deleted = await runTransient(commands, {
        command: 'git',
        args: ['push', repositoryUrl, '--delete', previous.branch],
        cwd: process.cwd(),
        timeoutMs: 60_000,
      });
      if (deleted.exitCode !== 0 || deleted.timedOut) {
        throw new Error(
          deleted.stderr.trim() || 'could not delete prior branch',
        );
      }
    } else if (remoteBranch.exitCode !== 2 || remoteBranch.timedOut) {
      throw new Error(
        remoteBranch.stderr.trim() || 'could not inspect prior branch',
      );
    }
    const retried = await jobs.retry(previous.id, {
      from: previous.phase,
      expectedAttempt: previous.attempt,
    });
    if (retried.status !== 'retried') {
      throw new Error(`retry transition failed: ${retried.status}`);
    }
    retryItem = { ...retryItem, job: retried.job };
  }
  const resumeId =
    process.argv[2] === 'resume' ? Number(process.argv[3]) : undefined;
  if (
    resumeId !== undefined &&
    (!Number.isSafeInteger(resumeId) || resumeId <= 0)
  ) {
    throw new Error('usage: implement-cli resume JOB_ID');
  }
  const item =
    retryItem ??
    (resumeId === undefined ? await jobs.next() : await jobs.resume(resumeId));
  if (!item) {
    process.stdout.write(`${JSON.stringify({ status: 'idle' })}\n`);
    return;
  }

  const workRoot = resolve(process.env.IMPLEMENT_WORK_ROOT?.trim() || tmpdir());
  await mkdir(workRoot, { recursive: true });
  const workspace = await mkdtemp(join(workRoot, 'daifugo-rule-'));
  const clone = await runTransient(commands, {
    command: 'git',
    args: ['clone', '--depth=1', '--branch', 'main', repositoryUrl, workspace],
    cwd: workRoot,
    timeoutMs: 3 * 60_000,
  });
  if (clone.timedOut || clone.exitCode !== 0) {
    throw new Error(clone.stderr.trim() || 'git clone failed');
  }
  const install = await runTransient(commands, {
    command: 'pnpm',
    args: ['install', '--frozen-lockfile'],
    cwd: workspace,
    timeoutMs: 10 * 60_000,
  });
  if (install.timedOut || install.exitCode !== 0) {
    throw new Error(install.stderr.trim() || 'pnpm install failed');
  }
  const result = await runNextImplementation({
    item,
    jobs,
    publisher: new GitImplementationPublisher({ repoRoot: workspace }),
    runner: new SubscriptionCodexRunner(),
    rulesRoot: join(workspace, 'packages/rules'),
    promptPath: join(workspace, 'packages/pipeline/prompts/implement.md'),
  });
  const workspaceRemoved =
    result.status === 'ready' && result.job.phase === 'pr_open';
  if (workspaceRemoved) {
    await rm(workspace, { recursive: true, force: true });
  }
  process.stdout.write(
    `${JSON.stringify({ workspace, workspaceRemoved, result })}\n`,
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
}
