import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { Button } from './Button';
import styles from './CountdownButton.module.css';

type CountdownButtonProps = {
  /** タイマー全体の時間。バーの全量に使う。 */
  durationMs: number;
  /** サーバーが確定した終了時刻。経過したら onActivate を呼ぶ。 */
  deadlineAt: number;
  onActivate: () => void;
  children: ReactNode;
};

/**
 * 待っていれば自動で進み、押せば即進むボタン。
 * 残り時間は文字ではなく縁を一周するリングが伝える。
 */
export function CountdownButton({
  durationMs,
  deadlineAt,
  onActivate,
  children,
}: CountdownButtonProps) {
  const remainingMs = Math.max(0, deadlineAt - Date.now());
  const startScale =
    durationMs <= 0 ? 0 : Math.min(1, remainingMs / durationMs);

  useEffect(() => {
    const timer = setTimeout(onActivate, Math.max(0, deadlineAt - Date.now()));
    return () => {
      clearTimeout(timer);
    };
  }, [deadlineAt, onActivate]);

  return (
    <div className={styles.wrap}>
      <Button variant="primary" block onClick={onActivate}>
        {children}
      </Button>
      <div className={styles.track} aria-hidden="true">
        <div
          className={styles.fill}
          style={
            {
              '--countdown-start': startScale,
              animationDuration: `${String(remainingMs)}ms`,
            } as CSSProperties
          }
        />
      </div>
    </div>
  );
}
