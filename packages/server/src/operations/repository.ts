import type Database from 'better-sqlite3';

const PROPOSAL_STATUSES = [
  'screening',
  'implementing',
  'released',
  'rejected',
  'failed',
] as const;
const PIPELINE_PHASES = [
  'queued',
  'implementing',
  'pr_open',
  'merged',
  'done',
  'failed',
] as const;
const L3_VERDICTS = ['pass', 'block_soft', 'block_card'] as const;
const JUDGEMENT_VERDICTS = ['approve', 'reject', 'needs_review'] as const;

type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
type PipelinePhase = (typeof PIPELINE_PHASES)[number];
type L3Verdict = (typeof L3_VERDICTS)[number];
type JudgementVerdict = (typeof JUDGEMENT_VERDICTS)[number];
type CountRow = { key: string | null; count: number };

export type ScreeningQueueStage =
  'awaiting_l3' | 'awaiting_cx01' | 'awaiting_developer_confirmation';

export interface OperationsStatus {
  generatedAt: number;
  proposals: {
    total: number;
    byStatus: Record<ProposalStatus, number>;
  };
  judgements: {
    l3: Record<L3Verdict, number>;
    cx01: Record<JudgementVerdict, number>;
    developer: Record<JudgementVerdict, number>;
  };
  pipeline: {
    total: number;
    byPhase: Record<PipelinePhase, number>;
    failuresByCode: Record<string, number>;
  };
  queue: {
    screening: Array<{
      proposalId: string;
      name: string;
      stage: ScreeningQueueStage;
      createdAt: number;
    }>;
    implementation: Array<{
      jobId: number;
      proposalId: string;
      name: string;
      phase: Exclude<PipelinePhase, 'done' | 'failed'>;
      attempt: number;
      createdAt: number;
      updatedAt: number;
    }>;
  };
}

export interface OperationsFunnel {
  cohort: {
    since: number;
    until: number;
  };
  total: number;
  byStatus: Record<ProposalStatus, number>;
  rejectionReasons: Record<string, number>;
  implementationFailures: Record<string, number>;
  judgementSignals: {
    l3: Record<L3Verdict, number>;
    cx01: Record<JudgementVerdict, number>;
    developer: Record<JudgementVerdict, number>;
  };
  rates: {
    /**
     * released / (released + rejected + failed).
     * D-4 が未決のため、単一の「採用率」ではなく分母を名前で固定する。
     */
    terminalOutcomes: number | null;
    /** released / 全投稿。進行中も分母に含む補助値。 */
    allSubmissions: number | null;
  };
}

function zeroRecord<const T extends readonly string[]>(
  keys: T,
): Record<T[number], number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<
    T[number],
    number
  >;
}

function fixedCounts<const T extends readonly string[]>(
  keys: T,
  rows: readonly CountRow[],
): Record<T[number], number> {
  const result = zeroRecord(keys);
  for (const row of rows) {
    if (row.key !== null && keys.includes(row.key)) {
      result[row.key as T[number]] = row.count;
    }
  }
  return result;
}

