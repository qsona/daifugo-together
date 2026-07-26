import { ActivationChip } from '../components/ActivationChip';
import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import type { CardView } from '../components/Card';
import { FieldArea } from '../components/FieldArea';
import type { FieldStack } from '../components/FieldArea';
import { HandTray } from '../components/HandTray';
import { PlayerSeats } from '../components/PlayerSeat';
import type { SeatView } from '../components/PlayerSeat';
import { RuleCutIn } from '../components/RuleCutIn';
import type { RuleActivation } from '../components/RuleCutIn';

import screen from './screen.module.css';

type GameScreenProps = {
  /** セット内の何戦目か。巡目は誰の判断にも使われないので出さない。 */
  gameLabel: string;
  activeRuleCount: number;
  seats: readonly SeatView[];
  /** 場はプレイヤーごとの札山。実際の卓と同じく自分の出した札に重ねていく。 */
  fieldStacks: readonly FieldStack[];
  /** いま超えるべきプレイの持ち主。場が流れていれば null。 */
  leadPlayerName: string | null;
  isFlushing?: boolean;
  /** 再生中のカットイン。空なら出さない。 */
  activations: readonly RuleActivation[];
  onCutInDone: () => void;
  /** カットインが引いたあとに残る直近の発動。 */
  lastActivation: { name: string; count: number } | null;
  hand: readonly CardView[];
  selectedCardIds: readonly string[];
  isMyTurn: boolean;
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
  fieldStacks,
  leadPlayerName,
  isFlushing,
  activations,
  onCutInDone,
  lastActivation,
  hand,
  selectedCardIds,
  isMyTurn,
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
        <PlayerSeats seats={seats} />
        <FieldArea
          stacks={fieldStacks}
          leadPlayerName={leadPlayerName}
          {...(isFlushing === undefined ? {} : { isFlushing })}
        />
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
              <Button disabled={!isMyTurn} onClick={onPass}>
                パス
              </Button>
              <Button
                variant="primary"
                disabled={!isMyTurn || selectedCardIds.length === 0}
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
