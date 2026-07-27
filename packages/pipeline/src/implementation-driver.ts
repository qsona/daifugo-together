import type { PipelineJob, QueuedImplementation } from '@daifugo/server';

import {
  type CodexRunner,
  IMPLEMENTATION_PROMPT_VERSION,
  implementScaffold,
  type ImplementationResult,
} from './implement.js';
import { createRuleScaffold, type ScaffoldResult } from './scaffold.js';

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

export type RunNextImplementationResult =
  | { status: 'idle' }
  | {
      status: 'claim_failed';
      jobId: number;
      proposalId: string;
      result: Exclude<JobUpdateResult, { status: 'updated' }>;
    }
  | {
      status: ImplementationResult['status'];
      job: PipelineJob;
      proposalId: string;
      result: ImplementationResult;
    };

export async function runNextImplementation(options: {
  jobs: PipelineJobPort;
  publisher: ScaffoldPublisher;
  runner: CodexRunner;
  rulesRoot: string;
  promptPath: string;
  item?: QueuedImplementation;
}): Promise<RunNextImplementationResult> {
  const item = options.item ?? (await options.jobs.next());
  if (!item) return { status: 'idle' };

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
            item.job.promptVersion === IMPLEMENTATION_PROMPT_VERSION
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
  let finalJob = claimed.job;
  const recovered = await options.publisher.recoverImplementation({
    item,
    scaffold,
    ...published,
  });
  if (recovered) {
    const opened = await options.jobs.update(item.job.id, {
      from: 'implementing',
      to: 'pr_open',
      prNumber: recovered.prNumber,
      headSha: recovered.headSha,
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
      result: { status: 'ready', scaffold },
    };
  }

  let result = await implementScaffold({
    scaffold,
    promptPath: options.promptPath,
    runner: options.runner,
  });
  if (result.status === 'ready') {
    const violations = await options.publisher.inspect({
      item,
      scaffold,
      ...published,
    });
    if (violations.length > 0) {
      result = { status: 'inspect_failed', violations, scaffold };
    }
  }
  if (result.status === 'ready') {
    const pullRequest = await options.publisher.publishImplementation({
      item,
      scaffold,
      ...published,
    });
    const opened = await options.jobs.update(item.job.id, {
      from: 'implementing',
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
    finalJob = opened.job;
  }
  return {
    status: result.status,
    job: finalJob,
    proposalId: item.proposal.id,
    result,
  };
}
