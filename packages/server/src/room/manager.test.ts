import {
  enumerateLegalPlays,
  type RoomMode,
  type RuleChainEntry,
} from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { RoomManager, normalizeInviteCode } from './manager.js';

function manager() {
  let id = 0;
  return new RoomManager({
    now: () => 1_000 + id,
    createRoomId: () => `room-${++id}`,
    createMemberId: () => `member-${++id}`,
    randomIndex: (max) => id++ % max,
    reducer: { random: () => 0.999_999 },
  });
}

const AVAILABLE_RULE: RuleChainEntry = {
  ruleId: 'rule-community-only',
  name: 'みんなのルール',
  position: 0,
  priority: {
    score: 1,
    activatedAt: 1,
    ruleId: 'rule-community-only',
  },
  bundleHash: 'fixture',
  contractVersion: 1,
};

function modeManager() {
  let id = 0;
  return new RoomManager({
    now: () => 1_000 + id,
    createRoomId: () => `mode-room-${++id}`,
    createMemberId: () => `mode-member-${++id}`,
    randomIndex: (max) => id++ % max,
    availableRules: () => [AVAILABLE_RULE],
    reducer: {
      gamesPerSet: 1,
      random: () => 0.999_999,
    },
  });
}

function finishManagedSet(rooms: RoomManager, roomId: string): void {
  for (let guard = 0; guard < 5_000; guard += 1) {
    const state = rooms.get(roomId);
    if (!state || state.phase === 'setResult') return;
    expect(state.phase).toBe('playing');
    const engine = state.engine!;
    if (engine.phase.name === 'interimResult') {
      rooms.apply(roomId, {
        type: 'advanceIntermission',
        now: 20_000 + guard,
      });
      continue;
    }
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
    rooms.apply(
      roomId,
      legal.length === 0
        ? {
            type: 'pass',
            memberId: player,
            turnSeq: state.turnSeq,
            now: 20_000 + guard,
          }
        : {
            type: 'play',
            memberId: player,
            turnSeq: state.turnSeq,
            cards: legal[0]!.cards.map((card) => card.id),
            now: 20_000 + guard,
          },
    );
  }
  throw new Error('Set did not reach setResult');
}

function createModeRoom(mode: RoomMode) {
  const rooms = modeManager();
  const created = rooms.create(
    { userId: 'mode-user-1', displayName: 'ホスト' },
    { mode },
  );
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error('Failed to create room');
  return { rooms, created };
}

