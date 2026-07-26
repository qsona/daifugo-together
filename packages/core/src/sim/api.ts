import type {
  GameAction,
  GameConfig,
  GameState,
  PlayerId,
  PlayerSnapshot,
  PublicGameEvent,
  RuleMemory,
  SnapshotContext,
} from '../game/types.js';
import { TITLE_BY_STANDING } from '../game/types.js';
import { reduceGame } from '../engine/reducer.js';
import { enumerateLegalPlays } from '../play/candidates.js';
import type { Play } from '../play/play.js';
import { BASE_STRENGTH_ORDER, type StrengthOrder } from '../play/strength.js';
import { noRuleRuntime, type RuleRuntime } from '../rules/chain.js';
import { buildRuleContext, prepareRuleInvocation } from '../rules/context.js';
import type { Standings } from '../rules/contract.js';
import { buildPlayerSnapshot } from '../snapshot/snapshot.js';

export interface CreateSimulationApiInput {
  config: GameConfig;
  snapshotContext: SnapshotContext;
  runtime?: RuleRuntime;
}

export interface SimulationPosition {
  state: GameState;
  setMemory: RuleMemory;
}

export interface SimulationApi {
  createPosition(state: GameState, setMemory?: RuleMemory): SimulationPosition;
  enumerateLegalPlays(position: SimulationPosition, player: PlayerId): Play[];
  applyPlay(
    position: SimulationPosition,
    action: GameAction,
  ): { position: SimulationPosition; events: PublicGameEvent[] };
  isTerminal(position: SimulationPosition): Standings | null;
  getEffectiveStrengthOrder(position: SimulationPosition): StrengthOrder;
  getPlayerView(position: SimulationPosition, player: PlayerId): PlayerSnapshot;
  fallbackPlay(position: SimulationPosition, player: PlayerId): GameAction;
  serialize(position: SimulationPosition): string;
}

function publicEvents(
  events: ReturnType<typeof reduceGame>['events'],
): PublicGameEvent[] {
  return events.filter(
    (event): event is PublicGameEvent =>
      event.type !== 'effectApplied' && event.type !== 'effectRejected',
  );
}

function terminalStandings(
  config: GameConfig,
  state: GameState,
): Standings | null {
  if (state.public.phase !== 'finished') {
    return null;
  }
  return {
    standings: config.seats
      .map((player) => {
        const standing = state.players[player]?.standing;
        if (!standing) {
          throw new Error(`Finished player has no standing: ${player}`);
        }
        return {
          player,
          standing,
          title: TITLE_BY_STANDING[standing],
        };
      })
      .sort((left, right) => left.standing - right.standing),
  };
}

export function createSimulationApi(
  input: CreateSimulationApiInput,
): SimulationApi {
  const config = structuredClone(input.config);
  const snapshotContext = structuredClone(input.snapshotContext);
  const runtime = input.runtime ?? noRuleRuntime();
  const initialSetMemory = structuredClone(runtime.setMemory);

  const runtimeFor = (position: SimulationPosition): RuleRuntime => ({
    ...runtime,
    setMemory: position.setMemory,
  });

  const effectiveStrength = (position: SimulationPosition): StrengthOrder => {
    const { state } = position;
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
      runtimeFor(position),
      {
        hook: 'modifyStrength',
        invocationIndices: invocation.invocationIndices,
      },
    );
    return runtime.port.modifyStrength(
      config.ruleChain,
      context,
      BASE_STRENGTH_ORDER,
    ).result;
  };

  return {
    createPosition(state, setMemory = initialSetMemory) {
      return {
        state: structuredClone(state),
        setMemory: structuredClone(setMemory),
      };
    },

    enumerateLegalPlays(position, player) {
      return enumerateLegalPlays(
        config,
        position.state,
        player,
        runtimeFor(position),
      );
    },

    applyPlay(position, action) {
      const transition = reduceGame(
        config,
        position.state,
        action,
        runtimeFor(position),
      );
      if (transition.rejections.length > 0) {
        throw new Error(
          `Simulation action was rejected: ${JSON.stringify(
            transition.rejections,
          )}`,
        );
      }
      return {
        position: {
          state: transition.state,
          setMemory: transition.setMemory ?? position.setMemory,
        },
        events: publicEvents(transition.events),
      };
    },

    isTerminal(position) {
      return terminalStandings(config, position.state);
    },

    getEffectiveStrengthOrder(position) {
      return effectiveStrength(position);
    },

    getPlayerView(position, player) {
      return buildPlayerSnapshot(
        config,
        position.state,
        snapshotContext,
        player,
        runtimeFor(position),
      );
    },

    fallbackPlay(position, player) {
      const { state } = position;
      if (
        state.public.phase !== 'awaitingPlay' ||
        state.public.turn !== player
      ) {
        throw new Error(`Fallback requested outside ${player}'s turn`);
      }
      if (state.public.field.current) {
        return { type: 'pass', player };
      }
      const ranking = effectiveStrength(position).ranking;
      const rankIndex = new Map(ranking.map((rank, index) => [rank, index]));
      const fallback = enumerateLegalPlays(
        config,
        state,
        player,
        runtimeFor(position),
      ).sort(
        (left, right) =>
          (rankIndex.get(left.repRank) ?? Number.MAX_SAFE_INTEGER) -
            (rankIndex.get(right.repRank) ?? Number.MAX_SAFE_INTEGER) ||
          right.count - left.count ||
          left.cards[0]!.id.localeCompare(right.cards[0]!.id),
      )[0];
      if (!fallback) {
        throw new Error('No fallback play is available on lead');
      }
      return {
        type: 'play',
        player,
        cards: fallback.cards.map((card) => card.id),
      };
    },

    serialize(position) {
      return JSON.stringify(position);
    },
  };
}
