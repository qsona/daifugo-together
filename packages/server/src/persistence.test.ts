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
      reducer: { random: () => 0.999_999 },
    });
    const created = rooms.create({
      userId: 'persistent-user',
      displayName: '永続ユーザー',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

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
    persistence.close();
  });
});
