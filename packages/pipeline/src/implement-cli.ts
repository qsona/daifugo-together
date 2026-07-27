import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { SubscriptionCodexRunner } from './codex-runner.js';
import { GitImplementationPublisher } from './git-publisher.js';
import { HttpPipelineJobPort } from './implementation-api.js';
import { runNextImplementation } from './implementation-driver.js';
import { SpawnProcessPort } from './process.js';

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
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
  const resumeId =
    process.argv[2] === 'resume' ? Number(process.argv[3]) : undefined;
  if (
    resumeId !== undefined &&
    (!Number.isSafeInteger(resumeId) || resumeId <= 0)
  ) {
    throw new Error('usage: implement-cli resume JOB_ID');
  }
  const item =
    resumeId === undefined ? await jobs.next() : await jobs.resume(resumeId);
  if (!item) {
    process.stdout.write(`${JSON.stringify({ status: 'idle' })}\n`);
    return;
  }

  const workRoot = resolve(process.env.IMPLEMENT_WORK_ROOT?.trim() || tmpdir());
  await mkdir(workRoot, { recursive: true });
  const workspace = await mkdtemp(join(workRoot, 'daifugo-rule-'));
  const commands = new SpawnProcessPort();
  const clone = await commands.run({
    command: 'git',
    args: ['clone', '--depth=1', '--branch', 'main', repositoryUrl, workspace],
    cwd: workRoot,
    timeoutMs: 3 * 60_000,
  });
  if (clone.timedOut || clone.exitCode !== 0) {
    throw new Error(clone.stderr.trim() || 'git clone failed');
  }
  const install = await commands.run({
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
  process.stdout.write(`${JSON.stringify({ workspace, result })}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
}
