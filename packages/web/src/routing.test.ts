import { describe, expect, it } from 'vitest';

import {
  parseRoomRoute,
  roomPath,
  screenFromPathname,
  screenPath,
} from './routing';

describe('画面ルーティング', () => {
  it('通常画面を往復変換する', () => {
    expect(screenPath('menu')).toBe('/menu');
    expect(screenPath('proposal')).toBe('/proposals/new');
    expect(screenPath('myProposals')).toBe('/proposals/mine');
    expect(screenFromPathname('/rules')).toBe('ruleDex');
    expect(screenFromPathname('/proposals/new/')).toBe('proposal');
  });

  it('部屋URLから表示画面とroomIdを復元する', () => {
    expect(screenFromPathname('/rooms/room-1/game')).toBe('game');
    expect(parseRoomRoute('/rooms/room%201/set-result')).toEqual({
      roomId: 'room 1',
      view: 'set-result',
    });
  });

  it('サーバースナップショットのフェーズを部屋URLにする', () => {
    const waiting = {
      roomId: 'room/1',
      phase: 'waiting',
    } as import('@daifugo/core').PlayerRoomView;
    const playing = {
      roomId: 'room-1',
      phase: 'playing',
      game: { status: 'playing' },
    } as import('@daifugo/core').PlayerRoomView;
    const intermission = {
      ...playing,
      game: { status: 'intermission' },
    } as import('@daifugo/core').PlayerRoomView;

    expect(roomPath(waiting)).toBe('/rooms/room%2F1/waiting');
    expect(roomPath(playing)).toBe('/rooms/room-1/game');
    expect(roomPath(intermission)).toBe('/rooms/room-1/game-result');
    expect(roomPath(playing, 'activeRules')).toBe('/rooms/room-1/rules');
  });
});
