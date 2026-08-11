import { describe, expect, it } from 'vitest';

import { executeEffectHook } from '../engine/effects.js';
import type { GameAction, GameConfig, SnapshotContext } from '../game/types.js';
import { startGame } from '../game/start-game.js';
import type { Play } from '../play/play.js';
import type { RuleChainEntry, RuleModule } from '../rules/contract.js';
import { createInProcessRuleChainPort } from '../rules/in-process.js';
import {
  compileTrustedSimulationRulePlan,
  createTrustedSimulationRuleChainPort,
} from '../rules/trusted-simulation.js';
import { createSimulationApi } from './api.js';

const seats = ['p1', 'p2', 'p3', 'p4'];

const modules: RuleModule[] = [
  {
    meta: {
      ruleId: 'r9001-fast-eight-cut',
      name: 'fast-eight-cut',
      description: 'trusted simulation fixture',
      kind: 'original',
      proposalId: 'fixture-fast-eight-cut',
      contractVersion: 1,
      messages: {},
    },
    hooks: {
      afterPlay(_context, play) {
        return play.cards.some(
          (card) => card.kind === 'natural' && card.rank === '8',
        )
          ? [{ type: 'clearField' }]
          : [];
      },
    },
  },
  {
    meta: {
      ruleId: 'r9002-fast-eleven-back',
      name: 'fast-eleven-back',
      description: 'trusted simulation fixture',
      kind: 'original',
      proposalId: 'fixture-fast-eleven-back',
      contractVersion: 1,
      messages: {},
    },
    hooks: {
      modifyStrength(context, base) {
        return context.memory.game.active === true
          ? { ...base, ranking: [...base.ranking].reverse() }
          : base;
      },
      afterPlay(context, play) {
        return play.cards.some(
          (card) => card.kind === 'natural' && card.rank === 'J',
        ) && context.memory.game.active !== true
          ? [
              {
                type: 'setMemory',
                scope: 'game',
                key: 'active',
                value: true,
              },
            ]
          : [];
      },
      afterFieldClear(context) {
        return context.memory.game.active === true
          ? [
              {
                type: 'setMemory',
                scope: 'game',
                key: 'active',
                value: false,
                silent: true,
              },
            ]
          : [];
      },
    },
  },
  {
    meta: {
      ruleId: 'r9003-fast-legality',
      name: 'fast-legality',
      description: 'trusted simulation fixture',
      kind: 'original',
      proposalId: 'fixture-fast-legality',
      contractVersion: 1,
      messages: { blocked: 'blocked' },
    },
    hooks: {
      modifyLegality(_context, play, base) {
        return base.legal && play.kind === 'set' && play.repRank === 'Q'
          ? { legal: false, reasonKey: 'blocked' }
          : base;
      },
    },
  },
];

const ruleChain: RuleChainEntry[] = modules.map((module, position) => ({
  ruleId: module.meta.ruleId,
  name: module.meta.name,
  position,
  priority: { score: 0, activatedAt: 0, ruleId: module.meta.ruleId },
  bundleHash: `fixture-${module.meta.ruleId}`,
  contractVersion: module.meta.contractVersion,
}));

const snapshotContext: SnapshotContext = {
  setId: 'trusted-simulation',
  setPhase: { name: 'gameInProgress', gameIndex: 0 },
  members: seats.map((id) => ({ id, displayName: id, isAI: true })),
  setResults: [],
};

