import type {
  Ack,
  ClientToServerEvents,
  PlayerRoomView,
  RoomCloseReason,
  RoomMode,
  ServerToClientEvents,
} from '@daifugo/core';
import { io, type Socket } from 'socket.io-client';

const TOKEN_KEY = 'daifugo.userToken';
const ACK_TIMEOUT_MS = 8_000;

type MultiplayerSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface MultiplayerState {
  connection: 'connecting' | 'ready' | 'superseded';
  displayName: string | null;
  room: PlayerRoomView | null;
  roomClosedReason: RoomCloseReason | null;
  error: string | null;
}

type Listener = () => void;

export class MultiplayerClient {
  readonly #socket: MultiplayerSocket;
  readonly #storage: Pick<Storage, 'getItem' | 'setItem'>;
  readonly #listeners = new Set<Listener>();
  #state: MultiplayerState = {
    connection: 'connecting',
    displayName: null,
    room: null,
    roomClosedReason: null,
    error: null,
  };

  constructor(
    url: string,
    storage: Pick<Storage, 'getItem' | 'setItem'>,
    socketFactory: (
      url: string,
      options: Parameters<typeof io>[1],
    ) => MultiplayerSocket = io,
  ) {
    this.#storage = storage;
    this.#socket = socketFactory(url, {
      auth: { userToken: storage.getItem(TOKEN_KEY) },
      transports: ['websocket', 'polling'],
      reconnection: true,
    });
    this.#socket.on('session:ready', (session) => {
      this.#storage.setItem(TOKEN_KEY, session.userToken);
      this.#socket.auth = { userToken: session.userToken };
      this.#state = {
        ...this.#state,
        connection: 'ready',
        displayName: session.displayName,
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

  async pass(turnSeq: number): Promise<void> {
    await this.#request((ack) =>
      this.#socket.emit('game:pass', { turnSeq }, ack),
    );
  }

  async sync(): Promise<void> {
    await this.#request((ack) => this.#socket.emit('sync:request', {}, ack));
  }

  close(): void {
    this.#socket.disconnect();
    this.#listeners.clear();
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
}

let browserClient: MultiplayerClient | undefined;

export function getBrowserMultiplayerClient(): MultiplayerClient {
  browserClient ??= new MultiplayerClient(
    window.location.origin,
    window.localStorage,
  );
  return browserClient;
}
