import { createHash, randomBytes } from 'node:crypto';

import type { AuthProvider } from './provider.js';
import type { AuthRepository, CompletedAuth } from './repository.js';

const STATE_TTL_MS = 10 * 60 * 1_000;
const OTT_TTL_MS = 60 * 1_000;

type BeginRecord = {
  userId: string;
  verifier: string;
  flowNonce: string;
  expiresAt: number;
};

type OttRecord = CompletedAuth & { expiresAt: number };

function randomValue(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

function challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export class AuthService {
  readonly #repository: AuthRepository;
  readonly #provider: AuthProvider | undefined;
  readonly #publicOrigin: string;
  readonly #now: () => number;
  readonly #createValue: () => string;
  readonly #states = new Map<string, BeginRecord>();
  readonly #otts = new Map<string, OttRecord>();

  constructor(
    repository: AuthRepository,
    options: {
      provider?: AuthProvider;
      publicOrigin: string;
      now?: () => number;
      createValue?: () => string;
    },
  ) {
    this.#repository = repository;
    this.#provider = options.provider;
    this.#publicOrigin = new URL(options.publicOrigin).origin;
    this.#now = options.now ?? Date.now;
    this.#createValue = options.createValue ?? randomValue;
  }

  async begin(
    token: string | null,
  ): Promise<
    | { status: 200; body: { authUrl: string }; flowNonce: string }
    | { status: 401; body: { error: 'unauthorized' } }
    | { status: 503; body: { error: 'auth_unavailable' } }
  > {
    this.#prune();
    if (!token) return { status: 401, body: { error: 'unauthorized' } };
    const user = this.#repository.findByToken(token);
    if (!user) return { status: 401, body: { error: 'unauthorized' } };
    if (!this.#provider) {
      return { status: 503, body: { error: 'auth_unavailable' } };
    }
    const state = this.#createValue();
    const verifier = this.#createValue();
    const flowNonce = this.#createValue();
    const redirectUri = `${this.#publicOrigin}/auth/google/callback`;
    this.#states.set(state, {
      userId: user.userId,
      verifier,
      flowNonce,
      expiresAt: this.#now() + STATE_TTL_MS,
    });
    return {
      status: 200,
      body: {
        authUrl: await this.#provider.authorizationUrl({
          state,
          codeChallenge: challenge(verifier),
          redirectUri,
        }),
      },
      flowNonce,
    };
  }

  async callback(
    parameters: URLSearchParams,
    flowNonce: string | null,
  ): Promise<string> {
    this.#prune();
    const state = parameters.get('state');
    if (parameters.has('error')) {
      if (state) this.#states.delete(state);
      return this.#errorRedirect('denied');
    }
    if (!state) return this.#errorRedirect('expired');
    const record = this.#states.get(state);
    this.#states.delete(state);
    if (
      !record ||
      record.expiresAt <= this.#now() ||
      !this.#provider ||
      !flowNonce ||
      flowNonce !== record.flowNonce
    ) {
      return this.#errorRedirect('expired');
    }
    try {
      const googleSub = await this.#provider.resolveSubject({
        parameters,
        state,
        codeVerifier: record.verifier,
        redirectUri: `${this.#publicOrigin}/auth/google/callback`,
      });
      const completed = this.#repository.complete(
        record.userId,
        googleSub,
        this.#now(),
      );
      if (!completed) return this.#errorRedirect('failed');
      const ott = this.#createValue();
      this.#otts.set(ott, {
        ...completed,
        expiresAt: this.#now() + OTT_TTL_MS,
      });
      return `${this.#publicOrigin}/#/auth/complete?ott=${encodeURIComponent(ott)}`;
    } catch {
      return this.#errorRedirect('failed');
    }
  }

  complete(ott: unknown):
    | {
        status: 200;
        body: CompletedAuth;
      }
    | { status: 410; body: { error: 'invalid_or_expired_ott' } } {
    this.#prune();
    if (typeof ott !== 'string') {
      return { status: 410, body: { error: 'invalid_or_expired_ott' } };
    }
    const record = this.#otts.get(ott);
    this.#otts.delete(ott);
    if (!record || record.expiresAt <= this.#now()) {
      return { status: 410, body: { error: 'invalid_or_expired_ott' } };
    }
    return {
      status: 200,
      body: {
        outcome: record.outcome,
        userToken: record.userToken,
        displayName: record.displayName,
      },
    };
  }

  #errorRedirect(error: 'denied' | 'expired' | 'failed'): string {
    return `${this.#publicOrigin}/#/auth/complete?error=${error}`;
  }

  #prune(): void {
    const now = this.#now();
    for (const [state, record] of this.#states) {
      if (record.expiresAt <= now) this.#states.delete(state);
    }
    for (const [ott, record] of this.#otts) {
      if (record.expiresAt <= now) this.#otts.delete(ott);
    }
  }
}
