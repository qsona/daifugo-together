import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import { extname, resolve, sep } from 'node:path';

import { Server } from 'socket.io';

import {
  attachRoomSocketGateway,
  type RoomSocketGateway,
  type RoomSocketGatewayOptions,
  type RoomSocketServer,
} from './room/socket-gateway.js';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from './room/protocol.js';
import type { ProposalSubmissionPort } from './proposal/submission.js';
import type { EvaluationService } from './evaluation/service.js';
import type { LocalScreeningService } from './injection/local-screening.js';
import type { YellowCardPort } from './injection/yellow-card-service.js';
import type { PipelineJudgementService } from './pipeline/service.js';
import type { PipelineJobService } from './pipeline/jobs.js';
import type { RuleRegistryService } from './rules/service.js';
import type { RuleCatalogService } from './rules/catalog.js';
import { FixedWindowRateLimiter } from './room/rate-limit.js';
import type { AuthService } from './auth/service.js';
import type { NotificationService } from './notification/service.js';
import type { PushService } from './push/service.js';

const RELEASE_REMINDER_MS = 48 * 60 * 60 * 1_000;
const AUTH_FLOW_COOKIE = '__Host-daifugo-auth-flow';
const AUTH_FLOW_COOKIE_ATTRIBUTES = 'Path=/; HttpOnly; Secure; SameSite=None';
const AUTH_RESULT_COOKIE = '__Secure-daifugo-auth-result';
const AUTH_RESULT_COOKIE_ATTRIBUTES = 'Path=/menu; Secure; SameSite=Strict';

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export interface AppServerOptions {
  webDistDir: string;
  gateway?: RoomSocketGatewayOptions;
  checkDatabase?: () => boolean;
  proposals?: ProposalSubmissionPort;
  evaluations?: Pick<EvaluationService, 'get' | 'update'>;
  ruleCatalog?: Pick<RuleCatalogService, 'detail' | 'list'>;
  ruleCatalogRateLimit?: { maxAttempts: number; windowMs: number };
  proposalRateLimit?: { maxAttempts: number; windowMs: number };
  now?: () => number;
  yellowCards?: YellowCardPort;
  auth?: Pick<AuthService, 'begin' | 'callback' | 'complete'>;
  notifications?: Pick<
    NotificationService,
    'list' | 'read' | 'opened' | 'readAll'
  >;
  push?: Pick<
    PushService,
    'config' | 'subscribe' | 'unsubscribe' | 'getPreferences' | 'setPreferences'
  >;
  adminScreening?: {
    token: string;
    service: Pick<LocalScreeningService, 'pending' | 'record'>;
  };
  adminPipeline?: {
    token: string;
    service: Pick<
      PipelineJudgementService,
      | 'pending'
      | 'pendingConfirmations'
      | 'recordAi'
      | 'confirmE6Rejection'
      | 'confirmCxRejection'
      | 'approveSpec'
      | 'amendSpec'
    >;
    jobs: Pick<
      PipelineJobService,
      'next' | 'active' | 'resume' | 'update' | 'retry' | 'fail'
    >;
  };
  adminRules?: {
    token: string;
    service: Pick<
      RuleRegistryService,
      'get' | 'enable' | 'disable' | 'priority' | 'conflicts' | 'snapshot'
    >;
  };
}

export interface AppServer {
  http: HttpServer;
  io: RoomSocketServer;
  gateway: RoomSocketGateway;
  listen(port: number, host?: string): Promise<number>;
  beginDrain(): Promise<void>;
  close(): Promise<void>;
}

async function readableFile(path: string): Promise<boolean> {
  try {
    await access(path);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function createStaticHandler(webDistDir: string) {
  const root = resolve(webDistDir);
  const rootPrefix = `${root}${sep}`;
  return async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.statusCode = 405;
      response.end();
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(
        new URL(request.url ?? '/', 'http://localhost').pathname,
      );
    } catch {
      response.statusCode = 400;
      response.end();
      return;
    }
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const requested = resolve(root, relative);
    const safeRequested =
      requested === root || requested.startsWith(rootPrefix)
        ? requested
        : resolve(root, 'index.html');
    const path = (await readableFile(safeRequested))
      ? safeRequested
      : resolve(root, 'index.html');
    if (!(await readableFile(path))) {
      response.statusCode = 404;
      response.end('Not found');
      return;
    }
    response.setHeader(
      'content-type',
      CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
    );
    response.setHeader('cache-control', 'no-cache');
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(path).pipe(response);
  };
}

