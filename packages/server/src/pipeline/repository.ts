import type Database from 'better-sqlite3';

import type {
  ProposalQueueItem,
  ProposalRepository,
} from '../proposal/repository.js';
import type {
  InjectionRepository,
  StoredProposalCheck,
  StoredProposalSignals,
} from '../injection/repository.js';

export const JUDGEMENT_VERDICTS = [
  'approve',
  'reject',
  'needs_review',
] as const;
export type JudgementVerdict = (typeof JUDGEMENT_VERDICTS)[number];

export const REJECT_CATEGORIES = [
  'contract',
  'game_breaking',
  'inappropriate',
  'duplicate',
  'unintelligible',
  'other',
] as const;
export type RejectCategory = (typeof REJECT_CATEGORIES)[number];

export interface RuleSpecification {
  specVersion: 1;
  slug: string;
  name: string;
  summary: string;
  hooks: string[];
  effects: string[];
  messages: Record<string, string>;
  testPoints: string[];
  notes: string;
  source: {
    kind: 'local' | 'original';
    title: string;
    body: string;
  };
}

export interface JudgementInput {
  verdict: JudgementVerdict;
  rejectCategory: RejectCategory | null;
  rejectSubtype: string | null;
  reasonForUser: string | null;
  reasonInternal: string;
  spec: RuleSpecification | null;
  confidence: number | null;
  decidedBy: 'ai' | 'developer';
  model: string | null;
  promptVersion: string | null;
  latencyMs: number | null;
  sourceCheckId: number | null;
  sourceJudgementId: number | null;
  actor: string | null;
  createdAt: number;
}

export interface StoredJudgement extends JudgementInput {
  id: number;
  proposalId: string;
}

export interface PipelineJob {
  id: number;
  proposalId: string;
  phase: 'queued' | 'implementing' | 'pr_open' | 'merged' | 'done' | 'failed';
  attempt: number;
  ciRerun: number;
  ruleId: string;
  slug: string;
  branch: string | null;
  prNumber: number | null;
  headSha: string | null;
  scaffoldSha: string | null;
  promptVersion: string | null;
  errorCode: string | null;
  errorNote: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PendingCxJudgement {
  proposal: {
    id: string;
    userId: string;
    kind: 'local' | 'original';
    prefectureCode: string | null;
    name: string;
    body: string;
  };
  signals: StoredProposalSignals;
  check: StoredProposalCheck;
  existingRules: Array<{ name: string; summary: string }>;
}

type JudgementRow = {
  id: number;
  proposal_id: string;
  verdict: JudgementVerdict;
  reject_category: RejectCategory | null;
  reject_subtype: string | null;
  reason_for_user: string | null;
  reason_internal: string;
  spec_json: string | null;
  confidence: number | null;
  decided_by: 'ai' | 'developer';
  model: string | null;
  prompt_version: string | null;
  latency_ms: number | null;
  source_check_id: number | null;
  source_judgement_id: number | null;
  actor: string | null;
  created_at: number;
};

type PipelineJobRow = {
  id: number;
  proposal_id: string;
  phase: PipelineJob['phase'];
  attempt: number;
  ci_rerun: number;
  rule_id: string;
  slug: string;
  branch: string | null;
  pr_number: number | null;
  head_sha: string | null;
  scaffold_sha: string | null;
  prompt_version: string | null;
  error_code: string | null;
  error_note: string | null;
  created_at: number;
  updated_at: number;
};

function storedJudgement(row: JudgementRow): StoredJudgement {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    verdict: row.verdict,
    rejectCategory: row.reject_category,
    rejectSubtype: row.reject_subtype,
    reasonForUser: row.reason_for_user,
    reasonInternal: row.reason_internal,
    spec:
      row.spec_json === null
        ? null
        : (JSON.parse(row.spec_json) as RuleSpecification),
    confidence: row.confidence,
    decidedBy: row.decided_by,
    model: row.model,
    promptVersion: row.prompt_version,
    latencyMs: row.latency_ms,
    sourceCheckId: row.source_check_id,
    sourceJudgementId: row.source_judgement_id,
    actor: row.actor,
    createdAt: row.created_at,
  };
}

