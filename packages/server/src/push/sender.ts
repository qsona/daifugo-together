import type { NotificationView } from '@daifugo/core';
import webpush from 'web-push';

import { NOTIFICATION_TYPE_REGISTRY } from '../notification/registry.js';
import { PushRepository, type StoredPushSubscription } from './repository.js';

export interface PushTransport {
  send(subscription: StoredPushSubscription, payload: string): Promise<void>;
}

export class WebPushTransport implements PushTransport {
  constructor(input: {
    publicKey: string;
    privateKey: string;
    subject: string;
  }) {
    webpush.setVapidDetails(input.subject, input.publicKey, input.privateKey);
  }

  async send(
    subscription: StoredPushSubscription,
    payload: string,
  ): Promise<void> {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      payload,
    );
  }
}

export class FakePushTransport implements PushTransport {
  readonly sent: Array<{
    subscription: StoredPushSubscription;
    payload: string;
  }> = [];
  error: unknown = null;

  async send(
    subscription: StoredPushSubscription,
    payload: string,
  ): Promise<void> {
    if (this.error) throw this.error;
    this.sent.push({ subscription, payload });
  }
}

function isNightInJapan(now: number): boolean {
  const hour = (new Date(now).getUTCHours() + 9) % 24;
  return hour >= 21 || hour < 7;
}

function pushUrl(item: NotificationView): string {
  const url = new URL(item.url, 'https://notification.invalid');
  url.searchParams.set('src', 'push');
  url.searchParams.set('nid', String(item.id));
  return `${url.pathname}${url.search}${url.hash}`;
}

function statusCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) {
    return null;
  }
  return typeof error.statusCode === 'number' ? error.statusCode : null;
}

export class PushSender {
  readonly #repository: PushRepository;
  readonly #transport: PushTransport | undefined;
  readonly #now: () => number;
  readonly #onError: (error: unknown) => void;

  constructor(
    repository: PushRepository,
    options: {
      transport?: PushTransport;
      now?: () => number;
      onError?: (error: unknown) => void;
    } = {},
  ) {
    this.#repository = repository;
    this.#transport = options.transport;
    this.#now = options.now ?? Date.now;
    this.#onError = options.onError ?? (() => undefined);
  }

  async send(userId: string, item: NotificationView): Promise<void> {
    if (!this.#transport) return;
    if (NOTIFICATION_TYPE_REGISTRY[item.type].channel !== 'center_push') return;
    const now = this.#now();
    if (isNightInJapan(now)) return;
    if (!this.#repository.preference(userId, item.type)) return;
    const payload = JSON.stringify({
      type: item.type,
      title: item.title,
      body: item.body,
      url: pushUrl(item),
      notificationId: item.id,
    });
    await Promise.all(
      this.#repository.active(userId).map(async (subscription) => {
        try {
          await this.#transport!.send(subscription, payload);
          this.#repository.markSent(subscription.endpoint, now);
        } catch (error) {
          if (statusCode(error) === 404 || statusCode(error) === 410) {
            this.#repository.revokeEndpoint(subscription.endpoint, now);
            return;
          }
          this.#onError(error);
        }
      }),
    );
  }
}

export { isNightInJapan };
