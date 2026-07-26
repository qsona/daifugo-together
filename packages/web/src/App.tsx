import { useCallback, useState } from 'react';

import type { RuleVote, SetFunRating } from './screens/SetResultScreen';
import {
  DEMO_ACTIVATION_VOLLEYS,
  DEMO_ACTIVE_RULE_COUNT,
  DEMO_FIELD_STACKS,
  DEMO_FIRED_RULES,
  DEMO_GAME_RANKS,
  DEMO_HAND,
  DEMO_INVITE_CODE,
  DEMO_LEAD_PLAYER,
  DEMO_MEMBERS,
  DEMO_SEATS,
  DEMO_SET_RANKS,
} from './fixtures/demo';
import { GameResultScreen } from './screens/GameResultScreen';
import { GameScreen } from './screens/GameScreen';
import { MenuScreen } from './screens/MenuScreen';
import { PlaySheet } from './screens/PlaySheet';
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
  /** 見本のカットインを順に再生するための位置。null は再生していない状態。 */
  const [isChoosingRoom, setIsChoosingRoom] = useState(false);
  const [volleyIndex, setVolleyIndex] = useState<number | null>(null);
  const [lastVolleyIndex, setLastVolleyIndex] = useState<number | null>(null);

  const activations =
    volleyIndex === null ? [] : (DEMO_ACTIVATION_VOLLEYS[volleyIndex] ?? []);
  const lastVolley =
    lastVolleyIndex === null
      ? null
      : (DEMO_ACTIVATION_VOLLEYS[lastVolleyIndex] ?? null);

  const playNextVolley = () => {
    const next =
      lastVolleyIndex === null
        ? 0
        : (lastVolleyIndex + 1) % DEMO_ACTIVATION_VOLLEYS.length;
    setVolleyIndex(next);
    setLastVolleyIndex(next);
  };

  const finishCutIn = useCallback(() => {
    setVolleyIndex(null);
  }, []);

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
        <>
          <MenuScreen
            onPlay={() => {
              setIsChoosingRoom(true);
            }}
            // フェーズ 2 の画面(6・8・7・あそびかた)は E5/E11 が足す。
            onPropose={() => undefined}
            onEncyclopedia={() => undefined}
            onMyProposals={() => undefined}
            onHowToPlay={() => undefined}
          />
          {isChoosingRoom && (
            <PlaySheet
              onCreate={() => {
                setIsChoosingRoom(false);
                go('waitingRoom');
              }}
              onJoin={() => {
                setIsChoosingRoom(false);
                go('waitingRoom');
              }}
              onClose={() => {
                setIsChoosingRoom(false);
              }}
            />
          )}
        </>
      );

    case 'waitingRoom':
      return (
        <WaitingRoomScreen
          members={DEMO_MEMBERS}
          inviteCode={DEMO_INVITE_CODE}
          activeRuleCount={DEMO_ACTIVE_RULE_COUNT}
          onBack={() => {
            go('menu');
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
          gameLabel="第1戦"
          activeRuleCount={DEMO_ACTIVE_RULE_COUNT}
          seats={DEMO_SEATS}
          fieldStacks={DEMO_FIELD_STACKS}
          leadPlayerName={DEMO_LEAD_PLAYER}
          activations={activations}
          onCutInDone={finishCutIn}
          lastActivation={
            lastVolley && lastVolley[0]
              ? { name: lastVolley[0].name, count: lastVolley.length }
              : null
          }
          hand={DEMO_HAND}
          selectedCardIds={selectedCardIds}
          isMyTurn
          onViewRules={() => undefined}
          onToggleCard={toggleCard}
          onPlay={() => {
            setSelectedCardIds([]);
            // 見本のため、カードを出すたびにカットインの 3 パターンを順に再生する。
            playNextVolley();
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
          autoAdvanceMs={5000}
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
