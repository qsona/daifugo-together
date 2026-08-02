import { execFile } from 'node:child_process';
import { createServer } from 'node:http';

import { DASHBOARD_HTML } from './operations/dashboard-page.js';
import {
  loadDatabaseDashboard,
  loadTrafficDashboard,
} from './operations/dashboard-local.js';

const app = process.env.FLY_APP_NAME ?? 'daifugo-together';
const organization = process.env.FLY_ORG_SLUG ?? 'personal';
const flyctlPath = process.env.FLYCTL_PATH ?? 'flyctl';
const host = '127.0.0.1';
const port = Number(process.env.OPS_DASHBOARD_PORT ?? 4173);
const cacheMs = 45_000;

if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
  throw new Error('OPS_DASHBOARD_PORT must be an integer from 1 to 65535');
}

let cached:
  | {
      fetchedAt: number;
      value: unknown;
    }
  | undefined;
let pending: Promise<unknown> | undefined;

async function snapshot(force: boolean): Promise<unknown> {
  const now = Date.now();
  if (!force && cached && now - cached.fetchedAt < cacheMs) {
    return cached.value;
  }
  if (!pending) {
    pending = Promise.all([
      loadDatabaseDashboard(app, flyctlPath),
      loadTrafficDashboard(app, organization, flyctlPath, now),
    ])
      .then(([database, traffic]) => ({
        generatedAt: Date.now(),
        app,
        database,
        traffic,
      }))
      .then((value) => {
        cached = { fetchedAt: Date.now(), value };
        return value;
      })
      .finally(() => {
        pending = undefined;
      });
  }
  return pending;
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}:${String(port)}`);
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  if (url.pathname === '/') {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
    });
    response.end(DASHBOARD_HTML);
    return;
  }
  if (url.pathname === '/api/snapshot') {
    void snapshot(url.searchParams.get('force') === '1')
      .then((value) => {
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end(JSON.stringify(value));
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        response.writeHead(502, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end(JSON.stringify({ error: message }));
      });
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('Not found');
});

server.listen(port, host, () => {
  const url = `http://${host}:${String(port)}`;
  process.stdout.write(`運用ダッシュボード: ${url}\n`);
  process.stdout.write('終了するには Ctrl+C を押してください。\n');
  if (process.platform === 'darwin' && !process.argv.includes('--no-open')) {
    execFile('open', [url], () => undefined);
  }
});
