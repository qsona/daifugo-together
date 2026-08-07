import type { RoomMode, SeatOption } from '@daifugo/core';
import { useId, useState } from 'react';

import { Button } from '../components/Button';
import { ChoiceSheet } from '../components/ChoiceSheet';
import { InputField } from '../components/Field';
import { NameField, validateDisplayName } from '../components/NameField';
import { JOIN_FRIEND_ROOM_LABEL } from '../messages';

import styles from './PlaySheet.module.css';

type PlaySheetProps = {
  onCreate: (mode: RoomMode) => void;
  onJoin: (code: string, displayName?: string) => void;
  onTakeover?: (memberId: string) => void;
  onBackFromSeatChoice?: () => void;
  onClose: () => void;
  /** 匿名ユーザーの現在の表示名。指定時だけ入室前の名前入力を出す。 */
  anonymousDisplayName?: string | null;
  /** 招待リンクから開いたときの初期コード。この場合は参加フォームから始める。 */
  initialInviteCode?: string;
  initialMode?: RoomMode | null;
  error?: string | null;
  seatOptions?: readonly SeatOption[] | null;
  takeoverPendingMemberId?: string | null;
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
  onTakeover = () => undefined,
  onBackFromSeatChoice = () => undefined,
  onClose,
  anonymousDisplayName,
  initialInviteCode,
  initialMode = null,
  error,
  seatOptions = null,
  takeoverPendingMemberId = null,
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
  const isChoosingSeat = seatOptions !== null;
  const asksDisplayName = anonymousDisplayName !== undefined;
  const parsedDisplayName = asksDisplayName
    ? validateDisplayName(displayName)
    : null;
  const normalizedDisplayName =
    parsedDisplayName?.ok === true ? parsedDisplayName.displayName : undefined;

  return (
    <ChoiceSheet
      label={
        isChoosingSeat
          ? '途中参加する席をえらぶ'
          : isJoining
            ? JOIN_FRIEND_ROOM_LABEL
            : step === 'community'
              ? 'みんなのルールであそぶ'
              : 'あそびかたをえらぶ'
      }
      onClose={onClose}
    >
      {isChoosingSeat ? (
        <>
          <p className={styles.seatHelp}>
            この席の手札と、このセットの成績を引き継ぎます。
          </p>
          {seatOptions.length === 0 ? (
            <p role="status">満席のため参加できません</p>
          ) : (
            <div className={styles.seatList}>
              {seatOptions.map((seat) => (
                <Button
                  key={seat.memberId}
                  block
                  disabled={takeoverPendingMemberId !== null}
                  onClick={() => onTakeover(seat.memberId)}
                >
                  <span className={styles.seatCard}>
                    <strong>{seat.displayName}</strong>
                    {seat.previousRank !== null && (
                      <span>{rankLabel(seat.previousRank)}</span>
                    )}
                    {seat.handCount !== null && (
                      <span>残り {String(seat.handCount)}枚</span>
                    )}
                    {seat.handCount === 0 && (
                      <span className={styles.modeCaption}>
                        このゲームは終了済みです
                      </span>
                    )}
                    <span>この席に入る</span>
                  </span>
                </Button>
              ))}
            </div>
          )}
          {visibleError && <p role="alert">{visibleError}</p>}
          <div className={styles.back}>
            <Button size="small" onClick={onBackFromSeatChoice}>
              もどる
            </Button>
          </div>
        </>
      ) : isJoining ? (
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
            <NameField
              label="なまえ"
              value={displayName}
              onChange={setDisplayName}
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
                <span>きほんルールで練習する</span>
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

function rankLabel(rank: SeatOption['previousRank']): string {
  return (
    {
      1: '前回 大富豪',
      2: '前回 富豪',
      3: '前回 貧民',
      4: '前回 大貧民',
    } as const
  )[rank ?? 4];
}
