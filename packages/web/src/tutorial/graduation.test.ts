import type { PlayerRoomView } from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import {
  isGraduationEmphasized,
  readGraduationState,
  reduceGraduationState,
  writeGraduationState,
} from './graduation';

function room(
  roomId: string,
  phase: PlayerRoomView['phase'],
  v: number,
  respondBy = 1_000,
): PlayerRoomView {
  return {
    v,
    roomId,
    inviteCode: '01234',
    mode: 'basic',
    phase,
    members: [],
    you: { memberId: 'member-1', seatId: 0 },
    activeRules: [],
    game: null,
    setResult:
      phase === 'setResult'
        ? {
            standings: [],
            finalGame: null,
            respondBy,
            firedRules: [],
          }
        : null,
    events: [],
  };
}

describe('TU-04: 初回卒業強調のclient-local状態', () => {
  it('未プレイで入ったbasic候補を、最初に完走したsetResult fingerprintへ確定する', () => {
    const candidate = reduceGraduationState(null, {
      playedBefore: false,
      room: room('room-1', 'waiting', 1),
    });
    expect(candidate).toEqual({ kind: 'candidate', roomId: 'room-1' });

    const completed = reduceGraduationState(candidate, {
      playedBefore: true,
      room: room('room-1', 'setResult', 20),
    });
    expect(completed).toEqual({
      kind: 'emphasized',
      snapshotKey: 'room-1:1000',
    });
    expect(
      isGraduationEmphasized(completed, room('room-1', 'setResult', 20)),
    ).toBe(true);
  });

  it('同じsetResultのvが進んでも強調を保ち、2セット目はrespondByが違うため強調しない', () => {
    const completed = {
      kind: 'emphasized',
      snapshotKey: 'room-1:1000',
    } as const;

    expect(
      isGraduationEmphasized(completed, room('room-1', 'setResult', 40)),
    ).toBe(true);
    expect(
      isGraduationEmphasized(completed, room('room-1', 'setResult', 40, 2_000)),
    ).toBe(false);
  });

  it('未完走で別basicへ移ると候補を更新し、最初に完走した側を強調する', () => {
    const first = reduceGraduationState(null, {
      playedBefore: false,
      room: room('room-1', 'playing', 2),
    });
    const moved = reduceGraduationState(first, {
      playedBefore: true,
      room: room('room-2', 'waiting', 1),
    });
    const completed = reduceGraduationState(moved, {
      playedBefore: true,
      room: room('room-2', 'setResult', 20),
    });

    expect(moved).toEqual({ kind: 'candidate', roomId: 'room-2' });
    expect(
      isGraduationEmphasized(completed, room('room-2', 'setResult', 20)),
    ).toBe(true);
  });

  it('既プレイで候補がない端末はbasicを完走しても強調しない', () => {
    const completed = reduceGraduationState(null, {
      playedBefore: true,
      room: room('room-1', 'setResult', 20),
    });

    expect(completed).toBeNull();
  });

  it('状態を保存・再読込し、壊れた値やstorage例外は無視する', () => {
    const stored = new Map<string, string>();
    const storage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    };
    const state = {
      kind: 'emphasized',
      snapshotKey: 'room-1:1000',
    } as const;
    writeGraduationState(storage, state);
    expect(readGraduationState(storage)).toEqual(state);

    stored.set('daifugo.tutorialGraduation', '{broken');
    expect(readGraduationState(storage)).toBeNull();
    expect(
      readGraduationState({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBeNull();
    expect(() =>
      writeGraduationState(
        {
          setItem: () => {
            throw new Error('full');
          },
        },
        state,
      ),
    ).not.toThrow();
  });
});
