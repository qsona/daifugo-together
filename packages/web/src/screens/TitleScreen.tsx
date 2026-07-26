import keyVisualUrl from '@design/key-visual-2a.svg';

import styles from './TitleScreen.module.css';

type TitleScreenProps = {
  /** 画面 1b(メニュー)へ進む。遷移先の決定は呼び出し側が持つ。 */
  onStart: () => void;
};

/**
 * 画面 1a: タイトル。
 * 2A キービジュアル 1 枚をフルブリードで敷き、画面のどこを押しても次へ進む(E04 §3.1)。
 * SVG は内部要素を個別操作しないので、インライン展開せず `<img>` で 1 枚絵として使う。
 */
export function TitleScreen({ onStart }: TitleScreenProps) {
  return (
    <div className={styles.screen}>
      <img
        className={styles.visual}
        src={keyVisualUrl}
        alt="みんなでつくろう 大富豪 — 毎日どこかで、新ルール。"
      />
      <button type="button" className={styles.startArea} onClick={onStart}>
        <span className="sr-only">はじめる(タップして進む)</span>
      </button>
    </div>
  );
}
