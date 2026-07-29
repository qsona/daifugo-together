import type { Ack, PlayerRoomView, ServerToClientEvents } from '@daifugo/core';
import { describe, expect, it, vi } from 'vitest';

import { MultiplayerClient } from './client';

function room(v: number): PlayerRoomView {
  return {
    v,
    roomId: 'room-1',
    inviteCode: '01234',
    mode: 'community',
    phase: 'waiting',
    members: [
      {
        memberId: 'member-1',
        seatId: null,
        displayName: 'ホスト',
        isAI: false,
        isHost: true,
        connected: true,
        aiActing: false,
        departed: false,
        handCount: null,
        finishedRank: null,
        wantsNextSet: null,
      },
    ],
    you: { memberId: 'member-1', seatId: null },
    activeRules: [],
    game: null,
    setResult: null,
    events: [],
  };
}

class FakeSocket {
  auth: Record<string, unknown> = {};
  readonly handlers = new Map<string, (...args: never[]) => void>();
  readonly emitted: { event: string; payload: unknown }[] = [];

  on(event: string, handler: (...args: never[]) => void): this {
    this.handlers.set(event, handler);
    return this;
  }

  emit(
    event: string,
    payload: unknown,
    ack?: (result: Ack<unknown>) => void,
  ): this {
    this.emitted.push({ event, payload });
    ack?.({ ok: true, value: {} });
    return this;
  }

  disconnect(): this {
    return this;
  }

  connect(): this {
    return this;
  }

  trigger<Event extends keyof ServerToClientEvents>(
    event: Event,
    ...args: Parameters<ServerToClientEvents[Event]>
  ): void {
    this.handlers.get(event)?.(...(args as unknown as never[]));
  }
}

describe('MultiplayerClient', () => {
  it('tokenを保存し、同一roomの古いversionを破棄する', () => {
    const socket = new FakeSocket();
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const client = new MultiplayerClient(
      'http://example.test',
      storage,
      () => socket as never,
    );
    const listener = vi.fn();
    client.subscribe(listener);

    socket.trigger('session:ready', {
      userId: 'user-1',
      userToken: 'persistent-token-0001',
      displayName: 'ホスト',
      registered: false,
      room: room(3),
    });
    socket.trigger('room:state', room(2));

    expect(values.get('daifugo.userToken')).toBe('persistent-token-0001');
    expect(client.currentUserToken()).toBe('persistent-token-0001');
    expect(socket.auth).toEqual({ userToken: 'persistent-token-0001' });
    expect(client.snapshot().room?.v).toBe(3);
    expect(listener).toHaveBeenCalledTimes(1);

    socket.trigger('room:state', room(4));
    expect(client.snapshot().room?.v).toBe(4);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('ack付き操作を送信し、room:closedでローカルroomを破棄する', async () => {
    const socket = new FakeSocket();
    const client = new MultiplayerClient(
      'http://example.test',
      {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
      () => socket as never,
    );
    socket.trigger('session:ready', {
      userId: 'user-1',
      userToken: 'persistent-token-0001',
      displayName: 'ホスト',
      registered: false,
      room: room(1),
    });

    await client.startRoom();
    expect(socket.emitted.at(-1)).toEqual({
      event: 'room:start',
      payload: {},
    });

    socket.trigger('room:closed', { reason: 'abandoned' });
    expect(client.snapshot()).toMatchObject({
      room: null,
      roomClosedReason: 'abandoned',
    });
  });

  it('部屋作成時に選んだモードを送信する', async () => {
    const socket = new FakeSocket();
    const client = new MultiplayerClient(
      'http://example.test',
      {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
      () => socket as never,
    );

    await client.createRoom('basic');

    expect(socket.emitted.at(-1)).toEqual({
      event: 'room:create',
      payload: { mode: 'basic' },
    });
  });

  it('ログイン完了とログアウトでtokenを差し替えて再接続する', () => {
    const socket = new FakeSocket();
    const values = new Map<string, string>();
    const client = new MultiplayerClient(
      'http://example.test',
      {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
      },
      () => socket as never,
    );
    const disconnect = vi.spyOn(socket, 'disconnect');
    const connect = vi.spyOn(socket, 'connect');

    client.switchSession('restored-token');
    expect(values.get('daifugo.userToken')).toBe('restored-token');
    expect(socket.auth).toEqual({ userToken: 'restored-token' });

    client.switchSession(null);
    expect(values.has('daifugo.userToken')).toBe(false);
    expect(socket.auth).toEqual({ userToken: null });
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('storage例外でも接続・token切替・ログアウトを続行する', () => {
    const socket = new FakeSocket();
    const blockedStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };

    const client = new MultiplayerClient(
      'http://example.test',
      blockedStorage,
      () => socket as never,
    );

    expect(() => {
      socket.trigger('session:ready', {
        userId: 'user-1',
        userToken: 'persistent-token-0001',
        displayName: 'ホスト',
        registered: true,
        room: null,
      });
      client.switchSession('restored-token');
      client.switchSession(null);
    }).not.toThrow();
    expect(socket.auth).toEqual({ userToken: null });
  });
});
