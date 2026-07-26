import { cx } from '../lib/cx';

import { Card } from './Card';
import type { CardView } from './Card';
import styles from './FieldArea.module.css';

/** 1 人がこの場に出した札。古い順に並ぶ(場が流れるまで積み上がる)。 */
export type FieldStack = {
  playerName: string;
  isSelf: boolean;
  /** 各要素が 1 回のプレイ。ペアなら複数枚。 */
  plays: readonly (readonly CardView[])[];
};

type FieldAreaProps = {
  stacks: readonly FieldStack[];
  /** いま超えるべきプレイの持ち主。場が流れていれば null。 */
  leadPlayerName: string | null;
  /** 場が流れる演出中。 */
  isFlushing?: boolean;
};

/** 山の中の n 枚目の見た目。傾きは席ごと・枚数ごとに決めるので描画のたびに変わらない。 */
function cardStyle(stackIndex: number, cardIndex: number) {
  const tilt = ((stackIndex * 7 + cardIndex * 11) % 9) - 4;
  const offsetX = cardIndex * 7 - 22;
  const offsetY = cardIndex * -3;
  return {
    transform: `translate(${String(offsetX)}px, ${String(offsetY)}px) rotate(${String(tilt)}deg)`,
    zIndex: cardIndex,
  };
}

/**
 * ワイヤー画面 3 の場。
 * 中央に 1 つ積むのではなく、実際の卓と同じくプレイヤーごとの山に重ねる。
 * 「誰が何を出したか」が常に見えるので、文字の実況ログを置かなくてよい。
 */
export function FieldArea({
  stacks,
  leadPlayerName,
  isFlushing = false,
}: FieldAreaProps) {
  return (
    <section className={styles.field} aria-label="場">
      {stacks.map((stack, stackIndex) => {
        const cards = stack.plays.flat();
        const isLead = stack.playerName === leadPlayerName;

        return (
          <div
            key={stack.playerName}
            className={cx(
              styles.stack,
              stack.isSelf && styles.selfStack,
              isLead && styles.lead,
            )}
          >
            <span className={styles.name}>
              {stack.isSelf ? 'あなた' : stack.playerName}
            </span>
            {cards.length === 0 ? (
              <span className={styles.empty} />
            ) : (
              <ul
                className={cx(styles.cards, isFlushing && styles.flushing)}
                aria-label={`${stack.isSelf ? 'あなた' : stack.playerName}が出した札`}
              >
                {cards.map((card, cardIndex) => (
                  <li
                    key={card.id}
                    className={styles.card}
                    style={cardStyle(stackIndex, cardIndex)}
                  >
                    <Card card={card} size="small" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
