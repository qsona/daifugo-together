import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SqlitePersistence } from '../persistence.js';
import {
  ProposalRateLimiter,
  type ProposalRateLimitPort,
  type ProposalScreeningGate,
  ProposalSubmissionService,
} from './submission.js';

const instances: SqlitePersistence[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const instance of instances.splice(0)) instance.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function setup(
  options: {
    screening?: ProposalScreeningGate;
    rateLimiter?: ProposalRateLimitPort;
    now?: () => number;
    createId?: (now: number) => string;
  } = {},
) {
  const persistence = new SqlitePersistence(':memory:', {
    createUserId: () => 'author',
    createToken: () => 'proposal-token-valid',
  });
  instances.push(persistence);
  const session = persistence.sessions.resolve(undefined);
  const service = new ProposalSubmissionService(persistence.proposals, options);
  return { persistence, session, service };
}

const validBody = {
  kind: 'local',
  prefectureCode: null,
  name: '8切り',
  body: '8を出すと場が流れる。',
};

describe('ProposalSubmissionService', () => {
  it('認証→レート制限→検証→重複→検査の順で止める', async () => {
    const consume = vi.fn(() => true);
    const inspect = vi.fn(() => ({ verdict: 'pass' as const }));
    const { session, service } = setup({
      rateLimiter: { consume },
      screening: { inspect },
      now: () => 1_000,
      createId: () => 'ORDERED00000000000000000000',
    });

    await expect(
      service.submit({ token: null, ip: 'ip', body: validBody }),
    ).resolves.toMatchObject({ status: 401 });
    await expect(
      service.submit({ token: 'unknown-token', ip: 'ip', body: validBody }),
    ).resolves.toMatchObject({ status: 401 });
    expect(consume).not.toHaveBeenCalled();

    await expect(
      service.submit({
        token: session.userToken,
        ip: 'ip',
        body: { ...validBody, body: '' },
      }),
    ).resolves.toMatchObject({ status: 400 });
    expect(consume).toHaveBeenCalledTimes(1);
    expect(inspect).not.toHaveBeenCalled();

    await expect(
      service.submit({
        token: session.userToken,
        ip: 'ip',
        body: validBody,
      }),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      service.submit({
        token: session.userToken,
        ip: 'ip',
        body: validBody,
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        outcome: 'accepted',
        proposal: { id: 'ORDERED00000000000000000000' },
      },
    });
    expect(consume).toHaveBeenCalledTimes(3);
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it('soft/card遮断と検査不能ではproposalを作らない', async () => {
    const softCommit = vi.fn(() => ({
      verdict: 'soft' as const,
      reasonKey: 'generic' as const,
      message: '言い換えてください',
    }));
    const cardCommit = vi.fn(() => ({
      verdict: 'card' as const,
      card: { active: 1 as const, limit: 2 as const },
      suspension: null,
    }));
    const outcomes = [
      {
        verdict: 'blocked' as const,
        commit: softCommit,
      },
      {
        verdict: 'blocked' as const,
        commit: cardCommit,
      },
      { verdict: 'unavailable' as const },
    ];
    const { persistence, session, service } = setup({
      screening: { inspect: () => outcomes.shift()! },
      createId: () => 'BLOCKED0000000000000000000',
    });

    await expect(
      service.submit({
        token: session.userToken,
        ip: 'ip',
        body: validBody,
      }),
    ).resolves.toEqual({
      status: 200,
      body: {
        outcome: 'blocked',
        yellowCard: {
          verdict: 'soft',
          reasonKey: 'generic',
          message: '言い換えてください',
        },
      },
    });
    expect(softCommit).toHaveBeenCalledOnce();
    await expect(
      service.submit({
        token: session.userToken,
        ip: 'ip',
        body: { ...validBody, name: '危険なルール' },
      }),
    ).resolves.toEqual({
      status: 200,
      body: {
        outcome: 'blocked',
        yellowCard: {
          verdict: 'card',
          card: { active: 1, limit: 2 },
          suspension: null,
        },
      },
    });
    expect(cardCommit).toHaveBeenCalledOnce();
    await expect(
      service.submit({
        token: session.userToken,
        ip: 'ip',
        body: { ...validBody, name: '別ルール' },
      }),
    ).resolves.toEqual({
      status: 503,
      body: { error: 'check_unavailable' },
    });
    expect(
      persistence.proposals.queue({ eligibleIds: () => new Set(['any']) }),
    ).toEqual([]);
  });

  it('pass検査の確定callbackが失敗するとproposal INSERTもrollbackする', async () => {
    const { persistence, session, service } = setup({
      screening: {
        inspect: () => ({
          verdict: 'pass',
          commit: () => {
            throw new Error('check commit failed');
          },
        }),
      },
      createId: () => 'ROLLBACK000000000000000000',
    });

    await expect(
      service.submit({
        token: session.userToken,
        ip: 'ip',
        body: validBody,
      }),
    ).rejects.toThrow('check commit failed');
    expect(
      persistence.proposals.queue({
        eligibleIds: (items) => new Set(items.map((item) => item.id)),
      }),
    ).toEqual([]);
  });

  it('並行した同一送信をUNIQUE競合後も同じ1件として返す', async () => {
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = 0;
    const { persistence, session, service } = setup({
      screening: {
        inspect: async () => {
          entered += 1;
          await barrier;
          return { verdict: 'pass' };
        },
      },
      createId: (() => {
        let sequence = 0;
        return () => `CONCURRENT-${String(++sequence)}`;
      })(),
    });
    const input = {
      token: session.userToken,
      ip: 'ip',
      body: validBody,
    };
    const first = service.submit(input);
    const second = service.submit(input);
    await vi.waitFor(() => expect(entered).toBe(2));
    release!();

    const results = await Promise.all([first, second]);
    expect(results).toEqual([
      expect.objectContaining({
        body: expect.objectContaining({
          proposal: expect.objectContaining({ id: 'CONCURRENT-1' }),
        }),
      }),
      expect.objectContaining({
        body: expect.objectContaining({
          proposal: expect.objectContaining({ id: 'CONCURRENT-1' }),
        }),
      }),
    ]);
    expect(
      persistence.proposals.queue({
        eligibleIds: (items) => new Set(items.map((item) => item.id)),
      }),
    ).toHaveLength(1);
  });

  it('同じ内容でも投稿者が異なれば別の提案として保存する', async () => {
    let userSequence = 0;
    let tokenSequence = 0;
    let proposalSequence = 0;
    const persistence = new SqlitePersistence(':memory:', {
      createUserId: () => `author-${String(++userSequence)}`,
      createToken: () =>
        `proposal-token-${String(++tokenSequence).padStart(4, '0')}`,
    });
    instances.push(persistence);
    const firstAuthor = persistence.sessions.resolve(undefined);
    const secondAuthor = persistence.sessions.resolve(undefined);
    const service = new ProposalSubmissionService(persistence.proposals, {
      createId: () => `AUTHOR-${String(++proposalSequence)}`,
    });

    const [first, second] = await Promise.all([
      service.submit({
        token: firstAuthor.userToken,
        ip: 'ip-1',
        body: validBody,
      }),
      service.submit({
        token: secondAuthor.userToken,
        ip: 'ip-2',
        body: validBody,
      }),
    ]);

    expect(first.body).toMatchObject({
      outcome: 'accepted',
      proposal: { id: 'AUTHOR-1' },
    });
    expect(second.body).toMatchObject({
      outcome: 'accepted',
      proposal: { id: 'AUTHOR-2' },
    });
    expect(
      persistence.proposals.queue({
        eligibleIds: (items) => new Set(items.map((item) => item.id)),
      }),
    ).toHaveLength(2);
  });

  it('多言語・絵文字・改行を壊さずSQLiteから読み戻す', async () => {
    const { persistence, session, service } = setup({
      now: () => 5_000,
      createId: () => 'UNICODE00000000000000000000',
    });
    const body = '日本語とEnglish 👨‍👩‍👧‍👦\n次の行もそのまま残す。';

    await expect(
      service.submit({
        token: session.userToken,
        ip: 'ip',
        body: {
          kind: 'original',
          name: '家族ルール👨‍👩‍👧‍👦',
          body,
        },
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: { outcome: 'accepted' },
    });

    expect(
      persistence.proposals.queue({
        eligibleIds: (items) => new Set(items.map((item) => item.id)),
      }),
    ).toEqual([
      expect.objectContaining({
        id: 'UNICODE00000000000000000000',
        name: '家族ルール👨‍👩‍👧‍👦',
        body,
      }),
    ]);
  });
});

describe('ProposalRateLimiter', () => {
  it('ユーザー5件/時とIP 20件/時の境界をsliding windowで適用する', () => {
    const limiter = new ProposalRateLimiter();
    for (let index = 0; index < 5; index += 1) {
      expect(limiter.consume('user', 'ip', index)).toBe(true);
    }
    expect(limiter.consume('user', 'ip', 5)).toBe(false);
    expect(limiter.consume('user', 'ip', 60 * 60 * 1_000)).toBe(true);

    const sharedIpLimiter = new ProposalRateLimiter();
    for (let index = 0; index < 20; index += 1) {
      expect(
        sharedIpLimiter.consume(`user-${String(index)}`, 'shared', 0),
      ).toBe(true);
    }
    expect(sharedIpLimiter.consume('user-21', 'shared', 0)).toBe(false);
  });

  it('ユーザー20件/日の境界を適用し、1日後に解放する', () => {
    const limiter = new ProposalRateLimiter();
    for (let hour = 0; hour < 4; hour += 1) {
      const base = hour * (60 * 60 * 1_000 + 1);
      for (let index = 0; index < 5; index += 1) {
        expect(
          limiter.consume('user', `ip-${String(hour)}`, base + index),
        ).toBe(true);
      }
    }
    expect(limiter.consume('user', 'new-ip', 4 * (60 * 60 * 1_000 + 1))).toBe(
      false,
    );
    expect(limiter.consume('user', 'new-ip', 24 * 60 * 60 * 1_000 + 10)).toBe(
      true,
    );
  });
});

describe('proposal persistence constraints', () => {
  it('停止期限列がある場合は検証や検査より先に403を返す', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'proposal-suspended-'));
    directories.push(directory);
    const path = join(directory, 'db.sqlite');
    const persistence = new SqlitePersistence(path, {
      createUserId: () => 'suspended-author',
      createToken: () => 'proposal-token-suspended',
    });
    instances.push(persistence);
    const session = persistence.sessions.resolve(undefined);
    const sqlite = new Database(path);
    sqlite
      .prepare(
        'UPDATE users SET proposal_suspended_until = ? WHERE user_id = ?',
      )
      .run(20_000, session.userId);
    sqlite.close();
    const consume = vi.fn(() => true);
    const inspect = vi.fn(() => ({ verdict: 'pass' as const }));
    const service = new ProposalSubmissionService(persistence.proposals, {
      now: () => 10_000,
      rateLimiter: { consume },
      screening: { inspect },
    });

    await expect(
      service.submit({
        token: session.userToken,
        ip: 'ip',
        body: { bad: true },
      }),
    ).resolves.toEqual({
      status: 403,
      body: { error: 'proposal_suspended', suspendedUntil: 20_000 },
    });
    expect(consume).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
  });

  it('DB CHECKでもoriginal+都道府県を拒否する', () => {
    const directory = mkdtempSync(join(tmpdir(), 'proposal-check-'));
    directories.push(directory);
    const path = join(directory, 'db.sqlite');
    const persistence = new SqlitePersistence(path);
    instances.push(persistence);
    const session = persistence.sessions.resolve(undefined);
    const sqlite = new Database(path);
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO proposals (
             id, author_id, kind, prefecture_code, name, body, status,
             attempt_count, content_hash, created_at, status_changed_at, updated_at
           ) VALUES (?, ?, 'original', '13', '名前', '本文', 'screening', 0, 'hash', 1, 1, 1)`,
        )
        .run('invalid', session.userId),
    ).toThrow(/CHECK constraint failed/);
    sqlite.close();
  });
});
