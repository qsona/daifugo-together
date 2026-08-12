import type Database from 'better-sqlite3';

import type {
  OperationsActivity,
  OperationsRepository,
} from '../operations/repository.js';

const PROPOSAL_STATUSES = [
  'screening',
  'implementing',
  'released',
  'rejected',
  'failed',
] as const;

type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface AdminOverview {
  generatedAt: number;
  windows: {
    last30m: OperationsActivity;
    last3h: OperationsActivity;
    last24h: OperationsActivity;
    today: OperationsActivity;
  };
  dailyGames: Array<{ date: string; games: number }>;
  proposals: {
    today: number;
    total: number;
    byStatus: Record<ProposalStatus, number>;
  };
  users: {
    total: number;
    registered: number;
    guests: number;
    today: number;
  };
  rules: { active: number };
  queue: { screening: number; implementation: number };
}

export interface AdminProposalItem {
  id: string;
  number: number | null;
  name: string;
  body: string;
  kind: 'local' | 'original';
  prefectureCode: string | null;
  status: ProposalStatus;
  reasonCode: string | null;
  reasonText: string | null;
  ruleId: string | null;
  attemptCount: number;
  createdAt: number;
  statusChangedAt: number;
  updatedAt: number;
  author: {
    id: string;
    displayName: string;
    registered: boolean;
  };
  pipeline: {
    phase: string;
    errorCode: string | null;
    updatedAt: number;
  } | null;
}

export interface AdminUserItem {
  id: string;
  displayName: string;
  registered: boolean;
  createdAt: number;
  registeredAt: number | null;
  standaloneSeenAt: number | null;
  suspendedUntil: number | null;
  proposalCount: number;
  setCount: number;
  completedSetCount: number;
  evaluationCount: number;
  lastPlayedAt: number | null;
}

export interface AdminPage<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

function pageParameters(input: { limit?: number; offset?: number }): {
  limit: number;
  offset: number;
} {
  const limit = input.limit ?? 100;
  const offset = input.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 200) {
    throw new Error('limit must be an integer between 1 and 200');
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error('offset must be a non-negative integer');
  }
  return { limit, offset };
}

export class AdminRepository {
  readonly #sqlite: Database.Database;
  readonly #operations: OperationsRepository;

  constructor(sqlite: Database.Database, operations: OperationsRepository) {
    this.#sqlite = sqlite;
    this.#operations = operations;
  }

