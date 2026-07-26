import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { ReplayAction, ReplayInit, ReplayRecord } from '@daifugo/core';
import Database from 'better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

import type {
  RoomManagerOptions,
  RoomPersistencePort,
} from './room/manager.js';
import type {
  AnonymousSession,
  SessionStore,
  SessionStoreOptions,
} from './room/session.js';
import type { RoomAction, RoomState, RoomTransition } from './room/types.js';

const users = sqliteTable('users', {
  userId: text('user_id').primaryKey(),
  userToken: text('user_token').notNull().unique(),
  displayName: text('display_name').notNull(),
  createdAt: integer('created_at').notNull(),
});

const replayRecords = sqliteTable(
  'replay_records',
  {
    setId: text('set_id').notNull(),
    seq: integer('seq').notNull(),
    recordJson: text('record_json').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.setId, table.seq] })],
);

const setResults = sqliteTable('set_results', {
  setId: text('set_id').primaryKey(),
  roomId: text('room_id').notNull(),
  resultJson: text('result_json').notNull(),
  createdAt: integer('created_at').notNull(),
});

type DrizzleDatabase = ReturnType<typeof drizzle>;

export class SqliteSessionStore implements SessionStore {
  readonly #db: DrizzleDatabase;
  readonly #createUserId: () => string;
  readonly #createToken: () => string;
  readonly #createDisplayName: (sequence: number) => string;
  #sequence: number;

  constructor(db: DrizzleDatabase, options: SessionStoreOptions = {}) {
    this.#db = db;
    this.#createUserId = options.createUserId ?? randomUUID;
    this.#createToken = options.createToken ?? randomUUID;
    this.#createDisplayName =
      options.createDisplayName ??
      ((sequence) =>
        `ゲスト${sequence
          .toString(36)
          .toUpperCase()
          .padStart(6, '0')
          .slice(-6)}`);
    this.#sequence =
      this.#db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .get()?.count ?? 0;
  }

  resolve(presentedToken: unknown): AnonymousSession {
    if (typeof presentedToken === 'string') {
      const existing = this.#db
        .select()
        .from(users)
        .where(eq(users.userToken, presentedToken))
        .get();
      if (existing) {
        return {
          userId: existing.userId,
          userToken: existing.userToken,
          displayName: existing.displayName,
        };
      }
    }
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const session: AnonymousSession = {
        userId: this.#createUserId(),
        userToken: this.#createToken(),
        displayName: this.#createDisplayName(++this.#sequence),
      };
      if (session.userToken.length < 16) continue;
      try {
        this.#db
          .insert(users)
          .values({ ...session, createdAt: Date.now() })
          .run();
        return session;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('UNIQUE constraint failed')
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new Error('Could not allocate a unique anonymous user');
  }

  rename(userToken: string, displayName: string): boolean {
    return (
      this.#db
        .update(users)
        .set({ displayName })
        .where(eq(users.userToken, userToken))
        .run().changes === 1
    );
  }
}

function replayInit(state: RoomState): ReplayInit | undefined {
  const engine = state.engine;
  if (!engine) return undefined;
  return {
    formatVersion: 1,
    engineVersion: '0.0.0',
    contractVersion: 1,
    setId: engine.setId,
    setSeed: engine.setSeed,
    config: engine.config,
    members: engine.members,
    ruleChain: engine.ruleChain,
  };
}

function replayAction(
  action: RoomAction,
  seq: number,
): ReplayAction | undefined {
  const coreAction: ReplayAction['action'] | undefined =
    action.type === 'play'
      ? { type: 'play', player: action.memberId, cards: action.cards }
      : action.type === 'pass'
        ? { type: 'pass', player: action.memberId }
        : action.type === 'autoAct'
          ? action.cards
            ? { type: 'play', player: action.memberId, cards: action.cards }
            : { type: 'pass', player: action.memberId }
          : action.type === 'advanceIntermission'
            ? { type: 'advance' }
            : action.type === 'requestDrain'
              ? { type: 'requestDrain' }
              : undefined;
  return coreAction ? { seq, action: coreAction } : undefined;
}

export class SqlitePersistence implements RoomPersistencePort {
  readonly #sqlite: Database.Database;
  readonly #db: DrizzleDatabase;
  readonly sessions: SqliteSessionStore;

  constructor(path: string, sessionOptions: SessionStoreOptions = {}) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.#sqlite = new Database(path);
    this.#sqlite.pragma('journal_mode = WAL');
    this.#db = drizzle(this.#sqlite);
    this.#sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        user_token TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS replay_records (
        set_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        record_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (set_id, seq)
      );
      CREATE TABLE IF NOT EXISTS set_results (
        set_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    this.sessions = new SqliteSessionStore(this.#db, sessionOptions);
  }

  roomManagerOptions(): Pick<RoomManagerOptions, 'persistence'> {
    return { persistence: this };
  }

  commit(
    previous: RoomState,
    action: RoomAction,
    transition: RoomTransition,
  ): void {
    const next = transition.state;
    const now = 'now' in action ? action.now : Date.now();
    const transaction = this.#sqlite.transaction(() => {
      const isInit =
        (action.type === 'start' || action.type === 'continue') &&
        next.engine?.setId !== previous.engine?.setId;
      const nextReplaySeq = next.engine
        ? (
            this.#sqlite
              .prepare(
                'SELECT COALESCE(MAX(seq), -1) + 1 AS seq FROM replay_records WHERE set_id = ?',
              )
              .get(next.engine.setId) as { seq: number }
          ).seq
        : 0;
      const record = isInit
        ? replayInit(next)
        : replayAction(action, nextReplaySeq);
      if (record) {
        const setId =
          'setId' in record ? record.setId : (next.engine?.setId ?? '');
        this.#db
          .insert(replayRecords)
          .values({
            setId,
            seq: 'formatVersion' in record ? -1 : record.seq,
            recordJson: JSON.stringify(record),
            createdAt: now,
          })
          .run();
      }
      if (
        previous.phase !== 'setResult' &&
        next.phase === 'setResult' &&
        next.engine?.outcome
      ) {
        this.#db
          .insert(setResults)
          .values({
            setId: next.engine.setId,
            roomId: next.roomId,
            resultJson: JSON.stringify(next.engine.outcome),
            createdAt: now,
          })
          .onConflictDoNothing()
          .run();
      }
    });
    transaction();
  }

  replay(setId: string): ReplayRecord[] {
    return this.#db
      .select()
      .from(replayRecords)
      .where(eq(replayRecords.setId, setId))
      .orderBy(replayRecords.seq)
      .all()
      .map((row) => JSON.parse(row.recordJson) as ReplayRecord);
  }

  result(setId: string): unknown {
    const row = this.#db
      .select()
      .from(setResults)
      .where(eq(setResults.setId, setId))
      .get();
    return row ? JSON.parse(row.resultJson) : undefined;
  }

  close(): void {
    this.#sqlite.close();
  }
}
