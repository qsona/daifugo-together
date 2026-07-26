import { useState } from 'react';

import { Button } from '../components/Button';
import { ChoiceSheet } from '../components/ChoiceSheet';
import { InputField } from '../components/Field';

import styles from './PlaySheet.module.css';

type PlaySheetProps = {
  onCreate: () => void;
  onJoin: (code: string) => void;
  onClose: () => void;
};

/**
 * 「あそぶ」を押したときに下から出る二択。
 *
 * ワイヤーの画面 2a(ルーム作成・参加)を独立した画面として挟むと、
 * 情報量の薄い 1 画面のためにタップが 1 回増える。選択肢は 2 つしかないので、
 * その場で開いて決めさせ、「つくる」なら待機画面へ直行する。
 */
export function PlaySheet({ onCreate, onJoin, onClose }: PlaySheetProps) {
  const [code, setCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  return (
    <ChoiceSheet label="ルームをつくるか、招待コードではいる" onClose={onClose}>
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
          {/* 人数は選べないので、説明文にせず CTA に畳み込む。 */}
          <Button variant="primary" block onClick={onCreate}>
            4人でルームをつくる
          </Button>
          <Button
            block
            onClick={() => {
              setIsJoining(true);
            }}
          >
            招待コードではいる
          </Button>
        </>
      )}
    </ChoiceSheet>
  );
}
