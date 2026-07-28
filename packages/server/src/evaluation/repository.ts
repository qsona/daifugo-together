import { randomUUID } from 'node:crypto';

import { computePopularityScore } from '@daifugo/core';
import type Database from 'better-sqlite3';

export const SET_RATINGS = ['fun', 'neutral', 'boring'] as const;
export type SetRating = (typeof SET_RATINGS)[number];
export const RULE_VOTES = ['up', 'down'] as const;
export type RuleVote = (typeof RULE_VOTES)[number];

export interface EliminationParams {
  nMin: number;
  theta: number;
  z: number;
}

export const DEFAULT_ELIMINATION_PARAMS: EliminationParams = {
  nMin: 10,
  theta: 0.7,
  z: 1.96,
};

export function wilsonLowerBound(
  down: number,
  n: number,
  z = DEFAULT_ELIMINATION_PARAMS.z,
): number {
  if (n === 0) return 0;
  const p = down / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return (center - margin) / denominator;
}

export function shouldEliminate(
  up: number,
  down: number,
  parameters: EliminationParams = DEFAULT_ELIMINATION_PARAMS,
): boolean {
  const n = up + down;
  return (
    n >= parameters.nMin &&
    wilsonLowerBound(down, n, parameters.z) >= parameters.theta
  );
}

export interface SetSnapshotInput {
  setId: string;
  roomId: string;
  startedAt: number;
  endedAt: number;
  gamesPlayed: number;
  completion: 'completed' | 'drained';
  standings: unknown;
  participantUserIds: readonly string[];
  rules: readonly {
    ruleId: string;
    position: number;
    bundleHash: string;
    popularityScore: number;
    didFire: boolean;
  }[];
}

export type BeginSetInput = Pick<
  SetSnapshotInput,
  'setId' | 'roomId' | 'startedAt' | 'participantUserIds' | 'rules'
>;

export type CompleteSetInput = Pick<
  SetSnapshotInput,
  'setId' | 'endedAt' | 'gamesPlayed' | 'completion' | 'standings'
> & {
  firedRuleIds: readonly string[];
};

export interface EvaluationState {
  setRating: SetRating | null;
  ruleVotes: { ruleId: string; vote: RuleVote }[];
}

export interface EvaluationUpdate {
  setRating?: SetRating;
  ruleVote?: { ruleId: string; vote: RuleVote | null };
}

type AccessRow = {
  user_id: string;
  ended_at: number;
};

type VoteStats = { up: number; down: number };

const DEFAULT_SETTINGS = {
  evaluation_ttl_ms: String(60 * 60 * 1_000),
  elimination_n_min: String(DEFAULT_ELIMINATION_PARAMS.nMin),
  elimination_theta: String(DEFAULT_ELIMINATION_PARAMS.theta),
  elimination_z: String(DEFAULT_ELIMINATION_PARAMS.z),
} as const;

export class EvaluationRepository {
  readonly #sqlite: Database.Database;

