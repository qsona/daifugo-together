import type { PlayerRoomView } from '@daifugo/core';

import type { ScreenId } from './store/screen';

const SCREEN_PATHS: Record<ScreenId, string> = {
  title: '/',
  menu: '/menu',
  proposal: '/proposals/new',
  myProposals: '/proposals/mine',
  activeRules: '/demo/rules/active',
  ruleDex: '/rules',
  waitingRoom: '/demo/waiting',
  game: '/demo/game',
  gameResult: '/demo/game-result',
  setResult: '/demo/set-result',
};

const PATH_SCREENS = new Map(
  Object.entries(SCREEN_PATHS).map(([screen, path]) => [
    path,
    screen as ScreenId,
  ]),
);

export type RoomOverlayRoute = 'activeRules' | 'ruleDex' | null;

export type RoomRoute = {
  roomId: string;
  view:
    'waiting' | 'game' | 'game-result' | 'set-result' | 'rules' | 'rule-dex';
};

export function screenPath(screen: ScreenId): string {
  return SCREEN_PATHS[screen];
}

export function screenFromPathname(pathname: string): ScreenId {
  const normalized =
    pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const staticScreen = PATH_SCREENS.get(normalized);
  if (staticScreen) return staticScreen;

  const roomRoute = parseRoomRoute(normalized);
  if (!roomRoute) return 'title';
  switch (roomRoute.view) {
    case 'waiting':
      return 'waitingRoom';
    case 'game':
      return 'game';
    case 'game-result':
      return 'gameResult';
    case 'set-result':
      return 'setResult';
    case 'rules':
      return 'activeRules';
    case 'rule-dex':
      return 'ruleDex';
  }
}

export function parseRoomRoute(pathname: string): RoomRoute | null {
  const match =
    /^\/rooms\/([^/]+)\/(waiting|game|game-result|set-result|rules|rule-dex)\/?$/.exec(
      pathname,
    );
  if (!match) return null;
  try {
    return {
      roomId: decodeURIComponent(match[1]!),
      view: match[2] as RoomRoute['view'],
    };
  } catch {
    return null;
  }
}

export function roomPath(
  room: PlayerRoomView,
  overlay: RoomOverlayRoute = null,
): string {
  const roomId = encodeURIComponent(room.roomId);
  if (overlay === 'activeRules') return `/rooms/${roomId}/rules`;
  if (overlay === 'ruleDex') return `/rooms/${roomId}/rule-dex`;
  if (room.phase === 'waiting') return `/rooms/${roomId}/waiting`;
  if (room.phase === 'setResult') return `/rooms/${roomId}/set-result`;
  return room.game?.status === 'intermission'
    ? `/rooms/${roomId}/game-result`
    : `/rooms/${roomId}/game`;
}

export function navigate(
  path: string,
  mode: 'push' | 'replace' = 'push',
): void {
  if (typeof window === 'undefined' || window.location.pathname === path)
    return;
  window.history[mode === 'push' ? 'pushState' : 'replaceState']({}, '', path);
}
