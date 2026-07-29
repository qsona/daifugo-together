import { createServer, type Server as HttpServer } from 'node:http';

import { createDeck, enumerateLegalPlays } from '@daifugo/core';
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
import { RoomManager } from './manager.js';
import { InMemorySessionStore } from './session.js';
import {
  attachRoomSocketGateway,
  type RoomSocketGateway,
  type RoomSocketGatewayOptions,
  type RoomSocketServer,
} from './socket-gateway.js';
import type { PlayerRoomView } from './types.js';
import { viewFor } from './view.js';

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

function expectNoHiddenCardIds(view: PlayerRoomView): void {
  const deckIds = new Set(createDeck().map((card) => card.id));
  const allowed = new Set<string>([
    ...(view.game?.yourHand.map((card) => card.id) ?? []),
    ...(view.game?.field.cards.map((card) => card.id) ?? []),
    ...(view.game?.history.flatMap((event) =>
      event.t === 'played' ? event.cards.map((card) => card.id) : [],
    ) ?? []),
    ...view.events.flatMap((event) =>
      event.t === 'played' ? event.cards.map((card) => card.id) : [],
    ),
  ]);
  for (const value of allStrings(view)) {
    if (deckIds.has(value)) {
      expect(
        allowed.has(value),
        `hidden card ${value} leaked at v=${view.v}`,
      ).toBe(true);
    }
  }
}

