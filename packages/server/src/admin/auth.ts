import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import * as oidc from 'openid-client';

const STATE_TTL_MS = 10 * 60 * 1_000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1_000;

export interface AdminIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
}

export interface AdminAuthProvider {
  authorizationUrl(input: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
  }): Promise<string>;
  resolveIdentity(input: {
    parameters: URLSearchParams;
    state: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<AdminIdentity>;
}

type FlowRecord = {
  verifier: string;
  flowNonce: string;
  expiresAt: number;
};

function randomValue(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

function challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function sameValue(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export class AdminAuthService {
  readonly #provider: AdminAuthProvider | undefined;
  readonly #publicOrigin: string;
  readonly #allowedEmail: string;
  readonly #sessionSecret: string;
  readonly #now: () => number;
  readonly #createValue: () => string;
  readonly #flows = new Map<string, FlowRecord>();

  constructor(options: {
    provider?: AdminAuthProvider;
    publicOrigin: string;
    allowedEmail: string;
    sessionSecret: string;
    now?: () => number;
    createValue?: () => string;
  }) {
    if (options.sessionSecret.length < 32) {
      throw new Error('Admin session secret must be at least 32 characters');
    }
    this.#provider = options.provider;
    this.#publicOrigin = new URL(options.publicOrigin).origin;
    this.#allowedEmail = options.allowedEmail.trim().toLowerCase();
    this.#sessionSecret = options.sessionSecret;
    this.#now = options.now ?? Date.now;
    this.#createValue = options.createValue ?? randomValue;
  }

  async begin(): Promise<
    | { status: 'ready'; authUrl: string; flowNonce: string }
    | { status: 'unavailable' }
  > {
    this.#prune();
    if (!this.#provider) return { status: 'unavailable' };
    const state = this.#createValue();
    const verifier = this.#createValue();
    const flowNonce = this.#createValue();
    const redirectUri = `${this.#publicOrigin}/auth/google/callback`;
    this.#flows.set(state, {
      verifier,
      flowNonce,
      expiresAt: this.#now() + STATE_TTL_MS,
    });
    return {
      status: 'ready',
      authUrl: await this.#provider.authorizationUrl({
        state,
        codeChallenge: challenge(verifier),
        redirectUri,
      }),
      flowNonce,
    };
  }

  async callback(
    parameters: URLSearchParams,
    flowNonce: string | null,
  ): Promise<
    | { status: 'authorized'; session: string; email: string }
    | { status: 'denied' | 'expired' | 'failed' }
  > {
    this.#prune();
    const state = parameters.get('state');
    if (parameters.has('error')) {
      if (state) this.#flows.delete(state);
      return { status: 'denied' };
    }
    if (!state) return { status: 'expired' };
    const record = this.#flows.get(state);
    this.#flows.delete(state);
    if (
      !record ||
      record.expiresAt <= this.#now() ||
      !this.#provider ||
      !flowNonce ||
      !sameValue(flowNonce, record.flowNonce)
    ) {
      return { status: 'expired' };
    }
    try {
      const identity = await this.#provider.resolveIdentity({
        parameters,
        state,
        codeVerifier: record.verifier,
        redirectUri: `${this.#publicOrigin}/auth/google/callback`,
      });
      const email = identity.email.trim().toLowerCase();
      if (!identity.emailVerified || !sameValue(email, this.#allowedEmail)) {
        return { status: 'denied' };
      }
      return {
        status: 'authorized',
        session: this.#createSession(email),
        email,
      };
    } catch {
      return { status: 'failed' };
    }
  }

  sessionEmail(session: string | null): string | null {
    if (!session) return null;
    const separator = session.lastIndexOf('.');
    if (separator <= 0) return null;
    const payload = session.slice(0, separator);
    const signature = session.slice(separator + 1);
    const expected = this.#sign(payload);
    if (!sameValue(signature, expected)) return null;
    try {
      const decoded = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as unknown;
      if (
        !Array.isArray(decoded) ||
        decoded.length !== 2 ||
        typeof decoded[0] !== 'string' ||
        typeof decoded[1] !== 'number' ||
        decoded[1] <= this.#now() ||
        !sameValue(decoded[0], this.#allowedEmail)
      ) {
        return null;
      }
      return decoded[0];
    } catch {
      return null;
    }
  }

  #createSession(email: string): string {
    const payload = Buffer.from(
      JSON.stringify([email, this.#now() + SESSION_TTL_MS]),
    ).toString('base64url');
    return `${payload}.${this.#sign(payload)}`;
  }

  #sign(payload: string): string {
    return createHmac('sha256', this.#sessionSecret)
      .update(payload)
      .digest('base64url');
  }

  #prune(): void {
    const now = this.#now();
    for (const [state, record] of this.#flows) {
      if (record.expiresAt <= now) this.#flows.delete(state);
    }
  }
}

export class FakeAdminAuthProvider implements AdminAuthProvider {
  readonly #identities = new Map<string, AdminIdentity>();

  setIdentity(code: string, identity: AdminIdentity): void {
    this.#identities.set(code, identity);
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
    url.searchParams.set('scope', 'openid email');
    url.searchParams.set('response_mode', 'form_post');
    return url.href;
  }

  async resolveIdentity(input: {
    parameters: URLSearchParams;
    state: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<AdminIdentity> {
    if (input.parameters.get('state') !== input.state) {
      throw new Error('state_mismatch');
    }
    if (input.codeVerifier.length < 43 || !input.redirectUri) {
      throw new Error('invalid_pkce');
    }
    const code = input.parameters.get('code');
    const identity = code ? this.#identities.get(code) : undefined;
    if (!identity) throw new Error('invalid_code');
    return identity;
  }
}

class GoogleAdminAuthProvider implements AdminAuthProvider {
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
      scope: 'openid email',
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
      response_mode: 'form_post',
      prompt: 'select_account',
    }).href;
  }

  async resolveIdentity(input: {
    parameters: URLSearchParams;
    state: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<AdminIdentity> {
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
    const claims = tokens.claims();
    if (
      !claims?.sub ||
      typeof claims.email !== 'string' ||
      typeof claims.email_verified !== 'boolean'
    ) {
      throw new Error('missing_admin_identity');
    }
    return {
      subject: claims.sub,
      email: claims.email,
      emailVerified: claims.email_verified,
    };
  }
}

export async function createGoogleAdminAuthProvider(input: {
  clientId?: string;
  clientSecret?: string;
}): Promise<AdminAuthProvider | undefined> {
  if (!input.clientId || !input.clientSecret) return undefined;
  const configuration = await oidc.discovery(
    new URL('https://accounts.google.com'),
    input.clientId,
    input.clientSecret,
  );
  return new GoogleAdminAuthProvider(configuration);
}
