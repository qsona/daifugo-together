import type {
  Card,
  Play,
  PlayerId,
  RuleContext,
  StrengthOrder,
} from '@daifugo/core';
import { BASE_STRENGTH_ORDER } from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { rule } from './rule.js';

const natural = (rank: string, id: string): Card => ({
  kind: 'natural',
  id,
  suit: 'spade',
  rank: rank as '2' | '3' | '4' | '5',
});

const joker = (index: 0 | 1): Card => ({
  kind: 'joker',
  id: `JK${String(index)}`,
  index,
});

const protectedHands = (): Record<PlayerId, Card[]> => ({
  p1: [natural('2', 'S02'), natural('2', 'H02'), joker(0)],
  p2: [natural('3', 'S03')],
  p3: [natural('2', 'C02'), natural('2', 'D02'), joker(1)],
  p4: [natural('4', 'S04')],
});

interface Incident {
  active: true;
  champion: PlayerId;
  targets: [PlayerId, PlayerId];
  cardIds: string[];
  clears: number;
}

const incident = (clears = 0): Incident => ({
  active: true,
  champion: 'p2',
  targets: ['p1', 'p3'],
  cardIds: ['C02', 'D02', 'H02', 'JK0', 'JK1', 'S02'],
  clears,
});

function context(
  options: {
    previousGame?: boolean;
    hands?: Record<PlayerId, Card[]>;
    memory?: Incident;
    actor?: PlayerId;
    strength?: StrengthOrder;
  } = {},
): RuleContext {
  const hands = options.hands ?? protectedHands();
  return {
    contractVersion: 2,
    game: {
      gameIndex: options.previousGame === false ? 0 : 1,
      ruleIds: [rule.meta.ruleId],
      seats: ['p1', 'p2', 'p3', 'p4'],
      direction: 1,
      turn: 'p1',
      players: ['p1', 'p2', 'p3', 'p4'].map((id) => ({
        id,
        hand: hands[id] ?? [],
        status: 'active' as const,
        standing: null,
      })),
      field: {
        ...(options.actor
          ? {
              current: {
                by: options.actor,
                play: {
                  kind: 'single' as const,
                  cards: [],
                  count: 1,
                  repRank: '3' as const,
                },
              },
            }
          : {}),
        passedSinceLastPlay: [],
      },
      discard: [],
      history: [],
      strength: options.strength ?? { ...BASE_STRENGTH_ORDER },
    },
    setHistory:
      options.previousGame === false
        ? []
        : [
            {
              gameIndex: 0,
              standings: [
                { player: 'p1', standing: 2, title: '富豪' },
                { player: 'p2', standing: 1, title: '大富豪' },
                { player: 'p3', standing: 3, title: '貧民' },
                { player: 'p4', standing: 4, title: '大貧民' },
              ],
              firedRuleIds: [],
            },
          ],
    memory: {
      game: options.memory ? { incident: options.memory } : {},
      set: {},
    },
    rng: { next: () => 0, int: () => 0 },
  } as RuleContext;
}

function play(...cards: Card[]): Play {
  return {
    kind: cards.length === 1 ? 'single' : 'set',
    cards,
    count: cards.length,
    repRank: cards[0]?.kind === 'joker' ? 'joker' : (cards[0]?.rank ?? '3'),
  };
}

const startedEffects = [
  {
    type: 'setMemory',
    scope: 'game',
    key: 'incident',
    value: incident(),
    silent: true,
  },
  {
    type: 'announce',
    messageKey: 'started',
    players: ['p1', 'p3'],
  },
];

