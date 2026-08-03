import type {
  Ack,
  ClientToServerEvents,
  PlayerRoomView,
  RoomCloseReason,
  RoomMode,
  ServerToClientEvents,
} from '@daifugo/core';
import { io, type Socket } from 'socket.io-client';

import { getSafeLocalStorage } from '../browser-storage';

const TOKEN_KEY = 'daifugo.userToken';
const ACK_TIMEOUT_MS = 8_000;

type MultiplayerSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface MultiplayerState {
  connection: 'connecting' | 'ready' | 'superseded';
  displayName: string | null;
  registered: boolean;
  room: PlayerRoomView | null;
  roomClosedReason: RoomCloseReason | null;
  error: string | null;
  unreadNotificationCount?: number;
}

type Listener = () => void;

export class MultiplayerClient {
  readonly #socket: MultiplayerSocket;
  readonly #storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  readonly #listeners = new Set<Listener>();
  #userToken: string | null;
  #state: MultiplayerState = {
    connection: 'connecting',
    displayName: null,
    registered: false,
    room: null,
    roomClosedReason: null,
    error: null,
    unreadNotificationCount: 0,
  };

  constructor(
    url: string,
    storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
    socketFactory: (
      url: string,
      options: Parameters<typeof io>[1],
    ) => MultiplayerSocket = io,
  ) {
    this.#storage = storage;
    this.#userToken = this.#readToken();
    this.#socket = socketFactory(url, {
      auth: { userToken: this.#userToken },
      transports: ['websocket', 'polling'],
      reconnection: true,
    });
    this.#socket.on('session:ready', (session) => {
      this.#userToken = session.userToken;
      this.#writeToken(session.userToken);
      this.#socket.auth = { userToken: session.userToken };
      this.#state = {
        ...this.#state,
        connection: 'ready',
        displayName: session.displayName,
        registered: session.registered,
        room: this.#newerRoom(session.room),
        roomClosedReason: null,
        error: null,
      };
      this.#notify();
    });
    this.#socket.on('room:state', (room) => {
      const next = this.#newerRoom(room);
      if (next === this.#state.room) return;
      this.#state = {
        ...this.#state,
        room: next,
        roomClosedReason: null,
        error: null,
      };
      this.#notify();
    });
    this.#socket.on('room:closed', ({ reason }) => {
      this.#state = {
        ...this.#state,
        room: null,
        roomClosedReason: reason,
      };
      this.#notify();
    });
    this.#socket.on('notification:sync', ({ unreadCount }) => {
      this.#state = { ...this.#state, unreadNotificationCount: unreadCount };
      this.#notify();
    });
    this.#socket.on('notification:new', () => {
      this.#state = {
        ...this.#state,
        unreadNotificationCount: (this.#state.unreadNotificationCount ?? 0) + 1,
      };
      this.#notify();
    });
    this.#socket.on('session:superseded', () => {
      this.#state = { ...this.#state, connection: 'superseded' };
      this.#notify();
    });
    this.#socket.on('disconnect', (reason) => {
      if (
        reason !== 'io client disconnect' &&
        reason !== 'io server disconnect'
      ) {
        this.#state = { ...this.#state, connection: 'connecting' };
        this.#notify();
      }
    });
  }

  snapshot = (): MultiplayerState => this.#state;

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  currentUserToken = (): string | null => this.#userToken;

  async createRoom(mode: RoomMode): Promise<void> {
    await this.#request((ack) =>
      this.#socket.emit('room:create', { mode }, ack),
    );
  }

  async joinRoom(inviteCode: string): Promise<void> {
    await this.#request((ack) =>
      this.#socket.emit('room:join', { inviteCode }, ack),
    );
  }

  async rename(displayName: string): Promise<void> {
    await this.#request((ack) =>
      this.#socket.emit('user:rename', { displayName }, ack),
    );
    this.#state = { ...this.#state, displayName: displayName.trim() };
    this.#notify();
  }

  async leaveRoom(): Promise<void> {
    await this.#request((ack) => this.#socket.emit('room:leave', {}, ack));
    this.#state = { ...this.#state, room: null };
    this.#notify();
  }

  async startRoom(): Promise<void> {
    await this.#request((ack) => this.#socket.emit('room:start', {}, ack));
  }

  async continueRoom(): Promise<void> {
    await this.#request((ack) => this.#socket.emit('room:continue', {}, ack));
  }

  async play(turnSeq: number, cards: string[]): Promise<void> {
    await this.#request((ack) =>
      this.#socket.emit('game:play', { turnSeq, cards }, ack),
    );
  }

  async ruleInput(
    turnSeq: number,
    choiceId: string,
    cardIds: string[],
  ): Promise<void> {
    await this.#request((ack) =>
      this.#socket.emit('game:ruleInput', { turnSeq, choiceId, cardIds }, ack),
    );
  }

  async rulePlayerInput(
    turnSeq: number,
    choiceId: string,
    playerId: string,
  ): Promise<void> {
    await this.#request((ack) =>
      this.#socket.emit('game:ruleInput', { turnSeq, choiceId, playerId }, ack),
    );
  }

  async miniGameInput(
    miniGameId: string,
    input: {
      direction?: 'up' | 'down' | 'left' | 'right' | 'stop';
      throwBomb?: boolean;
    },
  ): Promise<void> {
    await this.#request((ack) =>
      this.#socket.emit('game:miniGameInput', { miniGameId, ...input }, ack),
    );
  }

  async pass(turnSeq: number): Promise<void> {
    await this.#request((ack) =>
      this.#socket.emit('game:pass', { turnSeq }, ack),
    );
  }

  async readyNextGame(): Promise<void> {
    await this.#request((ack) => this.#socket.emit('game:readyNext', {}, ack));
  }

  async sync(): Promise<void> {
    await this.#request((ack) => this.#socket.emit('sync:request', {}, ack));
  }

  close(): void {
    this.#socket.disconnect();
    this.#listeners.clear();
  }

  switchSession(userToken: string | null): void {
    this.#userToken = userToken;
    if (userToken === null) {
      this.#removeToken();
    } else {
      this.#writeToken(userToken);
    }
    this.#socket.auth = { userToken };
    this.#state = {
      ...this.#state,
      connection: 'connecting',
      displayName: null,
      registered: false,
      room: null,
      unreadNotificationCount: 0,
    };
    this.#notify();
    this.#socket.disconnect().connect();
  }

  setUnreadNotificationCount(count: number): void {
    this.#state = {
      ...this.#state,
      unreadNotificationCount: Math.max(0, count),
    };
    this.#notify();
  }

  #newerRoom(incoming: PlayerRoomView | null): PlayerRoomView | null {
    const current = this.#state.room;
    if (
      incoming &&
      current?.roomId === incoming.roomId &&
      incoming.v <= current.v
    ) {
      return current;
    }
    return incoming;
  }

  async #request<T>(emit: (ack: (result: Ack<T>) => void) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        const message = 'サーバーから応答がありません';
        this.#state = { ...this.#state, error: message };
        this.#notify();
        reject(new Error(message));
      }, ACK_TIMEOUT_MS);
      emit((result) => {
        window.clearTimeout(timeout);
        if (result.ok) {
          this.#state = { ...this.#state, error: null };
          this.#notify();
          resolve(result.value);
          return;
        }
        const message = result.message ?? result.code;
        this.#state = { ...this.#state, error: message };
        this.#notify();
        reject(new Error(message));
      });
    });
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }

  #readToken(): string | null {
    try {
      return this.#storage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  #writeToken(token: string): void {
    try {
      this.#storage.setItem(TOKEN_KEY, token);
    } catch {
      // The live socket remains usable even when persistent storage is blocked.
    }
  }

  #removeToken(): void {
    try {
      this.#storage.removeItem(TOKEN_KEY);
    } catch {
      // Logout still switches the live socket to an anonymous session.
    }
  }
}

let browserClient: MultiplayerClient | undefined;

export function getBrowserMultiplayerClient(): MultiplayerClient {
  browserClient ??= new MultiplayerClient(
    window.location.origin,
    getSafeLocalStorage(window),
  );
  return browserClient;
}
