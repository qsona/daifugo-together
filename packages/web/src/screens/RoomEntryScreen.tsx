import { useState } from 'react';

import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { Callout } from '../components/Callout';
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
            <Callout>
              対戦人数は 4 人。人間/AI
              の枠を決める操作はありません。開始したとき、足りない分は AI
              プレイヤーが自動で入ります。
            </Callout>
            <div className={screen.footer}>
              <Button variant="primary" block onClick={onCreate}>
                ルームをつくる
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 className={screen.sectionTitle}>招待された人は</h2>
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
