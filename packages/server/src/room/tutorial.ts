import type { RoomState } from './types.js';

/**
 * `scripts/find-tutorial-seed.mjs` で探索した seat 0 用の seed。
 * 静的条件は ♦3・ペア・高位札スコア1位。実 AI 5試行では1位80%、
 * 2位以内100%、場流れ遭遇100%だった(いずれも勝敗・場流れの保証ではない)。
 */
export const TUTORIAL_SET_SEED = 'tutorial-11';

export function setSeedForRoomStart(
  room: RoomState,
  createDefaultSeed: () => string,
): string {
  const humanCount = room.members.filter(
    (member) => !member.isAI && !member.departed,
  ).length;
  return room.mode === 'basic' && room.setNo === 0 && humanCount === 1
    ? TUTORIAL_SET_SEED
    : createDefaultSeed();
}
