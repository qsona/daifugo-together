import type {
  CreateCardAppealResponse,
  CreateProposalRequest,
  CreateProposalResponse,
  MyProposalsResponse,
  ProposalValidationError,
  YellowCardSummary,
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
  mine?(): Promise<MyProposalsResponse>;
  markProposalsSeen?(seenThrough: number): Promise<void>;
  getYellowCards?(): Promise<YellowCardSummary>;
  appealYellowCard?(
    cardId: number,
    comment: string | null,
  ): Promise<CreateCardAppealResponse>;
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
        }[body.error ?? ''] ?? '提案を送信できませんでした';
      throw new ProposalApiError(response.status, message, body.fields ?? []);
    }
    return body as CreateProposalResponse;
  }

  async getYellowCards(): Promise<YellowCardSummary> {
    const response = await this.#authenticatedFetch('/api/me/yellow-cards');
    return (await response.json()) as YellowCardSummary;
  }

  async mine(): Promise<MyProposalsResponse> {
    const response = await this.#authenticatedFetch(
      '/api/proposals/mine',
      {},
      '提案一覧を取得できませんでした',
    );
    return (await response.json()) as MyProposalsResponse;
  }

  async markProposalsSeen(seenThrough: number): Promise<void> {
    await this.#authenticatedFetch(
      '/api/proposals/seen',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seenThrough }),
      },
      '提案の既読状態を更新できませんでした',
    );
  }

  async appealYellowCard(
    cardId: number,
    comment: string | null,
  ): Promise<CreateCardAppealResponse> {
    const response = await this.#authenticatedFetch(
      `/api/yellow-cards/${String(cardId)}/appeal`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ comment }),
      },
    );
    return (await response.json()) as CreateCardAppealResponse;
  }

  async #authenticatedFetch(
    path: string,
    init: RequestInit = {},
    errorMessage = 'カード情報を取得できませんでした',
  ): Promise<Response> {
    const token = this.#storage.getItem(TOKEN_KEY);
    if (!token) {
      throw new ProposalApiError(
        401,
        '接続の準備中です。少し待ってからもう一度ためしてください',
      );
    }
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new ProposalApiError(
        response.status,
        response.status === 409 ? 'すでに異議を申し立てています' : errorMessage,
      );
    }
    return response;
  }
}

let browserClient: ProposalClient | undefined;

export function getBrowserProposalClient(): ProposalClient {
  browserClient ??= new ProposalClient(window.location.origin, localStorage);
  return browserClient;
}
