import { Button } from './Button';
import { Dialog, DialogBody } from './Dialog';

import styles from './ConfirmDialog.module.css';

type ConfirmDialogProps = {
  /** 「〜しますか?」の疑問文(ui-writing-style-guide §3)。 */
  title: string;
  /**
   * 実行すると何が起きるかが自明でないときだけ書く。
   * 次の画面を見れば分かることは書かない(UI文言・情報量ガイド 原則 4)。
   */
  description?: string;
  /** 実行側のボタン。動詞の言い切り。 */
  confirmLabel: string;
  /** 取り消し側のボタン。primary はこちらに置き、破壊的な側を目立たせない。 */
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** 実行に失敗したときの案内。出しているあいだもダイアログは閉じない。 */
  error?: string | null;
};

/**
 * 取り消せない操作の確認。
 * ネイティブの window.confirm はボタン語彙を制御できないので使わない。
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  error = null,
}: ConfirmDialogProps) {
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      actions={
        <>
          <Button onClick={onConfirm}>{confirmLabel}</Button>
          <Button variant="primary" onClick={onCancel}>
            {cancelLabel}
          </Button>
        </>
      }
    >
      {description ? <DialogBody>{description}</DialogBody> : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
