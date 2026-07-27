import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RuleModule } from '@daifugo/core';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SqlitePersistence } from '../persistence.js';
import { proposalContentHash } from '../proposal/repository.js';
import type { CodeRuleRegistration } from './service.js';
import { RuleRegistryService } from './service.js';
import type { StoredRule } from './repository.js';

const directories: string[] = [];
const open: SqlitePersistence[] = [];

afterEach(() => {
  for (const persistence of open.splice(0)) persistence.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'cx05-release-'));
  directories.push(directory);
  return join(directory, 'app.sqlite');
}

function codeRule(
  ruleId: string,
  name: string,
  options: {
    proposalId?: string;
    slug?: string;
    bundleHash?: string;
  } = {},
): CodeRuleRegistration {
  const module: RuleModule = {
    meta: {
      ruleId,
      name,
      description: `${name}の説明`,
      kind: 'original',
      proposalId: options.proposalId ?? `proposal-${ruleId}`,
      contractVersion: 1,
      messages: {},
    },
    hooks: {},
  };
  return {
    module,
    bundleHash: options.bundleHash ?? 'b'.repeat(64),
    moduleUrl: `file:///rules/${ruleId}.js`,
    slug: options.slug ?? ruleId.replace(/^r\d{4,}-/u, ''),
    version: 1,
  };
}

function createPersistence(path: string): SqlitePersistence {
  const persistence = new SqlitePersistence(path, {
    createUserId: () => 'release-author',
    createToken: () => 'release-author-token-0001',
  });
  open.push(persistence);
  return persistence;
}

function close(persistence: SqlitePersistence): void {
  persistence.close();
  open.splice(open.indexOf(persistence), 1);
}

function seedMerged(
  persistence: SqlitePersistence,
  ruleId = 'r0001-release',
  name = '公開ルール',
): { jobId: number; registration: CodeRuleRegistration } {
  const session = persistence.sessions.resolve('release-author-token-0001');
  const proposal = {
    kind: 'original' as const,
    prefectureCode: null,
    name,
    body: `${name}の提案本文`,
  };
  const proposalId = `proposal-${ruleId}`;
  persistence.proposals.create({
    authorId: session.userId,
    proposal,
    contentHash: proposalContentHash(proposal),
    now: 1_000,
    id: proposalId,
    commitSignals: () => undefined,
  });
  expect(
    persistence.proposals.transitionProposal(
      proposalId,
      'screening',
      'implementing',
      {},
      1_100,
    ),
  ).toBe('transitioned');
  const registration = codeRule(ruleId, name);
  const job = persistence.pipeline.createQueuedJob(
    proposalId,
    registration.slug,
    'prompt-v1',
    1_200,
  );
  persistence.pipeline.transitionJob(
    job.id,
    'queued',
    'merged',
    {
      prNumber: 42,
      headSha: 'a'.repeat(40),
      mergeSha: 'c'.repeat(40),
    },
    1_300,
  );
  return { jobId: job.id, registration };
}

function registry(
  persistence: SqlitePersistence,
  registrations: readonly CodeRuleRegistration[],
  onReleased?: (rule: StoredRule) => void,
): RuleRegistryService {
  return new RuleRegistryService(persistence.rules, registrations, {
    now: () => 2_000,
    proposals: persistence.proposals,
    pipeline: persistence.pipeline,
    ...(onReleased ? { onReleased } : {}),
  });
}

