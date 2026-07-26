import { describe, expect, it } from 'vitest';

import { createDeck } from '../cards/card.js';
import { seedRng } from '../rng/rng.js';
import type { GameState, PlayerId } from '../game/types.js';
import { NO_RULE_CHAIN_PORT, type RuleChainPort } from '../rules/chain.js';
import type { RuleChainEntry, RuleModule } from '../rules/contract.js';
import { createInProcessRuleChainPort } from '../rules/in-process.js';
import { reduceSet, startSet } from './set-reducer.js';
import { scoreSet } from './scoring.js';
import type { SetState } from './types.js';

const ids = ['p1', 'p2', 'p3', 'p4'];
const members = ids.map((id) => ({
  id,
  displayName: id,
  isAI: id !== 'p1',
}));

function startedSet(gamesPerSet = 3) {
  return startSet({
    setId: 'set-1',
    config: { gamesPerSet, interimAutoAdvanceMs: 5_000 },
    members,
    ruleChain: [],
    setSeed: 'set-seed',
  });
}

function nearFinishGame(order: PlayerId[]): GameState {
  const deck = createDeck();
  const cards = ['3', '4', '5', '6'].map((rank) => {
    const card = deck.find((candidate) => candidate.rank === rank);
    if (!card) {
      throw new Error(`Missing rank: ${rank}`);
    }
    return card;
  });
  return {
    public: {
      phase: 'awaitingPlay',
      direction: 1,
      turn: order[0] ?? null,
      field: { passedSinceLastPlay: [] },
      discard: [],
      standingsTaken: [],
      history: [],
      firedRules: [],
      turnCount: 0,
    },
    private: {
      excluded: [],
      memory: {},
      rng: seedRng('near-finish'),
      hookCalls: {},
    },
    players: Object.fromEntries(
      order.map((id, index) => [
        id,
        {
          id,
          hand: [cards[index]],
          status: 'active' as const,
          skipCount: 0,
        },
      ]),
    ) as GameState['players'],
  };
}

function finishGame(
  state: SetState,
  order: PlayerId[],
  port: RuleChainPort = NO_RULE_CHAIN_PORT,
): SetState {
  let current: SetState = {
    ...state,
    currentGame: nearFinishGame(order),
  };
  for (const player of order.slice(0, 3)) {
    const card = current.currentGame?.players[player]?.hand[0];
    if (!card) {
      throw new Error(`Missing card for ${player}`);
    }
    const transition = reduceSet(
      current,
      {
        type: 'play',
        player,
        cards: [card.id],
      },
      port,
    );
    expect(transition.rejections).toEqual([]);
    current = transition.state;
  }
  return current;
}

