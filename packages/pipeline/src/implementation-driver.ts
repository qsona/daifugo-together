import type { PipelineJob, QueuedImplementation } from '@daifugo/server';

import { inspectGeneratedRule } from './inspector.js';
import {
  createRuleScaffold,
  expectedRuleScaffold,
  type ScaffoldResult,
} from './scaffold.js';

export const IMPLEMENTATION_PROMPT_VERSION = 'cx02-v5';
const SUPPORTED_PROMPT_VERSIONS = new Set([
  'cx02-v3',
  'cx02-v4',
  IMPLEMENTATION_PROMPT_VERSION,
]);

type JobUpdateResult =
  | { status: 'updated'; job: PipelineJob }
  | { status: 'not_found' }
  | { status: 'invalid'; error: string }
  | { status: 'conflict'; error: string };
type JobFailResult =
  | { status: 'failed'; job: PipelineJob }
  | { status: 'already_failed'; job: PipelineJob }
  | { status: 'not_found' }
  | { status: 'invalid'; error: string }
  | { status: 'conflict'; error: string };
type JobRetryResult =
  | { status: 'retried'; job: PipelineJob }
  | { status: 'not_found' }
  | { status: 'invalid'; error: string }
  | { status: 'conflict'; error: string };

type Awaitable<T> = T | Promise<T>;

export interface PipelineJobPort {
  next(): Awaitable<QueuedImplementation | null>;
  resume(jobId: number): Awaitable<QueuedImplementation | null>;
  update(jobId: number, input: unknown): Awaitable<JobUpdateResult>;
  retry(jobId: number, input: unknown): Awaitable<JobRetryResult>;
  fail(jobId: number, input: unknown): Awaitable<JobFailResult>;
}

export interface ScaffoldPublisher {
  publish(input: {
    item: QueuedImplementation;
    scaffold: ScaffoldResult;
  }): Promise<{ branch: string; scaffoldSha: string }>;
  inspect(input: {
    item: QueuedImplementation;
    scaffold: ScaffoldResult;
    branch: string;
    scaffoldSha: string;
  }): Promise<string[]>;
  recoverImplementation(input: {
    item: QueuedImplementation;
    scaffold: ScaffoldResult;
    branch: string;
    scaffoldSha: string;
  }): Promise<{ prNumber: number; headSha: string } | null>;
  publishImplementation(input: {
    item: QueuedImplementation;
    scaffold: ScaffoldResult;
    branch: string;
    scaffoldSha: string;
  }): Promise<{ prNumber: number; headSha: string }>;
}

export interface ImplementationVerifier {
  verify(input: {
    workspace: string;
    scaffold: ScaffoldResult;
  }): Promise<string[]>;
}

type ClaimFailure = {
  status: 'claim_failed';
  jobId: number;
  proposalId: string;
  result: Exclude<JobUpdateResult, { status: 'updated' }>;
};

export type PrepareImplementationResult =
  | { status: 'idle' }
  | ClaimFailure
  | {
      status: 'prepared';
      job: PipelineJob;
      proposalId: string;
      scaffold: ScaffoldResult;
    };

export type SubmitImplementationResult =
  | ClaimFailure
  | {
      status: 'inspect_failed';
      job: PipelineJob;
      proposalId: string;
      violations: string[];
      scaffold: ScaffoldResult;
    }
  | {
      status: 'ready';
      job: PipelineJob;
      proposalId: string;
      scaffold: ScaffoldResult;
    };

async function recordOpened(
  jobs: PipelineJobPort,
  item: QueuedImplementation,
  pullRequest: { prNumber: number; headSha: string },
): Promise<
  | ClaimFailure
  | {
      status: 'ready';
      job: PipelineJob;
      proposalId: string;
    }
> {
  const opened = await jobs.update(item.job.id, {
    from: item.job.phase,
    to: 'pr_open',
    prNumber: pullRequest.prNumber,
    headSha: pullRequest.headSha,
  });
  if (opened.status !== 'updated') {
    return {
      status: 'claim_failed',
      jobId: item.job.id,
      proposalId: item.proposal.id,
      result: opened,
    };
  }
  return {
    status: 'ready',
    job: opened.job,
    proposalId: item.proposal.id,
  };
}