  constructor(sqlite: Database.Database) {
    this.#sqlite = sqlite;
    this.#sqlite.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS game_sets (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        games_played INTEGER NOT NULL DEFAULT 0,
        completion TEXT CHECK (completion IN ('completed', 'drained')),
        standings TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_game_sets_ended
        ON game_sets(ended_at, id);
      CREATE TABLE IF NOT EXISTS set_participants (
        set_id TEXT NOT NULL REFERENCES game_sets(id),
        user_id TEXT NOT NULL REFERENCES users(user_id),
        PRIMARY KEY (set_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS set_rules (
        set_id TEXT NOT NULL REFERENCES game_sets(id),
        rule_id TEXT NOT NULL REFERENCES rules(id),
        was_active INTEGER NOT NULL CHECK (was_active IN (0, 1)),
        did_fire INTEGER NOT NULL CHECK (did_fire IN (0, 1)),
        position INTEGER NOT NULL,
        bundle_hash TEXT NOT NULL,
        popularity_score REAL NOT NULL,
        PRIMARY KEY (set_id, rule_id),
        UNIQUE (set_id, position)
      );
      CREATE INDEX IF NOT EXISTS idx_set_rules_set_active
        ON set_rules(set_id, was_active);
      CREATE TABLE IF NOT EXISTS set_evaluations (
        id TEXT PRIMARY KEY,
        set_id TEXT NOT NULL REFERENCES game_sets(id),
        user_id TEXT NOT NULL REFERENCES users(user_id),
        rating TEXT NOT NULL CHECK (rating IN ('fun', 'neutral', 'boring')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (set_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_set_evaluations_created
        ON set_evaluations(created_at, set_id);
      CREATE TABLE IF NOT EXISTS rule_evaluations (
        id TEXT PRIMARY KEY,
        set_id TEXT NOT NULL REFERENCES game_sets(id),
        user_id TEXT NOT NULL REFERENCES users(user_id),
        rule_id TEXT NOT NULL REFERENCES rules(id),
        vote TEXT NOT NULL CHECK (vote IN ('up', 'down')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (set_id, user_id, rule_id)
      );
      CREATE INDEX IF NOT EXISTS idx_rule_evaluations_rule_vote
        ON rule_evaluations(rule_id, vote, created_at);
      CREATE TABLE IF NOT EXISTS rule_eliminations (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL REFERENCES rules(id),
        eliminated_at INTEGER NOT NULL,
        trigger_set_id TEXT REFERENCES game_sets(id),
        stats_snapshot TEXT NOT NULL,
        reason TEXT NOT NULL,
        reverted_at INTEGER,
        revert_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_rule_eliminations_rule
        ON rule_eliminations(rule_id, eliminated_at);
    `);
    const insertSetting = this.#sqlite.prepare(
      `INSERT OR IGNORE INTO settings(key, value, updated_at)
       VALUES (?, ?, 0)`,
    );
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      insertSetting.run(key, value);
    }
  }

  recordSet(input: SetSnapshotInput): void {
    this.#sqlite.transaction(() => {
      this.beginSet(input);
      this.completeSet({
        setId: input.setId,
        endedAt: input.endedAt,
        gamesPlayed: input.gamesPlayed,
        completion: input.completion,
        standings: input.standings,
        firedRuleIds: input.rules.flatMap((rule) =>
          rule.didFire ? [rule.ruleId] : [],
        ),
      });
    })();
  }

  beginSet(input: BeginSetInput): void {
    this.#sqlite.transaction(() => {
      this.#sqlite
        .prepare(
          `INSERT OR IGNORE INTO game_sets (
             id, room_id, started_at
           ) VALUES (?, ?, ?)`,
        )
        .run(input.setId, input.roomId, input.startedAt);
      const insertParticipant = this.#sqlite.prepare(
        `INSERT OR IGNORE INTO set_participants(set_id, user_id)
         SELECT ?, user_id FROM users WHERE user_id = ?`,
      );
      for (const userId of new Set(input.participantUserIds)) {
        insertParticipant.run(input.setId, userId);
      }
      const insertRule = this.#sqlite.prepare(
        `INSERT OR IGNORE INTO set_rules (
           set_id, rule_id, was_active, did_fire, position, bundle_hash,
           popularity_score
         )
         SELECT ?, id, 1, ?, ?, ?, ? FROM rules WHERE id = ?`,
      );
      for (const rule of input.rules) {
        insertRule.run(
          input.setId,
          0,
          rule.position,
          rule.bundleHash,
          rule.popularityScore,
          rule.ruleId,
        );
      }
    })();
  }

  completeSet(input: CompleteSetInput): void {
    this.#sqlite.transaction(() => {
      const updated = this.#sqlite
        .prepare(
          `UPDATE game_sets
           SET ended_at = ?, games_played = ?, completion = ?, standings = ?
           WHERE id = ? AND ended_at IS NULL`,
        )
        .run(
          input.endedAt,
          input.gamesPlayed,
          input.completion,
          JSON.stringify(input.standings),
          input.setId,
        );
      if (updated.changes !== 1) {
        throw new Error(
          `Cannot complete unknown or completed set: ${input.setId}`,
        );
      }
      const markFired = this.#sqlite.prepare(
        `UPDATE set_rules SET did_fire = 1
         WHERE set_id = ? AND rule_id = ?`,
      );
      for (const ruleId of new Set(input.firedRuleIds)) {
        markFired.run(input.setId, ruleId);
      }
    })();
  }

  state(
    token: string | null,
    setId: string,
  ): EvaluationState | 'unauthorized' | 'forbidden' | 'not_found' {
    const access = this.#access(token, setId);
    if (access === 'unauthorized' || access === 'not_found') return access;
    if (!access) return 'forbidden';
    return this.#state(access.user_id, setId);
  }

  update(
    token: string | null,
    setId: string,
    update: EvaluationUpdate,
    now: number,
  ):
    | { status: 'updated'; state: EvaluationState; eliminatedRuleIds: string[] }
    | { status: 'unauthorized' | 'forbidden' | 'not_found' | 'expired' }
    | { status: 'invalid_rule' } {
    const access = this.#access(token, setId);
    if (access === 'unauthorized' || access === 'not_found') {
      return { status: access };
    }
    if (!access) return { status: 'forbidden' };
    const ttl = this.settingNumber('evaluation_ttl_ms');
    if (now > access.ended_at + ttl) return { status: 'expired' };
    if (update.ruleVote !== undefined) {
      const eligible = this.#sqlite
        .prepare(
          `SELECT 1 FROM set_rules
           WHERE set_id = ? AND rule_id = ? AND did_fire = 1`,
        )
        .get(setId, update.ruleVote.ruleId);
      if (!eligible) return { status: 'invalid_rule' };
    }
    const changedRuleIds: string[] = [];
    this.#sqlite.transaction(() => {
      if (update.setRating !== undefined) {
        this.#sqlite
          .prepare(
            `INSERT INTO set_evaluations (
               id, set_id, user_id, rating, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(set_id, user_id)
             DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at`,
          )
          .run(randomUUID(), setId, access.user_id, update.setRating, now, now);
      }
      if (update.ruleVote !== undefined) {
        if (update.ruleVote.vote === null) {
          this.#sqlite
            .prepare(
              `DELETE FROM rule_evaluations
               WHERE set_id = ? AND user_id = ? AND rule_id = ?`,
            )
            .run(setId, access.user_id, update.ruleVote.ruleId);
        } else {
          this.#sqlite
            .prepare(
              `INSERT INTO rule_evaluations (
                 id, set_id, user_id, rule_id, vote, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(set_id, user_id, rule_id)
               DO UPDATE SET vote = excluded.vote,
                 created_at = excluded.created_at,
                 updated_at = excluded.updated_at`,
            )
            .run(
              randomUUID(),
              setId,
              access.user_id,
              update.ruleVote.ruleId,
              update.ruleVote.vote,
              now,
              now,
            );
        }
        changedRuleIds.push(update.ruleVote.ruleId);
        this.#recomputePopularity(update.ruleVote.ruleId, now);
      }
    })();
    const eliminatedRuleIds = changedRuleIds.filter((ruleId) =>
      this.evaluateElimination(ruleId, setId, now),
    );
    return {
      status: 'updated',
      state: this.#state(access.user_id, setId),
      eliminatedRuleIds,
    };
  }

  voteStats(ruleId: string): VoteStats {
    const rows = this.#sqlite
      .prepare(
        `SELECT vote, COUNT(*) AS count
         FROM rule_evaluations WHERE rule_id = ? GROUP BY vote`,
      )
      .all(ruleId) as Array<{ vote: RuleVote; count: number }>;
    return {
      up: rows.find(({ vote }) => vote === 'up')?.count ?? 0,
      down: rows.find(({ vote }) => vote === 'down')?.count ?? 0,
    };
  }

  evaluateElimination(
    ruleId: string,
    triggerSetId: string | null,
    now: number,
  ): boolean {
    const latest = this.#sqlite
      .prepare(
        `SELECT reverted_at FROM rule_eliminations
         WHERE rule_id = ? ORDER BY eliminated_at DESC LIMIT 1`,
      )
      .get(ruleId) as { reverted_at: number | null } | undefined;
    const windowStart = latest?.reverted_at ?? 0;
    const rows = this.#sqlite
      .prepare(
        `SELECT vote, COUNT(*) AS count
         FROM rule_evaluations
         WHERE rule_id = ? AND created_at > ?
         GROUP BY vote`,
      )
      .all(ruleId, windowStart) as Array<{ vote: RuleVote; count: number }>;
    const stats = {
      up: rows.find(({ vote }) => vote === 'up')?.count ?? 0,
      down: rows.find(({ vote }) => vote === 'down')?.count ?? 0,
    };
    const parameters = this.eliminationParams();
    if (!shouldEliminate(stats.up, stats.down, parameters)) return false;
    return this.#sqlite.transaction(() => {
      const changed = this.#sqlite
        .prepare(
          `UPDATE rules
           SET status = 'removed', disabled_reason = NULL, updated_at = ?
           WHERE id = ? AND status = 'active'`,
        )
        .run(now, ruleId).changes;
      if (changed !== 1) return false;
      const n = stats.up + stats.down;
      this.#sqlite
        .prepare(
          `INSERT INTO rule_eliminations (
             id, rule_id, eliminated_at, trigger_set_id, stats_snapshot, reason
           ) VALUES (?, ?, ?, ?, ?, 'evaluation_threshold')`,
        )
        .run(
          randomUUID(),
          ruleId,
          now,
          triggerSetId,
          JSON.stringify({
            ...stats,
            n,
            wilsonLower: wilsonLowerBound(stats.down, n, parameters.z),
            theta: parameters.theta,
            nMin: parameters.nMin,
            z: parameters.z,
          }),
        );
      return true;
    })();
  }

  evaluateAll(now: number): string[] {
    const ruleIds = this.#sqlite
      .prepare("SELECT id FROM rules WHERE status = 'active' ORDER BY id")
      .all() as Array<{ id: string }>;
    return ruleIds.flatMap(({ id }) =>
      this.evaluateElimination(id, null, now) ? [id] : [],
    );
  }

  recomputeAllPopularity(now: number): void {
    const ruleIds = this.#sqlite
      .prepare('SELECT id FROM rules ORDER BY id')
      .all() as Array<{ id: string }>;
    this.#sqlite.transaction(() => {
      for (const { id } of ruleIds) this.#recomputePopularity(id, now);
    })();
  }

  reinstate(ruleId: string, reason: string, now: number): boolean {
    if (reason.trim().length === 0 || reason.length > 500) return false;
    return this.#sqlite.transaction(() => {
      const elimination = this.#sqlite
        .prepare(
          `SELECT id FROM rule_eliminations
           WHERE rule_id = ? AND reverted_at IS NULL
           ORDER BY eliminated_at DESC LIMIT 1`,
        )
        .get(ruleId) as { id: string } | undefined;
      if (!elimination) return false;
      const changed = this.#sqlite
        .prepare(
          `UPDATE rules
           SET status = 'active', disabled_reason = NULL, updated_at = ?
           WHERE id = ? AND status = 'removed'`,
        )
        .run(now, ruleId).changes;
      if (changed !== 1) return false;
      this.#sqlite
        .prepare(
          `UPDATE rule_eliminations
           SET reverted_at = ?, revert_reason = ? WHERE id = ?`,
        )
        .run(now, reason.trim(), elimination.id);
      return true;
    })();
  }

  settingNumber(key: keyof typeof DEFAULT_SETTINGS): number {
    const row = this.#sqlite
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    const value = Number(row?.value ?? DEFAULT_SETTINGS[key]);
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid numeric setting: ${key}`);
    }
    return value;
  }

  setSetting(key: string, value: string, now: number): void {
    const numeric = Number(value);
    const valid =
      key === 'evaluation_ttl_ms'
        ? Number.isSafeInteger(numeric) && numeric >= 60_000
        : key === 'elimination_n_min'
          ? Number.isSafeInteger(numeric) && numeric >= 1
          : key === 'elimination_theta'
            ? numeric > 0 && numeric < 1
            : key === 'elimination_z'
              ? numeric > 0 && numeric <= 5
              : false;
    if (!valid) throw new Error(`Invalid setting value for ${key}`);
    this.#sqlite
      .prepare(
        `INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      .run(key, value, now);
  }

  eliminationParams(): EliminationParams {
    return {
      nMin: this.settingNumber('elimination_n_min'),
      theta: this.settingNumber('elimination_theta'),
      z: this.settingNumber('elimination_z'),
    };
  }

  #access(
    token: string | null,
    setId: string,
  ): AccessRow | null | 'unauthorized' | 'not_found' {
    if (!token) return 'unauthorized';
    const set = this.#sqlite
      .prepare('SELECT ended_at FROM game_sets WHERE id = ?')
      .get(setId) as { ended_at: number | null } | undefined;
    if (!set || set.ended_at === null) return 'not_found';
    const row = this.#sqlite
      .prepare(
        `SELECT u.user_id, g.ended_at
         FROM users u
         JOIN set_participants sp ON sp.user_id = u.user_id
         JOIN game_sets g ON g.id = sp.set_id
         WHERE u.user_token = ? AND sp.set_id = ?`,
      )
      .get(token, setId) as AccessRow | undefined;
    return row ?? null;
  }

  #state(userId: string, setId: string): EvaluationState {
    const rating = this.#sqlite
      .prepare(
        `SELECT rating FROM set_evaluations WHERE set_id = ? AND user_id = ?`,
      )
      .get(setId, userId) as { rating: SetRating } | undefined;
    const votes = this.#sqlite
      .prepare(
        `SELECT rule_id, vote FROM rule_evaluations
         WHERE set_id = ? AND user_id = ? ORDER BY rule_id`,
      )
      .all(setId, userId) as Array<{ rule_id: string; vote: RuleVote }>;
    return {
      setRating: rating?.rating ?? null,
      ruleVotes: votes.map((vote) => ({
        ruleId: vote.rule_id,
        vote: vote.vote,
      })),
    };
  }

  #recomputePopularity(ruleId: string, now: number): void {
    const rows = this.#sqlite
      .prepare(
        `SELECT vote, COUNT(*) AS count FROM (
           SELECT vote,
             ROW_NUMBER() OVER (
               PARTITION BY user_id ORDER BY updated_at DESC, id DESC
             ) AS row_number
           FROM rule_evaluations WHERE rule_id = ?
         ) WHERE row_number = 1 GROUP BY vote`,
      )
      .all(ruleId) as Array<{ vote: RuleVote; count: number }>;
    const up = rows.find(({ vote }) => vote === 'up')?.count ?? 0;
    const down = rows.find(({ vote }) => vote === 'down')?.count ?? 0;
    this.#sqlite
      .prepare(
        `UPDATE rules SET rating_up = ?, rating_down = ?,
           popularity_score = ?, popularity_updated_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(up, down, computePopularityScore(up, down), now, now, ruleId);
  }
}
