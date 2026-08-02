import { useEffect, useRef, useState } from 'react';
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
  /** チュートリアルの目盛り表示。反転中は誰にでも出すので、これとは独立に効く。 */
  showStrengthScale?: boolean;
  /** 正味の強さが反転しているか。反転しているあいだは誰にでも目盛りを出す。 */
  strengthInverted?: boolean;
  /** 自分の手番か。トレイの点灯と残り時間バーの出し分けに使う。 */
  isMyTurn: boolean;
  turnDeadlineAt?: number | null;
  onToggle: (id: string) => void;
  onDimmedCardTap?: (id: string) => void;
  /** ルール入力など、手札を選ぶ前に常時見せる案内。 */
  notice?: ReactNode;
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
  strengthInverted = false,
  isMyTurn,
  turnDeadlineAt,
  onToggle,
  onDimmedCardTap,
  notice,
  actions,
}: HandTrayProps) {
  const flipping = useStrengthFlip(strengthInverted);
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
      {(showStrengthScale || strengthInverted) && (
        <div
          className={cx(styles.strengthScale, flipping && styles.flip)}
          aria-label={
            strengthInverted
              ? 'カードの強さ: 左がつよい、右がよわい'
              : 'カードの強さ: 左がよわい、右がつよい'
          }
        >
          {/* 手札の並びは変えないので、ラベルの位置が入れ替わること自体が信号になる。 */}
          {strengthInverted ? (
            <>
              <span className={styles.strong}>つよい</span>
              <span aria-hidden="true">← →</span>
              <span>よわい</span>
            </>
          ) : (
            <>
              <span>よわい</span>
              <span aria-hidden="true">← →</span>
              <span className={styles.strong}>つよい</span>
            </>
          )}
        </div>
      )}
      {notice}
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

/** 目盛りが 1 回だけ裏返る尺。--duration-base と揃える。 */
const FLIP_MS = 200;

/** 向きが変わった瞬間だけフリップさせる。初期描画では演出しない。 */
function useStrengthFlip(inverted: boolean): boolean {
  const previous = useRef(inverted);
  const [flipping, setFlipping] = useState(false);

  useEffect(() => {
    if (previous.current === inverted) return;
    previous.current = inverted;
    setFlipping(true);
    const timer = window.setTimeout(() => {
      setFlipping(false);
    }, FLIP_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [inverted]);

  return flipping;
}
