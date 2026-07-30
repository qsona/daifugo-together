import {
  CARD_RANKS,
  sortCards,
  type Card,
  type CardId,
} from '../cards/card.js';
import type {
  EngineEvent,
  GameConfig,
  GameState,
  JsonValue,
  PublicGameEvent,
  RuleMemory,
  Standing,
} from '../game/types.js';
import {
  resolveEffectBatch,
  type EffectEmission,
  type ResolvedEffect,
} from '../priority/effects.js';
import type { StrengthOrder } from '../play/strength.js';
import { BASE_STRENGTH_ORDER } from '../play/strength.js';
import type { RuleRuntime, EffectHook } from '../rules/chain.js';
import {
  buildRuleContext,
  contextForRule,
  prepareRuleInvocation,
} from '../rules/context.js';
import type {
  CardSelector,
  Effect,
  RuleInput,
  Standings,
  Zone,
} from '../rules/contract.js';
import { safeCollectEffects, safeModifyStrength } from '../rules/safe-port.js';
import type { Play } from '../play/play.js';
import { finishPlayer, forceStanding } from './standing.js';

const MEMORY_MAX_KEYS = 32;
const MEMORY_MAX_VALUE_BYTES = 1024;
const MEMORY_MAX_NAMESPACE_BYTES = 16 * 1024;

export interface EffectHookResult {
  state: GameState;
  setMemory: RuleMemory;
  events: EngineEvent[];
  clearRequested: boolean;
  choiceRequest?: {
    ruleId: string;
    player: string;
    choiceId: string;
    messageKey: string;
    optionCardIds: CardId[];
    count: number;
  };
}

function cardsInZone(state: GameState, zone: Zone): readonly Card[] {
  switch (zone.kind) {
    case 'hand':
      return state.players[zone.player]?.hand ?? [];
    case 'field':
      return state.public.field.current?.play.cards ?? [];
    case 'discard':
      return state.public.discard;
  }
}

export function resolveCardSelector(
  state: GameState,
  from: Zone,
  selector: CardSelector,
  rng: { int(maxExclusive: number): number },
): CardId[] {
  const available = cardsInZone(state, from);
  switch (selector.kind) {
    case 'specific': {
      const availableIds = new Set(available.map((card) => card.id));
      return selector.cardIds.filter((cardId) => availableIds.has(cardId));
    }
    case 'byRank':
      // ジョーカーは byRank で選択できない (既存の selector 語彙のまま)。
      return available
        .filter(
          (card) => card.kind === 'natural' && card.rank === selector.rank,
        )
        .map((card) => card.id);
    case 'all':
      return available.map((card) => card.id);
    case 'random': {
      const pool = [...available];
      const selected: CardId[] = [];
      const count = Math.max(0, Math.min(selector.count, pool.length));
      while (selected.length < count) {
        const index = rng.int(pool.length);
        const [card] = pool.splice(index, 1);
        if (card) {
          selected.push(card.id);
        }
      }
      return selected;
    }
  }
}

function effectAllowed(hook: EffectHook, effect: Effect): boolean {
  if (effect.type === 'announce') {
    return true;
  }
  if (hook === 'onGameEnd') {
    return effect.type === 'setMemory' && effect.scope === 'set';
  }
  if (effect.type === 'clearField') {
    return hook === 'afterPlay';
  }
  if (effect.type === 'requestChoice') {
    return hook === 'afterPlay';
  }
  return true;
}

function removeCardIds(cards: readonly Card[], cardIds: ReadonlySet<CardId>) {
  return cards.filter((card) => !cardIds.has(card.id));
}

function appendToZone(
  state: GameState,
  zone: Zone,
  cards: readonly Card[],
): GameState {
  switch (zone.kind) {
    case 'hand': {
      const player = state.players[zone.player];
      if (!player) {
        return state;
      }
      return {
        ...state,
        players: {
          ...state.players,
          [zone.player]: {
            ...player,
            hand: sortCards([...player.hand, ...cards]),
          },
        },
      };
    }
    case 'discard':
      return {
        ...state,
        public: {
          ...state.public,
          discard: [...state.public.discard, ...cards],
        },
      };
    case 'field': {
      const current = state.public.field.current;
      if (!current || cards.length === 0) {
        return state;
      }
      if (
        current.play.kind === 'sequence' ||
        cards.some(
          (card) =>
            card.kind !== 'natural' || card.rank !== current.play.repRank,
        )
      ) {
        return state;
      }
      const combined = sortCards([...current.play.cards, ...cards]);
      return {
        ...state,
        public: {
          ...state.public,
          field: {
            ...state.public.field,
            current: {
              ...current,
              play: {
                ...current.play,
                kind: combined.length === 1 ? 'single' : 'set',
                cards: combined,
                count: combined.length,
                repRank: current.play.repRank,
              },
            },
          },
        },
      };
    }
  }
}

