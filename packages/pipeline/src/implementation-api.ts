import type {
  PipelineJob,
  QueuedImplementation,
  StoredRule,
  StoredRuleVersion,
} from '@daifugo/server';

import type { PipelineJobPort } from './implementation-driver.js';

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function messages(value: unknown): value is Record<string, string> {
  const parsed = object(value);
  return (
    parsed !== null &&
    Object.values(parsed).every((item) => typeof item === 'string')
  );
}

function storedRule(value: unknown): value is StoredRule {
  const rule = object(value);
  return (
    rule !== null &&
    typeof rule.id === 'string' &&
    typeof rule.slug === 'string' &&
    typeof rule.name === 'string' &&
    typeof rule.description === 'string' &&
    (rule.kind === 'local' || rule.kind === 'original') &&
    (rule.prefecture === null || typeof rule.prefecture === 'string') &&
    typeof rule.proposalId === 'string' &&
    ['active', 'disabled', 'removed'].includes(String(rule.status)) &&
    (rule.disabledReason === null ||
      ['manual', 'auto_incident', 'rollback', 'pending_enable'].includes(
        String(rule.disabledReason),
      )) &&
    typeof rule.createdAt === 'number' &&
    typeof rule.updatedAt === 'number'
  );
}

function storedRuleVersion(value: unknown): value is StoredRuleVersion {
  const version = object(value);
  return (
    version !== null &&
    Number.isSafeInteger(version.id) &&
    typeof version.ruleId === 'string' &&
    Number.isSafeInteger(version.version) &&
    Number.isSafeInteger(version.contractVersion) &&
    (version.prNumber === null || Number.isSafeInteger(version.prNumber)) &&
    (version.mergeSha === null || typeof version.mergeSha === 'string') &&
    (version.bundleHash === null || typeof version.bundleHash === 'string') &&
    typeof version.isCurrent === 'boolean' &&
    (version.revertedAt === null || typeof version.revertedAt === 'number') &&
    typeof version.createdAt === 'number'
  );
}

function pipelineJob(value: unknown): value is PipelineJob {
  const job = object(value);
  return (
    job !== null &&
    Number.isSafeInteger(job.id) &&
    typeof job.proposalId === 'string' &&
    typeof job.phase === 'string' &&
    ['queued', 'implementing', 'pr_open', 'merged', 'done', 'failed'].includes(
      job.phase,
    ) &&
    Number.isSafeInteger(job.attempt) &&
    Number.isSafeInteger(job.implementationAttempt) &&
    Number.isSafeInteger(job.ciRerun) &&
    typeof job.ruleId === 'string' &&
    typeof job.slug === 'string' &&
    (job.mergeSha === null ||
      (typeof job.mergeSha === 'string' &&
        /^[0-9a-f]{40}$/u.test(job.mergeSha))) &&
    typeof job.createdAt === 'number' &&
    typeof job.updatedAt === 'number'
  );
}

function queuedImplementation(value: unknown): value is QueuedImplementation {
  const item = object(value);
  const proposal = object(item?.proposal);
  const spec = object(item?.spec);
  const source = object(spec?.source);
  const scaffoldMeta = object(item?.scaffoldMeta);
  return (
    item !== null &&
    pipelineJob(item.job) &&
    proposal !== null &&
    typeof proposal.id === 'string' &&
    (proposal.kind === 'local' || proposal.kind === 'original') &&
    (proposal.prefectureCode === null ||
      typeof proposal.prefectureCode === 'string') &&
    (proposal.prefecture === null || typeof proposal.prefecture === 'string') &&
    typeof proposal.name === 'string' &&
    typeof proposal.body === 'string' &&
    Number.isSafeInteger(item.passedCheckId) &&
    Number.isSafeInteger(item.approvedJudgementId) &&
    spec !== null &&
    spec.specVersion === 1 &&
    typeof spec.name === 'string' &&
    typeof spec.summary === 'string' &&
    strings(spec.hooks) &&
    strings(spec.effects) &&
    strings(spec.testPoints) &&
    typeof spec.notes === 'string' &&
    source !== null &&
    (source.kind === 'local' || source.kind === 'original') &&
    typeof source.title === 'string' &&
    typeof source.body === 'string' &&
    scaffoldMeta !== null &&
    typeof scaffoldMeta.slug === 'string' &&
    messages(scaffoldMeta.messages)
  );
}

export class ImplementationApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ImplementationApiError';
  }
}

export class HttpPipelineJobPort implements PipelineJobPort {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #onWarning: (warning: string) => void;

