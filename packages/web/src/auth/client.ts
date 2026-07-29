export type AuthOutcome = 'linked' | 'switched' | 'already';

export interface AuthCompleteResponse {
  outcome: AuthOutcome;
  userToken: string;
  displayName: string;
}

export interface AuthApi {
  begin(userToken: string): Promise<string>;
  complete(ott: string): Promise<AuthCompleteResponse>;
}

export class AuthClient implements AuthApi {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(baseUrl: string, fetcher: typeof fetch = fetch) {
    this.#baseUrl = baseUrl;
    this.#fetch = fetcher;
  }

  async begin(userToken: string): Promise<string> {
    const response = await this.#fetch(`${this.#baseUrl}/api/auth/begin`, {
      method: 'POST',
      headers: { authorization: `Bearer ${userToken}` },
    });
    const body = (await response.json()) as {
      authUrl?: string;
      error?: string;
    };
    if (!response.ok || !body.authUrl) {
      throw new Error(body.error ?? 'auth_begin_failed');
    }
    return body.authUrl;
  }

  async complete(ott: string): Promise<AuthCompleteResponse> {
    const response = await this.#fetch(`${this.#baseUrl}/api/auth/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ott }),
    });
    if (!response.ok) throw new Error('auth_complete_failed');
    return (await response.json()) as AuthCompleteResponse;
  }
}

let browserClient: AuthClient | undefined;

export function getBrowserAuthClient(): AuthClient {
  browserClient ??= new AuthClient(window.location.origin);
  return browserClient;
}
