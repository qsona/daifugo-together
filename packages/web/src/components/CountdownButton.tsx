import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { Button } from './Button';
import styles from './CountdownButton.module.css';

type CountdownButtonProps = {
  /** 残り時間。経過したら onActivate を自分で呼ぶ。 */
  durationMs: number;
  onActivate: () => void;
  children: ReactNode;
};

/**
 * 待っていれば自動で進み、押せば即進むボタン。
 * 残り時間は文字ではなく縁を一周するリングが伝える。
 */
export function CountdownButton({
  durationMs,
  onActivate,
  children,
}: CountdownButtonProps) {
  useEffect(() => {
    const timer = setTimeout(onActivate, durationMs);
    return () => {
      clearTimeout(timer);
    };
  }, [durationMs, onActivate]);

  return (
    <div className={styles.wrap}>
      <Button variant="primary" block onClick={onActivate}>
        {children}
      </Button>
      <div className={styles.track} aria-hidden="true">
        <div
          className={styles.fill}
          style={{ animationDuration: `${String(durationMs)}ms` }}
        />
      </div>
    </div>
  );
}
