import type { GameResult, RuleId, RuleMemory } from '../game/types.js';
import type { Play } from '../play/play.js';
import type { StrengthOrder } from '../play/strength.js';
import type {
  Effect,
  Legality,
  RuleChainEntry,
  RuleContext,
  Standings,
} from './contract.js';

export type EffectHook =
  'afterPlay' | 'afterFieldClear' | 'onGameStart' | 'onGameEnd';

export interface RuleChainPort {
  modifyLegality(
    entries: RuleChainEntry[],
    context: RuleContext,
    plays: Play[],
    base: Legality[],
  ): { results: Legality[]; influenced: RuleId[] };
  modifyStrength(
    entries: RuleChainEntry[],
    context: RuleContext,
    base: StrengthOrder,
  ): { result: StrengthOrder; influenced: RuleId[] };
  collectEffects(
    hook: EffectHook,
    entries: RuleChainEntry[],
    context: RuleContext,
    argument?: Play | Standings,
  ): { ruleId: RuleId; effects: Effect[] }[];
}

export interface RuleRuntime {
  port: RuleChainPort;
  setHistory: GameResult[];
  setMemory: RuleMemory;
}

export const NO_RULE_CHAIN_PORT: RuleChainPort = {
  modifyLegality: (_entries, _context, _plays, base) => ({
    results: base,
    influenced: [],
  }),
  modifyStrength: (_entries, _context, base) => ({
    result: base,
    influenced: [],
  }),
  collectEffects: () => [],
};

export function noRuleRuntime(): RuleRuntime {
  return {
    port: NO_RULE_CHAIN_PORT,
    setHistory: [],
    setMemory: {},
  };
}
