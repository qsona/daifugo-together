import styles from './ActivationChip.module.css';

type ActivationChipProps = {
  /** 直近に発動したルール名。 */
  name: string;
  /** 同時発動した総数。1 なら数を出さない。 */
  count: number;
  /** 有効ルール一覧(画面 4)へ。 */
  onOpen: () => void;
};

/**
 * カットインが引いたあと、場の隅に残る発動の痕跡。
 * 文字の実況ログの代わりに「直前に何が起きたか」を 1 行で保持する。
 */
export function ActivationChip({ name, count, onOpen }: ActivationChipProps) {
  return (
    <button type="button" className={styles.chip} onClick={onOpen}>
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.name}>{name}</span>
      {count > 1 && <span className={styles.count}>ほか{count - 1}</span>}
    </button>
  );
}
