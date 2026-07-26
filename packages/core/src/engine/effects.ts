import { sortCards, type Card, type CardId } from '../cards/card.js';
import type {
  EngineEvent,
  GameConfig,
  GameState,
  JsonValue,
  PublicGameEvent,
  RuleMemory,
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
  Standings,
  Zone,
} from '../rules/contract.js';
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
      return available
        .filter((card) => card.rank === selector.rank)
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
      const combined = [...current.play.cards, ...cards];
      if (combined.some((card) => card.rank !== combined[0]?.rank)) {
        return state;
      }
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
                cards: sortCards(combined),
                count: combined.length,
                repRank: combined[0]!.rank,
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
                        repRank: remaining[0]!.rank,
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
    selected.some(
      (card) => card.rank !== state.public.field.current?.play.repRank,
    )
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

export function executeEffectHook(
  config: GameConfig,
  state: GameState,
  runtime: RuleRuntime,
  hook: EffectHook,
  argument?: Play | Standings,
  strength: StrengthOrder = BASE_STRENGTH_ORDER,
): EffectHookResult {
  if (config.ruleChain.length === 0) {
    return {
      state,
      setMemory: runtime.setMemory,
      events: [],
      clearRequested: false,
    };
  }
  const invocation = prepareRuleInvocation(state, config.ruleChain, hook, true);
  const context = buildRuleContext(
    config,
    invocation.state,
    strength,
    runtime,
    {
      hook,
      invocationIndices: invocation.invocationIndices,
    },
  );
  const positionByRule = new Map(
    config.ruleChain.map((entry) => [entry.ruleId, entry.position]),
  );
  const invalid: EffectEmission[] = [];
  const emissions = runtime.port
    .collectEffects(hook, config.ruleChain, context, argument)
    .flatMap(({ ruleId, effects }) => {
      const position = positionByRule.get(ruleId);
      if (position === undefined) {
        return [];
      }
      return effects.map((effect, effectIndex) => ({
        ruleId,
        position,
        effectIndex,
        effect,
        ...(effect.type === 'moveCards'
          ? {
              resolvedCards: resolveCardSelector(
                invocation.state,
                effect.from,
                effect.cards,
                contextForRule(context, ruleId).rng,
              ),
            }
          : {}),
      }));
    })
    .filter((emission) => {
      const allowed =
        emission.effectIndex < 8 && effectAllowed(hook, emission.effect);
      if (!allowed) {
        invalid.push(emission);
      }
      return allowed;
    });
  const batch = resolveEffectBatch(hook, emissions);
  let nextState = invocation.state;
  let setMemory = runtime.setMemory;
  let clearRequested = false;
  const events: EngineEvent[] = invalid.map((entry) => ({
    type: 'effectRejected',
    hook,
    ruleId: entry.ruleId,
    effect: entry.effect,
    resolution: 'rejected',
    conflictKey: null,
    detail: {
      reason: entry.effectIndex >= 8 ? 'effect-limit' : 'hook-not-allowed',
    },
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
        const result = forceStanding(
          nextState,
          entry.effect.player,
          entry.effect.rank,
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
        if (announceLeaksPrivateCard(invocation.state, entry.effect)) {
          entry.resolution = {
            status: 'rejected',
            winnerRuleId: entry.ruleId,
          };
          details.set(index, {
            applied: false,
            reason: 'private-card-reference',
          });
        }
        break;
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
    const realized = nonAnnounce.some((entry) =>
      ['adopted', 'deduped'].includes(entry.resolution.status),
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
  for (const entry of batch.entries) {
    if (
      entry.effect.type === 'announce' &&
      entry.resolution.status === 'adopted'
    ) {
      events.push({
        type: 'ruleFired',
        ruleId: entry.ruleId,
        messageKey: entry.effect.messageKey,
        ...(entry.effect.params === undefined
          ? {}
          : { params: entry.effect.params }),
      });
    }
  }

  const firedRules = new Set(nextState.public.firedRules);
  for (const entry of batch.entries) {
    if (
      entry.effect.type !== 'announce' &&
      ['adopted', 'deduped'].includes(entry.resolution.status)
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
  return {
    state: nextState,
    setMemory,
    events,
    clearRequested,
  };
}
