import { enumerateLegalPlays, simulate, type RuleModule } from '@daifugo/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SqlitePersistence } from '../persistence.js';
import { proposalContentHash } from '../proposal/repository.js';
import { RoomManager } from '../room/manager.js';
import type { RegisterRuleInput } from './repository.js';
import { type CodeRuleRegistration, RuleRegistryService } from './service.js';

const instances: SqlitePersistence[] = [];

afterEach(() => {
  for (const instance of instances.splice(0)) instance.close();
});

function codeRule(
  ruleId: string,
  name: string,
  overrides: Partial<RuleModule['meta']> = {},
): CodeRuleRegistration {
  return {
    module: {
      meta: {
        ruleId,
        name,
        description: `${name}の説明`,
        kind: 'original',
        proposalId: `proposal-${ruleId}`,
        contractVersion: 1,
        messages: {},
        ...overrides,
      },
      hooks: {},
    },
    bundleHash: `${ruleId}-bundle`,
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
      [
        codeRule('r0002-b', 'ルールB'),
        codeRule('r0001-a', 'ルールA'),
        codeRule('r9999-code-only', 'コードのみ'),
      ],
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
      [codeRule('r0001-a', 'ルールA'), codeRule('r0002-b', 'ルールB')],
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
    expect(
      persistence.rules.transition({
        ruleId: 'r0001-a',
        expectedStatuses: ['disabled'],
        nextStatus: 'active',
        disabledReason: null,
        now: 2_000,
      }),
    ).toMatchObject({ changed: false, rule: { status: 'active' } });
  });

  it('重複・契約不一致・meta不一致をload_failureとしてfail-closedにする', () => {
    const { persistence, register } = setup();
    register({ id: 'r0001-a', slug: 'a', name: 'ルールA' });
    register({ id: 'r0002-b', slug: 'b', name: 'ルールB' });
    register({ id: 'r0003-c', slug: 'c', name: 'ルールC' });
    const onLoadFailure = vi.fn();
    const service = new RuleRegistryService(
      persistence.rules,
      [
        codeRule('r0001-a', 'ルールA'),
        codeRule('r0001-a', 'ルールA'),
        codeRule('r0002-b', 'ルールB', { contractVersion: 2 }),
        codeRule('r0003-c', '別名'),
      ],
      { now: () => 2_000, onLoadFailure },
    );

    expect(service.availableRules('set-load-failure')).toEqual([]);
    expect(onLoadFailure).toHaveBeenCalledTimes(3);
    expect(persistence.rules.incidents('r0001-a')).toMatchObject([
      { setId: 'set-load-failure', type: 'load_failure' },
    ]);
    expect(service.enable('r0001-a')).toEqual({
      status: 'conflict',
      error: 'rule_unavailable',
    });
  });

  it('拒否されたセット開始ではload_failureを記録しない', () => {
    const { persistence, register } = setup();
    register({ id: 'r0001-a', slug: 'a', name: 'ルールA' });
    const onLoadFailure = vi.fn();
    const service = new RuleRegistryService(persistence.rules, [], {
      now: () => 2_000,
      onLoadFailure,
    });
    let memberSequence = 0;
    const rooms = new RoomManager({
      availableRules: (setId) => service.availableRules(setId),
      createRoomId: () => 'rejected-start-room',
      createMemberId: () => `member-${String(++memberSequence)}`,
      randomIndex: () => 0,
      reducer: { random: () => 0.999_999 },
    });
    const created = rooms.create({ userId: 'host', displayName: 'ホスト' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const joined = rooms.join(created.value.room.inviteCode, {
      userId: 'guest',
      displayName: 'ゲスト',
    });
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;

    const rejected = rooms.apply(created.value.room.roomId, {
      type: 'start',
      memberId: joined.value.member.memberId,
      now: 3_000,
      setSeed: 'rejected-start',
    });
    expect(rejected?.accepted).toBe(false);
    expect(onLoadFailure).not.toHaveBeenCalled();
    expect(persistence.rules.incidents('r0001-a')).toEqual([]);

    const started = rooms.apply(created.value.room.roomId, {
      type: 'start',
      memberId: created.value.member.memberId,
      now: 3_001,
      setSeed: 'accepted-start',
    });
    expect(started?.accepted).toBe(true);
    expect(onLoadFailure).toHaveBeenCalledOnce();
    expect(persistence.rules.incidents('r0001-a')).toMatchObject([
      { setId: 'rejected-start-room:set:1', type: 'load_failure' },
    ]);
  });

  it('24時間内の3 distinct setで自動disableし、同一setの重複を数えない', () => {
    const { persistence, register } = setup();
    register({ id: 'r0001-a', slug: 'a', name: 'ルールA' });
    let now = 10_000;
    const onAutoDisable = vi.fn();
    const service = new RuleRegistryService(
      persistence.rules,
      [codeRule('r0001-a', 'ルールA')],
      { now: () => now, onAutoDisable },
    );

    const first = service.recordIncident({
      ruleId: 'r0001-a',
      setId: 'set-1',
      type: 'exception',
      detail: 'first',
    });
    const duplicate = service.recordIncident({
      ruleId: 'r0001-a',
      setId: 'set-1',
      type: 'exception',
      detail: 'duplicate',
    });
    service.recordIncident({
      ruleId: 'r0001-a',
      setId: 'set-1',
      type: 'invalid_effect',
      detail: 'same set, different type',
    });
    now += 1;
    service.recordIncident({
      ruleId: 'r0001-a',
      setId: 'set-2',
      type: 'invalid_effect',
      detail: 'second',
    });
    expect(first.inserted).toBe(true);
    expect(duplicate.inserted).toBe(false);
    expect(persistence.rules.get('r0001-a')?.status).toBe('active');

    now += 1;
    const third = service.recordIncident({
      ruleId: 'r0001-a',
      setId: 'set-3',
      type: 'exception',
      detail: 'third',
    });
    expect(third.autoDisabled).toMatchObject({
      status: 'disabled',
      disabledReason: 'auto_incident',
    });
    expect(onAutoDisable).toHaveBeenCalledOnce();
  });

  it('hook失敗後は同じsetの当該ルールだけを落とし、他ルールと基本進行を継続する', () => {
    const { persistence, register } = setup();
    register({ id: 'r0001-a', slug: 'a', name: 'ルールA' });
    register({ id: 'r0002-b', slug: 'b', name: 'ルールB' });
    let brokenCalls = 0;
    let healthyCalls = 0;
    const broken = codeRule('r0001-a', 'ルールA');
    broken.module.hooks.onGameStart = () => {
      brokenCalls += 1;
      throw new Error('broken fixture');
    };
    const healthy = codeRule('r0002-b', 'ルールB');
    healthy.module.hooks.onGameStart = () => {
      healthyCalls += 1;
      return [];
    };
    const service = new RuleRegistryService(
      persistence.rules,
      [broken, healthy],
      { now: () => 20_000 },
    );
    const report = simulate({
      games: 1,
      seed: 'cx04-runtime-isolation',
      ruleChain: service.availableRules('set-runtime'),
      port: service.rulePortForSet('set-runtime'),
    });

    expect(report.completed).toBe(1);
    expect(report.invariantViolations).toEqual([]);
    expect(brokenCalls).toBe(1);
    expect(healthyCalls).toBe(3);
    expect(persistence.rules.incidents('r0001-a')).toMatchObject([
      {
        setId: 'set-runtime',
        type: 'exception',
        detail: 'onGameStart: exception',
      },
    ]);
    expect(persistence.rules.incidents('r0002-b')).toEqual([]);
  });

  it('全ルールdisable後も基本ルールだけでsimulationを完走する', () => {
    const report = simulate({
      games: 2,
      seed: 'cx04-basic-only',
      ruleChain: [],
    });
    expect(report.completed).toBe(2);
    expect(report.invariantViolations).toEqual([]);
  });

  it('invalid Effectを記録し、そのsetの後続hookから当該ルールだけを除去する', () => {
    const { persistence, register } = setup();
    register({ id: 'r0001-a', slug: 'a', name: 'ルールA' });
    let afterPlayCalls = 0;
    const invalid = codeRule('r0001-a', 'ルールA');
    invalid.module.hooks.onGameStart = () => [
      {
        type: 'setMemory',
        scope: 'game',
        key: 'too-large',
        value: 'x'.repeat(2_000),
      },
    ];
    invalid.module.hooks.afterPlay = () => {
      afterPlayCalls += 1;
      return [];
    };
    const service = new RuleRegistryService(persistence.rules, [invalid], {
      now: () => 30_000,
    });
    const rooms = new RoomManager({
      availableRules: (setId) => service.availableRules(setId),
      createRoomId: () => 'invalid-effect-room',
      createMemberId: () => 'invalid-effect-host',
      randomIndex: () => 0,
      reducer: {
        random: () => 0.999_999,
        rulePortForSet: (setId) => service.rulePortForSet(setId),
        releaseRulePort: (setId) => service.releaseRulePort(setId),
        onRuleIncident: (incident) => {
          service.disableRuleInSet(incident.setId, incident.ruleId);
          service.recordIncident(incident);
        },
      },
    });
    const created = rooms.create({ userId: 'host', displayName: 'ホスト' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const started = rooms.apply(created.value.room.roomId, {
      type: 'start',
      memberId: created.value.member.memberId,
      now: 31_000,
      setSeed: 'invalid-effect-set',
    });
    expect(started?.accepted).toBe(true);
    const engine = started?.state.engine;
    expect(engine).toBeDefined();
    if (!engine || engine.phase.name !== 'gameInProgress') return;
    expect(persistence.rules.incidents('r0001-a')).toMatchObject([
      {
        setId: 'invalid-effect-room:set:1',
        type: 'invalid_effect',
      },
    ]);

    const player = engine.currentGame!.public.turn!;
    const legal = enumerateLegalPlays(
      {
        gameIndex: engine.phase.gameIndex,
        seats: engine.members.map((member) => member.id),
        gameSeed: `${engine.setSeed}:${String(engine.phase.gameIndex)}`,
        ruleChain: engine.ruleChain,
      },
      engine.currentGame!,
      player,
    );
    const acted = rooms.apply(started.state.roomId, {
      type: 'play',
      memberId: player,
      turnSeq: started.state.turnSeq,
      cards: legal[0]!.cards.map((card) => card.id),
      now: 31_001,
    });
    expect(acted?.accepted).toBe(true);
    expect(afterPlayCalls).toBe(0);
  });
});
