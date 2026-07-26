import { randomBytes, randomUUID } from 'node:crypto';

export interface AnonymousSession {
  userId: string;
  userToken: string;
  displayName: string;
}

export interface SessionStoreOptions {
  createUserId?: () => string;
  createToken?: () => string;
  createDisplayName?: (sequence: number) => string;
}

export class InMemorySessionStore {
  readonly #byToken = new Map<string, AnonymousSession>();
  readonly #createUserId: () => string;
  readonly #createToken: () => string;
  readonly #createDisplayName: (sequence: number) => string;
  #sequence = 0;

  constructor(options: SessionStoreOptions = {}) {
    this.#createUserId = options.createUserId ?? randomUUID;
    this.#createToken =
      options.createToken ?? (() => randomBytes(32).toString('base64url'));
    this.#createDisplayName =
      options.createDisplayName ??
      ((sequence) =>
        `ゲスト${sequence.toString(36).toUpperCase().padStart(6, '0').slice(-6)}`);
  }

  resolve(presentedToken: unknown): AnonymousSession {
    if (typeof presentedToken === 'string') {
      const existing = this.#byToken.get(presentedToken);
      if (existing) {
        return structuredClone(existing);
      }
    }
    const session: AnonymousSession = {
      userId: this.#createUserId(),
      userToken: this.#uniqueToken(),
      displayName: this.#createDisplayName(++this.#sequence),
    };
    this.#byToken.set(session.userToken, session);
    return structuredClone(session);
  }

  rename(userToken: string, displayName: string): boolean {
    const session = this.#byToken.get(userToken);
    if (!session) {
      return false;
    }
    session.displayName = displayName;
    return true;
  }

  #uniqueToken(): string {
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const candidate = this.#createToken();
      if (
        typeof candidate === 'string' &&
        candidate.length >= 16 &&
        !this.#byToken.has(candidate)
      ) {
        return candidate;
      }
    }
    throw new Error('Unable to issue a unique user token');
  }
}
