import { useEffect, useRef, useState } from 'react';

import type { GameStatusView } from '@daifugo/core';

import { cx } from '../lib/cx';

import { SUIT_NAME, SuitMark, suitColorClass } from './SuitMark';

import styles from './StateMarkers.module.css';

/**
 * 継続中のルール状態 1 件(革命・イレブンバック・縛りなど)。
 * 契約(protocol.ts)の型をそのまま使い、スート語彙の乖離に気づける形にする。
 * scope はその状態が死ぬ場所: 'game' は局が終わるまで、'field' は場が流れるまで。
 */
export type GameStatusMarker = GameStatusView;

/** 退場(リボンが飛ぶ・場チップが吸い込まれる)の尺。--duration-slow と揃える。 */
const EXIT_MS = 320;

/** 局リボンを段重ねする上限。これを超えた分は「+N」にまとめる。 */
const MAX_RIBBONS = 2;

const NO_STATUSES: readonly GameStatusMarker[] = [];

type MarkerListProps = {
  statuses?: readonly GameStatusMarker[];
  onOpen?: (ruleId: string) => void;
};

/**
 * 局スコープの状態。卓の左上に小さなリボンとして刺さり、場が何度流れても残る。
 * 文字はルール名だけ(留まっていること自体が「継続中」なので状態語は書かない)。
 */
export function StateRibbons({
  statuses = NO_STATUSES,
  onOpen,
  onOverflow,
}: MarkerListProps & {
  /** 「+N」の行き先。有効ルール一覧へ送り、隠れた状態にも到達できるようにする。 */
  onOverflow?: () => void;
}) {
  const entries = useMarkerEntries(statuses, {});
  if (entries.length === 0) return null;

  // 段重ねの上限は現行の状態にだけ掛ける。退場中のリボンは飛び切るまで描く。
  const current = entries.filter((entry) => !entry.leaving);
  const shown = current.slice(0, MAX_RIBBONS);
  const overflow = current.length - shown.length;

  return (
    <div className={styles.dock}>
      {shown.map(({ status, phase }) => (
        <button
          key={status.ruleId}
          type="button"
          className={cx(styles.ribbonHit, styles[phase])}
          aria-label={markerLabel(status)}
          onClick={() => {
            onOpen?.(status.ruleId);
          }}
        >
          <span className={styles.ribbon}>{status.name}</span>
        </button>
      ))}
      {overflow > 0 && (
        <button
          type="button"
          className={styles.ribbonHit}
          // 行き先は有効ルールの一覧なので、読み上げも一覧までしか約束しない。
          aria-label={`ほか${String(overflow)}件。タップでルール一覧`}
          onClick={() => {
            onOverflow?.();
          }}
        >
          <span className={styles.ribbon}>+{overflow}</span>
        </button>
      )}
      {entries
        .filter((entry) => entry.leaving)
        .map(({ status, phase }) => (
          <button
            key={status.ruleId}
            type="button"
            className={cx(styles.ribbonHit, styles[phase])}
            aria-label={markerLabel(status)}
            onClick={() => {
              onOpen?.(status.ruleId);
            }}
          >
            <span className={styles.ribbon}>{status.name}</span>
          </button>
        ))}
    </div>
  );
}

/**
 * 場スコープの状態。場の中心に札の形のチップとして置かれ、
 * 場が流れるときに場札と一緒に吸い込まれて消える(それが終了通知になる)。
 */
export function FieldStateChips({
  statuses = NO_STATUSES,
  onOpen,
  hold = false,
  isFlushing = false,
}: MarkerListProps & {
  /** カットイン中の場の保持モード。真のあいだは消えた状態も静止したまま残す。 */
  hold?: boolean;
  /** 場流しの演出中か。札と一緒に吸い込むのはこのときだけ。 */
  isFlushing?: boolean;
}) {
  const entries = useMarkerEntries(statuses, { hold, isFlushing });
  if (entries.length === 0) return null;

  return (
    <div className={styles.chips}>
      {entries.map(({ status, phase, exit }) => (
        <button
          key={status.ruleId}
          type="button"
          className={cx(
            styles.chipHit,
            phase === 'entering' && styles.entering,
            // 場流しに乗るときだけ中心へ吸い込む。単独の消滅はフェードで引く。
            phase === 'exiting' &&
              (exit === 'suck' ? styles.exiting : styles.fading),
          )}
          aria-label={markerLabel(status)}
          onClick={() => {
            onOpen?.(status.ruleId);
          }}
        >
          <span className={styles.chip}>
            {status.suits?.map((suit, index) => (
              <SuitMark
                // 同じスートが複数入りうるので、位置も鍵に混ぜる。
                key={`${suit}:${String(index)}`}
                suit={suit}
                className={cx(styles.suit, suitColorClass(suit))}
              />
            ))}
            {status.name}
          </span>
        </button>
      ))}
    </div>
  );
}

