import type { RuleChainEntry } from '@daifugo/core';
import { afterEach, describe, expect, it } from 'vitest';

import { SqlitePersistence } from '../persistence.js';
import { proposalContentHash } from '../proposal/repository.js';
import { RoomManager } from '../room/manager.js';
import type { RegisterRuleInput } from './repository.js';
import { RuleRegistryService } from './service.js';

const instances: SqlitePersistence[] = [];

afterEach(() => {
  for (const instance of instances.splice(0)) instance.close();
});

function entry(ruleId: string, position: number): RuleChainEntry {
  return {
    ruleId,
    name: ruleId,
    position,
    priority: { score: 0, activatedAt: 1_000 + position, ruleId },
    bundleHash: `${ruleId}-bundle`,
    contractVersion: 1,
  };
}

function setup() {
  const persistence = new SqlitePersistence(':memory:', {
    createUserId: () => 'rule-author',
    createToken: () => 'rule-author-token-0001',
  });
  instances.push(persistence);
  const session = persistence.sessions.resolve(undefined);
  const register = (
    input: Pick<RegisterRuleInput, 'id' | 'slug' | 'name'> & {
      status?: RegisterRuleInput['status'];
      disabledReason?: RegisterRuleInput['disabledReason'];
    },
  ) => {
    const proposal = {
      kind: 'original' as const,
      prefectureCode: null,
      name: input.name,
      body: `${input.name}の提案本文`,
    };
    persistence.proposals.create({
      authorId: session.userId,
      proposal,
      contentHash: proposalContentHash(proposal),
      now: 1_000,
      id: `proposal-${input.id}`,
      commitSignals: () => undefined,
    });
    return persistence.rules.register({
      id: input.id,
      slug: input.slug,
      name: input.name,
      description: `${input.name}の説明`,
      kind: 'original',
      prefecture: null,
      proposalId: `proposal-${input.id}`,
      status: input.status ?? 'active',
      disabledReason: input.disabledReason ?? null,
      now: 1_000,
    });
  };
  return { persistence, register };
}

describe('CX-04 rule registry', () => {
  it('特定ルールだけをdisable・enableし、コード側registryとの積集合を返す', () => {
    const { persistence, register } = setup();
    register({ id: 'r0001-a', slug: 'a', name: 'ルールA' });
    register({ id: 'r0002-b', slug: 'b', name: 'ルールB' });
    const service = new RuleRegistryService(
      persistence.rules,
      [entry('r0001-a', 0), entry('r0002-b', 1), entry('r9999-code-only', 2)],
      { now: () => 2_000 },
    );

    expect(service.availableRules().map(({ ruleId }) => ruleId)).toEqual([
      'r0001-a',
      'r0002-b',
    ]);
    expect(service.disable('r0001-a', { reason: 'manual' })).toMatchObject({
      status: 'updated',
      rule: {
        id: 'r0001-a',
        status: 'disabled',
        disabledReason: 'manual',
      },
    });
    expect(service.availableRules().map(({ ruleId }) => ruleId)).toEqual([
      'r0002-b',
    ]);
    expect(service.enable('r0001-a')).toMatchObject({
      status: 'updated',
      rule: {
        id: 'r0001-a',
        status: 'active',
        disabledReason: null,
      },
    });
    expect(service.availableRules().map(({ ruleId }) => ruleId)).toEqual([
      'r0001-a',
      'r0002-b',
    ]);
  });

  it('部屋作成後のdisableも最初のセット開始時に再読込し、進行中セットは固定する', () => {
    const { persistence, register } = setup();
    register({ id: 'r0001-a', slug: 'a', name: 'ルールA' });
    register({ id: 'r0002-b', slug: 'b', name: 'ルールB' });
    const service = new RuleRegistryService(
      persistence.rules,
      [entry('r0001-a', 0), entry('r0002-b', 1)],
      { now: () => 2_000 },
    );
    let memberSequence = 0;
    const rooms = new RoomManager({
      availableRules: () => service.availableRules(),
      createRoomId: () => 'rule-room',
      createMemberId: () => `member-${String(++memberSequence)}`,
      randomIndex: () => 0,
      reducer: { random: () => 0.999_999 },
    });
    const created = rooms.create({
      userId: 'host',
      displayName: 'ホスト',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.room.availableRules).toHaveLength(2);

    service.disable('r0001-a', { reason: 'rollback' });
    const started = rooms.apply(created.value.room.roomId, {
      type: 'start',
      memberId: created.value.member.memberId,
      now: 3_000,
      setSeed: 'fixed-rule-set',
    });
    expect(started?.accepted).toBe(true);
    expect(started?.state.fixedRules?.map(({ ruleId }) => ruleId)).toEqual([
      'r0002-b',
    ]);

    service.disable('r0002-b', { reason: 'manual' });
    expect(service.availableRules()).toEqual([]);
    expect(started?.state.fixedRules?.map(({ ruleId }) => ruleId)).toEqual([
      'r0002-b',
    ]);
  });

  it('不正reason・未知rule・removed ruleを状態別に拒否する', () => {
    const { persistence, register } = setup();
    register({ id: 'r0001-a', slug: 'a', name: 'ルールA' });
    register({
      id: 'r0003-removed',
      slug: 'removed',
      name: '排除済み',
      status: 'removed',
    });
    const service = new RuleRegistryService(persistence.rules, []);

    expect(service.disable('r0001-a', { reason: 'auto_incident' })).toEqual({
      status: 'invalid',
      error: 'invalid_reason',
    });
    expect(service.disable('missing', { reason: 'manual' })).toEqual({
      status: 'not_found',
    });
    expect(service.enable('r0003-removed')).toEqual({
      status: 'conflict',
      error: 'rule_removed',
    });
  });
});
