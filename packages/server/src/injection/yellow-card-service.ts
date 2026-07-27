import type {
  CreateCardAppealResponse,
  YellowCardSummary,
} from '@daifugo/core';

import type { ProposalRepository } from '../proposal/repository.js';
import type { InjectionRepository } from './repository.js';

export type YellowCardSummaryResult =
  | { status: 200; body: YellowCardSummary }
  | { status: 401; body: { error: 'unauthorized' } };

export type CreateCardAppealResult =
  | { status: 201; body: CreateCardAppealResponse }
  | { status: 400; body: { error: 'invalid_comment' } }
  | { status: 401; body: { error: 'unauthorized' } }
  | { status: 404; body: { error: 'not_found' } }
  | { status: 409; body: { error: 'appeal_exists' } };

export interface YellowCardPort {
  summary(token: string | null): YellowCardSummaryResult;
  appeal(input: {
    token: string | null;
    cardId: number;
    body: unknown;
  }): CreateCardAppealResult;
}

export class YellowCardService implements YellowCardPort {
  readonly #repository: InjectionRepository;
  readonly #users: Pick<ProposalRepository, 'authorIdForToken'>;
  readonly #now: () => number;

  constructor(
    repository: InjectionRepository,
    users: Pick<ProposalRepository, 'authorIdForToken'>,
    now: () => number = Date.now,
  ) {
    this.#repository = repository;
    this.#users = users;
    this.#now = now;
  }

  summary(token: string | null): YellowCardSummaryResult {
    const userId = token ? this.#users.authorIdForToken(token) : null;
    if (!userId) {
      return { status: 401, body: { error: 'unauthorized' } };
    }
    return {
      status: 200,
      body: this.#repository.summary(userId, this.#now()),
    };
  }

  appeal(input: {
    token: string | null;
    cardId: number;
    body: unknown;
  }): CreateCardAppealResult {
    const userId = input.token
      ? this.#users.authorIdForToken(input.token)
      : null;
    if (!userId) {
      return { status: 401, body: { error: 'unauthorized' } };
    }
    if (
      typeof input.body !== 'object' ||
      input.body === null ||
      Array.isArray(input.body)
    ) {
      return { status: 400, body: { error: 'invalid_comment' } };
    }
    const rawComment = (input.body as Record<string, unknown>).comment;
    if (
      rawComment !== undefined &&
      rawComment !== null &&
      typeof rawComment !== 'string'
    ) {
      return { status: 400, body: { error: 'invalid_comment' } };
    }
    const comment =
      typeof rawComment === 'string' && rawComment.trim().length > 0
        ? rawComment.trim()
        : null;
    if (comment && Array.from(comment).length > 200) {
      return { status: 400, body: { error: 'invalid_comment' } };
    }
    const result = this.#repository.createAppeal(
      userId,
      input.cardId,
      comment,
      this.#now(),
    );
    if (result === 'not_found') {
      return { status: 404, body: { error: 'not_found' } };
    }
    if (result === 'conflict') {
      return { status: 409, body: { error: 'appeal_exists' } };
    }
    return { status: 201, body: result };
  }
}
