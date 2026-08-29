import {
  BASE_STRENGTH_ORDER,
  type Card,
  type Play,
  type PlayerStatus,
  type RuleContext,
} from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { rule } from './rule.js';

function naturalCard(id: string, rank: '2' | '3' | '4' | '5'): Card {
  return { kind: 'natural', id, suit: 'spade', rank };
}

const naturalTwo = naturalCard('S02', '2');

function play(cards: Card[], repRank: Play['repRank']): Play {
  return {
    kind: cards.length === 1 ? 'single' : 'set',
    cards,
    count: cards.length,
    repRank,
  };
}

interface PlayerFixture {
  id: string;
  status?: PlayerStatus;
  hand?: Card[];
}

function context(
  players: PlayerFixture[] = [
    { id: 'p1', hand: [naturalCard('S03', '3')] },
    { id: 'p2', hand: [naturalCard('S04', '4')] },
  ],
  playedBy = 'p1',
): RuleContext {
  return {
    contractVersion: 2,
    game: {
      gameIndex: 7,
      seats: players.map(({ id }) => id),
      ruleIds: [],
      direction: 1,
      turn: 'p2',
      players: players.map(({ id, status = 'active', hand = [] }) => ({
        id,
        status,
        hand,
        standing: status === 'active' ? null : 1,
      })),
      field: {
        current: { play: play([naturalTwo], '2'), by: playedBy },
        passedSinceLastPlay: [],
      },
      discard: [],
      history: [],
      strength: { ranking: [...BASE_STRENGTH_ORDER.ranking] },
    },
    setHistory: [],
    memory: { game: {}, set: {} },
    rng: {
      next: () => 0.5,
      int: () => 23,
    },
  };
}

const afterPlay = rule.hooks.afterPlay!;

describe('r0031-binary-quiz', () => {
  it('meta.json と同じメタデータを公開する', () => {
    expect(rule.meta).toEqual({
      ruleId: 'r0031-binary-quiz',
      name: '2択クイズ',
      description:
        '自然な2を1枚だけ出すと、出した人を含む退場していない全プレイヤーで二択クイズを行う。1問4秒で未回答はAとし、正解者全員に1点を与える。3点へ同じ問題で到達した全員を勝者とし、各勝者は手札から最大3枚を選んで捨てる。',
      kind: 'original',
      proposalId: '01KZG805WWSPYW8P0MBRGSRD8A',
      contractVersion: 2,
      messages: {
        binary_quiz_start: '二択クイズを開始します',
        binary_quiz_discard: '勝者は捨てるカードを選んでください',
      },
    });
  });

  it('自然な2の単体出しで承認済み設定の二択クイズを開始する', () => {
    const result = afterPlay(
      context([
        { id: 'p1', status: 'finished' },
        { id: 'p2' },
        { id: 'p3', status: 'finished' },
        { id: 'p4', status: 'retired' },
      ]),
      play([naturalTwo], '2'),
    );

    expect(result).toEqual([
      {
        type: 'requestChoice',
        kind: 'miniGame',
        player: 'p1',
        choiceId: 'binary_quiz',
        miniGame: 'binary_quiz_race',
        participants: ['p1', 'p2'],
        questionSet: 'general_v1',
        defaultOption: 'a',
        roundDurationMs: 4_000,
        targetScore: 3,
        maxRounds: 12,
        seed: 'binary-quiz:7:23',
        messageKey: 'binary_quiz_start',
      },
    ]);
  });

  it('退場していない4人全員を参加者にする', () => {
    const result = afterPlay(
      context([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }]),
      play([naturalTwo], '2'),
    );

    expect(result[0]).toMatchObject({
      type: 'requestChoice',
      participants: ['p1', 'p2', 'p3', 'p4'],
    });
  });

  it.each([
    {
      name: '自然な2を含む複数枚',
      played: play([naturalTwo, naturalCard('H02', '2')], '2'),
    },
    {
      name: 'ジョーカーによる2の代用',
      played: play([{ kind: 'joker', id: 'JK0', index: 0 }], '2'),
    },
    {
      name: '2を含まない単体',
      played: play([naturalCard('S03', '3')], '3'),
    },
  ])('$name では発動しない', ({ played }) => {
    expect(afterPlay(context(), played)).toEqual([]);
  });

  it('同着勝者全員について最大3枚の選択を要求し、0枚の勝者は飛ばす', () => {
    const result = afterPlay(
      context([
        {
          id: 'p1',
          hand: [
            naturalCard('S03', '3'),
            naturalCard('S04', '4'),
            naturalCard('S05', '5'),
            naturalCard('H03', '3'),
          ],
        },
        {
          id: 'p2',
          hand: [naturalCard('H04', '4'), naturalCard('H05', '5')],
        },
        { id: 'p3', hand: [] },
        {
          id: 'p4',
          hand: [
            naturalCard('D03', '3'),
            naturalCard('D04', '4'),
            naturalCard('D05', '5'),
          ],
        },
      ]),
      play([naturalTwo], '2'),
      {
        kind: 'miniGameMultiResult',
        choiceId: 'binary_quiz',
        miniGameId: 'binary_quiz_race',
        winnerPlayerIds: ['p1', 'p2', 'p3', 'p4'],
        scores: { p1: { score: 3 }, p2: { score: 3 } },
      },
    );

    expect(result).toEqual([
      {
        type: 'requestChoice',
        player: 'p1',
        choiceId: 'binary_quiz_discard:p1',
        from: { kind: 'hand', player: 'p1' },
        cards: { kind: 'all' },
        count: 3,
        messageKey: 'binary_quiz_discard',
        additionalChoices: [
          {
            player: 'p2',
            choiceId: 'binary_quiz_discard:p2',
            from: { kind: 'hand', player: 'p2' },
            cards: { kind: 'all' },
            count: 2,
            messageKey: 'binary_quiz_discard',
          },
          {
            player: 'p4',
            choiceId: 'binary_quiz_discard:p4',
            from: { kind: 'hand', player: 'p4' },
            cards: { kind: 'all' },
            count: 3,
            messageKey: 'binary_quiz_discard',
          },
        ],
      },
    ]);
  });

  it('各勝者の回答カードだけを本人の手札から捨て札へ移す', () => {
    expect(
      afterPlay(context(), play([naturalTwo], '2'), {
        kind: 'cards',
        choiceId: 'binary_quiz_discard:p2',
        cardIds: ['S04'],
      }),
    ).toEqual([
      {
        type: 'moveCards',
        from: { kind: 'hand', player: 'p2' },
        to: { kind: 'discard' },
        cards: { kind: 'specific', cardIds: ['S04'] },
      },
    ]);
  });

  it('無関係な選択結果では何もしない', () => {
    expect(
      afterPlay(context(), play([naturalTwo], '2'), {
        kind: 'cards',
        choiceId: 'other-rule-choice',
        cardIds: ['S04'],
      }),
    ).toEqual([]);
  });
});
