import type { YellowCardInfo } from '@daifugo/core';
import type Database from 'better-sqlite3';

import type { ProposalQueueQualification } from '../proposal/repository.js';
import type { DetectionResult } from './detector.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
const CARD_EXPIRY_MS = 3 * DAY_MS;
const SUSPENSION_MS = DAY_MS;

const SOFT_MESSAGES: Record<
  NonNullable<DetectionResult['softReasonKey']>,
  string
> = {
  invisible_chars: '提案を受け付けられませんでした。入力し直してください',
  format: 'コード・URL・長い英数字列は提案文に使えません',
  generic: '提案を受け付けられませんでした。表現を変えてください',
};

type ActiveCardRow = { id: number };

export interface StoredProposalCheck {
  id: number;
  proposalId: string | null;
  userId: string;
  inputText: string;
  finalVerdict: DetectionResult['finalVerdict'];
  llmVerdict: string;
  reviewFlag: boolean;
  createdAt: number;
}

export class InjectionRepository implements ProposalQueueQualification {
  readonly #sqlite: Database.Database;

  constructor(sqlite: Database.Database) {
    this.#sqlite = sqlite;
    const userColumns = this.#sqlite
      .prepare("PRAGMA table_info('users')")
      .all() as Array<{ name: string }>;
    if (!userColumns.some(({ name }) => name === 'proposal_suspended_until')) {
      this.#sqlite.exec(
        'ALTER TABLE users ADD COLUMN proposal_suspended_until INTEGER',
      );
    }
    this.#sqlite.exec(`
      CREATE TABLE IF NOT EXISTS proposal_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proposal_id TEXT REFERENCES proposals(id),
        user_id TEXT NOT NULL REFERENCES users(user_id),
        detector_version TEXT NOT NULL,
        input_text TEXT NOT NULL,
        normalized_text TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        layer0_flags TEXT NOT NULL,
        layer1_hits TEXT NOT NULL,
        layer2_flags TEXT NOT NULL,
        llm_verdict TEXT,
        llm_reason TEXT,
        llm_evidence TEXT,
        llm_evidence_verified INTEGER,
        llm_model TEXT,
        llm_latency_ms INTEGER,
        final_verdict TEXT NOT NULL
          CHECK (final_verdict IN ('pass', 'block_soft', 'block_card')),
        review_flag INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_proposal_checks_proposal
        ON proposal_checks(proposal_id, final_verdict);
      CREATE INDEX IF NOT EXISTS idx_proposal_checks_cache
        ON proposal_checks(user_id, input_hash, created_at DESC);

      CREATE TABLE IF NOT EXISTS yellow_cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(user_id),
        check_id INTEGER NOT NULL REFERENCES proposal_checks(id),
        status TEXT NOT NULL
          CHECK (status IN ('active', 'consumed', 'expired', 'revoked')),
        issued_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER,
        revoke_note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_yellow_cards_user
        ON yellow_cards(user_id, status, expires_at);

