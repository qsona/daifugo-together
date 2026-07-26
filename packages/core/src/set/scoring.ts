import {
  TITLE_BY_STANDING,
  type PlayerId,
  type Standing,
} from '../game/types.js';
import type { SetOutcome, SetState } from './types.js';

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
          (state.members.length - standing.standing + 1),
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
