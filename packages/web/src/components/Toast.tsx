import type { ReactNode } from 'react';

import { cx } from '../lib/cx';

import styles from './Toast.module.css';

type ToastProps = {
  /** ok=完了通知 / warn=注意・強調 / guide=初戦の一言。 */
  variant?: 'ok' | 'warn' | 'guide';
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
        {variant === 'guide' && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="var(--color-navy-800)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 1.5v1M6 9.5v1M1.5 6h1M9.5 6h1" />
            <circle cx="6" cy="6" r="2.2" />
          </svg>
        )}
      </span>
      {children}
    </p>
  );
}