      CREATE TABLE IF NOT EXISTS suspensions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(user_id),
        level INTEGER NOT NULL,
        card_ids TEXT NOT NULL,
        starts_at INTEGER NOT NULL,
        ends_at INTEGER NOT NULL,
        lifted_at INTEGER,
        lift_note TEXT
      );

      CREATE TABLE IF NOT EXISTS card_appeals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id INTEGER NOT NULL UNIQUE REFERENCES yellow_cards(id),
        user_id TEXT NOT NULL REFERENCES users(user_id),
        comment TEXT,
        status TEXT NOT NULL
          CHECK (status IN ('open', 'upheld', 'rejected')),
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        resolver_note TEXT
      );
    `);
  }

  commitCheck(
    result: DetectionResult,
    userId: string,
    proposalId: string | null,
    now: number,
  ): YellowCardInfo | null {
    const llm = result.layers.llm;
    const inserted = this.#sqlite
      .prepare(
        `INSERT INTO proposal_checks (
           proposal_id, user_id, detector_version, input_text, normalized_text,
           input_hash, layer0_flags, layer1_hits, layer2_flags, llm_verdict,
           llm_reason, llm_evidence, llm_evidence_verified, llm_model,
           llm_latency_ms, final_verdict, review_flag, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        proposalId,
        userId,
        result.detectorVersion,
        result.inputText,
        result.normalizedText,
        result.inputHash,
        JSON.stringify(result.layers.layer0),
        JSON.stringify(result.layers.layer1),
        JSON.stringify(result.layers.layer2),
        llm?.verdict ?? 'skipped',
        llm?.reason ?? null,
        llm?.evidence ?? null,
        llm ? Number(llm.evidenceVerified) : null,
        llm?.model ?? null,
        llm?.latencyMs ?? null,
        result.finalVerdict,
        Number(result.reviewFlag),
        now,
      );
    const checkId = Number(inserted.lastInsertRowid);

    if (result.finalVerdict === 'pass') return null;
    if (result.finalVerdict === 'block_soft') {
      const reasonKey = result.softReasonKey ?? 'generic';
      return {
        verdict: 'soft',
        reasonKey,
        message: SOFT_MESSAGES[reasonKey],
      };
    }

    const cardId = Number(
      this.#sqlite
        .prepare(
          `INSERT INTO yellow_cards (
             user_id, check_id, status, issued_at, expires_at
           ) VALUES (?, ?, 'active', ?, ?)`,
        )
        .run(userId, checkId, now, now + CARD_EXPIRY_MS).lastInsertRowid,
    );
    const activeCards = this.#sqlite
      .prepare(
        `SELECT id FROM yellow_cards
         WHERE user_id = ? AND status = 'active' AND expires_at > ?
         ORDER BY issued_at ASC, id ASC`,
      )
      .all(userId, now) as ActiveCardRow[];
    if (activeCards.length < 2) {
      return {
        verdict: 'card',
        card: { active: 1, limit: 2 },
        suspension: null,
      };
    }

    const consumedIds = activeCards.slice(0, 2).map(({ id }) => id);
    this.#sqlite
      .prepare(
        `UPDATE yellow_cards SET status = 'consumed'
         WHERE id IN (?, ?)`,
      )
      .run(consumedIds[0], consumedIds[1]);
    const levelRow = this.#sqlite
      .prepare(
        `SELECT COUNT(*) AS count FROM suspensions
         WHERE user_id = ? AND lifted_at IS NULL`,
      )
      .get(userId) as { count: number };
    const level = levelRow.count + 1;
    const endsAt = now + SUSPENSION_MS;
    this.#sqlite
      .prepare(
        `INSERT INTO suspensions (
           user_id, level, card_ids, starts_at, ends_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(userId, level, JSON.stringify(consumedIds), now, endsAt);
    this.#sqlite
      .prepare(
        `UPDATE users SET proposal_suspended_until = ? WHERE user_id = ?`,
      )
      .run(endsAt, userId);
    void cardId;
    return {
      verdict: 'card',
      card: { active: 2, limit: 2 },
      suspension: { level, endsAt },
    };
  }

  eligibleIds(candidates: readonly { id: string }[]): ReadonlySet<string> {
    if (candidates.length === 0) return new Set();
    const candidateIds = new Set(candidates.map(({ id }) => id));
    const rows = this.#sqlite
      .prepare(
        `SELECT proposal_id FROM proposal_checks
         WHERE final_verdict = 'pass' AND proposal_id IS NOT NULL`,
      )
      .all() as Array<{ proposal_id: string }>;
    return new Set(
      rows
        .map(({ proposal_id }) => proposal_id)
        .filter((id) => candidateIds.has(id)),
    );
  }

  latestCheckForUser(userId: string): StoredProposalCheck | null {
    const row = this.#sqlite
      .prepare(
        `SELECT id, proposal_id, user_id, input_text, final_verdict, llm_verdict,
                review_flag, created_at
         FROM proposal_checks
         WHERE user_id = ?
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(userId) as
      | {
          id: number;
          proposal_id: string | null;
          user_id: string;
          input_text: string;
          final_verdict: DetectionResult['finalVerdict'];
          llm_verdict: string;
          review_flag: number;
          created_at: number;
        }
      | undefined;
    return row
      ? {
          id: row.id,
          proposalId: row.proposal_id,
          userId: row.user_id,
          inputText: row.input_text,
          finalVerdict: row.final_verdict,
          llmVerdict: row.llm_verdict,
          reviewFlag: row.review_flag === 1,
          createdAt: row.created_at,
        }
      : null;
  }
}
