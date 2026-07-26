import {
  validateProposal,
  type CreateProposalResponse,
  type NormalizedProposal,
  type ProposalValidationError,
  type YellowCardInfo,
} from '@daifugo/core';

import {
  createUlid,
  proposalContentHash,
  ProposalRepository,
} from './repository.js';

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

export type ProposalInspection =
  | {
      verdict: 'pass';
      commit?: (proposalId: string) => void;
    }
  | {
      verdict: 'blocked';
      yellowCard: YellowCardInfo;
      commit?: () => void;
    }
  | { verdict: 'unavailable' };

export interface ProposalScreeningGate {
  inspect(
    proposal: NormalizedProposal,
    authorId: string,
  ): ProposalInspection | Promise<ProposalInspection>;
}

export type ProposalSubmissionResult =
  | { status: 200; body: CreateProposalResponse }
  | {
      status: 400;
      body: { error: 'validation_failed'; fields: ProposalValidationError[] };
    }
  | { status: 401; body: { error: 'unauthorized' } }
  | {
      status: 403;
      body: { error: 'proposal_suspended'; suspendedUntil: number };
    }
  | { status: 429; body: { error: 'rate_limited' } }
  | { status: 503; body: { error: 'check_unavailable' } };

export interface ProposalSubmissionPort {
  submit(input: {
    token: string | null;
    ip: string;
    body: unknown;
  }): Promise<ProposalSubmissionResult>;
}

type RateRecord = { userHour: number[]; userDay: number[] };

export interface ProposalRateLimitPort {
  consume(userId: string, ip: string, now: number): boolean;
}

export class ProposalRateLimiter {
  readonly #byUser = new Map<string, RateRecord>();
  readonly #byIp = new Map<string, number[]>();
  #lastSweepAt = Number.NEGATIVE_INFINITY;

  consume(userId: string, ip: string, now: number): boolean {
    this.#sweep(now);
    const record = this.#byUser.get(userId) ?? {
      userHour: [],
      userDay: [],
    };
    record.userHour = record.userHour.filter((at) => at > now - HOUR_MS);
    record.userDay = record.userDay.filter((at) => at > now - DAY_MS);
    const ipHour = (this.#byIp.get(ip) ?? []).filter(
      (at) => at > now - HOUR_MS,
    );
    if (
      record.userHour.length >= 5 ||
      record.userDay.length >= 20 ||
      ipHour.length >= 20
    ) {
      this.#byUser.set(userId, record);
      this.#byIp.set(ip, ipHour);
      return false;
    }
    record.userHour.push(now);
    record.userDay.push(now);
    ipHour.push(now);
    this.#byUser.set(userId, record);
    this.#byIp.set(ip, ipHour);
    return true;
  }

  #sweep(now: number): void {
    if (now - this.#lastSweepAt < HOUR_MS) return;
    this.#lastSweepAt = now;
    for (const [userId, record] of this.#byUser) {
      record.userHour = record.userHour.filter((at) => at > now - HOUR_MS);
      record.userDay = record.userDay.filter((at) => at > now - DAY_MS);
      if (record.userHour.length === 0 && record.userDay.length === 0) {
        this.#byUser.delete(userId);
      }
    }
    for (const [ip, attempts] of this.#byIp) {
      const current = attempts.filter((at) => at > now - HOUR_MS);
      if (current.length === 0) this.#byIp.delete(ip);
      else this.#byIp.set(ip, current);
    }
  }
}

const PASS_THROUGH_GATE: ProposalScreeningGate = {
  inspect: () => ({ verdict: 'pass' }),
};

export class ProposalSubmissionService implements ProposalSubmissionPort {
  readonly #repository: ProposalRepository;
  readonly #screening: ProposalScreeningGate;
  readonly #rateLimiter: ProposalRateLimitPort;
  readonly #now: () => number;
  readonly #createId: (now: number) => string;

  constructor(
    repository: ProposalRepository,
    options: {
      screening?: ProposalScreeningGate;
      rateLimiter?: ProposalRateLimitPort;
      now?: () => number;
      createId?: (now: number) => string;
    } = {},
  ) {
    this.#repository = repository;
    this.#screening = options.screening ?? PASS_THROUGH_GATE;
    this.#rateLimiter = options.rateLimiter ?? new ProposalRateLimiter();
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? createUlid;
  }

  async submit(input: {
    token: string | null;
    ip: string;
    body: unknown;
  }): Promise<ProposalSubmissionResult> {
    if (!input.token) {
      return { status: 401, body: { error: 'unauthorized' } };
    }
    const authorId = this.#repository.authorIdForToken(input.token);
    if (!authorId) {
      return { status: 401, body: { error: 'unauthorized' } };
    }
    const now = this.#now();
    const suspendedUntil = this.#repository.suspendedUntil(authorId);
    if (suspendedUntil !== null && suspendedUntil > now) {
      return {
        status: 403,
        body: { error: 'proposal_suspended', suspendedUntil },
      };
    }
    if (!this.#rateLimiter.consume(authorId, input.ip, now)) {
      return { status: 429, body: { error: 'rate_limited' } };
    }
    const validated = validateProposal(input.body);
    if (!validated.ok) {
      return {
        status: 400,
        body: { error: 'validation_failed', fields: validated.errors },
      };
    }
    const contentHash = proposalContentHash(validated.value);
    const duplicate = this.#repository.findInflight(authorId, contentHash);
    if (duplicate) {
      return {
        status: 200,
        body: { outcome: 'accepted', proposal: duplicate },
      };
    }
    const inspection = await this.#screening.inspect(validated.value, authorId);
    if (inspection.verdict === 'unavailable') {
      return { status: 503, body: { error: 'check_unavailable' } };
    }
    if (inspection.verdict === 'blocked') {
      this.#repository.commitBlocked(() => inspection.commit?.());
      return {
        status: 200,
        body: { outcome: 'blocked', yellowCard: inspection.yellowCard },
      };
    }
    try {
      const proposal = this.#repository.create({
        authorId,
        proposal: validated.value,
        contentHash,
        now,
        id: this.#createId(now),
        ...(inspection.commit ? { commitInspection: inspection.commit } : {}),
      });
      return {
        status: 200,
        body: { outcome: 'accepted', proposal },
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('UNIQUE constraint failed')
      ) {
        const existing = this.#repository.findInflight(authorId, contentHash);
        if (existing) {
          return {
            status: 200,
            body: { outcome: 'accepted', proposal: existing },
          };
        }
      }
      throw error;
    }
  }
}
