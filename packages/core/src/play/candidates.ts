import type { Card } from '../cards/card.js';
import type { GameConfig, GameState } from '../game/types.js';
import { buildRuleContext, prepareRuleInvocation } from '../rules/context.js';
import {
  NO_RULE_CHAIN_PORT,
  noRuleRuntime,
  type RuleRuntime,
} from '../rules/chain.js';
import type { Legality } from '../rules/contract.js';
import { safeModifyLegality, safeModifyStrength } from '../rules/safe-port.js';
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
  options: { authoritative?: boolean } = {},
): {
  state: GameState;
  plays: Play[];
  results: Legality[];
  baseResults: Legality[];
  influenced: string[];
  failsafeActivated: boolean;
} {
  if (config.ruleChain.length === 0 && runtime.port === NO_RULE_CHAIN_PORT) {
    const base = plays.map((play) =>
      baseLegality(state, play, BASE_STRENGTH_ORDER),
    );
    return {
      state,
      plays: plays.filter((_play, index) => base[index]?.legal === true),
      results: base,
      baseResults: base,
      influenced: [],
      failsafeActivated: false,
    };
  }
  const strengthInvocation = prepareRuleInvocation(
    state,
    config.ruleChain,
    'modifyStrength',
    options.authoritative ?? false,
  );
  const baseContext = buildRuleContext(
    config,
    strengthInvocation.state,
    BASE_STRENGTH_ORDER,
    runtime,
    {
      hook: 'modifyStrength',
      invocationIndices: strengthInvocation.invocationIndices,
    },
  );
  const strengthResult = safeModifyStrength(
    runtime.port,
    config.ruleChain,
    baseContext,
    BASE_STRENGTH_ORDER,
  );
  const legalityInvocation = prepareRuleInvocation(
    strengthInvocation.state,
    config.ruleChain,
    'modifyLegality',
    options.authoritative ?? false,
  );
  const context = buildRuleContext(
    config,
    legalityInvocation.state,
    strengthResult.result,
    runtime,
    {
      hook: 'modifyLegality',
      invocationIndices: legalityInvocation.invocationIndices,
    },
  );
  const base = plays.map((play) =>
    baseLegality(legalityInvocation.state, play, strengthResult.result),
  );
  const legalityResult = safeModifyLegality(
    runtime.port,
    config.ruleChain,
    context,
    plays,
    base,
  );
  let legalPlays = plays.filter(
    (_play, index) => legalityResult.results[index]?.legal === true,
  );
  const failsafeActivated =
    state.public.field.current === undefined &&
    legalPlays.length === 0 &&
    base.some((result) => result.legal);
  const finalResults = failsafeActivated ? base : legalityResult.results;
  if (failsafeActivated) {
    legalPlays = plays.filter((_play, index) => base[index]?.legal === true);
  }
  return {
    state: legalityInvocation.state,
    plays: legalPlays,
    results: finalResults,
    baseResults: base,
    influenced: [
      ...new Set([...strengthResult.influenced, ...legalityResult.influenced]),
    ],
    failsafeActivated,
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
  return evaluated.plays;
}
