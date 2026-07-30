import { describe, expect, it } from 'vitest';

import {
  DIAMOND_THREE_ID,
  compareCards,
  type NaturalCard,
} from '../cards/card.js';
import { reduceGame } from '../engine/reducer.js';
import { samePlay } from '../play/play.js';
import {
  NO_RULE_CHAIN_PORT,
  noRuleRuntime,
  type RuleRuntime,
} from '../rules/chain.js';
import { buildPlayerSnapshot } from '../snapshot/snapshot.js';
import { startGame } from './start-game.js';
import type { GameConfig, GameState, SnapshotContext } from './types.js';

const seats = ['p1', 'p2', 'p3', 'p4'];

function config(seed = 'ge-02-test'): GameConfig {
  return {
    gameIndex: 0,
    seats,
    gameSeed: seed,
    ruleChain: [],
  };
}

const snapshotContext: SnapshotContext = {
  setId: 'set-1',
  setPhase: { name: 'gameInProgress', gameIndex: 0 },
  members: seats.map((id) => ({
    id,
    displayName: `Player ${id}`,
    isAI: id !== 'p1',
  })),
  setResults: [],
};

function started(seed?: string) {
  const gameConfig = config(seed);
  return {
    config: gameConfig,
    ...startGame(gameConfig),
  };
}

function currentPlayer(state: GameState) {
  const player = state.public.turn;
  if (!player) {
    throw new Error('Expected an active turn');
  }
  return player;
}

describe('GE-02 game start and snapshots', () => {
  it('BR-1/BR-2/BR-11: 52枚を重複なく13枚ずつ配り、ダイヤ3保持者を先手にする', () => {
    const first = started('deterministic-deal');
    const second = started('deterministic-deal');
    const hands = seats.flatMap(
      (seat) => first.state.players[seat]?.hand ?? [],
    );

    expect(hands).toHaveLength(52);
    expect(new Set(hands.map((card) => card.id))).toHaveLength(52);
    expect(seats.map((seat) => first.state.players[seat]?.hand.length)).toEqual(
      [13, 13, 13, 13],
    );
    expect(
      first.state.players[first.state.public.turn ?? '']?.hand.some(
        (card) => card.id === DIAMOND_THREE_ID,
      ),
    ).toBe(true);
    expect(second.state).toEqual(first.state);
  });

  it('本人の手札だけを返し、他プレイヤーは枚数だけを公開する', () => {
    const game = started();
    const ownSnapshot = buildPlayerSnapshot(
      game.config,
      game.state,
      snapshotContext,
      'p1',
    );
    const otherCardIds = seats
      .filter((seat) => seat !== 'p1')
      .flatMap(
        (seat) => game.state.players[seat]?.hand.map((card) => card.id) ?? [],
      );
    const serialized = JSON.stringify(ownSnapshot);

    expect(ownSnapshot.hand).toEqual(game.state.players.p1?.hand);
    expect(ownSnapshot.players.map((player) => player.handCount)).toEqual([
      13, 13, 13, 13,
    ]);
    expect(otherCardIds.every((id) => !serialized.includes(id))).toBe(true);
  });

  it('スナップショットのネストを書き換えても権威状態を変更しない', () => {
    const game = started('snapshot-detachment');
    const player = currentPlayer(game.state);
    const card = game.state.players[player]?.hand[0];
    if (!card) {
      throw new Error('Expected an opening card');
    }
    const played = reduceGame(game.config, game.state, {
      type: 'play',
      player,
      cards: [card.id],
    });
    const nextPlayer = currentPlayer(played.state);
    const snapshot = buildPlayerSnapshot(
      game.config,
      played.state,
      snapshotContext,
      nextPlayer,
    );

    snapshot.field?.play.cards.splice(0);
    snapshot.history.splice(0);
    snapshot.legalMoves?.[0]?.cards.splice(0);

    expect(played.state.public.field.current?.play.cards).toHaveLength(1);
    expect(played.state.public.history.length).toBeGreaterThan(0);
    expect(
      buildPlayerSnapshot(
        game.config,
        played.state,
        snapshotContext,
        nextPlayer,
      ).legalMoves?.[0]?.cards.length,
    ).toBeGreaterThan(0);
  });

  it('除外札・KV・RNG・hookCallsをJSONスナップショットへ露出しない', () => {
    const game = started('snapshot-redaction');
    const hiddenOwner = seats.find(
      (seat) =>
        seat !== 'p1' && (game.state.players[seat]?.hand.length ?? 0) > 0,
    );
    const hiddenCard = hiddenOwner
      ? game.state.players[hiddenOwner]?.hand[0]
      : undefined;
    if (!hiddenOwner || !hiddenCard) {
      throw new Error('Expected another player card');
    }
    const hiddenState: GameState = {
      ...game.state,
      private: {
        ...game.state.private,
        excluded: [hiddenCard],
        memory: { 'r-secret': { secretCardId: hiddenCard.id } },
        hookCalls: { 'r-secret:afterPlay': 17 },
      },
      players: {
        ...game.state.players,
        [hiddenOwner]: {
          ...game.state.players[hiddenOwner]!,
          hand: game.state.players[hiddenOwner]!.hand.filter(
            (card) => card.id !== hiddenCard.id,
          ),
        },
      },
    };

    const serialized = JSON.stringify(
      buildPlayerSnapshot(game.config, hiddenState, snapshotContext, 'p1'),
    );

    expect(serialized).not.toContain(hiddenCard.id);
    expect(serialized).not.toContain('secretCardId');
    expect(serialized).not.toContain('hookCalls');
    expect(serialized).not.toContain('"rng"');
  });

  it('手番本人だけに合法手を同梱し、リードでのパスを無効にする', () => {
    const game = started();
    const turn = currentPlayer(game.state);
    const other = seats.find((seat) => seat !== turn);
    if (!other) {
      throw new Error('Expected another player');
    }

    const turnSnapshot = buildPlayerSnapshot(
      game.config,
      game.state,
      snapshotContext,
      turn,
    );
    const otherSnapshot = buildPlayerSnapshot(
      game.config,
      game.state,
      snapshotContext,
      other,
    );

    expect(turnSnapshot.legalMoves?.length).toBeGreaterThan(0);
    expect(turnSnapshot.canPass).toBe(false);
    expect(otherSnapshot.legalMoves).toBeNull();
    expect(otherSnapshot.canPass).toBe(false);
  });
});

