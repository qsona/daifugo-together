import { describe, expect, it, vi } from 'vitest';

import { createRoomState } from './reducer.js';
import { setSeedForRoomStart, TUTORIAL_SET_SEED } from './tutorial.js';

function room(mode: 'basic' | 'community') {
  return createRoomState({
    roomId: 'room-1',
    inviteCode: 'ABCD-2345',
    mode,
    owner: {
      memberId: 'member-1',
      userId: 'user-1',
      displayName: 'ホスト',
    },
    now: 0,
  });
}

describe('TU-03: 教材seedの発動境界', () => {
  it('初セットのbasic soloだけ教材seedを使う', () => {
    const fallback = vi.fn(() => 'fallback-seed');

    expect(setSeedForRoomStart(room('basic'), fallback)).toBe(
      TUTORIAL_SET_SEED,
    );
    expect(fallback).not.toHaveBeenCalled();
  });

  it('2セット目、community、basic人間複数は通常seedを使う', () => {
    const fallback = vi.fn(() => 'fallback-seed');
    const secondSet = { ...room('basic'), setNo: 1 };
    const community = room('community');
    const basicMulti = room('basic');
    basicMulti.members.push({
      memberId: 'member-2',
      userId: 'user-2',
      displayName: 'ゲスト',
      isAI: false,
      isHost: false,
      connected: true,
      disconnectedAt: null,
      waitingDisconnectExpiresAt: null,
      controller: 'human',
      departed: false,
      seatId: null,
      aiActing: false,
      wantsNextSet: false,
      joinedAt: 1,
    });

    expect(setSeedForRoomStart(secondSet, fallback)).toBe('fallback-seed');
    expect(setSeedForRoomStart(community, fallback)).toBe('fallback-seed');
    expect(setSeedForRoomStart(basicMulti, fallback)).toBe('fallback-seed');
    expect(fallback).toHaveBeenCalledTimes(3);
  });
});
