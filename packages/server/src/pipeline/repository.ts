import { prefectureName } from '@daifugo/core';
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
  name: string;
  summary: string;
  hooks: string[];
  effects: string[];
  testPoints: string[];
  notes: string;
  source: {
    kind: 'local' | 'original';
    title: string;
    body: string;
  };
}

export interface RuleScaffoldMeta {
  slug: string;
  messages: Record<string, string>;
}

export interface JudgementInput {
  verdict: JudgementVerdict;
  rejectCategory: RejectCategory | null;
  rejectSubtype: string | null;
  reasonForUser: string | null;
  reasonInternal: string;
  spec: RuleSpecification | null;
  scaffoldMeta: RuleScaffoldMeta | null;
  confidence: number | null;
  decidedBy: 'ai' | 'developer';
  model: string | null;
  promptVersion: string | null;
  latencyMs: number | null;
  sourceCheckId: number | null;
  sourceJudgementId: number | null;
  runId: string | null;
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
  mergeSha: string | null;
  scaffoldSha: string | null;
  promptVersion: string | null;
  errorCode: string | null;
  errorNote: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface QueuedImplementation {
  job: PipelineJob;
  proposal: {
    id: string;
    kind: 'local' | 'original';
    prefectureCode: string | null;
    prefecture: string | null;
    name: string;
    body: string;
  };
  passedCheckId: number;
  approvedJudgementId: number;
  spec: RuleSpecification;
  scaffoldMeta: RuleScaffoldMeta;
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

export type PendingVerdictConfirmation =
  | {
      source: 'e6';
      proposal: {
        id: string;
        name: string;
        body: string;
      };
      check: StoredProposalCheck;
    }
  | {
      source: 'cx01';
      proposal: {
        id: string;
        name: string;
        body: string;
      };
      judgement: StoredJudgement;
    };

type JudgementRow = {
  id: number;
  proposal_id: string;
  verdict: JudgementVerdict;
  reject_category: RejectCategory | null;
  reject_subtype: string | null;
  reason_for_user: string | null;
  reason_internal: string;
  spec_json: string | null;
  scaffold_meta_json: string | null;
  confidence: number | null;
  decided_by: 'ai' | 'developer';
  model: string | null;
  prompt_version: string | null;
  latency_ms: number | null;
  source_check_id: number | null;
  source_judgement_id: number | null;
  run_id: string | null;
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
  merge_sha: string | null;
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
    scaffoldMeta:
      row.scaffold_meta_json === null
        ? null
        : (JSON.parse(row.scaffold_meta_json) as RuleScaffoldMeta),
    confidence: row.confidence,
    decidedBy: row.decided_by,
    model: row.model,
    promptVersion: row.prompt_version,
    latencyMs: row.latency_ms,
    sourceCheckId: row.source_check_id,
    sourceJudgementId: row.source_judgement_id,
    runId: row.run_id,
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
    mergeSha: row.merge_sha,
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
        scaffold_meta_json TEXT,
        confidence REAL,
        decided_by TEXT NOT NULL CHECK (decided_by IN ('ai', 'developer')),
        model TEXT,
        prompt_version TEXT,
        latency_ms INTEGER,
        source_check_id INTEGER REFERENCES proposal_checks(id),
        source_judgement_id INTEGER REFERENCES judgements(id),
        run_id TEXT,
        actor TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_judgements_proposal
        ON judgements(proposal_id, id DESC);
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
        merge_sha TEXT,
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
    const judgementColumns = this.#sqlite
      .prepare("PRAGMA table_info('judgements')")
      .all() as Array<{ name: string }>;
    if (!judgementColumns.some(({ name }) => name === 'scaffold_meta_json')) {
      this.#sqlite.exec(
        'ALTER TABLE judgements ADD COLUMN scaffold_meta_json TEXT',
      );
    }
    if (!judgementColumns.some(({ name }) => name === 'run_id')) {
      this.#sqlite.exec('ALTER TABLE judgements ADD COLUMN run_id TEXT');
    }
    const pipelineJobColumns = this.#sqlite
      .prepare("PRAGMA table_info('pipeline_jobs')")
      .all() as Array<{ name: string }>;
    if (!pipelineJobColumns.some(({ name }) => name === 'merge_sha')) {
      this.#sqlite.exec('ALTER TABLE pipeline_jobs ADD COLUMN merge_sha TEXT');
    }
    this.#sqlite.exec(`
      DROP INDEX IF EXISTS idx_judgements_ai_source_check;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_judgements_ai_run
        ON judgements(proposal_id, run_id)
        WHERE decided_by = 'ai' AND run_id IS NOT NULL;
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

  pendingConfirmations(limit = 100): PendingVerdictConfirmation[] {
    return this.#proposals
      .screeningForJudgment()
      .flatMap((proposal): PendingVerdictConfirmation[] => {
        const check = this.#injection.checkForProposal(proposal.id);
        if (!check) return [];
        if (
          (check.finalVerdict === 'block_soft' ||
            check.finalVerdict === 'block_card') &&
          !this.developerConfirmation(proposal.id, null, check.id)
        ) {
          return [
            {
              source: 'e6',
              proposal: {
                id: proposal.id,
                name: proposal.name,
                body: proposal.body,
              },
              check,
            },
          ];
        }
        const judgement = this.latestAiJudgement(proposal.id);
        if (
          check.finalVerdict === 'pass' &&
          judgement &&
          !this.developerConfirmation(proposal.id, judgement.id, null)
        ) {
          return [
            {
              source: 'cx01',
              proposal: {
                id: proposal.id,
                name: proposal.name,
                body: proposal.body,
              },
              judgement,
            },
          ];
        }
        return [];
      })
      .slice(0, limit);
  }

  existingRules(): Array<{ name: string; summary: string }> {
    const rows = this.#sqlite
      .prepare(
        `SELECT j.spec_json
         FROM pipeline_jobs pj
         JOIN judgements j ON j.proposal_id = pj.proposal_id
         WHERE pj.phase <> 'failed'
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
           scaffold_meta_json, model, prompt_version, latency_ms,
           source_check_id, source_judgement_id, run_id, actor, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        input.scaffoldMeta === null ? null : JSON.stringify(input.scaffoldMeta),
        input.model,
        input.promptVersion,
        input.latencyMs,
        input.sourceCheckId,
        input.sourceJudgementId,
        input.runId,
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

  aiJudgementForRun(proposalId: string, runId: string): StoredJudgement | null {
    const row = this.#sqlite
      .prepare(
        `SELECT * FROM judgements
         WHERE proposal_id = ? AND decided_by = 'ai' AND run_id = ?
         LIMIT 1`,
      )
      .get(proposalId, runId) as JudgementRow | undefined;
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
    const proposalNumber = (
      this.#sqlite
        .prepare(
          `SELECT proposal_number AS value
           FROM proposals WHERE id = ?`,
        )
        .get(proposalId) as { value: number | null } | undefined
    )?.value;
    if (proposalNumber === null || proposalNumber === undefined) {
      throw new Error('proposal_number_missing');
    }
    const ruleId = `r${String(proposalNumber).padStart(4, '0')}-${slug}`;
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

  activeJobs(): PipelineJob[] {
    return (
      this.#sqlite
        .prepare(
          `SELECT * FROM pipeline_jobs
           WHERE phase IN ('implementing', 'pr_open')
           ORDER BY created_at ASC, id ASC`,
        )
        .all() as PipelineJobRow[]
    ).map(storedJob);
  }

  nextQueued(): QueuedImplementation | null {
    const row = this.#sqlite
      .prepare(
        `SELECT pj.id AS job_id
         FROM pipeline_jobs pj
         JOIN proposal_checks pc ON pc.proposal_id = pj.proposal_id
         JOIN judgements j ON j.proposal_id = pj.proposal_id
         WHERE pj.phase = 'queued'
           AND pc.final_verdict = 'pass'
           AND pc.id = (
             SELECT MAX(pc2.id) FROM proposal_checks pc2
             WHERE pc2.proposal_id = pj.proposal_id
           )
           AND j.id = (
             SELECT MAX(j2.id) FROM judgements j2
             WHERE j2.proposal_id = pj.proposal_id
           )
           AND j.verdict = 'approve'
           AND j.decided_by = 'developer'
           AND j.spec_json IS NOT NULL
           AND j.scaffold_meta_json IS NOT NULL
         ORDER BY pj.created_at ASC, pj.id ASC
         LIMIT 1`,
      )
      .get() as { job_id: number } | undefined;
    return row ? this.implementation(row.job_id) : null;
  }

  implementation(jobId: number): QueuedImplementation | null {
    const row = this.#sqlite
      .prepare(
        `SELECT pj.id AS job_id, pc.id AS check_id, j.id AS judgement_id
         FROM pipeline_jobs pj
         JOIN proposal_checks pc ON pc.proposal_id = pj.proposal_id
         JOIN judgements j ON j.proposal_id = pj.proposal_id
         WHERE pj.id = ?
           AND pj.phase IN ('queued', 'implementing', 'pr_open', 'merged', 'done')
           AND pc.final_verdict = 'pass'
           AND pc.id = (
             SELECT MAX(pc2.id) FROM proposal_checks pc2
             WHERE pc2.proposal_id = pj.proposal_id
           )
           AND j.id = (
             SELECT MAX(j2.id) FROM judgements j2
             WHERE j2.proposal_id = pj.proposal_id
           )
           AND j.verdict = 'approve'
           AND j.decided_by = 'developer'
           AND j.spec_json IS NOT NULL
           AND j.scaffold_meta_json IS NOT NULL`,
      )
      .get(jobId) as
      { job_id: number; check_id: number; judgement_id: number } | undefined;
    if (!row) return null;
    const job = this.job(jobId);
    if (!job) return null;
    const proposal = this.#proposals.findById(job.proposalId);
    const judgement = this.judgement(row.judgement_id);
    if (!proposal || !judgement?.spec || !judgement.scaffoldMeta) return null;
    return {
      job,
      proposal: {
        id: proposal.id,
        kind: proposal.kind,
        prefectureCode: proposal.prefectureCode,
        prefecture: prefectureName(proposal.prefectureCode),
        name: proposal.name,
        body: proposal.body,
      },
      passedCheckId: row.check_id,
      approvedJudgementId: row.judgement_id,
      spec: judgement.spec,
      scaffoldMeta: judgement.scaffoldMeta,
    };
  }

  transitionJob(
    id: number,
    from: PipelineJob['phase'],
    to: PipelineJob['phase'],
    patch: {
      branch?: string;
      prNumber?: number;
      headSha?: string;
      mergeSha?: string;
      scaffoldSha?: string;
      promptVersion?: string;
      errorCode?: string;
      errorNote?: string;
    },
    now: number,
  ): PipelineJob | null {
    const result = this.#sqlite
      .prepare(
        `UPDATE pipeline_jobs
         SET phase = ?, branch = COALESCE(?, branch),
             pr_number = COALESCE(?, pr_number),
             head_sha = COALESCE(?, head_sha),
             merge_sha = COALESCE(?, merge_sha),
             scaffold_sha = COALESCE(?, scaffold_sha),
             prompt_version = COALESCE(?, prompt_version),
             error_code = ?, error_note = ?, updated_at = ?
         WHERE id = ? AND phase = ?`,
      )
      .run(
        to,
        patch.branch ?? null,
        patch.prNumber ?? null,
        patch.headSha ?? null,
        patch.mergeSha ?? null,
        patch.scaffoldSha ?? null,
        patch.promptVersion ?? null,
        patch.errorCode ?? null,
        patch.errorNote ?? null,
        now,
        id,
        from,
      );
    return result.changes === 1 ? this.job(id) : null;
  }

  retryJob(
    id: number,
    from: PipelineJob['phase'],
    expectedAttempt: number,
    now: number,
  ): PipelineJob | null {
    const result = this.#sqlite
      .prepare(
        `UPDATE pipeline_jobs
         SET phase = 'implementing', attempt = attempt + 1,
             branch = NULL, pr_number = NULL, head_sha = NULL, merge_sha = NULL,
             scaffold_sha = NULL, prompt_version = NULL,
             error_code = NULL, error_note = NULL, updated_at = ?
         WHERE id = ? AND phase = ? AND attempt = ? AND attempt < 2`,
      )
      .run(now, id, from, expectedAttempt);
    return result.changes === 1 ? this.job(id) : null;
  }

  screeningProposal(proposalId: string): ProposalQueueItem | null {
    return (
      this.#proposals
        .screeningForJudgment()
        .find(({ id }) => id === proposalId) ?? null
    );
  }
}
