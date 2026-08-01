import { useState } from 'react';

import type { PushOfferKind, PushOfferResult } from '../push/client';
import { Button } from './Button';
import { Dialog, DialogBody, DialogSubText } from './Dialog';
import { InstallGuide } from './InstallGuide';

export function PushOfferDialog({
  kind,
  subscribe,
  decline,
  onClose,
}: {
  kind: PushOfferKind;
  subscribe: () => Promise<PushOfferResult>;
  decline: () => void;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<PushOfferResult | null>(null);
  // iOS のタブでは購読自体ができないので、最初からホーム画面追加の案内を出す。
  const installing = kind === 'install' || result === 'ios_install_required';
  const explanation =
    result === 'denied'
      ? '通知は許可されませんでした。結果はいつでもアプリ内のおしらせで確認できます。'
      : !installing && result && result !== 'subscribed'
        ? 'この端末では通知を設定できませんでした。結果はアプリ内のおしらせで確認できます。'
        : null;
  const done = explanation !== null || result === 'subscribed';
  const title = installing
    ? 'ホーム画面に追加すると通知が届きます'
    : result === 'subscribed'
      ? '通知を設定しました'
      : '結果が出たら知らせる？';

  return (
    <Dialog
      title={title}
      actions={
        installing ? (
          <>
            <Button variant="primary" onClick={onClose}>
              わかった
            </Button>
            <Button
              onClick={() => {
                decline();
                onClose();
              }}
            >
              今後は出さない
            </Button>
          </>
        ) : done ? (
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
      {installing ? (
        <>
          <DialogBody>
            iPhone・iPadでは、ホーム画面に追加したアプリだけが通知を受け取れます。
          </DialogBody>
          <InstallGuide />
        </>
      ) : (
        <DialogBody>
          {explanation ??
            (result === 'subscribed'
              ? '提案の結果を、この端末へお知らせします。'
              : '提案がルールになったときや、結果が出たときにこの端末へお知らせします。')}
        </DialogBody>
      )}
      {(installing || !result) && (
        <DialogSubText>
          {installing ? '追加' : '受け取ら'}
          なくても、アプリ内のおしらせですべて確認できます。
        </DialogSubText>
      )}
    </Dialog>
  );
}
