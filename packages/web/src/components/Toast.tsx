import type { ReactNode } from 'react';

import { cx } from '../lib/cx';

import styles from './Toast.module.css';

type ToastProps = {
  /** ok=完了通知 / warn=注意・強調(ルール発動など)。 */
  variant?: 'ok' | 'warn';
  children: ReactNode;
};

/**
 * design-system.html §5-13。画面下部に 1 件だけ出す。
 * エラーはトーストにせず、その場のフォームエラーかモーダルで返す。
 */
export function Toast({ variant = 'ok', children }: ToastProps) {
  return (
    <p className={styles.toast} role="status">
      <span className={cx(styles.icon, styles[variant])} aria-hidden="true">
        {variant === 'ok' && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="var(--color-cream-50)"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M1.5 5.5 4 8l4.5-6" />
          </svg>
        )}
      </span>
      {children}
    </p>
  );
}