function takeFromZone(
  state: GameState,
  zone: Zone,
  cardIds: readonly CardId[],
): { state: GameState; cards: Card[] } {
  const selectedIds = new Set(cardIds);
  const cards = cardsInZone(state, zone).filter((card) =>
    selectedIds.has(card.id),
  );
  switch (zone.kind) {
    case 'hand': {
      const player = state.players[zone.player];
      if (!player) {
        return { state, cards: [] };
      }
      return {
        state: {
          ...state,
          players: {
            ...state.players,
            [zone.player]: {
              ...player,
              hand: removeCardIds(player.hand, selectedIds),
            },
          },
        },
        cards,
      };
    }
    case 'discard':
      return {
        state: {
          ...state,
          public: {
            ...state.public,
            discard: removeCardIds(state.public.discard, selectedIds),
          },
        },
        cards,
      };
    case 'field': {
      const current = state.public.field.current;
      if (!current) {
        return { state, cards: [] };
      }
      const remaining = removeCardIds(current.play.cards, selectedIds);
      // sequence の場からの部分取り出しは形が壊れるため no-op にする
      // (appendToZone / applyMoveCards の sequence ガードと対称)。
      if (current.play.kind === 'sequence' && remaining.length > 0) {
        return { state, cards: [] };
      }
      const remainingNatural = remaining.find(
        (card) => card.kind === 'natural',
      );
      return {
        state: {
          ...state,
          public: {
            ...state.public,
            field:
              remaining.length === 0
                ? {
                    passedSinceLastPlay: [
                      ...state.public.field.passedSinceLastPlay,
                    ],
                  }
                : {
                    ...state.public.field,
                    current: {
                      ...current,
                      play: {
                        ...current.play,
                        kind: remaining.length === 1 ? 'single' : 'set',
                        cards: remaining,
                        count: remaining.length,
                        repRank: remainingNatural?.rank ?? 'joker',
                      },
                    },
                  },
          },
        },
        cards,
      };
    }
  }
}

function applyMoveCards(
  state: GameState,
  ruleId: string,
  effect: Extract<Effect, { type: 'moveCards' }>,
  resolvedCards: readonly CardId[],
): {
  state: GameState;
  events: PublicGameEvent[];
  detail: JsonValue;
} {
  if (
    (effect.from.kind === 'hand' &&
      state.players[effect.from.player] === undefined) ||
    (effect.to.kind === 'hand' && state.players[effect.to.player] === undefined)
  ) {
    return {
      state,
      events: [],
      detail: { applied: false, reason: 'unknown-player' },
    };
  }
  if (
    effect.from.kind === effect.to.kind &&
    (effect.from.kind !== 'hand' ||
      (effect.to.kind === 'hand' && effect.from.player === effect.to.player))
  ) {
    return {
      state,
      events: [],
      detail: { applied: false, reason: 'same-zone' },
    };
  }
  const resolvedIds = new Set(resolvedCards);
  const selected = cardsInZone(state, effect.from).filter((card) =>
    resolvedIds.has(card.id),
  );
  if (selected.length === 0) {
    return {
      state,
      events: [],
      detail: { applied: false, reason: 'no-matching-cards' },
    };
  }
  if (effect.to.kind === 'field' && !state.public.field.current) {
    return {
      state,
      events: [],
      detail: { applied: false, reason: 'empty-field-destination' },
    };
  }
  if (
    effect.to.kind === 'field' &&
    state.public.field.current &&
    (state.public.field.current.play.kind === 'sequence' ||
      selected.some(
        (card) =>
          card.kind !== 'natural' ||
          card.rank !== state.public.field.current?.play.repRank,
      ))
  ) {
    return {
      state,
      events: [],
      detail: { applied: false, reason: 'incompatible-field-cards' },
    };
  }
  if (
    effect.from.kind === 'field' &&
    state.public.field.current?.play.kind === 'sequence' &&
    selected.length < state.public.field.current.play.cards.length
  ) {
    return {
      state,
      events: [],
      detail: { applied: false, reason: 'incompatible-field-cards' },
    };
  }
  const taken = takeFromZone(state, effect.from, resolvedCards);
  const moved = appendToZone(taken.state, effect.to, taken.cards);
  const exposesCards = effect.from.kind !== 'hand' || effect.to.kind !== 'hand';
  return {
    state: moved,
    events:
      taken.cards.length === 0
        ? []
        : [
            {
              type: 'cardsMoved',
              by: ruleId,
              from: effect.from,
              to: effect.to,
              count: taken.cards.length,
              ...(exposesCards
                ? { cardIds: taken.cards.map((card) => card.id) }
                : {}),
            },
          ],
    detail: { applied: taken.cards.length > 0, count: taken.cards.length },
  };
}

