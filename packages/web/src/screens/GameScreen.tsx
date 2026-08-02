import { useEffect, useRef, useState } from 'react';

import { ActivationChip } from '../components/ActivationChip';
import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import type { CardView } from '../components/Card';
import { HandTray } from '../components/HandTray';
import { GuideMessage } from '../components/GuideMessage';
import { RuleCutIn } from '../components/RuleCutIn';
import type { RuleActivation } from '../components/RuleCutIn';
import type { GameStatusMarker } from '../components/StateMarkers';
import { Table } from '../components/Table';
import type { TableSeat } from '../components/Table';
import { Toast } from '../components/Toast';
import type { CardHint } from '../game/hints';
import type { GuideCue } from '../game/guide';
import { QUIT_GAME_LABEL } from '../messages';

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
const DISCARD_NOTICE_MS = 3000;

const NO_FINISHES: readonly SeatFinish[] = [];
const NO_STATUSES: readonly GameStatusMarker[] = [];
const NO_DISCARD_NOTICES: readonly CardDiscardNotice[] = [];

export type CardDiscardNotice = {
  id: string;
  ruleName: string;
  playerName: string;
  cards: readonly CardView[];
};

type GameScreenProps = {
  /** セット内の何戦目か。巡目は誰の判断にも使われないので出さない。 */
  gameLabel: string;
  activeRuleCount: number;
  /** 自分を先頭に、手番が回る順(時計回り)で 4 人。席と場は卓に統合した。 */
  seats: readonly TableSeat[];
  /** いま超えるべきプレイの持ち主。場が流れていれば null。 */
  leadSeatName: string | null;
  isFlushing?: boolean;
  /** 継続中のルール状態。局スコープは卓の左上、場スコープは場の中心に置く。 */
  statuses?: readonly GameStatusMarker[];
  /** カットイン中の場の保持モード。真のあいだは消えた場スコープの状態も残す。 */
  holdFieldStatuses?: boolean;
  /** この戦であがった人を、あがった順に。増えた分だけを告知する。 */
  finishes?: readonly SeatFinish[];
  /** 公開されたカード破棄。増えた分だけ札面つきで数秒告知する。 */
  discardNotices?: readonly CardDiscardNotice[];
  /** 再生中のカットイン。空なら出さない。 */
  activations: readonly RuleActivation[];
  /**
   * カットインを画面の外側(App)で再生しているか。
   * 接続時は App が RuleCutIn を持つので、再生中かどうかはここで受ける。
   */
  isCutInPlaying?: boolean;
  onCutInDone: () => void;
  /** カットインが引いたあとに残る直近の発動。 */
  lastActivation: { ruleId: string; name: string; count: number } | null;
  hand: readonly CardView[];
  selectedCardIds: readonly string[];
  cardHints?: ReadonlyMap<string, CardHint>;
  guideCue?: GuideCue | null;
  showStrengthScale?: boolean;
  /** 正味の強さが反転しているか。反転中は誰にでも強さ目盛りを出す。 */
  strengthInverted?: boolean;
  isMyTurn: boolean;
  canPlay?: boolean;
  canPass?: boolean;
  playLabel?: string;
  actionRuleName?: string | null;
  actionPrompt?: string | null;
  turnDeadlineAt?: number | null;
  onViewRules: () => void;
  /** 対局を途中でやめる。押した先で確認を挟むのは呼び出し側の責務。 */
  onQuit: () => void;
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
  statuses = NO_STATUSES,
  holdFieldStatuses = false,
  finishes = NO_FINISHES,
  discardNotices = NO_DISCARD_NOTICES,
  activations,
  isCutInPlaying = false,
  onCutInDone,
  lastActivation,
  hand,
  selectedCardIds,
  cardHints,
  guideCue = null,
  showStrengthScale = false,
  strengthInverted = false,
  isMyTurn,
  canPlay,
  canPass = true,
  playLabel = 'えらんだカードを出す',
  actionRuleName = null,
  actionPrompt = null,
  turnDeadlineAt,
  onViewRules,
  onQuit,
  onOpenActivation,
  onToggleCard,
  onDimmedCardTap,
  onPlay,
  onPass,
}: GameScreenProps) {
  const finishNotice = useFinishNotice(finishes);
  const discardNotice = useDiscardNotice(discardNotices);
  const settledStatuses = useSettledStatuses(
    statuses,
    activations.length > 0 || isCutInPlaying,
  );
  // 状態を持つルールはマーカー自身が痕跡 + 導線を兼ねるので、発動チップは出さない
  // (発動チップは 8 切りのような一発もの専用)。
  const hasStatusMarker =
    lastActivation !== null &&
    settledStatuses.some((status) => status.ruleId === lastActivation.ruleId);
  return (
    <div className={screen.screen}>
      <AppBar
        title={gameLabel}
        leading={{ label: QUIT_GAME_LABEL, onClick: onQuit }}
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
          statuses={settledStatuses}
          holdFieldStatuses={holdFieldStatuses}
          onOpenStatus={onOpenActivation}
          onViewAllStatuses={onViewRules}
        />
        {/* チップはカットインが引いたあとの痕跡なので、再生中は出さない。 */}
        {lastActivation && !hasStatusMarker && activations.length === 0 && (
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
          strengthInverted={strengthInverted}
          isMyTurn={isMyTurn}
          turnDeadlineAt={turnDeadlineAt ?? null}
          onToggle={onToggleCard}
          {...(onDimmedCardTap ? { onDimmedCardTap } : {})}
          notice={
            actionRuleName && actionPrompt ? (
              <div
                className={styles.choiceNotice}
                role="status"
                aria-label={`${actionRuleName} 発動中`}
              >
                <strong>{actionRuleName} 発動中</strong>
                <span>{actionPrompt}</span>
              </div>
            ) : actionPrompt ? (
              <span className={styles.choicePrompt}>{actionPrompt}</span>
            ) : null
          }
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
              {finishNotice.name}が{finishNotice.rank}位であがり!
            </Toast>
          ) : guideCue ? (
            <Toast variant="guide">
              <GuideMessage cue={guideCue} />
            </Toast>
          ) : null}
        </div>
      )}
      {discardNotice && (
        <div className={styles.discardLayer}>
          <section
            className={styles.discardNotice}
            role="status"
            aria-label={`${discardNotice.playerName}が${discardNotice.ruleName}で捨てたカード`}
          >
            <strong className={styles.discardTitle}>
              {discardNotice.playerName}の{discardNotice.ruleName}
            </strong>
            <span className={styles.discardLabel}>捨てたカード</span>
            <ul className={styles.discardCards}>
              {discardNotice.cards.map((card) => (
                <li key={card.id}>
                  <Card card={card} size="small" />
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
      <RuleCutIn activations={activations} onDone={onCutInDone} />
    </div>
  );
}

/**
 * カットインの再生中は継続状態の差分を止め、引けてから反映する。
 * スナップショットは発動と同時に状態を載せてくるので、そのまま描くと
 * カットインの裏でマーカーが先に現れ、「発動 → 継続」の順序が壊れる。
 *
 * 新しい statuses をいったん effect で受け直すのが肝。カットインを積むのも
 * スナップショット反映後の effect なので、両方の state 更新が同じフラッシュに
 * まとまり、「まだ再生フラグが立っていない 1 レンダリング」で先走らない。
 */
function useSettledStatuses(
  statuses: readonly GameStatusMarker[],
  isPlayingCutIn: boolean,
): readonly GameStatusMarker[] {
  const [pending, setPending] = useState(statuses);
  useEffect(() => {
    setPending(statuses);
  }, [statuses]);
  const settled = useRef(statuses);
  if (!isPlayingCutIn) settled.current = pending;
  return settled.current;
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

function useDiscardNotice(
  notices: readonly CardDiscardNotice[],
): CardDiscardNotice | null {
  const seenCount = useRef<number | null>(null);
  const [notice, setNotice] = useState<CardDiscardNotice | null>(null);

  useEffect(() => {
    const previous = seenCount.current;
    seenCount.current = notices.length;
    if (previous === null || notices.length <= previous) return;
    const latest = notices.at(-1);
    if (latest) setNotice(latest);
  }, [notices]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => {
      setNotice(null);
    }, DISCARD_NOTICE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);

  return notice;
}