export async function prepareImplementation(options: {
  item: QueuedImplementation;
  jobs: PipelineJobPort;
  publisher: ScaffoldPublisher;
  rulesRoot: string;
}): Promise<PrepareImplementationResult> {
  const { item } = options;
  const scaffold = await createRuleScaffold(item, options.rulesRoot);
  const published = await options.publisher.publish({ item, scaffold });
  const claimed =
    item.job.phase === 'queued'
      ? await options.jobs.update(item.job.id, {
          from: 'queued',
          to: 'implementing',
          branch: published.branch,
          scaffoldSha: published.scaffoldSha,
          promptVersion: IMPLEMENTATION_PROMPT_VERSION,
        })
      : item.job.phase === 'implementing' &&
          item.job.attempt > 1 &&
          item.job.branch === null &&
          item.job.scaffoldSha === null
        ? await options.jobs.update(item.job.id, {
            from: 'implementing',
            to: 'implementing',
            branch: published.branch,
            scaffoldSha: published.scaffoldSha,
            promptVersion: IMPLEMENTATION_PROMPT_VERSION,
          })
        : item.job.phase === 'implementing' &&
            item.job.branch === published.branch &&
            item.job.scaffoldSha === published.scaffoldSha &&
            item.job.promptVersion !== null &&
            SUPPORTED_PROMPT_VERSIONS.has(item.job.promptVersion)
          ? ({ status: 'updated', job: item.job } as const)
          : item.job.phase === 'pr_open' &&
              item.job.branch === published.branch &&
              item.job.scaffoldSha === published.scaffoldSha &&
              item.job.promptVersion !== null &&
              SUPPORTED_PROMPT_VERSIONS.has(item.job.promptVersion)
            ? ({ status: 'updated', job: item.job } as const)
            : ({ status: 'conflict', error: 'resume_state_mismatch' } as const);
  if (claimed.status !== 'updated') {
    return {
      status: 'claim_failed',
      jobId: item.job.id,
      proposalId: item.proposal.id,
      result: claimed,
    };
  }
  return {
    status: 'prepared',
    job: claimed.job,
    proposalId: item.proposal.id,
    scaffold,
  };
}

export async function submitPreparedImplementation(options: {
  item: QueuedImplementation;
  jobs: PipelineJobPort;
  publisher: ScaffoldPublisher;
  verifier: ImplementationVerifier;
  workspace: string;
  rulesRoot: string;
}): Promise<SubmitImplementationResult> {
  const { item } = options;
  if (
    (item.job.phase !== 'implementing' && item.job.phase !== 'pr_open') ||
    item.job.branch === null ||
    item.job.scaffoldSha === null ||
    item.job.promptVersion === null ||
    !SUPPORTED_PROMPT_VERSIONS.has(item.job.promptVersion)
  ) {
    throw new Error('job is not prepared for implementation submission');
  }
  const scaffold = expectedRuleScaffold(item, options.rulesRoot);
  const published = {
    branch: item.job.branch,
    scaffoldSha: item.job.scaffoldSha,
  };
  const local = await inspectGeneratedRule(scaffold);
  const violations = [
    ...(local.ok ? [] : local.violations),
    ...(await options.publisher.inspect({ item, scaffold, ...published })),
  ];
  if (violations.length === 0) {
    violations.push(
      ...(await options.verifier.verify({
        workspace: options.workspace,
        scaffold,
      })),
    );
  }
  if (violations.length > 0) {
    return {
      status: 'inspect_failed',
      job: item.job,
      proposalId: item.proposal.id,
      violations,
      scaffold,
    };
  }
  const recovered = await options.publisher.recoverImplementation({
    item,
    scaffold,
    ...published,
  });
  const pullRequest =
    recovered ??
    (await options.publisher.publishImplementation({
      item,
      scaffold,
      ...published,
    }));
  const opened = await recordOpened(options.jobs, item, pullRequest);
  return opened.status === 'ready' ? { ...opened, scaffold } : opened;
}
