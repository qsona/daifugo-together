import type {
  CardRank,
  GameConfig,
  GameState,
  NaturalCard,
  PlayerId,
  Play,
  RuleContext,
  RuleModule,
  RuleRuntime,
  Standings,
  Standing,
} from '@daifugo/core';
import {
  createInProcessRuleChainPort,
  reduceGame,
  seedRng,
} from '@daifugo/core';
import { describe, expect, it, vi } from 'vitest';

const { rule } = (await vi.importActual('./rule.js')) as { rule: RuleModule };
const { rule: noFinishWithTwoRule } = (await vi.importActual(
  '../r0004-no-finish-with-two/rule.js',
)) as { rule: RuleModule };

function context(input: {
  actor: PlayerId;
  actorStanding: Standing | null;
  previousWinner?: PlayerId;
  previousWinnerStanding?: Standing | null;
  activeRuleIds?: string[];
  revolution?: boolean;
}): RuleContext {
  const ids = ['p1', 'p2', 'p3', 'p4'];
  return {
    game: {
      activeRuleIds: input.activeRuleIds ?? ['r0009-miyako-ochi'],
      strength: { revolution: input.revolution ?? false },
      field: {
        current: {
          by: input.actor,
          play: { kind: 'single', cards: [], count: 1, repRank: '3' },
        },
        passedSinceLastPlay: [],
      },
      players: ids.map((id) => ({
        id,
        standing:
          id === input.actor
            ? input.actorStanding
            : id === input.previousWinner
              ? (input.previousWinnerStanding ?? null)
              : null,
      })),
    },
    memory: {
      game: {},
      set: {
        ...(input.previousWinner
          ? { previousWinner: input.previousWinner }
          : {}),
      },
    },
  } as unknown as RuleContext;
}

function play(rank: CardRank): Play {
  return {
    kind: 'single',
    cards: [
      {
        kind: 'natural',
        id: `spade-${rank}`,
        suit: 'spade',
        rank,
      },
    ],
    count: 1,
    repRank: rank,
  };
}

function natural(rank: CardRank): NaturalCard {
  return {
    kind: 'natural',
    id: `spade-${rank}`,
    suit: 'spade',
    rank,
  };
}

const standings = (winner: PlayerId): Standings => ({
  standings: ['p1', 'p2', 'p3', 'p4'].map((player, index) => ({
    player,
    standing:
      player === winner
        ? 1
        : ((['p1', 'p2', 'p3', 'p4']
            .filter((id) => id !== winner)
            .indexOf(player) + 2) as Standing),
    title:
      player === winner
        ? '大富豪'
        : index === 3
          ? '大貧民'
          : index === 1
            ? '富豪'
            : '貧民',
  })),
});

