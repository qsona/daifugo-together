import type {
  GameResult,
  PlayerId,
  RuleContext,
  RuleModule,
  Standing,
} from '@daifugo/core';
import { describe, expect, it, vi } from 'vitest';

const { rule } = (await vi.importActual('./rule.js')) as { rule: RuleModule };

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

function context(input?: {
  history?: GameResult[];
  gameMemory?: Record<string, unknown>;
}): RuleContext {
  return {
    contractVersion: 2,
    game: {
      ruleIds: [rule.meta.ruleId],
      seats: [...players],
      direction: 1,
      turn: 'p1',
      players: players.map((id) => ({
        id,
        hand: [],
        status: 'active',
        standing: null,
      })),
      field: { passedSinceLastPlay: [] },
      discard: [],
      history: [],
    },
    setHistory: input?.history ?? [previousGame()],
    memory: { game: input?.gameMemory ?? {}, set: {} },
    rng: { next: () => 0, int: () => 0 },
  } as unknown as RuleContext;
}

describe('ギロチン時計', () => {
  it('meta.jsonと同じメタデータを公開する', () => {
    expect(rule.meta).toEqual({
      ruleId: 'r0033-guillotine-clock',
      name: 'ギロチン時計',
      description:
        '初回ゲームでは発動しない。2ゲーム目以降の開始時、前ゲームの大貧民が4〜12からNを選ぶ。そのゲームで全員通算N回目の通常パスをしたプレイヤーを直ちに最低順位へ強制する。skipTurnsによる自動スキップは数えない。',
      kind: 'local',
      proposalId: '01M079JQC6AC0JMCXNY9Y1BYZ0',
      contractVersion: 2,
      messages: {
        choose_count: '何回目のパスで大貧民にしますか？',
        count_set: '{count}回目のパスで大貧民！',
        triggered: 'ギロチン時計！ {count}回目のパスで大貧民！',
      },
    });
  });

  it('初回ゲームでは選択を要求せず、パスも数えない', () => {
    const firstGame = context({ history: [] });
    expect(rule.hooks.onGameStart?.(firstGame)).toEqual([]);
    expect(rule.hooks.afterPass?.(firstGame, { player: 'p2' })).toEqual([]);
  });

  it('直前の大貧民へ4〜12、既定値8の整数選択を要求する', () => {
    expect(
      rule.hooks.onGameStart?.(
        context({ history: [previousGame(['p3', 'p1', 'p4', 'p2'])] }),
      ),
    ).toEqual([
      {
        type: 'requestChoice',
        kind: 'integer',
        player: 'p2',
        choiceId: 'pass_count',
        min: 4,
        max: 12,
        defaultValue: 8,
        messageKey: 'choose_count',
      },
    ]);
  });

  it('選ばれたNをゲームメモリへ保存して全員へ通知する', () => {
    expect(
      rule.hooks.onGameStart?.(context(), {
        kind: 'integer',
        choiceId: 'pass_count',
        value: 9,
      }),
    ).toEqual([
      {
        type: 'setMemory',
        scope: 'game',
        key: 'target',
        value: 9,
        silent: true,
      },
      {
        type: 'announce',
        messageKey: 'count_set',
        params: { count: '9' },
      },
    ]);
  });

  it('範囲外または別の入力では確定せず選択を再要求する', () => {
    expect(
      rule.hooks.onGameStart?.(context(), {
        kind: 'integer',
        choiceId: 'pass_count',
        value: 13,
      }),
    ).toMatchObject([{ type: 'requestChoice', min: 4, max: 12 }]);
    expect(
      rule.hooks.onGameStart?.(context(), {
        kind: 'integer',
        choiceId: 'other',
        value: 8,
      }),
    ).toMatchObject([{ type: 'requestChoice', choiceId: 'pass_count' }]);
  });

  it('通常パスをプレイヤー横断で数え、N未満では順位を変えない', () => {
    expect(
      rule.hooks.afterPass?.(context({ gameMemory: { target: 6, count: 3 } }), {
        player: 'p3',
      }),
    ).toEqual([
      {
        type: 'setMemory',
        scope: 'game',
        key: 'count',
        value: 4,
        silent: true,
      },
    ]);
  });

  it('全員通算N回目にパスした本人を最低順位へ強制して通知する', () => {
    expect(
      rule.hooks.afterPass?.(context({ gameMemory: { target: 4, count: 3 } }), {
        player: 'p1',
      }),
    ).toEqual([
      {
        type: 'setMemory',
        scope: 'game',
        key: 'count',
        value: 4,
        silent: true,
      },
      {
        type: 'setMemory',
        scope: 'game',
        key: 'triggered',
        value: true,
        silent: true,
      },
      { type: 'forceRank', player: 'p1', rank: 'lowest' },
      {
        type: 'announce',
        messageKey: 'triggered',
        params: { count: '4' },
      },
    ]);
  });

  it('発動済みのゲームでは後続パスで再発動しない', () => {
    expect(
      rule.hooks.afterPass?.(
        context({ gameMemory: { target: 4, count: 4, triggered: true } }),
        { player: 'p2' },
      ),
    ).toEqual([]);
  });

  it('次ゲームではゲームメモリを引き継がず新しいNを選ぶ', () => {
    expect(
      rule.hooks.onGameStart?.(
        context({ history: [previousGame(['p4', 'p3', 'p2', 'p1'], 1)] }),
      ),
    ).toMatchObject([{ type: 'requestChoice', player: 'p1', defaultValue: 8 }]);
  });
});