async function createHarness(
  gatewayOptions: Partial<
    Pick<
      RoomSocketGatewayOptions,
      'rooms' | 'decideTurn' | 'timers' | 'joinRateLimit'
    >
  > = {},
): Promise<Harness> {
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
        registered: boolean;
      };
    }
  >(http);
  const gateway = attachRoomSocketGateway(io, {
    ...gatewayOptions,
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
  statesBeforeReady: PlayerRoomView[];
}> {
  const client: TestClient = createClient(harness.url, {
    autoConnect: false,
    transports: ['websocket'],
    auth: userToken === undefined ? {} : { userToken },
    reconnection: false,
  });
  harness.clients.push(client);
  const statesBeforeReady: PlayerRoomView[] = [];
  let readyReceived = false;
  client.on('room:state', (view) => {
    if (!readyReceived) statesBeforeReady.push(view);
  });
  const readyPromise = once<
    Parameters<ServerToClientEvents['session:ready']>[0]
  >((resolve) =>
    client.once('session:ready', (ready) => {
      readyReceived = true;
      resolve(ready);
    }),
  );
  client.connect();
  return { client, ready: await readyPromise, statesBeforeReady };
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
  it('きほんの1人部屋の初戦は探索済みseedでseat 0に教材配牌を届ける', async () => {
    const harness = await createHarness();
    const owner = await connect(harness);
    const created = await emitAck<
      'room:create',
      { roomId: string; inviteCode: string }
    >(owner.client, 'room:create', { mode: 'basic' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const startedState = once<PlayerRoomView>((resolve) =>
      owner.client.once('room:state', (view) => {
        if (view.phase === 'playing') resolve(view);
      }),
    );
    const started = await emitAck<'room:start', Record<string, never>>(
      owner.client,
      'room:start',
      {},
    );
    expect(started).toEqual({ ok: true, value: {} });
    const view = await startedState;

    expect(view.you.seatId).toBe(0);
    expect(view.game?.turn).toMatchObject({ seat: 0, deadlineAt: null });
    expect(view.game?.yourHand.map((card) => card.id)).toEqual([
      'D03',
      'C03',
      'H05',
      'S07',
      'D07',
      'C08',
      'HJ',
      'SK',
      'DK',
      'SA',
      'S02',
      'H02',
      'D02',
    ]);
  });

  it('create→join→startを実ソケットで直列化し、受信者以外の手札を漏らさない', async () => {
    const harness = await createHarness();
    const owner = await connect(harness);
    const guest = await connect(harness);
    expect(owner.ready.room).toBeNull();
    expect(guest.ready.room).toBeNull();

    const created = await emitAck<
      'room:create',
      { roomId: string; inviteCode: string }
    >(owner.client, 'room:create', { mode: 'basic' });
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
      { inviteCode: created.value.inviteCode },
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
    expect(ownerView.mode).toBe('basic');
    expect(guestView.mode).toBe('basic');

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

  it('旧クライアントのモード未指定はcommunityとして扱う', async () => {
    const harness = await createHarness();
    const owner = await connect(harness);
    const roomState = once<PlayerRoomView>((resolve) =>
      owner.client.once('room:state', resolve),
    );

    const created = await emitAck<
      'room:create',
      { roomId: string; inviteCode: string }
    >(owner.client, 'room:create', {});

    expect(created.ok).toBe(true);
    expect((await roomState).mode).toBe('community');
  });

  it('同一tokenの後勝ち接続で旧socketをsupersedeし、最新snapshotへ再アタッチする', async () => {
    const harness = await createHarness();
    const first = await connect(harness);
    const created = await emitAck<
      'room:create',
      { roomId: string; inviteCode: string }
    >(first.client, 'room:create', { mode: 'basic' });
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
    expect(replacement.ready.room?.mode).toBe('basic');
    expect(replacement.ready.room?.events).toEqual([]);
    expect(replacement.statesBeforeReady).toEqual([]);
  });

  it('切断中に権威状態が数手進んでも、再接続snapshotが最新版と一致する', async () => {
    let sequence = 0;
    const rooms = new RoomManager({
      now: () => 10_000,
      createRoomId: () => `room-reconnect-${++sequence}`,
      createMemberId: () => `member-reconnect-${++sequence}`,
      randomIndex: (max) => sequence++ % max,
      reducer: { random: () => 0.999_999 },
    });
    const harness = await createHarness({
      rooms,
      timers: {
        setTimer: () => ({ fake: true }),
        clearTimer: () => {},
      },
    });
    const owner = await connect(harness);
    const guest = await connect(harness);
    const created = await emitAck<
      'room:create',
      { roomId: string; inviteCode: string }
    >(owner.client, 'room:create', {});
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await emitAck<'room:join', { roomId: string }>(guest.client, 'room:join', {
      inviteCode: created.value.inviteCode,
    });
    await emitAck<'room:start', Record<string, never>>(
      owner.client,
      'room:start',
      {},
    );

    const disconnectedState = once<PlayerRoomView>((resolve) =>
      guest.client.on('room:state', (view) => {
        const ownerMember = view.members.find(
          (member) => member.displayName === owner.ready.displayName,
        );
        if (ownerMember?.connected === false) resolve(view);
      }),
    );
    owner.client.disconnect();
    const disconnectedView = await disconnectedState;

    for (let step = 0; step < 3; step += 1) {
      const state = rooms.get(created.value.roomId)!;
      const engine = state.engine!;
      if (engine.phase.name !== 'gameInProgress') {
        throw new Error('Expected the reconnect fixture to remain in a game');
      }
      const memberId = engine.currentGame!.public.turn!;
      const legal = enumerateLegalPlays(
        {
          gameIndex: engine.phase.gameIndex,
          seats: engine.members.map((member) => member.id),
          gameSeed: `${engine.setSeed}:${engine.phase.gameIndex}`,
          ruleChain: engine.ruleChain,
        },
        engine.currentGame!,
        memberId,
      );
      const transition = rooms.apply(created.value.roomId, {
        type: 'autoAct',
        memberId,
        turnSeq: state.turnSeq,
        cards: legal[0]?.cards.map((card) => card.id) ?? null,
        reason: 'ai',
        now: 10_001 + step,
      });
      expect(transition?.accepted).toBe(true);
    }

    const replacement = await connect(harness, owner.ready.userToken);
    const membership = rooms.findByUser(owner.ready.userId)!;
    expect(replacement.ready.room).toEqual(
      viewFor(membership.room, membership.member.memberId, {
        reconnect: true,
      }),
    );
    expect(replacement.ready.room?.events).toEqual([]);
    expect(replacement.ready.room?.v).toBeGreaterThan(disconnectedView.v);
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

  it('playingで最後の人間が明示leaveするとabandonedで閉じる', async () => {
    const harness = await createHarness();
    const owner = await connect(harness);
    await emitAck<'room:create', { roomId: string; inviteCode: string }>(
      owner.client,
      'room:create',
      {},
    );
    await emitAck<'room:start', Record<string, never>>(
      owner.client,
      'room:start',
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
    await expect(closed).resolves.toEqual({ reason: 'abandoned' });
  });

  it('drain開始後は新規roomを拒否し、進行中roomの終了まで待つ', async () => {
    const harness = await createHarness({
      timers: {
        setTimer: () => ({ fake: true }),
        clearTimer: () => {},
      },
    });
    const owner = await connect(harness);
    const newcomer = await connect(harness);
    await emitAck<'room:create', { roomId: string; inviteCode: string }>(
      owner.client,
      'room:create',
      {},
    );
    await emitAck<'room:start', Record<string, never>>(
      owner.client,
      'room:start',
      {},
    );

    let drained = false;
    const drain = harness.gateway.beginDrain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    await expect(
      emitAck<'room:create', { roomId: string; inviteCode: string }>(
        newcomer.client,
        'room:create',
        {},
      ),
    ).resolves.toEqual({
      ok: false,
      code: 'INTERNAL',
      message: 'server is draining',
    });

    await emitAck<'room:leave', Record<string, never>>(
      owner.client,
      'room:leave',
      {},
    );
    await drain;
    expect(drained).toBe(true);
  });

  it('同一IPのjoin総当たりを設定上限で拒否する', async () => {
    const harness = await createHarness({
      joinRateLimit: { maxAttempts: 2, windowMs: 60_000 },
    });
    const client = await connect(harness);
    const first = await emitAck<'room:join', { roomId: string }>(
      client.client,
      'room:join',
      { inviteCode: '11111' },
    );
    const second = await emitAck<'room:join', { roomId: string }>(
      client.client,
      'room:join',
      { inviteCode: '22222' },
    );
    const limited = await emitAck<'room:join', { roomId: string }>(
      client.client,
      'room:join',
      { inviteCode: '33333' },
    );
    expect(first).toEqual({ ok: false, code: 'ROOM_NOT_FOUND' });
    expect(second).toEqual({ ok: false, code: 'ROOM_NOT_FOUND' });
    expect(limited).toEqual({ ok: false, code: 'RATE_LIMITED' });
  });

  it('runtime payload schema違反をドメインエラーと分離してBAD_PAYLOADにする', async () => {
    const harness = await createHarness();
    const client = await connect(harness);
    const badJoin = await emitAck<'room:join', { roomId: string }>(
      client.client,
      'room:join',
      { inviteCode: '12A45' },
    );
    const badPlay = await emitAck<'game:play', Record<string, never>>(
      client.client,
      'game:play',
      { turnSeq: -1, cards: [] },
    );
    expect(badJoin).toEqual({ ok: false, code: 'BAD_PAYLOAD' });
    expect(badPlay).toEqual({ ok: false, code: 'BAD_PAYLOAD' });
  });

  it('1人+AI 3席をSocket/Room/Core/AI scheduler経由でセット結果まで完走する', async () => {
    let id = 0;
    const rooms = new RoomManager({
      now: () => 10_000,
      createRoomId: () => `room-auto-${++id}`,
      createMemberId: () => `member-auto-${++id}`,
      randomIndex: (max) => id++ % max,
      reducer: {
        gamesPerSet: 1,
        turnLimitMs: 0,
        disconnectedTurnLimitMs: 0,
        random: () => 0.999_999,
      },
    });
    const harness = await createHarness({
      rooms,
      timers: {
        aiDelayMinMs: 0,
        aiDelayMaxMs: 0,
        random: () => 0,
      },
      decideTurn: async (state, memberId) => {
        const engine = state.engine!;
        const game = engine.currentGame!;
        const gameIndex =
          engine.phase.name === 'setResult' ? 0 : engine.phase.gameIndex;
        const legal = enumerateLegalPlays(
          {
            gameIndex,
            seats: engine.members.map((member) => member.id),
            gameSeed: `${engine.setSeed}:${gameIndex}`,
            ruleChain: engine.ruleChain,
          },
          game,
          memberId,
        );
        return legal[0]?.cards.map((card) => card.id) ?? null;
      },
    });
    const owner = await connect(harness);
    const created = await emitAck<
      'room:create',
      { roomId: string; inviteCode: string }
    >(owner.client, 'room:create', {});
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const receivedViews: PlayerRoomView[] = [];
    const completed = once<PlayerRoomView>((resolve) => {
      owner.client.on('room:state', (view) => {
        receivedViews.push(view);
        if (view.phase === 'setResult') resolve(view);
      });
    });
    const started = await emitAck<'room:start', Record<string, never>>(
      owner.client,
      'room:start',
      {},
    );
    expect(started).toEqual({ ok: true, value: {} });
    const result = await completed;

    expect(result.setResult?.standings).toHaveLength(4);
    for (const view of receivedViews) {
      expectNoHiddenCardIds(view);
    }
    expect(
      receivedViews.every(
        (view, index) => index === 0 || view.v > receivedViews[index - 1]!.v,
      ),
    ).toBe(true);
    const authority = rooms.get(created.value.roomId);
    expect(authority?.phase).toBe('setResult');
    expect(authority?.engine?.results).toHaveLength(1);
    expect(authority?.turnSeq).toBeGreaterThan(0);
  });
});
