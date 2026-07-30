import { describe, expect, it } from 'vitest';

import { reduceGame } from '../engine/reducer.js';
import { startGame } from '../game/start-game.js';
import type { RuleRuntime } from './chain.js';
import type { RuleChainEntry, RuleMeta, RuleModule } from './contract.js';
import { createInProcessRuleChainPort } from './in-process.js';

function meta(ruleId: string, name: string): RuleMeta {
  return {
    ruleId,
    name,
    description: `${name} fixture`,
    kind: 'local',
    proposalId: 'fixture',
    contractVersion: 1,
    messages: {},
  };
}

const yagiri: RuleModule = {
  meta: meta('r-fixture-yagiri', '8切り'),
  hooks: {
    afterPlay: (_context, play) =>
      play.repRank === '8' ? [{ type: 'clearField' }] : [],
  },
};

const revolution: RuleModule = {
  meta: meta('r-fixture-revolution', '革命'),
  hooks: {
    modifyStrength: (context, base) =>
      context.memory.game.active === true
        ? { ranking: [...base.ranking].reverse() }
        : base,
    afterPlay: (_context, play) =>
      play.count === 4
        ? [
            {
              type: 'setMemory',
              scope: 'game',
              key: 'active',
              value: true,
            },
          ]
        : [],
  },
};

const miyakoOchi: RuleModule = {
  meta: meta('r-fixture-miyako-ochi', '都落ち'),
  hooks: {
    afterPlay: (context) => {
      const previousChampion = context.setHistory
        .at(-1)
        ?.standings.find((result) => result.standing === 1)?.player;
      return previousChampion &&
        context.game.players.some(
          (player) => player.status === 'finished' && player.standing === 1,
        )
        ? [{ type: 'forceRank', player: previousChampion, rank: 4 }]
        : [];
    },
  },
};

const suitBind: RuleModule = {
  meta: meta('r-fixture-suit-bind', 'スート縛り'),
  hooks: {
    modifyLegality: (context, play, base) => {
      const fieldFirst = context.game.field.current?.play.cards[0];
      const fieldSuit =
        fieldFirst?.kind === 'natural' ? fieldFirst.suit : undefined;
      if (
        base.legal &&
        fieldSuit &&
        play.cards.some(
          (card) => card.kind === 'natural' && card.suit !== fieldSuit,
        )
      ) {
        return { legal: false, reasonKey: 'fixture.suit-bind' };
      }
      return base;
    },
  },
};

const fixtures = [yagiri, revolution, miyakoOchi, suitBind];

function entry(module: RuleModule, position: number): RuleChainEntry {
  return {
    ruleId: module.meta.ruleId,
    name: module.meta.name,
    position,
    priority: {
      score: 0,
      activatedAt: Date.parse('2026-07-26T00:00:00.000Z'),
      ruleId: module.meta.ruleId,
    },
    bundleHash: 'fixture',
    contractVersion: 1,
  };
}

describe('GE-04 contract fixture independence', () => {
  it('8切り・革命・都落ち・スート縛りを全16部分集合で独立構成できる', () => {
    for (let mask = 0; mask < 1 << fixtures.length; mask += 1) {
      const enabled = fixtures.filter(
        (_module, index) => (mask & (1 << index)) !== 0,
      );
      const ruleChain = enabled.map(entry);
      const config = {
        gameIndex: 0,
        seats: ['p1', 'p2', 'p3', 'p4'],
        gameSeed: `fixture-subset-${mask}`,
        ruleChain,
      };
      const runtime: RuleRuntime = {
        port: createInProcessRuleChainPort(enabled),
        setHistory: [],
        setMemory: {},
      };
      const started = startGame(config, runtime);
      const player = started.state.public.turn;
      const card = player ? started.state.players[player]?.hand[0] : undefined;
      if (!player || !card) {
        throw new Error('Expected an opening play');
      }

      const transition = reduceGame(
        config,
        started.state,
        { type: 'play', player, cards: [card.id] },
        runtime,
      );

      expect(transition.rejections, `subset mask ${mask}`).toEqual([]);
    }
  });
});
