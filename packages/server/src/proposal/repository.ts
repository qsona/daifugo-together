import { createHash, randomBytes } from 'node:crypto';

import {
  prefectureName,
  proposalDedupText,
  type NormalizedProposal,
  type MyProposalsResponse,
  type PrefectureCode,
  type ProposalKind,
  type ProposalListItem,
  type ProposalStatus,
} from '@daifugo/core';
import type Database from 'better-sqlite3';

type ProposalRow = {
  id: string;
  author_id: string;
  kind: ProposalKind;
  prefecture_code: PrefectureCode | null;
  name: string;
  body: string;
  status: ProposalStatus;
  reason_code: string | null;
  reason_text: string | null;
  rule_id: string | null;
  attempt_count: number;
  content_hash: string;
  created_at: number;
  status_changed_at: number;
  updated_at: number;
};

export interface ProposalQueueItem {
  id: string;
  authorId: string;
  kind: ProposalKind;
  prefectureCode: PrefectureCode | null;
  name: string;
  body: string;
  createdAt: number;
}

export interface StoredProposal extends ProposalQueueItem {
  status: ProposalStatus;
  reasonCode: string | null;
  reasonText: string | null;
  ruleId: string | null;
  attemptCount: number;
  statusChangedAt: number;
  updatedAt: number;
}

export interface ProposalTransitionPatch {
  reasonCode?: string;
  reasonText?: string;
  ruleId?: string;
}

export type ProposalTransitionResult = 'transitioned' | 'noop' | 'forbidden';

/**
 * E7 が処理してよい提案 ID だけを返す資格境界。
 *
 * E6 導入前に保存された screening 行には検査証跡がない。E7 は E6 の
 * proposalChecks を照合する実装を必ず注入し、未検査行を空振りさせる。
 * 引数を必須にすることで「照合を忘れて全 screening を処理」を表現不能にする。
 */
export interface ProposalQueueQualification {
  eligibleIds(candidates: readonly ProposalQueueItem[]): ReadonlySet<string>;
}

export interface CreateStoredProposalOptions {
  authorId: string;
  proposal: NormalizedProposal;
  contentHash: string;
  now: number;
  id: string;
  commitSignals: (proposalId: string) => void;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function createUlid(now = Date.now()): string {
  let timestamp = now;
  let timePart = '';
  for (let index = 0; index < 10; index += 1) {
    timePart = CROCKFORD[timestamp % 32]! + timePart;
    timestamp = Math.floor(timestamp / 32);
  }
  const bytes = randomBytes(10);
  let bits = 0;
  let bitCount = 0;
  let randomPart = '';
  for (const byte of bytes) {
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      randomPart += CROCKFORD[(bits >>> bitCount) & 31]!;
      bits &= (1 << bitCount) - 1;
    }
  }
  return timePart + randomPart;
}

export function proposalContentHash(proposal: NormalizedProposal): string {
  return createHash('sha256').update(proposalDedupText(proposal)).digest('hex');
}

function toListItem(row: ProposalRow, seenAt = 0): ProposalListItem {
  const reason =
    row.reason_code === null
      ? null
      : {
          code: row.reason_code,
          text: row.reason_text ?? '',
        };
  return {
    id: row.id,
    kind: row.kind,
    prefectureCode: row.prefecture_code,
    prefectureName: prefectureName(row.prefecture_code),
    name: row.name,
    body: row.body,
    status: row.status,
    reason,
    releasedRuleId: row.rule_id,
    popularity: null,
    priorityRank: null,
    unread: row.status_changed_at > seenAt,
    occupiesSlot:
      row.status === 'screening' ||
      row.status === 'implementing' ||
      (row.status === 'failed' && row.attempt_count === 0),
    createdAt: row.created_at,
    statusChangedAt: row.status_changed_at,
  };
}

function toStoredProposal(row: ProposalRow): StoredProposal {
  return {
    id: row.id,
    authorId: row.author_id,
    kind: row.kind,
    prefectureCode: row.prefecture_code,
    name: row.name,
    body: row.body,
    createdAt: row.created_at,
    status: row.status,
    reasonCode: row.reason_code,
    reasonText: row.reason_text,
    ruleId: row.rule_id,
    attemptCount: row.attempt_count,
    statusChangedAt: row.status_changed_at,
    updatedAt: row.updated_at,
  };
}

const ALLOWED_TRANSITIONS = new Set([
  'screening:implementing',
  'screening:rejected',
  'implementing:released',
  'implementing:failed',
]);

