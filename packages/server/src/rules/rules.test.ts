import {
  enumerateLegalPlays,
  simulate,
  TITLE_BY_STANDING,
  type GameResult,
  type RuleModule,
  type SetOutcome,
  type Standing,
} from '@daifugo/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SqlitePersistence } from '../persistence.js';
import { proposalContentHash } from '../proposal/repository.js';
import { RoomManager } from '../room/manager.js';
import type { RoomState } from '../room/types.js';
import { viewFor } from '../room/view.js';
import type { RegisterRuleInput } from './repository.js';
import {
  AUTO_DISABLE_WINDOW_MS,
  type CodeRuleRegistration,
  RuleRegistryService,
} from './service.js';

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
    bundleHash: 'b'.repeat(64),
    moduleUrl: `file:///rules/${ruleId}.js`,
    slug: ruleId.replace(/^r\d{4,}-/u, ''),
    version: 1,
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
    const onAvailabilityChanged = vi.fn();
    const service = new RuleRegistryService(
      persistence.rules,
      [
        codeRule('r0002-b', 'ルールB'),
        codeRule('r0001-a', 'ルールA'),
        codeRule('r9999-code-only', 'コードのみ'),
      ],
      { now: () => 2_000, onAvailabilityChanged },
    );

    const initiallyAvailable = service.availableRules();
    expect(initiallyAvailable.map(({ ruleId }) => ruleId)).toEqual([
      'r0001-a',
      'r0002-b',
    ]);
    expect(service.aiRuleBundles(initiallyAvailable)).toEqual([
      {
        ruleId: 'r0001-a',
        moduleUrl: 'file:///rules/r0001-a.js',
        bundleHash: 'b'.repeat(64),
        contractVersion: 1,
        meta: codeRule('r0001-a', 'ルールA').module.meta,
      },
      {
        ruleId: 'r0002-b',
        moduleUrl: 'file:///rules/r0002-b.js',
        bundleHash: 'b'.repeat(64),
        contractVersion: 1,
        meta: codeRule('r0002-b', 'ルールB').module.meta,
      },
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
    expect(onAvailabilityChanged).toHaveBeenCalledTimes(2);
  });

  it('meta.engineFeaturesをチェーンentryへ転記し、未知の宣言は登録もチェーン投入も拒否する', () => {
    const { persistence, register } = setup();
    register({ id: 'r0001-seq', slug: 'seq', name: '階段' });
    register({ id: 'r0002-plain', slug: 'plain', name: '通常' });
    register({ id: 'r0003-bad', slug: 'bad', name: '未知機能' });
    const service = new RuleRegistryService(
      persistence.rules,
      [
        codeRule('r0001-seq', '階段', {
          engineFeatures: ['sequence', 'jokers'],
        }),
        codeRule('r0002-plain', '通常'),
        codeRule('r0003-bad', '未知機能', {
          engineFeatures: ['staircase'] as unknown as NonNullable<
            RuleModule['meta']['engineFeatures']
          >,
        }),
      ],
      { now: () => 2_000 },
    );

    // 登録同期: 未知の engineFeatures はコード登録の失敗として報告される。
    const sync = service.synchronizeCodeRegistry();
    expect(sync.failures).toContainEqual({
      ruleId: 'r0003-bad',
      detail: 'unknown engine features: staircase',
    });

    // チェーン構築: meta の宣言が entry へ転記され、未宣言は省略、
    // 未知宣言のルールはチェーンに載らない。
    const entries = service.availableRules();
    expect(entries.map(({ ruleId }) => ruleId)).toEqual([
      'r0001-seq',
      'r0002-plain',
    ]);
    expect(entries[0]!.engineFeatures).toEqual(['sequence', 'jokers']);
    expect(entries[1]!.engineFeatures).toBeUndefined();
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

  it('同時期に開始する複数roomへ同じ有効rule chainを配る', () => {
    const { persistence, register } = setup();
    register({ id: 'r0001-a', slug: 'a', name: 'ルールA' });
    register({ id: 'r0002-b', slug: 'b', name: 'ルールB' });
    const service = new RuleRegistryService(
      persistence.rules,
      [codeRule('r0002-b', 'ルールB'), codeRule('r0001-a', 'ルールA')],
      { now: () => 2_000 },
    );
    let roomSequence = 0;
    let memberSequence = 0;
    let randomSequence = 0;
    const rooms = new RoomManager({
      availableRules: () => service.availableRules(),
      createRoomId: () => `shared-rule-room-${String(++roomSequence)}`,
      createMemberId: () => `shared-rule-member-${String(++memberSequence)}`,
      randomIndex: (size) => randomSequence++ % size,
      reducer: { random: () => 0.999_999 },
    });
    const first = rooms.create({ userId: 'host-a', displayName: 'A' });
    const second = rooms.create({ userId: 'host-b', displayName: 'B' });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const firstStarted = rooms.apply(first.value.room.roomId, {
      type: 'start',
      memberId: first.value.member.memberId,
      now: 3_000,
      setSeed: 'shared-rules-a',
    });
    const secondStarted = rooms.apply(second.value.room.roomId, {
      type: 'start',
      memberId: second.value.member.memberId,
      now: 3_001,
      setSeed: 'shared-rules-b',
    });

    expect(firstStarted?.state.fixedRules).toEqual(
      secondStarted?.state.fixedRules,
    );
    expect(firstStarted?.state.fixedRules?.map(({ ruleId }) => ruleId)).toEqual(
      ['r0001-a', 'r0002-b'],
    );
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

  it('24時間より古いincident setは自動disableの閾値から除外する', () => {
    const { persistence, register } = setup();
    register({ id: 'r0001-a', slug: 'a', name: 'ルールA' });
    let now = 10_000;
    const service = new RuleRegistryService(
      persistence.rules,
      [codeRule('r0001-a', 'ルールA')],
      { now: () => now },
    );
    service.recordIncident({
      ruleId: 'r0001-a',
      setId: 'expired-set',
      type: 'exception',
      detail: null,
    });
    now += AUTO_DISABLE_WINDOW_MS + 1;
    for (const setId of ['recent-1', 'recent-2']) {
      service.recordIncident({
        ruleId: 'r0001-a',
        setId,
        type: 'exception',
        detail: null,
      });
    }

    expect(persistence.rules.get('r0001-a')?.status).toBe('active');
  });

  it('正常なEffect優先度競合はincidentにも自動disableにも数えない', () => {
    const { persistence, register } = setup();
    register({ id: 'r0001-high', slug: 'high', name: '優先ルール' });
    register({ id: 'r0002-low', slug: 'low', name: '競合ルール' });
    const high = codeRule('r0001-high', '優先ルール');
    const low = codeRule('r0002-low', '競合ルール');
    high.module.hooks.onGameStart = (context) => [
      {
        type: 'skipTurns',
        player: context.game.seats[0]!,
        count: 1,
      },
    ];
    low.module.hooks.onGameStart = (context) => [
      {
        type: 'skipTurns',
        player: context.game.seats[0]!,
        count: 2,
      },
    ];
    const service = new RuleRegistryService(persistence.rules, [high, low], {
      now: () => 15_000,
    });
    for (let set = 0; set < 3; set += 1) {
      const rooms = new RoomManager({
        availableRules: (setId) => service.availableRules(setId),
        createRoomId: () => `conflict-room-${String(set)}`,
        createMemberId: () => `conflict-member-${String(set)}`,
        randomIndex: () => set,
        reducer: {
          random: () => 0.999_999,
          rulePortForSet: (setId) => service.rulePortForSet(setId),
          onRuleIncident: (incident) => {
            service.recordIncident(incident);
          },
          onRuleConflict: (conflict) => {
            service.recordConflict(conflict);
          },
        },
      });
      const created = rooms.create({
        userId: `host-${String(set)}`,
        displayName: 'ホスト',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) continue;
      const started = rooms.apply(created.value.room.roomId, {
        type: 'start',
        memberId: created.value.member.memberId,
        now: 15_000 + set,
        setSeed: `normal-conflict-${String(set)}`,
      });
      expect(started?.accepted).toBe(true);
    }

    expect(persistence.rules.incidents('r0001-high')).toEqual([]);
    expect(persistence.rules.incidents('r0002-low')).toEqual([]);
    expect(persistence.rules.get('r0001-high')?.status).toBe('active');
    expect(persistence.rules.get('r0002-low')?.status).toBe('active');
    const conflicts = service.conflicts({});
    expect(conflicts).toHaveLength(3);
    expect(
      conflicts.map((conflict) => ({
        setId: conflict.setId,
        hook: conflict.hook,
        conflictKey: conflict.conflictKey,
        adoptedRuleId: conflict.adoptedRuleId,
      })),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hook: 'onGameStart',
          conflictKey: expect.stringContaining('turn:'),
          adoptedRuleId: 'r0001-high',
        }),
      ]),
    );
    const latest = conflicts[0]!;
    service.recordConflict({
      setId: latest.setId,
      gameIndex: latest.gameIndex,
      playSeq: latest.playSeq,
      hook: latest.hook,
      conflictKey: latest.conflictKey,
      adoptedRuleId: latest.adoptedRuleId,
      entries: latest.entries,
    });
    expect(service.conflicts({})).toHaveLength(3);
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
    expect(
      service
        .effectiveRuleChainForSet(
          'set-runtime',
          service.availableRules('set-runtime'),
        )
        .map((entry) => entry.ruleId),
    ).toEqual(['r0002-b']);
    expect(persistence.rules.incidents('r0001-a')).toMatchObject([
      {
        setId: 'set-runtime',
        type: 'exception',
        detail: 'onGameStart: exception',
      },
    ]);
    expect(persistence.rules.incidents('r0002-b')).toEqual([]);
  });

  it('set終了時にruntime portを解放し、同じIDの次setへ隔離状態を持ち越さない', () => {
    const { persistence, register } = setup();
    register({ id: 'r0001-a', slug: 'a', name: 'ルールA' });
    let calls = 0;
    const broken = codeRule('r0001-a', 'ルールA');
    broken.module.hooks.onGameStart = () => {
      calls += 1;
      throw new Error('broken fixture');
    };
    const service = new RuleRegistryService(persistence.rules, [broken], {
      now: () => 25_000,
    });
    const ruleChain = service.availableRules('reused-set-id');
    simulate({
      games: 1,
      seed: 'first-runtime',
      ruleChain,
      port: service.rulePortForSet('reused-set-id'),
    });
    service.releaseRulePort('reused-set-id');
    simulate({
      games: 1,
      seed: 'second-runtime',
      ruleChain,
      port: service.rulePortForSet('reused-set-id'),
    });

    expect(calls).toBe(2);
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
        resolveRuleMessage: (ruleId, messageKey, params) =>
          service.resolveMessage(ruleId, messageKey, params),
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

describe('CX-05 rule release', () => {
  it('発動文言の解決失敗を名前fallbackへ閉じ込めてゲーム進行を止めない', () => {
    const { persistence, register } = setup();
    register({ id: 'r0001-fire-forget', slug: 'fire-forget', name: '耐性' });
    const registration = codeRule('r0001-fire-forget', '耐性', {
      messages: { fired: '耐性が発動' },
    });
    registration.module.hooks.afterPlay = () => [
      { type: 'announce', messageKey: 'fired' },
    ];
    const service = new RuleRegistryService(persistence.rules, [registration], {
      now: () => 2_000,
    });
    let memberSequence = 0;
    const rooms = new RoomManager({
      availableRules: (setId) => service.availableRules(setId),
      createRoomId: () => 'fire-forget-room',
      createMemberId: () => `fire-forget-${String(++memberSequence)}`,
      randomIndex: () => 0,
      reducer: {
        random: () => 0.999_999,
        rulePortForSet: (setId) => service.rulePortForSet(setId),
        resolveRuleMessage: () => {
          throw new Error('display path failed');
        },
      },
    });
    const created = rooms.create({
      userId: 'fire-forget-user',
      displayName: '耐性確認',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const started = rooms.apply(created.value.room.roomId, {
      type: 'start',
      memberId: created.value.member.memberId,
      now: 2_100,
      setSeed: 'fire-forget-set',
    })!;
    const engine = started.state.engine!;
    if (engine.phase.name !== 'gameInProgress') return;
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
    const played = rooms.apply(started.state.roomId, {
      type: 'play',
      memberId: player,
      turnSeq: started.state.turnSeq,
      cards: legal[0]!.cards.map((card) => card.id),
      now: 2_101,
    });

    expect(played?.accepted).toBe(true);
    expect(played?.state.lastEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          t: 'ruleFired',
          ruleId: 'r0001-fire-forget',
          message: null,
          messageKey: 'fired',
        }),
      ]),
    );
  });

  it('デプロイ済みコードをpending_enable登録し、有効化とreleasedを原子的に確定する', () => {
    const { persistence } = setup();
    const proposal = persistence.proposals.findById('proposal-r0001-a');
    expect(proposal).toBeNull();

    const session = persistence.sessions.resolve('rule-author-token-0001');
    const normalized = {
      kind: 'original' as const,
      prefectureCode: null,
      name: 'ルールA',
      body: 'ルールAの提案本文',
    };
    persistence.proposals.create({
      authorId: session.userId,
      proposal: normalized,
      contentHash: proposalContentHash(normalized),
      now: 1_000,
      id: 'proposal-r0001-a',
      commitSignals: () => undefined,
    });
    expect(
      persistence.proposals.transitionProposal(
        'proposal-r0001-a',
        'screening',
        'implementing',
        {},
        1_100,
      ),
    ).toBe('transitioned');
    const job = persistence.pipeline.createQueuedJob(
      'proposal-r0001-a',
      'a',
      'prompt-v1',
      1_200,
    );
    expect(job.ruleId).toBe('r0001-a');
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

    const onReleased = vi.fn();
    const registration = codeRule('r0001-a', 'ルールA', {
      messages: { fired: 'ルールA!' },
    });
    registration.module.hooks.afterPlay = () => [
      { type: 'announce', messageKey: 'fired' },
    ];
    const service = new RuleRegistryService(persistence.rules, [registration], {
      now: () => 2_000,
      proposals: persistence.proposals,
      pipeline: persistence.pipeline,
      onReleased,
    });
    const synchronized = service.synchronizeCodeRegistry();

    expect(synchronized.failures).toEqual([]);
    expect(synchronized.registered).toMatchObject([
      {
        id: 'r0001-a',
        status: 'disabled',
        disabledReason: 'pending_enable',
      },
    ]);
    expect(synchronized.versions).toMatchObject([
      {
        ruleId: 'r0001-a',
        version: 1,
        prNumber: 42,
        mergeSha: 'c'.repeat(40),
        bundleHash: 'b'.repeat(64),
        isCurrent: true,
      },
    ]);
    expect(service.availableRules()).toEqual([]);

    expect(service.enable('r0001-a')).toMatchObject({
      status: 'updated',
      rule: { status: 'active', disabledReason: null },
    });
    expect(persistence.proposals.findById('proposal-r0001-a')).toMatchObject({
      status: 'released',
      ruleId: 'r0001-a',
      statusChangedAt: 2_000,
    });
    expect(persistence.pipeline.job(job.id)).toMatchObject({ phase: 'done' });
    expect(service.availableRules().map(({ ruleId }) => ruleId)).toEqual([
      'r0001-a',
    ]);
    expect(onReleased).toHaveBeenCalledTimes(1);

    let memberSequence = 0;
    const rooms = new RoomManager({
      availableRules: (setId) => service.availableRules(setId),
      createRoomId: () => 'released-rule-room',
      createMemberId: () => `released-member-${String(++memberSequence)}`,
      randomIndex: () => 0,
      reducer: {
        random: () => 0.999_999,
        rulePortForSet: (setId) => service.rulePortForSet(setId),
        resolveRuleMessage: (ruleId, messageKey, params) =>
          service.resolveMessage(ruleId, messageKey, params),
        releaseRulePort: (setId) => service.releaseRulePort(setId),
      },
    });
    const created = rooms.create({
      userId: 'release-host',
      displayName: 'ホスト',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const started = rooms.apply(created.value.room.roomId, {
      type: 'start',
      memberId: created.value.member.memberId,
      now: 2_100,
      setSeed: 'released-rule-set',
    });
    expect(started?.state.fixedRules?.map(({ ruleId }) => ruleId)).toEqual([
      'r0001-a',
    ]);
    const engine = started?.state.engine;
    expect(engine?.phase.name).toBe('gameInProgress');
    if (!started || !engine || engine.phase.name !== 'gameInProgress') return;
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
    const played = rooms.apply(started.state.roomId, {
      type: 'play',
      memberId: player,
      turnSeq: started.state.turnSeq,
      cards: legal[0]!.cards.map((card) => card.id),
      now: 2_101,
    });
    expect(played?.accepted).toBe(true);
    expect(played?.state.lastEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ t: 'ruleFired', ruleId: 'r0001-a' }),
      ]),
    );
    expect(viewFor(played!.state, player).events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          t: 'ruleFired',
          ruleId: 'r0001-a',
          name: 'ルールA',
          message: 'ルールA!',
          messageKey: 'fired',
        }),
      ]),
    );
    const firedResult = {
      gameIndex: 0,
      standings: engine.members.map((member, index) => {
        const standing = (index + 1) as Standing;
        return {
          player: member.id,
          standing,
          title: TITLE_BY_STANDING[standing],
        };
      }),
      firedRuleIds: ['r0001-a'],
    } satisfies GameResult;
    const outcome = {
      setId: engine.setId,
      standings: firedResult.standings.map((standing) => ({
        player: standing.player,
        totalStanding: standing.standing,
        title: standing.title,
        points: 1,
      })),
      members: engine.members,
      wasActiveRuleIds: ['r0001-a'],
      firedRuleIds: ['r0001-a'],
      results: [firedResult],
      completion: 'drained',
      gamesPlayed: 1,
    } satisfies SetOutcome;
    const setResultState = {
      ...played!.state,
      phase: 'setResult',
      setRespondBy: 3_000,
      firedRuleCounts: { 'r0001-a': 3 },
      engine: {
        ...played!.state.engine!,
        phase: { name: 'setResult' },
        results: [firedResult],
        outcome,
      },
    } satisfies RoomState;
    expect(viewFor(setResultState, player).setResult?.firedRules).toEqual([
      { ruleId: 'r0001-a', ruleName: 'ルールA', count: 3 },
    ]);

    expect(service.synchronizeCodeRegistry()).toMatchObject({
      registered: [],
      versions: [],
      failures: [],
    });
    expect(service.enable('r0001-a')).toMatchObject({
      status: 'unchanged',
      rule: { status: 'active' },
    });
    expect(onReleased).toHaveBeenCalledTimes(1);
  });
});
