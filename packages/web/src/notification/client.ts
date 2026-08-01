import type {
  NotificationListResponse,
  NotificationOpenedVia,
} from '@daifugo/core';

import { getSafeLocalStorage } from '../browser-storage';

const TOKEN_KEY = 'daifugo.userToken';

export class NotificationClient {
  readonly #baseUrl: string;
  readonly #storage: Pick<Storage, 'getItem'>;
  readonly #fetch: typeof fetch;

  constructor(
    baseUrl: string,
    storage: Pick<Storage, 'getItem'>,
    fetcher: typeof fetch = fetch,
  ) {
    this.#baseUrl = baseUrl;
    this.#storage = storage;
    this.#fetch = (...args) => fetcher(...args);
  }

  async list(): Promise<NotificationListResponse> {
    const response = await this.#request('/api/notifications');
    return (await response.json()) as NotificationListResponse;
  }

  async read(id: number): Promise<void> {
    await this.#request(`/api/notifications/${String(id)}/read`, {
      method: 'POST',
    });
  }

  async opened(id: number, via: NotificationOpenedVia): Promise<void> {
    await this.#request(`/api/notifications/${String(id)}/opened`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ via }),
    });
  }

  async readAll(): Promise<void> {
    await this.#request('/api/notifications/read-all', { method: 'POST' });
  }

  async #request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = this.#storage.getItem(TOKEN_KEY);
    if (!token) throw new Error('unauthorized');
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}` },
    });
    if (!response.ok)
      throw new Error(`notification_api_${String(response.status)}`);
    return response;
  }
}

let browserClient: NotificationClient | undefined;

export function getBrowserNotificationClient(): NotificationClient {
  browserClient ??= new NotificationClient(
    window.location.origin,
    getSafeLocalStorage(window),
  );
  return browserClient;
}