function openCounts(rows: readonly CountRow[]): Record<string, number> {
  return Object.fromEntries(
    rows.flatMap((row) =>
      row.key === null ? [] : ([[row.key, row.count]] as const),
    ),
  );
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export class OperationsRepository {
  readonly #sqlite: Database.Database;

  constructor(sqlite: Database.Database) {
    this.#sqlite = sqlite;
  }

  status(now = Date.now(), queueLimit = 20): OperationsStatus {
    if (!Number.isSafeInteger(queueLimit) || queueLimit <= 0) {
      throw new Error('queueLimit must be a positive integer');
    }
    const proposalRows = this.#group(
      'SELECT status AS key, COUNT(*) AS count FROM proposals GROUP BY status',
    );
    const jobRows = this.#group(
      'SELECT phase AS key, COUNT(*) AS count FROM pipeline_jobs GROUP BY phase',
    );
    const byStatus = fixedCounts(PROPOSAL_STATUSES, proposalRows);
    const byPhase = fixedCounts(PIPELINE_PHASES, jobRows);
    return {
      generatedAt: now,
      proposals: {
        total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
        byStatus,
      },
      judgements: {
        l3: fixedCounts(L3_VERDICTS, this.#latestL3()),
        cx01: fixedCounts(JUDGEMENT_VERDICTS, this.#latestJudgements('ai')),
        developer: fixedCounts(
          JUDGEMENT_VERDICTS,
          this.#latestJudgements('developer'),
        ),
      },
      pipeline: {
        total: Object.values(byPhase).reduce((sum, count) => sum + count, 0),
        byPhase,
        failuresByCode: openCounts(
          this.#group(
            `SELECT error_code AS key, COUNT(*) AS count
             FROM pipeline_jobs
             WHERE phase = 'failed'
             GROUP BY error_code
             ORDER BY error_code`,
          ),
        ),
      },
      queue: {
        screening: this.#screeningQueue(queueLimit),
        implementation: this.#implementationQueue(queueLimit),
      },
    };
  }

  funnel(since: number, until = Date.now()): OperationsFunnel {
    if (
      !Number.isSafeInteger(since) ||
      !Number.isSafeInteger(until) ||
      since < 0 ||
      until <= since
    ) {
      throw new Error('funnel requires a valid [since, until) range');
    }
    const parameters = [since, until] as const;
    const byStatus = fixedCounts(
      PROPOSAL_STATUSES,
      this.#group(
        `SELECT status AS key, COUNT(*) AS count
         FROM proposals
         WHERE created_at >= ? AND created_at < ?
         GROUP BY status`,
        parameters,
      ),
    );
    const total = Object.values(byStatus).reduce(
      (sum, count) => sum + count,
      0,
    );
    const terminal = byStatus.released + byStatus.rejected + byStatus.failed;
    return {
      cohort: { since, until },
      total,
      byStatus,
      rejectionReasons: openCounts(
        this.#group(
          `SELECT reason_code AS key, COUNT(*) AS count
           FROM proposals
           WHERE status = 'rejected'
             AND created_at >= ? AND created_at < ?
           GROUP BY reason_code
           ORDER BY reason_code`,
          parameters,
        ),
      ),
      implementationFailures: openCounts(
        this.#group(
          `SELECT pj.error_code AS key, COUNT(*) AS count
           FROM pipeline_jobs pj
           JOIN proposals p ON p.id = pj.proposal_id
           WHERE pj.phase = 'failed'
             AND p.created_at >= ? AND p.created_at < ?
           GROUP BY pj.error_code
           ORDER BY pj.error_code`,
          parameters,
        ),
      ),
      judgementSignals: {
        l3: fixedCounts(L3_VERDICTS, this.#latestL3(parameters)),
        cx01: fixedCounts(
          JUDGEMENT_VERDICTS,
          this.#latestJudgements('ai', parameters),
        ),
        developer: fixedCounts(
          JUDGEMENT_VERDICTS,
          this.#latestJudgements('developer', parameters),
        ),
      },
      rates: {
        terminalOutcomes: ratio(byStatus.released, terminal),
        allSubmissions: ratio(byStatus.released, total),
      },
    };
  }

  #group(sql: string, parameters: readonly number[] = []): CountRow[] {
    return this.#sqlite.prepare(sql).all(...parameters) as CountRow[];
  }

  #latestL3(parameters?: readonly [number, number]): CountRow[] {
    return this.#group(
      `SELECT pc.final_verdict AS key, COUNT(*) AS count
       FROM proposal_checks pc
       JOIN proposals p ON p.id = pc.proposal_id
       WHERE pc.id = (
         SELECT MAX(pc2.id)
         FROM proposal_checks pc2
         WHERE pc2.proposal_id = pc.proposal_id
       )
       ${parameters ? 'AND p.created_at >= ? AND p.created_at < ?' : ''}
       GROUP BY pc.final_verdict`,
      parameters,
    );
  }

  #latestJudgements(
    actor: 'ai' | 'developer',
    parameters?: readonly [number, number],
  ): CountRow[] {
    return this.#group(
      `SELECT j.verdict AS key, COUNT(*) AS count
       FROM judgements j
       JOIN proposals p ON p.id = j.proposal_id
       WHERE j.decided_by = '${actor}'
         AND j.id = (
           SELECT MAX(j2.id)
           FROM judgements j2
           WHERE j2.proposal_id = j.proposal_id
             AND j2.decided_by = '${actor}'
         )
       ${parameters ? 'AND p.created_at >= ? AND p.created_at < ?' : ''}
       GROUP BY j.verdict`,
      parameters,
    );
  }

  #screeningQueue(limit: number): OperationsStatus['queue']['screening'] {
    const rows = this.#sqlite
      .prepare(
        `SELECT p.id, p.name, p.created_at,
                (
                  SELECT pc.final_verdict
                  FROM proposal_checks pc
                  WHERE pc.proposal_id = p.id
                  ORDER BY pc.id DESC LIMIT 1
                ) AS final_verdict,
                (
                  SELECT j.verdict
                  FROM judgements j
                  WHERE j.proposal_id = p.id AND j.decided_by = 'ai'
                  ORDER BY j.id DESC LIMIT 1
                ) AS ai_verdict
         FROM proposals p
         WHERE p.status = 'screening'
         ORDER BY p.created_at ASC, p.id ASC
         LIMIT ?`,
      )
      .all(limit) as Array<{
      id: string;
      name: string;
      created_at: number;
      final_verdict: L3Verdict | null;
      ai_verdict: JudgementVerdict | null;
    }>;
    return rows.map((row) => ({
      proposalId: row.id,
      name: row.name,
      stage:
        row.final_verdict === null
          ? 'awaiting_l3'
          : row.final_verdict === 'pass' && row.ai_verdict === null
            ? 'awaiting_cx01'
            : 'awaiting_developer_confirmation',
      createdAt: row.created_at,
    }));
  }

  #implementationQueue(
    limit: number,
  ): OperationsStatus['queue']['implementation'] {
    return (
      this.#sqlite
        .prepare(
          `SELECT pj.id, pj.proposal_id, p.name, pj.phase, pj.attempt,
                  pj.created_at, pj.updated_at
           FROM pipeline_jobs pj
           JOIN proposals p ON p.id = pj.proposal_id
           WHERE pj.phase IN ('queued', 'implementing', 'pr_open', 'merged')
           ORDER BY pj.created_at ASC, pj.id ASC
           LIMIT ?`,
        )
        .all(limit) as Array<{
        id: number;
        proposal_id: string;
        name: string;
        phase: 'queued' | 'implementing' | 'pr_open' | 'merged';
        attempt: number;
        created_at: number;
        updated_at: number;
      }>
    ).map((row) => ({
      jobId: row.id,
      proposalId: row.proposal_id,
      name: row.name,
      phase: row.phase,
      attempt: row.attempt,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
}
