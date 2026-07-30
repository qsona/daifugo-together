import type {
  PlayerId,
  RuleContext,
  RuleModule,
  Standings,
  Standing,
} from '@daifugo/core';
import { describe, expect, it, vi } from 'vitest';

const { rule } = (await vi.importActual('./rule.js')) as { rule: RuleModule };

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
