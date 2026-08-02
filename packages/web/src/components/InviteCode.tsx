import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

import { Button } from './Button';
import { Toast } from './Toast';
import styles from './InviteCode.module.css';

type InviteCodeProps = {
  code: string;
  inviteUrl: string;
};

export function InviteCode({ code, inviteUrl }: InviteCodeProps) {
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>(
    'idle',
  );
  const canShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const share = async () => {
    setShareState('idle');
    try {
      if (canShare) {
        await navigator.share({
          text: `大富豪しよう。この部屋に入って: ${inviteUrl}`,
        });
        return;
      }
      if (!navigator.clipboard) throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(inviteUrl);
      setShareState('copied');
      window.setTimeout(() => setShareState('idle'), 2_000);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setShareState('failed');
    }
  };

  return (
    <section className={styles.invite} aria-label="部屋に招待する">
      <span className={styles.code}>
        <small className={styles.label}>部屋コード</small>
        {code}
      </span>

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
      <Button block onClick={() => void share()}>
        {canShare ? '📤 リンクを共有する' : 'リンクをコピー'}
      </Button>
      <p className={styles.note}>このリンクを送れば、だれでも参加できます</p>
      {shareState === 'copied' && (
        <div className={styles.toast}>
          <Toast>コピーしました</Toast>
        </div>
      )}
      {shareState === 'failed' && (
        <p className={styles.copyError} role="alert">
          リンクを共有できませんでした。もう一度ためしてください
        </p>
      )}
    </section>
  );
}
