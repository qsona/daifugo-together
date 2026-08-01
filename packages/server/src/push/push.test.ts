import type { NotificationView } from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { SqlitePersistence } from '../persistence.js';
import { proposalContentHash } from '../proposal/repository.js';
import { NotificationService } from '../notification/service.js';
import { FakePushTransport, PushSender, isNightInJapan } from './sender.js';
import { PushService } from './service.js';

function item(type: NotificationView['type']): NotificationView {
  return {
    id: 42,
    type,
    payload: { proposalName: '革命' },
    title: '提案がルールになったよ！',
    body: '「革命」が、みんなの対局で遊べるようになりました。',
    url: '/proposals/mine',
    priority: 'highest',
    createdAt: 1,
    readAt: null,
    openedAt: null,
    openedVia: null,
  };
}

describe('E17 Web Push', () => {
  it('JSTの21:00〜7:00だけを夜間として抑止する', () => {
    expect(isNightInJapan(Date.UTC(2026, 7, 1, 11, 59))).toBe(false); // 20:59
    expect(isNightInJapan(Date.UTC(2026, 7, 1, 12, 0))).toBe(true); // 21:00
    expect(isNightInJapan(Date.UTC(2026, 7, 1, 21, 59))).toBe(true); // 06:59
    expect(isNightInJapan(Date.UTC(2026, 7, 1, 22, 0))).toBe(false); // 07:00
  });

  it('登録済みユーザーのON種別だけを送り、センターと同じ文面・opened URLを使う', async () => {
    const persistence = new SqlitePersistence(':memory:');
    const session = persistence.sessions.resolve(undefined);
    persistence.auth.complete(session.userId, 'google-push', 1);
    persistence.push.upsert(
      session.userId,
      { endpoint: 'https://push.example.test/1', p256dh: 'key', auth: 'auth' },
      2,
    );
    persistence.push.setPreferences(
      session.userId,
      { proposal_released: true },
      2,
    );
    const transport = new FakePushTransport();
    const sender = new PushSender(persistence.push, {
      transport,
      now: () => Date.UTC(2026, 7, 1, 3, 0), // JST 12:00
    });
    await sender.send(session.userId, item('proposal_released'));
    await sender.send(session.userId, item('proposal_implementing'));
    expect(transport.sent).toHaveLength(1);
    expect(JSON.parse(transport.sent[0]!.payload)).toEqual({
      type: 'proposal_released',
      title: '提案がルールになったよ！',
      body: '「革命」が、みんなの対局で遊べるようになりました。',
      url: '/proposals/mine?src=push&nid=42',
      notificationId: 42,
    });
    persistence.close();
  });

  it('通知センターへの発行と同じ表示ソースからPushを送る', async () => {
    const persistence = new SqlitePersistence(':memory:');
    const session = persistence.sessions.resolve(undefined);
    persistence.auth.complete(session.userId, 'google-shared-source', 1);
    const value = {
      kind: 'original' as const,
      prefectureCode: null,
      name: '革命',
      body: '革命の内容',
    };
    persistence.proposals.create({
      id: 'proposal-shared-source',
      authorId: session.userId,
      proposal: value,
      contentHash: proposalContentHash(value),
      now: 1,
      commitSignals: () => undefined,
    });
    const proposal = persistence.proposals.findById('proposal-shared-source')!;
    persistence.push.upsert(
      session.userId,
      {
        endpoint: 'https://push.example.test/shared',
        p256dh: 'key',
        auth: 'auth',
      },
      2,
    );
    persistence.push.setPreferences(
      session.userId,
      { proposal_released: true },
      2,
    );
    const transport = new FakePushTransport();
    const notifications = new NotificationService(persistence.notifications, {
      now: () => 3,
      push: new PushSender(persistence.push, {
        transport,
        now: () => Date.UTC(2026, 7, 1, 3, 0),
      }),
    });

    const centerItem = notifications.publishProposal(
      'proposal_released',
      proposal,
    );
    await expect.poll(() => transport.sent.length).toBe(1);
    const payload = JSON.parse(transport.sent[0]!.payload) as {
      title: string;
      body: string;
    };
    expect(payload).toMatchObject({
      title: centerItem?.title,
      body: centerItem?.body,
    });
    persistence.close();
  });

  it('夜間と設定OFFでは送らず、購読と初期設定を冪等に扱う', async () => {
    const persistence = new SqlitePersistence(':memory:');
    const session = persistence.sessions.resolve(undefined);
    persistence.auth.complete(session.userId, 'google-gates', 1);
    const subscription = {
      endpoint: 'https://push.example.test/gates',
      p256dh: 'key',
      auth: 'auth',
    };
    persistence.push.upsert(session.userId, subscription, 1);
    persistence.push.upsert(
      session.userId,
      { ...subscription, p256dh: 'updated-key' },
      2,
    );
    expect(persistence.push.active(session.userId)).toEqual([
      { ...subscription, p256dh: 'updated-key' },
    ]);
    expect(
      persistence.push.preferences(session.userId, [
        'proposal_released',
        'proposal_failed',
      ]),
    ).toEqual({ proposal_released: false, proposal_failed: false });
    const transport = new FakePushTransport();
    const daySender = new PushSender(persistence.push, {
      transport,
      now: () => Date.UTC(2026, 7, 1, 3, 0),
    });
    await daySender.send(session.userId, item('proposal_released'));
    persistence.push.setPreferences(
      session.userId,
      { proposal_released: true },
      3,
    );
    const nightSender = new PushSender(persistence.push, {
      transport,
      now: () => Date.UTC(2026, 7, 1, 12, 0),
    });
    await nightSender.send(session.userId, item('proposal_released'));
    expect(transport.sent).toEqual([]);
    persistence.close();
  });

  it('失効410を無効化し、未登録ユーザーと未設定環境をAPIで拒否する', async () => {
    const persistence = new SqlitePersistence(':memory:');
    const registered = persistence.sessions.resolve(undefined);
    const anonymous = persistence.sessions.resolve(undefined);
    persistence.auth.complete(registered.userId, 'google-push-410', 1);
    persistence.push.upsert(
      registered.userId,
      {
        endpoint: 'https://push.example.test/gone',
        p256dh: 'key',
        auth: 'auth',
      },
      2,
    );
    persistence.push.setPreferences(
      registered.userId,
      { proposal_released: true },
      2,
    );
    const transport = new FakePushTransport();
    transport.error = { statusCode: 410 };
    const sender = new PushSender(persistence.push, {
      transport,
      now: () => Date.UTC(2026, 7, 1, 3, 0),
    });
    await sender.send(registered.userId, item('proposal_released'));
    expect(persistence.push.active(registered.userId)).toEqual([]);

    const available = new PushService(persistence.push, {
      publicKey: 'public',
    });
    expect(
      available.subscribe(anonymous.userToken, {
        endpoint: 'https://push.example.test/anonymous',
        keys: { p256dh: 'key', auth: 'auth' },
      }),
    ).toMatchObject({ status: 403, body: { error: 'registration_required' } });
    const unavailable = new PushService(persistence.push, { available: false });
    expect(unavailable.getPreferences(registered.userToken)).toMatchObject({
      status: 503,
      body: { error: 'push_unavailable' },
    });
    persistence.close();
  });

  it('ホーム画面アプリからの起動は匿名でも記録し、初回時刻を保つ', () => {
    const persistence = new SqlitePersistence(':memory:');
    const anonymous = persistence.sessions.resolve(undefined);
    let now = 100;
    const service = new PushService(persistence.push, {
      publicKey: 'public',
      now: () => now,
    });
    const seenAt = () => persistence.push.installedAt(anonymous.userId);

    expect(service.markInstalled(anonymous.userToken)).toMatchObject({
      status: 204,
    });
    expect(seenAt()).toBe(100);
    now = 200;
    expect(service.markInstalled(anonymous.userToken)).toMatchObject({
      status: 204,
    });
    expect(seenAt()).toBe(100);
    expect(service.markInstalled('unknown-token')).toMatchObject({
      status: 401,
      body: { error: 'unauthorized' },
    });
    expect(
      new PushService(persistence.push, { available: false }).markInstalled(
        anonymous.userToken,
      ),
    ).toMatchObject({ status: 503, body: { error: 'push_unavailable' } });
    persistence.close();
  });
});
