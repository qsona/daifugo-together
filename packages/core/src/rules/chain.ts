import type { GameResult, RuleId, RuleMemory } from '../game/types.js';
import type { Play } from '../play/play.js';
import type { StrengthOrder } from '../play/strength.js';
import type {
  Effect,
  Legality,
  RuleChainEntry,
  RuleContext,
  RuleInput,
  Standings,
} from './contract.js';

export type EffectHook =
  'afterPlay' | 'afterFieldClear' | 'onGameStart' | 'onGameEnd';

export interface RuleChainPort {
  /**
   * AI worker の使い捨て可能なシミュレーション内だけで有効にする。
   * 権威ゲーム向け safe-port の clone / freeze / 戻り値検証を省略する。
   */
  readonly trustedSimulation?: true;
  /**
   * Excludes a rule from the current runtime immediately.
   *
   * The engine calls this after detecting an invalid or unapplicable Effect so
   * a later hook in the same transition cannot execute the failed rule.
   */
  disableRule?(ruleId: RuleId): void;
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
    input?: { ruleId: RuleId; value: RuleInput },
  ): { ruleId: RuleId; effects: Effect[] }[];
}

export interface RuleRuntime {
  port: RuleChainPort;
  setHistory: GameResult[];
  setMemory: RuleMemory;
}

export const NO_RULE_CHAIN_PORT: RuleChainPort = {
  disableRule: () => undefined,
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
