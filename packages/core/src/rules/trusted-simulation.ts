import type { RuleId } from '../game/types.js';
import type { Play } from '../play/play.js';
import type {
  StrengthComparisonOverride,
  StrengthOrder,
} from '../play/strength.js';
import type { EffectHook, RuleChainPort } from './chain.js';
import type {
  Effect,
  Legality,
  RuleChainEntry,
  RuleModule,
  RulePass,
  Standings,
} from './contract.js';
import { contextForRule } from './context.js';
import type { RuleExecutionIssue } from './in-process.js';

export interface PlannedRule {
  entry: RuleChainEntry;
  module: RuleModule;
}

export interface TrustedSimulationRulePlan {
  readonly legalityRules: readonly PlannedRule[];
  readonly strengthRules: readonly PlannedRule[];
  readonly effectRules: ReadonlyMap<EffectHook, readonly PlannedRule[]>;
}

function sameLegality(left: Legality, right: Legality): boolean {
  return (
    left.legal === right.legal &&
    (left.legal || right.legal || left.reasonKey === right.reasonKey)
  );
}

function sameOverrides(
  left: readonly StrengthComparisonOverride[] | undefined,
  right: readonly StrengthComparisonOverride[] | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every(
    (entry, index) =>
      entry.stronger === right[index]?.stronger &&
      entry.weaker === right[index]?.weaker,
  );
}

function sameStrength(left: StrengthOrder, right: StrengthOrder): boolean {
  return (
    left.revolution === right.revolution &&
    left.ranking.length === right.ranking.length &&
    left.ranking.every((rank, index) => rank === right.ranking[index]) &&
    sameOverrides(left.comparisonOverrides, right.comparisonOverrides)
  );
}

/**
 * Published rule bundles are hash/meta checked before reaching this port. The
 * AI worker is disposable and the authoritative server validates its final
 * play, so per-hook defensive cloning and schema validation are intentionally
 * omitted from this hot path.
 */
export function compileTrustedSimulationRulePlan(
  entries: readonly RuleChainEntry[],
  modules: readonly RuleModule[],
): TrustedSimulationRulePlan {
  const byId = new Map(modules.map((module) => [module.meta.ruleId, module]));
  const planned: PlannedRule[] = entries.map((entry) => {
    const module = byId.get(entry.ruleId);
    if (!module) {
      throw new Error(`Missing trusted simulation rule: ${entry.ruleId}`);
    }
    return { entry, module };
  });
  const lowToHigh = [...planned].sort(
    (left, right) => right.entry.position - left.entry.position,
  );
  const highToLow = [...planned].sort(
    (left, right) => left.entry.position - right.entry.position,
  );
  const legalityRules = lowToHigh.filter(
    ({ module }) => module.hooks.modifyLegality !== undefined,
  );
  const strengthRules = lowToHigh.filter(
    ({ module }) => module.hooks.modifyStrength !== undefined,
  );
  const effectRules = new Map<EffectHook, readonly PlannedRule[]>(
    (
      [
        'afterPlay',
        'afterPass',
        'afterFieldClear',
        'onGameStart',
        'onGameEnd',
      ] as const
    ).map((hook) => [
      hook,
      highToLow.filter(({ module }) => module.hooks[hook] !== undefined),
    ]),
  );
  return { legalityRules, strengthRules, effectRules };
}

export function createTrustedSimulationRuleChainPort(
  plan: TrustedSimulationRulePlan,
  options: { onIssue?: (issue: RuleExecutionIssue) => void } = {},
): RuleChainPort {
  const { legalityRules, strengthRules, effectRules } = plan;
  const disabled = new Set<RuleId>();

  const fail = (
    ruleId: RuleId,
    hook: keyof RuleModule['hooks'],
    error: unknown,
  ): never => {
    options.onIssue?.({ ruleId, hook, reason: 'exception' });
    throw error;
  };

  return {
    trustedSimulation: true,
    disabledRuleIds: () => [...disabled],

    disableRule(ruleId) {
      disabled.add(ruleId);
    },

    modifyLegality(_entries, context, plays, base) {
      const results = [...base];
      const influenced = new Set<RuleId>();
      for (const { entry, module } of legalityRules) {
        if (disabled.has(entry.ruleId)) continue;
        const hook = module.hooks.modifyLegality!;
        const ruleContext = contextForRule(context, entry.ruleId);
        for (const [index, play] of plays.entries()) {
          const before = results[index];
          if (!before) continue;
          try {
            const after = hook(ruleContext, play, before);
            results[index] = after;
            if (!sameLegality(before, after)) influenced.add(entry.ruleId);
          } catch (error) {
            fail(entry.ruleId, 'modifyLegality', error);
          }
        }
      }
      return { results, influenced: [...influenced] };
    },

    modifyStrength(_entries, context, base) {
      let result = base;
      const influenced = new Set<RuleId>();
      for (const { entry, module } of strengthRules) {
        if (disabled.has(entry.ruleId)) continue;
        try {
          let next = module.hooks.modifyStrength!(
            contextForRule(context, entry.ruleId),
            result,
          ) as StrengthOrder;
          if (
            next.revolution === undefined &&
            result.revolution !== undefined
          ) {
            next = { ...next, revolution: result.revolution };
          }
          if (
            next.comparisonOverrides === undefined &&
            result.comparisonOverrides !== undefined
          ) {
            next = {
              ...next,
              comparisonOverrides: result.comparisonOverrides,
            };
          }
          if (!sameStrength(result, next)) influenced.add(entry.ruleId);
          result = next;
        } catch (error) {
          fail(entry.ruleId, 'modifyStrength', error);
        }
      }
      return { result, influenced: [...influenced] };
    },

    collectEffects(hookName, _entries, context, argument, input) {
      return (effectRules.get(hookName) ?? []).flatMap(({ entry, module }) => {
        if (disabled.has(entry.ruleId)) return [];
        const hooks = module.hooks;
        const ruleContext = contextForRule(context, entry.ruleId);
        try {
          let effects: Effect[];
          if (hookName === 'afterPlay') {
            effects =
              hooks.afterPlay?.(
                ruleContext,
                argument as Play,
                input?.ruleId === entry.ruleId ? input.value : undefined,
              ) ?? [];
          } else if (hookName === 'afterPass') {
            effects =
              hooks.afterPass?.(ruleContext, argument as RulePass) ?? [];
          } else if (hookName === 'onGameStart') {
            effects =
              hooks.onGameStart?.(
                ruleContext,
                input?.ruleId === entry.ruleId ? input.value : undefined,
              ) ?? [];
          } else if (hookName === 'onGameEnd') {
            effects =
              hooks.onGameEnd?.(ruleContext, argument as Standings) ?? [];
          } else {
            effects = hooks.afterFieldClear?.(ruleContext) ?? [];
          }
          return [{ ruleId: entry.ruleId, effects }];
        } catch (error) {
          return fail(entry.ruleId, hookName, error);
        }
      });
    },
  };
}
