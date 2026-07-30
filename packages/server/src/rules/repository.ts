import type Database from 'better-sqlite3';

import { rulePrefectureCoverage } from './coverage.js';

export const RULE_STATUSES = ['active', 'disabled', 'removed'] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

export const RULE_DISABLED_REASONS = [
  'manual',
  'auto_incident',
  'rollback',
  'pending_enable',
] as const;
export type RuleDisabledReason = (typeof RULE_DISABLED_REASONS)[number];

export interface StoredRule {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: 'local' | 'original';
  prefecture: string | null;
  proposalId: string;
  status: RuleStatus;
  disabledReason: RuleDisabledReason | null;
  activatedAt: number | null;
  ratingUp: number;
  ratingDown: number;
  popularityScore: number;
  popularityUpdatedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface RegisterRuleInput {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: 'local' | 'original';
  prefecture: string | null;
  proposalId: string;
  status: RuleStatus;
  disabledReason: RuleDisabledReason | null;
  now: number;
}

export const RULE_INCIDENT_TYPES = [
  'exception',
  'invalid_effect',
  'load_failure',
] as const;
export type RuleIncidentType = (typeof RULE_INCIDENT_TYPES)[number];

export interface StoredRuleIncident {
  id: number;
  ruleId: string;
  setId: string | null;
  type: RuleIncidentType;
  detail: string | null;
  createdAt: number;
}

export interface StoredRuleVersion {
  id: number;
  ruleId: string;
  version: number;
  contractVersion: number;
  prNumber: number | null;
  mergeSha: string | null;
  bundleHash: string | null;
  isCurrent: boolean;
  revertedAt: number | null;
  createdAt: number;
}

export interface RuleLifecycleTransition {
  ruleId: string;
  expectedStatuses: readonly RuleStatus[];
  nextStatus: RuleStatus;
  disabledReason: RuleDisabledReason | null;
  now: number;
}

export interface RuleCatalogQuery {
  includeRemoved: boolean;
  prefecture?: string | 'none';
  status?: 'active' | 'removed';
  kind?: 'local' | 'original';
  sort: 'recent' | 'priority' | 'popularity';
  order: 'asc' | 'desc';
  limit: number;
  offset: number;
}

export interface RuleCatalogResult {
  summary: {
    implemented: number;
    active: number;
    removed: number;
    prefectureCoverage: number;
  };
  total: number;
  items: Array<StoredRule & { priorityRank: number | null }>;
}

export interface StoredConflictEvent {
  id: number;
  setId: string;
  gameIndex: number;
  playSeq: number;
  hook: string;
  conflictKey: string;
  adoptedRuleId: string;
  entries: unknown[];
  createdAt: number;
}

type RuleRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: StoredRule['kind'];
  prefecture: string | null;
  proposal_id: string;
  status: RuleStatus;
  disabled_reason: RuleDisabledReason | null;
  activated_at: number | null;
  rating_up: number;
  rating_down: number;
  popularity_score: number;
  popularity_updated_at: number | null;
  created_at: number;
  updated_at: number;
};

type RuleIncidentRow = {
  id: number;
  rule_id: string;
  set_id: string | null;
  type: RuleIncidentType;
  detail: string | null;
  created_at: number;
};

type RuleVersionRow = {
  id: number;
  rule_id: string;
  version: number;
  contract_version: number;
  pr_number: number | null;
  merge_sha: string | null;
  bundle_hash: string | null;
  is_current: number;
  reverted_at: number | null;
  created_at: number;
};

