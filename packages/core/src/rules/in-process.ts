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
import { cloneValidStrengthOrder } from './safe-port.js';

function changed(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) !== JSON.stringify(right);
}

function lowToHigh(entries: RuleChainEntry[]): RuleChainEntry[] {
  return [...entries].sort((left, right) => right.position - left.position);
}

function detachedClone<T>(value: T): T {
  return structuredClone(value);
}

function detachedEffectList(value: unknown): Effect[] | null {
  const cloned = detachedClone(value);
  return Array.isArray(cloned) ? (cloned as Effect[]) : null;
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

export interface RuleExecutionIssue {
  ruleId: RuleId;
  hook: keyof RuleModule['hooks'];
  reason: 'exception' | 'invalid-return';
}

export function createInProcessRuleChainPort(
  modules: readonly RuleModule[],
  options: { onIssue?: (issue: RuleExecutionIssue) => void } = {},
): RuleChainPort {
  const byId = new Map(modules.map((module) => [module.meta.ruleId, module]));
  const disabled = new Set<RuleId>();
  const report = (issue: RuleExecutionIssue) => {
    disabled.add(issue.ruleId);
    options.onIssue?.(issue);
  };

  return {
    disableRule(ruleId) {
      disabled.add(ruleId);
    },

    modifyLegality(
      entries: RuleChainEntry[],
      context: RuleContext,
      plays: Play[],
      base: Legality[],
    ) {
      const results = [...base];
      const influenced = new Set<RuleId>();
      for (const entry of lowToHigh(entries)) {
        if (disabled.has(entry.ruleId)) continue;
        const hook = byId.get(entry.ruleId)?.hooks.modifyLegality;
        if (!hook) {
          continue;
        }
        const beforeRule = structuredClone(results);
        let failed = false;
        const ruleContext = contextForRule(context, entry.ruleId);
        for (const [index, play] of plays.entries()) {
          const before = results[index];
          if (!before) {
            continue;
          }
          try {
            const after = detachedClone(
              hook(ruleContext, detachedFrozen(play), detachedFrozen(before)),
            );
            if (!isLegality(after)) {
              report({
                ruleId: entry.ruleId,
                hook: 'modifyLegality',
                reason: 'invalid-return',
              });
              failed = true;
              break;
            }
            const wasChanged = changed(before, after);
            results[index] = after;
            if (wasChanged) {
              influenced.add(entry.ruleId);
            }
          } catch {
            report({
              ruleId: entry.ruleId,
              hook: 'modifyLegality',
              reason: 'exception',
            });
            failed = true;
            break;
          }
        }
        if (failed) {
          results.splice(0, results.length, ...beforeRule);
          influenced.delete(entry.ruleId);
        }
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
        if (disabled.has(entry.ruleId)) continue;
        const hook = byId.get(entry.ruleId)?.hooks.modifyStrength;
        if (!hook) {
          continue;
        }
        let next: StrengthOrder | null;
        try {
          next = cloneValidStrengthOrder(
            hook(contextForRule(context, entry.ruleId), detachedFrozen(result)),
          );
        } catch {
          report({
            ruleId: entry.ruleId,
            hook: 'modifyStrength',
            reason: 'exception',
          });
          continue;
        }
        if (!next) {
          report({
            ruleId: entry.ruleId,
            hook: 'modifyStrength',
            reason: 'invalid-return',
          });
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
          if (disabled.has(entry.ruleId)) return [];
          const hooks = byId.get(entry.ruleId)?.hooks;
          const hook = hooks?.[hookName];
          if (!hook) {
            return [];
          }
          const ruleContext = contextForRule(context, entry.ruleId);
          try {
            let effects: Effect[] | null;
            if (hookName === 'afterPlay') {
              effects = detachedEffectList(
                hooks.afterPlay?.(
                  ruleContext,
                  detachedFrozen(argument as Play),
                ) ?? [],
              );
            } else if (hookName === 'onGameEnd') {
              effects = detachedEffectList(
                hooks.onGameEnd?.(
                  ruleContext,
                  detachedFrozen(argument as Standings),
                ) ?? [],
              );
            } else {
              effects = detachedEffectList(
                hooks[hookName]?.(ruleContext) ?? [],
              );
            }
            if (!effects) {
              report({
                ruleId: entry.ruleId,
                hook: hookName,
                reason: 'invalid-return',
              });
              return [];
            }
            return [{ ruleId: entry.ruleId, effects }];
          } catch {
            report({
              ruleId: entry.ruleId,
              hook: hookName,
              reason: 'exception',
            });
            return [];
          }
        });
    },
  };
}
