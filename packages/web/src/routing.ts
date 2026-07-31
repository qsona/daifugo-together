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
  /** view が rules のときだけ。ルール詳細モーダルを開く。 */
  ruleId?: string;
};

export function inviteCodeFromSearch(search: string): string | null {
  const inviteCode = new URLSearchParams(search).get('room');
  return inviteCode && /^[0-9]{5}$/.test(inviteCode) ? inviteCode : null;
}

export function roomInviteUrl(inviteCode: string, origin: string): string {
  const url = new URL('/', origin);
  url.searchParams.set('room', inviteCode);
  return url.href;
}

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
    /^\/rooms\/([^/]+)\/(waiting|game|game-result|set-result|rules|rule-dex)(?:\/([^/]+))?\/?$/.exec(
      pathname,
    );
  if (!match) return null;
  if (match[3] !== undefined && match[2] !== 'rules') return null;
  try {
    return {
      roomId: decodeURIComponent(match[1]!),
      view: match[2] as RoomRoute['view'],
      ...(match[3] === undefined
        ? {}
        : { ruleId: decodeURIComponent(match[3]) }),
    };
  } catch {
    return null;
  }
}

export function roomPath(
  room: PlayerRoomView,
  overlay: RoomOverlayRoute = null,
  ruleId?: string,
): string {
  const roomId = encodeURIComponent(room.roomId);
  if (overlay === 'activeRules') {
    return ruleId
      ? `/rooms/${roomId}/rules/${encodeURIComponent(ruleId)}`
      : `/rooms/${roomId}/rules`;
  }
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