function encodedBytes(value: JsonValue): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function applyMemory(
  memory: RuleMemory,
  ruleId: string,
  key: string,
  value: JsonValue,
): { memory: RuleMemory; applied: boolean; reason?: string } {
  const current = memory[ruleId] ?? {};
  const nextNamespace = { ...current, [key]: value };
  if (
    !(key in current) &&
    Object.keys(nextNamespace).length > MEMORY_MAX_KEYS
  ) {
    return { memory, applied: false, reason: 'key-quota' };
  }
  if (encodedBytes(value) > MEMORY_MAX_VALUE_BYTES) {
    return { memory, applied: false, reason: 'value-quota' };
  }
  if (encodedBytes(nextNamespace) > MEMORY_MAX_NAMESPACE_BYTES) {
    return { memory, applied: false, reason: 'namespace-quota' };
  }
  return {
    memory: {
      ...memory,
      [ruleId]: nextNamespace,
    },
    applied: true,
  };
}

function resolutionEvent(
  hook: EffectHook,
  entry: ResolvedEffect,
  detail?: JsonValue,
): EngineEvent {
  const realized = ['adopted', 'deduped'].includes(entry.resolution.status);
  const winnerRuleId =
    'winnerRuleId' in entry.resolution
      ? entry.resolution.winnerRuleId
      : undefined;
  return {
    type: realized ? 'effectApplied' : 'effectRejected',
    hook,
    ruleId: entry.ruleId,
    effect: entry.effect,
    resolution: entry.resolution.status,
    conflictKey: entry.conflictKey,
    ...(winnerRuleId === undefined ? {} : { winnerRuleId }),
    ...(detail === undefined ? {} : { detail }),
  };
}

function announceLeaksPrivateCard(
  state: GameState,
  effect: Extract<Effect, { type: 'announce' }>,
): boolean {
  const privateIds = [
    ...Object.values(state.players).flatMap((player) => player.hand),
    ...state.private.excluded,
  ].map((card) => card.id);
  const text = [
    effect.messageKey,
    ...Object.entries(effect.params ?? {}).flat(),
  ].join('\n');
  return privateIds.some((cardId) => text.includes(cardId));
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return Array.from({ length: value.length }, (_, index) =>
      isJsonValue(value[index]),
    ).every(Boolean);
  }
  if (
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  return (
    Reflect.ownKeys(value).every((key) => typeof key === 'string') &&
    Object.values(value).every(isJsonValue)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  try {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    );
  } catch {
    return false;
  }
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Reflect.ownKeys(value).every(
      (key) => typeof key === 'string' && allowed.has(key),
    )
  );
}

function zoneValid(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (value.kind === 'field' || value.kind === 'discard') {
    return hasExactKeys(value, ['kind']);
  }
  return (
    value.kind === 'hand' &&
    typeof value.player === 'string' &&
    hasExactKeys(value, ['kind', 'player'])
  );
}

function selectorValid(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  switch (value.kind) {
    case 'specific':
      return (
        hasExactKeys(value, ['kind', 'cardIds']) &&
        Array.isArray(value.cardIds) &&
        value.cardIds.every((cardId) => typeof cardId === 'string')
      );
    case 'byRank':
      return (
        hasExactKeys(value, ['kind', 'rank']) &&
        typeof value.rank === 'string' &&
        CARD_RANKS.includes(value.rank as (typeof CARD_RANKS)[number])
      );
    case 'random':
      return (
        hasExactKeys(value, ['kind', 'count']) &&
        typeof value.count === 'number' &&
        Number.isInteger(value.count) &&
        Number.isFinite(value.count) &&
        value.count >= 0
      );
    case 'all':
      return hasExactKeys(value, ['kind']);
    default:
      return false;
  }
}

