import { create } from 'zustand';

/**
 * 画面遷移。E12 §4.2 が「ルーティングは本ゲームに不要」としているため
 * ルータは入れず、Zustand の画面 state で切り替える(wireframes.html の 13 フレームに対応)。
 * DS-01/DS-02 の範囲で必要なものだけを段階的に足す。
 */
export type ScreenId = 'title' | 'menu';

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