function bearerToken(request: IncomingMessage): string | null {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

function sameSecret(actual: string | null, expected: string): boolean {
  if (actual === null) return false;
  const actualHash = createHash('sha256').update(actual).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

function clientIp(request: IncomingMessage): string {
  const flyClientIp = request.headers['fly-client-ip'];
  return typeof flyClientIp === 'string'
    ? flyClientIp
    : (request.socket.remoteAddress ?? 'unknown');
}

async function readJsonBody(
  request: IncomingMessage,
  maxBytes = 8 * 1024,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error('request_too_large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function readFormBody(
  request: IncomingMessage,
  maxBytes = 8 * 1024,
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

function cookieValue(request: IncomingMessage, name: string): string | null {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(value.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify(body));
}

export function createAppServer(options: AppServerOptions): AppServer {
  let draining = false;
  const ruleCatalogRateLimiter = new FixedWindowRateLimiter(
    options.ruleCatalogRateLimit ?? {
      maxAttempts: 120,
      windowMs: 60_000,
    },
  );
  const proposalRateLimiter = new FixedWindowRateLimiter(
    options.proposalRateLimit ?? {
      maxAttempts: 10,
      windowMs: 60 * 60_000,
    },
  );
  const handleAuth = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const isApiBegin = url.pathname === '/api/auth/begin';
    const isBrowserBegin = url.pathname === '/auth/google/begin';
    const isCallback = url.pathname === '/auth/google/callback';
    const isApiComplete = url.pathname === '/api/auth/complete';
    const isBrowserComplete = url.pathname === '/auth/google/complete';
    if (
      !isApiBegin &&
      !isBrowserBegin &&
      !isCallback &&
      !isApiComplete &&
      !isBrowserComplete
    ) {
      return false;
    }
    const allowedMethod = 'POST';
    if (request.method !== allowedMethod) {
      response.setHeader('allow', allowedMethod);
      writeJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    if (!options.auth) {
      writeJson(response, 503, { error: 'auth_unavailable' });
      return true;
    }
    if (isApiBegin || isBrowserBegin) {
      const token = isBrowserBegin
        ? (await readFormBody(request)).get('userToken')
        : bearerToken(request);
      const result = await options.auth.begin(token);
      if (result.status === 200) {
        response.setHeader(
          'set-cookie',
          `${AUTH_FLOW_COOKIE}=${encodeURIComponent(result.flowNonce)}; Max-Age=600; ${AUTH_FLOW_COOKIE_ATTRIBUTES}`,
        );
      }
      if (isBrowserBegin && result.status === 200) {
        response.statusCode = 303;
        response.setHeader('location', result.body.authUrl);
        response.setHeader('cache-control', 'no-store');
        response.end();
        return true;
      }
      writeJson(response, result.status, result.body);
      return true;
    }
    if (isCallback) {
      let parameters: URLSearchParams;
      try {
        parameters = await readFormBody(request);
      } catch {
        parameters = new URLSearchParams();
      }
      const location = await options.auth.callback(
        parameters,
        cookieValue(request, AUTH_FLOW_COOKIE),
      );
      response.statusCode = 302;
      response.setHeader('location', location);
      response.setHeader(
        'set-cookie',
        `${AUTH_FLOW_COOKIE}=; Max-Age=0; ${AUTH_FLOW_COOKIE_ATTRIBUTES}`,
      );
      response.setHeader('cache-control', 'no-store');
      response.end();
      return true;
    }
    let ott: unknown;
    if (isBrowserComplete) {
      ott = (await readFormBody(request)).get('ott');
    } else {
      let body: unknown;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        writeJson(response, error instanceof SyntaxError ? 400 : 413, {
          error:
            error instanceof SyntaxError ? 'invalid_json' : 'request_too_large',
        });
        return true;
      }
      ott =
        typeof body === 'object' && body !== null && 'ott' in body
          ? body.ott
          : undefined;
    }
    const result = options.auth.complete(ott);
    if (isBrowserComplete) {
      if (result.status === 200) {
        response.setHeader(
          'set-cookie',
          `${AUTH_RESULT_COOKIE}=${encodeURIComponent(JSON.stringify(result.body))}; Max-Age=60; ${AUTH_RESULT_COOKIE_ATTRIBUTES}`,
        );
        response.statusCode = 303;
        response.setHeader('location', '/menu#/auth/result');
      } else {
        response.statusCode = 303;
        response.setHeader('location', '/menu#/auth/complete?error=expired');
      }
      response.setHeader('cache-control', 'no-store');
      response.end();
      return true;
    }
    writeJson(response, result.status, result.body);
    return true;
  };
  const handleRuleCatalog = (
    request: IncomingMessage,
    response: ServerResponse,
  ): boolean => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const detailMatch = /^\/api\/rules\/([^/]+)$/u.exec(url.pathname);
    if (url.pathname !== '/api/rules' && !detailMatch) return false;
    if (request.method !== 'GET') {
      response.setHeader('allow', 'GET');
      writeJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    if (!options.ruleCatalog) {
      writeJson(response, 503, { error: 'rule_catalog_unavailable' });
      return true;
    }
    if (
      !ruleCatalogRateLimiter.allow(
        clientIp(request),
        options.now?.() ?? Date.now(),
      )
    ) {
      writeJson(response, 429, { error: 'rate_limited' });
      return true;
    }
    let result;
    try {
      result = detailMatch
        ? options.ruleCatalog.detail(decodeURIComponent(detailMatch[1]!))
        : options.ruleCatalog.list(url.searchParams);
    } catch {
      writeJson(response, 500, { error: 'rule_catalog_failed' });
      return true;
    }
    writeJson(response, result.status, result.body);
    return true;
  };
  const handleAdminRules = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const isPriority = pathname === '/api/admin/rules/priority';
    const isConflicts = pathname === '/api/admin/conflict-events';
    const snapshotMatch = /^\/api\/admin\/sets\/([^/]+)\/snapshot$/u.exec(
      pathname,
    );
    const match = /^\/admin\/rules\/([^/]+)(?:\/(enable|disable))?$/u.exec(
      pathname,
    );
    if (!match && !isPriority && !isConflicts && !snapshotMatch) return false;
    if (!options.adminRules) {
      writeJson(response, 503, { error: 'admin_rules_unavailable' });
      return true;
    }
    if (!sameSecret(bearerToken(request), options.adminRules.token)) {
      writeJson(response, 401, { error: 'unauthorized' });
      return true;
    }
    if (isPriority || isConflicts || snapshotMatch) {
      if (request.method !== 'GET') {
        response.setHeader('allow', 'GET');
        writeJson(response, 405, { error: 'method_not_allowed' });
        return true;
      }
      if (isPriority) {
        writeJson(response, 200, {
          items: options.adminRules.service.priority(),
        });
        return true;
      }
      if (isConflicts) {
        const parameters = new URL(request.url ?? '/', 'http://localhost')
          .searchParams;
        const rawLimit = parameters.get('limit');
        const limit =
          rawLimit === null || !/^\d+$/u.test(rawLimit)
            ? undefined
            : Number(rawLimit);
        writeJson(response, 200, {
          items: options.adminRules.service.conflicts({
            ...(parameters.get('setId')
              ? { setId: parameters.get('setId')! }
              : {}),
            ...(parameters.get('ruleId')
              ? { ruleId: parameters.get('ruleId')! }
              : {}),
            ...(limit === undefined ? {} : { limit }),
          }),
        });
        return true;
      }
      let setId: string;
      try {
        setId = decodeURIComponent(snapshotMatch![1]!);
      } catch {
        writeJson(response, 400, { error: 'invalid_path_encoding' });
        return true;
      }
      writeJson(response, 200, {
        items: options.adminRules.service.snapshot(setId),
      });
      return true;
    }
    let ruleId: string;
    try {
      ruleId = decodeURIComponent(match![1]!);
    } catch {
      writeJson(response, 400, { error: 'invalid_path_encoding' });
      return true;
    }
    const action = match![2];
    if (!action) {
      if (request.method !== 'GET') {
        response.setHeader('allow', 'GET');
        writeJson(response, 405, { error: 'method_not_allowed' });
        return true;
      }
      const result = options.adminRules.service.get(ruleId);
      writeJson(response, result.status === 'not_found' ? 404 : 200, result);
      return true;
    }
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST');
      writeJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    let result;
    if (action === 'disable') {
      let body: unknown;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        writeJson(response, error instanceof SyntaxError ? 400 : 413, {
          error:
            error instanceof SyntaxError ? 'invalid_json' : 'request_too_large',
        });
        return true;
      }
      result = options.adminRules.service.disable(ruleId, body);
    } else {
      result = options.adminRules.service.enable(ruleId);
    }
    writeJson(
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
    return true;
  };
  const handleAdminScreening = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> => {
    const requestUrl = new URL(request.url ?? '/', 'http://localhost');
    const pathname = requestUrl.pathname;
    const isListing = pathname === '/admin/pipeline/screening';
    const isNextJob = pathname === '/admin/pipeline/next';
    const checkMatch = /^\/admin\/proposals\/([^/]+)\/check$/u.exec(pathname);
    const judgeMatch = /^\/admin\/proposals\/([^/]+)\/judge$/u.exec(pathname);
    const approveSpecMatch =
      /^\/admin\/proposals\/([^/]+)\/approve-spec$/u.exec(pathname);
    const amendSpecMatch = /^\/admin\/proposals\/([^/]+)\/amend-spec$/u.exec(
      pathname,
    );
    const jobUpdateMatch =
      /^\/admin\/pipeline\/jobs\/([1-9]\d*)\/update$/u.exec(pathname);
    const jobFailMatch = /^\/admin\/pipeline\/jobs\/([1-9]\d*)\/fail$/u.exec(
      pathname,
    );
    const jobRetryMatch = /^\/admin\/pipeline\/jobs\/([1-9]\d*)\/retry$/u.exec(
      pathname,
    );
    const jobGetMatch = /^\/admin\/pipeline\/jobs\/([1-9]\d*)$/u.exec(pathname);
    if (
      !isListing &&
      !isNextJob &&
      !checkMatch &&
      !judgeMatch &&
      !approveSpecMatch &&
      !amendSpecMatch &&
      !jobUpdateMatch &&
      !jobFailMatch &&
      !jobRetryMatch &&
      !jobGetMatch
    ) {
      return false;
    }
    const configuration = checkMatch
      ? options.adminScreening
      : judgeMatch ||
          approveSpecMatch ||
          amendSpecMatch ||
          isNextJob ||
          jobUpdateMatch ||
          jobFailMatch ||
          jobRetryMatch ||
          jobGetMatch
        ? options.adminPipeline
        : (options.adminScreening ?? options.adminPipeline);
    if (!configuration) {
      writeJson(response, 503, { error: 'admin_screening_unavailable' });
      return true;
    }
    if (!sameSecret(bearerToken(request), configuration.token)) {
      writeJson(response, 401, { error: 'unauthorized' });
      return true;
    }
    if (isListing) {
      if (request.method !== 'GET') {
        response.setHeader('allow', 'GET');
        writeJson(response, 405, { error: 'method_not_allowed' });
        return true;
      }
      const items = [
        ...(options.adminScreening?.service.pending() ?? []).map((item) => ({
          stage: 'e6' as const,
          ...item,
        })),
        ...(
          options.adminPipeline?.service.pending(
            undefined,
            requestUrl.searchParams.get('promptVersion') ?? undefined,
          ) ?? []
        ).map((item) => ({
          stage: 'cx01' as const,
          ...item,
        })),
        ...(options.adminPipeline?.service.pendingConfirmations() ?? []).map(
          (item) => ({
            stage: 'confirmation' as const,
            ...item,
          }),
        ),
      ].sort(
        (left, right) =>
          ('signals' in left
            ? left.signals.createdAt
            : 'check' in left
              ? left.check.createdAt
              : left.judgement.createdAt) -
            ('signals' in right
              ? right.signals.createdAt
              : 'check' in right
                ? right.check.createdAt
                : right.judgement.createdAt) ||
          left.proposal.id.localeCompare(right.proposal.id),
      );
      writeJson(response, 200, { items });
      return true;
    }
    if (isNextJob) {
      if (request.method !== 'GET') {
        response.setHeader('allow', 'GET');
        writeJson(response, 405, { error: 'method_not_allowed' });
        return true;
      }
      const item = options.adminPipeline!.jobs.next();
      const warnings = options
        .adminPipeline!.jobs.active()
        .flatMap((job) =>
          job.phase === 'merged'
            ? Date.now() - job.updatedAt >= RELEASE_REMINDER_MS
              ? [
                  `REMINDER: job ${String(job.id)} (${job.ruleId}) has awaited enablement for over 48 hours`,
                ]
              : []
            : [`job ${String(job.id)} (${job.ruleId}) is already ${job.phase}`],
        );
      writeJson(response, 200, { item, warnings });
      return true;
    }
    if (jobGetMatch) {
      if (request.method !== 'GET') {
        response.setHeader('allow', 'GET');
        writeJson(response, 405, { error: 'method_not_allowed' });
        return true;
      }
      const item = options.adminPipeline!.jobs.resume(Number(jobGetMatch[1]));
      writeJson(
        response,
        item ? 200 : 404,
        item ? { item } : { error: 'not_found' },
      );
      return true;
    }
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST');
      writeJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    let body: unknown;
    try {
      body = await readJsonBody(request, 64 * 1024);
    } catch (error) {
      writeJson(response, error instanceof SyntaxError ? 400 : 413, {
        error:
          error instanceof SyntaxError ? 'invalid_json' : 'request_too_large',
      });
      return true;
    }
    const proposalId = decodeURIComponent(
      (checkMatch ?? judgeMatch ?? approveSpecMatch ?? amendSpecMatch)?.[1] ??
        '',
    );
    let result;
    if (jobUpdateMatch) {
      result = options.adminPipeline!.jobs.update(
        Number(jobUpdateMatch[1]),
        body,
      );
    } else if (jobFailMatch) {
      result = options.adminPipeline!.jobs.fail(Number(jobFailMatch[1]), body);
    } else if (jobRetryMatch) {
      result = options.adminPipeline!.jobs.retry(
        Number(jobRetryMatch[1]),
        body,
      );
    } else if (checkMatch) {
      result = options.adminScreening!.service.record(proposalId, body);
    } else if (approveSpecMatch) {
      result = options.adminPipeline!.service.approveSpec(proposalId, body);
    } else if (amendSpecMatch) {
      result = options.adminPipeline!.service.amendSpec(proposalId, body);
    } else {
      const value =
        typeof body === 'object' && body !== null && !Array.isArray(body)
          ? (body as Record<string, unknown>)
          : null;
      const action = value?.action;
      const payload = value?.payload;
      result =
        action === 'record_ai'
          ? options.adminPipeline!.service.recordAi(proposalId, payload)
          : action === 'confirm_e6_rejection'
            ? options.adminPipeline!.service.confirmE6Rejection(
                proposalId,
                payload,
              )
            : action === 'confirm_rejection'
              ? options.adminPipeline!.service.confirmCxRejection(
                  proposalId,
                  payload,
                )
              : { status: 'invalid' as const, error: 'invalid_action' };
    }
    writeJson(
      response,
      result.status === 'recorded'
        ? 200
        : result.status === 'already_recorded'
          ? 200
          : result.status === 'confirmed'
            ? 200
            : result.status === 'already_confirmed'
              ? 200
              : result.status === 'updated'
                ? 200
                : result.status === 'failed'
                  ? 200
                  : result.status === 'already_failed'
                    ? 200
                    : result.status === 'retried'
                      ? 200
                      : result.status === 'not_found'
                        ? 404
                        : result.status === 'conflict'
                          ? 409
                          : 400,
      result,
    );
    return true;
  };
  const handleYellowCards = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname === '/api/me/yellow-cards') {
      if (request.method !== 'GET') {
        response.setHeader('allow', 'GET');
        writeJson(response, 405, { error: 'method_not_allowed' });
        return true;
      }
      if (!options.yellowCards) {
        writeJson(response, 503, { error: 'yellow_card_service_unavailable' });
        return true;
      }
      const result = options.yellowCards.summary(bearerToken(request));
      writeJson(response, result.status, result.body);
      return true;
    }
    const appealMatch = /^\/api\/yellow-cards\/([1-9]\d*)\/appeal$/u.exec(
      pathname,
    );
    if (!appealMatch) return false;
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST');
      writeJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    if (!options.yellowCards) {
      writeJson(response, 503, { error: 'yellow_card_service_unavailable' });
      return true;
    }
    let body: unknown;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      writeJson(response, error instanceof SyntaxError ? 400 : 413, {
        error:
          error instanceof SyntaxError ? 'invalid_json' : 'request_too_large',
      });
      return true;
    }
    const result = options.yellowCards.appeal({
      token: bearerToken(request),
      cardId: Number(appealMatch[1]),
      body,
    });
    writeJson(response, result.status, result.body);
    return true;
  };
  const handleProposal = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const isCreate = pathname === '/api/proposals';
    const isMine = pathname === '/api/proposals/mine';
    const isSeen = pathname === '/api/proposals/seen';
    if (!isCreate && !isMine && !isSeen) return false;
    const allowedMethod = isMine ? 'GET' : 'POST';
    if (request.method !== allowedMethod) {
      response.setHeader('allow', allowedMethod);
      writeJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    if (!options.proposals) {
      writeJson(response, 503, { error: 'proposal_service_unavailable' });
      return true;
    }
    if (isMine) {
      const result = await options.proposals.mine(bearerToken(request));
      writeJson(response, result.status, result.body);
      return true;
    }
    if (isSeen) {
      let body: unknown;
      const hasBody =
        request.headers['transfer-encoding'] !== undefined ||
        Number(request.headers['content-length'] ?? 0) > 0;
      if (hasBody) {
        try {
          body = await readJsonBody(request);
        } catch (error) {
          writeJson(response, error instanceof SyntaxError ? 400 : 413, {
            error:
              error instanceof SyntaxError
                ? 'invalid_json'
                : 'request_too_large',
          });
          return true;
        }
      }
      const result = await options.proposals.seen(bearerToken(request), body);
      if (result.status === 204) {
        response.statusCode = 204;
        response.setHeader('cache-control', 'no-store');
        response.end();
      } else {
        writeJson(response, result.status, result.body);
      }
      return true;
    }
    const authorization = options.proposals.authorize(bearerToken(request));
    if (authorization.status !== 204) {
      writeJson(response, authorization.status, authorization.body);
      return true;
    }
    if (
      !proposalRateLimiter.allow(
        clientIp(request),
        options.now?.() ?? Date.now(),
      )
    ) {
      writeJson(response, 429, { error: 'rate_limited' });
      return true;
    }
    let body: unknown;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      writeJson(response, error instanceof SyntaxError ? 400 : 413, {
        error:
          error instanceof SyntaxError ? 'invalid_json' : 'request_too_large',
      });
      return true;
    }
    const result = await options.proposals.submit({
      token: bearerToken(request),
      ip: clientIp(request),
      body,
    });
    writeJson(response, result.status, result.body);
    return true;
  };
  const handleNotifications = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const isList = pathname === '/api/notifications';
    const isReadAll = pathname === '/api/notifications/read-all';
    const itemMatch = /^\/api\/notifications\/([1-9]\d*)\/(read|opened)$/u.exec(
      pathname,
    );
    if (!isList && !isReadAll && !itemMatch) return false;
    if (!options.notifications) {
      writeJson(response, 503, { error: 'notification_service_unavailable' });
      return true;
    }
    const allowedMethod = isList ? 'GET' : 'POST';
    if (request.method !== allowedMethod) {
      response.setHeader('allow', allowedMethod);
      writeJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    if (isList) {
      const result = options.notifications.list(bearerToken(request));
      writeJson(response, result.status, result.body);
      return true;
    }
    let status: 204 | 401 | 404;
    if (isReadAll) {
      status = options.notifications.readAll(bearerToken(request));
    } else if (itemMatch![2] === 'read') {
      status = options.notifications.read(
        bearerToken(request),
        Number(itemMatch![1]),
      );
    } else {
      let via: 'center' | 'push' = 'center';
      const hasBody =
        request.headers['transfer-encoding'] !== undefined ||
        Number(request.headers['content-length'] ?? 0) > 0;
      if (hasBody) {
        try {
          const body = await readJsonBody(request);
          if (
            typeof body !== 'object' ||
            body === null ||
            !('via' in body) ||
            (body.via !== 'center' && body.via !== 'push')
          ) {
            writeJson(response, 400, { error: 'invalid_open_source' });
            return true;
          }
          via = body.via;
        } catch (error) {
          writeJson(response, error instanceof SyntaxError ? 400 : 413, {
            error:
              error instanceof SyntaxError
                ? 'invalid_json'
                : 'request_too_large',
          });
          return true;
        }
      }
      status = options.notifications.opened(
        bearerToken(request),
        Number(itemMatch![1]),
        via,
      );
    }
    if (status === 204) {
      response.statusCode = 204;
      response.setHeader('cache-control', 'no-store');
      response.end();
    } else {
      writeJson(response, status, {
        error: status === 401 ? 'unauthorized' : 'not_found',
      });
    }
    return true;
  };
  const handlePush = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const isConfig = pathname === '/api/push/config';
    const isSubscriptions = pathname === '/api/push/subscriptions';
    const isPreferences = pathname === '/api/push/preferences';
    if (!isConfig && !isSubscriptions && !isPreferences) return false;
    if (isConfig) {
      if (request.method !== 'GET') {
        response.setHeader('allow', 'GET');
        writeJson(response, 405, { error: 'method_not_allowed' });
        return true;
      }
      writeJson(
        response,
        200,
        options.push?.config() ?? { vapidPublicKey: null, available: false },
      );
      return true;
    }
    if (!options.push) {
      writeJson(response, 503, { error: 'push_unavailable' });
      return true;
    }
    const allowed = isSubscriptions ? 'POST, DELETE' : 'GET, PUT';
    if (
      (isSubscriptions &&
        request.method !== 'POST' &&
        request.method !== 'DELETE') ||
      (isPreferences && request.method !== 'GET' && request.method !== 'PUT')
    ) {
      response.setHeader('allow', allowed);
      writeJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    let result;
    if (isPreferences && request.method === 'GET') {
      result = options.push.getPreferences(bearerToken(request));
    } else {
      let body: unknown;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        writeJson(response, error instanceof SyntaxError ? 400 : 413, {
          error:
            error instanceof SyntaxError ? 'invalid_json' : 'request_too_large',
        });
        return true;
      }
      result = isSubscriptions
        ? request.method === 'POST'
          ? options.push.subscribe(bearerToken(request), body)
          : options.push.unsubscribe(bearerToken(request), body)
        : options.push.setPreferences(bearerToken(request), body);
    }
    if (result.status === 204) {
      response.statusCode = 204;
      response.setHeader('cache-control', 'no-store');
      response.end();
    } else {
      writeJson(response, result.status, result.body);
    }
    return true;
  };
  const handleEvaluation = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const match = /^\/api\/sets\/([^/]+)\/evaluation$/u.exec(pathname);
    if (!match) return false;
    if (!options.evaluations) {
      writeJson(response, 503, { error: 'evaluation_service_unavailable' });
      return true;
    }
    let setId: string;
    try {
      setId = decodeURIComponent(match[1]!);
    } catch {
      writeJson(response, 400, { error: 'invalid_path_encoding' });
      return true;
    }
    if (request.method === 'GET') {
      const result = options.evaluations.get(bearerToken(request), setId);
      writeJson(response, result.status, result.body);
      return true;
    }
    if (request.method !== 'POST') {
      response.setHeader('allow', 'GET, POST');
      writeJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    let body: unknown;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      writeJson(response, error instanceof SyntaxError ? 400 : 413, {
        error:
          error instanceof SyntaxError ? 'invalid_json' : 'request_too_large',
      });
      return true;
    }
    const result = options.evaluations.update(
      bearerToken(request),
      setId,
      body,
    );
    writeJson(response, result.status, result.body);
    return true;
  };
  const handleHealth = (
    request: IncomingMessage,
    response: ServerResponse,
  ): boolean => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname !== '/health') return false;

    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.statusCode = 405;
      response.setHeader('allow', 'GET, HEAD');
      response.end();
      return true;
    }

    const databaseHealthy = (() => {
      try {
        return options.checkDatabase?.() ?? true;
      } catch {
        return false;
      }
    })();
    response.statusCode = databaseHealthy ? 200 : 503;
    if (request.method === 'HEAD') {
      response.end();
      return true;
    }
    response.end(
      JSON.stringify(
        databaseHealthy
          ? { status: draining ? 'draining' : 'ok', db: 'ok' }
          : { status: 'error', db: 'error' },
      ),
    );
    return true;
  };

  const http = createServer((request, response) => {
    try {
      if (handleHealth(request, response)) return;
      if (handleRuleCatalog(request, response)) return;
    } catch {
      response.statusCode = 400;
      response.end();
      return;
    }
    void handleAuth(request, response)
      .then((handled) => (handled ? true : handleAdminRules(request, response)))
      .then((handled) =>
        handled ? true : handleAdminScreening(request, response),
      )
      .then((handled) =>
        handled ? true : handleYellowCards(request, response),
      )
      .then((handled) => (handled ? true : handleEvaluation(request, response)))
      .then((handled) =>
        handled ? true : handleNotifications(request, response),
      )
      .then((handled) => (handled ? true : handlePush(request, response)))
      .then((handled) => (handled ? true : handleProposal(request, response)))
      .then((handled) => {
        if (!handled) {
          return createStaticHandler(options.webDistDir)(request, response);
        }
      })
      .catch(() => {
        if (!response.headersSent) response.statusCode = 500;
        response.end();
      });
  });
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(http, {
    pingInterval: 10_000,
    pingTimeout: 8_000,
    serveClient: false,
    maxHttpBufferSize: 16 * 1024,
  });
  const gateway = attachRoomSocketGateway(io, options.gateway);
  let closing: Promise<void> | undefined;

  const closeTransport = (): Promise<void> =>
    new Promise((resolveClose) => {
      io.close(() => {
        if (http.listening) {
          http.close(() => resolveClose());
        } else {
          resolveClose();
        }
      });
    });

  return {
    http,
    io,
    gateway,
    listen(port, host = '0.0.0.0') {
      return new Promise<number>((resolveListen, reject) => {
        http.once('error', reject);
        http.listen(port, host, () => {
          http.off('error', reject);
          const address = http.address();
          if (!address || typeof address === 'string') {
            reject(new Error('Expected a TCP listener'));
            return;
          }
          resolveListen(address.port);
        });
      });
    },
    async beginDrain() {
      draining = true;
      await gateway.beginDrain();
    },
    close() {
      if (!closing) {
        gateway.close();
        closing = closeTransport();
      }
      return closing;
    },
  };
}
