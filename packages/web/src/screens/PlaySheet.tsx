import type { RoomMode } from '@daifugo/core';
import { useState } from 'react';

import { Button } from '../components/Button';
import { ChoiceSheet } from '../components/ChoiceSheet';
import { InputField } from '../components/Field';
import { Tag } from '../components/Tag';

import styles from './PlaySheet.module.css';

type PlaySheetProps = {
  onCreate: (mode: RoomMode) => void;
  onJoin: (code: string) => void;
  onClose: () => void;
  playedBefore?: boolean;
  error?: string | null;
};

/**
 * 「あそぶ」を押したときに下から出る選択シート。
 *
 * 部屋を作る人だけがモードを選ぶ。招待された人はモードを選ばず、
 * 同じシートから招待コード入力へ進んで部屋側のモードに従う。
 */
export function PlaySheet({
  onCreate,
  onJoin,
  onClose,
  playedBefore = false,
  error,
}: PlaySheetProps) {
  const [mode, setMode] = useState<RoomMode | null>(null);
  const [code, setCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  return (
    <ChoiceSheet
      label={
        isJoining
          ? '友だちの部屋にはいる'
          : mode === null
            ? 'あそぶモードをえらぶ'
            : 'じぶんの部屋をつくる'
      }
      onClose={onClose}
    >
      {isJoining ? (
        <>
          <InputField
            label="招待コード"
            placeholder="例: ABCD-1234"
            value={code}
            autoComplete="off"
            autoFocus
            onChange={(event) => {
              setCode(event.target.value);
            }}
          />
          <Button
            variant="primary"
            block
            disabled={code.trim() === ''}
            onClick={() => {
              onJoin(code.trim());
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
      ) : mode === null ? (
        <>
          <Button
            variant="primary"
            block
            onClick={() => {
              setMode('basic');
            }}
          >
            きほん
            {!playedBefore && (
              <Tag variant="active">はじめてのひとはこちら</Tag>
            )}
          </Button>
          <Button
            block
            onClick={() => {
              setMode('community');
            }}
          >
            みんなのルール
          </Button>
          <Button
            block
            onClick={() => {
              setIsJoining(true);
            }}
          >
            友だちの部屋にはいる
          </Button>
        </>
      ) : (
        <>
          <Button
            variant="primary"
            block
            onClick={() => {
              onCreate(mode);
            }}
          >
            じぶんの部屋をつくる
          </Button>
          {error && <p role="alert">{error}</p>}
          <div className={styles.back}>
            <Button
              size="small"
              onClick={() => {
                setMode(null);
              }}
            >
              もどる
            </Button>
          </div>
        </>
      )}
    </ChoiceSheet>
  );
}
