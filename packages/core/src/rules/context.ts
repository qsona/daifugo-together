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
import { ENGINE_CONTRACT_VERSION } from './contract.js';

export type RuleInvocationHook = keyof RuleHooks;

interface ContextBuildOptions {
  hook: RuleInvocationHook;
  invocationIndices: Readonly<Record<RuleId, number>>;
}

interface RuleContextFactory {
  forRule(ruleId: RuleId): RuleContext;
}

const factories = new WeakMap<RuleContext, RuleContextFactory>();
const trustedContractVersions = new WeakMap<
  GameConfig,
  ReadonlyMap<RuleId, 1 | 2>
>();

export function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

export function detachedFrozen<T>(value: T): DeepReadonly<T> {
  return deepFreeze(structuredClone(value));
}

function buildGameView(
  config: GameConfig,
  state: GameState,
  strength: StrengthOrder,
  trustedSimulation: boolean,
): GameView {
  const view = {
    gameIndex: config.gameIndex,
    ruleIds: config.ruleChain.map((entry) => entry.ruleId),
    suitBindingResetAfter: state.private.suitBindingResetAfter ?? null,
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
  };
  return trustedSimulation ? view : detachedFrozen(view);
}

function memoryFor(
  memory: RuleMemory,
  ruleId: RuleId,
  trustedSimulation: boolean,
): Readonly<Record<string, DeepReadonly<RuleMemory[RuleId][string]>>> {
  const value = memory[ruleId] ?? {};
  return trustedSimulation ? value : detachedFrozen(value);
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
  if (!authoritative) {
    for (const entry of entries) {
      invocationIndices[entry.ruleId] =
        state.private.hookCalls[`${entry.ruleId}:${hook}`] ?? 0;
    }
    return { state, invocationIndices };
  }
  const hookCalls = { ...state.private.hookCalls };
  for (const entry of entries) {
    const key = `${entry.ruleId}:${hook}`;
    const current = hookCalls[key] ?? 0;
    invocationIndices[entry.ruleId] = current;
    hookCalls[key] = current + 1;
  }
  if (entries.length === 0) {
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
  const trustedSimulation = runtime.port.trustedSimulation === true;
  const game = buildGameView(config, state, strength, trustedSimulation);
  const setHistory = trustedSimulation
    ? runtime.setHistory
    : detachedFrozen(runtime.setHistory);
  const contexts = new Map<RuleId, RuleContext>();
  let contractVersionByRule = trustedSimulation
    ? trustedContractVersions.get(config)
    : undefined;
  if (!contractVersionByRule) {
    contractVersionByRule = new Map(
      config.ruleChain.map((entry) => [
        entry.ruleId,
        entry.contractVersion === 2 ? (2 as const) : (1 as const),
      ]),
    );
    if (trustedSimulation) {
      trustedContractVersions.set(config, contractVersionByRule);
    }
  }

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
      const contextValue: RuleContext = {
        contractVersion:
          contractVersionByRule.get(ruleId) ?? ENGINE_CONTRACT_VERSION,
        game,
        setHistory,
        memory: {
          game: memoryFor(state.private.memory, ruleId, trustedSimulation),
          set: memoryFor(runtime.setMemory, ruleId, trustedSimulation),
        },
        rng: {
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
        },
      };
      const context = trustedSimulation
        ? contextValue
        : Object.freeze({
            ...contextValue,
            memory: Object.freeze(contextValue.memory),
            rng: Object.freeze(contextValue.rng),
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
