import { useState } from 'react';

import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { InputField } from '../components/Field';
import { SegmentedControl } from '../components/SegmentedControl';

import screen from './screen.module.css';

type Mode = 'create' | 'join';

type RoomEntryScreenProps = {
  onBack: () => void;
  onCreate: () => void;
  onJoin: (inviteCode: string) => void;
};

/**
 * 画面 2a: ルーム作成・参加。
 * 対戦人数は 4 人固定で、人間/AI の枠指定 UI は置かない(企画書 §3.2)。
 */
export function RoomEntryScreen({
  onBack,
  onCreate,
  onJoin,
}: RoomEntryScreenProps) {
  const [mode, setMode] = useState<Mode>('create');
  const [inviteCode, setInviteCode] = useState('');

  return (
    <div className={screen.screen}>
      <AppBar title="あそぶ" onBack={onBack} />
      <main className={screen.body}>
        <SegmentedControl
          label="ルームのはじめかた"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'create', label: 'ルームをつくる' },
            { value: 'join', label: '招待コードではいる' },
          ]}
        />

        {mode === 'create' ? (
          <>
            {/*
             * 人数選択 UI が無い時点で 4 人固定は自明なので説明文は置かず、
             * 人数だけを CTA の文言に畳み込む(UI文言ガイド 原則 2)。
             * AI 自動補充は次の待機画面の空席タグが見せる。
             */}
            <div className={screen.footer}>
              <Button variant="primary" block onClick={onCreate}>
                4人でルームをつくる
              </Button>
            </div>
          </>
        ) : (
          <>
            <InputField
              label="招待コード"
              placeholder="例: ABCD-1234"
              value={inviteCode}
              autoComplete="off"
              onChange={(event) => {
                setInviteCode(event.target.value);
              }}
            />
            <div className={screen.footer}>
              <Button
                variant="primary"
                block
                disabled={inviteCode.trim() === ''}
                onClick={() => {
                  onJoin(inviteCode.trim());
                }}
              >
                このコードではいる
              </Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
