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

export const ENGINE_FEATURES = [
  'sequence',
  'jokers',
] as const satisfies readonly EngineFeature[];

// EngineFeature に値を追加したのに ENGINE_FEATURES を更新し忘れると、直前の satisfies 行
// ではなくこの行がコンパイルエラーになる。
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _EngineFeaturesExhaustive = AssertExhaustive<
  Exclude<EngineFeature, (typeof ENGINE_FEATURES)[number]>
>;

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

/**
 * 型レベルの網羅性ガード。渡した型引数が `never` でない場合はコンパイルエラーになる。
 * 実行時配列が対応する union を過不足なくカバーしていることを保証するために使う。
 * 例: `type _Check = AssertExhaustive<Exclude<SomeUnion, (typeof SOME_ARRAY)[number]>>;`
 */
type AssertExhaustive<T extends never> = T;

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

/** RuleHooks の全フック名。順序は宣言順(呼び出し順とは無関係)。 */
export const RULE_HOOK_NAMES = [
  'modifyLegality',
  'modifyStrength',
  'afterPlay',
  'afterFieldClear',
  'onGameStart',
  'onGameEnd',
] as const satisfies readonly (keyof RuleHooks)[];

// RuleHooks にフックを追加/削除したのにここを更新し忘れると、この行がコンパイルエラーになる。
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 型チェックのためだけに存在する
type _RuleHookNamesExhaustive = AssertExhaustive<
  Exclude<keyof RuleHooks, (typeof RULE_HOOK_NAMES)[number]>
>;

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
  /** セット開始時に固定されたルールチェーンのID。優先順位順。 */
  readonly ruleIds: readonly RuleId[];
  /** clearSuitBinding が解除した公開プレイ。未解除なら null。 */
  readonly suitBindingResetAfter?: readonly CardId[] | null;
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
    }
  | {
      kind: 'miniGameMultiResult';
      choiceId: string;
      miniGameId: string;
      winnerPlayerIds: PlayerId[];
      scores: Record<PlayerId, { score: number }>;
    };

/** RuleInput の全 kind 文字列。 */
export const RULE_INPUT_KINDS = [
  'cards',
  'player',
  'miniGameResult',
  'miniGameMultiResult',
] as const satisfies readonly RuleInput['kind'][];

// RuleInput に kind を追加/削除したのにここを更新し忘れると、この行がコンパイルエラーになる。
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 型チェックのためだけに存在する
type _RuleInputKindsExhaustive = AssertExhaustive<
  Exclude<RuleInput['kind'], (typeof RULE_INPUT_KINDS)[number]>
>;

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

interface MiniGameChoiceRequestBase {
  kind: 'miniGame';
  player: PlayerId;
  choiceId: string;
  participants: PlayerId[];
  seed: string;
  messageKey: string;
}

export interface BombThrowMiniGameChoiceRequest extends MiniGameChoiceRequestBase {
  miniGame: 'bomb_throw_15';
  durationMs: number;
}

export interface BinaryQuizRaceChoiceRequest extends MiniGameChoiceRequestBase {
  miniGame: 'binary_quiz_race';
  questionSet: 'general_v1';
  defaultOption: 'a' | 'b';
  roundDurationMs: number;
  targetScore: number;
  maxRounds: number;
}

export type MiniGameChoiceRequest =
  BombThrowMiniGameChoiceRequest | BinaryQuizRaceChoiceRequest;

/** 実装済みミニゲーム id。 */
export const MINI_GAME_IDS = [
  'bomb_throw_15',
  'binary_quiz_race',
] as const satisfies readonly MiniGameChoiceRequest['miniGame'][];

// MiniGameChoiceRequest.miniGame に id を追加/削除したのにここを更新し忘れると、この行がコンパイルエラーになる。
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 型チェックのためだけに存在する
type _MiniGameIdsExhaustive = AssertExhaustive<
  Exclude<MiniGameChoiceRequest['miniGame'], (typeof MINI_GAME_IDS)[number]>
>;

export type ChoiceRequestPayload =
  CardChoiceRequest | PlayerChoiceRequest | MiniGameChoiceRequest;

/**
 * Declarative state changes accepted from contract v1 rules.
 *
 * Hook permissions:
 *
 * | Effect | afterPlay | afterFieldClear | onGameStart | onGameEnd |
 * | --- | --- | --- | --- | --- |
 * | clearField / clearSuitBinding | yes | no | no | no |
 * | requestChoice (contract v2) | yes | no | yes | no |
 * | skipTurns / reverseTurnOrder / forceRank / moveCards | yes | yes | yes | no |
 * | setMemory | yes | yes | yes | set scope only |
 * | announce | yes | yes | yes | yes |
 *
 * Conflict keys are exhaustively implemented by `priority/conflictKeyOf`:
 * field, suitBinding, choice:{ruleId}, turn:{player}, turnOrder,
 * rank:{player}, resolved card-set union, and memory:{ruleId}:{key}.
 * Independent choice requests are
 * serialized by rule priority. `announce` has no key and follows suppression.
 * Adding an Effect variant requires updating both this table and the exhaustive
 * switch; otherwise TypeScript compilation must fail.
 */
export type Effect =
  | { type: 'clearField' }
  | { type: 'clearSuitBinding' }
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

/** Effect の全 type 文字列。順序は宣言順。 */
export const EFFECT_TYPES = [
  'clearField',
  'clearSuitBinding',
  'requestChoice',
  'skipTurns',
  'reverseTurnOrder',
  'forceRank',
  'moveCards',
  'setMemory',
  'announce',
] as const satisfies readonly Effect['type'][];

// Effect に variant を追加/削除したのにここを更新し忘れると、この行がコンパイルエラーになる
// (上記 doc コメントが定める「網羅 switch でコンパイルを壊す」方針の実行時版)。
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 型チェックのためだけに存在する
type _EffectTypesExhaustive = AssertExhaustive<
  Exclude<Effect['type'], (typeof EFFECT_TYPES)[number]>
>;
