import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// The dashboard must work before its matching server build is deployed. Send a
// read-only query to the existing Machine instead of depending on a new endpoint.
const REMOTE_SNAPSHOT_SCRIPT = String.raw`
const Database = require('better-sqlite3');
const db = new Database(process.env.DATABASE_PATH || '/data/daifugo.sqlite', { readonly: true });
const now = Date.now();
const jstOffset = 9 * 60 * 60 * 1000;
const day = 24 * 60 * 60 * 1000;
const today = Math.floor((now + jstOffset) / day) * day - jstOffset;
function activity(since) {
  const row = db.prepare(
    'SELECT ' +
    '(SELECT COUNT(*) FROM users WHERE created_at >= ? AND created_at < ?) newUsers,' +
    '(SELECT COUNT(*) FROM game_sets WHERE started_at >= ? AND started_at < ?) setsStarted,' +
    '(SELECT COUNT(*) FROM game_sets WHERE ended_at >= ? AND ended_at < ? AND games_played >= 3) completedSets,' +
    '(SELECT COUNT(*) FROM game_sets WHERE ended_at >= ? AND ended_at < ? AND games_played < 3) partialSets,' +
    '(SELECT COUNT(*) FROM game_sets WHERE started_at >= ? AND started_at < ? AND ended_at IS NULL) ongoingSets,' +
    '(SELECT COALESCE(SUM(games_played), 0) FROM game_sets WHERE ended_at >= ? AND ended_at < ?) gamesPlayed,' +
    '(SELECT COUNT(DISTINCT set_id) FROM replay_records WHERE created_at >= ? AND created_at < ?) actionSets,' +
    '(SELECT COUNT(*) FROM replay_records WHERE created_at >= ? AND created_at < ?) actions,' +
    '(SELECT COUNT(*) FROM set_evaluations WHERE created_at >= ? AND created_at < ?) evaluations'
  ).get(since, now, since, now, since, now, since, now, since, now, since, now, since, now, since, now, since, now);
  return { cohort: { since, until: now }, ...row };
}
const output = {
  generatedAt: now,
  windows: {
    last30m: activity(now - 30 * 60 * 1000),
    last3h: activity(now - 3 * 60 * 60 * 1000),
    today: activity(today)
  },
  rules: { active: db.prepare("SELECT COUNT(*) count FROM rules WHERE status = 'active'").get().count },
  funnel: { total: db.prepare('SELECT COUNT(*) count FROM proposals WHERE created_at >= ? AND created_at < ?').get(today, now).count },
  queue: {
    screening: { total: db.prepare("SELECT COUNT(*) count FROM proposals WHERE status = 'screening'").get().count },
    implementation: { total: db.prepare("SELECT COUNT(*) count FROM proposals WHERE status = 'implementing'").get().count }
  }
};
console.log(JSON.stringify(output));
`;

export const WINDOW_RANGES = {
  last30m: 30 * 60,
  last3h: 3 * 60 * 60,
  today: null,
} as const;

type WindowKey = keyof typeof WINDOW_RANGES;

export interface ActivitySnapshot {
  cohort: { since: number; until: number };
  newUsers: number;
  setsStarted: number;
  completedSets: number;
  partialSets: number;
  ongoingSets: number;
  gamesPlayed: number;
  actionSets: number;
  actions: number;
  evaluations: number;
}

export interface DatabaseDashboardSnapshot {
  generatedAt: number;
  windows: Record<WindowKey, ActivitySnapshot>;
  rules: { active: number };
  funnel: { total: number };
  queue: {
    screening: { total: number };
    implementation: { total: number };
  };
}

export interface TrafficWindow {
  responses: number;
  websocketConnections: number;
  byStatus: Record<string, number>;
}

interface PrometheusResponse {
  status?: string;
  data?: {
    result?: Array<{
      metric?: { status?: string };
      value?: [number, string];
    }>;
  };
}

export function parseLastJsonLine<T>(output: string): T {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index] ?? '') as T;
    } catch {
      // flyctl can print connection notices around the remote JSON payload.
    }
  }
  throw new Error('Fly.ioからJSON形式の集計結果を取得できませんでした');
}

export function trafficWindow(payload: PrometheusResponse): TrafficWindow {
  if (payload.status !== 'success' || !Array.isArray(payload.data?.result)) {
    throw new Error('Fly.ioのHTTPメトリクス応答が不正です');
  }
  const byStatus: Record<string, number> = {};
  for (const item of payload.data.result) {
    const status = item.metric?.status;
    const raw = item.value?.[1];
    const value = raw === undefined ? Number.NaN : Number(raw);
    if (!status || !Number.isFinite(value)) continue;
    byStatus[status] = Math.max(0, Math.round(value));
  }
  return {
    responses: Object.values(byStatus).reduce((sum, value) => sum + value, 0),
    websocketConnections: byStatus['101'] ?? 0,
    byStatus,
  };
}

function promLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

async function flyctl(
  arguments_: readonly string[],
  flyctlPath: string,
): Promise<string> {
  const { stdout } = await execFileAsync(flyctlPath, [...arguments_], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

export async function loadDatabaseDashboard(
  app: string,
  flyctlPath: string,
): Promise<DatabaseDashboardSnapshot> {
  const encoded = Buffer.from(REMOTE_SNAPSHOT_SCRIPT).toString('base64');
  const remoteCommand =
    `/bin/sh -lc 'cd /app/packages/server && ` +
    `node -e "eval(Buffer.from(\\"${encoded}\\",\\"base64\\").toString())"'`;
  const output = await flyctl(
    ['ssh', 'console', '--app', app, '--command', remoteCommand],
    flyctlPath,
  );
  return parseLastJsonLine<DatabaseDashboardSnapshot>(output);
}

async function prometheusWindow(
  app: string,
  organization: string,
  token: string,
  rangeSeconds: number,
): Promise<TrafficWindow> {
  const url = new URL(
    `https://api.fly.io/prometheus/${encodeURIComponent(organization)}/api/v1/query`,
  );
  url.searchParams.set(
    'query',
    `sum(increase(fly_edge_http_responses_count{app="${promLabel(app)}"}[${String(rangeSeconds)}s])) by (status)`,
  );
  const response = await fetch(url, {
    headers: { authorization: `FlyV1 ${token}` },
  });
  if (!response.ok) {
    throw new Error(
      `Fly.ioのHTTPメトリクス取得に失敗しました (${String(response.status)})`,
    );
  }
  return trafficWindow((await response.json()) as PrometheusResponse);
}

export async function loadTrafficDashboard(
  app: string,
  organization: string,
  flyctlPath: string,
  now = Date.now(),
): Promise<{ windows: Record<WindowKey, TrafficWindow> }> {
  const token = (await flyctl(['auth', 'token'], flyctlPath)).trim();
  if (!token) throw new Error('Fly.ioの認証トークンを取得できませんでした');
  const jstOffsetMs = 9 * 60 * 60 * 1_000;
  const dayMs = 24 * 60 * 60 * 1_000;
  const today = Math.floor((now + jstOffsetMs) / dayMs) * dayMs - jstOffsetMs;
  const todaySeconds = Math.max(1, Math.ceil((now - today) / 1_000));
  const [last30m, last3h, todayWindow] = await Promise.all([
    prometheusWindow(app, organization, token, WINDOW_RANGES.last30m),
    prometheusWindow(app, organization, token, WINDOW_RANGES.last3h),
    prometheusWindow(app, organization, token, todaySeconds),
  ]);
  return { windows: { last30m, last3h, today: todayWindow } };
}
