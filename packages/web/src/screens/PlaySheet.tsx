import { clientPayloadSchemas, type RoomMode } from '@daifugo/core';
import { useState } from 'react';

import { Button } from '../components/Button';
import { ChoiceSheet } from '../components/ChoiceSheet';
import { InputField } from '../components/Field';

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

/**
 * 「あそぶ」を押したときに下から出る選択シート。
 *
 * 部屋を作る人はモードを選ぶとそのまま作成する。招待された人は
 * モードを選ばず、同じシートから招待コード入力へ進んで部屋側のモードに従う。
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
  const [code, setCode] = useState(
    () => initialInviteCode?.replaceAll(/[^0-9]/g, '').slice(0, 5) ?? '',
  );
  const [displayName, setDisplayName] = useState(anonymousDisplayName ?? '');
  const [isJoining, setIsJoining] = useState(initialInviteCode !== undefined);
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
      ? 'なまえは1〜10文字で、改行なしで入力してね'
      : undefined;

  return (
    <ChoiceSheet
      label={isJoining ? '友だちの部屋にはいる' : 'あそびかたをえらぶ'}
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
          {error && <p role="alert">{error}</p>}
          <div className={styles.back}>
            <Button
              size="small"
              onClick={() => {
                setIsJoining(false);
              }}
            >
              もどる
            </Button>
          </div>
        </>
      ) : (
        <>
          <Button
            block
            onClick={() => {
              onCreate('basic');
            }}
          >
            <span className={styles.modeLabel}>
              <span>きほんルールであそぶ</span>
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
          </Button>
          <Button
            variant={initialMode === 'community' ? 'primary' : 'secondary'}
            block
            onClick={() => {
              onCreate('community');
            }}
          >
            みんなのルールであそぶ
          </Button>
          <Button
            block
            onClick={() => {
              setIsJoining(true);
            }}
          >
            友だちの部屋にはいる
          </Button>
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </ChoiceSheet>
  );
}
