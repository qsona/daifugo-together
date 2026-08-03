import {
  notificationPresentation,
  type NotificationListResponse,
  type NotificationOpenedVia,
  type NotificationType,
  type NotificationView,
} from '@daifugo/core';
import type Database from 'better-sqlite3';

import { NOTIFICATION_TYPE_REGISTRY } from './registry.js';

type NotificationRow = {
  id: number;
  user_id: string;
  type: NotificationType;
  payload: string;
  dedupe_key: string;
  created_at: number;
  read_at: number | null;
  opened_at: number | null;
  opened_via: NotificationOpenedVia | null;
};

export interface AnnouncementView {
  id: number;
  title: string;
  body: string;
  url: string;
  createdBy: string;
  recipientCount: number;
  createdAt: number;
}

type AnnouncementRow = {
  id: number;
  title: string;
  body: string;
  url: string;
  created_by: string;
  recipient_count: number;
  created_at: number;
};

function parsedPayload(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function view(row: NotificationRow): NotificationView {
  const payload = parsedPayload(row.payload);
  const presentation = notificationPresentation(row.type, payload);
  return {
    id: row.id,
    type: row.type,
    payload,
    ...presentation,
    priority: NOTIFICATION_TYPE_REGISTRY[row.type].priority,
    createdAt: row.created_at,
    readAt: row.read_at,
    openedAt: row.opened_at,
    openedVia: row.opened_via,
  };
}

function announcementView(row: AnnouncementRow): AnnouncementView {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    url: row.url,
    createdBy: row.created_by,
    recipientCount: row.recipient_count,
    createdAt: row.created_at,
  };
}

export class NotificationRepository {
  readonly #sqlite: Database.Database;

  constructor(sqlite: Database.Database) {
    this.#sqlite = sqlite;
  }

  userIdForToken(token: string): string | null {
    const row = this.#sqlite
      .prepare('SELECT user_id FROM users WHERE user_token = ?')
      .get(token) as { user_id: string } | undefined;
    return row?.user_id ?? null;
  }

