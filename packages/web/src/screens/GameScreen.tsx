import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import type { CardView } from '../components/Card';
import { FieldArea } from '../components/FieldArea';
import { HandTray } from '../components/HandTray';
import { Log } from '../components/Log';
import type { LogEntry } from '../components/Log';
import { PlayerSeats } from '../components/PlayerSeat';
import type { SeatView } from '../components/PlayerSeat';
import { Toast } from '../components/Toast';

import screen from './screen.module.css';

type GameScreenProps = {
  /** セット内の何戦目か + 巡目。 */
  progressLabel: string;
  activeRuleCount: number;
  seats: readonly SeatView[];
  field: readonly CardView[];
  /** 直近のルール発動。無ければバナーを出さない。 */
  firedRule: { name: string; effect: string } | null;
  log: readonly LogEntry[];
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
 * 状態と合法手の判定はエンジン/サーバの関心なので、この画面は props をそのまま描くだけ。
 * ルール発動の強調は金(2A の役割「金=注意・強調」)へ写像する。
 */
export function GameScreen({
  progressLabel,
  activeRuleCount,
  seats,
  field,
  firedRule,
  log,
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
        title={progressLabel}
        action={{
          label: `有効ルール ${String(activeRuleCount)}`,
          onClick: onViewRules,
        }}
      />
      <main className={screen.body}>
        <PlayerSeats seats={seats} />
        <FieldArea cards={field} />
        {/* 出すのはルール名と効果だけ(ラフな体験 §4.5)。人気度・都道府県はここでは出さない。 */}
        {firedRule && (
          <Toast variant="warn">
            ルール発動!「{firedRule.name}」— {firedRule.effect}
          </Toast>
        )}
        <Log entries={log} />
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
    </div>
  );
}
