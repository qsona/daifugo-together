import { Button } from './Button';
import styles from './InviteCode.module.css';

type InviteCodeProps = {
  code: string;
  /** 省略するとコピーボタンを出さない。コピー成功はトーストで返す。 */
  onCopy?: () => void;
};

export function InviteCode({ code, onCopy }: InviteCodeProps) {
  return (
    <div className={styles.invite}>
      <span className={styles.code}>
        <small className={styles.label}>招待コード</small>
        {code}
      </span>
      {onCopy && (
        <Button size="small" onClick={onCopy}>
          コピー
        </Button>
      )}
    </div>
  );
}
