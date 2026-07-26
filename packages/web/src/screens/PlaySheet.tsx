import { useState } from 'react';

import { Button } from '../components/Button';
import { ChoiceSheet } from '../components/ChoiceSheet';
import { InputField } from '../components/Field';

import styles from './PlaySheet.module.css';

type PlaySheetProps = {
  onCreate: () => void;
  onJoin: (code: string) => void;
  onClose: () => void;
  error?: string | null;
};

/**
 * 「あそぶ」を押したときに下から出る二択。
 *
 * ワイヤーの画面 2a(ルーム作成・参加)を独立した画面として挟むと、
 * 情報量の薄い 1 画面のためにタップが 1 回増える。選択肢は 2 つしかないので、
 * その場で開いて決めさせ、「つくる」なら待機画面へ直行する。
 */
export function PlaySheet({
  onCreate,
  onJoin,
  onClose,
  error,
}: PlaySheetProps) {
  const [code, setCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  return (
    <ChoiceSheet
      label="じぶんの部屋をつくるか、友だちの部屋にはいる"
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
      ) : (
        <>
          {/*
           * 2 つの選択肢は「じぶん / 友だち」「つくる / はいる」で対比させる。
           * どちらを押すかは「コードをもらっているか」で決まるので、
           * 人数(4 人固定)はここで意識させる情報ではない。
           */}
          <Button variant="primary" block onClick={onCreate}>
            じぶんの部屋をつくる
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
