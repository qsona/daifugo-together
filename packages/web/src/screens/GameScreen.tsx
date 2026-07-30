import { useEffect, useRef, useState } from 'react';

import { ActivationChip } from '../components/ActivationChip';
import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import type { CardView } from '../components/Card';
import { HandTray } from '../components/HandTray';
import { GuideMessage } from '../components/GuideMessage';
import { RuleCutIn } from '../components/RuleCutIn';
import type { RuleActivation } from '../components/RuleCutIn';
import { Table } from '../components/Table';
import type { TableSeat } from '../components/Table';
import { Toast } from '../components/Toast';
import type { CardHint } from '../game/hints';
import type { GuideCue } from '../game/guide';

import styles from './GameScreen.module.css';
import screen from './screen.module.css';

/** 誰かがあがった 1 件。履歴に並んだ順(=あがった順)で渡す。 */
export type SeatFinish = {
  /** 席番号。同じ戦で同じ席が 2 回あがることはないので、告知の識別に使える。 */
  seat: number;
  name: string;
  isSelf: boolean;
  rank: number;
  title: string;
};

/** あがり告知を出しておく時間。読み切れて、かつ次の手を邪魔しない長さ。 */
const FINISH_NOTICE_MS = 2600;

const NO_FINISHES: readonly SeatFinish[] = [];

type GameScreenProps = {
  /** セット内の何戦目か。巡目は誰の判断にも使われないので出さない。 */
  gameLabel: string;
  activeRuleCount: number;
  /** 自分を先頭に、手番が回る順(時計回り)で 4 人。席と場は卓に統合した。 */
  seats: readonly TableSeat[];
  /** いま超えるべきプレイの持ち主。場が流れていれば null。 */
  leadSeatName: string | null;
  isFlushing?: boolean;
  /** この戦であがった人を、あがった順に。増えた分だけを告知する。 */
  finishes?: readonly SeatFinish[];
  /** 再生中のカットイン。空なら出さない。 */
  activations: readonly RuleActivation[];
  onCutInDone: () => void;
  /** カットインが引いたあとに残る直近の発動。 */
  lastActivation: { ruleId: string; name: string; count: number } | null;
  hand: readonly CardView[];
  selectedCardIds: readonly string[];
  cardHints?: ReadonlyMap<string, CardHint>;
  guideCue?: GuideCue | null;
  showStrengthScale?: boolean;
  isMyTurn: boolean;
  canPlay?: boolean;
  canPass?: boolean;
  playLabel?: string;
  actionPrompt?: string | null;
  turnDeadlineAt?: number | null;
  onViewRules: () => void;
  onOpenActivation: (ruleId: string) => void;
  onToggleCard: (id: string) => void;
  onDimmedCardTap?: (id: string) => void;
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
  finishes = NO_FINISHES,
  activations,
  onCutInDone,
  lastActivation,
  hand,
  selectedCardIds,
  cardHints,
  guideCue = null,
  showStrengthScale = false,
  isMyTurn,
  canPlay,
  canPass = true,
  playLabel = 'えらんだカードを出す',
  actionPrompt = null,
  turnDeadlineAt,
  onViewRules,
  onOpenActivation,
  onToggleCard,
  onDimmedCardTap,
  onPlay,
  onPass,
}: GameScreenProps) {
  const finishNotice = useFinishNotice(finishes);
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
        {/* チップはカットインが引いたあとの痕跡なので、再生中は出さない。 */}
        {lastActivation && activations.length === 0 && (
          <ActivationChip
            name={lastActivation.name}
            count={lastActivation.count}
            onOpen={() => {
              onOpenActivation(lastActivation.ruleId);
            }}
          />
        )}
        <HandTray
          cards={hand}
          selectedIds={selectedCardIds}
          {...(cardHints ? { cardHints } : {})}
          showStrengthScale={showStrengthScale}
          isMyTurn={isMyTurn}
          turnDeadlineAt={turnDeadlineAt ?? null}
          onToggle={onToggleCard}
          {...(onDimmedCardTap ? { onDimmedCardTap } : {})}
          actions={
            <>
              {actionPrompt && (
                <span className={styles.choicePrompt}>{actionPrompt}</span>
              )}
              <Button disabled={!isMyTurn || !canPass} onClick={onPass}>
                パス
              </Button>
              <Button
                variant="primary"
                disabled={!isMyTurn || !(canPlay ?? selectedCardIds.length > 0)}
                onClick={onPlay}
              >
                {playLabel}
              </Button>
            </>
          }
        />
      </main>
      {(finishNotice || guideCue) && (
        <div className={styles.noticeLayer}>
          {finishNotice ? (
            <Toast variant="warn">
              {finishNotice.isSelf ? 'あなた' : finishNotice.name}が
              {finishNotice.rank}位であがり!
            </Toast>
          ) : guideCue ? (
            <Toast variant="guide">
              <GuideMessage cue={guideCue} />
            </Toast>
          ) : null}
        </div>
      )}
      <RuleCutIn activations={activations} onDone={onCutInDone} />
    </div>
  );
}

/**
 * 「前回描画時より あがり が増えた」ときだけ、増えた最後の 1 件を数秒告知する。
 * 1 回の更新に複数件が含まれる場合も最新だけを出す。復帰直後に古い告知を
 * 連続再生して現在の盤面を隠さないための DS-05 の方針。
 *
 * 再演出を防いでいるのは「同一戦の history は単調増加」という性質。
 * 一過性の切断→復帰では GameScreen は unmount されず、全量スナップショットでも
 * 同一戦内なら件数は既知の基準を下回らないので、既告知分が再び増分になることはない。
 * 画面をまたいだ復帰(セッション復元・後勝ち接続)では再マウントされ、
 * 初回描画時点の件数を基準として飲み込む。
 * 戦が変わって履歴が短くなったときも、基準を貼り直すだけで告知しない。
 */
function useFinishNotice(finishes: readonly SeatFinish[]): SeatFinish | null {
  const seenCount = useRef<number | null>(null);
  const [notice, setNotice] = useState<SeatFinish | null>(null);

  useEffect(() => {
    const previous = seenCount.current;
    seenCount.current = finishes.length;
    if (previous === null || finishes.length <= previous) return;
    const latest = finishes.at(-1);
    if (latest) setNotice(latest);
  }, [finishes]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => {
      setNotice(null);
    }, FINISH_NOTICE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);

  return notice;
}
