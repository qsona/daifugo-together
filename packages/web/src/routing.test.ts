import { describe, expect, it } from 'vitest';

import {
  inviteCodeFromSearch,
  parseRoomRoute,
  roomInviteUrl,
  roomPath,
  screenFromPathname,
  screenPath,
} from './routing';

describe('画面ルーティング', () => {
  it('共有URLに招待コードを埋め込み、URLから安全に復元する', () => {
    expect(roomInviteUrl('01234', 'https://example.com')).toBe(
      'https://example.com/?room=01234',
    );
    expect(inviteCodeFromSearch('?room=01234')).toBe('01234');
    expect(inviteCodeFromSearch('?room=1234')).toBeNull();
    expect(inviteCodeFromSearch('?room=12A45')).toBeNull();
  });

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

  it('ルール詳細のruleId付きパスを往復変換する', () => {
    expect(parseRoomRoute('/rooms/room-1/rules/r0001-eight-cut')).toEqual({
      roomId: 'room-1',
      view: 'rules',
      ruleId: 'r0001-eight-cut',
    });
    expect(parseRoomRoute('/rooms/room-1/rules')).toEqual({
      roomId: 'room-1',
      view: 'rules',
    });
    const room = {
      roomId: 'room-1',
      phase: 'playing',
      game: null,
    } as import('@daifugo/core').PlayerRoomView;
    expect(roomPath(room, 'activeRules', 'r0001-eight-cut')).toBe(
      '/rooms/room-1/rules/r0001-eight-cut',
    );
  });

  it('rules以外の余計なパス要素は拒否する', () => {
    expect(parseRoomRoute('/rooms/room-1/game/rule-id')).toBeNull();
  });
});
