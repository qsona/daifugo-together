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

export type RuleContractVersion = 1 | 2;

export const ENGINE_CONTRACT_VERSION: RuleContractVersion = 2;
export const SUPPORTED_CONTRACT_VERSIONS: readonly RuleContractVersion[] = [
  1, 2,
];

/** エンジンのネイティブ機能のうち、ルールが宣言で有効化できるもの。 */
export type EngineFeature = 'sequence' | 'jokers';

export const ENGINE_FEATURES: readonly EngineFeature[] = ['sequence', 'jokers'];

/**
 * ルールチェーン全体で有効なエンジン機能の和集合を返す。
 * 返り値の順序は ENGINE_FEATURES の宣言順で決定的。
 */
export function engineFeaturesOf(
  ruleChain: readonly Pick<RuleChainEntry, 'engineFeatures'>[],
): EngineFeature[] {
  return ENGINE_FEATURES.filter((feature) =>
    ruleChain.some((entry) => entry.engineFeatures?.includes(feature)),
  );
}

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
  /** meta.engineFeatures から転記される。省略時は []。 */
  engineFeatures?: readonly EngineFeature[];
}

export interface RuleMeta {
  ruleId: RuleId;
  name: string;
  description: string;
  kind: 'local' | 'original';
  prefecture?: string;
  proposalId: string;
  contractVersion: RuleContractVersion;
  messages: Record<string, string>;
  /** このルールが要求するエンジン機能。省略時は []。 */
  engineFeatures?: readonly EngineFeature[];
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
 * Effect hooks receive the effective `context.game.strength` after the
 * `modifyStrength` chain. `afterPlay` receives the exact order used to
 * validate the just-applied play, so it represents the pre-play rule state.
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
  afterPlay(
    context: RuleContext,
    play: DeepReadonly<Play>,
    input?: DeepReadonly<RuleInput>,
  ): Effect[];
  afterFieldClear(context: RuleContext): Effect[];
  onGameStart(context: RuleContext, input?: DeepReadonly<RuleInput>): Effect[];
  onGameEnd(context: RuleContext, standings: DeepReadonly<Standings>): Effect[];
}

export interface RuleContext {
  readonly contractVersion: RuleContractVersion;
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

export type RuleInput =
  | { kind: 'cards'; choiceId: string; cardIds: CardId[] }
  | { kind: 'player'; choiceId: string; playerId: PlayerId }
  | {
      kind: 'miniGameResult';
      choiceId: string;
      miniGameId: string;
      winnerPlayerId: PlayerId;
      scores: Record<PlayerId, { score: number; hitsTaken: number }>;
    };

export interface CardChoiceRequest {
  player: PlayerId;
  choiceId: string;
  from: Extract<Zone, { kind: 'hand' }>;
  cards: CardSelector;
  count: number;
  messageKey: string;
}

export interface PlayerChoiceRequest {
  player: PlayerId;
  choiceId: string;
  players: PlayerId[];
  messageKey: string;
}

export interface MiniGameChoiceRequest {
  kind: 'miniGame';
  player: PlayerId;
  choiceId: string;
  miniGame: 'bomb_throw_15';
  participants: PlayerId[];
  durationMs: number;
  seed: string;
  messageKey: string;
}

export type ChoiceRequestPayload =
  CardChoiceRequest | PlayerChoiceRequest | MiniGameChoiceRequest;

/**
 * Declarative state changes accepted from contract v1 rules.
 *
 * Hook permissions:
 *
 * | Effect | afterPlay | afterFieldClear | onGameStart | onGameEnd |
 * | --- | --- | --- | --- | --- |
 * | clearField | yes | no | no | no |
 * | requestChoice (contract v2) | yes | no | yes | no |
 * | skipTurns / reverseTurnOrder / forceRank / moveCards | yes | yes | yes | no |
 * | setMemory | yes | yes | yes | set scope only |
 * | announce | yes | yes | yes | yes |
 *
 * Conflict keys are exhaustively implemented by `priority/conflictKeyOf`:
 * field, choice:{ruleId}, turn:{player}, turnOrder, rank:{player}, resolved
 * card-set union, and memory:{ruleId}:{key}. Independent choice requests are
 * serialized by rule priority. `announce` has no key and follows suppression.
 * Adding an Effect variant requires updating both this table and the exhaustive
 * switch; otherwise TypeScript compilation must fail.
 */
export type Effect =
  | { type: 'clearField' }
  | ({
      type: 'requestChoice';
      additionalChoices?: ChoiceRequestPayload[];
      /**
       * Collect every additional choice without applying any response until
       * all players have committed. Submitted values stay private meanwhile.
       */
      simultaneous?: boolean;
    } & ChoiceRequestPayload)
  | { type: 'skipTurns'; player: PlayerId; count: number }
  | { type: 'reverseTurnOrder' }
  | {
      type: 'forceRank';
      player: PlayerId;
      rank: Standing | 'lowest';
      /**
       * Apply only while another player's standing still matches. Evaluated
       * after all unconditional effects in the same batch.
       */
      when?: { player: PlayerId; standing: Standing };
    }
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
      /**
       * Internal bookkeeping that must not be presented as a rule activation.
       * Omitted/false keeps the existing automatic ruleFired behavior.
       */
      silent?: boolean;
    }
  | {
      type: 'announce';
      messageKey: string;
      params?: Record<string, string>;
      /**
       * Omitted for the existing public ruleFired announcement. When present,
       * only these players receive the notice and nothing is written to public
       * history or the public fired-rule tally.
       */
      players?: PlayerId[];
    };
