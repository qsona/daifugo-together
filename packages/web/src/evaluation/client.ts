import type { RuleVote, SetFunRating } from '../screens/SetResultScreen';

const TOKEN_KEY = 'daifugo.userToken';

export interface EvaluationState {
  setRating: SetFunRating | null;
  ruleVotes: { ruleId: string; vote: Exclude<RuleVote, null> }[];
}

export interface EvaluationApi {
  get(setId: string): Promise<EvaluationState>;
  update(
    setId: string,
    update:
      | { setRating: SetFunRating }
      | { ruleVote: { ruleId: string; vote: RuleVote } },
  ): Promise<EvaluationState>;
}

export class EvaluationClient implements EvaluationApi {
  readonly #baseUrl: string;
  readonly #storage: Pick<Storage, 'getItem'>;

  constructor(baseUrl: string, storage: Pick<Storage, 'getItem'>) {
    this.#baseUrl = baseUrl;
    this.#storage = storage;
  }

  get(setId: string): Promise<EvaluationState> {
    return this.#request(setId, { method: 'GET' });
  }

  update(
    setId: string,
    update:
      | { setRating: SetFunRating }
      | { ruleVote: { ruleId: string; vote: RuleVote } },
  ): Promise<EvaluationState> {
    return this.#request(setId, {
      method: 'POST',
      body: JSON.stringify(update),
    });
  }

  async #request(
    setId: string,
    init: { method: 'GET' | 'POST'; body?: string },
  ): Promise<EvaluationState> {
    let token: string | null;
    try {
      token = this.#storage.getItem(TOKEN_KEY);
    } catch {
      token = null;
    }
    if (!token) throw new Error('評価セッションが見つかりません');
    const response = await fetch(
      `${this.#baseUrl}/api/sets/${encodeURIComponent(setId)}/evaluation`,
      {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body === undefined
            ? {}
            : { 'content-type': 'application/json' }),
        },
      },
    );
    const body = (await response.json()) as
      EvaluationState | { state?: EvaluationState; error?: string };
    if (!response.ok) {
      throw new Error('error' in body ? body.error : 'evaluation_failed');
    }
    return 'state' in body && body.state
      ? body.state
      : (body as EvaluationState);
  }
}

let browserClient: EvaluationClient | undefined;

export function getBrowserEvaluationClient(): EvaluationClient {
  let storage: Pick<Storage, 'getItem'>;
  try {
    storage = window.localStorage;
  } catch {
    storage = { getItem: () => null };
  }
  browserClient ??= new EvaluationClient(window.location.origin, storage);
  return browserClient;
}
