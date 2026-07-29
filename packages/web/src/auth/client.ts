import { getSafeLocalStorage } from '../browser-storage';

const TOKEN_KEY = 'daifugo.userToken';

export type AuthOutcome = 'linked' | 'switched' | 'already';

export interface AuthCompleteResponse {
  outcome: AuthOutcome;
  userToken: string;
  displayName: string;
}

export interface AuthApi {
  begin(): Promise<string>;
  complete(ott: string): Promise<AuthCompleteResponse>;
}

export class AuthClient implements AuthApi {
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

  async begin(): Promise<string> {
    let token: string | null = null;
    try {
      token = this.#storage.getItem(TOKEN_KEY);
    } catch {
      // Private browsing and storage policies must not break the login screen.
    }
    const response = await this.#fetch(`${this.#baseUrl}/api/auth/begin`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
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
  browserClient ??= new AuthClient(
    window.location.origin,
    getSafeLocalStorage(window),
  );
  return browserClient;
}
