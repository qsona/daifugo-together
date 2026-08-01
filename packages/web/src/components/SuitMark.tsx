import type { ReactNode } from 'react';

import { cx } from '../lib/cx';

import styles from './SuitMark.module.css';

/**
 * 札の view-model と同じスート語彙(エンジンの型は写さない)。
 * `@daifugo/core` の Suit と同じ 4 値なので、そちらの値もそのまま渡せる。
 */
export type Suit = 'spade' | 'heart' | 'diamond' | 'club';

/** 読み上げ用のスート名。札・場チップで同じ語を使う。 */
export const SUIT_NAME: Record<Suit, string> = {
  spade: 'スペード',
  heart: 'ハート',
  diamond: 'ダイヤ',
  club: 'クラブ',
};

/*
 * スートは Unicode の ♠♥♦♣ ではなく自前の図形で描く。理由は 3 つ:
 *
 * 1. ♠ と ♣ を分けている情報は「♣ の 3 つの丸のあいだの隙間」だけで、
 *    小さい寸法(札の左上は 15px)で最初に潰れるのがその隙間だった。
 *    自前なら丸を最初から離しておける。
 * 2. 丸ゴシック(M PLUS Rounded 1c)は記号の角も丸めるので、
 *    ♠ の尖りが鈍り ♣ との差がさらに縮む。
 * 3. font-display: swap のため web フォント読込前はフォールバック書体の形になり、
 *    しかも ♥(U+2665)だけ ♠♣♦(U+2660/2663/2666)と別サブセットなので
 *    4 スートが揃うタイミングもずれる。図形なら最初から確定する。
 *
 * viewBox は 0 0 100 100 で統一し、どのスートも同じ光学的な面積になるよう調整してある。
 */

/** スペード。頂点を鋭く・胴を細くして、♣ の丸い塊と逆方向に振る。 */
const SPADE_PATH =
  'M50 3 C34 26 4 44 4 63 C4 77 14 86 26 86 C36 86 45 80 50 71 ' +
  'C55 80 64 86 74 86 C86 86 96 77 96 63 C96 44 66 26 50 3 Z ' +
  'M50 64 C49 80 44 90 33 97 L67 97 C56 90 51 80 50 64 Z';

const HEART_PATH =
  'M50 95 C18 72 4 55 4 36 C4 20 16 8 30 8 C39 8 46 13 50 21 ' +
  'C54 13 61 8 70 8 C84 8 96 20 96 36 C96 55 82 72 50 95 Z';

/*
 * ダイヤ。菱形は同じ外接枠でも面積が他の 3 つより 2 割ほど小さく、
 * 並べたときに 1 つだけ痩せて見える。辺をふくらませて面積を合わせる。
 */
const DIAMOND_PATH =
  'M50 1 C56 22 72 40 97 50 C72 60 56 78 50 99 C44 78 28 60 3 50 C28 40 44 22 50 1 Z';

/** クラブの軸。3 つの丸のあいだを通って下に抜ける。 */
const CLUB_STEM_PATH = 'M50 40 C48 71 42 90 30 97 L70 97 C58 90 52 71 50 40 Z';

/*
 * クラブだけ図形を分けて重ねる(1 つの path にまとめない)。
 * 軸と丸は重なるので、同じ path に入れると巻き方向しだいで
 * 重なりが穴になる(nonzero 則)。別要素なら必ず塗り足しになる。
 */
const SUIT_SHAPE: Record<Suit, ReactNode> = {
  spade: <path d={SPADE_PATH} />,
  heart: <path d={HEART_PATH} />,
  diamond: <path d={DIAMOND_PATH} />,
  club: (
    <>
      <circle cx="50" cy="24" r="21" />
      <circle cx="22" cy="68" r="21" />
      <circle cx="78" cy="68" r="21" />
      <path d={CLUB_STEM_PATH} />
    </>
  ),
};

/**
 * 4 色デッキの色クラス(♠ 紺 / ♥ 赤 / ♦ 青 / ♣ 緑)。
 * 色は形の改善への上乗せで、色だけには頼らない(デザインシステム §7)。
 * ランクごと色を変える札と、記号だけ色を変える場チップの両方で使うので、
 * SuitMark 自身ではなく呼び出し側の要素に載せる(色は currentColor で拾う)。
 */
export function suitColorClass(suit: Suit): string | undefined {
  return styles[suit];
}

type SuitMarkProps = {
  suit: Suit;
  /** 寸法は font-size で決まる(図形は 1em 角)。色は currentColor を継ぐ。 */
  className?: string | undefined;
};

export function SuitMark({ suit, className }: SuitMarkProps) {
  return (
    <svg
      className={cx(styles.mark, className)}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      {SUIT_SHAPE[suit]}
    </svg>
  );
}
