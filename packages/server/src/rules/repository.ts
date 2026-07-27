import type Database from 'better-sqlite3';

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
    `);
  }

  transaction<T>(operation: () => T): T {
    return this.#sqlite.transaction(operation)();
  }

  register(input: RegisterRuleInput): StoredRule {
    this.#sqlite
      .prepare(
        `INSERT INTO rules (
           id, slug, name, description, kind, prefecture, proposal_id,
           status, disabled_reason, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  activeIds(): ReadonlySet<string> {
    return new Set(this.active().map(({ id }) => id));
  }

  active(): StoredRule[] {
    const rows = this.#sqlite
      .prepare(
        `SELECT * FROM rules
         WHERE status = 'active'
         ORDER BY created_at ASC, id ASC`,
      )
      .all() as RuleRow[];
    return rows.map(storedRule);
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
         SET status = ?, disabled_reason = ?, updated_at = ?
         WHERE id = ? AND status IN (${placeholders})`,
      )
      .run(
        input.nextStatus,
        input.disabledReason,
        input.now,
        input.ruleId,
        ...input.expectedStatuses,
      );
    return {
      changed: result.changes === 1,
      rule: this.get(input.ruleId),
    };
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
             is_current, created_at
           ) VALUES (?, ?, ?, ?, ?, 1, ?)
           ON CONFLICT(rule_id, version) DO UPDATE SET
             contract_version = excluded.contract_version,
             pr_number = excluded.pr_number,
             merge_sha = excluded.merge_sha,
             is_current = 1,
             reverted_at = NULL`,
        )
        .run(
          input.ruleId,
          input.version,
          input.contractVersion,
          input.prNumber,
          input.mergeSha,
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
