import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

import { SqlitePersistence } from '../persistence.js';

const instances: Array<{
  directory: string;
  raw: Database.Database;
  persistence: SqlitePersistence;
}> = [];

afterEach(() => {
  for (const instance of instances.splice(0)) {
    instance.raw.close();
    instance.persistence.close();
    rmSync(instance.directory, { recursive: true, force: true });
  }
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'daifugo-admin-repository-'));
  const path = join(directory, 'admin.sqlite');
  const persistence = new SqlitePersistence(path);
  const raw = new Database(path);
  instances.push({ directory, raw, persistence });
  raw
    .prepare(
      `INSERT INTO users (
         user_id, user_token, display_name, google_sub, registered_at, created_at
       ) VALUES
         ('registered-user', 'registered-token-000001', '登録ユーザー',
          'google-subject', 1699999999000, 1699999998000),
         ('guest-user', 'guest-token-0000000001', 'ゲストユーザー',
          NULL, NULL, 1699999997000)`,
    )
    .run();
  raw
    .prepare(
      `INSERT INTO proposals (
         id, proposal_number, author_id, kind, prefecture_code, name, body,
         status, reason_code, reason_text, rule_id, attempt_count, content_hash,
         created_at, status_changed_at, updated_at
       ) VALUES (
         'proposal-1', 1, 'registered-user', 'original', NULL, '革命返し',
         '革命中に革命を返せる。', 'screening', NULL, NULL, NULL, 0,
         'proposal-hash-1', 1699999999000, 1699999999000, 1699999999000
       )`,
    )
    .run();
  return persistence;
}

describe('AdminRepository', () => {
  test('提案一覧へステータス・提案者・本文を返す', () => {
    const repository = fixture().admin;

    expect(repository.proposals({ status: 'screening' })).toMatchObject({
      total: 1,
      items: [
        {
          number: 1,
          name: '革命返し',
          body: '革命中に革命を返せる。',
          status: 'screening',
          author: {
            id: 'registered-user',
            displayName: '登録ユーザー',
            registered: true,
          },
        },
      ],
    });
    expect(repository.proposals({ query: '見つからない' }).total).toBe(0);
  });

  test('ユーザー一覧を登録状態で絞り、秘密値を返さない', () => {
    const repository = fixture().admin;

    const registered = repository.users({ registration: 'registered' });
    expect(registered).toMatchObject({
      total: 1,
      items: [
        {
          id: 'registered-user',
          displayName: '登録ユーザー',
          registered: true,
          proposalCount: 1,
        },
      ],
    });
    expect(JSON.stringify(registered)).not.toContain('registered-token');
    expect(JSON.stringify(registered)).not.toContain('google-subject');
    expect(repository.users({ registration: 'guest' }).total).toBe(1);
  });

  test('概要へ既存運用指標とユーザー・提案集計をまとめる', () => {
    const repository = fixture().admin;

    expect(repository.overview(1_700_000_000_000)).toMatchObject({
      proposals: {
        total: 1,
        byStatus: { screening: 1 },
      },
      users: { total: 2, registered: 1, guests: 1 },
      rules: { active: 0 },
      queue: { screening: 1, implementation: 0 },
    });
  });
});
