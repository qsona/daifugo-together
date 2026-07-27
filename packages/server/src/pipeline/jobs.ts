import type { PipelineJob, PipelineRepository } from './repository.js';

type JsonObject = Record<string, unknown>;

const TRANSITIONS = new Set([
  'queued:implementing',
  'implementing:pr_open',
  'pr_open:merged',
  'merged:done',
]);

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

export class PipelineJobService {
  readonly #pipeline: PipelineRepository;
  readonly #now: () => number;

  constructor(pipeline: PipelineRepository, now: () => number = Date.now) {
    this.#pipeline = pipeline;
    this.#now = now;
  }

  next() {
    return this.#pipeline.nextQueued();
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
    const branch = text(value?.branch, 200);
    const headSha = text(value?.headSha, 64);
    const scaffoldSha = text(value?.scaffoldSha, 64);
    const prNumber = value?.prNumber;
    if (
      (value?.branch !== undefined && branch === undefined) ||
      (value?.headSha !== undefined && headSha === undefined) ||
      (value?.scaffoldSha !== undefined && scaffoldSha === undefined) ||
      (prNumber !== undefined &&
        (!Number.isSafeInteger(prNumber) || (prNumber as number) <= 0))
    ) {
      return { status: 'invalid', error: 'invalid_job_patch' };
    }
    const job = this.#pipeline.transitionJob(
      jobId,
      from as PipelineJob['phase'],
      to as PipelineJob['phase'],
      {
        ...(branch ? { branch } : {}),
        ...(headSha ? { headSha } : {}),
        ...(scaffoldSha ? { scaffoldSha } : {}),
        ...(typeof prNumber === 'number' ? { prNumber } : {}),
      },
      this.#now(),
    );
    return job
      ? { status: 'updated', job }
      : { status: 'conflict', error: 'stale_job_phase' };
  }
}
