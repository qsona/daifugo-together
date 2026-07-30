import type { CSSProperties, ReactNode } from 'react';

import { Card } from './Card';
import type { CardView } from './Card';
import type { CardHint } from '../game/hints';
import { cx } from '../lib/cx';
import { TurnCountdown } from './TurnCountdown';
import styles from './HandTray.module.css';

type HandTrayProps = {
  cards: readonly CardView[];
  selectedIds: readonly string[];
  cardHints?: ReadonlyMap<string, CardHint>;
  showStrengthScale?: boolean;
  /** 自分の手番か。トレイの点灯と残り時間バーの出し分けに使う。 */
  isMyTurn: boolean;
  turnDeadlineAt?: number | null;
  onToggle: (id: string) => void;
  onDimmedCardTap?: (id: string) => void;
  /** 出す・パスのボタン。合法手の判定はエンジン側の関心なので props で受ける。 */
  actions?: ReactNode;
};

/**
 * ワイヤー画面 3 の手札。
 * 横スクロールはしない。実際の手札と同じく左から重ね、枚数が増えるほど
 * 重なりを深くして必ず画面幅に収める。見えているのは各札の左端の帯だけだが、
 * ランクとスートはそこに置いてある(Card の index)。
 */
export function HandTray({
  cards,
  selectedIds,
  cardHints,
  showStrengthScale = false,
  isMyTurn,
  turnDeadlineAt,
  onToggle,
  onDimmedCardTap,
  actions,
}: HandTrayProps) {
  const selectedIdSet = new Set(selectedIds);
  const selectedGapCount = cards
    .slice(0, -1)
    .filter((card) => selectedIdSet.has(card.id)).length;
  const unselectedGapCount = Math.max(0, cards.length - 1 - selectedGapCount);

  return (
    <section
      className={cx(styles.tray, isMyTurn && styles.myTurn)}
      aria-label="あなたの手札"
    >
      <div className={styles.header}>
        {isMyTurn && <span className={styles.turnBadge}>あなたの番</span>}
        {isMyTurn && turnDeadlineAt != null && (
          <TurnCountdown deadlineAt={turnDeadlineAt} />
        )}
      </div>
      {showStrengthScale && (
        <div
          className={styles.strengthScale}
          aria-label="カードの強さ: 左がよわい、右がつよい"
        >
          <span>よわい</span>
          <span aria-hidden="true">← →</span>
          <span>つよい</span>
        </div>
      )}
      <ul
        className={styles.cards}
        style={
          {
            '--selected-gaps': selectedGapCount,
            '--unselected-gaps': unselectedGapCount,
          } as CSSProperties
        }
      >
        {cards.map((card) => {
          const selected = selectedIdSet.has(card.id);
          return (
            <li
              key={card.id}
              className={cx(styles.slot, selected && styles.selectedSlot)}
            >
              <Card
                card={card}
                selected={selected}
                dimmed={cardHints?.get(card.id) === 'dimmed'}
                onToggle={onToggle}
                {...(onDimmedCardTap ? { onDimmedTap: onDimmedCardTap } : {})}
              />
            </li>
          );
        })}
      </ul>
      {actions && <div className={styles.actions}>{actions}</div>}
    </section>
  );
}
