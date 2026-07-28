import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type {
  ReplayAction,
  ReplayInit,
  ReplayRecord,
  SetResultView,
} from '@daifugo/core';
import Database from 'better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

import { InjectionRepository } from './injection/repository.js';
import { EvaluationRepository } from './evaluation/repository.js';
import { OperationsRepository } from './operations/repository.js';
import { PipelineRepository } from './pipeline/repository.js';
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
import { ProposalRepository } from './proposal/repository.js';
import { RuleRepository } from './rules/repository.js';

const users = sqliteTable('users', {
  userId: text('user_id').primaryKey(),
  userToken: text('user_token').notNull().unique(),
  displayName: text('display_name').notNull(),
  proposalsSeenAt: integer('proposals_seen_at'),
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
  firedRules: text('fired_rules'),
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
  readonly proposals: ProposalRepository;
  readonly injection: InjectionRepository;
  readonly operations: OperationsRepository;
  readonly evaluations: EvaluationRepository;
  readonly pipeline: PipelineRepository;
  readonly rules: RuleRepository;

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
        proposals_seen_at INTEGER,
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
        fired_rules TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        proposal_number INTEGER UNIQUE,
        author_id TEXT NOT NULL REFERENCES users(user_id),
        kind TEXT NOT NULL CHECK (kind IN ('local', 'original')),
        prefecture_code TEXT
          CHECK (
            prefecture_code IS NULL
            OR prefecture_code GLOB '[0-4][0-9]'
          ),
        name TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'screening'
          CHECK (
            status IN (
              'screening', 'implementing', 'released', 'rejected', 'failed'
            )
          ),
        reason_code TEXT,
        reason_text TEXT,
        rule_id TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        content_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        status_changed_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        CHECK (kind = 'local' OR prefecture_code IS NULL)
      );
      CREATE INDEX IF NOT EXISTS idx_proposals_author
        ON proposals(author_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_proposals_status
        ON proposals(status, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_proposals_inflight_dedupe
        ON proposals(author_id, content_hash)
        WHERE status IN ('screening', 'implementing')
          OR (status = 'failed' AND attempt_count = 0);
    `);
    const userColumns = this.#sqlite
      .prepare("PRAGMA table_info('users')")
      .all() as Array<{ name: string }>;
    if (!userColumns.some(({ name }) => name === 'proposals_seen_at')) {
      this.#sqlite.exec(
        'ALTER TABLE users ADD COLUMN proposals_seen_at INTEGER',
      );
    }
    const setResultColumns = this.#sqlite
      .prepare("PRAGMA table_info('set_results')")
      .all() as Array<{ name: string }>;
    if (!setResultColumns.some(({ name }) => name === 'fired_rules')) {
      this.#sqlite.exec('ALTER TABLE set_results ADD COLUMN fired_rules TEXT');
    }
    const proposalColumns = this.#sqlite
      .prepare("PRAGMA table_info('proposals')")
      .all() as Array<{ name: string }>;
    if (!proposalColumns.some(({ name }) => name === 'proposal_number')) {
      this.#sqlite.exec(
        'ALTER TABLE proposals ADD COLUMN proposal_number INTEGER',
      );
    }
    const unnumberedProposals = this.#sqlite
      .prepare(
        `SELECT id FROM proposals
         WHERE proposal_number IS NULL
         ORDER BY created_at ASC, id ASC`,
      )
      .all() as Array<{ id: string }>;
    if (unnumberedProposals.length > 0) {
      this.#sqlite.transaction(() => {
        let next = (
          this.#sqlite
            .prepare(
              'SELECT COALESCE(MAX(proposal_number), 0) AS value FROM proposals',
            )
            .get() as { value: number }
        ).value;
        const assign = this.#sqlite.prepare(
          'UPDATE proposals SET proposal_number = ? WHERE id = ?',
        );
        for (const proposal of unnumberedProposals) {
          next += 1;
          assign.run(next, proposal.id);
        }
      })();
    }
    this.#sqlite.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_proposals_number
        ON proposals(proposal_number);
    `);
    this.sessions = new SqliteSessionStore(this.#db, sessionOptions);
    this.proposals = new ProposalRepository(this.#sqlite);
    this.injection = new InjectionRepository(this.#sqlite);
    this.pipeline = new PipelineRepository(
      this.#sqlite,
      this.proposals,
      this.injection,
    );
    this.rules = new RuleRepository(this.#sqlite);
    this.evaluations = new EvaluationRepository(this.#sqlite);
    this.operations = new OperationsRepository(this.#sqlite);
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
      const isInit = next.engine?.setId !== previous.engine?.setId;
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
      if (isInit && next.engine) {
        this.evaluations.beginSet({
          setId: next.engine.setId,
          roomId: next.roomId,
          startedAt: now,
          participantUserIds: next.members.flatMap((member) =>
            member.isAI || member.userId === null ? [] : [member.userId],
          ),
          rules: (next.fixedRules ?? []).map((rule) => ({
            ruleId: rule.ruleId,
            position: rule.position,
            bundleHash: rule.bundleHash,
            popularityScore: rule.priority.score,
            didFire: false,
          })),
        });
      }
      if (
        previous.phase !== 'setResult' &&
        next.phase === 'setResult' &&
        next.engine?.outcome
      ) {
        const ruleNames = new Map(
          (next.fixedRules ?? next.availableRules).map((rule) => [
            rule.ruleId,
            rule.name,
          ]),
        );
        const firedRules: SetResultView['firedRules'] = Object.entries(
          next.firedRuleCounts,
        )
          .filter(([, count]) => count > 0)
          .sort(
            ([left], [right]) =>
              ((next.fixedRules ?? []).find((rule) => rule.ruleId === left)
                ?.position ?? Number.MAX_SAFE_INTEGER) -
              ((next.fixedRules ?? []).find((rule) => rule.ruleId === right)
                ?.position ?? Number.MAX_SAFE_INTEGER),
          )
          .map(([ruleId, count]) => ({
            ruleId,
            ruleName: ruleNames.get(ruleId) ?? ruleId,
            count,
          }));
        this.#db
          .insert(setResults)
          .values({
            setId: next.engine.setId,
            roomId: next.roomId,
            resultJson: JSON.stringify(next.engine.outcome),
            firedRules: JSON.stringify(firedRules),
            createdAt: now,
          })
          .onConflictDoNothing()
          .run();
        this.evaluations.completeSet({
          setId: next.engine.setId,
          endedAt: now,
          gamesPlayed: next.engine.outcome.gamesPlayed,
          completion: next.engine.outcome.completion,
          standings: next.engine.outcome.standings,
          firedRuleIds: next.engine.outcome.firedRuleIds,
        });
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
    return row
      ? {
          ...(JSON.parse(row.resultJson) as object),
          firedRules:
            row.firedRules === null
              ? []
              : (JSON.parse(row.firedRules) as SetResultView['firedRules']),
        }
      : undefined;
  }

  checkHealth(): boolean {
    try {
      const row = this.#sqlite.prepare('SELECT 1 AS ok').get() as
        { ok: number } | undefined;
      return row?.ok === 1;
    } catch {
      return false;
    }
  }

  close(): void {
    this.#sqlite.close();
  }
}
