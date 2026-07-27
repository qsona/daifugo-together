import { afterEach, describe, expect, it } from 'vitest';

import { SqlitePersistence } from '../persistence.js';
import { proposalContentHash } from '../proposal/repository.js';

const instances: SqlitePersistence[] = [];

afterEach(() => {
  for (const instance of instances.splice(0)) instance.close();
});

describe('RuleRepository catalog', () => {
  it('公開状態だけを集計し、ANDフィルタと30件境界を処理する', () => {
    const persistence = new SqlitePersistence(':memory:');
    instances.push(persistence);
    const session = persistence.sessions.resolve(undefined);
    for (let index = 0; index < 32; index += 1) {
      const kind = index % 2 === 0 ? ('local' as const) : ('original' as const);
      const prefecture = kind === 'local' && index % 4 === 0 ? '埼玉県' : null;
      const proposal = {
        kind,
        prefectureCode: prefecture ? ('11' as const) : null,
        name: `ルール${String(index).padStart(2, '0')}`,
        body: `提案${String(index)}`,
      };
      const id = `r${String(index).padStart(4, '0')}`;
      persistence.proposals.create({
        authorId: session.userId,
        proposal,
        contentHash: proposalContentHash(proposal),
        now: 1_000 + index,
        id: `proposal-${id}`,
        commitSignals: () => undefined,
      });
      persistence.rules.register({
        id,
        slug: `rule-${String(index)}`,
        name: proposal.name,
        description: `${proposal.name}の説明`,
        kind,
        prefecture,
        proposalId: `proposal-${id}`,
        status: 'active',
        disabledReason: null,
        now: 1_000 + index,
      });
    }
    persistence.rules.transition({
      ruleId: 'r0000',
      expectedStatuses: ['active'],
      nextStatus: 'removed',
      disabledReason: null,
      now: 5_000,
    });
    persistence.rules.transition({
      ruleId: 'r0001',
      expectedStatuses: ['active'],
      nextStatus: 'disabled',
      disabledReason: 'manual',
      now: 5_001,
    });

    const first = persistence.rules.catalog({
      includeRemoved: true,
      order: 'desc',
      limit: 30,
      offset: 0,
    });
    expect(first.summary).toEqual({
      implemented: 31,
      active: 30,
      removed: 1,
      prefectureCoverage: 1,
    });
    expect(first.total).toBe(31);
    expect(first.items).toHaveLength(30);
    expect(first.items[0]?.id).toBe('r0031');
    expect(
      persistence.rules.catalog({
        includeRemoved: true,
        order: 'desc',
        limit: 30,
        offset: 30,
      }).items,
    ).toHaveLength(1);

    expect(
      persistence.rules
        .catalog({
          includeRemoved: true,
          prefecture: 'none',
          kind: 'local',
          status: 'active',
          order: 'desc',
          limit: 100,
          offset: 0,
        })
        .items.every(
          (rule) => rule.kind === 'local' && rule.prefecture === null,
        ),
    ).toBe(true);
    expect(
      persistence.rules.catalog({
        includeRemoved: true,
        prefecture: '埼玉県',
        kind: 'original',
        order: 'desc',
        limit: 100,
        offset: 0,
      }).total,
    ).toBe(0);

    const activeOnly = persistence.rules.catalog({
      includeRemoved: false,
      status: 'removed',
      order: 'desc',
      limit: 30,
      offset: 0,
    });
    expect(activeOnly.summary.removed).toBe(0);
    expect(activeOnly.total).toBe(0);
  });

  it('removedを終端としてupdatedAtを不変に保つ', () => {
    const persistence = new SqlitePersistence(':memory:');
    instances.push(persistence);
    const session = persistence.sessions.resolve(undefined);
    const proposal = {
      kind: 'original' as const,
      prefectureCode: null,
      name: '終端ルール',
      body: '終端の提案',
    };
    persistence.proposals.create({
      authorId: session.userId,
      proposal,
      contentHash: proposalContentHash(proposal),
      now: 1_000,
      id: 'proposal-terminal',
      commitSignals: () => undefined,
    });
    persistence.rules.register({
      id: 'r-terminal',
      slug: 'terminal',
      name: proposal.name,
      description: '説明',
      kind: 'original',
      prefecture: null,
      proposalId: 'proposal-terminal',
      status: 'active',
      disabledReason: null,
      now: 1_000,
    });
    expect(
      persistence.rules.transition({
        ruleId: 'r-terminal',
        expectedStatuses: ['active'],
        nextStatus: 'removed',
        disabledReason: null,
        now: 2_000,
      }).changed,
    ).toBe(true);
    expect(
      persistence.rules.transition({
        ruleId: 'r-terminal',
        expectedStatuses: ['removed'],
        nextStatus: 'active',
        disabledReason: null,
        now: 3_000,
      }).changed,
    ).toBe(false);
    expect(persistence.rules.get('r-terminal')?.updatedAt).toBe(2_000);
  });
});
