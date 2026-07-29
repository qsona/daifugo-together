export type AuthOutcome = 'linked' | 'switched' | 'already';

export interface AuthCompleteResponse {
  outcome: AuthOutcome;
  userToken: string;
  displayName: string;
}

export interface AuthApi {
  begin(userToken: string): void;
  complete(ott: string): void;
  takeResult(): AuthCompleteResponse | null;
}

const AUTH_RESULT_COOKIE = '__Secure-daifugo-auth-result';
const AUTH_RESULT_COOKIE_CLEAR_ATTRIBUTES =
  'Max-Age=0; Path=/menu; Secure; SameSite=Strict';

export class AuthClient implements AuthApi {
  readonly #baseUrl: string;
  readonly #document: Document;

  constructor(baseUrl: string, documentRef: Document = document) {
    this.#baseUrl = baseUrl;
    this.#document = documentRef;
  }

  begin(userToken: string): void {
    this.#submit('/auth/google/begin', 'userToken', userToken);
  }

  complete(ott: string): void {
    this.#submit('/auth/google/complete', 'ott', ott);
  }

  takeResult(): AuthCompleteResponse | null {
    let encoded: string | undefined;
    try {
      encoded = this.#document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${AUTH_RESULT_COOKIE}=`))
        ?.slice(AUTH_RESULT_COOKIE.length + 1);
      if (!encoded) return null;
      const parsed = JSON.parse(decodeURIComponent(encoded)) as unknown;
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('outcome' in parsed) ||
        !['linked', 'switched', 'already'].includes(String(parsed.outcome)) ||
        !('userToken' in parsed) ||
        typeof parsed.userToken !== 'string' ||
        !('displayName' in parsed) ||
        typeof parsed.displayName !== 'string'
      ) {
        return null;
      }
      return parsed as AuthCompleteResponse;
    } catch {
      return null;
    } finally {
      try {
        this.#document.cookie = `${AUTH_RESULT_COOKIE}=; ${AUTH_RESULT_COOKIE_CLEAR_ATTRIBUTES}`;
      } catch {
        // The result is still consumed from the current page when cookie writes
        // are unavailable.
      }
    }
  }

  #submit(path: string, field: string, value: string): void {
    const form = this.#document.createElement('form');
    form.method = 'POST';
    form.action = `${this.#baseUrl}${path}`;
    form.hidden = true;

    const input = this.#document.createElement('input');
    input.type = 'hidden';
    input.name = field;
    input.value = value;
    form.append(input);

    this.#document.body.append(form);
    try {
      form.submit();
    } finally {
      form.remove();
    }
  }
}

let browserClient: AuthClient | undefined;

export function getBrowserAuthClient(): AuthClient {
  browserClient ??= new AuthClient(window.location.origin);
  return browserClient;
}
