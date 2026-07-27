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
    `);
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
    const rows = this.#sqlite
      .prepare(
        `SELECT id FROM rules
         WHERE status = 'active'
         ORDER BY created_at ASC, id ASC`,
      )
      .all() as Array<{ id: string }>;
    return new Set(rows.map(({ id }) => id));
  }

  setDisabled(
    ruleId: string,
    reason: Extract<RuleDisabledReason, 'manual' | 'rollback'>,
    now: number,
  ): StoredRule | null {
    this.#sqlite
      .prepare(
        `UPDATE rules
         SET status = 'disabled', disabled_reason = ?, updated_at = ?
         WHERE id = ? AND status <> 'removed'`,
      )
      .run(reason, now, ruleId);
    return this.get(ruleId);
  }

  setActive(ruleId: string, now: number): StoredRule | null {
    this.#sqlite
      .prepare(
        `UPDATE rules
         SET status = 'active', disabled_reason = NULL, updated_at = ?
         WHERE id = ? AND status <> 'removed'`,
      )
      .run(now, ruleId);
    return this.get(ruleId);
  }
}
