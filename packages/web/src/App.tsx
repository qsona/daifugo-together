import { useState } from 'react';

import type { RuleVote, SetFunRating } from './screens/SetResultScreen';
import {
  DEMO_ACTIVE_RULE_COUNT,
  DEMO_FIELD,
  DEMO_FIRED_RULES,
  DEMO_GAME_RANKS,
  DEMO_HAND,
  DEMO_INVITE_CODE,
  DEMO_LOG,
  DEMO_MEMBERS,
  DEMO_SEATS,
  DEMO_SET_RANKS,
} from './fixtures/demo';
import { GameResultScreen } from './screens/GameResultScreen';
import { GameScreen } from './screens/GameScreen';
import { MenuScreen } from './screens/MenuScreen';
import { RoomEntryScreen } from './screens/RoomEntryScreen';
import { SetResultScreen } from './screens/SetResultScreen';
import { TitleScreen } from './screens/TitleScreen';
import { WaitingRoomScreen } from './screens/WaitingRoomScreen';
import { useScreenStore } from './store/screen';

/**
 * フェーズ 1 の画面の組み立て。
 * 各画面は表示専用で、ここが渡しているのは固定データ(`fixtures/demo`)。
 * サーバースナップショットの接続と合法手の判定は E1/E3 の責務。
 */
export function App() {
  const current = useScreenStore((state) => state.current);
  const go = useScreenStore((state) => state.go);

  const [selectedCardIds, setSelectedCardIds] = useState<readonly string[]>([]);
  const [funRating, setFunRating] = useState<SetFunRating | null>(null);
  const [ruleVotes, setRuleVotes] = useState(DEMO_FIRED_RULES);

  const toggleCard = (id: string) => {
    setSelectedCardIds((ids) =>
      ids.includes(id) ? ids.filter((it) => it !== id) : [...ids, id],
    );
  };

  const voteRule = (ruleId: string, vote: RuleVote) => {
    setRuleVotes((rules) =>
      rules.map((rule) => (rule.ruleId === ruleId ? { ...rule, vote } : rule)),
    );
  };

  switch (current) {
    case 'title':
      return (
        <TitleScreen
          onStart={() => {
            go('menu');
          }}
        />
      );

    case 'menu':
      return (
        <MenuScreen
          onPlay={() => {
            go('roomEntry');
          }}
          // フェーズ 2 の画面(6・8・7・あそびかた)は E5/E11 が足す。
          onPropose={() => undefined}
          onEncyclopedia={() => undefined}
          onMyProposals={() => undefined}
          onHowToPlay={() => undefined}
        />
      );

    case 'roomEntry':
      return (
        <RoomEntryScreen
          onBack={() => {
            go('menu');
          }}
          onCreate={() => {
            go('waitingRoom');
          }}
          onJoin={() => {
            go('waitingRoom');
          }}
        />
      );

    case 'waitingRoom':
      return (
        <WaitingRoomScreen
          members={DEMO_MEMBERS}
          inviteCode={DEMO_INVITE_CODE}
          activeRuleCount={DEMO_ACTIVE_RULE_COUNT}
          onBack={() => {
            go('roomEntry');
          }}
          onCopyInvite={() => undefined}
          onViewRules={() => undefined}
          onStart={() => {
            go('game');
          }}
        />
      );

    case 'game':
      return (
        <GameScreen
          progressLabel="第1戦(3巡目)"
          activeRuleCount={DEMO_ACTIVE_RULE_COUNT}
          seats={DEMO_SEATS}
          field={DEMO_FIELD}
          firedRule={{ name: '8切り', effect: '場が流れます' }}
          log={DEMO_LOG}
          hand={DEMO_HAND}
          selectedCardIds={selectedCardIds}
          isMyTurn
          onViewRules={() => undefined}
          onToggleCard={toggleCard}
          onPlay={() => {
            setSelectedCardIds([]);
            go('gameResult');
          }}
          onPass={() => {
            go('gameResult');
          }}
        />
      );

    case 'gameResult':
      return (
        <GameResultScreen
          title="第1戦 おわり"
          progressLabel="セット 1 / 3 戦"
          ranks={DEMO_GAME_RANKS}
          nextLabel="第2戦へ"
          onNext={() => {
            go('setResult');
          }}
        />
      );

    case 'setResult':
      return (
        <SetResultScreen
          ranks={DEMO_SET_RANKS}
          funRating={funRating}
          firedRules={ruleVotes}
          onChangeFunRating={setFunRating}
          onVoteRule={voteRule}
          onPlayAgain={() => {
            go('game');
          }}
          onHome={() => {
            go('menu');
          }}
        />
      );
  }
}
