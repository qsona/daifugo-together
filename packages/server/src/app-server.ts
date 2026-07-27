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
import type { LocalScreeningService } from './injection/local-screening.js';
import type { YellowCardPort } from './injection/yellow-card-service.js';
import type { PipelineJudgementService } from './pipeline/service.js';
import type { PipelineJobService } from './pipeline/jobs.js';
import type { RuleRegistryService } from './rules/service.js';

const RELEASE_REMINDER_MS = 48 * 60 * 60 * 1_000;

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export interface AppServerOptions {
  webDistDir: string;
  gateway?: RoomSocketGatewayOptions;
  checkDatabase?: () => boolean;
  proposals?: ProposalSubmissionPort;
  yellowCards?: YellowCardPort;
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
    >;
    jobs: Pick<
      PipelineJobService,
      'next' | 'active' | 'resume' | 'update' | 'retry' | 'fail'
    >;
  };
  adminRules?: {
    token: string;
    service: Pick<RuleRegistryService, 'get' | 'enable' | 'disable'>;
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
  const handleAdminRules = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const match = /^\/admin\/rules\/([^/]+)(?:\/(enable|disable))?$/u.exec(
      pathname,
    );
    if (!match) return false;
    if (!options.adminRules) {
      writeJson(response, 503, { error: 'admin_rules_unavailable' });
      return true;
    }
    if (!sameSecret(bearerToken(request), options.adminRules.token)) {
      writeJson(response, 401, { error: 'unauthorized' });
      return true;
    }
    let ruleId: string;
    try {
      ruleId = decodeURIComponent(match[1]!);
    } catch {
      writeJson(response, 400, { error: 'invalid_path_encoding' });
      return true;
    }
    const action = match[2];
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
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const isListing = pathname === '/admin/pipeline/screening';
    const isNextJob = pathname === '/admin/pipeline/next';
    const checkMatch = /^\/admin\/proposals\/([^/]+)\/check$/u.exec(pathname);
    const judgeMatch = /^\/admin\/proposals\/([^/]+)\/judge$/u.exec(pathname);
    const approveSpecMatch =
      /^\/admin\/proposals\/([^/]+)\/approve-spec$/u.exec(pathname);
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
        ...(options.adminPipeline?.service.pending() ?? []).map((item) => ({
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
      (checkMatch ?? judgeMatch ?? approveSpecMatch)?.[1] ?? '',
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
      const result = await options.proposals.seen(bearerToken(request));
      if (result.status === 204) {
        response.statusCode = 204;
        response.setHeader('cache-control', 'no-store');
        response.end();
      } else {
        writeJson(response, result.status, result.body);
      }
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
    } catch {
      response.statusCode = 400;
      response.end();
      return;
    }
    void handleAdminRules(request, response)
      .then((handled) =>
        handled ? true : handleAdminScreening(request, response),
      )
      .then((handled) =>
        handled ? true : handleYellowCards(request, response),
      )
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
