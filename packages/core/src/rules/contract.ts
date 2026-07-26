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
  popularityScore: number;
  activatedAt: string;
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

export interface RuleHooks {
  modifyLegality(context: RuleContext, play: Play, base: Legality): Legality;
  modifyStrength(context: RuleContext, base: StrengthOrder): StrengthOrder;
  afterPlay(context: RuleContext, play: Play): Effect[];
  afterFieldClear(context: RuleContext): Effect[];
  onGameStart(context: RuleContext): Effect[];
  onGameEnd(context: RuleContext, standings: Standings): Effect[];
}

export interface RuleContext {
  contractVersion: 1;
  game: GameView;
  setHistory: GameResult[];
  memory: {
    game: Readonly<Record<string, JsonValue>>;
    set: Readonly<Record<string, JsonValue>>;
  };
  rng: {
    next(): number;
    int(maxExclusive: number): number;
  };
}

export interface GameView {
  gameIndex: number;
  seats: PlayerId[];
  direction: 1 | -1;
  turn: PlayerId | null;
  players: {
    id: PlayerId;
    hand: readonly Card[];
    status: PlayerStatus;
    standing: Standing | null;
  }[];
  field: FieldState;
  discard: readonly Card[];
  history: readonly PublicGameEvent[];
  strength: StrengthOrder;
}

export type Zone =
  { kind: 'hand'; player: PlayerId } | { kind: 'field' } | { kind: 'discard' };

export type CardSelector =
  | { kind: 'specific'; cardIds: CardId[] }
  | { kind: 'byRank'; rank: CardRank }
  | { kind: 'random'; count: number }
  | { kind: 'all' };

export type MemoryScope = 'game' | 'set';

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
