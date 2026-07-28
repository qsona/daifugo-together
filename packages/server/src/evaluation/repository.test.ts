import { afterEach, describe, expect, it } from 'vitest';

import { SqlitePersistence } from '../persistence.js';
import { proposalContentHash } from '../proposal/repository.js';
import {
  shouldEliminate,
  wilsonLowerBound,
  type SetSnapshotInput,
} from './repository.js';
import { EvaluationService } from './service.js';

const instances: SqlitePersistence[] = [];

afterEach(() => {
  for (const instance of instances.splice(0)) instance.close();
});

function persistence(): SqlitePersistence {
  const value = new SqlitePersistence(':memory:');
  instances.push(value);
  return value;
}

function registerRule(
  database: SqlitePersistence,
  ruleId: string,
  now = 1_000,
): void {
  const author = database.sessions.resolve(undefined);
  const proposal = {
    kind: 'original' as const,
    prefectureCode: null,
    name: `${ruleId} の提案`,
    body: `${ruleId} の本文`,
  };
  const proposalId = `proposal-${ruleId}`;
  database.proposals.create({
    id: proposalId,
    authorId: author.userId,
    proposal,
    contentHash: proposalContentHash(proposal),
    now,
    commitSignals: () => undefined,
  });
  database.rules.register({
    id: ruleId,
    slug: ruleId,
    name: ruleId,
    description: `${ruleId} の説明`,
    kind: 'original',
    prefecture: null,
    proposalId,
    status: 'active',
    disabledReason: null,
    now,
  });
}

function recordSet(
  database: SqlitePersistence,
  input: {
    setId: string;
    participantUserIds: string[];
    endedAt?: number;
    gamesPlayed?: number;
    completion?: 'completed' | 'drained';
    firedRuleIds?: string[];
    allRuleIds?: string[];
  },
): void {
  const allRuleIds = input.allRuleIds ?? input.firedRuleIds ?? [];
  database.evaluations.recordSet({
    setId: input.setId,
    roomId: 'room-1',
    startedAt: 1_000,
    endedAt: input.endedAt ?? 2_000,
    gamesPlayed: input.gamesPlayed ?? 3,
    completion: input.completion ?? 'completed',
    standings: [],
    participantUserIds: input.participantUserIds,
    rules: allRuleIds.map((ruleId, position) => ({
      ruleId,
      position,
      bundleHash: `bundle-${ruleId}`,
      popularityScore: 0.5,
      didFire: (input.firedRuleIds ?? []).includes(ruleId),
    })),
  } satisfies SetSnapshotInput);
}

describe('評価保存と人気度', () => {
  it('参加者だけが打ち切りセットを即時評価でき、付け替えと取り消しを保存する', () => {
    const database = persistence();
    registerRule(database, 'rule-fired');
    registerRule(database, 'rule-unfired');
    const participant = database.sessions.resolve(undefined);
    const outsider = database.sessions.resolve(undefined);
    recordSet(database, {
      setId: 'set-drained',
      participantUserIds: [participant.userId],
      gamesPlayed: 1,
      completion: 'drained',
      firedRuleIds: ['rule-fired'],
      allRuleIds: ['rule-fired', 'rule-unfired'],
    });
    const service = new EvaluationService(database.evaluations, {
      now: () => 2_100,
    });

    expect(service.get(null, 'set-drained').status).toBe(401);
    expect(service.get(outsider.userToken, 'set-drained').status).toBe(403);
    expect(
      service.update(participant.userToken, 'set-drained', {
        setRating: 'fun',
      }),
    ).toEqual({
      status: 200,
      body: {
        status: 'updated',
        state: { setRating: 'fun', ruleVotes: [] },
        eliminatedRuleIds: [],
      },
    });
    service.update(participant.userToken, 'set-drained', {
      ruleVote: { ruleId: 'rule-fired', vote: 'up' },
    });
    service.update(participant.userToken, 'set-drained', {
      ruleVote: { ruleId: 'rule-fired', vote: 'down' },
    });
    expect(database.evaluations.voteStats('rule-fired')).toEqual({
      up: 0,
      down: 1,
    });
    expect(service.get(participant.userToken, 'set-drained').body).toEqual({
      setRating: 'fun',
      ruleVotes: [{ ruleId: 'rule-fired', vote: 'down' }],
    });

    service.update(participant.userToken, 'set-drained', {
      ruleVote: { ruleId: 'rule-fired', vote: null },
    });
    expect(database.evaluations.voteStats('rule-fired')).toEqual({
      up: 0,
      down: 0,
    });
  });

  it('未発火ルールを拒否したとき、同じ要求のセット評価も残さない', () => {
    const database = persistence();
    registerRule(database, 'rule-unfired');
    const participant = database.sessions.resolve(undefined);
    recordSet(database, {
      setId: 'set-1',
      participantUserIds: [participant.userId],
      allRuleIds: ['rule-unfired'],
    });

    expect(
      database.evaluations.update(
        participant.userToken,
        'set-1',
        {
          setRating: 'fun',
          ruleVote: { ruleId: 'rule-unfired', vote: 'down' },
        },
        2_100,
      ),
    ).toEqual({ status: 'invalid_rule' });
    expect(database.evaluations.state(participant.userToken, 'set-1')).toEqual({
      setRating: null,
      ruleVotes: [],
    });
  });

  it('人気度はルールごとに各ユーザーの最新票だけを Beta(5,5) で集計する', () => {
    const database = persistence();
    registerRule(database, 'rule-1');
    const first = database.sessions.resolve(undefined);
    const second = database.sessions.resolve(undefined);
    recordSet(database, {
      setId: 'set-1',
      participantUserIds: [first.userId],
      firedRuleIds: ['rule-1'],
    });
    recordSet(database, {
      setId: 'set-2',
      participantUserIds: [first.userId, second.userId],
      firedRuleIds: ['rule-1'],
    });

    database.evaluations.update(
      first.userToken,
      'set-1',
      { ruleVote: { ruleId: 'rule-1', vote: 'up' } },
      2_100,
    );
    database.evaluations.update(
      first.userToken,
      'set-2',
      { ruleVote: { ruleId: 'rule-1', vote: 'down' } },
      2_200,
    );
    database.evaluations.update(
      second.userToken,
      'set-2',
      { ruleVote: { ruleId: 'rule-1', vote: 'up' } },
      2_300,
    );

    expect(database.rules.get('rule-1')).toMatchObject({
      ratingUp: 1,
      ratingDown: 1,
      popularityScore: 0.5,
      popularityUpdatedAt: 2_300,
    });
  });

  it('評価可能期間を過ぎた書き込みを拒否する', () => {
    const database = persistence();
    const participant = database.sessions.resolve(undefined);
    recordSet(database, {
      setId: 'set-expired',
      participantUserIds: [participant.userId],
      endedAt: 2_000,
    });
    expect(
      database.evaluations.update(
        participant.userToken,
        'set-expired',
        { setRating: 'neutral' },
        2_000 + 60 * 60 * 1_000 + 1,
      ),
    ).toEqual({ status: 'expired' });
  });
});