function markerLabel(status: GameStatusMarker): string {
  const suits = (status.suits ?? []).map((suit) => SUIT_NAME[suit]).join('・');
  return `${suits ? `${suits}の` : ''}${status.name} — 継続中。タップで説明`;
}

type MarkerPhase = 'idle' | 'entering' | 'exiting';

/** 退場の演じ方。場流しに乗るときだけ吸い込み、それ以外はフェード。 */
type ExitMode = 'suck' | 'fade';

type MarkerEntry = {
  status: GameStatusMarker;
  phase: MarkerPhase;
  exit: ExitMode | null;
  /** 現行の statuses から消え、退場を待っているだけのエントリか。 */
  leaving: boolean;
};

/**
 * 描画に必要な状態の一覧を、登場・退場の演出つきで組み立てる。
 *
 * - 初期描画(再接続・途中参加)では演出しない。前回描画との差分で新規を判定する
 *   (あがりトーストの「初回描画時点は基準として飲む」と同じ裁定)。
 * - 消えた状態は退場が終わるまで残す。`hold` のあいだは静止したまま置いておき、
 *   保持が解けた瞬間(= 場が流れる瞬間)に退場を始める。
 * - 退場の演じ方は始まった瞬間に固定する。途中で場流しが終わっても演出は差し替えない。
 */
function useMarkerEntries(
  statuses: readonly GameStatusMarker[],
  options: { hold?: boolean; isFlushing?: boolean },
): readonly MarkerEntry[] {
  const { hold = false, isFlushing = false } = options;
  const seenIds = useRef<ReadonlySet<string> | null>(null);
  const enteringIds = useRef(new Set<string>());
  const previous = useRef<readonly GameStatusMarker[]>(statuses);
  const exitModes = useRef(new Map<string, ExitMode>());
  const exitTimers = useRef(new Map<string, number>());
  const [leaving, setLeaving] = useState<readonly GameStatusMarker[]>([]);

  const currentIds = new Set(statuses.map((status) => status.ruleId));
  if (seenIds.current === null) {
    seenIds.current = currentIds;
  } else {
    for (const status of statuses) {
      if (!seenIds.current.has(status.ruleId)) {
        enteringIds.current.add(status.ruleId);
      }
    }
    for (const id of enteringIds.current) {
      if (!currentIds.has(id)) enteringIds.current.delete(id);
    }
    seenIds.current = currentIds;
  }

  // 退場中に同じ状態が戻ってきたら、現行の側だけを描く(key の重複を作らない)。
  const leavingEntries = leaving.filter(
    (status) => !currentIds.has(status.ruleId),
  );
  const leavingIds = new Set(leavingEntries.map((status) => status.ruleId));
  for (const id of exitModes.current.keys()) {
    if (!leavingIds.has(id)) exitModes.current.delete(id);
  }
  for (const status of leavingEntries) {
    if (hold) continue;
    if (!exitModes.current.has(status.ruleId)) {
      exitModes.current.set(status.ruleId, isFlushing ? 'suck' : 'fade');
    }
  }

  useEffect(() => {
    const ids = new Set(statuses.map((status) => status.ruleId));
    const gone = previous.current.filter((status) => !ids.has(status.ruleId));
    previous.current = statuses;
    // 戻ってきた状態は退場を取り消す。張ってあったタイマーも捨てる。
    for (const id of ids) {
      const timer = exitTimers.current.get(id);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        exitTimers.current.delete(id);
      }
    }
    setLeaving((current) => {
      const kept = current.filter((status) => !ids.has(status.ruleId));
      if (gone.length > 0) return [...kept, ...gone];
      return kept.length === current.length ? current : kept;
    });
  }, [statuses]);

  // 退場は 1 件ずつ数える。後続の退場で先行分の期限が延びないようにする。
  useEffect(() => {
    if (hold) return;
    for (const status of leaving) {
      const id = status.ruleId;
      if (exitTimers.current.has(id)) continue;
      const timer = window.setTimeout(() => {
        exitTimers.current.delete(id);
        setLeaving((current) =>
          current.filter((status) => status.ruleId !== id),
        );
      }, EXIT_MS);
      exitTimers.current.set(id, timer);
    }
  }, [hold, leaving]);

  useEffect(() => {
    const timers = exitTimers.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return [
    ...statuses.map((status) => ({
      status,
      phase: enteringIds.current.has(status.ruleId)
        ? ('entering' as const)
        : ('idle' as const),
      exit: null,
      leaving: false,
    })),
    ...leavingEntries.map((status) => ({
      status,
      phase: hold ? ('idle' as const) : ('exiting' as const),
      exit: exitModes.current.get(status.ruleId) ?? null,
      leaving: true,
    })),
  ];
}
