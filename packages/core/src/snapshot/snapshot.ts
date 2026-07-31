import { sortCards } from '../cards/card.js';
import type {
  GameConfig,
  GameState,
  PlayerSnapshot,
  SnapshotContext,
  Standing,
} from '../game/types.js';
import { enumerateLegalPlays } from '../play/candidates.js';
import { BASE_STRENGTH_ORDER } from '../play/strength.js';
import { noRuleRuntime, type RuleRuntime } from '../rules/chain.js';
import { buildRuleContext, prepareRuleInvocation } from '../rules/context.js';
import { safeModifyStrength } from '../rules/safe-port.js';

const TITLES: Record<Standing, PlayerSnapshot['players'][number]['title']> = {
  1: '大富豪',
  2: '富豪',
  3: '貧民',
  4: '大貧民',
};

export function buildPlayerSnapshot(
  config: GameConfig,
  state: GameState,
  context: SnapshotContext,
  forPlayer: string,
  runtime: RuleRuntime = noRuleRuntime(),
): PlayerSnapshot {
  const ownState = state.players[forPlayer];
  if (!ownState) {
    throw new Error(`Unknown snapshot player: ${forPlayer}`);
  }
  const memberById = new Map(
    context.members.map((member) => [member.id, member]),
  );
  const strengthInvocation = prepareRuleInvocation(
    state,
    config.ruleChain,
    'modifyStrength',
    false,
  );
  const baseContext = buildRuleContext(
    config,
    strengthInvocation.state,
    BASE_STRENGTH_ORDER,
    runtime,
    {
      hook: 'modifyStrength',
      invocationIndices: strengthInvocation.invocationIndices,
    },
  );
  const effectiveStrength = safeModifyStrength(
    runtime.port,
    config.ruleChain,
    baseContext,
    BASE_STRENGTH_ORDER,
  ).result;
  const isTurn =
    state.public.phase === 'awaitingPlay' && state.public.turn === forPlayer;
  const pending = state.private.pendingChoice;
  const pendingCards =
    pending?.player === forPlayer
      ? pending.optionCardIds.flatMap((cardId) => {
          const card = ownState.hand.find(
            (candidate) => candidate.id === cardId,
          );
          return card ? [card] : [];
        })
      : [];

  return structuredClone({
    forPlayer,
    setId: context.setId,
    setPhase: context.setPhase,
    gameIndex: config.gameIndex,
    gamePhase: state.public.phase,
    turn: state.public.turn,
    direction: state.public.direction,
    trickNumber:
      state.public.history.filter((event) => event.type === 'fieldCleared')
        .length + 1,
    seats: [...config.seats],
    players: config.seats.map((id) => {
      const player = state.players[id];
      if (!player) {
        throw new Error(`Missing player state: ${id}`);
      }
      const member = memberById.get(id);
      return {
        id,
        displayName: member?.displayName ?? id,
        isAI: member?.isAI ?? false,
        handCount: player.hand.length,
        status: player.status,
        standing: player.standing ?? null,
        title: player.standing ? TITLES[player.standing] : null,
      };
    }),
    hand: sortCards(ownState.hand),
    field: state.public.field.current ?? null,
    passedSinceLastPlay: [...state.public.field.passedSinceLastPlay],
    discardCount: state.public.discard.length,
    excludedCount: state.private.excluded.length,
    legalMoves: isTurn
      ? enumerateLegalPlays(config, state, forPlayer, runtime)
      : null,
    canPass: isTurn && state.public.field.current !== undefined,
    strengthNote: {
      inverted:
        effectiveStrength.ranking.join(',') ===
        [...BASE_STRENGTH_ORDER.ranking].reverse().join(','),
    },
    setResults: context.setResults,
    effectiveRules: config.ruleChain.map(({ ruleId, name }) => ({
      ruleId,
      name,
    })),
    history: [...state.public.history],
    pendingChoice:
      pending === undefined
        ? null
        : {
            ruleId: pending.ruleId,
            player: pending.player,
            choiceId: pending.choiceId,
            messageKey: pending.messageKey,
            count: pending.count,
            cards: pendingCards,
          },
  });
}
