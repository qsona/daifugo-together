import type { RuleId } from '../game/types.js';
import type { Play } from '../play/play.js';
import type { StrengthOrder } from '../play/strength.js';
import type { RuleChainPort } from './chain.js';
import type {
  Legality,
  RuleChainEntry,
  RuleContext,
  RuleModule,
} from './contract.js';

function changed(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) !== JSON.stringify(right);
}

function lowToHigh(entries: RuleChainEntry[]): RuleChainEntry[] {
  return [...entries].sort((left, right) => right.position - left.position);
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
        plays.forEach((play, index) => {
          const before = results[index];
          if (!before) {
            return;
          }
          const after = hook(context, play, before);
          results[index] = after;
          if (changed(before, after)) {
            influenced.add(entry.ruleId);
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
        const next = hook(context, result);
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
          if (hookName === 'afterPlay') {
            return [
              {
                ruleId: entry.ruleId,
                effects: hooks.afterPlay?.(context, argument as Play) ?? [],
              },
            ];
          }
          if (hookName === 'onGameEnd') {
            return [
              {
                ruleId: entry.ruleId,
                effects:
                  hooks.onGameEnd?.(
                    context,
                    argument as Parameters<
                      NonNullable<typeof hooks.onGameEnd>
                    >[1],
                  ) ?? [],
              },
            ];
          }
          return [
            {
              ruleId: entry.ruleId,
              effects: hooks[hookName]?.(context) ?? [],
            },
          ];
        });
    },
  };
}