describe('CX-05 release persistence and provenance', () => {
  it('pending登録と初回enableを再起動越しに冪等・永続化する', () => {
    const path = databasePath();
    const first = createPersistence(path);
    const { jobId, registration } = seedMerged(first);
    expect(
      registry(first, [registration]).synchronizeCodeRegistry(),
    ).toMatchObject({
      registered: [{ id: 'r0001-release' }],
      versions: [{ bundleHash: 'b'.repeat(64), isCurrent: true }],
      failures: [],
    });
    close(first);

    const second = createPersistence(path);
    const onReleased = vi.fn();
    const service = registry(second, [registration], onReleased);
    expect(service.synchronizeCodeRegistry()).toMatchObject({
      registered: [],
      versions: [],
      failures: [],
    });
    expect(service.enable('r0001-release')).toMatchObject({
      status: 'updated',
      rule: { status: 'active' },
    });
    expect(onReleased).toHaveBeenCalledTimes(1);
    close(second);

    const third = createPersistence(path);
    const restarted = registry(third, [registration], onReleased);
    expect(restarted.synchronizeCodeRegistry()).toMatchObject({
      registered: [],
      versions: [],
      failures: [],
    });
    expect(restarted.enable('r0001-release')).toMatchObject({
      status: 'unchanged',
      rule: { status: 'active' },
    });
    expect(third.proposals.findById('proposal-r0001-release')).toMatchObject({
      status: 'released',
      ruleId: 'r0001-release',
    });
    expect(third.pipeline.job(jobId)).toMatchObject({
      phase: 'done',
      headSha: 'a'.repeat(40),
      mergeSha: 'c'.repeat(40),
    });
    expect(onReleased).toHaveBeenCalledTimes(1);
  });

  it('旧ファイルDBへbundle列を加算し、既存merge provenanceと照合して補完する', () => {
    const path = databasePath();
    const first = createPersistence(path);
    const { registration } = seedMerged(first);
    registry(first, [registration]).synchronizeCodeRegistry();
    close(first);

    const oldDatabase = new Database(path);
    oldDatabase.exec('ALTER TABLE rule_versions DROP COLUMN bundle_hash');
    oldDatabase.close();

    const migrated = createPersistence(path);
    const synchronized = registry(migrated, [
      registration,
    ]).synchronizeCodeRegistry();
    expect(synchronized).toMatchObject({
      registered: [],
      versions: [
        {
          ruleId: 'r0001-release',
          version: 1,
          bundleHash: 'b'.repeat(64),
          isCurrent: true,
        },
      ],
      failures: [],
    });
    expect(migrated.rules.currentVersion('r0001-release')).toMatchObject({
      prNumber: 42,
      mergeSha: 'c'.repeat(40),
      bundleHash: 'b'.repeat(64),
    });
  });

  it('pending_enableへのdisableを拒否し、初回公開状態を失わない', () => {
    const persistence = createPersistence(databasePath());
    const { registration } = seedMerged(persistence);
    const service = registry(persistence, [registration]);
    service.synchronizeCodeRegistry();

    expect(service.disable('r0001-release', { reason: 'manual' })).toEqual({
      status: 'conflict',
      error: 'release_pending',
    });
    expect(persistence.rules.get('r0001-release')).toMatchObject({
      status: 'disabled',
      disabledReason: 'pending_enable',
    });
    expect(service.enable('r0001-release')).toMatchObject({
      status: 'updated',
      rule: { status: 'active' },
    });
  });

  it('恒久revert後に旧コードが戻っても同じversionを復活・enableしない', () => {
    const persistence = createPersistence(databasePath());
    const { registration } = seedMerged(persistence);
    const service = registry(persistence, [registration]);
    service.synchronizeCodeRegistry();
    service.enable('r0001-release');

    const removedCode = registry(persistence, []);
    expect(removedCode.reconcileRevertedCode()).toHaveLength(1);
    expect(persistence.rules.versions('r0001-release')[0]).toMatchObject({
      isCurrent: false,
      revertedAt: 2_000,
    });

    const oldImage = registry(persistence, [registration]);
    expect(oldImage.synchronizeCodeRegistry()).toMatchObject({
      registered: [],
      versions: [],
      failures: [
        {
          ruleId: 'r0001-release',
          detail: 'rule version is reverted',
        },
      ],
    });
    expect(oldImage.enable('r0001-release')).toEqual({
      status: 'conflict',
      error: 'rule_unavailable',
    });
  });

  it('同じversionのbundle不一致をfail-closedにし、正常な別ruleは同期する', () => {
    const persistence = createPersistence(databasePath());
    const first = seedMerged(persistence);
    const second = seedMerged(persistence, 'r0002-valid', '正常ルール');
    const service = registry(persistence, [
      first.registration,
      second.registration,
    ]);
    service.synchronizeCodeRegistry();
    service.enable('r0001-release');
    service.enable('r0002-valid');

    const changed = {
      ...first.registration,
      bundleHash: 'd'.repeat(64),
    };
    const restarted = registry(persistence, [changed, second.registration]);
    expect(restarted.synchronizeCodeRegistry()).toMatchObject({
      registered: [],
      versions: [],
      failures: [
        {
          ruleId: 'r0001-release',
          detail: 'rule version provenance does not match deployed code',
        },
      ],
    });
    expect(persistence.rules.currentVersion('r0002-valid')).toMatchObject({
      bundleHash: 'b'.repeat(64),
      isCurrent: true,
    });
    expect(
      restarted
        .availableRules('bundle-mismatch-set')
        .map(({ ruleId }) => ruleId),
    ).toEqual(['r0002-valid']);
    expect(persistence.rules.incidents('r0001-release')).toMatchObject([
      {
        setId: 'bundle-mismatch-set',
        type: 'load_failure',
        detail: 'rule version provenance does not match deployed code',
      },
    ]);
  });

  it('version書込失敗時はrule行と成功レポートを一緒にrollbackする', () => {
    const path = databasePath();
    const persistence = createPersistence(path);
    const { registration } = seedMerged(persistence);
    const injector = new Database(path);
    injector.exec(`
      CREATE TRIGGER fail_rule_version
      BEFORE INSERT ON rule_versions
      BEGIN
        SELECT RAISE(ABORT, 'injected version failure');
      END;
    `);
    injector.close();
    const synchronized = registry(persistence, [
      registration,
    ]).synchronizeCodeRegistry();

    expect(synchronized.registered).toEqual([]);
    expect(synchronized.versions).toEqual([]);
    expect(synchronized.failures).toMatchObject([
      {
        ruleId: 'r0001-release',
        detail: 'injected version failure',
      },
    ]);
    expect(persistence.rules.get('r0001-release')).toBeNull();
  });

  it('release後の運用ログ失敗をHTTP上の失敗へ変換しない', () => {
    const persistence = createPersistence(databasePath());
    const { registration } = seedMerged(persistence);
    const service = registry(persistence, [registration], () => {
      throw new Error('logger unavailable');
    });
    service.synchronizeCodeRegistry();

    expect(service.enable('r0001-release')).toMatchObject({
      status: 'updated',
      rule: { status: 'active' },
    });
    expect(
      persistence.proposals.findById('proposal-r0001-release'),
    ).toMatchObject({
      status: 'released',
    });
  });
});
