import {
  TITLE_BY_STANDING,
  type PlayerId,
  type Standing,
} from '../game/types.js';
import type { SetOutcome, SetState } from './types.js';

/**
 * 各戦の順位に与える点。4 人固定の確定仕様(1 位から 5-3-2-1)。
 * 1 位と 2 位の差を大きく取り、セット全体の勝ちを 1 位の数で決めやすくする。
 */
export const POINTS_BY_STANDING: Record<Standing, number> = {
  1: 5,
  2: 3,
  3: 2,
  4: 1,
};

export function scoreSet(
  setId: string,
  state: Pick<SetState, 'members' | 'ruleChain' | 'results'>,
  completion: SetOutcome['completion'] = 'completed',
): SetOutcome {
  if (state.results.length === 0) {
    throw new Error('Cannot score a set without results');
  }
  const finalResult = state.results.at(-1);
  if (!finalResult) {
    throw new Error('Final result is missing');
  }
  const points = new Map<PlayerId, number>(
    state.members.map((member) => [member.id, 0]),
  );
  for (const result of state.results) {
    for (const standing of result.standings) {
      points.set(
        standing.player,
        (points.get(standing.player) ?? 0) +
          POINTS_BY_STANDING[standing.standing],
      );
    }
  }
  const finalStanding = new Map(
    finalResult.standings.map((standing) => [
      standing.player,
      standing.standing,
    ]),
  );
  const ordered = state.members
    .map((member) => ({
      player: member.id,
      points: points.get(member.id) ?? 0,
      lastStanding: finalStanding.get(member.id) ?? 4,
    }))
    .sort(
      (left, right) =>
        right.points - left.points || left.lastStanding - right.lastStanding,
    );
  const standings = ordered.map((entry, index) => {
    const totalStanding = (index + 1) as Standing;
    return {
      player: entry.player,
      totalStanding,
      title: TITLE_BY_STANDING[totalStanding],
      points: entry.points,
    };
  });
  return {
    setId,
    standings,
    members: state.members,
    wasActiveRuleIds: state.ruleChain.map((entry) => entry.ruleId),
    firedRuleIds: [
      ...new Set(state.results.flatMap((result) => result.firedRuleIds)),
    ],
    results: state.results,
    completion,
    gamesPlayed: state.results.length,
  };
}
