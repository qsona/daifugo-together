import {
  CARD_RANKS,
  SUITS,
  type Card,
  type JokerCard,
  type NaturalCard,
} from '../cards/card.js';
import type { GameConfig, GameState } from '../game/types.js';
import { buildRuleContext, prepareRuleInvocation } from '../rules/context.js';
import {
  NO_RULE_CHAIN_PORT,
  noRuleRuntime,
  type RuleRuntime,
} from '../rules/chain.js';
import {
  engineFeaturesOf,
  type EngineFeature,
  type Legality,
} from '../rules/contract.js';
import { safeModifyLegality, safeModifyStrength } from '../rules/safe-port.js';
import {
  compareRanks,
  BASE_STRENGTH_ORDER,
  type StrengthOrder,
} from './strength.js';
import type { Play, PlayKind } from './play.js';

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

function naturalsOf(hand: readonly Card[]): NaturalCard[] {
  return hand.filter((card) => card.kind === 'natural');
}

function jokersOf(hand: readonly Card[]): JokerCard[] {
  return hand
    .filter((card) => card.kind === 'joker')
    .sort((left, right) => left.id.localeCompare(right.id));
}

export type CandidateGenerator = (hand: readonly Card[]) => Play[];

function generateSingles(hand: readonly Card[]): Play[] {
  return hand.map((card) => ({
    kind: 'single' as const,
    cards: [card],
    count: 1,
    repRank: card.kind === 'natural' ? card.rank : 'joker',
  }));
}

function generateSets(hand: readonly Card[]): Play[] {
  const jokers = jokersOf(hand);
  const byRank = Map.groupBy(naturalsOf(hand), (card) => card.rank);
  const sets: Play[] = [];
  for (const [rank, cards] of byRank) {
    for (let count = 2; count <= 4; count += 1) {
      const maxJokers = Math.min(jokers.length, count - 1);
      for (let jokerCount = 0; jokerCount <= maxJokers; jokerCount += 1) {
        const naturalCount = count - jokerCount;
        if (naturalCount > cards.length) {
          continue;
        }
        for (const selected of combinations(cards, naturalCount)) {
          sets.push({
            kind: 'set',
            cards: [...selected, ...jokers.slice(0, jokerCount)],
            count,
            repRank: rank,
          });
        }
      }
    }
  }
  if (jokers.length >= 2) {
    sets.push({
      kind: 'set',
      cards: jokers.slice(0, 2),
      count: 2,
      repRank: 'joker',
    });
  }
  return sets;
}

function generateSequences(hand: readonly Card[]): Play[] {
  const jokers = jokersOf(hand);
  const naturals = naturalsOf(hand);
  const sequences: Play[] = [];
  for (const suit of SUITS) {
    const byRankIndex = new Map<number, NaturalCard>();
    for (const card of naturals) {
      if (card.suit === suit) {
        byRankIndex.set(CARD_RANKS.indexOf(card.rank), card);
      }
    }
    for (let start = 0; start <= CARD_RANKS.length - 3; start += 1) {
      let missingCount = 0;
      for (let end = start; end < CARD_RANKS.length; end += 1) {
        if (!byRankIndex.has(end)) {
          missingCount += 1;
        }
        // missingCount は end に対して単調非減少なので打ち切れる
        if (missingCount > jokers.length) {
          break;
        }
        const count = end - start + 1;
        if (count < 3) {
          continue;
        }
        const naturalPositions: number[] = [];
        for (let position = start; position <= end; position += 1) {
          if (byRankIndex.has(position)) {
            naturalPositions.push(position);
          }
        }
        // 自然カードがある位置もジョーカーで代用できる (set と同じ意味論)。
        const spareJokers = jokers.length - missingCount;
        const maxExtra = Math.min(spareJokers, naturalPositions.length - 1);
        for (let extra = 0; extra <= maxExtra; extra += 1) {
          for (const substituted of combinations(naturalPositions, extra)) {
            const substitutedSet = new Set(substituted);
            let jokerCursor = 0;
            const cards: Card[] = [];
            for (let position = start; position <= end; position += 1) {
              const natural = byRankIndex.get(position);
              if (natural && !substitutedSet.has(position)) {
                cards.push(natural);
              } else {
                cards.push(jokers[jokerCursor]!);
                jokerCursor += 1;
              }
            }
            sequences.push({
              kind: 'sequence',
              cards,
              count,
              repRank: CARD_RANKS[end]!,
            });
          }
        }
      }
    }
  }
  return sequences;
}

const CANDIDATE_GENERATORS: readonly {
  kind: PlayKind;
  requires?: EngineFeature;
  generate: CandidateGenerator;
}[] = [
  { kind: 'single', generate: generateSingles },
  { kind: 'set', generate: generateSets },
  { kind: 'sequence', requires: 'sequence', generate: generateSequences },
];

function candidateKey(play: Play): string {
  const naturalIds = play.cards
    .filter((card) => card.kind === 'natural')
    .map((card) => card.id)
    .sort()
    .join(',');
  const jokerCount = play.cards.filter((card) => card.kind === 'joker').length;
  return `${play.kind}|${play.count}|${play.repRank}|${naturalIds}|${jokerCount}`;
}

function dedupeCandidates(plays: readonly Play[]): Play[] {
  const seen = new Set<string>();
  const result: Play[] = [];
  for (const play of plays) {
    const key = candidateKey(play);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(play);
  }
  return result;
}

export function generateCandidates(
  hand: readonly Card[],
  features: readonly EngineFeature[] = [],
): Play[] {
  return dedupeCandidates(
    CANDIDATE_GENERATORS.flatMap((generator) =>
      generator.requires !== undefined && !features.includes(generator.requires)
        ? []
        : generator.generate(hand),
    ),
  );
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
  strength: StrengthOrder;
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
      strength: BASE_STRENGTH_ORDER,
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
    strength: strengthResult.result,
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
  const candidates = generateCandidates(
    playerState.hand,
    engineFeaturesOf(config.ruleChain),
  );
  const evaluated = evaluateCandidates(config, state, candidates, runtime);
  return evaluated.plays;
}
