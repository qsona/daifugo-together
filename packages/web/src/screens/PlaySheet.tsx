import { clientPayloadSchemas, type RoomMode } from '@daifugo/core';
import { useId, useState } from 'react';

import { Button } from '../components/Button';
import { ChoiceSheet } from '../components/ChoiceSheet';
import { InputField } from '../components/Field';
import { JOIN_FRIEND_ROOM_LABEL } from '../messages';

import styles from './PlaySheet.module.css';

type PlaySheetProps = {
  onCreate: (mode: RoomMode) => void;
  onJoin: (code: string, displayName?: string) => void;
  onClose: () => void;
  /** 匿名ユーザーの現在の表示名。指定時だけ入室前の名前入力を出す。 */
  anonymousDisplayName?: string | null;
  /** 招待リンクから開いたときの初期コード。この場合は参加フォームから始める。 */
  initialInviteCode?: string;
  initialMode?: RoomMode | null;
  error?: string | null;
};

type Step = 'root' | 'community' | 'join';

/**
 * 「あそぶ」を押したときに下から出る選択シート。
 *
 * 最初の軸は「だれとあそぶか」: みんなのルール(マルチ)へ進むか、
 * ひとりで練習(きほん)を始めるか。みんなのルールを選ぶと同じシート内で
 * 部屋を立てるか招待コードで入るかを選ぶ。招待リンクから開いたときは
 * コード入力から始まり、部屋側のモードに従う。
 */
export function PlaySheet({
  onCreate,
  onJoin,
  onClose,
  anonymousDisplayName,
  initialInviteCode,
  initialMode = null,
  error,
}: PlaySheetProps) {
  /**
   * 練習ボタンのラベルとキャプションを結ぶ id。
   * キャプションはボタンの中にあるので、放っておくとアクセシブル名に連結される。
   * 名前はラベルだけ、キャプションは説明として支援技術へ渡す。
   */
  const practiceId = useId();
  const practiceLabelId = `${practiceId}-label`;
  const practiceCaptionId = `${practiceId}-caption`;
  const [code, setCode] = useState(
    () => initialInviteCode?.replaceAll(/[^0-9]/g, '').slice(0, 5) ?? '',
  );
  const [displayName, setDisplayName] = useState(anonymousDisplayName ?? '');
  const [step, setStep] = useState<Step>(() => {
    if (initialInviteCode !== undefined) return 'join';
    if (initialMode === 'community') return 'community';
    return 'root';
  });
  /**
   * エラーは受け取った時点の step に属するので、step を移ったら消す。
   * (友だちの部屋で出た文言がモード選択に残るのを防ぐ)
   *
   * 判定はプロップの値の変化で見ているので、同じ文字列のエラーが step を
   * 跨いで連続して再発したとき(通信断などで両方が同じ汎用文言になる場合)は
   * 2度目が出ない。頻度が低く実害も小さいので、ここでは受け入れる。
   */
  const [errorAt, setErrorAt] = useState({ error, step });
  if (errorAt.error !== error) setErrorAt({ error, step });
  const visibleError =
    errorAt.error === error && errorAt.step === step ? error : null;
  const isJoining = step === 'join';
  const asksDisplayName = anonymousDisplayName !== undefined;
  const parsedDisplayName = asksDisplayName
    ? clientPayloadSchemas['user:rename'].safeParse({ displayName })
    : null;
  const normalizedDisplayName =
    parsedDisplayName?.success === true
      ? parsedDisplayName.data.displayName
      : undefined;
  const displayNameError =
    asksDisplayName && displayName.length > 0 && !normalizedDisplayName
      ? 'なまえは1〜10文字で、改行なしで入力してください'
      : undefined;

  return (
    <ChoiceSheet
      label={
        isJoining
          ? JOIN_FRIEND_ROOM_LABEL
          : step === 'community'
            ? 'みんなのルールであそぶ'
            : 'あそびかたをえらぶ'
      }
      onClose={onClose}
    >
      {isJoining ? (
        <>
          <InputField
            label="招待コード"
            placeholder="例: 01234"
            value={code}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={5}
            autoComplete="off"
            autoFocus
            onChange={(event) => {
              setCode(event.target.value.replaceAll(/[^0-9]/g, '').slice(0, 5));
            }}
          />
          {asksDisplayName && (
            <InputField
              label="あなたのなまえ"
              caption="友だちに見えるなまえ・10文字まで"
              {...(displayNameError ? { error: displayNameError } : {})}
              placeholder="例: たろう"
              value={displayName}
              type="text"
              autoComplete="nickname"
              onChange={(event) => {
                setDisplayName(event.target.value);
              }}
            />
          )}
          <Button
            variant="primary"
            block
            disabled={
              code.length !== 5 ||
              (asksDisplayName && normalizedDisplayName === undefined)
            }
            onClick={() => {
              if (normalizedDisplayName === undefined) {
                onJoin(code);
                return;
              }
              onJoin(code, normalizedDisplayName);
            }}
          >
            はいる
          </Button>
          {visibleError && <p role="alert">{visibleError}</p>}
          <div className={styles.back}>
            <Button
              size="small"
              onClick={() => {
                setStep('community');
              }}
            >
              もどる
            </Button>
          </div>
        </>
      ) : step === 'community' ? (
        <>
          <Button
            variant="primary"
            block
            onClick={() => {
              onCreate('community');
            }}
          >
            部屋を立てる
          </Button>
          <Button
            block
            onClick={() => {
              setStep('join');
            }}
          >
            {JOIN_FRIEND_ROOM_LABEL}
          </Button>
          {visibleError && <p role="alert">{visibleError}</p>}
          <div className={styles.back}>
            <Button
              size="small"
              onClick={() => {
                setStep('root');
              }}
            >
              もどる
            </Button>
          </div>
        </>
      ) : (
        <>
          <Button
            variant="primary"
            block
            onClick={() => {
              setStep('community');
            }}
          >
            みんなのルールであそぶ
          </Button>
          <Button
            block
            aria-labelledby={practiceLabelId}
            aria-describedby={practiceCaptionId}
            onClick={() => {
              onCreate('basic');
            }}
          >
            <span className={styles.modeStack}>
              <span className={styles.modeLabel} id={practiceLabelId}>
                <span>ひとりで練習する</span>
                <svg
                  className={styles.beginnerIcon}
                  viewBox="0 0 32 32"
                  aria-hidden="true"
                >
                  <path
                    className={styles.beginnerIconLeft}
                    d="M16 27C9.5 23.8 5.5 18.2 5.5 8.5c5.2.5 8.6 2.7 10.5 6.1V27Z"
                  />
                  <path
                    className={styles.beginnerIconRight}
                    d="M16 27c6.5-3.2 10.5-8.8 10.5-18.5-5.2.5-8.6 2.7-10.5 6.1V27Z"
                  />
                  <path className={styles.beginnerIconLine} d="M16 14.5V27" />
                </svg>
              </span>
              <span className={styles.modeCaption} id={practiceCaptionId}>
                大富豪がはじめての人はこちら
              </span>
            </span>
          </Button>
          {visibleError && <p role="alert">{visibleError}</p>}
        </>
      )}
    </ChoiceSheet>
  );
}
