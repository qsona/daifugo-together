import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerToClientEvents } from '@daifugo/core';
import { io as createClient } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';

import { createAppServer, type AppServer } from './app-server.js';

const apps: AppServer[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fetchText(url: string): Promise<{
  status: number | undefined;
  body: string;
  contentType: string | undefined;
}> {
  return new Promise((resolve, reject) => {
    const outgoing = request(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve({
          status: response.statusCode,
          body,
          contentType: response.headers['content-type'],
        });
      });
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

describe('production app server', () => {
  it('SPA fallbackを配信し、同じoriginでSocket.IO sessionを確立する', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'daifugo-web-dist-'));
    directories.push(directory);
    writeFileSync(
      join(directory, 'index.html'),
      '<!doctype html><title>Daifugo Together</title>',
    );
    const app = createAppServer({ webDistDir: directory });
    apps.push(app);
    const port = await app.listen(0, '127.0.0.1');
    const url = `http://127.0.0.1:${String(port)}`;

    await expect(fetchText(`${url}/rooms/example`)).resolves.toEqual({
      status: 200,
      body: '<!doctype html><title>Daifugo Together</title>',
      contentType: 'text/html; charset=utf-8',
    });

    const client = createClient(url, {
      transports: ['websocket'],
      reconnection: false,
    });
    const ready = await new Promise<
      Parameters<ServerToClientEvents['session:ready']>[0]
    >((resolve) => client.once('session:ready', resolve));
    expect(ready.room).toBeNull();
    expect(ready.userToken.length).toBeGreaterThanOrEqual(16);
    client.disconnect();
  });
});