  create(input: {
    userId: string;
    type: Exclude<NotificationType, 'rule_debut' | 'announcement'>;
    payload: Readonly<Record<string, unknown>>;
    dedupeKey: string;
    now: number;
  }): { created: boolean; item: NotificationView } {
    const result = this.#sqlite
      .prepare(
        `INSERT OR IGNORE INTO notifications (
           user_id, type, payload, dedupe_key, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.userId,
        input.type,
        JSON.stringify(input.payload),
        input.dedupeKey,
        input.now,
      );
    const row = this.#sqlite
      .prepare(
        `SELECT * FROM notifications
         WHERE user_id = ? AND type = ? AND dedupe_key = ?`,
      )
      .get(input.userId, input.type, input.dedupeKey) as NotificationRow;
    return { created: result.changes === 1, item: view(row) };
  }

  createAnnouncement(input: {
    title: string;
    body: string;
    url: string;
    createdBy: string;
    now: number;
  }): {
    announcement: AnnouncementView;
    recipients: Array<{ userId: string; item: NotificationView }>;
  } {
    return this.#sqlite.transaction(() => {
      const recipientCount = (
        this.#sqlite.prepare('SELECT COUNT(*) AS count FROM users').get() as {
          count: number;
        }
      ).count;
      const inserted = this.#sqlite
        .prepare(
          `INSERT INTO announcements (
             title, body, url, created_by, recipient_count, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.title,
          input.body,
          input.url,
          input.createdBy,
          recipientCount,
          input.now,
        );
      const announcementId = Number(inserted.lastInsertRowid);
      const payload = JSON.stringify({
        announcementId,
        title: input.title,
        body: input.body,
        url: input.url,
      });
      this.#sqlite
        .prepare(
          `INSERT INTO notifications (
             user_id, type, payload, dedupe_key, created_at
           )
           SELECT user_id, 'announcement', ?, ?, ? FROM users`,
        )
        .run(payload, String(announcementId), input.now);
      const announcement = this.#sqlite
        .prepare('SELECT * FROM announcements WHERE id = ?')
        .get(announcementId) as AnnouncementRow;
      const rows = this.#sqlite
        .prepare(
          `SELECT * FROM notifications
           WHERE type = 'announcement' AND dedupe_key = ?`,
        )
        .all(String(announcementId)) as NotificationRow[];
      return {
        announcement: announcementView(announcement),
        recipients: rows.map((row) => ({
          userId: row.user_id,
          item: view(row),
        })),
      };
    })();
  }

  listAnnouncements(limit = 50): AnnouncementView[] {
    const rows = this.#sqlite
      .prepare(
        `SELECT * FROM announcements
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(limit) as AnnouncementRow[];
    return rows.map(announcementView);
  }

  materializeBroadcasts(userId: string, now: number): number {
    const user = this.#sqlite
      .prepare(
        `SELECT notifications_seeded_at, notifications_seeded_rule_id
         FROM users WHERE user_id = ?`,
      )
      .get(userId) as
      | {
          notifications_seeded_at: number | null;
          notifications_seeded_rule_id: string | null;
        }
      | undefined;
    if (!user) return 0;
    if (user.notifications_seeded_at === null) {
      this.#sqlite
        .prepare(
          `UPDATE users
           SET notifications_seeded_at = ?, notifications_seeded_rule_id = ''
           WHERE user_id = ?`,
        )
        .run(now, userId);
      return 0;
    }
    const rules = this.#sqlite
      .prepare(
        `SELECT r.id AS rule_id, r.name AS rule_name,
                r.activated_at, p.author_id
         FROM rules r
         JOIN proposals p ON p.id = r.proposal_id
         WHERE r.activated_at IS NOT NULL
           AND (
             r.activated_at > ?
             OR (
               r.activated_at = ?
               AND r.id > COALESCE(?, '')
             )
           )
         ORDER BY r.activated_at ASC, r.id ASC
         LIMIT 10`,
      )
      .all(
        user.notifications_seeded_at,
        user.notifications_seeded_at,
        user.notifications_seeded_rule_id,
      ) as Array<{
      rule_id: string;
      rule_name: string;
      activated_at: number;
      author_id: string;
    }>;
    if (rules.length === 0) return 0;
    const insert = this.#sqlite.prepare(
      `INSERT OR IGNORE INTO notifications (
         user_id, type, payload, dedupe_key, created_at
       ) VALUES (?, 'rule_debut', ?, ?, ?)`,
    );
    let created = 0;
    this.#sqlite.transaction(() => {
      for (const rule of rules) {
        if (rule.author_id === userId) continue;
        created += insert.run(
          userId,
          JSON.stringify({ ruleId: rule.rule_id, ruleName: rule.rule_name }),
          rule.rule_id,
          rule.activated_at,
        ).changes;
      }
      this.#sqlite
        .prepare(
          `UPDATE users
           SET notifications_seeded_at = ?, notifications_seeded_rule_id = ?
           WHERE user_id = ?`,
        )
        .run(rules.at(-1)!.activated_at, rules.at(-1)!.rule_id, userId);
    })();
    return created;
  }

  list(userId: string, now: number): NotificationListResponse {
    this.materializeBroadcasts(userId, now);
    const rows = this.#sqlite
      .prepare(
        `SELECT * FROM notifications
         WHERE user_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 50`,
      )
      .all(userId) as NotificationRow[];
    return { items: rows.map(view), unreadCount: this.unreadCount(userId) };
  }

  unreadCount(userId: string, now?: number): number {
    if (now !== undefined) this.materializeBroadcasts(userId, now);
    return (
      this.#sqlite
        .prepare(
          `SELECT COUNT(*) AS count FROM notifications
           WHERE user_id = ? AND read_at IS NULL`,
        )
        .get(userId) as { count: number }
    ).count;
  }

  markRead(userId: string, id: number, now: number): boolean {
    return (
      this.#sqlite
        .prepare(
          `UPDATE notifications SET read_at = COALESCE(read_at, ?)
           WHERE id = ? AND user_id = ?`,
        )
        .run(now, id, userId).changes === 1
    );
  }

  markOpened(
    userId: string,
    id: number,
    via: NotificationOpenedVia,
    now: number,
  ): boolean {
    return (
      this.#sqlite
        .prepare(
          `UPDATE notifications
           SET read_at = COALESCE(read_at, ?),
               opened_at = COALESCE(opened_at, ?),
               opened_via = COALESCE(opened_via, ?)
           WHERE id = ? AND user_id = ?`,
        )
        .run(now, now, via, id, userId).changes === 1
    );
  }

  markAllRead(userId: string, now: number): void {
    this.#sqlite
      .prepare(
        `UPDATE notifications SET read_at = ?
         WHERE user_id = ? AND read_at IS NULL`,
      )
      .run(now, userId);
  }

  staleReleasedCount(olderThan: number): number {
    return (
      this.#sqlite
        .prepare(
          `SELECT COUNT(DISTINCT user_id) AS count
           FROM notifications
           WHERE type = 'proposal_released'
             AND read_at IS NULL AND created_at <= ?`,
        )
        .get(olderThan) as { count: number }
    ).count;
  }
}