describe('GE-02 play, pass, and rejection', () => {
  it('スナップショットに含まれる合法手を受理して次の手番へ進める', () => {
    const game = started();
    const turn = currentPlayer(game.state);
    const snapshot = buildPlayerSnapshot(
      game.config,
      game.state,
      snapshotContext,
      turn,
    );
    const selected = snapshot.legalMoves?.[0];
    if (!selected) {
      throw new Error('Expected a legal play');
    }

    const transition = reduceGame(game.config, game.state, {
      type: 'play',
      player: turn,
      cards: selected.cards.map((card) => card.id),
    });

    expect(transition.rejections).toEqual([]);
    expect(transition.events[0]?.type).toBe('played');
    expect(transition.state.public.turn).not.toBe(turn);
    expect(transition.state.players[turn]?.hand).toHaveLength(12);
    expect(
      samePlay(
        transition.state.public.field.current?.play ?? selected,
        selected,
      ),
    ).toBe(true);
  });

  it('最後に出した者以外の全員がパスすると場を流し、その者を次のリードにする', () => {
    const game = started('all-pass');
    const leader = currentPlayer(game.state);
    const card = game.state.players[leader]?.hand[0];
    if (!card) {
      throw new Error('Expected a card');
    }
    let state = reduceGame(game.config, game.state, {
      type: 'play',
      player: leader,
      cards: [card.id],
    }).state;

    const passEvents = [];
    for (let count = 0; count < 3; count += 1) {
      const passer = currentPlayer(state);
      const transition = reduceGame(game.config, state, {
        type: 'pass',
        player: passer,
      });
      passEvents.push(...transition.events);
      state = transition.state;
    }

    expect(passEvents.some((event) => event.type === 'fieldCleared')).toBe(
      true,
    );
    expect(state.public.field.current).toBeUndefined();
    expect(state.public.discard.map((discarded) => discarded.id)).toContain(
      card.id,
    );
    expect(state.public.turn).toBe(leader);
  });

  it('基本ルール上の不正操作を状態不変で拒否し、拒否は操作本人だけに返す', () => {
    const game = started('rejections');
    const turn = currentPlayer(game.state);
    const other = seats.find((seat) => seat !== turn);
    const hand = game.state.players[turn]?.hand;
    if (!other || !hand) {
      throw new Error('Expected players and a hand');
    }
    const differentRanks = hand.find(
      (card) =>
        card.kind === 'natural' &&
        hand[0]?.kind === 'natural' &&
        card.rank !== hand[0].rank,
    );
    if (!differentRanks || !hand[0]) {
      throw new Error('Expected cards with different ranks');
    }

    const cases = [
      {
        action: { type: 'pass' as const, player: turn },
        code: 'PASS_ON_LEAD',
      },
      {
        action: {
          type: 'play' as const,
          player: other,
          cards: [game.state.players[other]?.hand[0]?.id ?? 'missing'],
        },
        code: 'NOT_YOUR_TURN',
      },
      {
        action: {
          type: 'play' as const,
          player: turn,
          cards: ['not-in-hand'],
        },
        code: 'CARD_NOT_IN_HAND',
      },
      {
        action: {
          type: 'play' as const,
          player: turn,
          cards: [hand[0].id, differentRanks.id],
        },
        code: 'INVALID_PLAY_SHAPE',
      },
    ];

    for (const testCase of cases) {
      const transition = reduceGame(game.config, game.state, testCase.action);
      expect(transition.state).toBe(game.state);
      expect(transition.rejections).toEqual([
        { player: testCase.action.player, code: testCase.code },
      ]);
    }
  });

  it('場より弱い手とルールが禁止した手を区別して拒否する', () => {
    const game = started('too-weak');
    const twoOwner = seats.find((seat) =>
      game.state.players[seat]?.hand.some(
        (card) => card.kind === 'natural' && card.rank === '2',
      ),
    );
    const target = seats.find((seat) => seat !== twoOwner);
    const two = twoOwner
      ? game.state.players[twoOwner]?.hand.find(
          (card) => card.kind === 'natural' && card.rank === '2',
        )
      : undefined;
    const targetCard = target
      ? [...(game.state.players[target]?.hand ?? [])].sort(compareCards)[0]
      : undefined;
    if (!twoOwner || !target || !two || !targetCard) {
      throw new Error('Expected controlled cards');
    }
    const followingState: GameState = {
      ...game.state,
      public: {
        ...game.state.public,
        turn: target,
        field: {
          current: {
            play: {
              kind: 'single',
              cards: [two],
              count: 1,
              repRank: '2',
            },
            by: twoOwner,
          },
          passedSinceLastPlay: [],
        },
      },
    };

    const tooWeak = reduceGame(game.config, followingState, {
      type: 'play',
      player: target,
      cards: [targetCard.id],
    });
    expect(tooWeak.rejections[0]?.code).toBe('TOO_WEAK');
    expect(tooWeak.state).toBe(followingState);

    const rejectingRuntime: RuleRuntime = {
      ...noRuleRuntime(),
      port: {
        ...NO_RULE_CHAIN_PORT,
        modifyLegality: (_entries, _context, _plays, base) => ({
          results: base.map(() => ({
            legal: false as const,
            reasonKey: 'fixture.forbidden',
          })),
          influenced: [],
        }),
      },
    };
    const strongestTargetCard = [...(game.state.players[target]?.hand ?? [])]
      .sort(compareCards)
      .at(-1);
    const lowOwner = seats.find(
      (seat) =>
        seat !== target &&
        game.state.players[seat]?.hand.some(
          (card) => card.kind === 'natural' && card.rank === '3',
        ),
    );
    const lowCard = lowOwner
      ? game.state.players[lowOwner]?.hand.find(
          (card): card is NaturalCard =>
            card.kind === 'natural' && card.rank === '3',
        )
      : undefined;
    if (!strongestTargetCard || !lowOwner || !lowCard) {
      throw new Error('Expected a legal play for rule rejection');
    }
    const ruleState: GameState = {
      ...game.state,
      public: {
        ...game.state.public,
        turn: target,
        field: {
          current: {
            play: {
              kind: 'single',
              cards: [lowCard],
              count: 1,
              repRank: lowCard.rank,
            },
            by: lowOwner,
          },
          passedSinceLastPlay: [],
        },
      },
    };
    const forbidden = reduceGame(
      game.config,
      ruleState,
      {
        type: 'play',
        player: target,
        cards: [strongestTargetCard.id],
      },
      rejectingRuntime,
    );
    expect(forbidden.rejections).toEqual([
      {
        player: target,
        code: 'FORBIDDEN_BY_RULE',
        reasonKey: 'fixture.forbidden',
      },
    ]);
    expect(forbidden.state).toBe(ruleState);
  });

  it('1000手を超えたら手札枚数・席順で全順位を確定して終了する', () => {
    const game = started('turn-limit');
    const player = currentPlayer(game.state);
    const card = game.state.players[player]?.hand[0];
    if (!card) {
      throw new Error('Expected an opening card');
    }
    const guardedState: GameState = {
      ...game.state,
      public: { ...game.state.public, turnCount: 1000 },
    };

    const transition = reduceGame(game.config, guardedState, {
      type: 'play',
      player,
      cards: [card.id],
    });

    expect(transition.state.public.phase).toBe('finished');
    expect(transition.state.public.turn).toBeNull();
    expect(transition.events).toContainEqual({
      type: 'failsafe',
      reason: 'turnLimit',
      relatedRuleIds: [],
    });
    const standings = seats.map(
      (seat) => transition.state.players[seat]?.standing,
    );
    expect([...standings].sort()).toEqual([1, 2, 3, 4]);
  });
});