function effectPayloadValid(effect: unknown): effect is Effect {
  try {
    if (
      !isRecord(effect) ||
      !isJsonValue(effect) ||
      typeof effect.type !== 'string'
    ) {
      return false;
    }
    switch (effect.type) {
      case 'clearField':
      case 'reverseTurnOrder':
        return hasExactKeys(effect, ['type']);
      case 'requestChoice':
        return (
          hasExactKeys(effect, [
            'type',
            'player',
            'choiceId',
            'from',
            'cards',
            'count',
            'messageKey',
          ]) &&
          typeof effect.player === 'string' &&
          typeof effect.choiceId === 'string' &&
          /^[a-z][a-z0-9_]{0,63}$/u.test(effect.choiceId) &&
          isRecord(effect.from) &&
          effect.from.kind === 'hand' &&
          effect.from.player === effect.player &&
          zoneValid(effect.from) &&
          selectorValid(effect.cards) &&
          isRecord(effect.cards) &&
          effect.cards.kind !== 'random' &&
          typeof effect.count === 'number' &&
          Number.isInteger(effect.count) &&
          effect.count >= 1 &&
          effect.count <= 14 &&
          typeof effect.messageKey === 'string' &&
          /^[a-z][a-z0-9_.-]{0,63}$/u.test(effect.messageKey)
        );
      case 'skipTurns':
        return (
          hasExactKeys(effect, ['type', 'player', 'count']) &&
          typeof effect.player === 'string' &&
          typeof effect.count === 'number' &&
          Number.isFinite(effect.count) &&
          Number.isInteger(effect.count)
        );
      case 'forceRank':
        return (
          hasExactKeys(effect, ['type', 'player', 'rank']) &&
          typeof effect.player === 'string' &&
          (effect.rank === 'lowest' ||
            (typeof effect.rank === 'number' &&
              Number.isInteger(effect.rank) &&
              effect.rank >= 1 &&
              effect.rank <= 4))
        );
      case 'moveCards':
        return (
          hasExactKeys(effect, ['type', 'from', 'to', 'cards']) &&
          zoneValid(effect.from) &&
          zoneValid(effect.to) &&
          selectorValid(effect.cards)
        );
      case 'setMemory':
        return (
          hasExactKeys(effect, ['type', 'scope', 'key', 'value'], ['silent']) &&
          (effect.scope === 'game' || effect.scope === 'set') &&
          typeof effect.key === 'string' &&
          effect.key.length > 0 &&
          isJsonValue(effect.value) &&
          (effect.silent === undefined || typeof effect.silent === 'boolean')
        );
      case 'announce':
        return (
          hasExactKeys(effect, ['type', 'messageKey'], ['params']) &&
          typeof effect.messageKey === 'string' &&
          (effect.params === undefined ||
            (isRecord(effect.params) &&
              Object.values(effect.params).every(
                (value) => typeof value === 'string',
              )))
        );
      default:
        return false;
    }
  } catch {
    return false;
  }
}

const INVALID_EFFECT_EVENT_PAYLOAD: Effect = {
  type: 'announce',
  messageKey: 'engine.invalid-effect-payload',
};

type InvalidEffectReason =
  | 'effect-limit'
  | 'invalid-payload'
  | 'hook-not-allowed'
  | 'contract-version'
  | 'choice-request-must-be-alone'
  | 'choice-player-not-actor'
  | 'unexpected-choice-request'
  | 'insufficient-choice-options';

interface InvalidEffectEmission {
  emission: EffectEmission;
  reason: InvalidEffectReason;
}

function effectiveStrengthForHook(
  config: GameConfig,
  state: GameState,
  runtime: RuleRuntime,
): StrengthOrder {
  const invocation = prepareRuleInvocation(
    state,
    config.ruleChain,
    'modifyStrength',
    false,
  );
  const context = buildRuleContext(
    config,
    invocation.state,
    BASE_STRENGTH_ORDER,
    runtime,
    {
      hook: 'modifyStrength',
      invocationIndices: invocation.invocationIndices,
    },
  );
  return safeModifyStrength(
    runtime.port,
    config.ruleChain,
    context,
    BASE_STRENGTH_ORDER,
  ).result;
}

