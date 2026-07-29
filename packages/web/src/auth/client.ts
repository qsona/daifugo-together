export type AuthOutcome = 'linked' | 'switched' | 'already';

export interface AuthCompleteResponse {
  outcome: AuthOutcome;
  userToken: string;
  displayName: string;
}

export interface AuthApi {
  begin(userToken: string): void;
  complete(ott: string): Promise<AuthCompleteResponse>;
}

export class AuthClient implements AuthApi {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #document: Document;

  constructor(
    baseUrl: string,
    fetcher: typeof fetch = fetch,
    documentRef: Document = document,
  ) {
    this.#baseUrl = baseUrl;
    this.#fetch = fetcher;
    this.#document = documentRef;
  }

  begin(userToken: string): void {
    const form = this.#document.createElement('form');
    form.method = 'POST';
    form.action = `${this.#baseUrl}/auth/google/begin`;
    form.hidden = true;

    const token = this.#document.createElement('input');
    token.type = 'hidden';
    token.name = 'userToken';
    token.value = userToken;
    form.append(token);

    this.#document.body.append(form);
    try {
      form.submit();
    } finally {
      form.remove();
    }
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
