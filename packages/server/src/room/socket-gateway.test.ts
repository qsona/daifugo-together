import { createServer, type Server as HttpServer } from 'node:http';

import { Server } from 'socket.io';
import {
  io as createClient,
  type Socket as ClientSocket,
} from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  Ack,
  ClientToServerEvents,
  ServerToClientEvents,
} from './protocol.js';
import { InMemorySessionStore } from './session.js';
import {
  attachRoomSocketGateway,
  type RoomSocketGateway,
  type RoomSocketServer,
} from './socket-gateway.js';
import type { PlayerRoomView } from './types.js';

type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

interface Harness {
  http: HttpServer;
  io: RoomSocketServer;
  gateway: RoomSocketGateway;
  url: string;
  clients: TestClient[];
}

const harnesses: Harness[] = [];

function once<T>(subscribe: (resolve: (value: T) => void) => void): Promise<T> {
  return new Promise((resolve) => subscribe(resolve));
}

function allStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => [
      key,
      ...allStrings(child),
    ]);
  }
  return [];
}

async function createHarness(): Promise<Harness> {
  let userSequence = 0;
  let tokenSequence = 0;
  const http = createServer();
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<never, never>,
    {
      session: {
        userId: string;
        userToken: string;
        displayName: string;
      };
    }
  >(http);
  const gateway = attachRoomSocketGateway(io, {
    sessions: new InMemorySessionStore({
      createUserId: () => `user-${++userSequence}`,
      createToken: () => `token-${++tokenSequence}`.padEnd(20, 'x'),
      createDisplayName: (sequence) => `プレイヤー${sequence}`,
    }),
    now: () => 10_000,
    createSetSeed: () => 'socket-set-seed',
  });
  await new Promise<void>((resolve) => {
    http.listen(0, '127.0.0.1', resolve);
  });
  const address = http.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected an ephemeral TCP address');
  }
  const harness: Harness = {
    http,
    io,
    gateway,
    url: `http://127.0.0.1:${address.port}`,
    clients: [],
  };
  harnesses.push(harness);
  return harness;
}

async function connect(
  harness: Harness,
  userToken?: string,
): Promise<{
  client: TestClient;
  ready: Parameters<ServerToClientEvents['session:ready']>[0];
}> {
  const client: TestClient = createClient(harness.url, {
    autoConnect: false,
    transports: ['websocket'],
    auth: userToken === undefined ? {} : { userToken },
    reconnection: false,
  });
  harness.clients.push(client);
  const readyPromise = once<
    Parameters<ServerToClientEvents['session:ready']>[0]
  >((resolve) => client.once('session:ready', resolve));
  client.connect();
  return { client, ready: await readyPromise };
}

function emitAck<Event extends keyof ClientToServerEvents, Result>(
  client: TestClient,
  event: Event,
  payload: Parameters<ClientToServerEvents[Event]>[0],
): Promise<Ack<Result>> {
  return new Promise((resolve) => {
    const emit = client.emit.bind(client) as (
      name: Event,
      body: Parameters<ClientToServerEvents[Event]>[0],
      ack: (result: Ack<Result>) => void,
    ) => void;
    emit(event, payload, resolve);
  });
}

async function closeHarness(harness: Harness): Promise<void> {
  for (const client of harness.clients) {
    client.disconnect();
  }
  harness.gateway.close();
  await new Promise<void>((resolve) => harness.io.close(() => resolve()));
  if (harness.http.listening) {
    await new Promise<void>((resolve, reject) => {
      harness.http.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(closeHarness));
});

describe('Socket.IO room gateway', () => {
  it('create→join→startを実ソケットで直列化し、受信者以外の手札を漏らさない', async () => {
    const harness = await createHarness();
    const owner = await connect(harness);
    const guest = await connect(harness);
    expect(owner.ready.room).toBeNull();
    expect(guest.ready.room).toBeNull();

    const created = await emitAck<
      'room:create',
      { roomId: string; inviteCode: string }
    >(owner.client, 'room:create', {});
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const ownerJoinedState = once<PlayerRoomView>((resolve) =>
      owner.client.once('room:state', resolve),
    );
    const guestJoinedState = once<PlayerRoomView>((resolve) =>
      guest.client.once('room:state', resolve),
    );
    const joined = await emitAck<'room:join', { roomId: string }>(
      guest.client,
      'room:join',
      { inviteCode: created.value.inviteCode.toLowerCase().replace('-', ' ') },
    );
    expect(joined).toEqual({
      ok: true,
      value: { roomId: created.value.roomId },
    });
    await Promise.all([ownerJoinedState, guestJoinedState]);

    const ownerStartedState = once<PlayerRoomView>((resolve) =>
      owner.client.once('room:state', resolve),
    );
    const guestStartedState = once<PlayerRoomView>((resolve) =>
      guest.client.once('room:state', resolve),
    );
    const started = await emitAck<'room:start', Record<string, never>>(
      owner.client,
      'room:start',
      {},
    );
    expect(started).toEqual({ ok: true, value: {} });
    const [ownerView, guestView] = await Promise.all([
      ownerStartedState,
      guestStartedState,
    ]);
    expect(ownerView.phase).toBe('playing');
    expect(guestView.phase).toBe('playing');

    const authority = harness.gateway.rooms.get(created.value.roomId)!;
    for (const view of [ownerView, guestView]) {
      const visible = new Set(allStrings(view));
      for (const member of authority.members) {
        if (member.memberId === view.you.memberId) continue;
        for (const card of authority.engine?.currentGame?.players[
          member.memberId
        ]?.hand ?? []) {
          expect(visible.has(card.id)).toBe(false);
        }
      }
    }
  });

  it('同一tokenの後勝ち接続で旧socketをsupersedeし、最新snapshotへ再アタッチする', async () => {
    const harness = await createHarness();
    const first = await connect(harness);
    const created = await emitAck<
      'room:create',
      { roomId: string; inviteCode: string }
    >(first.client, 'room:create', {});
    expect(created.ok).toBe(true);

    const superseded = once<void>((resolve) =>
      first.client.once('session:superseded', () => resolve()),
    );
    const replacement = await connect(harness, first.ready.userToken);
    await superseded;

    expect(first.client.connected).toBe(false);
    expect(replacement.ready.userId).toBe(first.ready.userId);
    expect(replacement.ready.room?.roomId).toBe(
      created.ok ? created.value.roomId : '',
    );
    expect(replacement.ready.room?.events).toEqual([]);
  });

  it('最後の人間がleaveすると、ackとroom:closedを両方返す', async () => {
    const harness = await createHarness();
    const owner = await connect(harness);
    await emitAck<'room:create', { roomId: string; inviteCode: string }>(
      owner.client,
      'room:create',
      {},
    );
    const closed = once<{ reason: string }>((resolve) =>
      owner.client.once('room:closed', resolve),
    );
    const left = await emitAck<'room:leave', Record<string, never>>(
      owner.client,
      'room:leave',
      {},
    );
    expect(left).toEqual({ ok: true, value: {} });
    await expect(closed).resolves.toEqual({ reason: 'noHumans' });
  });
});
