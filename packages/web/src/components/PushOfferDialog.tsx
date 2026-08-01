import { useState } from 'react';

import type { PushOfferResult } from '../push/client';
import { Button } from './Button';
import { Dialog, DialogBody, DialogSubText } from './Dialog';

export function PushOfferDialog({
  subscribe,
  decline,
  onClose,
}: {
  subscribe: () => Promise<PushOfferResult>;
  decline: () => void;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<PushOfferResult | null>(null);
  const explanation =
    result === 'ios_install_required'
      ? 'iPhone・iPadでは、共有メニューから「ホーム画面に追加」してアプリを開くと通知を設定できます。'
      : result === 'denied'
        ? '通知は許可されませんでした。結果はいつでもアプリ内のおしらせで確認できます。'
        : result && result !== 'subscribed'
          ? 'この端末では通知を設定できませんでした。結果はアプリ内のおしらせで確認できます。'
          : null;
  return (
    <Dialog
      title={
        result === 'subscribed'
          ? '通知を設定しました'
          : '結果が出たら知らせる？'
      }
      actions={
        explanation || result === 'subscribed' ? (
          <Button variant="primary" onClick={onClose}>
            とじる
          </Button>
        ) : (
          <>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() => {
                setPending(true);
                void subscribe()
                  .then(setResult)
                  .finally(() => setPending(false));
              }}
            >
              {pending ? '設定中…' : '通知を受け取る'}
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                decline();
                onClose();
              }}
            >
              受け取らない
            </Button>
          </>
        )
      }
    >
      <DialogBody>
        {explanation ??
          (result === 'subscribed'
            ? '提案の結果を、この端末へお知らせします。'
            : '提案がルールになったときや、結果が出たときにこの端末へお知らせします。')}
      </DialogBody>
      {!result && (
        <DialogSubText>
          受け取らなくても、アプリ内のおしらせですべて確認できます。
        </DialogSubText>
      )}
    </Dialog>
  );
}
