import type { PlayerRoomView } from '@daifugo/core';

import type { CardView } from '../components/Card';
import type { TableSeat } from '../components/Table';
import type { SeatFinish } from '../screens/GameScreen';

export function cards(
  cards: PlayerRoomView['game'] extends null
    ? never
    : NonNullable<PlayerRoomView['game']>['yourHand'],
): CardView[] {
  return cards.map((card) =>
    card.kind === 'joker'
      ? {
          id: card.id,
          rank: 'JOKER',
          // 2 枚のジョーカーを支援技術で区別できるようにする。
          label: `ジョーカー${String(card.index + 1)}`,
        }
      : { id: card.id, suit: card.suit, rank: card.rank },
  );
}

export type FinalPlay = {
  seat: number;
  cards: CardView[];
};

/**
 * 対局終了時に最後の人が出した手。
 *
 * 第1・2戦の終了時は game.history に残っている。最終戦はサーバーが
 * そのまま setResult へ進むため game が無く、直前の room.events を使う。
 */
export function finalPlay(room: PlayerRoomView): FinalPlay | null {
  const isGameEnd =
    room.game?.status === 'intermission' ||
    (room.phase === 'setResult' &&
      room.setResult?.finalGame !== null &&
      room.setResult?.finalGame !== undefined);
  if (!isGameEnd) return null;

  type HistoryPlayed = Extract<
    NonNullable<PlayerRoomView['game']>['history'][number],
    { t: 'played' }
  >;
  type RoomPlayed = Extract<PlayerRoomView['events'][number], { t: 'played' }>;
  const historyPlayed = room.game?.history.findLast(
    (event): event is HistoryPlayed => event.t === 'played',
  );
  const roomPlayed = room.events.findLast(
    (event): event is RoomPlayed => event.t === 'played',
  );
  const played = historyPlayed ?? roomPlayed;
  if (!played) return null;

  return { seat: played.seat, cards: cards(played.cards) };
}

/**
 * この戦であがった人を、あがった順に。
 * 履歴は戦ごとなので、`gameStarted` が来たら積み直す。
 */
export function seatFinishes(room: PlayerRoomView): SeatFinish[] {
  const game = room.game;
  if (!game) return [];
  const bySeat = new Map(
    room.members.flatMap((member) =>
      member.seatId === null ? [] : ([[member.seatId, member]] as const),
    ),
  );
  let finishes: SeatFinish[] = [];
  for (const event of game.history) {
    if (event.t === 'gameStarted') {
      finishes = [];
    } else if (event.t === 'playerFinished') {
      const member = bySeat.get(event.seat);
      finishes.push({
        seat: event.seat,
        name:
          member?.memberId === room.you.memberId
            ? 'あなた'
            : (member?.displayName ?? `席${String(event.seat + 1)}`),
        isSelf: member?.memberId === room.you.memberId,
        rank: event.rank,
        title: event.title,
      });
    }
  }
  return finishes;
}

/**
 * 直近のプレイより後ろに fieldCleared があるか。
 * カットインの再生中はここが真のあいだ場の札を残し、
 * カットインが引いてから流す。
 */
export function hasPendingFieldClear(room: PlayerRoomView): boolean {
  return pendingFieldClearPlayIndex(room) !== null;
}

/**
 * 直近の fieldCleared が消したプレイの履歴位置。
 * 発動ボレーをキューへ積む時点でこの値を保存し、後続 snapshot が届いても
 * 別のプレイを誤って保持・flush しないための識別子にする。
 */
export function pendingFieldClearPlayIndex(
  room: PlayerRoomView,
): number | null {
  const history = room.game?.history ?? [];
  const lastPlayed = history.findLastIndex((event) => event.t === 'played');
  if (lastPlayed < 0) return null;
  return history
    .slice(lastPlayed + 1)
    .some((event) => event.t === 'fieldCleared' && event.reason === 'rule')
    ? lastPlayed
    : null;
}

export function tableSeats(
  room: PlayerRoomView,
  options: {
    keepClearedField?: boolean;
    heldPlayedHistoryIndex?: number | null;
  } = {},
): TableSeat[] {
  const game = room.game;
  if (!game || room.you.seatId === null) return [];
  const heldPlayedHistoryIndex =
    options.heldPlayedHistoryIndex ??
    (options.keepClearedField ? pendingFieldClearPlayIndex(room) : null);
  const visibleHistory =
    heldPlayedHistoryIndex === null
      ? game.history
      : game.history.slice(0, heldPlayedHistoryIndex + 1);
  const plays = new Map<number, CardView[][]>();
  for (const event of visibleHistory) {
    if (event.t === 'gameStarted') {
      plays.clear();
    } else if (event.t === 'fieldCleared') {
      plays.clear();
    } else if (event.t === 'played') {
      plays.set(event.seat, [
        ...(plays.get(event.seat) ?? []),
        cards(event.cards),
      ]);
    }
  }
  const finished = new Map(
    seatFinishes(room).map((finish) => [finish.seat, finish] as const),
  );
  const bySeat = new Map(
    room.members.flatMap((member) =>
      member.seatId === null ? [] : ([[member.seatId, member]] as const),
    ),
  );
  return [0, 1, 2, 3].map((offset) => {
    const seat = ((room.you.seatId! + offset) % 4) as 0 | 1 | 2 | 3;
    const member = bySeat.get(seat);
    const finish = finished.get(seat);
    const status = member?.isAI
      ? game.turn?.seat === seat
        ? '考え中…'
        : undefined
      : member?.departed
        ? '退出(AI代行)'
        : !member?.connected || member.aiActing
          ? '切断中(AI代行)'
          : undefined;
    return {
      name:
        member?.memberId === room.you.memberId
          ? 'あなた'
          : (member?.displayName ?? `席${String(seat + 1)}`),
      isSelf: member?.memberId === room.you.memberId,
      handCount: member?.handCount ?? 0,
      isCurrentTurn: game.turn?.seat === seat,
      hasPassed: game.field.passedSeats.includes(seat),
      kind: member?.isAI ? 'ai' : 'human',
      ...(status ? { status } : {}),
      // 履歴に playerFinished が無くても、スナップショットの順位だけは拾う。
      finishedRank: finish?.rank ?? member?.finishedRank ?? null,
      ...(finish ? { finishedTitle: finish.title } : {}),
      plays: plays.get(seat) ?? [],
    };
  });
}
