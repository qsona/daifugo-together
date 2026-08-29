import type {
  CardRank,
  GameConfig,
  GameResult,
  GameState,
  NaturalCard,
  PlayerId,
  RuleContext,
  RuleModule,
  RuleRuntime,
  Standing,
} from '@daifugo/core';
import {
  createInProcessRuleChainPort,
  reduceGame,
  seedRng,
} from '@daifugo/core';
import { describe, expect, it, vi } from 'vitest';

const { rule } = (await vi.importActual('./rule.js')) as { rule: RuleModule };
const { rule: miyakoOchiRule } = (await vi.importActual(
  '../r0009-miyako-ochi/rule.js',
)) as { rule: RuleModule };
const { rule: noFinishWithTwoRule } = (await vi.importActual(
  '../r0004-no-finish-with-two/rule.js',
)) as { rule: RuleModule };

const players = ['p1', 'p2', 'p3', 'p4'] as const;

function previousGame(
  order: readonly PlayerId[] = players,
  gameIndex = 0,
): GameResult {
  return {
    gameIndex,
    standings: order.map((player, index) => ({
      player,
      standing: (index + 1) as Standing,
      title: ['大富豪', '富豪', '貧民', '大貧民'][index] as
        '大富豪' | '富豪' | '貧民' | '大貧民',
    })),
    firedRuleIds: [],
  };
}

function context(input: {
  actor: PlayerId;
  actorStanding: Standing | null;
  history?: GameResult[];
}): RuleContext {
  return {
    game: {
      field: {
        current: {
          by: input.actor,
          play: { kind: 'single', cards: [], count: 1, repRank: '3' },
        },
        passedSinceLastPlay: [],
      },
      players: players.map((id) => ({
        id,
        standing: id === input.actor ? input.actorStanding : null,
      })),
    },
    setHistory: input.history ?? [previousGame()],
    memory: { game: {}, set: {} },
  } as unknown as RuleContext;
}

function expectedEffects(actor: PlayerId = 'p4') {
  return [
    {
      type: 'forceRank' as const,
      player: 'p2',
      rank: 3 as const,
      when: { player: actor, standing: 1 as const },
    },
    {
      type: 'forceRank' as const,
      player: 'p3',
      rank: 2 as const,
      when: { player: actor, standing: 1 as const },
    },
  ];
}

function natural(player: PlayerId, rank: CardRank): NaturalCard {
  return {
    kind: 'natural',
    id: `${player}-${rank}`,
    suit: 'spade',
    rank,
  };
}

function runFinish(finishingRank: CardRank) {
  const modules = [rule, miyakoOchiRule, noFinishWithTwoRule];
  const gameSeed = `gekokujo-${finishingRank}`;
  const config: GameConfig = {
    gameIndex: 1,
    seats: [...players],
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
    })),
  };
  const state: GameState = {
    public: {
      phase: 'awaitingPlay',
      direction: 1,
      turn: 'p4',
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
        hand: [natural('p1', '4')],
        status: 'active',
        skipCount: 0,
      },
      p2: {
        id: 'p2',
        hand: [natural('p2', '5')],
        status: 'active',
        skipCount: 0,
      },
      p3: {
        id: 'p3',
        hand: [natural('p3', '6')],
        status: 'active',
        skipCount: 0,
      },
      p4: {
        id: 'p4',
        hand: [natural('p4', finishingRank)],
        status: 'active',
        skipCount: 0,
      },
    },
  };
  const runtime: RuleRuntime = {
    port: createInProcessRuleChainPort(modules),
    setHistory: [previousGame()],
    setMemory: {
      [miyakoOchiRule.meta.ruleId]: { previousWinner: 'p1' },
    },
  };

  return reduceGame(
    config,
    state,
    { type: 'play', player: 'p4', cards: [`p4-${finishingRank}`] },
    runtime,
  );
}

describe('下剋上', () => {
  it('直前の大貧民が正常な1位になると富豪を3位、貧民を2位にする', () => {
    expect(
      rule.hooks.afterPlay?.(context({ actor: 'p4', actorStanding: 1 }), {
        kind: 'single',
        cards: [],
        count: 1,
        repRank: '3',
      }),
    ).toEqual(expectedEffects());
  });

  it('都落ちと組み合わせて大貧民を1位、大富豪を最下位に確定する', () => {
    const transition = runFinish('3');

    expect(transition.rejections).toEqual([]);
    expect(
      players.map((player) => transition.state.players[player]?.standing),
    ).toEqual([4, 3, 2, 1]);
    expect(transition.state.public.firedRules).toContain(rule.meta.ruleId);
    expect(transition.state.public.firedRules).toContain(
      miyakoOchiRule.meta.ruleId,
    );
  });

  it('直前の大貧民以外が最初にあがっても発動しない', () => {
    expect(
      rule.hooks.afterPlay?.(context({ actor: 'p3', actorStanding: 1 }), {
        kind: 'single',
        cards: [],
        count: 1,
        repRank: '3',
      }),
    ).toEqual([]);
  });

  it('2あがりの反則で1位を失う場合は順位を入れ替えない', () => {
    const transition = runFinish('2');

    expect(transition.rejections).toEqual([]);
    expect(transition.state.players.p4?.standing).toBe(4);
    expect(transition.state.players.p2?.standing).toBeUndefined();
    expect(transition.state.players.p3?.standing).toBeUndefined();
    expect(transition.state.public.firedRules).not.toContain(rule.meta.ruleId);
  });

  it('初回ゲームでは発動しない', () => {
    expect(
      rule.hooks.afterPlay?.(
        context({ actor: 'p4', actorStanding: 1, history: [] }),
        { kind: 'single', cards: [], count: 1, repRank: '3' },
      ),
    ).toEqual([]);
  });

  it('2ゲーム以上の履歴があっても直前の順位だけを参照する', () => {
    const older = previousGame(['p4', 'p1', 'p2', 'p3'], 0);
    const latest = previousGame(['p1', 'p2', 'p3', 'p4'], 1);

    expect(
      rule.hooks.afterPlay?.(
        context({
          actor: 'p4',
          actorStanding: 1,
          history: [older, latest],
        }),
        { kind: 'single', cards: [], count: 1, repRank: '3' },
      ),
    ).toEqual(expectedEffects());
    expect(
      rule.hooks.afterPlay?.(
        context({
          actor: 'p3',
          actorStanding: 1,
          history: [older, latest],
        }),
        { kind: 'single', cards: [], count: 1, repRank: '3' },
      ),
    ).toEqual([]);
  });
});