describe('trusted simulation rule path', () => {
  it('盤面依存で不正になるchoice要求は高速経路でも棄却する', () => {
    const choiceModule: RuleModule = {
      meta: {
        ruleId: 'r9004-fast-choice-validation',
        name: 'fast-choice-validation',
        description: 'trusted simulation choice fixture',
        kind: 'original',
        proposalId: 'fixture-fast-choice-validation',
        contractVersion: 2,
        messages: { choose: 'choose' },
      },
      hooks: {
        afterPlay(context) {
          const player = context.game.turn ?? context.game.seats[0]!;
          return [
            {
              type: 'requestChoice',
              player,
              choiceId: 'dynamic_choice',
              from: { kind: 'hand', player },
              cards: { kind: 'all' },
              count: 1,
              messageKey: 'choose',
              additionalChoices: [],
              simultaneous: true,
            },
          ];
        },
      },
    };
    const choiceEntry: RuleChainEntry = {
      ruleId: choiceModule.meta.ruleId,
      name: choiceModule.meta.name,
      position: 0,
      priority: {
        score: 0,
        activatedAt: 0,
        ruleId: choiceModule.meta.ruleId,
      },
      bundleHash: 'fixture-fast-choice-validation',
      contractVersion: 2,
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'fast-choice-validation',
      ruleChain: [choiceEntry],
    };
    const safePort = createInProcessRuleChainPort([choiceModule]);
    const fastPort = createTrustedSimulationRuleChainPort(
      compileTrustedSimulationRulePlan([choiceEntry], [choiceModule]),
    );
    const started = startGame(config, {
      port: safePort,
      setHistory: [],
      setMemory: {},
    });
    const actor = started.state.public.turn!;
    const card = started.state.players[actor]!.hand[0]!;
    const played: Play = {
      kind: 'single',
      cards: [card],
      count: 1,
      repRank: card.kind === 'natural' ? card.rank : 'joker',
    };
    const safe = executeEffectHook(
      config,
      started.state,
      { port: safePort, setHistory: [], setMemory: {} },
      'afterPlay',
      played,
      undefined,
      { previewChoice: true },
    );
    const fast = executeEffectHook(
      config,
      started.state,
      { port: fastPort, setHistory: [], setMemory: {} },
      'afterPlay',
      played,
      undefined,
      { previewChoice: true },
    );

    expect(fast).toEqual(safe);
    expect(fast.choiceRequests).toBeUndefined();
    expect(fastPort.disabledRuleIds?.()).toEqual([choiceModule.meta.ruleId]);
  });

  it.each(['diff-a', 'diff-b', 'diff-c'])(
    'safe経路と高速経路が複数の到達盤面で一致する: %s',
    (seed) => {
      const config: GameConfig = {
        gameIndex: 0,
        seats,
        gameSeed: seed,
        ruleChain,
      };
      const safeRuntime = {
        port: createInProcessRuleChainPort(modules),
        setHistory: [],
        setMemory: {},
      };
      const fastRuntime = {
        port: createTrustedSimulationRuleChainPort(
          compileTrustedSimulationRulePlan(ruleChain, modules),
        ),
        setHistory: [],
        setMemory: {},
      };
      const initial = startGame(config, safeRuntime);
      const safe = createSimulationApi({
        config,
        snapshotContext,
        runtime: safeRuntime,
      });
      const fast = createSimulationApi({
        config,
        snapshotContext,
        runtime: fastRuntime,
      });
      let safePosition = safe.createPosition(
        initial.state,
        initial.setMemory ?? {},
      );
      let fastPosition = fast.createPosition(
        initial.state,
        initial.setMemory ?? {},
      );

      for (let step = 0; step < 80; step += 1) {
        expect(fastPosition).toEqual(safePosition);
        if (safe.isTerminal(safePosition)) break;
        const player = safePosition.state.public.turn;
        if (!player) throw new Error('reachable state has no turn');
        const safeLegal = safe.enumerateLegalPlaysWithStrength(
          safePosition,
          player,
        );
        const fastLegal = fast.enumerateLegalPlaysWithStrength(
          fastPosition,
          player,
        );
        expect(fastLegal).toEqual(safeLegal);
        const selected =
          safeLegal.plays[(step * 7 + seed.length) % safeLegal.plays.length];
        const action: GameAction = selected
          ? {
              type: 'play',
              player,
              cards: selected.cards.map((card) => card.id),
            }
          : { type: 'pass', player };
        const safeResult = safe.applyPlay(safePosition, action);
        const fastResult = fast.applyPlay(fastPosition, action);
        expect(fastResult.events).toEqual(safeResult.events);
        safePosition = safeResult.position;
        fastPosition = fastResult.position;
      }

      expect(fastPosition).toEqual(safePosition);
      expect(fast.isTerminal(fastPosition)).toEqual(
        safe.isTerminal(safePosition),
      );
    },
  );
});
