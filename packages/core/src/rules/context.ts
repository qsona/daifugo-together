import type {
  GameConfig,
  GameState,
  RuleId,
  RuleMemory,
} from '../game/types.js';
import { nextRandom, randomInt, seedRng } from '../rng/rng.js';
import type { StrengthOrder } from '../play/strength.js';
import type { RuleRuntime } from './chain.js';
import type {
  DeepReadonly,
  GameView,
  RuleChainEntry,
  RuleContext,
  RuleHooks,
} from './contract.js';

export type RuleInvocationHook = keyof RuleHooks;

interface ContextBuildOptions {
  hook: RuleInvocationHook;
  invocationIndices: Readonly<Record<RuleId, number>>;
}

interface RuleContextFactory {
  forRule(ruleId: RuleId): RuleContext;
}

const factories = new WeakMap<RuleContext, RuleContextFactory>();

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

function detachedFrozen<T>(value: T): DeepReadonly<T> {
  return deepFreeze(structuredClone(value));
}

function buildGameView(
  config: GameConfig,
  state: GameState,
  strength: StrengthOrder,
): GameView {
  return detachedFrozen({
    gameIndex: config.gameIndex,
    seats: config.seats,
    direction: state.public.direction,
    turn: state.public.turn,
    players: config.seats.map((id) => {
      const player = state.players[id];
      if (!player) {
        throw new Error(`Missing player state: ${id}`);
      }
      return {
        id,
        hand: player.hand,
        status: player.status,
        standing: player.standing ?? null,
      };
    }),
    field: state.public.field,
    discard: state.public.discard,
    history: state.public.history,
    strength,
  });
}

function memoryFor(
  memory: RuleMemory,
  ruleId: RuleId,
): Readonly<Record<string, DeepReadonly<RuleMemory[RuleId][string]>>> {
  return detachedFrozen(memory[ruleId] ?? {});
}

export function prepareRuleInvocation(
  state: GameState,
  entries: readonly RuleChainEntry[],
  hook: RuleInvocationHook,
  authoritative: boolean,
): {
  state: GameState;
  invocationIndices: Record<RuleId, number>;
} {
  const invocationIndices: Record<RuleId, number> = {};
  const hookCalls = { ...state.private.hookCalls };
  for (const entry of entries) {
    const key = `${entry.ruleId}:${hook}`;
    const current = hookCalls[key] ?? 0;
    invocationIndices[entry.ruleId] = current;
    if (authoritative) {
      hookCalls[key] = current + 1;
    }
  }
  if (!authoritative || entries.length === 0) {
    return { state, invocationIndices };
  }
  return {
    state: {
      ...state,
      private: {
        ...state.private,
        hookCalls,
      },
    },
    invocationIndices,
  };
}

export function buildRuleContext(
  config: GameConfig,
  state: GameState,
  strength: StrengthOrder,
  runtime: RuleRuntime,
  options: ContextBuildOptions,
): RuleContext {
  const game = buildGameView(config, state, strength);
  const setHistory = detachedFrozen(runtime.setHistory);
  const contexts = new Map<RuleId, RuleContext>();

  const factory: RuleContextFactory = {
    forRule(ruleId) {
      const existing = contexts.get(ruleId);
      if (existing) {
        return existing;
      }
      let rng = seedRng(
        `${config.gameSeed}:${ruleId}:${options.hook}:${
          options.invocationIndices[ruleId] ?? 0
        }`,
      );
      const context: RuleContext = Object.freeze({
        contractVersion: 1 as const,
        game,
        setHistory,
        memory: Object.freeze({
          game: memoryFor(state.private.memory, ruleId),
          set: memoryFor(runtime.setMemory, ruleId),
        }),
        rng: Object.freeze({
          next() {
            const result = nextRandom(rng);
            rng = result.state;
            return result.value;
          },
          int(maxExclusive: number) {
            const result = randomInt(rng, maxExclusive);
            rng = result.state;
            return result.value;
          },
        }),
      });
      contexts.set(ruleId, context);
      return context;
    },
  };

  const base = factory.forRule('__base__');
  factories.set(base, factory);
  return base;
}

export function contextForRule(
  context: RuleContext,
  ruleId: RuleId,
): RuleContext {
  return factories.get(context)?.forRule(ruleId) ?? context;
}
