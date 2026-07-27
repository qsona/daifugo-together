import type { YellowCardInfo } from '@daifugo/core';

import { Button } from './Button';
import {
  Dialog,
  DialogBody,
  DialogSubText,
  StopNotice,
  YellowCards,
  YellowCardSlots,
} from './Dialog';

type CardInfo = Extract<YellowCardInfo, { verdict: 'card' }>;

export function YellowCardModal({
  info,
  onClose,
}: {
  info: CardInfo;
  onClose: () => void;
}) {
  const count = info.card.active;
  return (
    <Dialog
      title="イエローカード!"
      visual={<YellowCards count={count} />}
      actions={
        <Button variant="primary" onClick={onClose}>
          提案画面にもどる
        </Button>
      }
    >
      <DialogBody>
        審判より:
        ゲームの外にはたらきかける命令が見つかりました。この提案は受け付けられません。
      </DialogBody>
      <YellowCardSlots filled={count} />
      {info.suspension ? (
        <StopNotice>
          24時間、ルール提案をお休みします。解除予定:{' '}
          {new Date(info.suspension.endsAt).toLocaleString('ja-JP')}
          。対戦はそのまま遊べます。
        </StopNotice>
      ) : (
        <DialogSubText>
          2枚になると24時間ルール提案をお休みします。対戦はそのまま遊べます。
        </DialogSubText>
      )}
    </Dialog>
  );
}
