import type { PipelineJob, PipelineRepository } from './repository.js';
import type { ProposalRepository } from '../proposal/repository.js';

type JsonObject = Record<string, unknown>;

const TRANSITIONS = new Set([
  'queued:implementing',
  'implementing:implementing',
  'implementing:pr_open',
  'pr_open:merged',
  'merged:done',
]);
const ERROR_CODES = new Set([
  'infra',
  'codex_timeout',
  'codex_empty',
  'inspect_violation',
  'ci',
  'conflict',
]);
const IMPLEMENTATION_FAILED_MESSAGE =
  'ルールの実装を完了できませんでした。内容を見直して再提案できます。';

function object(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= max
    ? value.trim()
    : undefined;
}

function gitSha(value: unknown): string | undefined {
  const parsed = text(value, 64);
  return parsed && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(parsed)
    ? parsed
    : undefined;
}

export class PipelineJobService {
  readonly #pipeline: PipelineRepository;
  readonly #proposals: ProposalRepository;
  readonly #now: () => number;

  constructor(
    pipeline: PipelineRepository,
    proposals: ProposalRepository,
    now: () => number = Date.now,
  ) {
    this.#pipeline = pipeline;
    this.#proposals = proposals;
    this.#now = now;
  }

  next() {
    return this.#pipeline.nextQueued();
  }

  active() {
    return this.#pipeline.activeJobs();
  }

  resume(jobId: number) {
    return this.#pipeline.implementation(jobId);
  }

  update(
    jobId: number,
    input: unknown,
  ):
    | { status: 'updated'; job: PipelineJob }
    | { status: 'not_found' }
    | { status: 'invalid'; error: string }
    | { status: 'conflict'; error: string } {
    const value = object(input);
    const from = value?.from;
    const to = value?.to;
    if (
      typeof from !== 'string' ||
      typeof to !== 'string' ||
      !TRANSITIONS.has(`${from}:${to}`)
    ) {
      return { status: 'invalid', error: 'invalid_job_transition' };
    }
    const current = this.#pipeline.job(jobId);
    if (!current) return { status: 'not_found' };
    if (current.phase !== from) {
      return { status: 'conflict', error: 'stale_job_phase' };
    }
    const branch = text(value?.branch, 200);
    const headSha = gitSha(value?.headSha);
    const scaffoldSha = gitSha(value?.scaffoldSha);
    const promptVersion = text(value?.promptVersion, 100);
    const prNumber = value?.prNumber;
    if (
      (value?.branch !== undefined && branch === undefined) ||
      (value?.headSha !== undefined && headSha === undefined) ||
      (value?.scaffoldSha !== undefined && scaffoldSha === undefined) ||
      (value?.promptVersion !== undefined && promptVersion === undefined) ||
      (prNumber !== undefined &&
        (!Number.isSafeInteger(prNumber) || (prNumber as number) <= 0))
    ) {
      return { status: 'invalid', error: 'invalid_job_patch' };
    }
    if (
      (from === 'queued' &&
        (to !== 'implementing' ||
          branch !== `rule/${current.ruleId}` ||
          scaffoldSha === undefined ||
          promptVersion === undefined)) ||
      (from === 'implementing' &&
        to === 'implementing' &&
        (current.attempt < 2 ||
          current.branch !== null ||
          branch !== `rule/${current.ruleId}-a${String(current.attempt)}` ||
          scaffoldSha === undefined ||
          promptVersion === undefined)) ||
      (from === 'implementing' &&
        to === 'pr_open' &&
        (prNumber === undefined ||
          headSha === undefined ||
          current.branch === null ||
          current.scaffoldSha === null ||
          current.promptVersion === null)) ||
      (from === 'implementing' && to !== 'implementing' && to !== 'pr_open') ||
      (from === 'pr_open' && (to !== 'merged' || headSha === undefined)) ||
      (from === 'merged' && to !== 'done')
    ) {
      return { status: 'invalid', error: 'missing_job_transition_fields' };
    }
    const job = this.#pipeline.transitionJob(
      jobId,
      from as PipelineJob['phase'],
      to as PipelineJob['phase'],
      {
        ...(branch ? { branch } : {}),
        ...(headSha ? { headSha } : {}),
        ...(scaffoldSha ? { scaffoldSha } : {}),
        ...(promptVersion ? { promptVersion } : {}),
        ...(typeof prNumber === 'number' ? { prNumber } : {}),
      },
      this.#now(),
    );
    return job
      ? { status: 'updated', job }
      : { status: 'conflict', error: 'stale_job_phase' };
  }

  retry(
    jobId: number,
    input: unknown,
  ):
    | { status: 'retried'; job: PipelineJob }
    | { status: 'not_found' }
    | { status: 'invalid'; error: string }
    | { status: 'conflict'; error: string } {
    const value = object(input);
    const from = value?.from;
    const expectedAttempt = value?.expectedAttempt;
    if (
      (from !== 'implementing' && from !== 'pr_open') ||
      !Number.isSafeInteger(expectedAttempt) ||
      expectedAttempt !== 1
    ) {
      return { status: 'invalid', error: 'invalid_job_retry' };
    }
    const current = this.#pipeline.job(jobId);
    if (!current) return { status: 'not_found' };
    if (current.phase !== from || current.attempt !== expectedAttempt) {
      return { status: 'conflict', error: 'stale_job_attempt' };
    }
    const job = this.#pipeline.retryJob(
      jobId,
      from,
      expectedAttempt as number,
      this.#now(),
    );
    return job
      ? { status: 'retried', job }
      : { status: 'conflict', error: 'stale_job_attempt' };
  }

  fail(
    jobId: number,
    input: unknown,
  ):
    | { status: 'failed'; job: PipelineJob }
    | { status: 'already_failed'; job: PipelineJob }
    | { status: 'not_found' }
    | { status: 'invalid'; error: string }
    | { status: 'conflict'; error: string } {
    const value = object(input);
    const from = value?.from;
    const errorCode = text(value?.errorCode, 100);
    const errorNote =
      value?.errorNote === undefined ? undefined : text(value.errorNote, 2_000);
    if (
      typeof from !== 'string' ||
      !['queued', 'implementing', 'pr_open', 'merged'].includes(from) ||
      !errorCode ||
      !ERROR_CODES.has(errorCode) ||
      (value?.errorNote !== undefined && errorNote === undefined)
    ) {
      return { status: 'invalid', error: 'invalid_job_failure' };
    }
    const current = this.#pipeline.job(jobId);
    if (!current) return { status: 'not_found' };
    if (current.phase === 'failed') {
      return current.errorCode === errorCode
        ? { status: 'already_failed', job: current }
        : { status: 'conflict', error: 'job_already_failed' };
    }
    if (current.phase !== from) {
      return { status: 'conflict', error: 'stale_job_phase' };
    }
    const now = this.#now();
    return this.#pipeline.transaction(() => {
      const job = this.#pipeline.transitionJob(
        jobId,
        from as PipelineJob['phase'],
        'failed',
        { errorCode, ...(errorNote ? { errorNote } : {}) },
        now,
      );
      if (!job)
        return { status: 'conflict', error: 'stale_job_phase' } as const;
      const proposal = this.#proposals.transitionProposal(
        job.proposalId,
        'implementing',
        'failed',
        {
          reasonCode: 'implementation_failed',
          reasonText: IMPLEMENTATION_FAILED_MESSAGE,
        },
        now,
      );
      if (proposal !== 'transitioned') {
        throw new Error(`proposal failure transition ${proposal}`);
      }
      return { status: 'failed', job } as const;
    });
  }
}