describe('都落ち', () => {
  it('ゲーム終了時の1位を次ゲーム用のset memoryへ保存する', () => {
    expect(
      rule.hooks.onGameEnd?.(
        context({ actor: 'p1', actorStanding: 1 }),
        standings('p2'),
      ),
    ).toEqual([
      {
        type: 'setMemory',
        scope: 'set',
        key: 'previousWinner',
        value: 'p2',
        silent: true,
      },
    ]);
  });

  it('前ゲーム1位ではないプレイヤーが最初に上がると前ゲーム1位を最下位にする', () => {
    expect(
      rule.hooks.afterPlay?.(
        context({
          actor: 'p2',
          actorStanding: 1,
          previousWinner: 'p1',
        }),
        { kind: 'single', cards: [], count: 1, repRank: '3' },
      ),
    ).toEqual([{ type: 'forceRank', player: 'p1', rank: 'lowest' }]);
  });

  it('2あがり禁止による反則あがりでは都落ちを発動しない', () => {
    expect(
      rule.hooks.afterPlay?.(
        context({
          actor: 'p2',
          actorStanding: 1,
          previousWinner: 'p1',
          activeRuleIds: ['r0004-no-finish-with-two', 'r0009-miyako-ochi'],
        }),
        play('2'),
      ),
    ).toEqual([]);
  });

  it('エンジン上でも反則あがりだけを最下位にして前ゲーム1位を残す', () => {
    const modules = [rule, noFinishWithTwoRule];
    const config: GameConfig = {
      gameIndex: 1,
      seats: ['p1', 'p2', 'p3', 'p4'],
      gameSeed: 'forbidden-finish-with-miyako-ochi',
      ruleChain: modules.map((module, position) => ({
        ruleId: module.meta.ruleId,
        name: module.meta.name,
        position,
        priority: {
          score: 0,
          activatedAt: position,
          ruleId: module.meta.ruleId,
        },
        bundleHash: 'test',
        contractVersion: module.meta.contractVersion,
      })),
    };
    const state: GameState = {
      public: {
        phase: 'awaitingPlay',
        direction: 1,
        turn: 'p2',
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
        rng: seedRng('forbidden-finish-with-miyako-ochi'),
        hookCalls: {},
      },
      players: {
        p1: {
          id: 'p1',
          hand: [natural('3'), natural('4')],
          status: 'active',
          skipCount: 0,
        },
        p2: {
          id: 'p2',
          hand: [natural('2')],
          status: 'active',
          skipCount: 0,
        },
        p3: {
          id: 'p3',
          hand: [natural('5')],
          status: 'active',
          skipCount: 0,
        },
        p4: {
          id: 'p4',
          hand: [natural('6')],
          status: 'active',
          skipCount: 0,
        },
      },
    };
    const runtime: RuleRuntime = {
      port: createInProcessRuleChainPort(modules),
      setHistory: [],
      setMemory: {
        [rule.meta.ruleId]: { previousWinner: 'p1' },
      },
    };

    const transition = reduceGame(
      config,
      state,
      { type: 'play', player: 'p2', cards: ['spade-2'] },
      runtime,
    );

    expect(transition.rejections).toEqual([]);
    expect(transition.state.players.p2?.standing).toBe(4);
    expect(transition.state.players.p1?.standing).toBeUndefined();
    expect(transition.state.players.p1?.status).toBe('active');
    expect(transition.state.public.firedRules).toEqual([
      noFinishWithTwoRule.meta.ruleId,
    ]);
  });

  it('革命中の3による反則あがりでも都落ちを発動しない', () => {
    expect(
      rule.hooks.afterPlay?.(
        context({
          actor: 'p2',
          actorStanding: 1,
          previousWinner: 'p1',
          activeRuleIds: ['r0004-no-finish-with-two', 'r0009-miyako-ochi'],
          revolution: true,
        }),
        play('3'),
      ),
    ).toEqual([]);
  });

  it('2あがり禁止が無効なら2での上がりにも都落ちを適用する', () => {
    expect(
      rule.hooks.afterPlay?.(
        context({
          actor: 'p2',
          actorStanding: 1,
          previousWinner: 'p1',
        }),
        play('2'),
      ),
    ).toEqual([{ type: 'forceRank', player: 'p1', rank: 'lowest' }]);
  });

  it('前ゲーム1位が最初に上がると発動せず、その後の上がりにも発動しない', () => {
    expect(
      rule.hooks.afterPlay?.(
        context({
          actor: 'p1',
          actorStanding: 1,
          previousWinner: 'p1',
        }),
        { kind: 'single', cards: [], count: 1, repRank: '3' },
      ),
    ).toEqual([]);
    expect(
      rule.hooks.afterPlay?.(
        context({
          actor: 'p2',
          actorStanding: 2,
          previousWinner: 'p1',
          previousWinnerStanding: 1,
        }),
        { kind: 'single', cards: [], count: 1, repRank: '4' },
      ),
    ).toEqual([]);
  });

  it('最初に上がった本人以外の過去順位は都落ち判定に使わない', () => {
    expect(
      rule.hooks.afterPlay?.(
        context({
          actor: 'p3',
          actorStanding: 1,
          previousWinner: 'p1',
        }),
        { kind: 'single', cards: [], count: 1, repRank: '5' },
      ),
    ).toEqual([{ type: 'forceRank', player: 'p1', rank: 'lowest' }]);
  });

  it('前ゲーム1位のメモリがない初回ゲームでは発動しない', () => {
    expect(
      rule.hooks.afterPlay?.(context({ actor: 'p2', actorStanding: 1 }), {
        kind: 'single',
        cards: [],
        count: 1,
        repRank: '3',
      }),
    ).toEqual([]);
  });

  it('手札が残る未確定の前ゲーム1位にもlowestを指定する', () => {
    const activePreviousWinner = context({
      actor: 'p4',
      actorStanding: 1,
      previousWinner: 'p1',
      previousWinnerStanding: null,
    });

    expect(
      rule.hooks.afterPlay?.(activePreviousWinner, {
        kind: 'single',
        cards: [],
        count: 1,
        repRank: '6',
      }),
    ).toEqual([{ type: 'forceRank', player: 'p1', rank: 'lowest' }]);
  });
});
