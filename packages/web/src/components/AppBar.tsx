import { cx } from '../lib/cx';
import type { ReactNode } from 'react';

import styles from './AppBar.module.css';

type AppBarProps = {
  title: string;
  /** 省略すると戻るボタンを出さない。 */
  onBack?: () => void;
  /** 右端のアクションチップ(有効ルール件数など)。 */
  action?: { label: string; onClick?: () => void };
  notification?: ReactNode;
};

export function AppBar({ title, onBack, action, notification }: AppBarProps) {
  return (
    <header className={styles.appbar}>
      {onBack && (
        <button
          type="button"
          className={styles.back}
          aria-label="もどる"
          onClick={onBack}
        >
          ←
        </button>
      )}
      <h1 className={styles.title}>{title}</h1>
      {notification}
      {action &&
        (action.onClick ? (
          <button
            type="button"
            className={cx(styles.action, styles.actionButton)}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ) : (
          <span className={styles.action}>{action.label}</span>
        ))}
    </header>
  );
}
