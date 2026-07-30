import { CARD_RANKS, type CardRank } from '../cards/card.js';
import type { Play } from '../play/play.js';
import type {
  PlayRank,
  StrengthComparisonOverride,
  StrengthOrder,
} from '../play/strength.js';
import type { EffectHook, RuleChainPort } from './chain.js';
import type {
  Legality,
  RuleChainEntry,
  RuleContext,
  Standings,
} from './contract.js';
import { detachedFrozen } from './context.js';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Reflect.ownKeys(value).every(
      (key) => typeof key === 'string' && allowed.has(key),
    )
  );
}

function isLegality(value: unknown): value is Legality {
  if (!isPlainRecord(value) || typeof value.legal !== 'boolean') {
    return false;
  }
  if (value.legal) {
    return hasExactKeys(value, ['legal']);
  }
  return (
    hasExactKeys(value, ['legal'], ['reasonKey']) &&
    (value.reasonKey === undefined || typeof value.reasonKey === 'string')
  );
}

export function cloneValidStrengthOrder(value: unknown): StrengthOrder | null {
  try {
    const cloned: unknown = structuredClone(value);
    if (
      !isPlainRecord(cloned) ||
      !hasExactKeys(
        cloned,
        ['ranking'],
        ['revolution', 'comparisonOverrides'],
      ) ||
      !Array.isArray(cloned.ranking) ||
      cloned.ranking.length !== CARD_RANKS.length ||
      (cloned.revolution !== undefined &&
        typeof cloned.revolution !== 'boolean') ||
      (cloned.comparisonOverrides !== undefined &&
        (!Array.isArray(cloned.comparisonOverrides) ||
          cloned.comparisonOverrides.length > 32))
    ) {
      return null;
    }
    const ranking = cloned.ranking;
    if (
      !ranking.every(
        (rank): rank is CardRank =>
          typeof rank === 'string' &&
          CARD_RANKS.includes(rank as (typeof CARD_RANKS)[number]),
      ) ||
      new Set(ranking).size !== CARD_RANKS.length
    ) {
      return null;
    }
    const isPlayRank = (rank: unknown): rank is PlayRank =>
      rank === 'joker' ||
      (typeof rank === 'string' &&
        CARD_RANKS.includes(rank as (typeof CARD_RANKS)[number]));
    const comparisonOverrides = cloned.comparisonOverrides;
    if (
      comparisonOverrides !== undefined &&
      !comparisonOverrides.every(
        (override): override is StrengthComparisonOverride =>
          isPlainRecord(override) &&
          hasExactKeys(override, ['stronger', 'weaker']) &&
          isPlayRank(override.stronger) &&
          isPlayRank(override.weaker) &&
          override.stronger !== override.weaker,
      )
    ) {
      return null;
    }
    return {
      ranking: [...ranking],
      ...(cloned.revolution === undefined
        ? {}
        : { revolution: cloned.revolution }),
      ...(comparisonOverrides === undefined
        ? {}
        : {
            comparisonOverrides: comparisonOverrides.map((override) => ({
              ...override,
            })),
          }),
    };
  } catch {
    return null;
  }
}

function validInfluenced(
  value: unknown,
  entries: readonly RuleChainEntry[],
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const known = new Set(entries.map((entry) => entry.ruleId));
  return [
    ...new Set(
      value.filter(
        (ruleId): ruleId is string =>
          typeof ruleId === 'string' && known.has(ruleId),
      ),
    ),
  ];
}

export function safeModifyStrength(
  port: RuleChainPort,
  entries: RuleChainEntry[],
  context: RuleContext,
  base: StrengthOrder,
): { result: StrengthOrder; influenced: string[] } {
  try {
    const returned: unknown = port.modifyStrength(
      detachedFrozen(entries) as RuleChainEntry[],
      context,
      detachedFrozen(base) as StrengthOrder,
    );
    if (!isPlainRecord(returned)) {
      return { result: base, influenced: [] };
    }
    const result = cloneValidStrengthOrder(returned.result);
    if (!result) {
      return { result: base, influenced: [] };
    }
    let composed: StrengthOrder = result;
    if (composed.revolution === undefined && base.revolution !== undefined) {
      composed = { ...composed, revolution: base.revolution };
    }
    if (
      composed.comparisonOverrides === undefined &&
      base.comparisonOverrides !== undefined
    ) {
      composed = {
        ...composed,
        comparisonOverrides: base.comparisonOverrides,
      };
    }
    return {
      result: composed,
      influenced: validInfluenced(returned.influenced, entries),
    };
  } catch {
    return { result: base, influenced: [] };
  }
}

export function safeModifyLegality(
  port: RuleChainPort,
  entries: RuleChainEntry[],
  context: RuleContext,
  plays: Play[],
  base: Legality[],
): { results: Legality[]; influenced: string[] } {
  try {
    const returned: unknown = port.modifyLegality(
      detachedFrozen(entries) as RuleChainEntry[],
      context,
      detachedFrozen(plays) as Play[],
      detachedFrozen(base) as Legality[],
    );
    const cloned: unknown = structuredClone(returned);
    if (
      !isPlainRecord(cloned) ||
      !Array.isArray(cloned.results) ||
      cloned.results.length !== base.length ||
      !cloned.results.every(isLegality)
    ) {
      return { results: base, influenced: [] };
    }
    return {
      results: cloned.results,
      influenced: validInfluenced(cloned.influenced, entries),
    };
  } catch {
    return { results: base, influenced: [] };
  }
}

export function safeCollectEffects(
  port: RuleChainPort,
  hook: EffectHook,
  entries: RuleChainEntry[],
  context: RuleContext,
  argument?: Play | Standings,
): unknown {
  try {
    const returned: unknown = port.collectEffects(
      hook,
      detachedFrozen(entries) as RuleChainEntry[],
      context,
      argument === undefined
        ? undefined
        : (detachedFrozen(argument) as Play | Standings),
    );
    return structuredClone(returned);
  } catch {
    return [];
  }
}
