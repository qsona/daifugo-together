import type { CardAppealStatus, YellowCardInfo } from '@daifugo/core';
import { useState } from 'react';

import { Button, LinkButton } from './Button';
import { buildXShareUrl } from '../links';
import {
  Dialog,
  DialogBody,
  DialogSubText,
  StopNotice,
  YellowCards,
  YellowCardSlots,
} from './Dialog';
import styles from './YellowCardModal.module.css';

type CardInfo = Extract<YellowCardInfo, { verdict: 'card' }>;

interface AppealableCard {
  id: number;
  label?: string;
  appealStatus: CardAppealStatus | null;
}

export function YellowCardModal({
  info,
  cards = [],
  onAppeal,
  staticDisplay = false,
  onClose,
}: {
  info: CardInfo;
  cards?: AppealableCard[];
  onAppeal?:
    ((cardId: number, comment: string | null) => Promise<void>) | undefined;
  staticDisplay?: boolean;
  onClose: () => void;
}) {
  const count = info.card.active;
  const [animationSkipped, setAnimationSkipped] = useState(false);
  const animationClass =
    animationSkipped || staticDisplay ? styles.skipped : '';
  return (
    <div onPointerDown={() => setAnimationSkipped(true)}>
      <Dialog
        title={staticDisplay ? '提案はお休み中です' : 'イエローカード!'}
        disableAnimation={staticDisplay}
        visual={
          <div className={`${styles.cardEntrance} ${animationClass}`}>
            <YellowCards count={count} />
          </div>
        }
        actions={
          <Button variant="primary" onClick={onClose}>
            提案画面にもどる
          </Button>
        }
      >
        <div className={`${styles.details} ${animationClass}`}>
          <DialogBody>
            {staticDisplay
              ? 'ルール提案は一時停止中です。対戦はそのまま遊べます。'
              : '審判より: ゲームの外にはたらきかける命令が見つかりました。この提案は受け付けられません。'}
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
          {cards.map((card) => (
            <AppealControl key={card.id} card={card} onAppeal={onAppeal} />
          ))}
          <div className={styles.shareAction}>
            <LinkButton
              size="small"
              href={buildXShareUrl(
                'みんなでつくろう大富豪で、イエローカードをもらいました🟨',
              )}
              target="_blank"
              rel="noreferrer"
            >
              𝕏 じまんする
            </LinkButton>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function AppealControl({
  card,
  onAppeal,
}: {
  card: AppealableCard;
  onAppeal?:
    ((cardId: number, comment: string | null) => Promise<void>) | undefined;
}) {
  const [appealing, setAppealing] = useState(false);
  const [comment, setComment] = useState('');
  const [appealSent, setAppealSent] = useState(card.appealStatus !== null);
  const [appealError, setAppealError] = useState<string | null>(null);
  const prefix = card.label ? `${card.label}: ` : '';
  const submitAppeal = async () => {
    if (!onAppeal) return;
    setAppealError(null);
    try {
      await onAppeal(card.id, comment.trim() || null);
      setAppealSent(true);
      setAppealing(false);
    } catch {
      setAppealError(
        '異議を送れませんでした。時間をおいて、もう一度ためしてください。',
      );
    }
  };
  return (
    <div className={styles.appealCard}>
      {appealSent || card.appealStatus ? (
        <DialogSubText>
          {prefix}異議を送りました。審判が72時間以内を目安に確認します。
        </DialogSubText>
      ) : appealing ? (
        <div className={styles.appeal}>
          <label className={styles.appealLabel}>
            {prefix}審判へのコメント(任意・200字まで)
            <textarea
              aria-label={`${prefix}審判へのコメント`}
              value={comment}
              maxLength={200}
              onChange={(event) => setComment(event.target.value)}
            />
          </label>
          {appealError && (
            <p className={styles.error} role="alert">
              {appealError}
            </p>
          )}
          <Button size="small" onClick={() => void submitAppeal()}>
            {card.label ? `異議を送る(${card.label})` : '異議を送る'}
          </Button>
        </div>
      ) : onAppeal ? (
        <button
          type="button"
          className={styles.appealLink}
          onClick={() => setAppealing(true)}
        >
          {prefix}間違いだと思ったら、審判に異議を送る
        </button>
      ) : null}
    </div>
  );
}
