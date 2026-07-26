import { useEffect, useState } from 'react';

import { ActivationChip } from '../components/ActivationChip';
import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import type { CardView } from '../components/Card';
import { HandTray } from '../components/HandTray';
import { RuleCutIn } from '../components/RuleCutIn';
import type { RuleActivation } from '../components/RuleCutIn';
import { Table } from '../components/Table';
import type { TableSeat } from '../components/Table';

import screen from './screen.module.css';

type GameScreenProps = {
  /** セット内の何戦目か。巡目は誰の判断にも使われないので出さない。 */
  gameLabel: string;
  activeRuleCount: number;
  /** 自分を先頭に、手番が回る順(時計回り)で 4 人。席と場は卓に統合した。 */
  seats: readonly TableSeat[];
  /** いま超えるべきプレイの持ち主。場が流れていれば null。 */
  leadSeatName: string | null;
  isFlushing?: boolean;
  /** 再生中のカットイン。空なら出さない。 */
  activations: readonly RuleActivation[];
  onCutInDone: () => void;
  /** カットインが引いたあとに残る直近の発動。 */
  lastActivation: { name: string; count: number } | null;
  hand: readonly CardView[];
  selectedCardIds: readonly string[];
  isMyTurn: boolean;
  canPlay?: boolean;
  canPass?: boolean;
  turnDeadlineAt?: number | null;
  onViewRules: () => void;
  onToggleCard: (id: string) => void;
  onPlay: () => void;
  onPass: () => void;
};

/**
 * 画面 3: 対戦画面。
 *
 * 文字の実況ログは置かない。「誰が何を出したか」は場の札山が常時見せ、
 * 「何が起きたか」はカットインと盤面のアニメーションが見せる。
 */
export function GameScreen({
  gameLabel,
  activeRuleCount,
  seats,
  leadSeatName,
  isFlushing,
  activations,
  onCutInDone,
  lastActivation,
  hand,
  selectedCardIds,
  isMyTurn,
  canPlay,
  canPass = true,
  turnDeadlineAt,
  onViewRules,
  onToggleCard,
  onPlay,
  onPass,
}: GameScreenProps) {
  return (
    <div className={screen.screen}>
      <AppBar
        title={gameLabel}
        action={{
          label: `有効ルール ${String(activeRuleCount)}`,
          onClick: onViewRules,
        }}
      />
      <main className={screen.body}>
        <Table
          seats={seats}
          leadSeatName={leadSeatName}
          {...(isFlushing === undefined ? {} : { isFlushing })}
        />
        {turnDeadlineAt != null && (
          <TurnCountdown deadlineAt={turnDeadlineAt} />
        )}
        {/* チップはカットインが引いたあとの痕跡なので、再生中は出さない。 */}
        {lastActivation && activations.length === 0 && (
          <ActivationChip
            name={lastActivation.name}
            count={lastActivation.count}
            onOpen={onViewRules}
          />
        )}
        <HandTray
          cards={hand}
          selectedIds={selectedCardIds}
          onToggle={onToggleCard}
          actions={
            <>
              <Button disabled={!isMyTurn || !canPass} onClick={onPass}>
                パス
              </Button>
              <Button
                variant="primary"
                disabled={!isMyTurn || !(canPlay ?? selectedCardIds.length > 0)}
                onClick={onPlay}
              >
                えらんだカードを出す
              </Button>
            </>
          }
        />
      </main>
      <RuleCutIn activations={activations} onDone={onCutInDone} />
    </div>
  );
}

function TurnCountdown({ deadlineAt }: { deadlineAt: number }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000)),
  );
  useEffect(() => {
    const update = () => {
      setRemaining(Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000)));
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [deadlineAt]);
  return <p role="timer">残り {remaining} 秒</p>;
}
