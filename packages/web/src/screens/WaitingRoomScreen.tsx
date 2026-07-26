import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
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
        {/*
         * 見出しはどれも部品自身が語っているので置かない。
         * 席が 4 つ並んでいること・空席のタグ・InviteCode 内のラベルで足りる
         * (UI文言ガイド 原則 2・3)。
         */}
        <MemberList members={members} />
        <InviteCode code={inviteCode} onCopy={onCopyInvite} />
        {/*
         * ルールセットは選べないので「変更不可」は書かない。対局画面と同じ語彙にする。
         * 主導線は「開始する」なので、脇道であることが分かる大きさに留める。
         */}
        <div className={screen.inlineAction}>
          <Button size="small" onClick={onViewRules}>
            有効ルール {activeRuleCount}
          </Button>
        </div>

        <div className={screen.footer}>
          <Button variant="primary" block onClick={onStart}>
            開始する
          </Button>
        </div>
      </main>
    </div>
  );
}