describe('RoomManager indexes', () => {
  it('availableRulesが非空でも、きほんの部屋は有効ルールを空に固定する', () => {
    const basic = createModeRoom('basic');
    expect(basic.created.value.room.availableRules).toEqual([]);
    expect(basic.created.value.room.mode).toBe('basic');

    const community = createModeRoom('community');
    expect(community.created.value.room.availableRules).toEqual([
      AVAILABLE_RULE,
    ]);
    expect(community.created.value.room.mode).toBe('community');
  });

  it.each(['continue', 'leave', 'expireSetResult'] as const)(
    '%sで2セット目へ進んでも、きほんの部屋はみんなのルールに化けない',
    (path) => {
      const { rooms, created } = createModeRoom('basic');
      const joined = rooms.join(created.value.room.inviteCode, {
        userId: 'mode-user-2',
        displayName: '参加者',
      });
      expect(joined.ok).toBe(true);
      if (!joined.ok) return;
      const roomId = created.value.room.roomId;
      const started = rooms.apply(roomId, {
        type: 'start',
        memberId: created.value.member.memberId,
        now: 2_000,
        setSeed: `basic-${path}-first`,
      });
      expect(started?.accepted).toBe(true);
      expect(started?.state.fixedRules).toEqual([]);
      finishManagedSet(rooms, roomId);

      const hostContinued = rooms.apply(roomId, {
        type: 'continue',
        memberId: created.value.member.memberId,
        now: 50_000,
        setSeed: `basic-${path}-waiting`,
      });
      expect(hostContinued?.accepted).toBe(true);
      expect(hostContinued?.state.phase).toBe('setResult');

      if (path === 'continue') {
        rooms.apply(roomId, {
          type: 'continue',
          memberId: joined.value.member.memberId,
          now: 50_001,
          setSeed: 'basic-continue-second',
        });
      } else if (path === 'leave') {
        rooms.apply(roomId, {
          type: 'leave',
          memberId: joined.value.member.memberId,
          now: 50_001,
          setSeed: 'basic-leave-second',
        });
      } else {
        const deadline = rooms.get(roomId)?.setRespondBy;
        expect(deadline).not.toBeNull();
        rooms.apply(roomId, {
          type: 'expireSetResult',
          now: deadline!,
          setSeed: 'basic-expire-second',
        });
      }

      const secondSet = rooms.get(roomId);
      expect(secondSet?.phase).toBe('playing');
      expect(secondSet?.setNo).toBe(2);
      expect(secondSet?.mode).toBe('basic');
      expect(secondSet?.availableRules).toEqual([]);
      expect(secondSet?.fixedRules).toEqual([]);
      expect(secondSet?.engine?.ruleChain).toEqual([]);
    },
  );

  it('定期sweepで期限切れロビーを閉じ、全indexを解放する', () => {
    const rooms = manager();
    const created = rooms.create({
      userId: 'user-sweep',
      displayName: '期限切れ',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(rooms.sweep(created.value.room.lobbyExpiresAt - 1)).toEqual([]);
    const results = rooms.sweep(created.value.room.lobbyExpiresAt);

    expect(results).toHaveLength(1);
    expect(results[0]?.closeReason).toBe('lobbyExpired');
    expect(results[0]?.transition.state.phase).toBe('closed');
    expect(rooms.size).toBe(0);
    expect(rooms.findByUser('user-sweep')).toBeUndefined();
  });

  it('招待コードを正規化し、作成・参加・1ユーザー1部屋を同期的に管理する', () => {
    const rooms = manager();
    const created = rooms.create({
      userId: 'user-1',
      displayName: 'ホスト',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(created.value.room.inviteCode).toMatch(
      /^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/,
    );
    expect(normalizeInviteCode(' abcd 2345 ')).toBe('ABCD-2345');
    expect(rooms.findByUser('user-1')?.room.roomId).toBe(
      created.value.room.roomId,
    );

    const joined = rooms.join(
      created.value.room.inviteCode.toLowerCase().replace('-', ' '),
      { userId: 'user-2', displayName: '参加者' },
    );
    expect(joined.ok).toBe(true);
    expect(rooms.findByUser('user-2')?.member.displayName).toBe('参加者');
    expect(rooms.create({ userId: 'user-2', displayName: '重複' })).toEqual({
      ok: false,
      code: 'ALREADY_IN_ROOM',
    });
    expect(rooms.size).toBe(1);
  });

  it('開始後は招待参加を拒否し、最後の人間離脱で全indexを破棄する', () => {
    const rooms = manager();
    const created = rooms.create({
      userId: 'user-1',
      displayName: 'ホスト',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const roomId = created.value.room.roomId;
    const memberId = created.value.member.memberId;
    const started = rooms.apply(roomId, {
      type: 'start',
      memberId,
      now: 2_000,
      setSeed: 'manager-set',
    });
    expect(started?.accepted).toBe(true);
    expect(
      rooms.join(created.value.room.inviteCode, {
        userId: 'user-2',
        displayName: '遅刻',
      }),
    ).toEqual({ ok: false, code: 'ROOM_IN_GAME' });

    const closed = rooms.apply(roomId, {
      type: 'leave',
      memberId,
      now: 2_001,
      setSeed: 'unused',
    });
    expect(closed?.state.phase).toBe('closed');
    expect(rooms.size).toBe(0);
    expect(rooms.get(roomId)).toBeUndefined();
    expect(rooms.findByUser('user-1')).toBeUndefined();
    expect(
      rooms.join(created.value.room.inviteCode, {
        userId: 'user-3',
        displayName: '失効後',
      }),
    ).toEqual({ ok: false, code: 'ROOM_NOT_FOUND' });
  });

  it('存在しない部屋のapplyは副作用なくundefinedを返す', () => {
    const rooms = manager();
    expect(
      rooms.apply('missing', {
        type: 'disconnect',
        memberId: 'missing',
        now: 1_000,
      }),
    ).toBeUndefined();
  });

  it('setResultで切断者のuser indexを解放し、残留者だけを復帰対象にする', () => {
    const rooms = manager();
    const created = rooms.create({
      userId: 'user-1',
      displayName: 'ホスト',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const joined = rooms.join(created.value.room.inviteCode, {
      userId: 'user-2',
      displayName: '切断者',
    });
    expect(joined.ok).toBe(true);
    if (!joined.ok) {
      return;
    }
    const roomId = created.value.room.roomId;
    rooms.apply(roomId, {
      type: 'start',
      memberId: created.value.member.memberId,
      now: 2_000,
      setSeed: 'manager-complete-set',
    });
    rooms.apply(roomId, {
      type: 'disconnect',
      memberId: joined.value.member.memberId,
      now: 2_001,
    });

    for (let guard = 0; guard < 5_000; guard += 1) {
      const state = rooms.get(roomId);
      expect(state).toBeDefined();
      if (!state || state.phase !== 'playing') {
        break;
      }
      const engine = state.engine!;
      if (engine.phase.name === 'interimResult') {
        rooms.apply(roomId, {
          type: 'advanceIntermission',
          now: 30_000 + guard,
        });
        continue;
      }
      if (engine.phase.name === 'setResult') {
        throw new Error('Room phase did not follow setResult');
      }
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
      rooms.apply(
        roomId,
        legal.length === 0
          ? {
              type: 'pass',
              memberId: player,
              turnSeq: state.turnSeq,
              now: 30_000 + guard,
            }
          : {
              type: 'play',
              memberId: player,
              turnSeq: state.turnSeq,
              cards: legal[0]!.cards.map((card) => card.id),
              now: 30_000 + guard,
            },
      );
    }

    expect(rooms.get(roomId)?.phase).toBe('setResult');
    expect(rooms.findByUser('user-2')).toBeUndefined();
    expect(rooms.findByUser('user-1')?.room.roomId).toBe(roomId);
    expect(rooms.create({ userId: 'user-2', displayName: '別部屋へ' }).ok).toBe(
      true,
    );
  });
});
