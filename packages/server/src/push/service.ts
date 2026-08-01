import { PUSH_NOTIFICATION_TYPES } from '../notification/registry.js';
import { PushRepository, type StoredPushSubscription } from './repository.js';

type PushError =
  | 'unauthorized'
  | 'registration_required'
  | 'push_unavailable'
  | 'invalid_subscription'
  | 'invalid_preferences';

function subscription(value: unknown): StoredPushSubscription | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const endpoint = 'endpoint' in value ? value.endpoint : null;
  const keys = 'keys' in value ? value.keys : null;
  if (
    typeof endpoint !== 'string' ||
    endpoint.length > 4_096 ||
    typeof keys !== 'object' ||
    keys === null ||
    !('p256dh' in keys) ||
    !('auth' in keys) ||
    typeof keys.p256dh !== 'string' ||
    typeof keys.auth !== 'string' ||
    keys.p256dh.length > 4_096 ||
    keys.auth.length > 4_096
  ) {
    return null;
  }
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

function preferenceInput(value: unknown): Record<string, boolean> | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('preferences' in value) ||
    typeof value.preferences !== 'object' ||
    value.preferences === null ||
    Array.isArray(value.preferences)
  ) {
    return null;
  }
  const entries = Object.entries(value.preferences);
  const allowed = new Set<string>(PUSH_NOTIFICATION_TYPES);
  if (
    entries.some(
      ([type, enabled]) => !allowed.has(type) || typeof enabled !== 'boolean',
    )
  ) {
    return null;
  }
  return Object.fromEntries(entries) as Record<string, boolean>;
}

export class PushService {
  readonly #repository: PushRepository;
  readonly #publicKey: string | null;
  readonly #now: () => number;

  constructor(
    repository: PushRepository,
    options: {
      publicKey?: string;
      available?: boolean;
      now?: () => number;
    } = {},
  ) {
    this.#repository = repository;
    this.#publicKey =
      options.available === false ? null : (options.publicKey ?? null);
    this.#now = options.now ?? Date.now;
  }

  config(): { vapidPublicKey: string | null; available: boolean } {
    return {
      vapidPublicKey: this.#publicKey,
      available: this.#publicKey !== null,
    };
  }

  subscribe(token: string | null, body: unknown) {
    const gated = this.#registeredUser(token);
    if ('error' in gated) return gated;
    const parsed = subscription(body);
    if (!parsed)
      return {
        status: 400 as const,
        body: { error: 'invalid_subscription' as const },
      };
    this.#repository.upsert(gated.userId, parsed, this.#now());
    return { status: 204 as const };
  }

  unsubscribe(token: string | null, body: unknown) {
    const gated = this.#registeredUser(token);
    if ('error' in gated) return gated;
    const parsed = subscription(body);
    const endpoint =
      parsed?.endpoint ??
      (typeof body === 'object' &&
      body !== null &&
      'endpoint' in body &&
      typeof body.endpoint === 'string'
        ? body.endpoint
        : null);
    if (!endpoint)
      return {
        status: 400 as const,
        body: { error: 'invalid_subscription' as const },
      };
    this.#repository.revoke(gated.userId, endpoint, this.#now());
    return { status: 204 as const };
  }

  /**
   * ホーム画面アプリからの起動を記録する。
   * 購読と違い匿名ユーザーでも記録する — 追加直後はログアウト状態になるため、
   * 「追加したが登録していない」層こそ観測したい(E17 §2.7)。
   */
  markInstalled(token: string | null) {
    if (!this.#publicKey) {
      return {
        status: 503 as const,
        body: { error: 'push_unavailable' as const },
      };
    }
    const userId = token ? this.#repository.userIdForToken(token) : null;
    if (!userId) {
      return { status: 401 as const, body: { error: 'unauthorized' as const } };
    }
    this.#repository.markInstalled(userId, this.#now());
    return { status: 204 as const };
  }

  getPreferences(token: string | null) {
    const gated = this.#registeredUser(token);
    if ('error' in gated) return gated;
    return {
      status: 200 as const,
      body: {
        preferences: this.#repository.preferences(
          gated.userId,
          PUSH_NOTIFICATION_TYPES,
        ),
      },
    };
  }

  setPreferences(token: string | null, body: unknown) {
    const gated = this.#registeredUser(token);
    if ('error' in gated) return gated;
    const parsed = preferenceInput(body);
    if (!parsed)
      return {
        status: 400 as const,
        body: { error: 'invalid_preferences' as const },
      };
    this.#repository.setPreferences(gated.userId, parsed, this.#now());
    return {
      status: 200 as const,
      body: {
        preferences: this.#repository.preferences(
          gated.userId,
          PUSH_NOTIFICATION_TYPES,
        ),
      },
    };
  }

  #registeredUser(
    token: string | null,
  ):
    | { userId: string }
    | { status: 401 | 403 | 503; body: { error: PushError }; error: true } {
    if (!this.#publicKey) {
      return { status: 503, body: { error: 'push_unavailable' }, error: true };
    }
    const userId = token ? this.#repository.userIdForToken(token) : null;
    if (!userId) {
      return { status: 401, body: { error: 'unauthorized' }, error: true };
    }
    if (!this.#repository.isRegistered(userId)) {
      return {
        status: 403,
        body: { error: 'registration_required' },
        error: true,
      };
    }
    return { userId };
  }
}
