import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cx } from '../lib/cx';

import styles from './Toast.module.css';

type ToastProps = {
  /** ok=完了通知 / warn=注意・強調 / guide=初戦の一言。 */
  variant?: 'ok' | 'warn' | 'guide';
  children: ReactNode;
  /** 指定時だけ自動で退場する。既存の演出用途は無期限のまま。 */
  duration?: number;
  onDismiss?: () => void;
};

/**
 * design-system.html §5-13。画面下部に 1 件だけ出す。
 * エラーはトーストにせず、その場のフォームエラーかモーダルで返す。
 */
export function Toast({
  variant = 'ok',
  children,
  duration,
  onDismiss,
}: ToastProps) {
  const [leaving, setLeaving] = useState(false);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (duration === undefined) return;
    const leaveAt = window.setTimeout(() => setLeaving(true), duration);
    const dismissAt = window.setTimeout(
      () => onDismissRef.current?.(),
      duration + 180,
    );
    return () => {
      window.clearTimeout(leaveAt);
      window.clearTimeout(dismissAt);
    };
  }, [duration]);

  return (
    <p className={cx(styles.toast, leaving && styles.leaving)} role="status">
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
