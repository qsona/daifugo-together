import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { enumerateLegalPlays } from '@daifugo/core';
import { afterEach, describe, expect, it } from 'vitest';

import { SqlitePersistence } from './persistence.js';
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
});
