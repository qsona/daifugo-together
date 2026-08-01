import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

import { Button } from './Button';
import styles from './InviteCode.module.css';

type InviteCodeProps = {
  code: string;
  inviteUrl: string;
  /** 省略するとコピーボタンを出さない。 */
  onCopy?: () => void | Promise<void>;
};

export function InviteCode({ code, inviteUrl, onCopy }: InviteCodeProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>(
    'idle',
  );

  const copy = async () => {
    if (!onCopy) return;
    try {
      await onCopy();
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 2_000);
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <section className={styles.invite} aria-label="部屋に招待する">
      <span className={styles.code}>
        <small className={styles.label}>招待リンク</small>
        {code}
      </span>

      <div className={styles.shareRow}>
        <input
          aria-label="招待リンク"
          className={styles.link}
          readOnly
          value={inviteUrl}
          onFocus={(event) => event.currentTarget.select()}
        />
        {onCopy && (
          <Button size="small" onClick={() => void copy()}>
            {copyState === 'copied' ? 'コピー済み' : 'コピー'}
          </Button>
        )}
      </div>
      <p className={styles.note}>このリンクを送れば、だれでも参加できます</p>
      {copyState === 'failed' && (
        <p className={styles.copyError} role="alert">
          リンクを長押ししてコピーしてください
        </p>
      )}

      <details className={styles.qrDisclosure}>
        <summary>QRコードを表示</summary>
        <figure className={styles.qr}>
          <QRCodeSVG
            aria-label="友だちが参加するためのQRコード"
            className={styles.qrCode}
            level="M"
            marginSize={4}
            role="img"
            size={200}
            title="友だちが参加するためのQRコード"
            value={inviteUrl}
          />
          <figcaption>スマホのカメラで読み取って参加</figcaption>
        </figure>
      </details>
    </section>
  );
}
