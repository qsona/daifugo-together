import { useEffect, useState } from 'react';

import { cx } from '../lib/cx';
import { prefersReducedMotion } from '../lib/prefers-reduced-motion';

import { Tag } from './Tag';
import styles from './GameRankRows.module.css';

/** 1 戦のリザルトが表示する内容だけを持つ view-model。 */
export type GameRankView = {
  place: number;
  name: string;
  kind: 'human' | 'ai';
  /** 大富豪・富豪・貧民・大貧民。 */
  title?: string;
  /** この戦で得た順位点(5-3-2-1)。 */
  gainedPoints: number;
  /** この戦を終えた時点のセット累計点。 */
  totalPoints: number;
  isYou?: boolean;
};

/** 1 点あたりの間。5 点で 300ms 前後に収まる速さ。 */
const STEP_MS = 60;

function useCountUp(from: number, to: number, enabled: boolean): number {
  const [value, setValue] = useState(enabled ? from : to);

  useEffect(() => {
    if (!enabled) {
      setValue(to);
      return;
    }
    setValue(from);
    if (from >= to) return;
    let current = from;
    const timer = setInterval(() => {
      current += 1;
      setValue(current);
      if (current >= to) clearInterval(timer);
    }, STEP_MS);
    return () => {
      clearInterval(timer);
    };
  }, [enabled, from, to]);

  return value;
}

function GameRankRow({
  rank,
  countUp,
}: {
  rank: GameRankView;
  countUp: boolean;
}) {
  const total = useCountUp(
    rank.totalPoints - rank.gainedPoints,
    rank.totalPoints,
    countUp,
  );
  return (
    <li
      className={cx(
        styles.row,
        rank.place === 1 && styles.top,
        rank.isYou && styles.you,
      )}
      {...(rank.isYou ? { 'aria-label': `${rank.name}（自分）` } : {})}
    >
      <span className={styles.place}>{rank.place}</span>
      <span className={styles.name}>{rank.name}</span>
      {rank.isYou && <span className={styles.youBadge}>自分</span>}
      {rank.title && <span className={styles.title}>{rank.title}</span>}
      {/* 得点は数字だけで足りる。「合計」「今回」の見出し語は置かない。 */}
      <span className={styles.score}>
        <small className={styles.gain}>+{String(rank.gainedPoints)}</small>
        {String(total)}点
      </span>
      <Tag variant={rank.kind}>{rank.kind === 'human' ? '人間' : 'AI'}</Tag>
    </li>
  );
}

/**
 * 1 戦のリザルトの順位行。
 * 読み順は 順位 → 名前 → 称号 → この戦の加点 → セット累計点。
 * 加点が乗ってから合計が数え上がることで、点の出どころが目で追える。
 */
export function GameRankRows({
  ranks,
  countUp = true,
}: {
  ranks: readonly GameRankView[];
  countUp?: boolean;
}) {
  const animate = countUp && !prefersReducedMotion();
  return (
    <ol className={styles.rows}>
      {ranks.map((rank) => (
        <GameRankRow key={rank.name} rank={rank} countUp={animate} />
      ))}
    </ol>
  );
}
