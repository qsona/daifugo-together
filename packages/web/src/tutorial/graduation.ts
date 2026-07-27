import type { PlayerRoomView } from '@daifugo/core';

import type { PlayedBeforeStorage } from './played-before';

export const GRADUATION_STORAGE_KEY = 'daifugo.tutorialGraduation';

export type GraduationState =
  | { kind: 'candidate'; roomId: string }
  | { kind: 'emphasized'; snapshotKey: string };

function graduationSnapshotKey(room: PlayerRoomView): string | null {
  return room.setResult
    ? `${room.roomId}:${String(room.setResult.respondBy)}`
    : null;
}

export function readGraduationState(
  storage: Pick<PlayedBeforeStorage, 'getItem'> | null | undefined,
): GraduationState | null {
  try {
    const value = storage?.getItem(GRADUATION_STORAGE_KEY);
    if (!value) return null;
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || !('kind' in parsed)) {
      return null;
    }
    if (
      parsed.kind === 'candidate' &&
      'roomId' in parsed &&
      typeof parsed.roomId === 'string'
    ) {
      return { kind: 'candidate', roomId: parsed.roomId };
    }
    if (
      parsed.kind === 'emphasized' &&
      'snapshotKey' in parsed &&
      typeof parsed.snapshotKey === 'string'
    ) {
      return { kind: 'emphasized', snapshotKey: parsed.snapshotKey };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeGraduationState(
  storage: Pick<PlayedBeforeStorage, 'setItem'> | null | undefined,
  state: GraduationState,
): void {
  try {
    storage?.setItem(GRADUATION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Tutorial metadata must never stop room play.
  }
}

export function reduceGraduationState(
  state: GraduationState | null,
  input: {
    playedBefore: boolean;
    room: PlayerRoomView | null;
  },
): GraduationState | null {
  if (state?.kind === 'emphasized') return state;
  if (input.room?.mode !== 'basic') return state;

  if (input.room.phase === 'setResult') {
    const snapshotKey = graduationSnapshotKey(input.room);
    return state?.kind === 'candidate' && snapshotKey
      ? { kind: 'emphasized', snapshotKey }
      : state;
  }

  if (!input.playedBefore || state?.kind === 'candidate') {
    return { kind: 'candidate', roomId: input.room.roomId };
  }
  return state;
}

export function isGraduationEmphasized(
  state: GraduationState | null,
  room: PlayerRoomView,
): boolean {
  const snapshotKey = graduationSnapshotKey(room);
  return (
    state?.kind === 'emphasized' &&
    snapshotKey !== null &&
    state.snapshotKey === snapshotKey
  );
}
