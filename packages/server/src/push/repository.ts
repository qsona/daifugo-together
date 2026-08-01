import type { NotificationType } from '@daifugo/core';
import type Database from 'better-sqlite3';

export interface StoredPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export class PushRepository {
  readonly #sqlite: Database.Database;

  constructor(sqlite: Database.Database) {
    this.#sqlite = sqlite;
  }

  userIdForToken(token: string): string | null {
    const row = this.#sqlite
      .prepare('SELECT user_id FROM users WHERE user_token = ?')
      .get(token) as { user_id: string } | undefined;
    return row?.user_id ?? null;
  }

  isRegistered(userId: string): boolean {
    const row = this.#sqlite
      .prepare('SELECT google_sub FROM users WHERE user_id = ?')
      .get(userId) as { google_sub: string | null } | undefined;
    return row?.google_sub !== null && row?.google_sub !== undefined;
  }

  /** ホーム画面アプリからの初回起動時刻。A2HS 施策の効果測定用(E17 §2.7)。 */
  markInstalled(userId: string, now: number): void {
    this.#sqlite
      .prepare(
        `UPDATE users SET standalone_seen_at = COALESCE(standalone_seen_at, ?)
         WHERE user_id = ?`,
      )
      .run(now, userId);
  }

  installedAt(userId: string): number | null {
    const row = this.#sqlite
      .prepare('SELECT standalone_seen_at FROM users WHERE user_id = ?')
      .get(userId) as { standalone_seen_at: number | null } | undefined;
    return row?.standalone_seen_at ?? null;
  }

  upsert(
    userId: string,
    subscription: StoredPushSubscription,
    now: number,
  ): void {
    this.#sqlite
      .prepare(
        `INSERT INTO push_subscriptions (
           user_id, endpoint, keys_p256dh, keys_auth, created_at, revoked_at
         ) VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT(endpoint) DO UPDATE SET
           user_id = excluded.user_id,
           keys_p256dh = excluded.keys_p256dh,
           keys_auth = excluded.keys_auth,
           created_at = excluded.created_at,
           revoked_at = NULL`,
      )
      .run(
        userId,
        subscription.endpoint,
        subscription.p256dh,
        subscription.auth,
        now,
      );
  }

  revoke(userId: string, endpoint: string, now: number): void {
    this.#sqlite
      .prepare(
        `UPDATE push_subscriptions SET revoked_at = ?
         WHERE user_id = ? AND endpoint = ? AND revoked_at IS NULL`,
      )
      .run(now, userId, endpoint);
  }

  revokeEndpoint(endpoint: string, now: number): void {
    this.#sqlite
      .prepare(
        `UPDATE push_subscriptions SET revoked_at = ?
         WHERE endpoint = ? AND revoked_at IS NULL`,
      )
      .run(now, endpoint);
  }

  active(userId: string): StoredPushSubscription[] {
    const rows = this.#sqlite
      .prepare(
        `SELECT endpoint, keys_p256dh, keys_auth
         FROM push_subscriptions
         WHERE user_id = ? AND revoked_at IS NULL`,
      )
      .all(userId) as Array<{
      endpoint: string;
      keys_p256dh: string;
      keys_auth: string;
    }>;
    return rows.map((row) => ({
      endpoint: row.endpoint,
      p256dh: row.keys_p256dh,
      auth: row.keys_auth,
    }));
  }

  markSent(endpoint: string, now: number): void {
    this.#sqlite
      .prepare(
        'UPDATE push_subscriptions SET last_sent_at = ? WHERE endpoint = ?',
      )
      .run(now, endpoint);
  }

  preference(userId: string, type: NotificationType): boolean {
    const row = this.#sqlite
      .prepare(
        `SELECT enabled FROM push_preferences
         WHERE user_id = ? AND type = ?`,
      )
      .get(userId, type) as { enabled: number } | undefined;
    return row?.enabled === 1;
  }

  preferences(
    userId: string,
    types: readonly NotificationType[],
  ): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    for (const type of types) result[type] = this.preference(userId, type);
    return result;
  }

  setPreferences(
    userId: string,
    preferences: Readonly<Record<string, boolean>>,
    now: number,
  ): void {
    const statement = this.#sqlite.prepare(
      `INSERT INTO push_preferences (user_id, type, enabled, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, type) DO UPDATE SET
         enabled = excluded.enabled, updated_at = excluded.updated_at`,
    );
    this.#sqlite.transaction(() => {
      for (const [type, enabled] of Object.entries(preferences)) {
        statement.run(userId, type, enabled ? 1 : 0, now);
      }
    })();
  }
}
