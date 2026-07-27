import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { QueuedImplementation } from '@daifugo/server';

import { SubscriptionCodexRunner } from './codex-runner.js';
import { GitImplementationPublisher } from './git-publisher.js';
import {
  HttpPipelineJobPort,
  HttpRuleReleasePort,
} from './implementation-api.js';
import {
  prepareImplementationRetry,
  prepareImplementationWorkspace,
  recordMergedImplementation,
  releaseDeployedRule,
  removeCompletedWorkspace,
  verifyGitHubPublisher,
} from './implementation-cli-workflow.js';
import { runNextImplementation } from './implementation-driver.js';
import { SpawnProcessPort } from './process.js';

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalDuration(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

async function main(): Promise<void> {
  const baseUrl = requiredEnvironment('ADMIN_PIPELINE_URL');
  const token = requiredEnvironment('ADMIN_PIPELINE_TOKEN');
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
  if (process.argv[2] === 'release-status' || process.argv[2] === 'release') {
    const mode = process.argv[2];
    const jobId = Number(process.argv[3]);
    if (!Number.isSafeInteger(jobId) || jobId <= 0) {
      throw new Error(`usage: implement-cli ${mode} JOB_ID`);
    }
    const maxWaitMs = optionalDuration('IMPLEMENT_RELEASE_WAIT_MS');
    const pollIntervalMs = optionalDuration('IMPLEMENT_RELEASE_POLL_MS');
    if (pollIntervalMs === 0) {
      throw new Error('IMPLEMENT_RELEASE_POLL_MS must be greater than zero');
    }
    const result = await releaseDeployedRule({
      jobs,
      rules: new HttpRuleReleasePort({ baseUrl, token }),
      jobId,
      enable: mode === 'release',
      ...(maxWaitMs === undefined ? {} : { maxWaitMs }),
      ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }),
    });
    process.stdout.write(`${JSON.stringify({ result })}\n`);
    return;
  }
  const repositoryUrl = requiredEnvironment('RULE_REPOSITORY_URL');
  await verifyGitHubPublisher({
    process: commands,
    repositoryUrl,
    ...(process.env.RULE_PR_ALLOWED_AUTHORS
      ? { additionalAllowedAuthors: process.env.RULE_PR_ALLOWED_AUTHORS }
      : {}),
    cwd: process.cwd(),
  });
  if (process.argv[2] === 'merged') {
    const jobId = Number(process.argv[3]);
    if (!Number.isSafeInteger(jobId) || jobId <= 0) {
      throw new Error('usage: implement-cli merged JOB_ID');
    }
    const result = await recordMergedImplementation({
      jobs,
      process: commands,
      cwd: process.cwd(),
      jobId,
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
    retryItem = await prepareImplementationRetry({
      jobs,
      process: commands,
      repositoryUrl,
      cwd: process.cwd(),
      jobId: retryId,
    });
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
  if (
    item.job.phase === 'pr_open' ||
    item.job.phase === 'merged' ||
    item.job.phase === 'done'
  ) {
    process.stdout.write(
      `${JSON.stringify({
        workspace: null,
        workspaceRemoved: false,
        result: {
          status: 'already_ready',
          job: item.job,
          proposalId: item.proposal.id,
        },
      })}\n`,
    );
    return;
  }

  const workRoot = resolve(process.env.IMPLEMENT_WORK_ROOT?.trim() || tmpdir());
  const workspace = await prepareImplementationWorkspace({
    process: commands,
    repositoryUrl,
    workRoot,
  });
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
    await removeCompletedWorkspace(workspace);
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
