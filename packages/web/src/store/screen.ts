import { create } from 'zustand';

import { navigate, screenFromPathname, screenPath } from '../routing';

/**
 * 画面遷移。表示 state と History API の URL を同時に更新する。
 * 部屋内の URL はサーバースナップショットに合わせて App 側で同期する。
 */
export type ScreenId =
  | 'title'
  | 'menu'
  | 'account'
  | 'name'
  | 'proposal'
  | 'myProposals'
  | 'notifications'
  | 'pushSettings'
  | 'activeRules'
  | 'ruleDex'
  | 'waitingRoom'
  | 'game'
  | 'gameResult'
  | 'setResult';

type ScreenState = {
  current: ScreenId;
  go: (screen: ScreenId) => void;
};

export const useScreenStore = create<ScreenState>((set) => ({
  current:
    typeof window === 'undefined'
      ? 'title'
      : screenFromPathname(window.location.pathname),
  go: (screen) => {
    navigate(screenPath(screen));
    set({ current: screen });
  },
}));
