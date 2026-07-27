import { useId } from 'react';
import type { ReactNode } from 'react';

import { cx } from '../lib/cx';

import styles from './Dialog.module.css';

type DialogProps = {
  title: string;
  /** タイトルの上に置く演出領域(イエローカードの絵など)。 */
  visual?: ReactNode;
  children: ReactNode;
  /** 下部のボタン群。 */
  actions?: ReactNode;
  /** 再訪時など、初回提示ではない静的表示では演出を止める。 */
  disableAnimation?: boolean;
};

export function Dialog({
  title,
  visual,
  children,
  actions,
  disableAnimation = false,
}: DialogProps) {
  const titleId = useId();

  return (
    <div className={styles.scrim}>
      <div
        className={cx(styles.dialog, disableAnimation && styles.noAnimation)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-animation={disableAnimation ? 'off' : 'on'}
      >
        {visual}
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {children}
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </div>
  );
}

export function DialogBody({ children }: { children: ReactNode }) {
  return <p className={styles.body}>{children}</p>;
}

export function DialogSubText({ children }: { children: ReactNode }) {
  return <p className={styles.sub}>{children}</p>;
}

export function StopNotice({ children }: { children: ReactNode }) {
  return <p className={styles.stopBox}>{children}</p>;
}

/**
 * 審判の小道具としてのイエローカード。
 * 黄はカードの絵とスロットにだけ使い、面全体を黄で塗らない(警報にしない)。
 */
export function YellowCards({ count }: { count: 1 | 2 }) {
  return (
    <div className={styles.cards} aria-hidden="true">
      <span className={styles.yellowCard} />
      {count === 2 && (
        <span className={cx(styles.yellowCard, styles.yellowCardSecond)} />
      )}
    </div>
  );
}

export function YellowCardSlots({ filled }: { filled: 1 | 2 }) {
  return (
    <p className={styles.slots}>
      <span>警告</span>
      <span className={cx(styles.slot, styles.slotFilled)} />
      <span className={cx(styles.slot, filled === 2 && styles.slotFilled)} />
      <span>{filled} / 2枚</span>
    </p>
  );
}
