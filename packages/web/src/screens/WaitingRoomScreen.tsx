import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { Callout } from '../components/Callout';
import { InviteCode } from '../components/InviteCode';
import { MemberList } from '../components/MemberList';
import type { MemberView } from '../components/MemberList';

import screen from './screen.module.css';

type WaitingRoomScreenProps = {
  members: readonly MemberView[];
  inviteCode: string;
  /** 有効ルールの件数。適用ルールセットは選べない(全体共有)。 */
  activeRuleCount: number;
  onBack: () => void;
  onCopyInvite: () => void;
  onViewRules: () => void;
  onStart: () => void;
};

/**
 * 画面 2b: 待機画面。
 * 4 人固定・AI 自動補充のため、人間/AI の枠指定 UI は置かない(企画書 §3.2)。
 */
export function WaitingRoomScreen({
  members,
  inviteCode,
  activeRuleCount,
  onBack,
  onCopyInvite,
  onViewRules,
  onStart,
}: WaitingRoomScreenProps) {
  const humanCount = members.filter((member) => member.kind === 'human').length;

  return (
    <div className={screen.screen}>
      <AppBar
        title="待機中"
        onBack={onBack}
        action={{ label: `${String(humanCount)} / 4 人` }}
      />
      <main className={screen.body}>
        <h2 className={screen.sectionTitle}>参加メンバー(4 人で対戦)</h2>
        <MemberList members={members} />

        <h2 className={screen.sectionTitle}>友だちをさそう</h2>
        <InviteCode code={inviteCode} onCopy={onCopyInvite} />

        <h2 className={screen.sectionTitle}>いまのルール</h2>
        <Callout
          action={
            <Button size="small" onClick={onViewRules}>
              一覧を見る
            </Button>
          }
        >
          {activeRuleCount} 件・すべての卓に適用(変更不可)
        </Callout>

        <div className={screen.footer}>
          <Button variant="primary" block onClick={onStart}>
            開始する
          </Button>
          <Callout>
            開始した時点で足りない分は AI プレイヤーが入ります。
          </Callout>
        </div>
      </main>
    </div>
  );
}
