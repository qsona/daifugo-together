export type AuthOutcome = 'linked' | 'switched' | 'already';

export interface AuthCompleteResponse {
  outcome: AuthOutcome;
  userToken: string;
  displayName: string;
}

export interface AuthApi {
  begin(userToken: string): Promise<void>;
  complete(ott: string): Promise<AuthCompleteResponse>;
}

export class AuthApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`auth_api_${String(status)}`);
    this.name = 'AuthApiError';
    this.status = status;
  }
}

export class AuthClient implements AuthApi {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #navigate: (url: string) => void;

  constructor(
    baseUrl: string,
    fetcher: typeof fetch = fetch,
    navigate: (url: string) => void = (url) => {
      window.location.href = url;
    },
  ) {
    this.#baseUrl = baseUrl;
    this.#fetch = (...args) => fetcher(...args);
    this.#navigate = navigate;
  }

  async begin(userToken: string): Promise<void> {
    const response = await this.#fetch(`${this.#baseUrl}/api/auth/begin`, {
      method: 'POST',
      credentials: 'include',
      headers: { authorization: `Bearer ${userToken}` },
    });
    if (!response.ok) throw new AuthApiError(response.status);
    const body = (await response.json()) as { authUrl?: unknown };
    if (typeof body.authUrl !== 'string') throw new AuthApiError(500);
    this.#navigate(body.authUrl);
  }

  async complete(ott: string): Promise<AuthCompleteResponse> {
    const response = await this.#fetch(`${this.#baseUrl}/api/auth/complete`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ott }),
    });
    if (!response.ok) throw new AuthApiError(response.status);
    return (await response.json()) as AuthCompleteResponse;
  }
}

let browserClient: AuthClient | undefined;

export function getBrowserAuthClient(): AuthClient {
  browserClient ??= new AuthClient(window.location.origin);
  return browserClient;
}