describe('大富豪殺人事件', () => {
  it('meta.jsonと同じメタデータを持つ', () => {
    expect(rule.meta).toEqual({
      ruleId: 'r0016-daifugo-murder-case',
      name: '大富豪殺人事件',
      description:
        'カード交換完了時、前局の大富豪の左右に座る2人が、使用中のすべての2とジョーカーを共同で持っていれば事件を開始する。手札やカードの内訳は公開せず、対象の2人だけに、2とジョーカーを出さないまま場を3回流すという遂行条件を通知する。3回目の場流れまで対象カードを保持し続けた場合、前局の大富豪をその瞬間に都落ちと同じ扱いで大貧民に確定する。対象の2人のどちらかがそれ以前に2またはジョーカーを出した場合は失敗する。',
      kind: 'local',
      proposalId: '01KZ1A27HRD444CRKCF8118HAS',
      contractVersion: 2,
      messages: {
        started:
          '大富豪殺人事件が始まりました。2とジョーカーを出さずに、場を3回流してください。',
        succeeded: '大富豪殺人事件！ 大富豪は大貧民になりました。',
        failed: '大富豪殺人事件は未遂に終わりました。',
      },
    });
  });

  it('初回ゲームでは発動しない', () => {
    expect(rule.hooks.onGameStart?.(context({ previousGame: false }))).toEqual(
      [],
    );
  });

  it('前局大富豪の両隣が使用中の全2と全ジョーカーを共同所持すると両者だけに通知する', () => {
    expect(rule.hooks.onGameStart?.(context())).toEqual(startedEffects);
  });

  it('2またはジョーカーを両隣以外が1枚でも持つ場合は発動しない', () => {
    const hands = protectedHands();
    hands.p4?.push(hands.p1?.shift() as Card);

    expect(rule.hooks.onGameStart?.(context({ hands }))).toEqual([]);
  });

  it('革命中でも表記が2のカードを対象者が出すと失敗する', () => {
    const two = natural('2', 'S02');
    const hands = protectedHands();
    hands.p1 = hands.p1?.filter(({ id }) => id !== two.id) ?? [];
    const inverted: StrengthOrder = {
      ranking: [...BASE_STRENGTH_ORDER.ranking].reverse(),
      revolution: true,
    };

    expect(
      rule.hooks.afterPlay?.(
        context({ hands, memory: incident(), actor: 'p1', strength: inverted }),
        play(two),
      ),
    ).toEqual([
      {
        type: 'setMemory',
        scope: 'game',
        key: 'incident',
        value: { ...incident(), active: false, outcome: 'failed' },
        silent: true,
      },
      {
        type: 'announce',
        messageKey: 'failed',
        players: ['p1', 'p3'],
      },
    ]);
  });

  it('対象者がジョーカーを出しても失敗する', () => {
    const playedJoker = joker(1);
    const hands = protectedHands();
    hands.p3 = hands.p3?.filter(({ id }) => id !== playedJoker.id) ?? [];

    expect(
      rule.hooks.afterPlay?.(
        context({ hands, memory: incident(), actor: 'p3' }),
        play(playedJoker),
      ),
    ).toEqual([
      {
        type: 'setMemory',
        scope: 'game',
        key: 'incident',
        value: { ...incident(), active: false, outcome: 'failed' },
        silent: true,
      },
      {
        type: 'announce',
        messageKey: 'failed',
        players: ['p1', 'p3'],
      },
    ]);
  });

  it('対象カードが別のプレイヤーへ移動していた場合も失敗する', () => {
    const hands = protectedHands();
    hands.p4?.push(hands.p1?.shift() as Card);

    expect(
      rule.hooks.afterPlay?.(
        context({ hands, memory: incident(), actor: 'p4' }),
        play(natural('5', 'S05')),
      ),
    ).toEqual([
      {
        type: 'setMemory',
        scope: 'game',
        key: 'incident',
        value: { ...incident(), active: false, outcome: 'failed' },
        silent: true,
      },
      {
        type: 'announce',
        messageKey: 'failed',
        players: ['p1', 'p3'],
      },
    ]);
  });

  it.each([0, 1])('%s回目の場流れでは回数だけを更新する', (clears) => {
    expect(
      rule.hooks.afterFieldClear?.(context({ memory: incident(clears) })),
    ).toEqual([
      {
        type: 'setMemory',
        scope: 'game',
        key: 'incident',
        value: incident(clears + 1),
        silent: true,
      },
    ]);
  });

  it('3回目の場流れで前局大富豪を直ちにlowestへ確定し、成功を公開する', () => {
    expect(
      rule.hooks.afterFieldClear?.(context({ memory: incident(2) })),
    ).toEqual([
      {
        type: 'setMemory',
        scope: 'game',
        key: 'incident',
        value: {
          ...incident(3),
          active: false,
          outcome: 'succeeded',
        },
        silent: true,
      },
      { type: 'forceRank', player: 'p2', rank: 'lowest' },
      { type: 'announce', messageKey: 'succeeded' },
      {
        type: 'announce',
        messageKey: 'succeeded',
        players: ['p1', 'p3'],
      },
    ]);
  });

  it('3回目の場流れ時点で対象カードを保持していなければ失敗する', () => {
    const hands = protectedHands();
    hands.p4?.push(hands.p3?.shift() as Card);

    expect(
      rule.hooks.afterFieldClear?.(context({ hands, memory: incident(2) })),
    ).toEqual([
      {
        type: 'setMemory',
        scope: 'game',
        key: 'incident',
        value: { ...incident(2), active: false, outcome: 'failed' },
        silent: true,
      },
      {
        type: 'announce',
        messageKey: 'failed',
        players: ['p1', 'p3'],
      },
    ]);
  });
});
