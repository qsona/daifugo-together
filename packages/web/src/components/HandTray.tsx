import type { ReactNode } from 'react';

import { Card } from './Card';
import type { CardView } from './Card';
import styles from './HandTray.module.css';

type HandTrayProps = {
  cards: readonly CardView[];
  selectedIds: readonly string[];
  onToggle: (id: string) => void;
  /** 出す・パスのボタン。合法手の判定はエンジン側の関心なので props で受ける。 */
  actions?: ReactNode;
};

/** ワイヤー画面 3 の手札。横スクロールで全枚数を収める。 */
export function HandTray({
  cards,
  selectedIds,
  onToggle,
  actions,
}: HandTrayProps) {
  return (
    <section className={styles.tray} aria-label="あなたの手札">
      {/*
       * 「あなたの手札」のラベルは置かない。画面下端で選択できる札の列は
       * それ自体で自明で、相手席の「残り8枚」と同じ形の枚数だけが要る情報
       * (UI文言ガイド 原則 2)。支援技術には section の aria-label が伝える。
       */}
      <div className={styles.head}>
        <span>{cards.length}枚</span>
      </div>
      <ul className={styles.cards}>
        {cards.map((card) => (
          <li key={card.id}>
            <Card
              card={card}
              selected={selectedIds.includes(card.id)}
              onToggle={onToggle}
            />
          </li>
        ))}
      </ul>
      {actions && <div className={styles.actions}>{actions}</div>}
    </section>
  );
}