function storedJob(row: PipelineJobRow): PipelineJob {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    phase: row.phase,
    attempt: row.attempt,
    ciRerun: row.ci_rerun,
    ruleId: row.rule_id,
    slug: row.slug,
    branch: row.branch,
    prNumber: row.pr_number,
    headSha: row.head_sha,
    scaffoldSha: row.scaffold_sha,
    promptVersion: row.prompt_version,
    errorCode: row.error_code,
    errorNote: row.error_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PipelineRepository {
  readonly #sqlite: Database.Database;
  readonly #proposals: ProposalRepository;
  readonly #injection: InjectionRepository;

  constructor(
    sqlite: Database.Database,
    proposals: ProposalRepository,
    injection: InjectionRepository,
  ) {
    this.#sqlite = sqlite;
    this.#proposals = proposals;
    this.#injection = injection;
    this.#sqlite.exec(`
      CREATE TABLE IF NOT EXISTS judgements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proposal_id TEXT NOT NULL REFERENCES proposals(id),
        verdict TEXT NOT NULL
          CHECK (verdict IN ('approve', 'reject', 'needs_review')),
        reject_category TEXT
          CHECK (
            reject_category IS NULL OR reject_category IN (
              'contract', 'game_breaking', 'inappropriate', 'duplicate',
              'unintelligible', 'other'
            )
          ),
        reject_subtype TEXT,
        reason_for_user TEXT,
        reason_internal TEXT NOT NULL,
        spec_json TEXT,
        confidence REAL,
        decided_by TEXT NOT NULL CHECK (decided_by IN ('ai', 'developer')),
        model TEXT,
        prompt_version TEXT,
        latency_ms INTEGER,
        source_check_id INTEGER REFERENCES proposal_checks(id),
        source_judgement_id INTEGER REFERENCES judgements(id),
        actor TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_judgements_proposal
        ON judgements(proposal_id, id DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_judgements_ai_source_check
        ON judgements(proposal_id, source_check_id)
        WHERE decided_by = 'ai';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_judgements_developer_source
        ON judgements(proposal_id, source_judgement_id, verdict)
        WHERE decided_by = 'developer' AND source_judgement_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_judgements_e6_confirmation
        ON judgements(proposal_id, source_check_id, verdict)
        WHERE decided_by = 'developer' AND source_check_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS pipeline_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proposal_id TEXT NOT NULL UNIQUE REFERENCES proposals(id),
        phase TEXT NOT NULL
          CHECK (
            phase IN (
              'queued', 'implementing', 'pr_open', 'merged', 'done', 'failed'
            )
          ),
        attempt INTEGER NOT NULL DEFAULT 1,
        ci_rerun INTEGER NOT NULL DEFAULT 0,
        rule_id TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL,
        branch TEXT,
        pr_number INTEGER,
        head_sha TEXT,
        scaffold_sha TEXT,
        prompt_version TEXT,
        error_code TEXT,
        error_note TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_phase
        ON pipeline_jobs(phase, created_at, id);
    `);
  }

  transaction<T>(operation: () => T): T {
    return this.#sqlite.transaction(operation)();
  }

  pendingCx(limit = 100): PendingCxJudgement[] {
    const existingRules = this.existingRules();
    return this.#proposals
      .screeningForJudgment()
      .flatMap((proposal) => {
        const signals = this.#injection.signalsForProposal(proposal.id);
        const check = this.#injection.checkForProposal(proposal.id);
        if (
          !signals ||
          !check ||
          check.finalVerdict !== 'pass' ||
          this.latestAiJudgement(proposal.id)
        ) {
          return [];
        }
        return [
          {
            proposal: {
              id: proposal.id,
              userId: proposal.authorId,
              kind: proposal.kind,
              prefectureCode: proposal.prefectureCode,
              name: proposal.name,
              body: proposal.body,
            },
            signals,
            check,
            existingRules,
          },
        ];
      })
      .slice(0, limit);
  }

  existingRules(): Array<{ name: string; summary: string }> {
    const rows = this.#sqlite
      .prepare(
        `SELECT j.spec_json
         FROM pipeline_jobs pj
         JOIN judgements j ON j.proposal_id = pj.proposal_id
         WHERE pj.phase IN ('merged', 'done')
           AND j.decided_by = 'developer'
           AND j.verdict = 'approve'
           AND j.spec_json IS NOT NULL
           AND j.id = (
             SELECT MAX(j2.id) FROM judgements j2
             WHERE j2.proposal_id = pj.proposal_id
               AND j2.decided_by = 'developer'
               AND j2.verdict = 'approve'
           )
         ORDER BY pj.id DESC
         LIMIT 100`,
      )
      .all() as Array<{ spec_json: string }>;
    return rows.map(({ spec_json }) => {
      const spec = JSON.parse(spec_json) as RuleSpecification;
      return { name: spec.name, summary: spec.summary };
    });
  }

  insertJudgement(proposalId: string, input: JudgementInput): StoredJudgement {
    const inserted = this.#sqlite
      .prepare(
        `INSERT INTO judgements (
           proposal_id, verdict, reject_category, reject_subtype,
           reason_for_user, reason_internal, spec_json, confidence, decided_by,
           model, prompt_version, latency_ms, source_check_id,
           source_judgement_id, actor, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        proposalId,
        input.verdict,
        input.rejectCategory,
        input.rejectSubtype,
        input.reasonForUser,
        input.reasonInternal,
        input.spec === null ? null : JSON.stringify(input.spec),
        input.confidence,
        input.decidedBy,
        input.model,
        input.promptVersion,
        input.latencyMs,
        input.sourceCheckId,
        input.sourceJudgementId,
        input.actor,
        input.createdAt,
      );
    return this.judgement(Number(inserted.lastInsertRowid))!;
  }

  judgement(id: number): StoredJudgement | null {
    const row = this.#sqlite
      .prepare('SELECT * FROM judgements WHERE id = ?')
      .get(id) as JudgementRow | undefined;
    return row ? storedJudgement(row) : null;
  }

  latestJudgement(proposalId: string): StoredJudgement | null {
    const row = this.#sqlite
      .prepare(
        'SELECT * FROM judgements WHERE proposal_id = ? ORDER BY id DESC LIMIT 1',
      )
      .get(proposalId) as JudgementRow | undefined;
    return row ? storedJudgement(row) : null;
  }

  latestAiJudgement(proposalId: string): StoredJudgement | null {
    const row = this.#sqlite
      .prepare(
        `SELECT * FROM judgements
         WHERE proposal_id = ? AND decided_by = 'ai'
         ORDER BY id DESC LIMIT 1`,
      )
      .get(proposalId) as JudgementRow | undefined;
    return row ? storedJudgement(row) : null;
  }

  developerConfirmation(
    proposalId: string,
    sourceJudgementId: number | null,
    sourceCheckId: number | null,
  ): StoredJudgement | null {
    const row = this.#sqlite
      .prepare(
        `SELECT * FROM judgements
         WHERE proposal_id = ? AND decided_by = 'developer'
           AND source_judgement_id IS ?
           AND source_check_id IS ?
         ORDER BY id DESC LIMIT 1`,
      )
      .get(proposalId, sourceJudgementId, sourceCheckId) as
      JudgementRow | undefined;
    return row ? storedJudgement(row) : null;
  }

  createQueuedJob(
    proposalId: string,
    slug: string,
    promptVersion: string | null,
    now: number,
  ): PipelineJob {
    const existing = this.jobForProposal(proposalId);
    if (existing) return existing;
    const sequence = (
      this.#sqlite
        .prepare(
          `SELECT COALESCE(
             MAX(CAST(SUBSTR(rule_id, 2) AS INTEGER)), 0
           ) + 1 AS value
           FROM pipeline_jobs
           WHERE rule_id GLOB 'r[0-9]*'`,
        )
        .get() as { value: number }
    ).value;
    const ruleId = `r${String(sequence).padStart(4, '0')}`;
    const insertion = this.#sqlite
      .prepare(
        `INSERT INTO pipeline_jobs (
           proposal_id, phase, attempt, ci_rerun, rule_id, slug,
           prompt_version, created_at, updated_at
         ) VALUES (?, 'queued', 1, 0, ?, ?, ?, ?, ?)`,
      )
      .run(proposalId, ruleId, slug, promptVersion, now, now);
    return this.job(Number(insertion.lastInsertRowid))!;
  }

  job(id: number): PipelineJob | null {
    const row = this.#sqlite
      .prepare('SELECT * FROM pipeline_jobs WHERE id = ?')
      .get(id) as PipelineJobRow | undefined;
    return row ? storedJob(row) : null;
  }

  jobForProposal(proposalId: string): PipelineJob | null {
    const row = this.#sqlite
      .prepare('SELECT * FROM pipeline_jobs WHERE proposal_id = ?')
      .get(proposalId) as PipelineJobRow | undefined;
    return row ? storedJob(row) : null;
  }

  screeningProposal(proposalId: string): ProposalQueueItem | null {
    return (
      this.#proposals
        .screeningForJudgment()
        .find(({ id }) => id === proposalId) ?? null
    );
  }
}
