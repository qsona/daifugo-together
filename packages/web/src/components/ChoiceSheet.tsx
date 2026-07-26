import { useEffect } from 'react';
import type { ReactNode } from 'react';

import styles from './ChoiceSheet.module.css';

type ChoiceSheetProps = {
  /** 支援技術に読ませる見出し。画面には出さない。 */
  label: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * 下から出る二択のシート。
 * 選択肢が少ないときに、画面を 1 枚挟まずその場で決めさせる。
 * 背景タップと Esc で閉じる。
 */
export function ChoiceSheet({ label, onClose, children }: ChoiceSheetProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      {/* 背景をタップしたら閉じる。見た目を持たないので button ではなく領域として扱う。 */}
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <div className={styles.sheet}>
        <span className={styles.grip} aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
