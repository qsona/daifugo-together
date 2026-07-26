import type {
  CreateProposalRequest,
  CreateProposalResponse,
  ProposalValidationError,
} from '@daifugo/core';

const TOKEN_KEY = 'daifugo.userToken';

export class ProposalApiError extends Error {
  readonly status: number;
  readonly fields: ProposalValidationError[];

  constructor(
    status: number,
    message: string,
    fields: ProposalValidationError[] = [],
  ) {
    super(message);
    this.name = 'ProposalApiError';
    this.status = status;
    this.fields = fields;
  }
}

export interface ProposalApi {
  submit(request: CreateProposalRequest): Promise<CreateProposalResponse>;
}

export class ProposalClient implements ProposalApi {
  readonly #baseUrl: string;
  readonly #storage: Pick<Storage, 'getItem'>;
  readonly #fetch: typeof fetch;

  constructor(
    baseUrl: string,
    storage: Pick<Storage, 'getItem'>,
    fetcher: typeof fetch = fetch,
  ) {
    this.#baseUrl = baseUrl;
    this.#storage = storage;
    this.#fetch = fetcher;
  }

  async submit(
    request: CreateProposalRequest,
  ): Promise<CreateProposalResponse> {
    const token = this.#storage.getItem(TOKEN_KEY);
    if (!token) {
      throw new ProposalApiError(
        401,
        '接続の準備中です。少し待ってからもう一度ためしてください',
      );
    }
    const response = await this.#fetch(`${this.#baseUrl}/api/proposals`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
    });
    const body = (await response.json()) as {
      error?: string;
      fields?: ProposalValidationError[];
    };
    if (!response.ok) {
      const message =
        {
          validation_failed: '入力内容をたしかめてください',
          unauthorized: '接続し直してから、もう一度ためしてください',
          proposal_suspended: 'いまはルールを提案できません',
          rate_limited: 'しばらく待ってから、もう一度ためしてください',
          check_unavailable:
            'ただいま混み合っています。時間をおいて再送してください',
        }[body.error ?? ''] ?? '提案を送信できませんでした';
      throw new ProposalApiError(response.status, message, body.fields ?? []);
    }
    return body as CreateProposalResponse;
  }
}

let browserClient: ProposalClient | undefined;

export function getBrowserProposalClient(): ProposalClient {
  browserClient ??= new ProposalClient(window.location.origin, localStorage);
  return browserClient;
}
