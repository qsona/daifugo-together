import * as oidc from 'openid-client';

export interface AuthProvider {
  authorizationUrl(input: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
  }): Promise<string>;
  resolveSubject(input: {
    parameters: URLSearchParams;
    state: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<string>;
}

export class FakeAuthProvider implements AuthProvider {
  readonly #subjects = new Map<string, string>();

  setSubject(code: string, subject: string): void {
    this.#subjects.set(code, subject);
  }

  async authorizationUrl(input: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
  }): Promise<string> {
    const url = new URL('https://accounts.example.test/authorize');
    url.searchParams.set('state', input.state);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('scope', 'openid');
    url.searchParams.set('response_mode', 'form_post');
    return url.href;
  }

  async resolveSubject(input: {
    parameters: URLSearchParams;
    state: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<string> {
    if (input.parameters.get('state') !== input.state) {
      throw new Error('state_mismatch');
    }
    if (input.codeVerifier.length < 43 || !input.redirectUri) {
      throw new Error('invalid_pkce');
    }
    const code = input.parameters.get('code');
    const subject = code ? this.#subjects.get(code) : undefined;
    if (!subject) throw new Error('invalid_code');
    return subject;
  }
}

class GoogleAuthProvider implements AuthProvider {
  readonly #configuration: oidc.Configuration;

  constructor(configuration: oidc.Configuration) {
    this.#configuration = configuration;
  }

  async authorizationUrl(input: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
  }): Promise<string> {
    return oidc.buildAuthorizationUrl(this.#configuration, {
      redirect_uri: input.redirectUri,
      scope: 'openid',
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
      response_mode: 'form_post',
    }).href;
  }

  async resolveSubject(input: {
    parameters: URLSearchParams;
    state: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<string> {
    // openid-client accepts a callback URL. The provider delivered these
    // parameters in a POST body, so this URL exists only in server memory.
    const currentUrl = new URL(input.redirectUri);
    currentUrl.search = input.parameters.toString();
    const tokens = await oidc.authorizationCodeGrant(
      this.#configuration,
      currentUrl,
      {
        expectedState: input.state,
        pkceCodeVerifier: input.codeVerifier,
      },
      { redirect_uri: input.redirectUri },
    );
    const subject = tokens.claims()?.sub;
    if (!subject) throw new Error('missing_sub');
    return subject;
  }
}

export async function createGoogleAuthProvider(input: {
  clientId?: string;
  clientSecret?: string;
}): Promise<AuthProvider | undefined> {
  if (!input.clientId || !input.clientSecret) return undefined;
  const configuration = await oidc.discovery(
    new URL('https://accounts.google.com'),
    input.clientId,
    input.clientSecret,
  );
  return new GoogleAuthProvider(configuration);
}
