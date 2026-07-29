import type Database from 'better-sqlite3';

import type { AnonymousSession, SessionStore } from '../room/session.js';

export type AuthOutcome = 'linked' | 'switched' | 'already';

export interface AuthUser {
  userId: string;
  userToken: string;
  displayName: string;
  googleSub: string | null;
}

export interface CompletedAuth {
  outcome: AuthOutcome;
  userToken: string;
  displayName: string;
}

export class AuthRepository {
  readonly #sqlite: Database.Database;
  readonly #sessions: SessionStore;

  constructor(sqlite: Database.Database, sessions: SessionStore) {
    this.#sqlite = sqlite;
    this.#sessions = sessions;
  }

  findByToken(token: string): AuthUser | null {
    return this.#row(
      `SELECT user_id, user_token, display_name, google_sub
       FROM users WHERE user_token = ?`,
      token,
    );
  }

  isRegistered(userId: string): boolean {
    const row = this.#sqlite
      .prepare('SELECT google_sub FROM users WHERE user_id = ?')
      .get(userId) as { google_sub: string | null } | undefined;
    return row?.google_sub !== null && row?.google_sub !== undefined;
  }

  complete(
    currentUserId: string,
    googleSub: string,
    now: number,
  ): CompletedAuth | null {
    const current = this.#row(
      `SELECT user_id, user_token, display_name, google_sub
       FROM users WHERE user_id = ?`,
      currentUserId,
    );
    if (!current) return null;

    const existing = this.#row(
      `SELECT user_id, user_token, display_name, google_sub
       FROM users WHERE google_sub = ?`,
      googleSub,
    );
    if (existing) {
      return {
        outcome: existing.userId === current.userId ? 'already' : 'switched',
        userToken: existing.userToken,
        displayName: existing.displayName,
      };
    }

    if (current.googleSub === null) {
      this.#sqlite
        .prepare(
          `UPDATE users SET google_sub = ?, registered_at = ?
           WHERE user_id = ? AND google_sub IS NULL`,
        )
        .run(googleSub, now, current.userId);
      return {
        outcome: 'linked',
        userToken: current.userToken,
        displayName: current.displayName,
      };
    }

    const created: AnonymousSession = this.#sessions.resolve(undefined);
    this.#sqlite
      .prepare(
        `UPDATE users SET google_sub = ?, registered_at = ?
         WHERE user_id = ? AND google_sub IS NULL`,
      )
      .run(googleSub, now, created.userId);
    return {
      outcome: 'switched',
      userToken: created.userToken,
      displayName: created.displayName,
    };
  }

  #row(sql: string, value: string): AuthUser | null {
    const row = this.#sqlite.prepare(sql).get(value) as
      | {
          user_id: string;
          user_token: string;
          display_name: string;
          google_sub: string | null;
        }
      | undefined;
    return row
      ? {
          userId: row.user_id,
          userToken: row.user_token,
          displayName: row.display_name,
          googleSub: row.google_sub,
        }
      : null;
  }
}
