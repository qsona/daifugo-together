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

export function createAppServer(options: AppServerOptions): AppServer {
  let draining = false;
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
    void createStaticHandler(options.webDistDir)(request, response).catch(
      () => {
        if (!response.headersSent) response.statusCode = 500;
        response.end();
      },
    );
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