const REJECTION_REASON_CODES = new Set([
  'infeasible_technical',
  'breaks_game',
  'inappropriate',
  'duplicate_rule',
  'out_of_scope',
  'other',
]);

function validPatch(
  to: ProposalStatus,
  patch: ProposalTransitionPatch,
): boolean {
  const hasAnyReasonField =
    patch.reasonCode !== undefined || patch.reasonText !== undefined;
  const hasRuleIdField = patch.ruleId !== undefined;
  const hasReason =
    typeof patch.reasonCode === 'string' &&
    patch.reasonCode.trim().length > 0 &&
    typeof patch.reasonText === 'string' &&
    patch.reasonText.trim().length > 0;
  const hasRuleId =
    typeof patch.ruleId === 'string' && patch.ruleId.trim().length > 0;
  if (to === 'rejected') {
    return (
      hasReason &&
      REJECTION_REASON_CODES.has(patch.reasonCode!.trim()) &&
      !hasRuleIdField
    );
  }
  if (to === 'failed') {
    return (
      hasReason &&
      patch.reasonCode!.trim() === 'implementation_failed' &&
      !hasRuleIdField
    );
  }
  if (to === 'released') return hasRuleId && !hasAnyReasonField;
  return !hasAnyReasonField && !hasRuleIdField;
}

export class ProposalRepository {
  readonly #sqlite: Database.Database;

  constructor(sqlite: Database.Database) {
    this.#sqlite = sqlite;
  }

  authorIdForToken(token: string): string | null {
    const row = this.#sqlite
      .prepare('SELECT user_id FROM users WHERE user_token = ?')
      .get(token) as { user_id: string } | undefined;
    return row?.user_id ?? null;
  }

  isRegistered(authorId: string): boolean {
    const row = this.#sqlite
      .prepare('SELECT google_sub FROM users WHERE user_id = ?')
      .get(authorId) as { google_sub: string | null } | undefined;
    return row?.google_sub !== null && row?.google_sub !== undefined;
  }

  mine(authorId: string): MyProposalsResponse {
    const seenAt =
      (
        this.#sqlite
          .prepare(
            `SELECT COALESCE(proposals_seen_at, 0) AS seen_at
             FROM users WHERE user_id = ?`,
          )
          .get(authorId) as { seen_at: number } | undefined
      )?.seen_at ?? 0;
    const items = (
      this.#sqlite
        .prepare(
          `SELECT * FROM proposals
           WHERE author_id = ?
           ORDER BY created_at DESC, id DESC`,
        )
        .all(authorId) as ProposalRow[]
    ).map((row) => toListItem(row, seenAt));
    return {
      items,
      unreadCount: items.filter((item) => item.unread).length,
    };
  }

  markSeen(authorId: string, now: number): boolean {
    return (
      this.#sqlite
        .prepare(
          `UPDATE users
           SET proposals_seen_at = MAX(COALESCE(proposals_seen_at, 0), ?)
           WHERE user_id = ?`,
        )
        .run(now, authorId).changes === 1
    );
  }

  statusWatermark(authorId: string): number {
    return (
      this.#sqlite
        .prepare(
          `SELECT COALESCE(MAX(status_changed_at), 0) AS value
           FROM proposals
           WHERE author_id = ?`,
        )
        .get(authorId) as { value: number }
    ).value;
  }

