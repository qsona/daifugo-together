import {
  RULE_VOTES,
  SET_RATINGS,
  type EvaluationRepository,
  type EvaluationUpdate,
  type RuleVote,
  type SetRating,
} from './repository.js';

type EvaluationHttpResult = {
  status: 200 | 400 | 401 | 403 | 404 | 422;
  body: unknown;
};

function updateBody(body: unknown): EvaluationUpdate | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null;
  }
  const value = body as Record<string, unknown>;
  if (
    Object.keys(value).some((key) => key !== 'setRating' && key !== 'ruleVote')
  ) {
    return null;
  }
  const update: EvaluationUpdate = {};
  if ('setRating' in value) {
    if (!SET_RATINGS.includes(value.setRating as SetRating)) return null;
    update.setRating = value.setRating as SetRating;
  }
  if ('ruleVote' in value) {
    const vote = value.ruleVote;
    if (
      typeof vote !== 'object' ||
      vote === null ||
      Array.isArray(vote) ||
      Object.keys(vote).some((key) => key !== 'ruleId' && key !== 'vote')
    ) {
      return null;
    }
    const record = vote as Record<string, unknown>;
    if (
      typeof record.ruleId !== 'string' ||
      record.ruleId.length === 0 ||
      (record.vote !== null && !RULE_VOTES.includes(record.vote as RuleVote))
    ) {
      return null;
    }
    update.ruleVote = {
      ruleId: record.ruleId,
      vote: record.vote as RuleVote | null,
    };
  }
  return update.setRating === undefined && update.ruleVote === undefined
    ? null
    : update;
}

export class EvaluationService {
  readonly #repository: EvaluationRepository;
  readonly #now: () => number;

  constructor(
    repository: EvaluationRepository,
    options: { now?: () => number } = {},
  ) {
    this.#repository = repository;
    this.#now = options.now ?? Date.now;
  }

  get(token: string | null, setId: string): EvaluationHttpResult {
    const result = this.#repository.state(token, setId);
    if (result === 'unauthorized') {
      return { status: 401, body: { error: result } };
    }
    if (result === 'forbidden') {
      return { status: 403, body: { error: result } };
    }
    if (result === 'not_found') {
      return { status: 404, body: { error: result } };
    }
    return { status: 200, body: result };
  }

  update(
    token: string | null,
    setId: string,
    body: unknown,
  ): EvaluationHttpResult {
    const update = updateBody(body);
    if (!update) return { status: 400, body: { error: 'invalid_body' } };
    const result = this.#repository.update(token, setId, update, this.#now());
    if (result.status === 'updated') {
      return { status: 200, body: result };
    }
    if (result.status === 'unauthorized') {
      return { status: 401, body: { error: result.status } };
    }
    if (result.status === 'forbidden' || result.status === 'expired') {
      return { status: 403, body: { error: result.status } };
    }
    if (result.status === 'not_found') {
      return { status: 404, body: { error: result.status } };
    }
    return { status: 422, body: { error: result.status } };
  }
}
