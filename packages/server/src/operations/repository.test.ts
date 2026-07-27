import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

import { SqlitePersistence } from '../persistence.js';

const instances: Array<{
  directory: string;
  raw: Database.Database;
  persistence: SqlitePersistence;
}> = [];

afterEach(() => {
  for (const instance of instances.splice(0)) {
    instance.raw.close();
    instance.persistence.close();
    rmSync(instance.directory, { recursive: true, force: true });
  }
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'daifugo-ops-'));
  const path = join(directory, 'ops.sqlite');
  const persistence = new SqlitePersistence(path);
  const raw = new Database(path);
  instances.push({ directory, raw, persistence });
  raw
    .prepare(
      `INSERT INTO users (
         user_id, user_token, display_name, created_at
       ) VALUES ('user-1', 'token-0000000000000001', '運用者', 1)`,
    )
    .run();
  return { persistence, raw };
}

function proposal(
  raw: Database.Database,
  input: {
    id: string;
    number: number;
    name: string;
    status: 'screening' | 'implementing' | 'released' | 'rejected' | 'failed';
    createdAt: number;
    reasonCode?: string;
  },
): void {
  raw
    .prepare(
      `INSERT INTO proposals (
         id, proposal_number, author_id, kind, prefecture_code, name, body,
         status, reason_code, reason_text, rule_id, attempt_count, content_hash,
         created_at, status_changed_at, updated_at
       ) VALUES (?, ?, 'user-1', 'original', NULL, ?, '説明', ?, ?, ?,
                 NULL, 0, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.number,
      input.name,
      input.status,
      input.reasonCode ?? null,
      input.reasonCode ? '理由' : null,
      `hash-${input.id}`,
      input.createdAt,
      input.createdAt,
      input.createdAt,
    );
}

function check(
  raw: Database.Database,
  proposalId: string,
  verdict: 'pass' | 'block_soft' | 'block_card',
  createdAt: number,
): number {
  const result = raw
    .prepare(
      `INSERT INTO proposal_checks (
         proposal_id, user_id, detector_version, input_text, normalized_text,
         input_hash, layer0_flags, layer1_hits, layer2_flags, final_verdict,
         review_flag, created_at
       ) VALUES (?, 'user-1', 'v1', '入力', '入力', ?, '[]', '[]', '[]', ?,
                 0, ?)`,
    )
    .run(proposalId, `input-${proposalId}`, verdict, createdAt);
  return Number(result.lastInsertRowid);
}

function judgement(
  raw: Database.Database,
  input: {
    proposalId: string;
    verdict: 'approve' | 'reject' | 'needs_review';
    actor: 'ai' | 'developer';
    createdAt: number;
    sourceCheckId?: number;
    sourceJudgementId?: number;
  },
): number {
  const result = raw
    .prepare(
      `INSERT INTO judgements (
         proposal_id, verdict, reason_internal, decided_by,
         source_check_id, source_judgement_id, created_at
       ) VALUES (?, ?, '内部理由', ?, ?, ?, ?)`,
    )
    .run(
      input.proposalId,
      input.verdict,
      input.actor,
      input.sourceCheckId ?? null,
      input.sourceJudgementId ?? null,
      input.createdAt,
    );
  return Number(result.lastInsertRowid);
}

function job(
  raw: Database.Database,
  input: {
    proposalId: string;
    number: number;
    phase: 'queued' | 'implementing' | 'pr_open' | 'merged' | 'failed';
    attempt?: number;
    errorCode?: string;
    createdAt: number;
  },
): void {
  raw
    .prepare(
      `INSERT INTO pipeline_jobs (
         proposal_id, phase, attempt, ci_rerun, rule_id, slug, error_code,
         created_at, updated_at
       ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.proposalId,
      input.phase,
      input.attempt ?? 1,
      `r${String(input.number).padStart(4, '0')}-rule`,
      `rule-${String(input.number)}`,
      input.errorCode ?? null,
      input.createdAt,
      input.createdAt,
    );
}

function populatedFixture() {
  const value = fixture();
  const { raw } = value;
  proposal(raw, {
    id: 'p1',
    number: 1,
    name: 'L3待ち',
    status: 'screening',
    createdAt: 1_000,
  });
  proposal(raw, {
    id: 'p2',
    number: 2,
    name: 'CX待ち',
    status: 'screening',
    createdAt: 2_000,
  });
  check(raw, 'p2', 'pass', 2_100);
  proposal(raw, {
    id: 'p3',
    number: 3,
    name: '確認待ち',
    status: 'screening',
    createdAt: 3_000,
  });
  check(raw, 'p3', 'block_soft', 3_100);
  proposal(raw, {
    id: 'p4',
    number: 4,
    name: '採用済み',
    status: 'released',
    createdAt: 4_000,
  });
  const p4Check = check(raw, 'p4', 'pass', 4_100);
  judgement(raw, {
    proposalId: 'p4',
    verdict: 'needs_review',
    actor: 'ai',
    sourceCheckId: p4Check,
    createdAt: 4_150,
  });
  const p4Ai = judgement(raw, {
    proposalId: 'p4',
    verdict: 'approve',
    actor: 'ai',
    sourceCheckId: p4Check,
    createdAt: 4_200,
  });
  judgement(raw, {
    proposalId: 'p4',
    verdict: 'approve',
    actor: 'developer',
    sourceJudgementId: p4Ai,
    createdAt: 4_300,
  });
  proposal(raw, {
    id: 'p5',
    number: 5,
    name: '却下済み',
    status: 'rejected',
    reasonCode: 'inappropriate',
    createdAt: 5_000,
  });
  const p5Check = check(raw, 'p5', 'block_card', 5_100);
  judgement(raw, {
    proposalId: 'p5',
    verdict: 'reject',
    actor: 'developer',
    sourceCheckId: p5Check,
    createdAt: 5_200,
  });
  proposal(raw, {
    id: 'p6',
    number: 6,
    name: '実装失敗',
    status: 'failed',
    reasonCode: 'implementation_failed',
    createdAt: 6_000,
  });
  job(raw, {
    proposalId: 'p6',
    number: 6,
    phase: 'failed',
    errorCode: 'ci',
    createdAt: 6_100,
  });
  proposal(raw, {
    id: 'p7',
    number: 7,
    name: '実装待ち',
    status: 'implementing',
    createdAt: 7_000,
  });
  job(raw, {
    proposalId: 'p7',
    number: 7,
    phase: 'queued',
    createdAt: 7_100,
  });
  proposal(raw, {
    id: 'p8',
    number: 8,
    name: 'CX却下済み',
    status: 'rejected',
    reasonCode: 'breaks_game',
    createdAt: 7_500,
  });
  const p8Check = check(raw, 'p8', 'pass', 7_600);
  const p8Ai = judgement(raw, {
    proposalId: 'p8',
    verdict: 'reject',
    actor: 'ai',
    sourceCheckId: p8Check,
    createdAt: 7_700,
  });
  judgement(raw, {
    proposalId: 'p8',
    verdict: 'reject',
    actor: 'developer',
    sourceJudgementId: p8Ai,
    createdAt: 7_800,
  });
  return value;
}

describe('OperationsRepository', () => {
  test('現行の判定段階と実装キューを古い順で可視化する', () => {
    const { persistence } = populatedFixture();

    const status = persistence.operations.status(8_000);

    expect(status.generatedAt).toBe(8_000);
    expect(status.proposals).toEqual({
      total: 8,
      byStatus: {
        screening: 3,
        implementing: 1,
        released: 1,
        rejected: 2,
        failed: 1,
      },
    });
    expect(status.queue.screening).toMatchObject({
      total: 3,
      limit: 20,
      offset: 0,
      truncated: false,
    });
    expect(status.queue.screening.items).toEqual([
      {
        proposalId: 'p1',
        name: 'L3待ち',
        stage: 'awaiting_l3',
        createdAt: 1_000,
      },
      {
        proposalId: 'p2',
        name: 'CX待ち',
        stage: 'awaiting_cx01',
        createdAt: 2_000,
      },
      {
        proposalId: 'p3',
        name: '確認待ち',
        stage: 'awaiting_developer_confirmation',
        createdAt: 3_000,
      },
    ]);
    expect(status.queue.implementation.items).toEqual([
      expect.objectContaining({
        proposalId: 'p7',
        name: '実装待ち',
        phase: 'queued',
        attempt: 1,
      }),
    ]);
    expect(status.pipeline.byPhase).toMatchObject({ queued: 1, failed: 1 });
    expect(status.pipeline.failuresByCode).toEqual({ ci: 1 });
    expect(status.judgements).toEqual({
      l3: { pass: 3, block_soft: 1, block_card: 1 },
      cx01: { approve: 1, reject: 1, needs_review: 0 },
      developer: { approve: 1, reject: 2, needs_review: 0 },
      developerSources: {
        e6Rejected: 1,
        cx01Rejected: 1,
        specApproved: 1,
      },
    });
  });

  test('全投稿を一源で集計し、D-4を固定せず分母別の率を返す', () => {
    const { persistence } = populatedFixture();

    const funnel = persistence.operations.funnel(1_000, 8_000);

    expect(funnel.total).toBe(8);
    expect(Object.values(funnel.byStatus).reduce((sum, n) => sum + n, 0)).toBe(
      funnel.total,
    );
    expect(funnel.rejectionReasons).toEqual({
      breaks_game: 1,
      inappropriate: 1,
    });
    expect(funnel.implementationFailures).toEqual({ ci: 1 });
    expect(funnel.rates.terminalOutcomes).toBeCloseTo(1 / 4);
    expect(funnel.rates.allSubmissions).toBeCloseTo(1 / 8);
    expect(funnel.judgementSignals.l3).toEqual({
      pass: 3,
      block_soft: 1,
      block_card: 1,
    });
    expect(funnel.judgementSignals.developerSources).toEqual({
      e6Rejected: 1,
      cx01Rejected: 1,
      specApproved: 1,
    });
  });

  test('0件期間の率はnullになり、不正な期間は拒否する', () => {
    const { persistence } = fixture();

    expect(persistence.operations.funnel(1, 2).rates).toEqual({
      terminalOutcomes: null,
      allSubmissions: null,
    });
    expect(() => persistence.operations.funnel(2, 2)).toThrow(
      'funnel requires a valid [since, until) range',
    );
  });

  test('21件以上を切り捨てずページングし、同時刻はID順にする', () => {
    const { persistence, raw } = fixture();
    for (let index = 21; index >= 1; index -= 1) {
      proposal(raw, {
        id: `p${String(index).padStart(2, '0')}`,
        number: index,
        name: `提案${String(index)}`,
        status: 'screening',
        createdAt: 1_000,
      });
    }

    const first = persistence.operations.status(2_000, {
      limit: 20,
      offset: 0,
    }).queue.screening;
    const second = persistence.operations.status(2_000, {
      limit: 20,
      offset: 20,
    }).queue.screening;

    expect(first).toMatchObject({
      total: 21,
      limit: 20,
      offset: 0,
      truncated: true,
    });
    expect(first.items[0]?.proposalId).toBe('p01');
    expect(first.items[19]?.proposalId).toBe('p20');
    expect(second).toMatchObject({
      total: 21,
      limit: 20,
      offset: 20,
      truncated: false,
    });
    expect(second.items.map(({ proposalId }) => proposalId)).toEqual(['p21']);
  });

  test('全active phaseとretry attemptを実装キューに残す', () => {
    const { persistence, raw } = fixture();
    const phases = ['queued', 'implementing', 'pr_open', 'merged'] as const;
    phases.forEach((phase, index) => {
      const number = index + 1;
      proposal(raw, {
        id: `p${String(number)}`,
        number,
        name: phase,
        status: 'implementing',
        createdAt: 1_000 + index,
      });
      job(raw, {
        proposalId: `p${String(number)}`,
        number,
        phase,
        attempt: phase === 'implementing' ? 2 : 1,
        createdAt: 2_000 + index,
      });
    });

    const queue = persistence.operations.status(3_000).queue.implementation;

    expect(queue).toMatchObject({ total: 4, truncated: false });
    expect(queue.items.map(({ phase }) => phase)).toEqual(phases);
    expect(queue.items[1]?.attempt).toBe(2);
  });

  test('全内部failure codeと台帳欠損をfailed総数に一致させる', () => {
    const { persistence, raw } = fixture();
    const codes = [
      'infra',
      'codex_timeout',
      'codex_empty',
      'inspect_violation',
      'ci',
      'conflict',
    ];
    codes.forEach((errorCode, index) => {
      const number = index + 1;
      proposal(raw, {
        id: `p${String(number)}`,
        number,
        name: errorCode,
        status: 'failed',
        reasonCode: 'implementation_failed',
        createdAt: 1_000 + index,
      });
      job(raw, {
        proposalId: `p${String(number)}`,
        number,
        phase: 'failed',
        errorCode,
        createdAt: 2_000 + index,
      });
    });
    proposal(raw, {
      id: 'p7',
      number: 7,
      name: '旧台帳欠損',
      status: 'failed',
      reasonCode: 'implementation_failed',
      createdAt: 1_007,
    });

    const funnel = persistence.operations.funnel(1_000, 3_000);

    expect(funnel.implementationFailures).toEqual({
      ci: 1,
      codex_empty: 1,
      codex_timeout: 1,
      conflict: 1,
      infra: 1,
      inspect_violation: 1,
      unclassified: 1,
    });
    expect(
      Object.values(funnel.implementationFailures).reduce(
        (sum, count) => sum + count,
        0,
      ),
    ).toBe(funnel.byStatus.failed);
  });
});