describe('GE-05 set progression', () => {
  it('同じメンバーで3戦を進め、ゲーム間結果とセット結果を保持する', () => {
    let state = startedSet();
    const originalMembers = state.members;
    const orders = [
      ['p1', 'p2', 'p3', 'p4'],
      ['p2', 'p3', 'p4', 'p1'],
      ['p3', 'p4', 'p1', 'p2'],
    ];

    orders.forEach((order, index) => {
      state = finishGame(state, order);
      expect(state.results).toHaveLength(index + 1);
      expect(state.members).toBe(originalMembers);
      if (index < 2) {
        expect(state.phase).toEqual({
          name: 'interimResult',
          gameIndex: index,
        });
        const advanced = reduceSet(state, { type: 'advance' });
        expect(advanced.rejections).toEqual([]);
        state = advanced.state;
        expect(state.phase).toEqual({
          name: 'gameInProgress',
          gameIndex: index + 1,
        });
      }
    });

    expect(state.phase).toEqual({ name: 'setResult' });
    expect(state.outcome?.standings).toHaveLength(4);
    expect(state.outcome?.results).toHaveLength(3);
  });

  it('gamesPerSet を変更しても同じ状態機械で終了する', () => {
    let state = startedSet(1);
    state = finishGame(state, ['p1', 'p2', 'p3', 'p4']);
    expect(state.phase).toEqual({ name: 'setResult' });
  });

  it('draining要求後は進行中ゲームだけ完走し、途中結果でセットを終了する', () => {
    let state = startedSet(3);
    const draining = reduceSet(state, { type: 'requestDrain' });
    expect(draining.rejections).toEqual([]);
    expect(draining.acceptedAction).toEqual({ type: 'requestDrain' });
    expect(draining.state.draining).toBe(true);
    expect(draining.state.phase).toEqual({
      name: 'gameInProgress',
      gameIndex: 0,
    });

    state = finishGame(draining.state, ['p1', 'p2', 'p3', 'p4']);
    expect(state.phase).toEqual({ name: 'setResult' });
    expect(state.results).toHaveLength(1);
    expect(state.outcome).toMatchObject({
      completion: 'drained',
      gamesPlayed: 1,
    });
  });

  it('ゲーム間のdraining要求は次戦を始めずセット結果へ進む', () => {
    const state = finishGame(startedSet(3), ['p1', 'p2', 'p3', 'p4']);
    expect(state.phase.name).toBe('interimResult');

    const drained = reduceSet(state, { type: 'requestDrain' });
    expect(drained.rejections).toEqual([]);
    expect(drained.state.phase).toEqual({ name: 'setResult' });
    expect(drained.state.outcome?.completion).toBe('drained');
    expect(drained.state.outcome?.gamesPlayed).toBe(1);
    expect(drained.events).toContainEqual(
      expect.objectContaining({
        type: 'setEnded',
        completion: 'drained',
        gamesPlayed: 1,
      }),
    );
  });

  it('第2戦のルールから前戦順位とsetスコープKVを参照できる', () => {
    const ruleEntry: RuleChainEntry = {
      ruleId: 'r0200-cross-game',
      name: '都落ち相当',
      position: 0,
      priority: {
        popularityScore: 0,
        activatedAt: '2026-07-26T00:00:00.000Z',
        ruleId: 'r0200-cross-game',
      },
      bundleHash: 'fixture',
      contractVersion: 1,
    };
    let observedHistoryLength = 0;
    let observedChampion: unknown;
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'cross-game fixture',
        kind: 'local',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        onGameEnd: (_context, standings) => {
          const champion = standings.standings.find(
            (result) => result.standing === 1,
          )?.player;
          return champion
            ? [
                {
                  type: 'setMemory',
                  scope: 'set',
                  key: 'champion',
                  value: champion,
                },
              ]
            : [];
        },
        afterPlay: (context) => {
          observedHistoryLength = context.setHistory.length;
          observedChampion = context.memory.set.champion;
          return typeof observedChampion === 'string' &&
            context.setHistory.length > 0
            ? [
                {
                  type: 'forceRank',
                  player: observedChampion,
                  rank: 4,
                },
              ]
            : [];
        },
      },
    };
    const port = createInProcessRuleChainPort([module]);
    let state = startSet(
      {
        setId: 'cross-game',
        config: { gamesPerSet: 3, interimAutoAdvanceMs: 0 },
        members,
        ruleChain: [ruleEntry],
        setSeed: 'cross-game-seed',
      },
      port,
    );
    state = finishGame(state, ['p1', 'p2', 'p3', 'p4'], port);
    expect(state.setMemory[ruleEntry.ruleId]?.champion).toBe('p1');

    const advanced = reduceSet(state, { type: 'advance' }, port);
    state = advanced.state;
    const player = state.currentGame?.public.turn;
    const card = player
      ? state.currentGame?.players[player]?.hand[0]
      : undefined;
    if (!player || !card) {
      throw new Error('Expected second-game opening play');
    }
    const played = reduceSet(
      state,
      { type: 'play', player, cards: [card.id] },
      port,
    );

    expect(played.rejections).toEqual([]);
    expect(observedHistoryLength).toBe(1);
    expect(observedChampion).toBe('p1');
    expect(played.state.currentGame?.players.p1).toMatchObject({
      status: 'retired',
      standing: 4,
    });
  });

  it('onGameStartだけで終局したゲームを即座に結果へ積む', () => {
    const ruleEntry: RuleChainEntry = {
      ruleId: 'r0201-start-finish',
      name: '開幕順位',
      position: 0,
      priority: {
        popularityScore: 0,
        activatedAt: '2026-07-26T00:00:00.000Z',
        ruleId: 'r0201-start-finish',
      },
      bundleHash: 'fixture',
      contractVersion: 1,
    };
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'finish on start fixture',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        onGameStart: () => [
          { type: 'forceRank', player: 'p1', rank: 1 },
          { type: 'forceRank', player: 'p2', rank: 2 },
          { type: 'forceRank', player: 'p3', rank: 3 },
        ],
      },
    };
    const port = createInProcessRuleChainPort([module]);

    const state = startSet(
      {
        setId: 'start-finish',
        config: { gamesPerSet: 3, interimAutoAdvanceMs: 0 },
        members,
        ruleChain: [ruleEntry],
        setSeed: 'start-finish-seed',
      },
      port,
    );

    expect(state.phase).toEqual({ name: 'interimResult', gameIndex: 0 });
    expect(state.currentGame?.public.phase).toBe('finished');
    expect(state.results).toHaveLength(1);
    expect(
      state.results[0]?.standings.map((result) => result.standing),
    ).toEqual([1, 2, 3, 4]);
  });

  it('順位点を合計し、同点は最終戦順位で決める', () => {
    const results = [
      {
        gameIndex: 0,
        standings: [
          { player: 'p1', standing: 1 as const, title: '大富豪' as const },
          { player: 'p2', standing: 2 as const, title: '富豪' as const },
          { player: 'p3', standing: 3 as const, title: '貧民' as const },
          { player: 'p4', standing: 4 as const, title: '大貧民' as const },
        ],
        firedRuleIds: [],
      },
      {
        gameIndex: 1,
        standings: [
          { player: 'p2', standing: 1 as const, title: '大富豪' as const },
          { player: 'p1', standing: 2 as const, title: '富豪' as const },
          { player: 'p3', standing: 3 as const, title: '貧民' as const },
          { player: 'p4', standing: 4 as const, title: '大貧民' as const },
        ],
        firedRuleIds: [],
      },
    ];
    const outcome = scoreSet('set-1', {
      members,
      ruleChain: [],
      results,
    });
    expect(outcome.standings.slice(0, 2)).toEqual([
      {
        player: 'p2',
        points: 7,
        totalStanding: 1,
        title: '大富豪',
      },
      {
        player: 'p1',
        points: 7,
        totalStanding: 2,
        title: '富豪',
      },
    ]);
  });
});
