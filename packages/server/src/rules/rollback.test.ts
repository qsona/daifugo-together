import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SqlitePersistence } from '../persistence.js';
import { proposalContentHash } from '../proposal/repository.js';
import { RuleRegistryService } from './service.js';

const directories: string[] = [];
const open: SqlitePersistence[] = [];

afterEach(() => {
  for (const persistence of open.splice(0)) persistence.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'cx04-rollback-'));
  directories.push(directory);
  return join(directory, 'app.sqlite');
}

function seed(path: string): SqlitePersistence {
  const persistence = new SqlitePersistence(path, {
    createUserId: () => 'rollback-author',
    createToken: () => 'rollback-author-token-0001',
  });
  open.push(persistence);
  const session = persistence.sessions.resolve(undefined);
  const proposal = {
    kind: 'original' as const,
    prefectureCode: null,
    name: '巻き戻し対象',
    body: '巻き戻し対象の提案',
  };
  persistence.proposals.create({
    authorId: session.userId,
    proposal,
    contentHash: proposalContentHash(proposal),
    now: 1_000,
    id: 'proposal-rollback',
    commitSignals: () => undefined,
  });
  persistence.rules.register({
    id: 'r0001-rollback',
    slug: 'rollback',
    name: proposal.name,
    description: proposal.body,
    kind: 'original',
    prefecture: null,
    proposalId: 'proposal-rollback',
    status: 'active',
    disabledReason: null,
    now: 1_000,
  });
  persistence.rules.registerVersion({
    ruleId: 'r0001-rollback',
    version: 1,
    contractVersion: 1,
    prNumber: 42,
    mergeSha: 'a'.repeat(40),
    now: 1_001,
  });
  return persistence;
}

describe('CX-04 permanent rollback reconciliation', () => {
  it('コード削除を再起動後にreverted_atへ記録し、rule行をrollback disabledで保持する', () => {
    const path = databasePath();
    const first = seed(path);
    first.close();
    open.splice(open.indexOf(first), 1);

    const reopened = new SqlitePersistence(path);
    open.push(reopened);
    const service = new RuleRegistryService(reopened.rules, [], {
      now: () => 2_000,
    });
    expect(service.reconcileRevertedCode()).toMatchObject([
      {
        id: 'r0001-rollback',
        status: 'disabled',
        disabledReason: 'rollback',
      },
    ]);
    expect(reopened.rules.versions('r0001-rollback')).toMatchObject([
      {
        version: 1,
        mergeSha: 'a'.repeat(40),
        isCurrent: false,
        revertedAt: 2_000,
      },
    ]);

    expect(service.reconcileRevertedCode()).toEqual([]);
    expect(reopened.rules.get('r0001-rollback')).toMatchObject({
      status: 'disabled',
      disabledReason: 'rollback',
    });
  });

  it('同じversionの起動時同期を再実行してもversion行を重複させない', () => {
    const persistence = seed(databasePath());
    persistence.rules.registerVersion({
      ruleId: 'r0001-rollback',
      version: 1,
      contractVersion: 1,
      prNumber: 42,
      mergeSha: 'a'.repeat(40),
      now: 2_000,
    });
    expect(persistence.rules.versions('r0001-rollback')).toHaveLength(1);
    expect(persistence.rules.versions('r0001-rollback')[0]).toMatchObject({
      version: 1,
      isCurrent: true,
      revertedAt: null,
    });
  });
});
