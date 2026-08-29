import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createInProcessRuleChainPort,
  enumerateLegalPlays,
  replaySet,
  TITLE_BY_STANDING,
  type GameResult,
  type ReplayAction,
  type RuleModule,
  type SetOutcome,
  type Standing,
} from '@daifugo/core';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { SqlitePersistence } from './persistence.js';
import { proposalContentHash } from './proposal/repository.js';
import { RoomManager } from './room/manager.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'daifugo-persistence-'));
  temporaryDirectories.push(directory);
  return join(directory, 'app.sqlite');
}

describe('SQLite persistence', () => {
  it('DB接続のhealthを確認できる', () => {
    const persistence = new SqlitePersistence(':memory:');
    expect(persistence.checkHealth()).toBe(true);
    persistence.close();
    expect(persistence.checkHealth()).toBe(false);
  });

  it('匿名tokenと表示名をプロセス再起動後も復元する', () => {
    const path = databasePath();
    const first = new SqlitePersistence(path, {
      createUserId: () => 'persistent-user',
      createToken: () => 'persistent-token-0001',
    });
    const issued = first.sessions.resolve(undefined);
    expect(first.sessions.rename(issued.userToken, '永続ユーザー')).toBe(true);
    first.close();

    const reopened = new SqlitePersistence(path);
    expect(reopened.sessions.resolve(issued.userToken)).toEqual({
      ...issued,
      displayName: '永続ユーザー',
    });
    reopened.close();
  });

  it('旧set_resultsへ加算migrationし、不明な発火回数を捏造しない', () => {
    const path = databasePath();
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE set_results (
        set_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      INSERT INTO set_results
        (set_id, room_id, result_json, created_at)
      VALUES
        ('legacy-set', 'legacy-room', '{"completion":"completed"}', 1);
    `);
    legacy.close();

    const migrated = new SqlitePersistence(path);
    expect(migrated.result('legacy-set')).toEqual({
      completion: 'completed',
      firedRules: [],
    });
    migrated.close();
  });

  it('廃止したpush_preferencesだけを既存DBから冪等に削除する', () => {
    const path = databasePath();
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE push_preferences (
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, type)
      );
      CREATE TABLE migration_sentinel (value TEXT NOT NULL);
      INSERT INTO migration_sentinel (value) VALUES ('kept');
    `);
    legacy.close();

    new SqlitePersistence(path).close();
    new SqlitePersistence(path).close();

    const verified = new Database(path, { readonly: true });
    const removed = verified
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'push_preferences'",
      )
      .get();
    expect(removed).toBeUndefined();
    expect(
      verified.prepare('SELECT value FROM migration_sentinel').get(),
    ).toEqual({ value: 'kept' });
    verified.close();
  });

  it('AIの自動choiceをカード・プレイヤーともruleInputとして保存する', () => {
    const persistence = new SqlitePersistence(':memory:');
    const rule: RuleModule = {
      meta: {
        ruleId: 'r-auto-choice-replay',
        name: '自動choice replay',
        description: '自動choiceをリプレイへ保存するfixture',
        kind: 'original',
        proposalId: 'auto-choice-replay-fixture',
        contractVersion: 2,
        messages: { card: 'card', player: 'player' },
      },
      hooks: {
        afterPlay(context, _play, input) {
          const actor = context.game.field.current?.by;
          if (!actor) return [];
          if (input?.kind === 'player') return [];
          if (input?.kind === 'cards') {
            return [
              {
                type: 'requestChoice',
                player: actor,
                choiceId: 'choose_player',
                players: context.game.seats.filter((id) => id !== actor),
                messageKey: 'player',
              },
            ];
          }
          return [
            {
              type: 'requestChoice',
              player: actor,
              choiceId: 'choose_card',
              from: { kind: 'hand', player: actor },
              cards: { kind: 'all' },
              count: 1,
              messageKey: 'card',
            },
          ];
        },
      },
    };
    const port = createInProcessRuleChainPort([rule]);
    const chain = {
      ruleId: rule.meta.ruleId,
      name: rule.meta.name,
      position: 0,
      priority: {
        score: 0,
        activatedAt: 1,
        ruleId: rule.meta.ruleId,
      },
      bundleHash: 'auto-choice-replay-fixture',
      contractVersion: 2 as const,
    };
    const rooms = new RoomManager({
      ...persistence.roomManagerOptions(),
      availableRules: () => [chain],
      createRoomId: () => 'auto-choice-replay-room',
      createMemberId: () => 'auto-choice-replay-host',
      randomIndex: () => 0,
      reducer: { rulePort: port, random: () => 0.999_999 },
    });
    const created = rooms.create({
      userId: 'auto-choice-replay-user',
      displayName: '自動choiceユーザー',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    let state = rooms.apply(created.value.room.roomId, {
      type: 'start',
      memberId: created.value.member.memberId,
      now: 100,
      setSeed: 'auto-choice-replay-seed',
    })!.state;
    const engine = state.engine!;
    const player = engine.currentGame!.public.turn!;
    const legal = enumerateLegalPlays(
      {
        gameIndex: 0,
        seats: engine.members.map((member) => member.id),
        gameSeed: `${engine.setSeed}:0`,
        ruleChain: engine.ruleChain,
      },
      engine.currentGame!,
      player,
      { port, setHistory: [], setMemory: engine.setMemory },
    );
    state = rooms.apply(state.roomId, {
      type: 'play',
      memberId: player,
      turnSeq: state.turnSeq,
      cards: legal[0]!.cards.map((card) => card.id),
      now: 101,
    })!.state;
    const cardRequest = state.engine!.currentGame!.private.pendingChoice!;
    const selectedCard = [...(cardRequest.optionCardIds ?? [])].sort()[0]!;
    state = rooms.apply(state.roomId, {
      type: 'autoAct',
      memberId: player,
      turnSeq: state.turnSeq,
      cards: [selectedCard],
      reason: 'ai',
      now: 102,
    })!.state;
    const playerRequest = state.engine!.currentGame!.private.pendingChoice!;
    const selectedPlayer = [
      ...(playerRequest.optionPlayerIds ?? []),
    ].sort()[0]!;
    state = rooms.apply(state.roomId, {
      type: 'autoAct',
      memberId: player,
      turnSeq: state.turnSeq,
      cards: [],
      reason: 'ai',
      now: 103,
    })!.state;

    const [init, ...actions] = persistence.replay(engine.setId);
    if (!init || !('formatVersion' in init)) {
      throw new Error('Expected replay init');
    }
    const replayActions = actions.filter(
      (record): record is ReplayAction => 'action' in record,
    );
    expect(replayActions).toMatchObject([
      { seq: 0, action: { type: 'play', player } },
      {
        seq: 1,
        action: {
          type: 'ruleInput',
          player,
          choiceId: 'choose_card',
          cardIds: [selectedCard],
        },
      },
      {
        seq: 2,
        action: {
          type: 'ruleInput',
          player,
          choiceId: 'choose_player',
          playerId: selectedPlayer,
        },
      },
    ]);
    expect(
      replaySet(init, replayActions, port).state.currentGame?.public.phase,
    ).toBe(state.engine!.currentGame!.public.phase);
    persistence.close();
  });

  it('セット開始時に固定ルールchainを保存し、終了前の評価は開かない', () => {
    const persistence = new SqlitePersistence(':memory:');
    const session = persistence.sessions.resolve(undefined);
    const proposal = {
      kind: 'original' as const,
      prefectureCode: null,
      name: '開始時固定',
      body: 'セット開始時に固定する',
    };
    persistence.proposals.create({
      id: 'proposal-start-snapshot',
      authorId: session.userId,
      proposal,
      contentHash: proposalContentHash(proposal),
      now: 1,
      commitSignals: () => undefined,
    });
    persistence.rules.register({
      id: 'r0001-start-snapshot',
      slug: 'start-snapshot',
      name: proposal.name,
      description: proposal.body,
      kind: 'original',
      prefecture: null,
      proposalId: 'proposal-start-snapshot',
      status: 'active',
      disabledReason: null,
      now: 1,
    });
    const chain = {
      ruleId: 'r0001-start-snapshot',
      name: proposal.name,
      position: 0,
      priority: {
        score: 0.5,
        activatedAt: 1,
        ruleId: 'r0001-start-snapshot',
      },
      bundleHash: 'bundle-start-snapshot',
      contractVersion: 1,
    };
    const rooms = new RoomManager({
      ...persistence.roomManagerOptions(),
      availableRules: () => [chain],
      createRoomId: () => 'start-snapshot-room',
      createMemberId: () => 'start-snapshot-member',
      randomIndex: () => 0,
    });
    const created = rooms.create({
      userId: session.userId,
      displayName: session.displayName,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const started = rooms.apply(created.value.room.roomId, {
      type: 'start',
      memberId: created.value.member.memberId,
      now: 100,
      setSeed: 'start-snapshot-seed',
    })!;

    expect(persistence.rules.snapshot(started.state.engine!.setId)).toEqual([
      {
        ruleId: chain.ruleId,
        position: 0,
        bundleHash: chain.bundleHash,
        popularityScore: 0.5,
      },
    ]);
    expect(
      persistence.evaluations.state(
        session.userToken,
        started.state.engine!.setId,
      ),
    ).toBe('not_found');
    persistence.close();
  });

  it('正確な発火回数と信頼済みルール名をset resultと同時保存し再起動後も復元する', () => {
    const path = databasePath();
    const persistence = new SqlitePersistence(path);
    const rule = {
      ruleId: 'r0001-persistent-fired',
      name: '永続発火',
      position: 0,
      priority: {
        score: 0,
        activatedAt: 1,
        ruleId: 'r0001-persistent-fired',
      },
      bundleHash: 'fixture',
      contractVersion: 1,
    };
    const rooms = new RoomManager({
      ...persistence.roomManagerOptions(),
      availableRules: () => [rule],
      createRoomId: () => 'fired-result-room',
      createMemberId: () => 'fired-result-host',
      randomIndex: () => 0,
      reducer: { random: () => 0.999_999 },
    });
    const created = rooms.create({
      userId: 'fired-result-user',
      displayName: '発火ユーザー',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const started = rooms.apply(created.value.room.roomId, {
      type: 'start',
      memberId: created.value.member.memberId,
      now: 100,
      setSeed: 'fired-result-seed',
    })!;
    const engine = started.state.engine!;
    const standings = engine.members.map((member, index) => {
      const standing = (index + 1) as Standing;
      return {
        player: member.id,
        standing,
        title: TITLE_BY_STANDING[standing],
      };
    });
    const gameResult = {
      gameIndex: 0,
      standings,
      firedRuleIds: [rule.ruleId],
    } satisfies GameResult;
    const outcome = {
      setId: engine.setId,
      standings: standings.map((entry) => ({
        player: entry.player,
        totalStanding: entry.standing,
        title: entry.title,
        points: 1,
      })),
      members: engine.members,
      wasActiveRuleIds: [rule.ruleId],
      firedRuleIds: [rule.ruleId],
      results: [gameResult],
      completion: 'drained',
      gamesPlayed: 1,
    } satisfies SetOutcome;
    const resultState = {
      ...started.state,
      phase: 'setResult' as const,
      firedRuleCounts: { [rule.ruleId]: 3 },
      engine: {
        ...engine,
        phase: { name: 'setResult' as const },
        results: [gameResult],
        outcome,
      },
    };
    persistence.commit(
      started.state,
      { type: 'requestDrain', now: 101 },
      { state: resultState, events: [], accepted: true },
    );
    persistence.close();

    const reopened = new SqlitePersistence(path);
    expect(reopened.result(engine.setId)).toMatchObject({
      completion: 'drained',
      firedRules: [
        {
          ruleId: rule.ruleId,
          ruleName: '永続発火',
          count: 3,
        },
      ],
    });
    reopened.close();
  });

  it('セット初期値と権威アクションを同一トランザクション境界で追記する', () => {
    const persistence = new SqlitePersistence(':memory:');
    let id = 0;
    const rooms = new RoomManager({
      ...persistence.roomManagerOptions(),
      createRoomId: () => 'persistent-room',
      createMemberId: () => `member-${++id}`,
      randomIndex: () => 0,
      reducer: { gamesPerSet: 1, random: () => 0.999_999 },
    });
    const created = rooms.create({
      userId: 'persistent-user',
      displayName: '永続ユーザー',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const joined = rooms.join(created.value.room.inviteCode, {
      userId: 'persistent-guest',
      displayName: '永続ゲスト',
    });
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;

    const started = rooms.apply(created.value.room.roomId, {
      type: 'start',
      memberId: created.value.member.memberId,
      now: 1_000,
      setSeed: 'persistent-set-seed',
    });
    expect(started?.accepted).toBe(true);
    const state = started!.state;
    const engine = state.engine!;
    expect(engine.phase.name).toBe('gameInProgress');
    if (engine.phase.name !== 'gameInProgress') return;
    const player = engine.currentGame!.public.turn!;
    const legal = enumerateLegalPlays(
      {
        gameIndex: engine.phase.gameIndex,
        seats: engine.members.map((member) => member.id),
        gameSeed: `${engine.setSeed}:${engine.phase.gameIndex}`,
        ruleChain: engine.ruleChain,
      },
      engine.currentGame!,
      player,
    );
    const acted = rooms.apply(
      state.roomId,
      legal.length === 0
        ? {
            type: 'pass',
            memberId: player,
            turnSeq: state.turnSeq,
            now: 1_001,
          }
        : {
            type: 'play',
            memberId: player,
            turnSeq: state.turnSeq,
            cards: legal[0]!.cards.map((card) => card.id),
            now: 1_001,
          },
    );
    expect(acted?.accepted).toBe(true);

    const replay = persistence.replay(engine.setId);
    expect(replay).toHaveLength(2);
    expect(replay[0]).toMatchObject({
      formatVersion: 1,
      setId: engine.setId,
      setSeed: 'persistent-set-seed',
    });
    expect(replay[1]).toMatchObject({ seq: 0 });

    for (let guard = 0; guard < 5_000; guard += 1) {
      const current = rooms.get(state.roomId);
      if (!current || current.phase === 'setResult') break;
      expect(current.phase).toBe('playing');
      const currentEngine = current.engine!;
      if (currentEngine.phase.name === 'interimResult') {
        rooms.apply(state.roomId, {
          type: 'advanceIntermission',
          now: 2_000 + guard,
        });
        continue;
      }
      expect(currentEngine.phase.name).toBe('gameInProgress');
      if (currentEngine.phase.name !== 'gameInProgress') break;
      const currentPlayer = currentEngine.currentGame!.public.turn!;
      const currentLegal = enumerateLegalPlays(
        {
          gameIndex: currentEngine.phase.gameIndex,
          seats: currentEngine.members.map((member) => member.id),
          gameSeed: `${currentEngine.setSeed}:${currentEngine.phase.gameIndex}`,
          ruleChain: currentEngine.ruleChain,
        },
        currentEngine.currentGame!,
        currentPlayer,
      );
      rooms.apply(
        state.roomId,
        currentLegal.length === 0
          ? {
              type: 'pass',
              memberId: currentPlayer,
              turnSeq: current.turnSeq,
              now: 2_000 + guard,
            }
          : {
              type: 'play',
              memberId: currentPlayer,
              turnSeq: current.turnSeq,
              cards: currentLegal[0]!.cards.map((card) => card.id),
              now: 2_000 + guard,
            },
      );
    }
    expect(rooms.get(state.roomId)?.phase).toBe('setResult');
    expect(persistence.result(engine.setId)).toMatchObject({
      completion: 'completed',
      gamesPlayed: 1,
    });
    expect(
      persistence
        .replay(engine.setId)
        .filter((record) => 'seq' in record)
        .map((record) => record.seq),
    ).toEqual(
      persistence
        .replay(engine.setId)
        .filter((record) => 'seq' in record)
        .map((_, index) => index),
    );

    const continued = rooms.apply(state.roomId, {
      type: 'continue',
      memberId: created.value.member.memberId,
      now: 10_000,
      setSeed: 'unused-until-all-respond',
    });
    expect(continued?.state.phase).toBe('setResult');
    const nextSet = rooms.apply(state.roomId, {
      type: 'leave',
      memberId: joined.value.member.memberId,
      now: 10_001,
      setSeed: 'second-set-seed',
    });
    expect(nextSet?.state.phase).toBe('playing');
    const nextSetId = nextSet?.state.engine?.setId;
    expect(nextSetId).not.toBe(engine.setId);
    expect(persistence.replay(nextSetId!)[0]).toMatchObject({
      formatVersion: 1,
      setId: nextSetId,
      setSeed: 'second-set-seed',
    });
    persistence.close();
  });

  it('途中参加者をセット評価の参加者へ追加し、リプレイ操作は増やさない', () => {
    const path = databasePath();
    const persistence = new SqlitePersistence(path);
    const owner = persistence.sessions.resolve(undefined);
    const late = persistence.sessions.resolve(undefined);
    const rooms = new RoomManager({
      ...persistence.roomManagerOptions(),
      createRoomId: () => 'takeover-persistence-room',
      createMemberId: () => 'takeover-owner',
      randomIndex: () => 0,
      reducer: { random: () => 0.999_999 },
    });
    const created = rooms.create(owner);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const started = rooms.apply(created.value.room.roomId, {
      type: 'start',
      memberId: created.value.member.memberId,
      now: 1_000,
      setSeed: 'takeover-persistence-set',
    });
    expect(started?.accepted).toBe(true);
    const ai = started?.state.members.find((member) => member.isAI);
    expect(ai).toBeTruthy();
    if (!ai || !started?.state.engine) return;
    const replayBefore = persistence.replay(started.state.engine.setId);

    const joined = rooms.joinTakeover(
      created.value.room.inviteCode,
      late,
      ai.memberId,
    );

    expect(joined.ok).toBe(true);
    expect(persistence.replay(started.state.engine.setId)).toEqual(
      replayBefore,
    );
    const verified = new Database(path, { readonly: true });
    expect(
      verified
        .prepare(
          'SELECT user_id FROM set_participants WHERE set_id = ? ORDER BY user_id',
        )
        .all(started.state.engine.setId),
    ).toEqual(
      [owner.userId, late.userId].sort().map((userId) => ({ user_id: userId })),
    );
    verified.close();
    persistence.close();
  });
});
