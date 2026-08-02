import type {
  Card,
  CardRank,
  GameConfig,
  GameState,
  NaturalCard,
  PlayerId,
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
const { rule: eightCutRule } = (await vi.importActual(
  '../r0001-eight-cut/rule.js',
)) as { rule: RuleModule };
const { rule: jokerRule } = (await vi.importActual(
  '../r0006-two-jokers-all-mighty/rule.js',
)) as { rule: RuleModule };

function context(input: {
  actor: PlayerId;
  actorStanding: Standing | null;
  previousWinner?: PlayerId;
  previousWinnerStanding?: Standing | null;
}): RuleContext {
  const ids = ['p1', 'p2', 'p3', 'p4'];
  return {
    game: {
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

function natural(rank: CardRank): NaturalCard {
  return {
    kind: 'natural',
    id: `spade-${rank}`,
    suit: 'spade',
    rank,
  };
}

const joker: Card = { kind: 'joker', id: 'joker-0', index: 0 };

function miyakoEffect(actor: PlayerId, previousWinner = 'p1') {
  return {
    type: 'forceRank' as const,
    player: previousWinner,
    rank: 'lowest' as const,
    when: { player: actor, standing: 1 as const },
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

function runFoulFinish(foulRule: RuleModule, finishingCard: Card) {
  const modules = [rule, foulRule];
  const gameSeed = `foul-finish-${foulRule.meta.ruleId}`;
  const config: GameConfig = {
    gameIndex: 1,
    seats: ['p1', 'p2', 'p3', 'p4'],
    gameSeed,
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
      ...(module.meta.engineFeatures
        ? { engineFeatures: module.meta.engineFeatures }
        : {}),
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
      rng: seedRng(gameSeed),
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
        hand: [finishingCard],
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

  return reduceGame(
    config,
    state,
    { type: 'play', player: 'p2', cards: [finishingCard.id] },
    runtime,
  );
}

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
    ).toEqual([miyakoEffect('p2')]);
  });

  it.each([
    ['8あがり', eightCutRule, natural('8')],
    ['2あがり', noFinishWithTwoRule, natural('2')],
    ['ジョーカーあがり', jokerRule, joker],
  ])('%sの反則負けでは都落ちを発動しない', (_name, foulRule, card) => {
    const transition = runFoulFinish(foulRule, card);

    expect(transition.rejections).toEqual([]);
    expect(transition.state.players.p2?.standing).toBe(4);
    expect(transition.state.players.p1?.standing).toBeUndefined();
    expect(transition.state.players.p1?.status).toBe('active');
    expect(transition.state.public.firedRules).toContain(foulRule.meta.ruleId);
    expect(transition.state.public.firedRules).not.toContain(rule.meta.ruleId);
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
    ).toEqual([miyakoEffect('p3')]);
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
    ).toEqual([miyakoEffect('p4')]);
  });
});
