import { cx } from '../lib/cx';

import styles from './AppBar.module.css';

type AppBarProps = {
  title: string;
  /** 省略すると戻るボタンを出さない。 */
  onBack?: () => void;
  /** 右端のアクションチップ(有効ルール件数など)。 */
  action?: { label: string; onClick?: () => void };
};

export function AppBar({ title, onBack, action }: AppBarProps) {
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
