import type { Card, CardId, CardRank } from '../cards/card.js';
import type {
  GameResult,
  JsonValue,
  PlayerId,
  PlayerStatus,
  PublicGameEvent,
  RuleId,
  Standing,
  Title,
} from '../game/types.js';
import type { FieldState } from '../game/types.js';
import type { Play } from '../play/play.js';
import type { StrengthOrder } from '../play/strength.js';

export const ENGINE_CONTRACT_VERSION = 1;

export interface PriorityKey {
  score: number;
  activatedAt: number;
  ruleId: RuleId;
}

export interface RuleChainEntry {
  ruleId: RuleId;
  name: string;
  position: number;
  priority: PriorityKey;
  bundleHash: string;
  contractVersion: number;
}

export interface RuleMeta {
  ruleId: RuleId;
  name: string;
  description: string;
  kind: 'local' | 'original';
  prefecture?: string;
  proposalId: string;
  contractVersion: number;
  messages: Record<string, string>;
}

export interface RuleModule {
  meta: RuleMeta;
  hooks: Partial<RuleHooks>;
}

export type Legality = { legal: true } | { legal: false; reasonKey?: string };

export interface Standings {
  standings: {
    player: PlayerId;
    standing: Standing;
    title: Title;
  }[];
}

/**
 * Contract v1 hook timing:
 *
 * - `modifyLegality`: play validation and legal-move enumeration; transform only.
 * - `modifyStrength`: immediately before strength comparison; transform only.
 * - `afterPlay`: after the play is applied and any natural finish is assigned.
 * - `afterFieldClear`: after cards leave the field, for natural and rule clears.
 * - `onGameStart`: after dealing and before the first turn.
 * - `onGameEnd`: after every standing is assigned and before `gameEnded`.
 *
 * All rules in one effect batch observe the same detached, deeply frozen view.
 * A module must return Effects instead of mutating this context.
 */
export interface RuleHooks {
  modifyLegality(
    context: RuleContext,
    play: DeepReadonly<Play>,
    base: DeepReadonly<Legality>,
  ): Legality;
  modifyStrength(
    context: RuleContext,
    base: DeepReadonly<StrengthOrder>,
  ): DeepReadonly<StrengthOrder>;
  afterPlay(context: RuleContext, play: DeepReadonly<Play>): Effect[];
  afterFieldClear(context: RuleContext): Effect[];
  onGameStart(context: RuleContext): Effect[];
  onGameEnd(context: RuleContext, standings: DeepReadonly<Standings>): Effect[];
}

export interface RuleContext {
  readonly contractVersion: 1;
  readonly game: GameView;
  readonly setHistory: readonly DeepReadonly<GameResult>[];
  readonly memory: {
    readonly game: Readonly<Record<string, DeepReadonly<JsonValue>>>;
    readonly set: Readonly<Record<string, DeepReadonly<JsonValue>>>;
  };
  readonly rng: {
    next(): number;
    int(maxExclusive: number): number;
  };
}

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export interface GameView {
  readonly gameIndex: number;
  readonly seats: readonly PlayerId[];
  readonly direction: 1 | -1;
  readonly turn: PlayerId | null;
  readonly players: readonly {
    readonly id: PlayerId;
    readonly hand: readonly DeepReadonly<Card>[];
    readonly status: PlayerStatus;
    readonly standing: Standing | null;
  }[];
  readonly field: DeepReadonly<FieldState>;
  readonly discard: readonly DeepReadonly<Card>[];
  readonly history: readonly DeepReadonly<PublicGameEvent>[];
  readonly strength: DeepReadonly<StrengthOrder>;
}

export type Zone =
  { kind: 'hand'; player: PlayerId } | { kind: 'field' } | { kind: 'discard' };

export type CardSelector =
  | { kind: 'specific'; cardIds: CardId[] }
  | { kind: 'byRank'; rank: CardRank }
  | { kind: 'random'; count: number }
  | { kind: 'all' };

export type MemoryScope = 'game' | 'set';

/**
 * Declarative state changes accepted from contract v1 rules.
 *
 * Hook permissions:
 *
 * | Effect | afterPlay | afterFieldClear | onGameStart | onGameEnd |
 * | --- | --- | --- | --- | --- |
 * | clearField | yes | no | no | no |
 * | skipTurns / reverseTurnOrder / forceRank / moveCards | yes | yes | yes | no |
 * | setMemory | yes | yes | yes | set scope only |
 * | announce | yes | yes | yes | yes |
 *
 * Conflict keys are exhaustively implemented by `priority/conflictKeyOf`:
 * field, turn:{player}, turnOrder, rank:{player}, resolved card-set union,
 * and memory:{ruleId}:{key}. `announce` has no key and follows suppression.
 * Adding an Effect variant requires updating both this table and the exhaustive
 * switch; otherwise TypeScript compilation must fail.
 */
export type Effect =
  | { type: 'clearField' }
  | { type: 'skipTurns'; player: PlayerId; count: number }
  | { type: 'reverseTurnOrder' }
  | { type: 'forceRank'; player: PlayerId; rank: Standing }
  | {
      type: 'moveCards';
      from: Zone;
      to: Zone;
      cards: CardSelector;
    }
  | {
      type: 'setMemory';
      scope: MemoryScope;
      key: string;
      value: JsonValue;
    }
  | {
      type: 'announce';
      messageKey: string;
      params?: Record<string, string>;
    };
