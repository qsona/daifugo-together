import { describe, expect, it } from 'vitest';

import { createDeck, type Card } from '../cards/card.js';
import { reduceGame } from '../engine/reducer.js';
import { startGame } from '../game/start-game.js';
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

function fixture(moduleOrModules: RuleModule | RuleModule[]): {
  config: GameConfig;
  state: GameState;
  runtime: RuleRuntime;
} {
  const modules = Array.isArray(moduleOrModules)
    ? moduleOrModules
    : [moduleOrModules];
  const entries: RuleChainEntry[] = modules.map((module, position) => ({
    ruleId: module.meta.ruleId,
    name: module.meta.name,
    position,
    priority: {
      score: 0,
      activatedAt: position,
      ruleId: module.meta.ruleId,
    },
    bundleHash: `choice-fixture-${String(position)}`,
    contractVersion: module.meta.contractVersion,
  }));
  return {
    config: {
      gameIndex: 0,
      seats,
      gameSeed: 'choice-fixture',
      ruleChain: entries,
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
      port: createInProcessRuleChainPort(modules),
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

const secondChoiceRule: RuleModule = {
  meta: {
    ruleId: 'r-choice-second',
    name: 'second choice fixture',
    description: 'second contract v2 choice fixture',
    kind: 'original',
    proposalId: 'choice-fixture-second',
    contractVersion: 2,
    messages: {
      choose_second: '残りのカードを選んでください',
    },
  },
  hooks: {
    afterPlay(context, play, input) {
      if (input?.kind === 'cards' && input.choiceId === 'discard_second') {
        return [
          {
            type: 'moveCards',
            from: { kind: 'hand', player: 'p1' },
            to: { kind: 'discard' },
            cards: { kind: 'specific', cardIds: [...input.cardIds] },
          },
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
          choiceId: 'discard_second',
          from: { kind: 'hand', player: 'p1' },
          cards: { kind: 'all' },
          count: Math.min(2, player.hand.length),
          messageKey: 'choose_second',
        },
      ];
    },
  },
};

const multiPlayerChoiceRule: RuleModule = {
  meta: {
    ruleId: 'r-choice-multi',
    name: 'multi-player choice fixture',
    description: 'contract v2 multi-player choice fixture',
    kind: 'original',
    proposalId: 'choice-fixture-multi',
    contractVersion: 2,
    messages: {
      choose_multi: '自分のカードを選んでください',
    },
  },
  hooks: {
    afterPlay(context, play, input) {
      if (input?.kind === 'cards') {
        const player = input.choiceId.replace('discard_', '');
        return [
          {
            type: 'moveCards',
            from: { kind: 'hand', player },
            to: { kind: 'discard' },
            cards: { kind: 'specific', cardIds: [...input.cardIds] },
          },
        ];
      }
      if (
        !play.cards.some(
          (played) => played.kind === 'natural' && played.rank === '10',
        )
      ) {
        return [];
      }
      const choices = context.game.players
        .filter(({ hand }) => hand.length > 0)
        .map(({ id }) => ({
          player: id,
          choiceId: `discard_${id}`,
          from: { kind: 'hand' as const, player: id },
          cards: { kind: 'all' as const },
          count: 1,
          messageKey: 'choose_multi',
        }));
      const [first, ...additionalChoices] = choices;
      return first
        ? [{ type: 'requestChoice', ...first, additionalChoices }]
        : [];
    },
  },
};

const dynamicPlayerChoiceRule: RuleModule = {
  meta: {
    ruleId: 'r-choice-dynamic-player',
    name: 'dynamic player choice fixture',
    description: 'player choice followed by card choice',
    kind: 'original',
    proposalId: 'choice-fixture-dynamic-player',
    contractVersion: 2,
    messages: { choose_player: '相手', choose_card: 'カード' },
  },
  hooks: {
    afterPlay(_context, play, input) {
      if (input?.kind === 'player' && input.choiceId === 'target') {
        return [
          {
            type: 'requestChoice',
            player: 'p1',
            choiceId: `card_for_${input.playerId}`,
            from: { kind: 'hand', player: 'p1' },
            cards: { kind: 'all' },
            count: 1,
            messageKey: 'choose_card',
          },
        ];
      }
      if (input?.kind === 'cards' && input.choiceId === 'card_for_p2') {
        return [
          {
            type: 'moveCards',
            from: { kind: 'hand', player: 'p1' },
            to: { kind: 'discard' },
            cards: { kind: 'specific', cardIds: [...input.cardIds] },
          },
        ];
      }
      return play.cards.some(
        (card) => card.kind === 'natural' && card.rank === '10',
      )
        ? [
            {
              type: 'requestChoice',
              player: 'p1',
              choiceId: 'target',
              players: ['p2', 'p3'],
              messageKey: 'choose_player',
            },
          ]
        : [];
    },
  },
};

const gameStartChoiceRule: RuleModule = {
  meta: {
    ruleId: 'r-choice-game-start',
    name: 'game-start choice fixture',
    description: 'contract v2 game-start choice fixture',
    kind: 'original',
    proposalId: 'choice-fixture-game-start',
    contractVersion: 2,
    messages: { choose_start: '開始時のカードを選んでください' },
  },
  hooks: {
    onGameStart(context, input) {
      if (input?.kind === 'cards' && input.choiceId === 'start_card') {
        return [
          {
            type: 'moveCards',
            from: { kind: 'hand', player: 'p1' },
            to: { kind: 'discard' },
            cards: { kind: 'specific', cardIds: [...input.cardIds] },
          },
        ];
      }
      const player = context.game.players.find(({ id }) => id === 'p1');
      return player && player.hand.length > 0
        ? [
            {
              type: 'requestChoice',
              player: 'p1',
              choiceId: 'start_card',
              from: { kind: 'hand', player: 'p1' },
              cards: { kind: 'all' },
              count: 1,
              messageKey: 'choose_start',
            },
          ]
        : [];
    },
  },
};

describe('contract v2 rule choices', () => {
  it('onGameStartの選択完了まで最初の手番を開始しない', () => {
    const { config, runtime } = fixture(gameStartChoiceRule);
    const started = startGame(config, runtime);
    const options = started.state.private.pendingChoice?.optionCardIds ?? [];
    const selected = options[0];

    expect(started.rejections).toEqual([]);
    expect(started.state.public.phase).toBe('awaitingChoice');
    expect(started.events.map(({ type }) => type)).toEqual(['gameStarted']);
    expect(started.state.private.pendingChoice).toMatchObject({
      hook: 'onGameStart',
      ruleId: 'r-choice-game-start',
      player: 'p1',
      choiceId: 'start_card',
      count: 1,
    });
    expect(
      started.state.private.hookCalls['r-choice-game-start:onGameStart'],
    ).toBeUndefined();
    expect(selected).toBeDefined();
    if (!selected) return;

    const completed = reduceGame(
      config,
      started.state,
      {
        type: 'ruleInput',
        player: 'p1',
        choiceId: 'start_card',
        cardIds: [selected],
      },
      runtime,
    );

    expect(completed.rejections).toEqual([]);
    expect(completed.state.public.phase).toBe('awaitingPlay');
    expect(completed.state.private.pendingChoice).toBeUndefined();
    expect(completed.state.public.discard.map(({ id }) => id)).toEqual([
      selected,
    ]);
    expect(completed.state.players.p1?.hand).toHaveLength(12);
    expect(
      completed.state.private.hookCalls['r-choice-game-start:onGameStart'],
    ).toBe(1);
  });

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

  it('複数ルールのchoiceを優先順位順に直列化し、各選択後の手札から次の枚数を再計算する', () => {
    const { config, state, runtime } = fixture([choiceRule, secondChoiceRule]);

    const played = reduceGame(
      config,
      state,
      { type: 'play', player: 'p1', cards: ['S10'] },
      runtime,
    );

    expect(played.state.private.pendingChoice).toMatchObject({
      ruleId: 'r-choice',
      choiceId: 'discard',
      count: 1,
    });

    const firstChoice = reduceGame(
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

    expect(firstChoice.rejections).toEqual([]);
    expect(firstChoice.state.public.phase).toBe('awaitingChoice');
    expect(firstChoice.state.public.turn).toBe('p1');
    expect(firstChoice.state.players.p1?.hand.map(({ id }) => id)).toEqual([
      'H04',
    ]);
    expect(firstChoice.state.private.pendingChoice).toMatchObject({
      ruleId: 'r-choice-second',
      choiceId: 'discard_second',
      optionCardIds: ['H04'],
      count: 1,
    });
    expect(firstChoice.state.private.hookCalls['r-choice:afterPlay']).toBe(1);
    expect(
      firstChoice.state.private.hookCalls['r-choice-second:afterPlay'],
    ).toBeUndefined();
    expect(firstChoice.events.some(({ type }) => type === 'turnChanged')).toBe(
      false,
    );

    const secondChoice = reduceGame(
      config,
      firstChoice.state,
      {
        type: 'ruleInput',
        player: 'p1',
        choiceId: 'discard_second',
        cardIds: ['H04'],
      },
      { ...runtime, setMemory: firstChoice.setMemory ?? {} },
    );

    expect(secondChoice.rejections).toEqual([]);
    expect(secondChoice.state.public.phase).toBe('awaitingPlay');
    expect(secondChoice.state.public.turn).toBe('p2');
    expect(secondChoice.state.private.pendingChoice).toBeUndefined();
    expect(secondChoice.state.players.p1?.hand).toEqual([]);
    expect(secondChoice.state.public.discard.map(({ id }) => id)).toEqual([
      'H03',
      'H04',
    ]);
    expect(secondChoice.state.private.hookCalls).toMatchObject({
      'r-choice:afterPlay': 1,
      'r-choice-second:afterPlay': 1,
    });
    expect(
      secondChoice.state.public.history.filter(
        (event) => event.type === 'ruleFired',
      ),
    ).toHaveLength(2);
  });

  it('1ルールで全プレイヤー自身の手札選択を直列化し、完了まで手番を進めない', () => {
    const { config, state, runtime } = fixture(multiPlayerChoiceRule);
    state.players.p2?.hand.push(card('H05'));
    state.players.p3?.hand.push(card('H06'));
    state.players.p4?.hand.push(card('H07'));

    let transition = reduceGame(
      config,
      state,
      { type: 'play', player: 'p1', cards: ['S10'] },
      runtime,
    );

    expect(transition.state.private.pendingChoice).toMatchObject({
      player: 'p1',
      choiceId: 'discard_p1',
      optionCardIds: ['H03', 'H04'],
    });

    const responses = [
      ['p1', 'discard_p1', 'H03'],
      ['p2', 'discard_p2', 'S05'],
      ['p3', 'discard_p3', 'S06'],
      ['p4', 'discard_p4', 'S07'],
    ] as const;
    for (const [player, choiceId, selected] of responses) {
      transition = reduceGame(
        config,
        transition.state,
        { type: 'ruleInput', player, choiceId, cardIds: [selected] },
        { ...runtime, setMemory: transition.setMemory ?? {} },
      );
      expect(transition.rejections).toEqual([]);
      if (player !== 'p4') {
        expect(transition.state.public.phase).toBe('awaitingChoice');
        expect(
          transition.events.some(({ type }) => type === 'turnChanged'),
        ).toBe(false);
      }
    }

    expect(transition.state.public.phase).toBe('awaitingPlay');
    expect(transition.state.public.turn).toBe('p2');
    expect(transition.state.private.pendingChoice).toBeUndefined();
    expect(transition.state.public.discard.map(({ id }) => id)).toEqual([
      'H03',
      'S05',
      'S06',
      'S07',
    ]);
    expect(transition.state.players.p1?.hand.map(({ id }) => id)).toEqual([
      'H04',
    ]);
    expect(transition.state.players.p2?.hand.map(({ id }) => id)).toEqual([
      'H05',
    ]);
  });

  it('プレイヤー選択の応答から同じルールのカード選択へ進み、完了後だけ手番を進める', () => {
    const { config, state, runtime } = fixture(dynamicPlayerChoiceRule);
    let transition = reduceGame(
      config,
      state,
      { type: 'play', player: 'p1', cards: ['S10'] },
      runtime,
    );
    expect(transition.state.private.pendingChoice).toMatchObject({
      kind: 'player',
      player: 'p1',
      choiceId: 'target',
      optionPlayerIds: ['p2', 'p3'],
    });

    transition = reduceGame(
      config,
      transition.state,
      { type: 'ruleInput', player: 'p1', choiceId: 'target', playerId: 'p2' },
      runtime,
    );
    expect(transition.rejections).toEqual([]);
    expect(transition.state.public.phase).toBe('awaitingChoice');
    expect(transition.state.private.pendingChoice).toMatchObject({
      kind: 'cards',
      choiceId: 'card_for_p2',
      optionCardIds: ['H03', 'H04'],
    });

    transition = reduceGame(
      config,
      transition.state,
      {
        type: 'ruleInput',
        player: 'p1',
        choiceId: 'card_for_p2',
        cardIds: ['H03'],
      },
      { ...runtime, setMemory: transition.setMemory ?? {} },
    );
    expect(transition.rejections).toEqual([]);
    expect(transition.state.public.phase).toBe('awaitingPlay');
    expect(transition.state.public.turn).toBe('p2');
    expect(transition.state.public.discard.map(({ id }) => id)).toEqual([
      'H03',
    ]);
  });
});