  overview(now = Date.now()): AdminOverview {
    const jstOffset = 9 * 60 * 60 * 1_000;
    const day = 24 * 60 * 60 * 1_000;
    const today = Math.floor((now + jstOffset) / day) * day - jstOffset;
    const dailyGamesSince = today - 13 * day;
    const status = this.#operations.status(now, { limit: 1 });
    const counts = this.#sqlite
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM proposals
             WHERE created_at >= ? AND created_at < ?) AS proposals_today,
           (SELECT COUNT(*) FROM users) AS users_total,
           (SELECT COUNT(*) FROM users WHERE google_sub IS NOT NULL)
             AS users_registered,
           (SELECT COUNT(*) FROM users
             WHERE created_at >= ? AND created_at < ?) AS users_today,
           (SELECT COUNT(*) FROM rules WHERE status = 'active') AS active_rules`,
      )
      .get(today, now, today, now) as {
      proposals_today: number;
      users_total: number;
      users_registered: number;
      users_today: number;
      active_rules: number;
    };
    const dailyGameRows = this.#sqlite
      .prepare(
        `SELECT date(ended_at / 1000, 'unixepoch', '+9 hours') AS date,
                COALESCE(SUM(games_played), 0) AS games
         FROM game_sets
         WHERE ended_at >= ? AND ended_at < ?
         GROUP BY date
         ORDER BY date`,
      )
      .all(dailyGamesSince, now) as Array<{ date: string; games: number }>;
    const dailyGamesByDate = new Map(
      dailyGameRows.map((row) => [row.date, row.games]),
    );
    const dailyGames = Array.from({ length: 14 }, (_, index) => {
      const timestamp = dailyGamesSince + index * day;
      const date = new Date(timestamp + jstOffset).toISOString().slice(0, 10);
      return { date, games: dailyGamesByDate.get(date) ?? 0 };
    });
    return {
      generatedAt: now,
      windows: {
        last30m: this.#operations.activity(now - 30 * 60 * 1_000, now),
        last3h: this.#operations.activity(now - 3 * 60 * 60 * 1_000, now),
        last24h: this.#operations.activity(now - day, now),
        today: this.#operations.activity(today, now),
      },
      dailyGames,
      proposals: {
        today: counts.proposals_today,
        total: status.proposals.total,
        byStatus: status.proposals.byStatus,
      },
      users: {
        total: counts.users_total,
        registered: counts.users_registered,
        guests: counts.users_total - counts.users_registered,
        today: counts.users_today,
      },
      rules: { active: counts.active_rules },
      queue: {
        screening: status.proposals.byStatus.screening,
        implementation: status.proposals.byStatus.implementing,
      },
    };
  }

  proposals(input: {
    status?: string;
    query?: string;
    limit?: number;
    offset?: number;
  }): AdminPage<AdminProposalItem> {
    const { limit, offset } = pageParameters(input);
    const status = PROPOSAL_STATUSES.includes(input.status as ProposalStatus)
      ? (input.status as ProposalStatus)
      : null;
    const query = input.query?.trim().slice(0, 100) ?? '';
    const like = `%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    const where = `
      WHERE (? IS NULL OR p.status = ?)
        AND (? = '' OR p.name LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\'
          OR u.display_name LIKE ? ESCAPE '\\'
          OR CAST(p.proposal_number AS TEXT) = ?)`;
    const parameters = [
      status,
      status,
      query,
      like,
      like,
      like,
      query,
    ] as const;
    const total = (
      this.#sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM proposals p JOIN users u ON u.user_id = p.author_id
           ${where}`,
        )
        .get(...parameters) as { count: number }
    ).count;
    const rows = this.#sqlite
      .prepare(
        `SELECT p.id, p.proposal_number, p.name, p.body, p.kind,
                p.prefecture_code, p.status, p.reason_code, p.reason_text,
                p.rule_id, p.attempt_count, p.created_at,
                p.status_changed_at, p.updated_at,
                u.user_id AS author_id, u.display_name,
                u.google_sub IS NOT NULL AS author_registered,
                pj.phase AS pipeline_phase, pj.error_code AS pipeline_error_code,
                pj.updated_at AS pipeline_updated_at
         FROM proposals p
         JOIN users u ON u.user_id = p.author_id
         LEFT JOIN pipeline_jobs pj ON pj.id = (
           SELECT MAX(pj2.id) FROM pipeline_jobs pj2
           WHERE pj2.proposal_id = p.id
         )
         ${where}
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...parameters, limit, offset) as Array<{
      id: string;
      proposal_number: number | null;
      name: string;
      body: string;
      kind: 'local' | 'original';
      prefecture_code: string | null;
      status: ProposalStatus;
      reason_code: string | null;
      reason_text: string | null;
      rule_id: string | null;
      attempt_count: number;
      created_at: number;
      status_changed_at: number;
      updated_at: number;
      author_id: string;
      display_name: string;
      author_registered: 0 | 1;
      pipeline_phase: string | null;
      pipeline_error_code: string | null;
      pipeline_updated_at: number | null;
    }>;
    return {
      total,
      limit,
      offset,
      items: rows.map((row) => ({
        id: row.id,
        number: row.proposal_number,
        name: row.name,
        body: row.body,
        kind: row.kind,
        prefectureCode: row.prefecture_code,
        status: row.status,
        reasonCode: row.reason_code,
        reasonText: row.reason_text,
        ruleId: row.rule_id,
        attemptCount: row.attempt_count,
        createdAt: row.created_at,
        statusChangedAt: row.status_changed_at,
        updatedAt: row.updated_at,
        author: {
          id: row.author_id,
          displayName: row.display_name,
          registered: row.author_registered === 1,
        },
        pipeline:
          row.pipeline_phase && row.pipeline_updated_at !== null
            ? {
                phase: row.pipeline_phase,
                errorCode: row.pipeline_error_code,
                updatedAt: row.pipeline_updated_at,
              }
            : null,
      })),
    };
  }

  users(input: {
    registration?: string;
    query?: string;
    limit?: number;
    offset?: number;
  }): AdminPage<AdminUserItem> {
    const { limit, offset } = pageParameters(input);
    const registration =
      input.registration === 'registered' || input.registration === 'guest'
        ? input.registration
        : 'all';
    const query = input.query?.trim().slice(0, 100) ?? '';
    const like = `%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    const where = `
      WHERE (? = 'all'
        OR (? = 'registered' AND u.google_sub IS NOT NULL)
        OR (? = 'guest' AND u.google_sub IS NULL))
        AND (? = '' OR u.display_name LIKE ? ESCAPE '\\'
          OR u.user_id LIKE ? ESCAPE '\\')`;
    const parameters = [
      registration,
      registration,
      registration,
      query,
      like,
      like,
    ] as const;
    const total = (
      this.#sqlite
        .prepare(`SELECT COUNT(*) AS count FROM users u ${where}`)
        .get(...parameters) as { count: number }
    ).count;
    const rows = this.#sqlite
      .prepare(
        `SELECT u.user_id, u.display_name, u.google_sub IS NOT NULL AS registered,
                u.created_at, u.registered_at, u.standalone_seen_at,
                u.proposal_suspended_until,
                (SELECT COUNT(*) FROM proposals p WHERE p.author_id = u.user_id)
                  AS proposal_count,
                (SELECT COUNT(*) FROM set_participants sp
                  WHERE sp.user_id = u.user_id) AS set_count,
                (SELECT COUNT(*) FROM set_participants sp
                  JOIN game_sets g ON g.id = sp.set_id
                  WHERE sp.user_id = u.user_id AND g.games_played >= 3)
                  AS completed_set_count,
                (SELECT COUNT(*) FROM set_evaluations se
                  WHERE se.user_id = u.user_id) AS evaluation_count,
                (SELECT MAX(g.started_at) FROM set_participants sp
                  JOIN game_sets g ON g.id = sp.set_id
                  WHERE sp.user_id = u.user_id) AS last_played_at
         FROM users u
         ${where}
         ORDER BY u.created_at DESC, u.user_id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...parameters, limit, offset) as Array<{
      user_id: string;
      display_name: string;
      registered: 0 | 1;
      created_at: number;
      registered_at: number | null;
      standalone_seen_at: number | null;
      proposal_suspended_until: number | null;
      proposal_count: number;
      set_count: number;
      completed_set_count: number;
      evaluation_count: number;
      last_played_at: number | null;
    }>;
    return {
      total,
      limit,
      offset,
      items: rows.map((row) => ({
        id: row.user_id,
        displayName: row.display_name,
        registered: row.registered === 1,
        createdAt: row.created_at,
        registeredAt: row.registered_at,
        standaloneSeenAt: row.standalone_seen_at,
        suspendedUntil: row.proposal_suspended_until,
        proposalCount: row.proposal_count,
        setCount: row.set_count,
        completedSetCount: row.completed_set_count,
        evaluationCount: row.evaluation_count,
        lastPlayedAt: row.last_played_at,
      })),
    };
  }
}
