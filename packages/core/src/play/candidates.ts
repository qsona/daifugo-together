import type { Card } from '../cards/card.js';
import type { GameConfig, GameState } from '../game/types.js';
import { buildRuleContext } from '../rules/context.js';
import { noRuleRuntime, type RuleRuntime } from '../rules/chain.js';
import type { Legality } from '../rules/contract.js';
import { compareRanks, BASE_STRENGTH_ORDER } from './strength.js';
import type { Play } from './play.js';

function combinations<T>(items: readonly T[], count: number): T[][] {
  if (count === 0) {
    return [[]];
  }
  return items.flatMap((item, index) =>
    combinations(items.slice(index + 1), count - 1).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

export function generateCandidates(hand: readonly Card[]): Play[] {
  const singles: Play[] = hand.map((card) => ({
    kind: 'single',
    cards: [card],
    count: 1,
    repRank: card.rank,
  }));

  const byRank = Map.groupBy(hand, (card) => card.rank);
  const sets: Play[] = [];
  for (const [rank, cards] of byRank) {
    for (let count = 2; count <= Math.min(4, cards.length); count += 1) {
      for (const selected of combinations(cards, count)) {
        sets.push({
          kind: 'set',
          cards: selected,
          count,
          repRank: rank,
        });
      }
    }
  }
  return [...singles, ...sets];
}

function baseLegality(
  state: GameState,
  play: Play,
  strength: ReturnType<RuleRuntime['port']['modifyStrength']>['result'],
): Legality {
  const current = state.public.field.current;
  if (!current) {
    return { legal: true };
  }
  if (
    current.play.kind !== play.kind ||
    current.play.count !== play.count ||
    compareRanks(play.repRank, current.play.repRank, strength) <= 0
  ) {
    return { legal: false, reasonKey: 'TOO_WEAK' };
  }
  return { legal: true };
}

export function evaluateCandidates(
  config: GameConfig,
  state: GameState,
  plays: Play[],
  runtime: RuleRuntime = noRuleRuntime(),
): { plays: Play[]; results: Legality[]; influenced: string[] } {
  const baseContext = buildRuleContext(
    config,
    state,
    BASE_STRENGTH_ORDER,
    runtime,
  );
  const strengthResult = runtime.port.modifyStrength(
    config.ruleChain,
    baseContext,
    BASE_STRENGTH_ORDER,
  );
  const context = buildRuleContext(
    config,
    state,
    strengthResult.result,
    runtime,
  );
  const base = plays.map((play) =>
    baseLegality(state, play, strengthResult.result),
  );
  const legalityResult = runtime.port.modifyLegality(
    config.ruleChain,
    context,
    plays,
    base,
  );
  const legalPlays = plays.filter(
    (_play, index) => legalityResult.results[index]?.legal === true,
  );
  return {
    plays: legalPlays,
    results: legalityResult.results,
    influenced: [
      ...new Set([...strengthResult.influenced, ...legalityResult.influenced]),
    ],
  };
}

export function enumerateLegalPlays(
  config: GameConfig,
  state: GameState,
  player: string,
  runtime: RuleRuntime = noRuleRuntime(),
): Play[] {
  const playerState = state.players[player];
  if (!playerState || playerState.status !== 'active') {
    return [];
  }
  const candidates = generateCandidates(playerState.hand);
  const evaluated = evaluateCandidates(config, state, candidates, runtime);
  if (!state.public.field.current && evaluated.plays.length === 0) {
    return candidates;
  }
  return evaluated.plays;
}
