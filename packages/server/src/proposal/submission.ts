import {
  validateProposal,
  type CreateProposalResponse,
  type NormalizedProposal,
  type ProposalValidationError,
} from '@daifugo/core';

import {
  createUlid,
  proposalContentHash,
  ProposalRepository,
} from './repository.js';

export interface ProposalSignalRecorder {
  analyze(
    proposal: NormalizedProposal,
    authorId: string,
  ): { commit: (proposalId: string) => void };
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
    };

export interface ProposalSubmissionPort {
  submit(input: {
    token: string | null;
    ip: string;
    body: unknown;
  }): Promise<ProposalSubmissionResult>;
}

export class ProposalSubmissionService implements ProposalSubmissionPort {
  readonly #repository: ProposalRepository;
  readonly #signals: ProposalSignalRecorder;
  readonly #now: () => number;
  readonly #createId: (now: number) => string;

  constructor(
    repository: ProposalRepository,
    options: {
      signals: ProposalSignalRecorder;
      now?: () => number;
      createId?: (now: number) => string;
    },
  ) {
    this.#repository = repository;
    this.#signals = options.signals;
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
    const signals = this.#signals.analyze(validated.value, authorId);
    try {
      const proposal = this.#repository.create({
        authorId,
        proposal: validated.value,
        contentHash,
        now,
        id: this.#createId(now),
        commitSignals: signals.commit,
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
