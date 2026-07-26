import {
  buildPlayerSnapshot,
  NO_RULE_CHAIN_PORT,
  POINTS_BY_STANDING,
  sortCards,
  type GameResult,
  type PublicGameEvent,
  type RuleChainPort,
} from '@daifugo/core';

import type {
  GameResultView,
  GameView,
  MemberView,
  PlayerRoomView,
  PublicPlayView,
  RoomMember,
  RoomState,
  SeatId,
  SetResultView,
} from './types.js';

function seatByMember(members: readonly RoomMember[]): Map<string, SeatId> {
  return new Map(
    members.flatMap((member) =>
      member.seatId === null
        ? []
        : ([[member.memberId, member.seatId]] as const),
    ),
  );
}

function requiredSeat(
  seats: ReadonlyMap<string, SeatId>,
  memberId: string,
): SeatId {
  const seat = seats.get(memberId);
  if (seat === undefined) {
    throw new Error(`Missing seat for member: ${memberId}`);
  }
  return seat;
}

function resultView(
  result: GameResult,
  seats: ReadonlyMap<string, SeatId>,
): GameResultView {
  return structuredClone({
    gameNo: result.gameIndex + 1,
    standings: result.standings.map((standing) => ({
      seat: requiredSeat(seats, standing.player),
      rank: standing.standing,
      title: standing.title,
      points: POINTS_BY_STANDING[standing.standing],
    })),
    firedRuleIds: [...result.firedRuleIds],
  });
}

function historyView(
  event: PublicGameEvent,
  seats: ReadonlyMap<string, SeatId>,
): PublicPlayView {
  switch (event.type) {
    case 'gameStarted':
      return {
        t: 'gameStarted',
        firstSeat: requiredSeat(seats, event.firstPlayer),
        handCounts: [...seats.entries()]
          .sort((left, right) => left[1] - right[1])
          .map(([memberId]) => event.handCounts[memberId] ?? 0),
      };
    case 'played':
      return {
        t: 'played',
        seat: requiredSeat(seats, event.player),
        cards: sortCards(event.play.cards),
        kind: event.play.kind,
      };
    case 'passed':
      return {
        t: 'passed',
        seat: requiredSeat(seats, event.player),
      };
    case 'fieldCleared':
      return {
        t: 'fieldCleared',
        reason: event.reason,
        nextLeaderSeat: requiredSeat(seats, event.nextLeader),
      };
    case 'turnChanged':
      return {
        t: 'turnChanged',
        seat: requiredSeat(seats, event.player),
      };
    case 'playerFinished':
      return {
        t: 'playerFinished',
        seat: requiredSeat(seats, event.player),
        rank: event.standing,
        title: event.title,
      };
    case 'gameEnded':
      return {
        t: 'gameEnded',
        standings: event.standings.map((standing) => ({
          seat: requiredSeat(seats, standing.player),
          rank: standing.standing,
          title: standing.title,
        })),
      };
    case 'ruleFired':
      return {
        t: 'ruleFired',
        ruleId: event.ruleId,
        messageKey: event.messageKey,
      };
    case 'failsafe':
      return { t: 'failsafe', reason: event.reason };
    case 'playerRetired':
      return {
        t: 'playerRetired',
        seat: requiredSeat(seats, event.player),
        cardCount: event.cardCount,
        rank: event.standing,
      };
    case 'cardsMoved':
      return { t: 'cardsMoved', count: event.count };
  }
}

function memberViews(state: RoomState): MemberView[] {
  const game = state.engine?.currentGame;
  const ordered =
    state.phase === 'waiting'
      ? [...state.members].sort((left, right) => left.joinedAt - right.joinedAt)
      : [...state.members].sort(
          (left, right) =>
            (left.seatId ?? Number.MAX_SAFE_INTEGER) -
            (right.seatId ?? Number.MAX_SAFE_INTEGER),
        );
  return ordered.map((member) => {
    const player = game?.players[member.memberId];
    return {
      memberId: member.memberId,
      seatId: member.seatId,
      displayName: member.displayName,
      isAI: member.isAI,
      isHost: member.isHost,
      connected: member.isAI ? true : member.connected,
      aiActing: member.aiActing,
      departed: member.departed,
      handCount:
        state.phase === 'playing' && player ? player.hand.length : null,
      finishedRank: player?.standing ?? null,
      wantsNextSet:
        state.phase === 'setResult'
          ? member.isAI
            ? true
            : member.wantsNextSet
          : null,
    };
  });
}

