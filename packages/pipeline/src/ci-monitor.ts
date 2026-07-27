import type { PipelineJobPort } from './implementation-driver.js';
import type { ProcessPort } from './process.js';

export interface CiCheck {
  name: string;
  bucket: string;
  state: string;
  link: string;
}

export interface CiInspection {
  status: 'green' | 'failed' | 'pending';
  checks: CiCheck[];
  failedLogExcerpt: string[];
}

export const REQUIRED_RULE_CHECKS = [
  'diff-guard',
  'quality',
  'rule-tests',
  'simulation',
] as const;

function runId(link: string): string | null {
  return /\/actions\/runs\/(\d+)(?:\/|$)/u.exec(link)?.[1] ?? null;
}

export async function inspectImplementationCi(options: {
  jobs: Pick<PipelineJobPort, 'resume'>;
  process: ProcessPort;
  jobId: number;
  cwd: string;
}): Promise<CiInspection> {
  const item = await options.jobs.resume(options.jobId);
  if (!item) throw new Error('pipeline job was not found');
  if (item.job.phase !== 'pr_open' || item.job.prNumber === null) {
    throw new Error('pipeline job does not have an open PR');
  }
  const result = await options.process.run({
    command: 'gh',
    args: [
      'pr',
      'checks',
      String(item.job.prNumber),
      '--json',
      'name,bucket,state,link',
    ],
    cwd: options.cwd,
    timeoutMs: 60_000,
  });
  if (result.timedOut || result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || 'could not inspect PR checks');
  }
  const checks = JSON.parse(result.stdout || '[]') as CiCheck[];
  const required = checks.filter((check) =>
    REQUIRED_RULE_CHECKS.includes(
      check.name as (typeof REQUIRED_RULE_CHECKS)[number],
    ),
  );
  const counts = new Map<string, number>();
  for (const check of required) {
    counts.set(check.name, (counts.get(check.name) ?? 0) + 1);
  }
  const complete =
    REQUIRED_RULE_CHECKS.every((name) => counts.get(name) === 1) &&
    required.length === REQUIRED_RULE_CHECKS.length;
  const failed = required.filter((check) =>
    ['fail', 'cancel'].includes(check.bucket),
  );
  const pending =
    !complete ||
    required.some((check) => ['pending', 'skipping'].includes(check.bucket));
  const failedLogExcerpt: string[] = [];
  for (const id of new Set(failed.map((check) => runId(check.link)))) {
    if (!id) continue;
    const logs = await options.process.run({
      command: 'gh',
      args: ['run', 'view', id, '--log-failed'],
      cwd: options.cwd,
      timeoutMs: 60_000,
    });
    if (!logs.timedOut && logs.exitCode === 0) {
      failedLogExcerpt.push(...logs.stdout.split('\n').slice(0, 100));
    }
  }
  return {
    status: failed.length > 0 ? 'failed' : pending ? 'pending' : 'green',
    checks: required,
    failedLogExcerpt: failedLogExcerpt.slice(0, 100),
  };
}