export function executeEffectHook(
  config: GameConfig,
  state: GameState,
  runtime: RuleRuntime,
  hook: EffectHook,
  argument?: Play | Standings,
  strength?: StrengthOrder,
  options: {
    previewChoice?: boolean;
    input?: { ruleId: string; value: RuleInput };
  } = {},
): EffectHookResult {
  if (config.ruleChain.length === 0) {
    return {
      state,
      setMemory: runtime.setMemory,
      events: [],
      clearRequested: false,
    };
  }
  const effectiveStrength =
    strength ?? effectiveStrengthForHook(config, state, runtime);
  const invocation = prepareRuleInvocation(
    state,
    config.ruleChain,
    hook,
    options.previewChoice !== true,
  );
  const context = buildRuleContext(
    config,
    invocation.state,
    effectiveStrength,
    runtime,
    {
      hook,
      invocationIndices: invocation.invocationIndices,
    },
  );
  const positionByRule = new Map(
    config.ruleChain.map((entry) => [entry.ruleId, entry.position]),
  );
  const contractVersionByRule = new Map(
    config.ruleChain.map((entry) => [entry.ruleId, entry.contractVersion]),
  );
  const invalid: InvalidEffectEmission[] = [];
  const emissions: EffectEmission[] = [];
  const effectCountByRule = new Map<string, number>();
  const collected = safeCollectEffects(
    runtime.port,
    hook,
    config.ruleChain,
    context,
    argument,
    options.input,
  );
  if (Array.isArray(collected)) {
    for (const collectedEntry of collected) {
      if (
        !isRecord(collectedEntry) ||
        typeof collectedEntry.ruleId !== 'string'
      ) {
        continue;
      }
      const ruleId = collectedEntry.ruleId;
      const position = positionByRule.get(ruleId);
      if (position === undefined) {
        continue;
      }
      if (!Array.isArray(collectedEntry.effects)) {
        const effectIndex = effectCountByRule.get(ruleId) ?? 0;
        effectCountByRule.set(ruleId, effectIndex + 1);
        invalid.push({
          emission: {
            ruleId,
            position,
            effectIndex,
            effect: INVALID_EFFECT_EVENT_PAYLOAD,
          },
          reason: effectIndex >= 8 ? 'effect-limit' : 'invalid-payload',
        });
        continue;
      }
      const collectedEffects = collectedEntry.effects;
      collectedEffects.forEach((candidate) => {
        const effectIndex = effectCountByRule.get(ruleId) ?? 0;
        effectCountByRule.set(ruleId, effectIndex + 1);
        const valid = effectPayloadValid(candidate);
        const effect = valid ? candidate : INVALID_EFFECT_EVENT_PAYLOAD;
        const emission: EffectEmission = {
          ruleId,
          position,
          effectIndex,
          effect,
          ...(valid &&
          (effect.type === 'moveCards' || effect.type === 'requestChoice')
            ? {
                resolvedCards: resolveCardSelector(
                  invocation.state,
                  effect.from,
                  effect.cards,
                  contextForRule(context, ruleId).rng,
                ),
              }
            : {}),
        };
        const reason: InvalidEffectReason | null =
          effectIndex >= 8
            ? 'effect-limit'
            : !valid
              ? 'invalid-payload'
              : effect.type === 'requestChoice' &&
                  contractVersionByRule.get(ruleId) !== 2
                ? 'contract-version'
                : effect.type === 'requestChoice' &&
                    collectedEffects.length !== 1
                  ? 'choice-request-must-be-alone'
                  : effect.type === 'requestChoice' &&
                      effect.player !==
                        invocation.state.public.field.current?.by
                    ? 'choice-player-not-actor'
                    : effect.type === 'requestChoice' &&
                        (options.previewChoice !== true ||
                          options.input !== undefined)
                      ? 'unexpected-choice-request'
                      : effect.type === 'requestChoice' &&
                          (emission.resolvedCards?.length ?? 0) < effect.count
                        ? 'insufficient-choice-options'
                        : !effectAllowed(hook, effect)
                          ? 'hook-not-allowed'
                          : null;
        if (reason) {
          invalid.push({ emission, reason });
        } else {
          emissions.push(emission);
        }
      });
    }
  }
  const batch = resolveEffectBatch(hook, emissions);
  if (options.previewChoice === true) {
    const requested = batch.entries.find(
      (entry) =>
        entry.effect.type === 'requestChoice' &&
        entry.resolution.status === 'adopted',
    );
    return {
      state: invocation.state,
      setMemory: runtime.setMemory,
      events: [],
      clearRequested: false,
      ...(requested?.effect.type === 'requestChoice'
        ? {
            choiceRequest: {
              ruleId: requested.ruleId,
              player: requested.effect.player,
              choiceId: requested.effect.choiceId,
              messageKey: requested.effect.messageKey,
              optionCardIds: requested.resolvedCards ?? [],
              count: requested.effect.count,
            },
          }
        : {}),
    };
  }
  let nextState = invocation.state;
  let setMemory = runtime.setMemory;
  let clearRequested = false;
  const events: EngineEvent[] = invalid.map(({ emission, reason }) => ({
    type: 'effectRejected',
    hook,
    ruleId: emission.ruleId,
    effect: emission.effect,
    resolution: 'rejected',
    conflictKey: null,
    detail: { reason },
  }));
  const details = new Map<number, JsonValue>();

  for (const index of batch.applyOrder) {
    const entry = batch.entries[index];
    if (!entry) {
      continue;
    }
    switch (entry.effect.type) {
      case 'clearField':
        clearRequested = true;
        break;
      case 'requestChoice':
        break;
      case 'skipTurns': {
        const player = nextState.players[entry.effect.player];
        if (player) {
          const count = Math.max(1, Math.min(3, entry.effect.count));
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [entry.effect.player]: {
                ...player,
                skipCount: player.skipCount + count,
              },
            },
          };
          details.set(index, {
            requestedCount: entry.effect.count,
            appliedCount: count,
          });
        } else {
          entry.resolution = {
            status: 'rejected',
            winnerRuleId: entry.ruleId,
          };
          details.set(index, {
            applied: false,
            reason: 'unknown-player',
          });
        }
        break;
      }
      case 'reverseTurnOrder':
        nextState = {
          ...nextState,
          public: {
            ...nextState.public,
            direction: nextState.public.direction === 1 ? -1 : 1,
          },
        };
        break;
      case 'forceRank': {
        const resolvedRank =
          entry.effect.rank === 'lowest'
            ? (config.seats.length as Standing)
            : entry.effect.rank;
        const result = forceStanding(
          nextState,
          entry.effect.player,
          resolvedRank,
        );
        nextState = result.state;
        events.push(...result.events);
        details.set(index, result.detail);
        if (
          typeof result.detail === 'object' &&
          result.detail !== null &&
          !Array.isArray(result.detail) &&
          result.detail.applied === false
        ) {
          entry.resolution = {
            status: 'rejected',
            winnerRuleId: entry.ruleId,
          };
        }
        break;
      }
      case 'moveCards': {
        const result = applyMoveCards(
          nextState,
          entry.ruleId,
          entry.effect,
          entry.resolvedCards ?? [],
        );
        nextState = result.state;
        events.push(...result.events);
        details.set(index, result.detail);
        if (
          typeof result.detail === 'object' &&
          result.detail !== null &&
          !Array.isArray(result.detail) &&
          result.detail.applied === false
        ) {
          entry.resolution = {
            status: 'rejected',
            winnerRuleId: entry.ruleId,
          };
        }
        break;
      }
      case 'setMemory': {
        if (entry.effect.scope === 'game') {
          const result = applyMemory(
            nextState.private.memory,
            entry.ruleId,
            entry.effect.key,
            entry.effect.value,
          );
          nextState = {
            ...nextState,
            private: {
              ...nextState.private,
              memory: result.memory,
            },
          };
          details.set(index, {
            applied: result.applied,
            ...(result.reason === undefined ? {} : { reason: result.reason }),
          });
          if (!result.applied) {
            entry.resolution = {
              status: 'rejected',
              winnerRuleId: entry.ruleId,
            };
          }
        } else {
          const result = applyMemory(
            setMemory,
            entry.ruleId,
            entry.effect.key,
            entry.effect.value,
          );
          setMemory = result.memory;
          details.set(index, {
            applied: result.applied,
            ...(result.reason === undefined ? {} : { reason: result.reason }),
          });
          if (!result.applied) {
            entry.resolution = {
              status: 'rejected',
              winnerRuleId: entry.ruleId,
            };
          }
        }
        break;
      }
      case 'announce':
        break;
    }
  }

  for (const [index, entry] of batch.entries.entries()) {
    if (
      entry.effect.type === 'announce' &&
      entry.resolution.status === 'adopted' &&
      announceLeaksPrivateCard(nextState, entry.effect)
    ) {
      entry.resolution = {
        status: 'rejected',
        winnerRuleId: entry.ruleId,
      };
      details.set(index, {
        applied: false,
        reason: 'private-card-reference',
      });
    }
  }

  for (const failedWinner of batch.entries) {
    if (failedWinner.resolution.status !== 'rejected') {
      continue;
    }
    for (const entry of batch.entries) {
      if (
        entry.resolution.status === 'deduped' &&
        entry.resolution.winnerRuleId === failedWinner.ruleId &&
        entry.conflictKey === failedWinner.conflictKey
      ) {
        entry.resolution = {
          status: 'rejected',
          winnerRuleId: failedWinner.ruleId,
        };
      }
    }
  }

  for (const playerId of config.seats) {
    const player = nextState.players[playerId];
    if (player?.status === 'active' && player.hand.length === 0) {
      const finished = finishPlayer(nextState, playerId);
      nextState = finished.state;
      events.push(finished.event);
    }
  }

  for (const ruleEntries of Map.groupBy(
    batch.entries,
    (entry) => entry.ruleId,
  ).values()) {
    const nonAnnounce = ruleEntries.filter(
      (entry) => entry.effect.type !== 'announce',
    );
    const realized = nonAnnounce.some(
      (entry) =>
        ['adopted', 'deduped'].includes(entry.resolution.status) &&
        !(entry.effect.type === 'setMemory' && entry.effect.silent === true),
    );
    if (nonAnnounce.length > 0 && !realized) {
      for (const entry of ruleEntries) {
        if (
          entry.effect.type === 'announce' &&
          entry.resolution.status === 'adopted'
        ) {
          entry.resolution = { status: 'suppressed-announce' };
        }
      }
    }
  }
  for (const [ruleId, ruleEntries] of Map.groupBy(
    batch.entries,
    (entry) => entry.ruleId,
  )) {
    const announcement = ruleEntries.find(
      (entry) =>
        entry.effect.type === 'announce' &&
        entry.resolution.status === 'adopted',
    );
    const realized = ruleEntries.some(
      (entry) =>
        entry.effect.type !== 'announce' &&
        ['adopted', 'deduped'].includes(entry.resolution.status) &&
        !(entry.effect.type === 'setMemory' && entry.effect.silent === true),
    );
    if (!announcement && !realized) continue;
    events.push({
      type: 'ruleFired',
      ruleId,
      messageKey:
        announcement?.effect.type === 'announce'
          ? announcement.effect.messageKey
          : null,
      ...(announcement?.effect.type === 'announce' &&
      announcement.effect.params !== undefined
        ? { params: announcement.effect.params }
        : {}),
    });
  }

  const firedRules = new Set(nextState.public.firedRules);
  for (const entry of batch.entries) {
    if (
      entry.effect.type !== 'announce' &&
      ['adopted', 'deduped'].includes(entry.resolution.status) &&
      !(entry.effect.type === 'setMemory' && entry.effect.silent === true)
    ) {
      firedRules.add(entry.ruleId);
    }
  }
  for (const [ruleId, ruleEntries] of Map.groupBy(
    batch.entries,
    (entry) => entry.ruleId,
  )) {
    if (
      ruleEntries.every((entry) => entry.effect.type === 'announce') &&
      ruleEntries.some(
        (entry) =>
          entry.effect.type === 'announce' &&
          entry.resolution.status === 'adopted',
      )
    ) {
      firedRules.add(ruleId);
    }
  }
  nextState = {
    ...nextState,
    public: {
      ...nextState.public,
      firedRules: [...firedRules],
    },
  };
  events.push(
    ...batch.entries.map((entry, index) =>
      resolutionEvent(hook, entry, details.get(index)),
    ),
  );
  for (const event of events) {
    if (
      event.type === 'effectRejected' &&
      event.resolution === 'rejected' &&
      event.detail !== undefined
    ) {
      runtime.port.disableRule?.(event.ruleId);
    }
  }
  return {
    state: nextState,
    setMemory,
    events,
    clearRequested,
  };
}
