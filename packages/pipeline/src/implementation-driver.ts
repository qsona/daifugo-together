import type { PipelineJob, QueuedImplementation } from '@daifugo/server';

import {
  type CodexRunner,
  implementScaffold,
  type ImplementationResult,
} from './implement.js';
import { createRuleScaffold, type ScaffoldResult } from './scaffold.js';

type JobUpdateResult =
  | { status: 'updated'; job: PipelineJob }
  | { status: 'not_found' }
  | { status: 'invalid'; error: string }
  | { status: 'conflict'; error: string };

export interface PipelineJobPort {
  next(): QueuedImplementation | null;
  update(jobId: number, input: unknown): JobUpdateResult;
}

export interface ScaffoldPublisher {
  publish(input: {
    item: QueuedImplementation;
    scaffold: ScaffoldResult;
  }): Promise<{ branch: string; scaffoldSha: string }>;
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
}): Promise<RunNextImplementationResult> {
  const item = options.jobs.next();
  if (!item) return { status: 'idle' };

  const scaffold = await createRuleScaffold(item, options.rulesRoot);
  const published = await options.publisher.publish({ item, scaffold });
  const claimed = options.jobs.update(item.job.id, {
    from: 'queued',
    to: 'implementing',
    branch: published.branch,
    scaffoldSha: published.scaffoldSha,
  });
  if (claimed.status !== 'updated') {
    return {
      status: 'claim_failed',
      jobId: item.job.id,
      proposalId: item.proposal.id,
      result: claimed,
    };
  }

  const result = await implementScaffold({
    scaffold,
    promptPath: options.promptPath,
    runner: options.runner,
  });
  return {
    status: result.status,
    job: claimed.job,
    proposalId: item.proposal.id,
    result,
  };
}
