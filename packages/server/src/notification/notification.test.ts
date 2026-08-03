import { describe, expect, it, vi } from 'vitest';

import { SqlitePersistence } from '../persistence.js';
import { proposalContentHash } from '../proposal/repository.js';
import { NotificationService } from './service.js';

function proposal(
  persistence: SqlitePersistence,
  authorId: string,
  id: string,
  name: string,
  now: number,
) {
  const value = {
    kind: 'original' as const,
    prefectureCode: null,
    name,
    body: `${name}の内容`,
  };
  persistence.proposals.create({
    id,
    authorId,
    proposal: value,
    contentHash: proposalContentHash(value),
    now,
    commitSignals: () => undefined,
  });
  return persistence.proposals.findById(id)!;
}

describe('E16 notification center', () => {
  it('個人通知を冪等に保存し、既読と流入元を本人だけ更新する', () => {
    const persistence = new SqlitePersistence(':memory:');
    const owner = persistence.sessions.resolve(undefined);
    const stranger = persistence.sessions.resolve(undefined);
    const stored = proposal(
      persistence,
      owner.userId,
      'proposal-notify',
      '革命',
      10,
    );
    const emitNew = vi.fn();
    const sync = vi.fn();
    const service = new NotificationService(persistence.notifications, {
      now: () => 20,
      emit: { emitNew, sync },
    });

    const first = service.publishProposal('proposal_implementing', stored);
    const duplicate = service.publishProposal('proposal_implementing', stored);
    expect(duplicate?.id).toBe(first?.id);
    expect(emitNew).toHaveBeenCalledTimes(1);

    const listed = service.list(owner.userToken);
    expect(listed.status).toBe(200);
    if (listed.status !== 200 || !first) return;
    expect(listed.body).toMatchObject({
      unreadCount: 1,
      items: [
        {
          type: 'proposal_implementing',
          title: 'ルールを作りはじめました',
          url: '/proposals/mine',
          readAt: null,
        },
      ],
    });
    expect(service.read(stranger.userToken, first.id)).toBe(404);
    expect(service.opened(owner.userToken, first.id, 'push')).toBe(204);
    const opened = service.list(owner.userToken);
    expect(opened.status === 200 ? opened.body.items[0] : null).toMatchObject({
      readAt: 20,
      openedAt: 20,
      openedVia: 'push',
    });
    persistence.close();
  });

  it('新ルールを初回同期後に最大10件ずつ遅延実体化し、自分のルールを除く', () => {
    const now = 100;
    const persistence = new SqlitePersistence(':memory:');
    const reader = persistence.sessions.resolve(undefined);
    const author = persistence.sessions.resolve(undefined);
    const service = new NotificationService(persistence.notifications, {
      now: () => now,
    });
    expect(service.list(reader.userToken)).toMatchObject({
      status: 200,
      body: { items: [], unreadCount: 0 },
    });

    for (let index = 0; index < 12; index += 1) {
      const self = index === 0;
      const stored = proposal(
        persistence,
        self ? reader.userId : author.userId,
        `proposal-debut-${String(index)}`,
        `新ルール${String(index)}`,
        now,
      );
      persistence.rules.register({
        id: `r-debut-${String(index)}`,
        slug: `debut-${String(index)}`,
        name: stored.name,
        description: stored.body,
        kind: 'original',
        prefecture: null,
        proposalId: stored.id,
        status: 'active',
        disabledReason: null,
        now,
      });
    }
    const firstPage = service.list(reader.userToken);
    const secondPage = service.list(reader.userToken);
    expect(firstPage.status === 200 ? firstPage.body.items : []).toHaveLength(
      9,
    );
    expect(secondPage.status === 200 ? secondPage.body.items : []).toHaveLength(
      11,
    );
    expect(
      secondPage.status === 200
        ? secondPage.body.items.some(
            ({ payload }) => payload.ruleId === 'r-debut-0',
          )
        : true,
    ).toBe(false);
    expect(
      secondPage.status === 200
        ? secondPage.body.items.find(
            ({ payload }) => payload.ruleId === 'r-debut-11',
          )?.url
        : null,
    ).toBe('/rules?rule=r-debut-11');
    persistence.close();
  });

  it('通知側の失敗を発行元へ投げ返さない', () => {
    const persistence = new SqlitePersistence(':memory:');
    const owner = persistence.sessions.resolve(undefined);
    const stored = proposal(
      persistence,
      owner.userId,
      'proposal-safe',
      '安全',
      1,
    );
    const send = vi.fn(async () => undefined);
    const service = new NotificationService(persistence.notifications, {
      push: { send },
      emit: {
        emitNew: () => {
          throw new Error('socket failed');
        },
        sync: () => undefined,
      },
    });
    expect(() =>
      service.publishProposal('proposal_rejected', stored),
    ).not.toThrow();
    expect(send).toHaveBeenCalledOnce();
    persistence.close();
  });

  it('管理者のお知らせを送信時点の全ユーザーへ保存して配信する', () => {
    const persistence = new SqlitePersistence(':memory:');
    const first = persistence.sessions.resolve(undefined);
    const second = persistence.sessions.resolve(undefined);
    const emitNew = vi.fn();
    const send = vi.fn(async () => undefined);
    const service = new NotificationService(persistence.notifications, {
      now: () => 1_000,
      emit: { emitNew, sync: vi.fn() },
      push: { send },
    });

    const announcement = service.publishAnnouncement({
      title: 'メンテナンスのお知らせ',
      body: '本日20時から短時間のメンテナンスを行います。',
      url: '/notifications',
      createdBy: 'admin@example.com',
    });

    expect(announcement).toMatchObject({
      id: 1,
      recipientCount: 2,
      createdBy: 'admin@example.com',
    });
    for (const session of [first, second]) {
      expect(service.list(session.userToken)).toMatchObject({
        status: 200,
        body: {
          unreadCount: 1,
          items: [
            {
              type: 'announcement',
              title: 'メンテナンスのお知らせ',
              body: '本日20時から短時間のメンテナンスを行います。',
              url: '/notifications',
            },
          ],
        },
      });
    }
    expect(emitNew).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(service.listAnnouncements()).toEqual([announcement]);
    persistence.close();
  });
});
