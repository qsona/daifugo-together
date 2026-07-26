import type {
  GameAction,
  GameConfig,
  GameState,
  PlayerId,
  PlayerSnapshot,
  PublicGameEvent,
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

export interface SimulationApi {
  enumerateLegalPlays(state: GameState, player: PlayerId): Play[];
  applyPlay(
    state: GameState,
    action: GameAction,
  ): { state: GameState; events: PublicGameEvent[] };
  isTerminal(state: GameState): Standings | null;
  getEffectiveStrengthOrder(state: GameState): StrengthOrder;
  getPlayerView(state: GameState, player: PlayerId): PlayerSnapshot;
  fallbackPlay(state: GameState, player: PlayerId): GameAction;
  serialize(state: GameState): string;
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

  const effectiveStrength = (state: GameState): StrengthOrder => {
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
    return runtime.port.modifyStrength(
      config.ruleChain,
      context,
      BASE_STRENGTH_ORDER,
    ).result;
  };

  return {
    enumerateLegalPlays(state, player) {
      return enumerateLegalPlays(config, state, player, runtime);
    },

    applyPlay(state, action) {
      const transition = reduceGame(config, state, action, runtime);
      if (transition.rejections.length > 0) {
        throw new Error(
          `Simulation action was rejected: ${JSON.stringify(
            transition.rejections,
          )}`,
        );
      }
      return {
        state: transition.state,
        events: publicEvents(transition.events),
      };
    },

    isTerminal(state) {
      return terminalStandings(config, state);
    },

    getEffectiveStrengthOrder(state) {
      return effectiveStrength(state);
    },

    getPlayerView(state, player) {
      return buildPlayerSnapshot(
        config,
        state,
        snapshotContext,
        player,
        runtime,
      );
    },

    fallbackPlay(state, player) {
      if (
        state.public.phase !== 'awaitingPlay' ||
        state.public.turn !== player
      ) {
        throw new Error(`Fallback requested outside ${player}'s turn`);
      }
      if (state.public.field.current) {
        return { type: 'pass', player };
      }
      const ranking = effectiveStrength(state).ranking;
      const rankIndex = new Map(ranking.map((rank, index) => [rank, index]));
      const fallback = enumerateLegalPlays(config, state, player, runtime)
        .filter((play) => play.kind === 'single')
        .sort(
          (left, right) =>
            (rankIndex.get(left.repRank) ?? Number.MAX_SAFE_INTEGER) -
              (rankIndex.get(right.repRank) ?? Number.MAX_SAFE_INTEGER) ||
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

    serialize(state) {
      return JSON.stringify(state);
    },
  };
}
