import {
  BASE_STRENGTH_ORDER,
  createInProcessRuleChainPort,
  DIAMOND_THREE_ID,
  reduceGame,
  startGame,
  type GameConfig,
  type GameResult,
  type RuleChainEntry,
  type RuleContext,
  type RuleRuntime,
} from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { rule } from './rule.js';

const seats = ['p1', 'p2', 'p3', 'p4'];
const STARTING_GUN_RULE_ID = 'r0021-starting-gun';

function previousGame(champion = 'p1'): GameResult {
  const others = seats.filter((player) => player !== champion);
  return {
    gameIndex: 0,
    standings: [champion, ...others].map((player, index) => ({
      player,
      standing: (index + 1) as 1 | 2 | 3 | 4,
      title: ['大富豪', '富豪', '貧民', '大貧民'][index] as
        '大富豪' | '富豪' | '貧民' | '大貧民',
    })),
    firedRuleIds: [],
  };
}

function context({
  history = [previousGame()],
  ruleIds = [rule.meta.ruleId],
}: {
  history?: GameResult[];
  ruleIds?: string[];
} = {}): RuleContext {
  return {
    contractVersion: 1,
    game: {
      gameIndex: history.length,
      ruleIds,
      seats,
      direction: 1,
      turn: 'p1',
      players: seats.map((id) => ({
        id,
        hand: [],
        status: 'active',
        standing: null,
      })),
      field: { passedSinceLastPlay: [] },
      discard: [],
      history: [],
      strength: BASE_STRENGTH_ORDER,
    },
    setHistory: history,
    memory: { game: {}, set: {} },
    rng: { next: () => 0, int: () => 0 },
  } as RuleContext;
}

function entry(ruleId: string, position = 0): RuleChainEntry {
  return {
    ruleId,
    name: ruleId,
    position,
    priority: {
      score: 0,
      activatedAt: 0,
      ruleId,
    },
    bundleHash: 'fixture',
    contractVersion: 1,
  };
}

function runtime(): RuleRuntime {
  return {
    port: createInProcessRuleChainPort([rule]),
    setHistory: [previousGame()],
    setMemory: {},
  };
}

function startedWithFirstPlayer(firstPlayer: string) {
  for (let index = 0; index < 100; index += 1) {
    const config: GameConfig = {
      gameIndex: 1,
      seats,
      gameSeed: `daifugo-no-yoyu-${String(index)}`,
      ruleChain: [entry(rule.meta.ruleId)],
    };
    const started = startGame(config, runtime());
    const gameStarted = started.events.find(
      (event) => event.type === 'gameStarted',
    );
    if (gameStarted?.firstPlayer === firstPlayer) return { config, started };
  }
  throw new Error(`seed for ${firstPlayer} was not found`);
}

describe('大富豪の余裕', () => {
  it('前ゲーム1位の最初の手番を1回だけ飛ばすEffectを返す', () => {
    expect(rule.hooks.onGameStart?.(context())).toEqual([
      { type: 'skipTurns', player: 'p1', count: 1 },
    ]);
  });

  it('前ゲーム1位以外にはskipTurnsを返さない', () => {
    expect(
      rule.hooks.onGameStart?.(context({ history: [previousGame('p3')] })),
    ).toEqual([{ type: 'skipTurns', player: 'p3', count: 1 }]);
  });

  it('初回ゲームでは発動しない', () => {
    expect(rule.hooks.onGameStart?.(context({ history: [] }))).toEqual([]);
  });

  it('号砲が同じゲームで有効なら発動しない', () => {
    expect(
      rule.hooks.onGameStart?.(
        context({ ruleIds: [rule.meta.ruleId, STARTING_GUN_RULE_ID] }),
      ),
    ).toEqual([]);
  });

  it('前ゲーム1位が開始プレイヤーなら開始手番を消化して次の人へ進める', () => {
    const { started } = startedWithFirstPlayer('p1');

    expect(started.state.public.turn).toBe('p2');
    expect(started.state.players.p1?.skipCount).toBe(0);
    expect(started.events).toContainEqual({ type: 'passed', player: 'p1' });
  });

  it('前ゲーム1位が後続なら最初に回る手番だけを飛ばし、次の手番は通常どおり迎える', () => {
    const { config, started } = startedWithFirstPlayer('p4');
    const diamondThree = started.state.players.p4?.hand.find(
      ({ id }) => id === DIAMOND_THREE_ID,
    );
    if (!diamondThree) throw new Error('opening card was not found');

    const opening = reduceGame(
      config,
      started.state,
      { type: 'play', player: 'p4', cards: [diamondThree.id] },
      runtime(),
    );
    expect(opening.events).toContainEqual({ type: 'passed', player: 'p1' });
    expect(opening.state.players.p1?.skipCount).toBe(0);
    expect(opening.state.public.turn).toBe('p2');

    const p2Pass = reduceGame(
      config,
      opening.state,
      { type: 'pass', player: 'p2' },
      runtime(),
    );
    const p3Pass = reduceGame(
      config,
      p2Pass.state,
      { type: 'pass', player: 'p3' },
      runtime(),
    );
    expect(p3Pass.state.public.turn).toBe('p4');

    const nextLead = p3Pass.state.players.p4?.hand[0];
    if (!nextLead) throw new Error('next lead card was not found');
    const nextRound = reduceGame(
      config,
      p3Pass.state,
      { type: 'play', player: 'p4', cards: [nextLead.id] },
      runtime(),
    );
    expect(nextRound.state.public.turn).toBe('p1');
  });
});
