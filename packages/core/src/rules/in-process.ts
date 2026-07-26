import type { RuleId } from '../game/types.js';
import type { Play } from '../play/play.js';
import type { StrengthOrder } from '../play/strength.js';
import type { RuleChainPort } from './chain.js';
import type {
  Effect,
  Legality,
  RuleChainEntry,
  RuleContext,
  RuleModule,
  Standings,
} from './contract.js';
import { contextForRule, detachedFrozen } from './context.js';

function changed(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) !== JSON.stringify(right);
}

function lowToHigh(entries: RuleChainEntry[]): RuleChainEntry[] {
  return [...entries].sort((left, right) => right.position - left.position);
}

function detachedClone<T>(value: T): T {
  return structuredClone(value);
}

function detachedEffectList(value: unknown): Effect[] {
  const cloned = detachedClone(value);
  return Array.isArray(cloned) ? (cloned as Effect[]) : [];
}

function isLegality(value: unknown): value is Legality {
  if (typeof value !== 'object' || value === null || !('legal' in value)) {
    return false;
  }
  if (value.legal === true) {
    return true;
  }
  if (value.legal !== false) {
    return false;
  }
  return !('reasonKey' in value) || typeof value.reasonKey === 'string';
}

export function createInProcessRuleChainPort(
  modules: readonly RuleModule[],
): RuleChainPort {
  const byId = new Map(modules.map((module) => [module.meta.ruleId, module]));

  return {
    modifyLegality(
      entries: RuleChainEntry[],
      context: RuleContext,
      plays: Play[],
      base: Legality[],
    ) {
      const results = [...base];
      const influenced = new Set<RuleId>();
      for (const entry of lowToHigh(entries)) {
        const hook = byId.get(entry.ruleId)?.hooks.modifyLegality;
        if (!hook) {
          continue;
        }
        const ruleContext = contextForRule(context, entry.ruleId);
        plays.forEach((play, index) => {
          const before = results[index];
          if (!before) {
            return;
          }
          try {
            const after = detachedClone(
              hook(ruleContext, detachedFrozen(play), detachedFrozen(before)),
            );
            if (!isLegality(after)) {
              return;
            }
            const wasChanged = changed(before, after);
            results[index] = after;
            if (wasChanged) {
              influenced.add(entry.ruleId);
            }
          } catch {
            return;
          }
        });
      }
      return { results, influenced: [...influenced] };
    },

    modifyStrength(
      entries: RuleChainEntry[],
      context: RuleContext,
      base: StrengthOrder,
    ) {
      let result = base;
      const influenced = new Set<RuleId>();
      for (const entry of lowToHigh(entries)) {
        const hook = byId.get(entry.ruleId)?.hooks.modifyStrength;
        if (!hook) {
          continue;
        }
        let next: StrengthOrder;
        try {
          const returned = hook(
            contextForRule(context, entry.ruleId),
            detachedFrozen(result),
          );
          next = {
            ranking: [...returned.ranking],
          };
        } catch {
          continue;
        }
        if (changed(result, next)) {
          influenced.add(entry.ruleId);
        }
        result = next;
      }
      return { result, influenced: [...influenced] };
    },

    collectEffects(hookName, entries, context, argument) {
      return [...entries]
        .sort((left, right) => left.position - right.position)
        .flatMap((entry) => {
          const hooks = byId.get(entry.ruleId)?.hooks;
          const hook = hooks?.[hookName];
          if (!hook) {
            return [];
          }
          const ruleContext = contextForRule(context, entry.ruleId);
          try {
            if (hookName === 'afterPlay') {
              return [
                {
                  ruleId: entry.ruleId,
                  effects: detachedEffectList(
                    hooks.afterPlay?.(
                      ruleContext,
                      detachedFrozen(argument as Play),
                    ) ?? [],
                  ),
                },
              ];
            }
            if (hookName === 'onGameEnd') {
              return [
                {
                  ruleId: entry.ruleId,
                  effects: detachedEffectList(
                    hooks.onGameEnd?.(
                      ruleContext,
                      detachedFrozen(argument as Standings),
                    ) ?? [],
                  ),
                },
              ];
            }
            return [
              {
                ruleId: entry.ruleId,
                effects: detachedEffectList(
                  hooks[hookName]?.(ruleContext) ?? [],
                ),
              },
            ];
          } catch {
            return [];
          }
        });
    },
  };
}
