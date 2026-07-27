import type {
  CardAppealStatus,
  YellowCardInfo,
  YellowCardStatus,
  YellowCardSummary,
} from '@daifugo/core';
import type Database from 'better-sqlite3';

import type { ProposalQueueQualification } from '../proposal/repository.js';
import type { DetectionResult, StaticAnalysisResult } from './detector.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
const CARD_EXPIRY_MS = 3 * DAY_MS;
const SUSPENSION_MS = DAY_MS;

type ActiveCardRow = { id: number };

export interface OpenCardAppeal {
  appealId: number;
  cardId: number;
  userId: string;
  comment: string | null;
  createdAt: number;
  inputText: string;
  finalVerdict: DetectionResult['finalVerdict'];
  llmVerdict: string;
  llmReason: string | null;
  llmEvidence: string | null;
}

export type RevokeCardResult = 'revoked' | 'not_found';
export type ConfirmCardResult =
  YellowCardInfo | 'not_found' | 'not_card' | 'suspended';

export interface StoredProposalSignals {
  proposalId: string;
  userId: string;
  detectorVersion: string;
  inputText: string;
  normalizedText: string;
  inputHash: string;
  layer0: StaticAnalysisResult['layers']['layer0'];
  layer1: StaticAnalysisResult['layers']['layer1'];
  layer2: StaticAnalysisResult['layers']['layer2'];
  createdAt: number;
}

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
        response_json TEXT,
        review_flag INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_proposal_checks_proposal
        ON proposal_checks(proposal_id, final_verdict);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_proposal_checks_unique_proposal
        ON proposal_checks(proposal_id);

      CREATE TABLE IF NOT EXISTS proposal_signal_checks (
        proposal_id TEXT PRIMARY KEY REFERENCES proposals(id),
        user_id TEXT NOT NULL REFERENCES users(user_id),
        detector_version TEXT NOT NULL,
        input_text TEXT NOT NULL,
        normalized_text TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        layer0_flags TEXT NOT NULL,
        layer1_hits TEXT NOT NULL,
        layer2_flags TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

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
      CREATE UNIQUE INDEX IF NOT EXISTS idx_yellow_cards_check
        ON yellow_cards(check_id);

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

  recordSignals(
    result: StaticAnalysisResult,
    userId: string,
    proposalId: string,
    now: number,
  ): void {
    this.#sqlite
      .prepare(
        `INSERT INTO proposal_signal_checks (
           proposal_id, user_id, detector_version, input_text, normalized_text,
           input_hash, layer0_flags, layer1_hits, layer2_flags, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        now,
      );
  }

  recordVerdict(
    result: DetectionResult,
    userId: string,
    proposalId: string,
    now: number,
  ): { checkId: number; inserted: boolean } {
    const signals = this.signalsForProposal(proposalId);
    if (
      !signals ||
      signals.userId !== userId ||
      signals.inputHash !== result.inputHash
    ) {
      throw new Error('L3 verdict does not match recorded L0-L2 signals');
    }
    const llm = result.layers.llm;
    const insertion = this.#sqlite
      .prepare(
        `INSERT INTO proposal_checks (
           proposal_id, user_id, detector_version, input_text, normalized_text,
           input_hash, layer0_flags, layer1_hits, layer2_flags, llm_verdict,
           llm_reason, llm_evidence, llm_evidence_verified, llm_model,
           llm_latency_ms, final_verdict, review_flag, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(proposal_id) DO NOTHING`,
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
    const checkId = (
      this.#sqlite
        .prepare('SELECT id FROM proposal_checks WHERE proposal_id = ?')
        .get(proposalId) as { id: number }
    ).id;
    return { checkId, inserted: insertion.changes === 1 };
  }

  confirmCard(proposalId: string, now: number): ConfirmCardResult {
    return this.#sqlite.transaction(() => {
      const check = this.#sqlite
        .prepare(
          `SELECT id, user_id, final_verdict
           FROM proposal_checks WHERE proposal_id = ?`,
        )
        .get(proposalId) as
        | {
            id: number;
            user_id: string;
            final_verdict: DetectionResult['finalVerdict'];
          }
        | undefined;
      if (!check) return 'not_found';
      if (check.final_verdict !== 'block_card') return 'not_card';
      const existingCard = this.#sqlite
        .prepare('SELECT id FROM yellow_cards WHERE check_id = ?')
        .get(check.id) as { id: number } | undefined;
      if (existingCard) return this.#existingCardResponse(check.user_id, now);
      const suspended = this.#sqlite
        .prepare(
          `SELECT proposal_suspended_until AS value
           FROM users WHERE user_id = ?`,
        )
        .get(check.user_id) as { value: number | null } | undefined;
      if (suspended?.value && suspended.value > now) return 'suspended';
      this.#expireCards(check.user_id, now);
      this.#sqlite
        .prepare(
          `INSERT INTO yellow_cards (
             user_id, check_id, status, issued_at, expires_at
           ) VALUES (?, ?, 'active', ?, ?)`,
        )
        .run(check.user_id, check.id, now, now + CARD_EXPIRY_MS);
      return this.#cardResponse(check.user_id, now);
    })();
  }

  #cardResponse(userId: string, now: number): YellowCardInfo {
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
    return {
      verdict: 'card',
      card: { active: 2, limit: 2 },
      suspension: { level, endsAt },
    };
  }

  #existingCardResponse(userId: string, now: number): YellowCardInfo {
    const suspension = this.#sqlite
      .prepare(
        `SELECT level, ends_at FROM suspensions
         WHERE user_id = ? AND lifted_at IS NULL AND ends_at > ?
         ORDER BY id DESC LIMIT 1`,
      )
      .get(userId, now) as { level: number; ends_at: number } | undefined;
    if (suspension) {
      return {
        verdict: 'card',
        card: { active: 2, limit: 2 },
        suspension: { level: suspension.level, endsAt: suspension.ends_at },
      };
    }
    const active = (
      this.#sqlite
        .prepare(
          `SELECT COUNT(*) AS count FROM yellow_cards
           WHERE user_id = ? AND status = 'active' AND expires_at > ?`,
        )
        .get(userId, now) as { count: number }
    ).count;
    return {
      verdict: 'card',
      card: { active: active >= 2 ? 2 : 1, limit: 2 },
      suspension: null,
    };
  }

  signalsForProposal(proposalId: string): StoredProposalSignals | null {
    const row = this.#sqlite
      .prepare(
        `SELECT proposal_id, user_id, detector_version, input_text,
                normalized_text, input_hash, layer0_flags, layer1_hits,
                layer2_flags, created_at
         FROM proposal_signal_checks WHERE proposal_id = ?`,
      )
      .get(proposalId) as
      | {
          proposal_id: string;
          user_id: string;
          detector_version: string;
          input_text: string;
          normalized_text: string;
          input_hash: string;
          layer0_flags: string;
          layer1_hits: string;
          layer2_flags: string;
          created_at: number;
        }
      | undefined;
    return row
      ? {
          proposalId: row.proposal_id,
          userId: row.user_id,
          detectorVersion: row.detector_version,
          inputText: row.input_text,
          normalizedText: row.normalized_text,
          inputHash: row.input_hash,
          layer0: JSON.parse(
            row.layer0_flags,
          ) as StoredProposalSignals['layer0'],
          layer1: JSON.parse(
            row.layer1_hits,
          ) as StoredProposalSignals['layer1'],
          layer2: JSON.parse(
            row.layer2_flags,
          ) as StoredProposalSignals['layer2'],
          createdAt: row.created_at,
        }
      : null;
  }

  summary(userId: string, now: number): YellowCardSummary {
    this.#expireCards(userId, now);
    const cards = this.#sqlite
      .prepare(
        `SELECT yc.id, yc.issued_at, yc.status, yc.expires_at,
                ca.status AS appeal_status
         FROM yellow_cards yc
         LEFT JOIN card_appeals ca ON ca.card_id = yc.id
         WHERE yc.user_id = ?
         ORDER BY yc.issued_at DESC, yc.id DESC`,
      )
      .all(userId) as Array<{
      id: number;
      issued_at: number;
      status: YellowCardStatus;
      expires_at: number;
      appeal_status: CardAppealStatus | null;
    }>;
    const suspension = this.#sqlite
      .prepare(
        `SELECT level, starts_at, ends_at
         FROM suspensions
         WHERE user_id = ? AND lifted_at IS NULL AND ends_at > ?
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(userId, now) as
      { level: number; starts_at: number; ends_at: number } | undefined;
    return {
      active: cards.filter(({ status }) => status === 'active').length,
      limit: 2,
      cards: cards.map((card) => ({
        id: card.id,
        issuedAt: card.issued_at,
        status: card.status,
        expiresAt: card.expires_at,
        appeal:
          card.appeal_status === null ? null : { status: card.appeal_status },
      })),
      suspension: suspension
        ? {
            level: suspension.level,
            startsAt: suspension.starts_at,
            endsAt: suspension.ends_at,
          }
        : null,
    };
  }

  createAppeal(
    userId: string,
    cardId: number,
    comment: string | null,
    now: number,
  ): { appealId: number; status: 'open' } | 'not_found' | 'conflict' {
    const card = this.#sqlite
      .prepare('SELECT id FROM yellow_cards WHERE id = ? AND user_id = ?')
      .get(cardId, userId) as { id: number } | undefined;
    if (!card) return 'not_found';
    try {
      const inserted = this.#sqlite
        .prepare(
          `INSERT INTO card_appeals (
             card_id, user_id, comment, status, created_at
           ) VALUES (?, ?, ?, 'open', ?)`,
        )
        .run(cardId, userId, comment, now);
      return { appealId: Number(inserted.lastInsertRowid), status: 'open' };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('UNIQUE constraint failed')
      ) {
        return 'conflict';
      }
      throw error;
    }
  }

  listOpenAppeals(): OpenCardAppeal[] {
    const rows = this.#sqlite
      .prepare(
        `SELECT ca.id AS appeal_id, ca.card_id, ca.user_id, ca.comment,
                ca.created_at, pc.input_text, pc.final_verdict,
                pc.llm_verdict, pc.llm_reason, pc.llm_evidence
         FROM card_appeals ca
         JOIN yellow_cards yc ON yc.id = ca.card_id
         JOIN proposal_checks pc ON pc.id = yc.check_id
         WHERE ca.status = 'open'
         ORDER BY ca.created_at ASC, ca.id ASC`,
      )
      .all() as Array<{
      appeal_id: number;
      card_id: number;
      user_id: string;
      comment: string | null;
      created_at: number;
      input_text: string;
      final_verdict: DetectionResult['finalVerdict'];
      llm_verdict: string;
      llm_reason: string | null;
      llm_evidence: string | null;
    }>;
    return rows.map((row) => ({
      appealId: row.appeal_id,
      cardId: row.card_id,
      userId: row.user_id,
      comment: row.comment,
      createdAt: row.created_at,
      inputText: row.input_text,
      finalVerdict: row.final_verdict,
      llmVerdict: row.llm_verdict,
      llmReason: row.llm_reason,
      llmEvidence: row.llm_evidence,
    }));
  }

  revokeCard(cardId: number, note: string, now: number): RevokeCardResult {
    return this.#sqlite.transaction(() => {
      const card = this.#sqlite
        .prepare(`SELECT id, user_id, status FROM yellow_cards WHERE id = ?`)
        .get(cardId) as
        { id: number; user_id: string; status: YellowCardStatus } | undefined;
      if (!card) return 'not_found';
      if (card.status !== 'revoked') {
        this.#sqlite
          .prepare(
            `UPDATE yellow_cards
             SET status = 'revoked', revoked_at = ?, revoke_note = ?
             WHERE id = ?`,
          )
          .run(now, note, cardId);
      }
      this.#sqlite
        .prepare(
          `UPDATE card_appeals
           SET status = 'upheld', resolved_at = ?, resolver_note = ?
           WHERE card_id = ? AND status = 'open'`,
        )
        .run(now, note, cardId);

      const suspensions = this.#sqlite
        .prepare(
          `SELECT id, card_ids
           FROM suspensions
           WHERE user_id = ? AND lifted_at IS NULL AND ends_at > ?`,
        )
        .all(card.user_id, now) as Array<{ id: number; card_ids: string }>;
      const affected = suspensions.find((suspension) =>
        this.#parseCardIds(suspension.card_ids).includes(cardId),
      );
      if (!affected) return 'revoked';

      this.#sqlite
        .prepare(
          `UPDATE suspensions
           SET lifted_at = ?, lift_note = ?
           WHERE id = ?`,
        )
        .run(now, note, affected.id);
      this.#sqlite
        .prepare(
          `UPDATE users SET proposal_suspended_until = NULL
           WHERE user_id = ?`,
        )
        .run(card.user_id);
      for (const consumedId of this.#parseCardIds(affected.card_ids)) {
        if (consumedId === cardId) continue;
        this.#sqlite
          .prepare(
            `UPDATE yellow_cards
             SET status = CASE WHEN expires_at > ? THEN 'active' ELSE 'expired' END
             WHERE id = ? AND status = 'consumed'`,
          )
          .run(now, consumedId);
      }
      return 'revoked';
    })();
  }

  rejectAppeal(cardId: number, note: string, now: number): boolean {
    return (
      this.#sqlite
        .prepare(
          `UPDATE card_appeals
           SET status = 'rejected', resolved_at = ?, resolver_note = ?
           WHERE card_id = ? AND status = 'open'`,
        )
        .run(now, note, cardId).changes === 1
    );
  }

  #expireCards(userId: string, now: number): void {
    this.#sqlite
      .prepare(
        `UPDATE yellow_cards SET status = 'expired'
         WHERE user_id = ? AND status = 'active' AND expires_at <= ?`,
      )
      .run(userId, now);
  }

  #parseCardIds(value: string): number[] {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter(
          (candidate): candidate is number =>
            typeof candidate === 'number' && Number.isSafeInteger(candidate),
        )
      : [];
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

  checkForProposal(proposalId: string): StoredProposalCheck | null {
    const row = this.#sqlite
      .prepare(
        `SELECT id, proposal_id, user_id, input_text, final_verdict,
                llm_verdict, review_flag, created_at
         FROM proposal_checks WHERE proposal_id = ?`,
      )
      .get(proposalId) as
      | {
          id: number;
          proposal_id: string;
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

  checkCountForUser(userId: string): number {
    return (
      this.#sqlite
        .prepare(
          'SELECT COUNT(*) AS count FROM proposal_checks WHERE user_id = ?',
        )
        .get(userId) as { count: number }
    ).count;
  }

  cardCountForUser(userId: string): number {
    return (
      this.#sqlite
        .prepare('SELECT COUNT(*) AS count FROM yellow_cards WHERE user_id = ?')
        .get(userId) as { count: number }
    ).count;
  }
}
