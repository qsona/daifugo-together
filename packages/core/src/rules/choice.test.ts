import { describe, expect, it } from 'vitest';

import { createDeck, type Card } from '../cards/card.js';
import { reduceGame } from '../engine/reducer.js';
import type { GameConfig, GameState } from '../game/types.js';
import { seedRng } from '../rng/rng.js';
import { buildPlayerSnapshot } from '../snapshot/snapshot.js';
import type { RuleRuntime } from './chain.js';
import type { RuleChainEntry, RuleModule } from './contract.js';
import { createInProcessRuleChainPort } from './in-process.js';

const seats = ['p1', 'p2', 'p3', 'p4'];

function card(id: string): Card {
  const found = createDeck().find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing card ${id}`);
  return found;
}

function fixture(module: RuleModule): {
  config: GameConfig;
  state: GameState;
  runtime: RuleRuntime;
} {
  const entry: RuleChainEntry = {
    ruleId: module.meta.ruleId,
    name: module.meta.name,
    position: 0,
    priority: {
      score: 0,
      activatedAt: 0,
      ruleId: module.meta.ruleId,
    },
    bundleHash: 'choice-fixture',
    contractVersion: module.meta.contractVersion,
  };
  return {
    config: {
      gameIndex: 0,
      seats,
      gameSeed: 'choice-fixture',
      ruleChain: [entry],
    },
    state: {
      public: {
        phase: 'awaitingPlay',
        direction: 1,
        turn: 'p1',
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
        rng: seedRng('choice-fixture'),
        hookCalls: {},
      },
      players: {
        p1: {
          id: 'p1',
          hand: [card('S10'), card('H03'), card('H04')],
          status: 'active',
          skipCount: 0,
        },
        p2: {
          id: 'p2',
          hand: [card('S05')],
          status: 'active',
          skipCount: 0,
        },
        p3: {
          id: 'p3',
          hand: [card('S06')],
          status: 'active',
          skipCount: 0,
        },
        p4: {
          id: 'p4',
          hand: [card('S07')],
          status: 'active',
          skipCount: 0,
        },
      },
    },
    runtime: {
      port: createInProcessRuleChainPort([module]),
      setHistory: [],
      setMemory: {},
    },
  };
}

const choiceRule: RuleModule = {
  meta: {
    ruleId: 'r-choice',
    name: 'choice fixture',
    description: 'contract v2 choice fixture',
    kind: 'original',
    proposalId: 'choice-fixture',
    contractVersion: 2,
    messages: {
      choose: 'カードを選んでください',
      fired: 'カードを移動しました',
    },
  },
  hooks: {
    afterPlay(context, play, input) {
      if (input?.kind === 'cards' && input.choiceId === 'discard') {
        return [
          {
            type: 'moveCards',
            from: { kind: 'hand', player: 'p1' },
            to: { kind: 'discard' },
            cards: { kind: 'specific', cardIds: [...input.cardIds] },
          },
          { type: 'announce', messageKey: 'fired' },
        ];
      }
      if (
        !play.cards.some(
          (played) => played.kind === 'natural' && played.rank === '10',
        )
      ) {
        return [];
      }
      const player = context.game.players.find(({ id }) => id === 'p1');
      if (!player || player.hand.length === 0) return [];
      return [
        {
          type: 'requestChoice',
          player: 'p1',
          choiceId: 'discard',
          from: { kind: 'hand', player: 'p1' },
          cards: { kind: 'all' },
          count: 1,
          messageKey: 'choose',
        },
      ];
    },
  },
};

describe('contract v2 rule choices', () => {
  it('プレイを確定して追加入力を待ち、応答後に同じafterPlayを完了する', () => {
    const { config, state, runtime } = fixture(choiceRule);

    const played = reduceGame(
      config,
      state,
      { type: 'play', player: 'p1', cards: ['S10'] },
      runtime,
    );

    expect(played.rejections).toEqual([]);
    expect(played.state.public.phase).toBe('awaitingChoice');
    expect(played.state.public.turn).toBe('p1');
    expect(played.state.private.pendingChoice).toMatchObject({
      ruleId: 'r-choice',
      player: 'p1',
      choiceId: 'discard',
      optionCardIds: ['H03', 'H04'],
      count: 1,
    });
    expect(
      played.state.private.hookCalls['r-choice:afterPlay'],
    ).toBeUndefined();
    expect(played.events.map(({ type }) => type)).toEqual(['played']);
    const snapshotContext = {
      setId: 'choice-set',
      setPhase: { name: 'gameInProgress' as const, gameIndex: 0 },
      members: seats.map((id) => ({ id, displayName: id, isAI: false })),
      setResults: [],
    };
    expect(
      buildPlayerSnapshot(
        config,
        played.state,
        snapshotContext,
        'p1',
        runtime,
      ).pendingChoice?.cards.map(({ id }) => id),
    ).toEqual(['H03', 'H04']);
    expect(
      buildPlayerSnapshot(config, played.state, snapshotContext, 'p2', runtime)
        .pendingChoice,
    ).toMatchObject({ cards: [] });

    const invalid = reduceGame(
      config,
      played.state,
      {
        type: 'ruleInput',
        player: 'p1',
        choiceId: 'discard',
        cardIds: ['S10'],
      },
      runtime,
    );
    expect(invalid.rejections[0]?.code).toBe('INVALID_RULE_CHOICE');
    expect(invalid.state).toBe(played.state);

    const completed = reduceGame(
      config,
      played.state,
      {
        type: 'ruleInput',
        player: 'p1',
        choiceId: 'discard',
        cardIds: ['H03'],
      },
      runtime,
    );

    expect(completed.rejections).toEqual([]);
    expect(completed.state.public.phase).toBe('awaitingPlay');
    expect(completed.state.public.turn).toBe('p2');
    expect(completed.state.private.pendingChoice).toBeUndefined();
    expect(completed.state.players.p1?.hand.map(({ id }) => id)).toEqual([
      'H04',
    ]);
    expect(completed.state.public.discard.map(({ id }) => id)).toEqual(['H03']);
    expect(completed.events.some(({ type }) => type === 'cardsMoved')).toBe(
      true,
    );
    expect(completed.events.some(({ type }) => type === 'ruleFired')).toBe(
      true,
    );
    expect(completed.state.private.hookCalls['r-choice:afterPlay']).toBe(1);
  });

  it('contract v1 ruleのrequestChoiceを拒否して入力待ちへ遷移しない', () => {
    const v1Rule: RuleModule = {
      ...choiceRule,
      meta: { ...choiceRule.meta, ruleId: 'r-choice-v1', contractVersion: 1 },
    };
    const { config, state, runtime } = fixture(v1Rule);

    const transition = reduceGame(
      config,
      state,
      { type: 'play', player: 'p1', cards: ['S10'] },
      runtime,
    );

    expect(transition.state.public.phase).toBe('awaitingPlay');
    expect(transition.state.private.pendingChoice).toBeUndefined();
    expect(
      transition.events.some(
        (event) =>
          event.type === 'effectRejected' &&
          event.detail &&
          JSON.stringify(event.detail).includes('contract-version'),
      ),
    ).toBe(true);
  });
});
