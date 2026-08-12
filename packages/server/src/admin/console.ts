import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AdminAuthService } from './auth.js';
import { ADMIN_DASHBOARD_HTML, adminLoginHtml } from './page.js';
import type { AdminRepository } from './repository.js';
import type { NotificationService } from '../notification/service.js';
import type { TrafficWindow } from '../operations/dashboard-local.js';
import type { RuleRegistryService } from '../rules/service.js';

const FLOW_COOKIE = '__Host-daifugo-admin-flow';
const SESSION_COOKIE = '__Host-daifugo-admin-session';
const SECURE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
} as const;

type TrafficSnapshot = {
  windows: Record<'last30m' | 'last3h' | 'last24h', TrafficWindow>;
};

type AdminRuleService = Pick<
  RuleRegistryService,
  'priority' | 'get' | 'enable'
>;

function sameValue(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function cookieValue(request: IncomingMessage, name: string): string | null {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key !== name) continue;
    try {
      return decodeURIComponent(value.join('='));
    } catch {
      return null;
    }
  }
  return null;
}

async function readFormBody(
  request: IncomingMessage,
  maxBytes = 8 * 1_024,
): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error('request_too_large');
    chunks.push(buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

async function readJsonBody(
  request: IncomingMessage,
  maxBytes = 8 * 1_024,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error('request_too_large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function announcementInput(body: unknown): {
  title: string;
  body: string;
  url: string;
} {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('invalid_announcement');
  }
  const record = body as Record<string, unknown>;
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  const message = typeof record.body === 'string' ? record.body.trim() : '';
  const rawUrl = typeof record.url === 'string' ? record.url.trim() : '';
  if (title.length === 0 || title.length > 80) {
    throw new Error('invalid_announcement_title');
  }
  if (message.length === 0 || message.length > 500) {
    throw new Error('invalid_announcement_body');
  }
  if (rawUrl.length > 500) throw new Error('invalid_announcement_url');
  const base = 'https://admin.invalid';
  let parsed: URL;
  try {
    parsed = new URL(rawUrl || '/notifications', base);
  } catch {
    throw new Error('invalid_announcement_url');
  }
  if (parsed.origin !== base) throw new Error('invalid_announcement_url');
  return {
    title,
    body: message,
    url: `${parsed.pathname}${parsed.search}${parsed.hash}`,
  };
}

function numericParameter(
  parameters: URLSearchParams,
  name: string,
): number | undefined {
  const raw = parameters.get(name);
  return raw !== null && /^\d+$/u.test(raw) ? Number(raw) : undefined;
}

export class AdminConsole {
  readonly #repository: AdminRepository;
  readonly #auth: AdminAuthService;
  readonly #basicUsername: string;
  readonly #basicPassword: string;
  readonly #traffic: (() => Promise<TrafficSnapshot>) | undefined;
  readonly #notifications:
    | Pick<NotificationService, 'publishAnnouncement' | 'listAnnouncements'>
    | undefined;
  readonly #rules: AdminRuleService | undefined;
  readonly #now: () => number;

  constructor(options: {
    repository: AdminRepository;
    auth: AdminAuthService;
    basicUsername: string;
    basicPassword: string;
    traffic?: () => Promise<TrafficSnapshot>;
    notifications?: Pick<
      NotificationService,
      'publishAnnouncement' | 'listAnnouncements'
    >;
    rules?: AdminRuleService;
    now?: () => number;
  }) {
    if (options.basicUsername.trim().length === 0) {
      throw new Error('Admin Basic username must not be empty');
    }
    if (options.basicPassword.length < 20) {
      throw new Error('Admin Basic password must be at least 20 characters');
    }
    this.#repository = options.repository;
    this.#auth = options.auth;
    this.#basicUsername = options.basicUsername;
    this.#basicPassword = options.basicPassword;
    this.#traffic = options.traffic;
    this.#notifications = options.notifications;
    this.#rules = options.rules;
    this.#now = options.now ?? Date.now;
  }

  async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const isCallback =
      url.pathname === '/auth/google/callback' &&
      cookieValue(request, FLOW_COOKIE) !== null;
    const isAdminPath =
      url.pathname === '/admin' ||
      url.pathname === '/admin/' ||
      url.pathname === '/admin/auth/google/begin' ||
      url.pathname === '/admin/logout' ||
      url.pathname.startsWith('/admin/api/');
    if (!isCallback && !isAdminPath) return false;
    this.#headers(response);

    if (isCallback) {
      await this.#callback(request, response);
      return true;
    }
    if (!this.#basicAuthorized(request)) {
      response.statusCode = 401;
      response.setHeader(
        'www-authenticate',
        'Basic realm="Daifugo Admin", charset="UTF-8"',
      );
      response.setHeader('content-type', 'text/plain; charset=utf-8');
      response.end('Authentication required');
      return true;
    }
    if (url.pathname === '/admin/auth/google/begin') {
      await this.#begin(request, response);
      return true;
    }
    if (url.pathname === '/admin/logout') {
      this.#logout(request, response);
      return true;
    }
    if (url.pathname.startsWith('/admin/api/')) {
      await this.#api(request, response, url);
      return true;
    }
    this.#page(request, response, url);
    return true;
  }

  #headers(response: ServerResponse): void {
    for (const [name, value] of Object.entries(SECURE_HEADERS)) {
      response.setHeader(name, value);
    }
    response.setHeader('cache-control', 'no-store');
  }

  #basicAuthorized(request: IncomingMessage): boolean {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Basic ')) return false;
    try {
      const decoded = Buffer.from(
        authorization.slice('Basic '.length),
        'base64',
      ).toString('utf8');
      const separator = decoded.indexOf(':');
      if (separator < 0) return false;
      return (
        sameValue(decoded.slice(0, separator), this.#basicUsername) &&
        sameValue(decoded.slice(separator + 1), this.#basicPassword)
      );
    } catch {
      return false;
    }
  }

  async #begin(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'POST') {
      this.#methodNotAllowed(response, 'GET, POST');
      return;
    }
    const result = await this.#auth.begin();
    if (result.status === 'unavailable') {
      response.statusCode = 303;
      response.setHeader('location', '/admin?auth=unavailable');
      response.end();
      return;
    }
    response.statusCode = 303;
    response.setHeader('location', result.authUrl);
    response.setHeader(
      'set-cookie',
      `${FLOW_COOKIE}=${encodeURIComponent(result.flowNonce)}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=None`,
    );
    response.end();
  }

  async #callback(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (request.method !== 'POST') {
      this.#methodNotAllowed(response, 'POST');
      return;
    }
    let parameters: URLSearchParams;
    try {
      parameters = await readFormBody(request);
    } catch {
      parameters = new URLSearchParams();
    }
    const result = await this.#auth.callback(
      parameters,
      cookieValue(request, FLOW_COOKIE),
    );
    const cookies = [
      `${FLOW_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`,
    ];
    if (result.status === 'authorized') {
      cookies.push(
        `${SESSION_COOKIE}=${encodeURIComponent(result.session)}; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=Strict`,
      );
    }
    response.setHeader('set-cookie', cookies);
    if (result.status !== 'authorized') {
      response.statusCode = 303;
      response.setHeader('location', `/admin?auth=${result.status}`);
      response.end();
      return;
    }
    // A Strict cookie set on Google's cross-site form POST is not included by
    // every browser in the immediate 303 redirect. Finish the POST on our
    // origin first, then start a same-site navigation from this document.
    response.statusCode = 200;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.setHeader(
      'content-security-policy',
      "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    response.end(`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/admin"><title>ログイン完了</title></head>
<body><p>ログインしました。<a href="/admin">管理画面へ進む</a></p></body></html>`);
  }

  #logout(request: IncomingMessage, response: ServerResponse): void {
    if (request.method !== 'POST') {
      this.#methodNotAllowed(response, 'POST');
      return;
    }
    response.statusCode = 303;
    response.setHeader('location', '/admin');
    response.setHeader(
      'set-cookie',
      `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
    );
    response.end();
  }

  #page(request: IncomingMessage, response: ServerResponse, url: URL): void {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      this.#methodNotAllowed(response, 'GET, HEAD');
      return;
    }
    const signedIn =
      this.#auth.sessionEmail(cookieValue(request, SESSION_COOKIE)) !== null;
    const rawError = url.searchParams.get('auth');
    const error =
      rawError === 'denied' ||
      rawError === 'expired' ||
      rawError === 'failed' ||
      rawError === 'unavailable'
        ? rawError
        : undefined;
    const body = signedIn ? ADMIN_DASHBOARD_HTML : adminLoginHtml(error);
    response.statusCode = 200;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.setHeader(
      'content-security-policy',
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    response.end(request.method === 'HEAD' ? undefined : body);
  }

  async #api(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    const adminEmail = this.#auth.sessionEmail(
      cookieValue(request, SESSION_COOKIE),
    );
    if (adminEmail === null) {
      this.#json(response, 401, { error: 'google_login_required' });
      return;
    }
    if (url.pathname === '/admin/api/announcements') {
      if (!this.#notifications) {
        this.#json(response, 503, {
          error: 'notification_service_unavailable',
        });
        return;
      }
      if (request.method === 'GET') {
        this.#json(response, 200, {
          items: this.#notifications.listAnnouncements(),
        });
        return;
      }
      if (request.method === 'POST') {
        try {
          const input = announcementInput(await readJsonBody(request));
          const item = this.#notifications.publishAnnouncement({
            ...input,
            createdBy: adminEmail,
          });
          this.#json(response, 201, { item });
        } catch (error) {
          const code =
            error instanceof Error &&
            error.message.startsWith('invalid_announcement')
              ? error.message
              : 'invalid_request';
          this.#json(response, 400, {
            error: code,
          });
        }
        return;
      }
      this.#methodNotAllowed(response, 'GET, POST');
      return;
    }
    const publishRuleMatch = /^\/admin\/api\/rules\/([^/]+)\/publish$/u.exec(
      url.pathname,
    );
    if (url.pathname === '/admin/api/rules' || publishRuleMatch) {
      if (!this.#rules) {
        this.#json(response, 503, { error: 'rule_service_unavailable' });
        return;
      }
      if (url.pathname === '/admin/api/rules') {
        if (request.method !== 'GET') {
          this.#methodNotAllowed(response, 'GET');
          return;
        }
        const items = this.#rules.priority().flatMap((item) => {
          const result = this.#rules!.get(item.ruleId);
          return result.status === 'found'
            ? [{ ...result.rule, ...item, releaseReady: result.releaseReady }]
            : [];
        });
        this.#json(response, 200, { items });
        return;
      }
      if (request.method !== 'POST') {
        this.#methodNotAllowed(response, 'POST');
        return;
      }
      let ruleId: string;
      try {
        ruleId = decodeURIComponent(publishRuleMatch![1]!);
      } catch {
        this.#json(response, 400, { error: 'invalid_path_encoding' });
        return;
      }
      const result = this.#rules.enable(ruleId);
      this.#json(
        response,
        result.status === 'not_found'
          ? 404
          : result.status === 'conflict'
            ? 409
            : result.status === 'invalid'
              ? 400
              : 200,
        result,
      );
      return;
    }
    if (request.method !== 'GET') {
      this.#methodNotAllowed(response, 'GET');
      return;
    }
    try {
      if (url.pathname === '/admin/api/overview') {
        const now = this.#now();
        const database = this.#repository.overview(now);
        let traffic: TrafficSnapshot | null = null;
        if (this.#traffic) {
          try {
            traffic = await this.#traffic();
          } catch {
            traffic = null;
          }
        }
        this.#json(response, 200, { generatedAt: now, database, traffic });
        return;
      }
      if (url.pathname === '/admin/api/proposals') {
        const limit = numericParameter(url.searchParams, 'limit');
        const offset = numericParameter(url.searchParams, 'offset');
        this.#json(
          response,
          200,
          this.#repository.proposals({
            ...(url.searchParams.get('status')
              ? { status: url.searchParams.get('status')! }
              : {}),
            ...(url.searchParams.get('q')
              ? { query: url.searchParams.get('q')! }
              : {}),
            ...(limit === undefined ? {} : { limit }),
            ...(offset === undefined ? {} : { offset }),
          }),
        );
        return;
      }
      if (url.pathname === '/admin/api/users') {
        const limit = numericParameter(url.searchParams, 'limit');
        const offset = numericParameter(url.searchParams, 'offset');
        this.#json(
          response,
          200,
          this.#repository.users({
            ...(url.searchParams.get('registration')
              ? { registration: url.searchParams.get('registration')! }
              : {}),
            ...(url.searchParams.get('q')
              ? { query: url.searchParams.get('q')! }
              : {}),
            ...(limit === undefined ? {} : { limit }),
            ...(offset === undefined ? {} : { offset }),
          }),
        );
        return;
      }
      this.#json(response, 404, { error: 'not_found' });
    } catch {
      this.#json(response, 400, { error: 'invalid_request' });
    }
  }

  #methodNotAllowed(response: ServerResponse, allow: string): void {
    response.statusCode = 405;
    response.setHeader('allow', allow);
    response.end();
  }

  #json(response: ServerResponse, status: number, body: unknown): void {
    response.statusCode = status;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(body));
  }
}
