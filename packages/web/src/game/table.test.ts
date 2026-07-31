import type { PlayerRoomView } from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import {
  cardDiscardNotices,
  finalPlay,
  hasPendingFieldClear,
  tableSeats,
} from './table';

const EIGHT = {
  kind: 'natural',
  id: 'S08',
  suit: 'spade',
  rank: '8',
} as const;

/** 自分(席0)が 8 を出し、ルールで場が流れた直後のスナップショット。 */
function roomAfterEightCut(): PlayerRoomView {
  return {
    v: 7,
    roomId: 'room-1',
    inviteCode: '01234',
    mode: 'community',
    phase: 'playing',
    members: [
      {
        memberId: 'me',
        seatId: 0,
        displayName: 'ホスト',
        isAI: false,
        isHost: true,
        connected: true,
        aiActing: false,
        departed: false,
        handCount: 3,
        finishedRank: null,
        wantsNextSet: null,
      },
    ],
    you: { memberId: 'me', seatId: 0 },
    activeRules: [{ ruleId: 'r0001-eight-cut', name: '8切り' }],
    game: {
      gameNo: 1,
      status: 'playing',
      intermission: null,
      field: { cards: [], playedBySeat: null, passedSeats: [] },
      turn: { seat: 0, turnSeq: 4, deadlineAt: null },
      history: [
        { t: 'played', seat: 0, cards: [EIGHT], kind: 'single' },
        { t: 'ruleFired', ruleId: 'r0001-eight-cut', messageKey: null },
        { t: 'fieldCleared', reason: 'rule', nextLeaderSeat: 0 },
        { t: 'turnChanged', seat: 0 },
      ],
      previousResults: [],
      yourHand: [],
      legalMoves: null,
    },
    setResult: null,
    events: [],
  } as unknown as PlayerRoomView;
}

describe('hasPendingFieldClear', () => {
  it('直近のプレイより後ろにfieldClearedがあれば真', () => {
    expect(hasPendingFieldClear(roomAfterEightCut())).toBe(true);
  });

  it('プレイのあとにfieldClearedが無ければ偽', () => {
    const room = roomAfterEightCut();
    room.game!.history = [
      { t: 'played', seat: 0, cards: [EIGHT], kind: 'single' },
    ];
    expect(hasPendingFieldClear(room)).toBe(false);
  });

  it('全員パスによるfieldClearedはルール発動の保持対象にしない', () => {
    const room = roomAfterEightCut();
    room.game!.history = [
      { t: 'played', seat: 0, cards: [EIGHT], kind: 'single' },
      { t: 'fieldCleared', reason: 'allPassed', nextLeaderSeat: 0 },
    ];
    expect(hasPendingFieldClear(room)).toBe(false);
  });
});

describe('tableSeats', () => {
  it('既定では場が流れた状態（札なし）を描く', () => {
    expect(tableSeats(roomAfterEightCut())[0]!.plays).toEqual([]);
  });

  it('keepClearedFieldでは直近のプレイより後ろのfieldClearedを無視して札を残す', () => {
    const seats = tableSeats(roomAfterEightCut(), { keepClearedField: true });
    expect(seats[0]!.plays.at(-1)?.map((card) => card.id)).toEqual(['S08']);
  });

  it('保持対象の履歴位置を指定すると後続プレイではなく対象の札を残す', () => {
    const room = roomAfterEightCut();
    room.game!.history.push(
      {
        t: 'played',
        seat: 0,
        cards: [{ ...EIGHT, id: 'H09', suit: 'heart', rank: '9' }],
        kind: 'single',
      },
      { t: 'fieldCleared', reason: 'rule', nextLeaderSeat: 0 },
    );
    const seats = tableSeats(room, { heldPlayedHistoryIndex: 0 });
    expect(seats[0]!.plays.at(-1)?.map((card) => card.id)).toEqual(['S08']);
  });

  it('禁止あがりで順位が修正された場合は確定順位と称号を表示する', () => {
    const room = roomAfterEightCut();
    room.members[0]!.finishedRank = 4;
    room.game!.history = [
      { t: 'playerFinished', seat: 0, rank: 1, title: '大富豪' },
    ];

    expect(tableSeats(room)[0]).toMatchObject({
      finishedRank: 4,
      finishedTitle: '大貧民',
    });
  });
});

describe('cardDiscardNotices', () => {
  it('公開されたhand→discardの札と実行者を表示用に整える', () => {
    const room = roomAfterEightCut();
    room.activeRules = [{ ruleId: 'r0010-ten-discard', name: '10捨て' }];
    room.game!.history.push({
      t: 'cardsMoved',
      ruleId: 'r0010-ten-discard',
      fromSeat: 0,
      to: 'discard',
      count: 1,
      cards: [
        {
          kind: 'natural',
          id: 'H07',
          suit: 'heart',
          rank: '7',
        },
      ],
    });

    expect(cardDiscardNotices(room)).toEqual([
      {
        id: '1:4',
        ruleName: '10捨て',
        playerName: 'あなた',
        cards: [{ id: 'H07', suit: 'heart', rank: '7' }],
      },
    ]);
  });

  it('非公開のhand→hand移動は告知しない', () => {
    const room = roomAfterEightCut();
    room.game!.history.push({
      t: 'cardsMoved',
      ruleId: 'hidden-transfer',
      fromSeat: 0,
      to: 'hand',
      count: 1,
      cards: null,
    });

    expect(cardDiscardNotices(room)).toEqual([]);
  });
});

describe('finalPlay', () => {
  it('ゲーム間リザルトでは履歴の最後のプレイを返す', () => {
    const room = roomAfterEightCut();
    room.game!.status = 'intermission';
    room.game!.history = [
      { t: 'played', seat: 0, cards: [EIGHT], kind: 'single' },
      { t: 'playerFinished', seat: 0, rank: 1, title: '大富豪' },
      {
        t: 'gameEnded',
        standings: [{ seat: 0, rank: 1, title: '大富豪' }],
      },
    ];

    expect(finalPlay(room)).toEqual({
      seat: 0,
      cards: [{ id: 'S08', suit: 'spade', rank: '8' }],
    });
  });

  it('最終戦のセットリザルトでは直前イベントのプレイを返す', () => {
    const room = roomAfterEightCut();
    room.phase = 'setResult';
    room.game = null;
    room.setResult = {
      setId: 'set-1',
      standings: [],
      finalGame: {
        gameNo: 3,
        standings: [],
        firedRuleIds: [],
      },
      firedRules: [],
      respondBy: 1_000,
    };
    room.events = [
      { seq: 1, t: 'played', seat: 0, cards: [EIGHT] },
      { seq: 2, t: 'gameEnded' },
    ];

    expect(finalPlay(room)).toEqual({
      seat: 0,
      cards: [{ id: 'S08', suit: 'spade', rank: '8' }],
    });
  });
});
