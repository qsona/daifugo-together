import { create } from 'zustand';

/**
 * 画面遷移。E12 §4.2 が「ルーティングは本ゲームに不要」としているため
 * ルータは入れず、Zustand の画面 state で切り替える(wireframes.html の 13 フレームに対応)。
 * フェーズ 2 の画面(4・6・7・8・9a・9b)は各機能 Epic が足す。
 */
export type ScreenId =
  | 'title'
  | 'menu'
  | 'proposal'
  | 'myProposals'
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
  current: 'title',
  go: (screen) => {
    set({ current: screen });
  },
}));
