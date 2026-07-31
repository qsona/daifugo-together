import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  importProposalData,
  LOCAL_GOD_USER,
  validatePayload,
} from '../../../scripts/sync-production-proposals-lib.mjs';

const databases: Database.Database[] = [];

function testDatabase(): Database.Database {
  const database = new Database(':memory:');
  databases.push(database);
  database.exec(`
    CREATE TABLE users (
      user_id TEXT PRIMARY KEY,
      user_token TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      google_sub TEXT,
      registered_at INTEGER,
      proposals_seen_at INTEGER,
      proposal_suspended_until INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE proposals (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL REFERENCES users(user_id),
      name TEXT NOT NULL
    );
    CREATE TABLE proposal_signal_checks (
      proposal_id TEXT PRIMARY KEY REFERENCES proposals(id),
      user_id TEXT NOT NULL REFERENCES users(user_id)
    );
    CREATE TABLE proposal_checks (
      id INTEGER PRIMARY KEY,
      proposal_id TEXT REFERENCES proposals(id),
      user_id TEXT NOT NULL REFERENCES users(user_id)
    );
    CREATE TABLE judgements (
      id INTEGER PRIMARY KEY,
      proposal_id TEXT NOT NULL REFERENCES proposals(id),
      source_check_id INTEGER REFERENCES proposal_checks(id),
      actor TEXT
    );
    CREATE TABLE pipeline_jobs (
      id INTEGER PRIMARY KEY,
      proposal_id TEXT NOT NULL UNIQUE REFERENCES proposals(id)
    );
  `);
  return database;
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe('production proposal sync', () => {
  it('提案者・検査ユーザー・判定者をローカル神ユーザーへ置き換える', () => {
    const database = testDatabase();
    const counts = importProposalData(database, {
      formatVersion: 1,
      tables: {
        proposals: [
          { id: 'proposal-1', author_id: 'production-user', name: '8切り' },
        ],
        proposal_signal_checks: [
          { proposal_id: 'proposal-1', user_id: 'production-user' },
        ],
        proposal_checks: [
          {
            id: 10,
            proposal_id: 'proposal-1',
            user_id: 'production-user',
          },
        ],
        judgements: [
          {
            id: 20,
            proposal_id: 'proposal-1',
            source_check_id: 10,
            actor: 'production-reviewer',
          },
        ],
        pipeline_jobs: [{ id: 30, proposal_id: 'proposal-1' }],
      },
    });

    expect(counts).toEqual({
      proposals: 1,
      proposal_signal_checks: 1,
      proposal_checks: 1,
      judgements: 1,
      pipeline_jobs: 1,
    });
    expect(
      database.prepare('SELECT user_id, display_name FROM users').all(),
    ).toEqual([
      {
        user_id: LOCAL_GOD_USER.user_id,
        display_name: LOCAL_GOD_USER.display_name,
      },
    ]);
    expect(database.prepare('SELECT author_id FROM proposals').get()).toEqual({
      author_id: LOCAL_GOD_USER.user_id,
    });
    expect(
      database.prepare('SELECT user_id FROM proposal_checks').get(),
    ).toEqual({ user_id: LOCAL_GOD_USER.user_id });
    expect(database.prepare('SELECT actor FROM judgements').get()).toEqual({
      actor: LOCAL_GOD_USER.user_id,
    });
  });

  it('users テーブルを含む入力を拒否する', () => {
    expect(() =>
      validatePayload({
        formatVersion: 1,
        tables: {
          users: [],
          proposals: [],
          proposal_signal_checks: [],
          proposal_checks: [],
          judgements: [],
          pipeline_jobs: [],
        },
      }),
    ).toThrow('users テーブル');
  });
});