function gameView(
  state: RoomState,
  memberId: string,
  seats: ReadonlyMap<string, SeatId>,
  rulePort: RuleChainPort,
): GameView | null {
  const engine = state.engine;
  const game = engine?.currentGame;
  if (state.phase !== 'playing' || !engine || !game) {
    return null;
  }
  const current = game.public.field.current;
  const gameIndex =
    engine.phase.name === 'setResult' ? 0 : engine.phase.gameIndex;
  const playerSnapshot = buildPlayerSnapshot(
    {
      gameIndex,
      seats: engine.members.map((member) => member.id),
      gameSeed: `${engine.setSeed}:${gameIndex}`,
      ruleChain: engine.ruleChain,
    },
    game,
    {
      setId: engine.setId,
      setPhase: engine.phase,
      members: engine.members,
      setResults: engine.results,
    },
    memberId,
    {
      port: rulePort,
      setHistory: engine.results,
      setMemory: engine.setMemory,
    },
  );
  return {
    gameNo:
      engine.phase.name === 'setResult'
        ? engine.results.length
        : engine.phase.gameIndex + 1,
    status: engine.phase.name === 'interimResult' ? 'intermission' : 'playing',
    intermission:
      engine.phase.name === 'interimResult' && state.intermissionEndsAt !== null
        ? {
            durationMs: engine.config.interimAutoAdvanceMs,
            endsAt: state.intermissionEndsAt,
          }
        : null,
    field: {
      cards: current ? sortCards(current.play.cards) : [],
      playedBySeat: current ? requiredSeat(seats, current.by) : null,
      passedSeats: game.public.field.passedSinceLastPlay.map((player) =>
        requiredSeat(seats, player),
      ),
    },
    turn:
      game.public.phase === 'awaitingPlay' && game.public.turn
        ? {
            seat: requiredSeat(seats, game.public.turn),
            turnSeq: state.turnSeq,
            deadlineAt: state.turnDeadlineAt,
          }
        : null,
    history: game.public.history.map((event) => historyView(event, seats)),
    previousResults: engine.results.map((result) => resultView(result, seats)),
    yourHand: sortCards(game.players[memberId]?.hand ?? []),
    legalMoves: playerSnapshot.legalMoves,
  };
}

function setResultView(state: RoomState): SetResultView | null {
  const engine = state.engine;
  if (
    state.phase !== 'setResult' ||
    !engine?.outcome ||
    state.setRespondBy === null
  ) {
    return null;
  }
  return {
    standings: engine.outcome.standings.map((standing) => ({
      memberId: standing.player,
      totalRank: standing.totalStanding,
      title: standing.title,
      ranks: engine.results.map(
        (result) =>
          result.standings.find((entry) => entry.player === standing.player)
            ?.standing ?? 4,
      ),
      points: standing.points,
    })),
    respondBy: state.setRespondBy,
  };
}

export function viewFor(
  state: RoomState,
  memberId: string,
  options: { reconnect?: boolean; rulePort?: RuleChainPort } = {},
): PlayerRoomView {
  if (state.phase === 'closed') {
    throw new Error('Cannot create a view for a closed room');
  }
  const member = state.members.find(
    (candidate) => candidate.memberId === memberId,
  );
  if (!member) {
    throw new Error(`Unknown room member: ${memberId}`);
  }
  const seats = seatByMember(state.members);
  const rules = state.fixedRules ?? state.availableRules;
  return structuredClone({
    v: state.v,
    roomId: state.roomId,
    inviteCode: state.inviteCode,
    phase: state.phase,
    members: memberViews(state),
    you: {
      memberId: member.memberId,
      seatId: member.seatId,
    },
    activeRules: rules.map((rule) => ({
      ruleId: rule.ruleId,
      name: rule.name,
    })),
    game: gameView(
      state,
      memberId,
      seats,
      options.rulePort ?? NO_RULE_CHAIN_PORT,
    ),
    setResult: setResultView(state),
    events: options.reconnect ? [] : structuredClone(state.lastEvents),
  });
}
