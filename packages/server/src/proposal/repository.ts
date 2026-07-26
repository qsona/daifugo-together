import { createHash, randomBytes } from 'node:crypto';

import {
  prefectureName,
  proposalDedupText,
  type NormalizedProposal,
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

export interface CreateStoredProposalOptions {
  authorId: string;
  proposal: NormalizedProposal;
  contentHash: string;
  now: number;
  id: string;
  commitInspection?: (proposalId: string) => void;
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

function toListItem(row: ProposalRow): ProposalListItem {
  const reason =
    row.reason_code === null
      ? null
      : {
          code: row.reason_code,
          text: row.reason_text ?? row.reason_code,
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
    unread: true,
    createdAt: row.created_at,
    statusChangedAt: row.status_changed_at,
  };
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

  create(options: CreateStoredProposalOptions): ProposalListItem {
    const transaction = this.#sqlite.transaction(() => {
      this.#sqlite
        .prepare(
          `INSERT INTO proposals (
             id, author_id, kind, prefecture_code, name, body, status,
             reason_code, reason_text, rule_id, attempt_count, content_hash,
             created_at, status_changed_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'screening', NULL, NULL, NULL, 0, ?, ?, ?, ?)`,
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
          options.now,
          options.now,
        );
      options.commitInspection?.(options.id);
      return this.#sqlite
        .prepare('SELECT * FROM proposals WHERE id = ?')
        .get(options.id) as ProposalRow;
    });
    return toListItem(transaction());
  }

  commitBlocked(commitInspection: () => void): void {
    this.#sqlite.transaction(commitInspection)();
  }

  queue(limit = 100): ProposalQueueItem[] {
    return (
      this.#sqlite
        .prepare(
          `SELECT id, author_id, kind, prefecture_code, name, body, created_at
           FROM proposals
           WHERE status = 'screening'
           ORDER BY created_at ASC, id ASC
           LIMIT ?`,
        )
        .all(limit) as Array<{
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
