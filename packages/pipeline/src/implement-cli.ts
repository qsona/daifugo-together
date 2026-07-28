import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import type { QueuedImplementation } from '@daifugo/server';

import { GitImplementationPublisher } from './git-publisher.js';
import {
  HttpPipelineJobPort,
  HttpRuleReleasePort,
} from './implementation-api.js';
import {
  prepareImplementation,
  submitPreparedImplementation,
} from './implementation-driver.js';
import { LocalImplementationVerifier } from './implementation-verifier.js';
import {
  prepareImplementationRetry,
  prepareImplementationWorkspace,
  recordMergedImplementation,
  releaseDeployedRule,
  removeCompletedWorkspace,
  validatePreparedWorkspace,
  verifyGitHubPublisher,
} from './implementation-cli-workflow.js';
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

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

function positiveJobId(value: string | undefined, usage: string): number {
  const jobId = Number(value);
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    throw new Error(`usage: ${usage}`);
  }
  return jobId;
}

function implementationWorkRoot(): string {
  return resolve(process.env.IMPLEMENT_WORK_ROOT?.trim() || tmpdir());
}

function submittedWorkspace(value: string | null): string {
  if (!value) {
    throw new Error(
      'usage: implement-cli submit JOB_ID --workspace PREPARED_WORKSPACE',
    );
  }
  return validatePreparedWorkspace(value, implementationWorkRoot());
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
  const command = process.argv[2] ?? 'prepare';

  if (command === 'fail') {
    const jobId = positiveJobId(
      process.argv[3],
      'implement-cli fail JOB_ID FROM ERROR_CODE [ERROR_NOTE]',
    );
    const from = process.argv[4];
    const errorCode = process.argv[5];
    const errorNote = process.argv[6];
    if (!from || !errorCode) {
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
  if (command === 'release-status' || command === 'release') {
    const jobId = positiveJobId(
      process.argv[3],
      `implement-cli ${command} JOB_ID`,
    );
    const maxWaitMs = optionalDuration('IMPLEMENT_RELEASE_WAIT_MS');
    const pollIntervalMs = optionalDuration('IMPLEMENT_RELEASE_POLL_MS');
    if (pollIntervalMs === 0) {
      throw new Error('IMPLEMENT_RELEASE_POLL_MS must be greater than zero');
    }
    const result = await releaseDeployedRule({
      jobs,
      rules: new HttpRuleReleasePort({ baseUrl, token }),
      jobId,
      enable: command === 'release',
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

  if (command === 'merged') {
    const jobId = positiveJobId(process.argv[3], 'implement-cli merged JOB_ID');
    const result = await recordMergedImplementation({
      jobs,
      process: commands,
      cwd: process.cwd(),
      jobId,
    });
    process.stdout.write(`${JSON.stringify({ result })}\n`);
    return;
  }

  if (command === 'submit') {
    const jobId = positiveJobId(
      process.argv[3],
      'implement-cli submit JOB_ID --workspace PREPARED_WORKSPACE',
    );
    const workspace = submittedWorkspace(option('--workspace'));
    const item = await jobs.resume(jobId);
    if (!item) throw new Error('submission job was not found');
    const result = await submitPreparedImplementation({
      item,
      jobs,
      publisher: new GitImplementationPublisher({ repoRoot: workspace }),
      verifier: new LocalImplementationVerifier(commands),
      workspace,
      rulesRoot: join(workspace, 'packages/rules'),
    });
    const workspaceRemoved =
      result.status === 'ready' && result.job.phase === 'pr_open';
    if (workspaceRemoved) await removeCompletedWorkspace(workspace);
    process.stdout.write(
      `${JSON.stringify({ workspace, workspaceRemoved, result })}\n`,
    );
    return;
  }

  const retryMode = command === 'prepare-retry' || command === 'retry';
  const resumeMode = command === 'prepare-resume' || command === 'resume';
  if (command !== 'prepare' && !retryMode && !resumeMode) {
    throw new Error(`unknown implement command: ${command}`);
  }
  let item: QueuedImplementation | null;
  if (retryMode) {
    const jobId = positiveJobId(
      process.argv[3],
      'implement-cli prepare-retry JOB_ID',
    );
    item = await prepareImplementationRetry({
      jobs,
      process: commands,
      repositoryUrl,
      cwd: process.cwd(),
      jobId,
    });
  } else if (resumeMode) {
    const jobId = positiveJobId(
      process.argv[3],
      'implement-cli prepare-resume JOB_ID',
    );
    item = await jobs.resume(jobId);
  } else {
    item = await jobs.next();
  }
  if (!item) {
    process.stdout.write(`${JSON.stringify({ status: 'idle' })}\n`);
    return;
  }

  const workspace = await prepareImplementationWorkspace({
    process: commands,
    repositoryUrl,
    workRoot: implementationWorkRoot(),
  });
  const result = await prepareImplementation({
    item,
    jobs,
    publisher: new GitImplementationPublisher({ repoRoot: workspace }),
    rulesRoot: join(workspace, 'packages/rules'),
  });
  process.stdout.write(
    `${JSON.stringify({ workspace, workspaceRemoved: false, result })}\n`,
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
