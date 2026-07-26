import { describe, expect, it } from 'vitest';

import type { GameConfig, GameState } from '../game/types.js';
import { startGame } from '../game/start-game.js';
import { reduceGame } from '../engine/reducer.js';
import { NO_RULE_CHAIN_PORT, type RuleRuntime } from './chain.js';
import type { RuleChainEntry, RuleModule } from './contract.js';
import { createInProcessRuleChainPort } from './in-process.js';

const ruleEntry: RuleChainEntry = {
  ruleId: 'r0001-yagiri',
  name: '8切り',
  position: 0,
  priority: {
    popularityScore: 0,
    activatedAt: '2026-07-26T00:00:00.000Z',
    ruleId: 'r0001-yagiri',
  },
  bundleHash: 'fixture',
  contractVersion: 1,
};

const yagiri: RuleModule = {
  meta: {
    ruleId: ruleEntry.ruleId,
    name: ruleEntry.name,
    description: '8を出すと場が流れる',
    kind: 'local',
    proposalId: 'fixture',
    contractVersion: 1,
    messages: {
      fired: '8切り!',
    },
  },
  hooks: {
    afterPlay: (_context, play) =>
      play.repRank === '8'
        ? [{ type: 'clearField' }, { type: 'announce', messageKey: 'fired' }]
        : [],
  },
};

function stateWithEight(config: GameConfig): {
  state: GameState;
  player: string;
  cardId: string;
} {
  const state = startGame(config).state;
  const player = config.seats.find((id) =>
    state.players[id]?.hand.some((card) => card.rank === '8'),
  );
  const card = player
    ? state.players[player]?.hand.find((candidate) => candidate.rank === '8')
    : undefined;
  if (!player || !card) {
    throw new Error('Expected an eight');
  }
  return {
    state: {
      ...state,
      public: {
        ...state.public,
        turn: player,
        field: { passedSinceLastPlay: [] },
      },
    },
    player,
    cardId: card.id,
  };
}

describe('GE-04 independent rule modules', () => {
  it('8切りルールの有効・無効で同じプレイの挙動が変わる', () => {
    const enabledConfig: GameConfig = {
      gameIndex: 0,
      seats: ['p1', 'p2', 'p3', 'p4'],
      gameSeed: 'rules',
      ruleChain: [ruleEntry],
    };
    const prepared = stateWithEight(enabledConfig);
    const enabledRuntime: RuleRuntime = {
      port: createInProcessRuleChainPort([yagiri]),
      setHistory: [],
      setMemory: {},
    };

    const enabled = reduceGame(
      enabledConfig,
      prepared.state,
      {
        type: 'play',
        player: prepared.player,
        cards: [prepared.cardId],
      },
      enabledRuntime,
    );
    expect(enabled.state.public.field.current).toBeUndefined();
    expect(enabled.events).toContainEqual({
      type: 'ruleFired',
      ruleId: ruleEntry.ruleId,
      messageKey: 'fired',
    });
    expect(enabled.state.public.firedRules).toContain(ruleEntry.ruleId);

    const disabledConfig = { ...enabledConfig, ruleChain: [] };
    const disabled = reduceGame(
      disabledConfig,
      prepared.state,
      {
        type: 'play',
        player: prepared.player,
        cards: [prepared.cardId],
      },
      {
        port: NO_RULE_CHAIN_PORT,
        setHistory: [],
        setMemory: {},
      },
    );
    expect(disabled.state.public.field.current?.play.repRank).toBe('8');
    expect(disabled.events.some((event) => event.type === 'ruleFired')).toBe(
      false,
    );
  });

  it('登録されていないルールIDは呼び出さず基本進行を続ける', () => {
    const config: GameConfig = {
      gameIndex: 0,
      seats: ['p1', 'p2', 'p3', 'p4'],
      gameSeed: 'missing-rule',
      ruleChain: [ruleEntry],
    };
    const prepared = stateWithEight(config);
    const transition = reduceGame(
      config,
      prepared.state,
      {
        type: 'play',
        player: prepared.player,
        cards: [prepared.cardId],
      },
      {
        port: createInProcessRuleChainPort([]),
        setHistory: [],
        setMemory: {},
      },
    );
    expect(transition.rejections).toEqual([]);
    expect(transition.state.public.field.current?.play.repRank).toBe('8');
  });
});
