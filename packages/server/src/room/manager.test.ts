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

describe('RoomManager indexes', () => {
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

    const closed = rooms.apply(roomId, { type: 'leave', memberId });
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
      }),
    ).toBeUndefined();
  });
});