  constructor(options: {
    baseUrl: string;
    token: string;
    fetch?: typeof fetch;
    onWarning?: (warning: string) => void;
  }) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/u, '');
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
    this.#onWarning = options.onWarning ?? (() => undefined);
  }

  async #request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.#token}`,
        ...(init?.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
      },
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ImplementationApiError(
        'pipeline API returned non-JSON response',
        response.status,
      );
    }
    if (!response.ok) {
      const error = object(body)?.error;
      throw new ImplementationApiError(
        typeof error === 'string' ? error : 'pipeline API request failed',
        response.status,
      );
    }
    return body;
  }

  async next(): Promise<QueuedImplementation | null> {
    const response = object(await this.#request('/admin/pipeline/next'));
    if (!response || !('item' in response)) {
      throw new ImplementationApiError('invalid next-job response');
    }
    if (response.warnings !== undefined) {
      if (!strings(response.warnings)) {
        throw new ImplementationApiError('invalid next-job warnings');
      }
      for (const warning of response.warnings) this.#onWarning(warning);
    }
    if (response.item === null) return null;
    if (
      !queuedImplementation(response.item) ||
      response.item.job.phase !== 'queued'
    ) {
      throw new ImplementationApiError('invalid queued implementation');
    }
    return response.item;
  }

  async resume(jobId: number): Promise<QueuedImplementation | null> {
    try {
      const response = object(
        await this.#request(`/admin/pipeline/jobs/${String(jobId)}`),
      );
      if (!response || !queuedImplementation(response.item)) {
        throw new ImplementationApiError('invalid resumable implementation');
      }
      return response.item;
    } catch (error) {
      if (error instanceof ImplementationApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async update(jobId: number, input: unknown) {
    const response = object(
      await this.#request(`/admin/pipeline/jobs/${String(jobId)}/update`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    );
    if (!response || typeof response.status !== 'string') {
      throw new ImplementationApiError('invalid job-update response');
    }
    return response as Awaited<ReturnType<PipelineJobPort['update']>>;
  }

  async retry(jobId: number, input: unknown) {
    const response = object(
      await this.#request(`/admin/pipeline/jobs/${String(jobId)}/retry`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    );
    if (!response || typeof response.status !== 'string') {
      throw new ImplementationApiError('invalid job-retry response');
    }
    return response as Awaited<ReturnType<PipelineJobPort['retry']>>;
  }

  async fail(jobId: number, input: unknown) {
    const response = object(
      await this.#request(`/admin/pipeline/jobs/${String(jobId)}/fail`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    );
    if (!response || typeof response.status !== 'string') {
      throw new ImplementationApiError('invalid job-failure response');
    }
    return response as Awaited<ReturnType<PipelineJobPort['fail']>>;
  }
}

export type RuleReleaseLookup =
  | {
      status: 'found';
      rule: StoredRule;
      versions: StoredRuleVersion[];
      releaseReady: boolean;
    }
  | { status: 'not_found' };

export type RuleReleaseEnableResult =
  | { status: 'updated' | 'unchanged'; rule: StoredRule }
  | { status: 'not_found' }
  | { status: 'conflict'; error: string };

export interface RuleReleasePort {
  get(ruleId: string): Promise<RuleReleaseLookup>;
  enable(ruleId: string): Promise<RuleReleaseEnableResult>;
}

export class HttpRuleReleasePort implements RuleReleasePort {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;

  constructor(options: {
    baseUrl: string;
    token: string;
    fetch?: typeof fetch;
  }) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/u, '');
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
  }

  async #request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.#token}`,
      },
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ImplementationApiError(
        'rule API returned non-JSON response',
        response.status,
      );
    }
    if (!response.ok) {
      const error = object(body)?.error;
      throw new ImplementationApiError(
        typeof error === 'string' ? error : 'rule API request failed',
        response.status,
      );
    }
    return body;
  }

  async get(ruleId: string): Promise<RuleReleaseLookup> {
    try {
      const response = object(
        await this.#request(`/admin/rules/${encodeURIComponent(ruleId)}`),
      );
      if (
        response?.status !== 'found' ||
        !storedRule(response.rule) ||
        !Array.isArray(response.versions) ||
        !response.versions.every(storedRuleVersion) ||
        typeof response.releaseReady !== 'boolean'
      ) {
        throw new ImplementationApiError('invalid rule lookup response');
      }
      return response as unknown as Extract<
        RuleReleaseLookup,
        { status: 'found' }
      >;
    } catch (error) {
      if (error instanceof ImplementationApiError && error.status === 404) {
        return { status: 'not_found' };
      }
      throw error;
    }
  }

  async enable(ruleId: string): Promise<RuleReleaseEnableResult> {
    const httpResponse = await this.#fetch(
      `${this.#baseUrl}/admin/rules/${encodeURIComponent(ruleId)}/enable`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${this.#token}` },
      },
    );
    let body: unknown;
    try {
      body = await httpResponse.json();
    } catch {
      throw new ImplementationApiError(
        'rule API returned non-JSON response',
        httpResponse.status,
      );
    }
    const response = object(body);
    if (response?.status === 'not_found' && httpResponse.status === 404) {
      return { status: 'not_found' };
    }
    if (
      response?.status === 'conflict' &&
      httpResponse.status === 409 &&
      typeof response.error === 'string'
    ) {
      return { status: 'conflict', error: response.error };
    }
    if (!httpResponse.ok) {
      throw new ImplementationApiError(
        typeof response?.error === 'string'
          ? response.error
          : 'rule API request failed',
        httpResponse.status,
      );
    }
    if (
      (response?.status === 'updated' || response?.status === 'unchanged') &&
      storedRule(response.rule)
    ) {
      return { status: response.status, rule: response.rule };
    }
    throw new ImplementationApiError('invalid rule enable response');
  }
}
