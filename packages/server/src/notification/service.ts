import type {
  NotificationListResponse,
  NotificationOpenedVia,
  NotificationType,
  NotificationView,
} from '@daifugo/core';

import type { StoredProposal } from '../proposal/repository.js';
import type { PushSender } from '../push/sender.js';
import { NotificationRepository } from './repository.js';
import type { AnnouncementView } from './repository.js';

export interface NotificationEmitter {
  emitNew(userId: string, item: NotificationView): void;
  sync(userId: string, unreadCount: number): void;
}

export class NotificationService {
  readonly #repository: NotificationRepository;
  readonly #now: () => number;
  readonly #emit: NotificationEmitter;
  readonly #push: Pick<PushSender, 'send'> | undefined;
  readonly #onError: (error: unknown) => void;

  constructor(
    repository: NotificationRepository,
    options: {
      now?: () => number;
      emit?: NotificationEmitter;
      push?: Pick<PushSender, 'send'>;
      onError?: (error: unknown) => void;
    } = {},
  ) {
    this.#repository = repository;
    this.#now = options.now ?? Date.now;
    this.#emit = options.emit ?? {
      emitNew: () => undefined,
      sync: () => undefined,
    };
    this.#push = options.push;
    this.#onError = options.onError ?? (() => undefined);
  }

  publishProposal(
    type: Exclude<NotificationType, 'rule_debut' | 'announcement'>,
    proposal: Pick<StoredProposal, 'id' | 'authorId' | 'name' | 'ruleId'>,
  ): NotificationView | null {
    try {
      const result = this.#repository.create({
        userId: proposal.authorId,
        type,
        payload: {
          proposalId: proposal.id,
          proposalName: proposal.name,
          ...(proposal.ruleId ? { ruleId: proposal.ruleId } : {}),
        },
        dedupeKey: proposal.id,
        now: this.#now(),
      });
      if (!result.created) return result.item;
      try {
        this.#emit.emitNew(proposal.authorId, result.item);
      } catch (error) {
        this.#onError(error);
      }
      void this.#push
        ?.send(proposal.authorId, result.item)
        .catch(this.#onError);
      return result.item;
    } catch (error) {
      this.#onError(error);
      return null;
    }
  }

  publishAnnouncement(input: {
    title: string;
    body: string;
    url: string;
    createdBy: string;
  }): AnnouncementView {
    const result = this.#repository.createAnnouncement({
      ...input,
      now: this.#now(),
    });
    for (const { userId, item } of result.recipients) {
      try {
        this.#emit.emitNew(userId, item);
      } catch (error) {
        this.#onError(error);
      }
      void this.#push?.send(userId, item).catch(this.#onError);
    }
    return result.announcement;
  }

  listAnnouncements(): AnnouncementView[] {
    return this.#repository.listAnnouncements();
  }

  sync(userId: string): number {
    try {
      const count = this.#repository.unreadCount(userId, this.#now());
      this.#safeSync(userId, count);
      return count;
    } catch (error) {
      this.#onError(error);
      return 0;
    }
  }

  list(
    token: string | null,
  ):
    | { status: 200; body: NotificationListResponse }
    | { status: 401; body: { error: 'unauthorized' } } {
    const userId = this.#userId(token);
    if (!userId) return { status: 401, body: { error: 'unauthorized' } };
    return { status: 200, body: this.#repository.list(userId, this.#now()) };
  }

  read(token: string | null, id: number): 204 | 401 | 404 {
    return this.#mutate(token, id, (userId) =>
      this.#repository.markRead(userId, id, this.#now()),
    );
  }

  opened(
    token: string | null,
    id: number,
    via: NotificationOpenedVia,
  ): 204 | 401 | 404 {
    return this.#mutate(token, id, (userId) =>
      this.#repository.markOpened(userId, id, via, this.#now()),
    );
  }

  readAll(token: string | null): 204 | 401 {
    const userId = this.#userId(token);
    if (!userId) return 401;
    this.#repository.markAllRead(userId, this.#now());
    this.#safeSync(userId, 0);
    return 204;
  }

  #userId(token: string | null): string | null {
    return token ? this.#repository.userIdForToken(token) : null;
  }

  #mutate(
    token: string | null,
    id: number,
    operation: (userId: string) => boolean,
  ): 204 | 401 | 404 {
    const userId = this.#userId(token);
    if (!userId) return 401;
    if (!operation(userId)) return 404;
    this.#safeSync(userId, this.#repository.unreadCount(userId));
    return 204;
  }

  #safeSync(userId: string, unreadCount: number): void {
    try {
      this.#emit.sync(userId, unreadCount);
    } catch (error) {
      this.#onError(error);
    }
  }
}