function storedRule(row: RuleRow): StoredRule {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    kind: row.kind,
    prefecture: row.prefecture,
    proposalId: row.proposal_id,
    status: row.status,
    disabledReason: row.disabled_reason,
    activatedAt: row.activated_at,
    ratingUp: row.rating_up,
    ratingDown: row.rating_down,
    popularityScore: row.popularity_score,
    popularityUpdatedAt: row.popularity_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function storedIncident(row: RuleIncidentRow): StoredRuleIncident {
  return {
    id: row.id,
    ruleId: row.rule_id,
    setId: row.set_id,
    type: row.type,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

function storedVersion(row: RuleVersionRow): StoredRuleVersion {
  return {
    id: row.id,
    ruleId: row.rule_id,
    version: row.version,
    contractVersion: row.contract_version,
    prNumber: row.pr_number,
    mergeSha: row.merge_sha,
    bundleHash: row.bundle_hash,
    isCurrent: row.is_current === 1,
    revertedAt: row.reverted_at,
    createdAt: row.created_at,
  };
}

export class RuleRepository {
  readonly #sqlite: Database.Database;

  constructor(sqlite: Database.Database) {
    this.#sqlite = sqlite;
    this.#sqlite.exec(`
      CREATE TABLE IF NOT EXISTS rules (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('local', 'original')),
        prefecture TEXT,
        proposal_id TEXT NOT NULL UNIQUE REFERENCES proposals(id),
        status TEXT NOT NULL
          CHECK (status IN ('active', 'disabled', 'removed')),
        disabled_reason TEXT
          CHECK (
            disabled_reason IS NULL OR disabled_reason IN (
              'manual', 'auto_incident', 'rollback', 'pending_enable'
            )
          ),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        CHECK (
          (status = 'disabled' AND disabled_reason IS NOT NULL)
          OR (status <> 'disabled' AND disabled_reason IS NULL)
        )
      );
      CREATE INDEX IF NOT EXISTS idx_rules_status
        ON rules(status, created_at, id);

      CREATE TABLE IF NOT EXISTS rule_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_id TEXT NOT NULL REFERENCES rules(id),
        version INTEGER NOT NULL,
        contract_version INTEGER NOT NULL,
        pr_number INTEGER,
        merge_sha TEXT,
        bundle_hash TEXT,
        is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
        reverted_at INTEGER,
        created_at INTEGER NOT NULL,
        UNIQUE (rule_id, version)
      );
      CREATE INDEX IF NOT EXISTS idx_rule_versions_current
        ON rule_versions(rule_id, is_current);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rule_versions_one_current
        ON rule_versions(rule_id) WHERE is_current = 1;

      CREATE TABLE IF NOT EXISTS rule_incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_id TEXT NOT NULL REFERENCES rules(id),
        set_id TEXT,
        type TEXT NOT NULL
          CHECK (type IN ('exception', 'invalid_effect', 'load_failure')),
        detail TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE (rule_id, set_id, type)
      );
      CREATE INDEX IF NOT EXISTS idx_rule_incidents_window
        ON rule_incidents(rule_id, created_at, set_id);
      CREATE TABLE IF NOT EXISTS conflict_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        set_id TEXT NOT NULL,
        game_index INTEGER NOT NULL,
        play_seq INTEGER NOT NULL,
        hook TEXT NOT NULL,
        conflict_key TEXT NOT NULL,
        adopted_rule_id TEXT NOT NULL,
        entries_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (set_id, game_index, play_seq, hook, conflict_key)
      );
      CREATE INDEX IF NOT EXISTS idx_conflict_events_set
        ON conflict_events(set_id, id);
      CREATE INDEX IF NOT EXISTS idx_conflict_events_rule
        ON conflict_events(adopted_rule_id, id);
    `);
    this.#ensureRuleColumns();
    const versionColumns = this.#sqlite
      .prepare("PRAGMA table_info('rule_versions')")
      .all() as Array<{ name: string }>;
    if (!versionColumns.some(({ name }) => name === 'bundle_hash')) {
      this.#sqlite.exec(
        'ALTER TABLE rule_versions ADD COLUMN bundle_hash TEXT',
      );
    }
  }

  transaction<T>(operation: () => T): T {
    return this.#sqlite.transaction(operation)();
  }

  register(input: RegisterRuleInput): StoredRule {
    this.#sqlite
      .prepare(
        `INSERT INTO rules (
           id, slug, name, description, kind, prefecture, proposal_id,
           status, disabled_reason, activated_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.slug,
        input.name,
        input.description,
        input.kind,
        input.prefecture,
        input.proposalId,
        input.status,
        input.disabledReason,
        input.status === 'active' ? input.now : null,
        input.now,
        input.now,
      );
    return this.get(input.id)!;
  }

  get(ruleId: string): StoredRule | null {
    const row = this.#sqlite
      .prepare('SELECT * FROM rules WHERE id = ?')
      .get(ruleId) as RuleRow | undefined;
    return row ? storedRule(row) : null;
  }

  updateMetadata(input: {
    ruleId: string;
    name: string;
    description: string;
    now: number;
  }): StoredRule {
    this.#sqlite
      .prepare(
        `UPDATE rules
         SET name = ?, description = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(input.name, input.description, input.now, input.ruleId);
    return this.get(input.ruleId)!;
  }

  activeIds(): ReadonlySet<string> {
    return new Set(this.active().map(({ id }) => id));
  }

  active(): StoredRule[] {
    const rows = this.#sqlite
      .prepare(
        `SELECT * FROM rules
         WHERE status = 'active'
         ORDER BY popularity_score DESC, activated_at ASC, id ASC`,
      )
      .all() as RuleRow[];
    return rows.map(storedRule);
  }

  catalog(query: RuleCatalogQuery): RuleCatalogResult {
    const visibleStatuses = query.includeRemoved
      ? "status IN ('active', 'removed')"
      : "status = 'active'";
    const conditions = [visibleStatuses];
    const parameters: Array<string | number> = [];
    if (query.status) {
      conditions.push('status = ?');
      parameters.push(query.status);
    }
    if (query.kind) {
      conditions.push('kind = ?');
      parameters.push(query.kind);
    }
    if (query.prefecture === 'none') {
      conditions.push("kind = 'local'");
      conditions.push('prefecture IS NULL');
    } else if (query.prefecture) {
      conditions.push('prefecture = ?');
      parameters.push(query.prefecture);
    }
    const where = conditions.join(' AND ');
    const summary = this.#sqlite
      .prepare(
        `SELECT
           COUNT(*) AS implemented,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN status = 'removed' THEN 1 ELSE 0 END) AS removed
         FROM rules
         WHERE ${visibleStatuses}`,
      )
      .get() as {
      implemented: number;
      active: number | null;
      removed: number | null;
    };
    const total = (
      this.#sqlite
        .prepare(`SELECT COUNT(*) AS total FROM rules WHERE ${where}`)
        .get(...parameters) as { total: number }
    ).total;
    const direction = query.order === 'asc' ? 'ASC' : 'DESC';
    const orderBy =
      query.sort === 'priority'
        ? `CASE WHEN status = 'active' THEN 0 ELSE 1 END ASC,
           popularity_score ${direction}, activated_at ASC, id ASC`
        : query.sort === 'popularity'
          ? `popularity_score ${direction}, activated_at ASC, id ASC`
          : `created_at ${direction}, id ${direction}`;
    const rows = this.#sqlite
      .prepare(
        `SELECT * FROM rules
         WHERE ${where}
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
      )
      .all(...parameters, query.limit, query.offset) as RuleRow[];
    return {
      summary: {
        implemented: summary.implemented,
        active: summary.active ?? 0,
        removed: summary.removed ?? 0,
        prefectureCoverage: rulePrefectureCoverage(
          this.#sqlite,
          query.includeRemoved,
        ),
      },
      total,
      items: rows.map((row) => {
        const rule = storedRule(row);
        const priorityRank =
          rule.status === 'active' ? this.#priorityRank(rule.id) : null;
        return { ...rule, priorityRank };
      }),
    };
  }

  /** 図鑑の 1 件取得。一覧の items と同じ形を返す。 */
  catalogItem(
    ruleId: string,
  ): (StoredRule & { priorityRank: number | null }) | null {
    const rule = this.get(ruleId);
    if (!rule) return null;
    return {
      ...rule,
      priorityRank:
        rule.status === 'active' ? this.#priorityRank(rule.id) : null,
    };
  }

  transition(input: RuleLifecycleTransition): {
    changed: boolean;
    rule: StoredRule | null;
  } {
    if (input.expectedStatuses.length === 0) {
      return { changed: false, rule: this.get(input.ruleId) };
    }
    const placeholders = input.expectedStatuses.map(() => '?').join(', ');
    const result = this.#sqlite
      .prepare(
        `UPDATE rules
         SET status = ?, disabled_reason = ?,
             activated_at = CASE
               WHEN ? = 'active' THEN COALESCE(activated_at, ?)
               ELSE activated_at
             END,
             updated_at = ?
         WHERE id = ?
           AND status IN (${placeholders})
           AND status <> 'removed'`,
      )
      .run(
        input.nextStatus,
        input.disabledReason,
        input.nextStatus,
        input.now,
        input.now,
        input.ruleId,
        ...input.expectedStatuses,
      );
    return {
      changed: result.changes === 1,
      rule: this.get(input.ruleId),
    };
  }

  priority(): Array<StoredRule & { priorityRank: number | null }> {
    const rows = this.#sqlite
      .prepare(
        `SELECT * FROM rules
         ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END,
           popularity_score DESC, activated_at ASC, id ASC`,
      )
      .all() as RuleRow[];
    let rank = 0;
    return rows.map((row) => {
      const rule = storedRule(row);
      if (rule.status === 'active') rank += 1;
      return {
        ...rule,
        priorityRank: rule.status === 'active' ? rank : null,
      };
    });
  }

  #priorityRank(ruleId: string): number | null {
    return (
      this.priority().find((rule) => rule.id === ruleId)?.priorityRank ?? null
    );
  }

  #ensureRuleColumns(): void {
    const columns = new Set(
      (
        this.#sqlite.prepare("PRAGMA table_info('rules')").all() as Array<{
          name: string;
        }>
      ).map(({ name }) => name),
    );
    const additions = [
      ['activated_at', 'INTEGER'],
      ['rating_up', 'INTEGER NOT NULL DEFAULT 0'],
      ['rating_down', 'INTEGER NOT NULL DEFAULT 0'],
      ['popularity_score', 'REAL NOT NULL DEFAULT 0.5'],
      ['popularity_updated_at', 'INTEGER'],
    ] as const;
    for (const [name, type] of additions) {
      if (!columns.has(name)) {
        this.#sqlite.exec(`ALTER TABLE rules ADD COLUMN ${name} ${type}`);
      }
    }
    this.#sqlite.exec(`
      UPDATE rules SET activated_at = created_at
      WHERE status = 'active' AND activated_at IS NULL
    `);
  }

  recordConflict(
    input: Omit<StoredConflictEvent, 'id' | 'createdAt'> & {
      now: number;
    },
  ): void {
    this.#sqlite
      .prepare(
        `INSERT OR IGNORE INTO conflict_events (
           set_id, game_index, play_seq, hook, conflict_key,
           adopted_rule_id, entries_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.setId,
        input.gameIndex,
        input.playSeq,
        input.hook,
        input.conflictKey,
        input.adoptedRuleId,
        JSON.stringify(input.entries),
        input.now,
      );
  }

  conflicts(
    query: {
      setId?: string;
      ruleId?: string;
      limit?: number;
    } = {},
  ): StoredConflictEvent[] {
    const conditions: string[] = [];
    const parameters: Array<string | number> = [];
    if (query.setId) {
      conditions.push('set_id = ?');
      parameters.push(query.setId);
    }
    if (query.ruleId) {
      conditions.push(`(adopted_rule_id = ? OR entries_json LIKE ?)`);
      parameters.push(query.ruleId, `%"ruleId":"${query.ruleId}"%`);
    }
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 1_000);
    const rows = this.#sqlite
      .prepare(
        `SELECT * FROM conflict_events
         ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
         ORDER BY id DESC LIMIT ?`,
      )
      .all(...parameters, limit) as Array<{
      id: number;
      set_id: string;
      game_index: number;
      play_seq: number;
      hook: string;
      conflict_key: string;
      adopted_rule_id: string;
      entries_json: string;
      created_at: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      setId: row.set_id,
      gameIndex: row.game_index,
      playSeq: row.play_seq,
      hook: row.hook,
      conflictKey: row.conflict_key,
      adoptedRuleId: row.adopted_rule_id,
      entries: JSON.parse(row.entries_json) as unknown[],
      createdAt: row.created_at,
    }));
  }

  snapshot(setId: string): Array<{
    ruleId: string;
    position: number;
    bundleHash: string;
    popularityScore: number;
  }> {
    try {
      return (
        this.#sqlite
          .prepare(
            `SELECT rule_id, position, bundle_hash, popularity_score
             FROM set_rules WHERE set_id = ? ORDER BY position`,
          )
          .all(setId) as Array<{
          rule_id: string;
          position: number;
          bundle_hash: string;
          popularity_score: number;
        }>
      ).map((row) => ({
        ruleId: row.rule_id,
        position: row.position,
        bundleHash: row.bundle_hash,
        popularityScore: row.popularity_score,
      }));
    } catch {
      return [];
    }
  }

  recordIncident(input: {
    ruleId: string;
    setId: string | null;
    type: RuleIncidentType;
    detail: string | null;
    now: number;
  }): { incident: StoredRuleIncident; inserted: boolean } {
    const insertion = this.#sqlite
      .prepare(
        `INSERT INTO rule_incidents (
           rule_id, set_id, type, detail, created_at
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(rule_id, set_id, type) DO NOTHING`,
      )
      .run(input.ruleId, input.setId, input.type, input.detail, input.now);
    const row = this.#sqlite
      .prepare(
        `SELECT * FROM rule_incidents
         WHERE rule_id = ? AND set_id IS ? AND type = ?
         ORDER BY id DESC LIMIT 1`,
      )
      .get(input.ruleId, input.setId, input.type) as RuleIncidentRow;
    return { incident: storedIncident(row), inserted: insertion.changes === 1 };
  }

  distinctIncidentSetsSince(ruleId: string, since: number): number {
    const row = this.#sqlite
      .prepare(
        `SELECT COUNT(DISTINCT set_id) AS count
         FROM rule_incidents
         WHERE rule_id = ? AND set_id IS NOT NULL AND created_at >= ?`,
      )
      .get(ruleId, since) as { count: number };
    return row.count;
  }

  incidents(ruleId: string): StoredRuleIncident[] {
    return (
      this.#sqlite
        .prepare(
          `SELECT * FROM rule_incidents
           WHERE rule_id = ? ORDER BY created_at ASC, id ASC`,
        )
        .all(ruleId) as RuleIncidentRow[]
    ).map(storedIncident);
  }

  registerVersion(input: {
    ruleId: string;
    version: number;
    contractVersion: number;
    prNumber: number | null;
    mergeSha: string | null;
    bundleHash: string;
    now: number;
  }): StoredRuleVersion {
    return this.transaction(() => {
      this.#sqlite
        .prepare(
          `UPDATE rule_versions SET is_current = 0
           WHERE rule_id = ? AND is_current = 1`,
        )
        .run(input.ruleId);
      this.#sqlite
        .prepare(
          `INSERT INTO rule_versions (
             rule_id, version, contract_version, pr_number, merge_sha,
             bundle_hash, is_current, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        )
        .run(
          input.ruleId,
          input.version,
          input.contractVersion,
          input.prNumber,
          input.mergeSha,
          input.bundleHash,
          input.now,
        );
      return this.versions(input.ruleId).find(
        ({ version }) => version === input.version,
      )!;
    });
  }

  versions(ruleId: string): StoredRuleVersion[] {
    return (
      this.#sqlite
        .prepare(
          `SELECT * FROM rule_versions
           WHERE rule_id = ? ORDER BY version DESC`,
        )
        .all(ruleId) as RuleVersionRow[]
    ).map(storedVersion);
  }

  currentVersion(ruleId: string): StoredRuleVersion | null {
    const row = this.#sqlite
      .prepare(
        `SELECT * FROM rule_versions
         WHERE rule_id = ? AND is_current = 1 AND reverted_at IS NULL`,
      )
      .get(ruleId) as RuleVersionRow | undefined;
    return row ? storedVersion(row) : null;
  }

  attestLegacyBundle(input: {
    ruleId: string;
    version: number;
    contractVersion: number;
    prNumber: number;
    mergeSha: string;
    bundleHash: string;
  }): StoredRuleVersion | null {
    const result = this.#sqlite
      .prepare(
        `UPDATE rule_versions
         SET bundle_hash = ?
         WHERE rule_id = ? AND version = ? AND contract_version = ?
           AND pr_number = ? AND merge_sha = ?
           AND is_current = 1 AND reverted_at IS NULL AND bundle_hash IS NULL`,
      )
      .run(
        input.bundleHash,
        input.ruleId,
        input.version,
        input.contractVersion,
        input.prNumber,
        input.mergeSha,
      );
    return result.changes === 1 ? this.currentVersion(input.ruleId) : null;
  }

  markMissingCodeReverted(
    codeRuleIds: ReadonlySet<string>,
    now: number,
  ): StoredRule[] {
    return this.transaction(() => {
      const current = this.#sqlite
        .prepare(
          `SELECT DISTINCT rule_id FROM rule_versions
           WHERE is_current = 1 AND reverted_at IS NULL`,
        )
        .all() as Array<{ rule_id: string }>;
      const reverted: StoredRule[] = [];
      for (const { rule_id: ruleId } of current) {
        if (codeRuleIds.has(ruleId)) continue;
        this.#sqlite
          .prepare(
            `UPDATE rule_versions
             SET is_current = 0, reverted_at = ?
             WHERE rule_id = ? AND is_current = 1 AND reverted_at IS NULL`,
          )
          .run(now, ruleId);
        const transition = this.transition({
          ruleId,
          expectedStatuses: ['active', 'disabled'],
          nextStatus: 'disabled',
          disabledReason: 'rollback',
          now,
        });
        if (transition.rule) reverted.push(transition.rule);
      }
      return reverted;
    });
  }
}