describe('自動排除と復活', () => {
  it('Wilson 下限を設定値で判定し、復活前の票を次の評価窓へ持ち越さない', () => {
    const database = persistence();
    registerRule(database, 'rule-1');
    database.evaluations.setSetting('elimination_n_min', '1', 1_100);
    database.evaluations.setSetting('elimination_theta', '0.7', 1_100);
    database.evaluations.setSetting('elimination_z', '0.01', 1_100);
    const first = database.sessions.resolve(undefined);
    recordSet(database, {
      setId: 'set-before-reinstate',
      participantUserIds: [first.userId],
      firedRuleIds: ['rule-1'],
    });

    expect(
      database.evaluations.update(
        first.userToken,
        'set-before-reinstate',
        { ruleVote: { ruleId: 'rule-1', vote: 'down' } },
        2_100,
      ),
    ).toMatchObject({ eliminatedRuleIds: ['rule-1'] });
    expect(database.rules.get('rule-1')?.status).toBe('removed');
    expect(
      database.evaluations.reinstate('rule-1', '誤排除を確認', 3_000),
    ).toBe(true);
    expect(database.rules.get('rule-1')?.status).toBe('active');
    expect(
      database.evaluations.evaluateElimination('rule-1', null, 3_100),
    ).toBe(false);

    const second = database.sessions.resolve(undefined);
    recordSet(database, {
      setId: 'set-after-reinstate',
      participantUserIds: [second.userId],
      endedAt: 3_100,
      firedRuleIds: ['rule-1'],
    });
    expect(
      database.evaluations.update(
        second.userToken,
        'set-after-reinstate',
        { ruleVote: { ruleId: 'rule-1', vote: 'down' } },
        3_200,
      ),
    ).toMatchObject({ eliminatedRuleIds: ['rule-1'] });
    expect(
      database.evaluations.reinstate('rule-1', '二度目の復活確認', 4_000),
    ).toBe(true);
    expect(
      database.evaluations.evaluateElimination('rule-1', null, 4_050),
    ).toBe(false);
    expect(
      database.evaluations.update(
        first.userToken,
        'set-before-reinstate',
        { ruleVote: { ruleId: 'rule-1', vote: 'down' } },
        4_100,
      ),
    ).toMatchObject({ eliminatedRuleIds: ['rule-1'] });
  });

  it('既定値では 10 件すべて低評価なら排除し、混在票は排除しない', () => {
    expect(wilsonLowerBound(10, 10)).toBeGreaterThanOrEqual(0.7);
    expect(shouldEliminate(0, 10)).toBe(true);
    expect(shouldEliminate(1, 9)).toBe(false);
    expect(shouldEliminate(0, 9)).toBe(false);
  });
});