  suspendedUntil(authorId: string): number | null {
    const hasColumn = (
      this.#sqlite.prepare("PRAGMA table_info('users')").all() as Array<{
        name: string;
      }>
    ).some((column) => column.name === 'proposal_suspended_until');
    if (!hasColumn) return null;
    const row = this.#sqlite
      .prepare(
        'SELECT proposal_suspended_until AS value FROM users WHERE user_id = ?',
      )
      .get(authorId) as { value: number | null } | undefined;
    return row?.value ?? null;
  }

  findInflight(authorId: string, contentHash: string): ProposalListItem | null {
    const row = this.#sqlite
      .prepare(
        `SELECT * FROM proposals
         WHERE author_id = ? AND content_hash = ?
           AND (
             status IN ('screening', 'implementing')
             OR (status = 'failed' AND attempt_count = 0)
           )
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(authorId, contentHash) as ProposalRow | undefined;
    return row ? toListItem(row) : null;
  }

  hasInflight(authorId: string): boolean {
    const row = this.#sqlite
      .prepare(
        `SELECT 1 FROM proposals
         WHERE author_id = ?
           AND (
             status IN ('screening', 'implementing')
             OR (status = 'failed' AND attempt_count = 0)
           )
         LIMIT 1`,
      )
      .get(authorId);
    return row !== undefined;
  }

  create(options: CreateStoredProposalOptions): ProposalListItem {
    const transaction = this.#sqlite.transaction(() => {
      const statusTimestamp = this.#nextStatusTimestamp(options.now);
      this.#sqlite
        .prepare(
          `INSERT INTO proposals (
             id, proposal_number, author_id, kind, prefecture_code, name, body, status,
             reason_code, reason_text, rule_id, attempt_count, content_hash,
             created_at, status_changed_at, updated_at
           ) VALUES (
             ?,
             (SELECT COALESCE(MAX(proposal_number), 0) + 1 FROM proposals),
             ?, ?, ?, ?, ?, 'screening', NULL, NULL, NULL, 0, ?, ?, ?, ?
           )`,
        )
        .run(
          options.id,
          options.authorId,
          options.proposal.kind,
          options.proposal.prefectureCode,
          options.proposal.name,
          options.proposal.body,
          options.contentHash,
          options.now,
          statusTimestamp,
          options.now,
        );
      options.commitSignals(options.id);
      return this.#sqlite
        .prepare('SELECT * FROM proposals WHERE id = ?')
        .get(options.id) as ProposalRow;
    });
    return toListItem(transaction());
  }

  findById(id: string): StoredProposal | null {
    const row = this.#sqlite
      .prepare('SELECT * FROM proposals WHERE id = ?')
      .get(id) as ProposalRow | undefined;
    return row ? toStoredProposal(row) : null;
  }

  transitionProposal(
    id: string,
    from: ProposalStatus,
    to: ProposalStatus,
    patch: ProposalTransitionPatch = {},
    now = Date.now(),
  ): ProposalTransitionResult {
    if (!ALLOWED_TRANSITIONS.has(`${from}:${to}`) || !validPatch(to, patch)) {
      return 'forbidden';
    }
    const failed = to === 'failed';
    const terminalReason = to === 'rejected' || to === 'failed';
    const released = to === 'released';
    const result = this.#sqlite.transaction(() => {
      const statusTimestamp = this.#nextStatusTimestamp(now);
      return this.#sqlite
        .prepare(
          `UPDATE proposals
           SET status = ?,
               status_changed_at = ?,
               updated_at = ?,
               attempt_count = CASE WHEN ? = 1 THEN 1 ELSE attempt_count END,
               reason_code = ?,
               reason_text = ?,
               rule_id = ?
           WHERE id = ? AND status = ?`,
        )
        .run(
          to,
          statusTimestamp,
          now,
          failed ? 1 : 0,
          terminalReason ? patch.reasonCode!.trim() : null,
          terminalReason ? patch.reasonText!.trim() : null,
          released ? patch.ruleId!.trim() : null,
          id,
          from,
        );
    })();
    return result.changes === 1 ? 'transitioned' : 'noop';
  }

  #nextStatusTimestamp(requested: number): number {
    const maximum = (
      this.#sqlite
        .prepare(
          'SELECT COALESCE(MAX(status_changed_at), -1) AS value FROM proposals',
        )
        .get() as { value: number }
    ).value;
    return Math.max(requested, maximum + 1);
  }

  /**
   * ローカル判定ツールが未判定の候補を列挙するための入口。
   *
   * E7 の実装キューではないため、E6 の最終判定による資格照合はここでは行わない。
   * 呼び出し側が proposal_signal_checks / proposal_checks を照合して未判定だけに絞る。
   */
  screeningForJudgment(): ProposalQueueItem[] {
    return this.#screeningCandidates();
  }

  queue(
    qualification: ProposalQueueQualification,
    limit = 100,
  ): ProposalQueueItem[] {
    const candidates = this.#screeningCandidates();
    const eligible = qualification.eligibleIds(candidates);
    return candidates
      .filter((candidate) => eligible.has(candidate.id))
      .slice(0, limit);
  }

  #screeningCandidates(): ProposalQueueItem[] {
    return (
      this.#sqlite
        .prepare(
          `SELECT id, author_id, kind, prefecture_code, name, body, created_at
           FROM proposals
           WHERE status = 'screening'
           ORDER BY created_at ASC, id ASC`,
        )
        .all() as Array<{
        id: string;
        author_id: string;
        kind: ProposalKind;
        prefecture_code: PrefectureCode | null;
        name: string;
        body: string;
        created_at: number;
      }>
    ).map((row) => ({
      id: row.id,
      authorId: row.author_id,
      kind: row.kind,
      prefectureCode: row.prefecture_code,
      name: row.name,
      body: row.body,
      createdAt: row.created_at,
    }));
  }
}
