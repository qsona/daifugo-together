import { cx } from '../lib/cx';

import { Card } from './Card';
import type { CardView } from './Card';
import { FieldStateChips, StateRibbons } from './StateMarkers';
import type { GameStatusMarker } from './StateMarkers';
import { Tag } from './Tag';
import styles from './Table.module.css';

/** 卓に着いている 1 人。席の情報と、その人がこの場に出した札をまとめて持つ。 */
export type TableSeat = {
  name: string;
  isSelf: boolean;
  handCount: number;
  isCurrentTurn: boolean;
  hasPassed: boolean;
  kind?: 'human' | 'ai';
  status?: string;
  /** あがった順位。null / 未指定なら、まだ対局に残っている。 */
  finishedRank?: number | null;
  /** あがったときの称号(大富豪など)。順位バッジに添える。 */
  finishedTitle?: string;
  /** 各要素が 1 回のプレイ。場に出るのは最新の 1 回だけ。 */
  plays: readonly (readonly CardView[])[];
};

/** 自分から時計回りに 4 席。位置がそのまま手番の回る順になる。 */
const POSITIONS = ['bottom', 'left', 'top', 'right'] as const;

type TableProps = {
  /** 自分を先頭に、手番が回る順(時計回り)で 4 人。 */
  seats: readonly TableSeat[];
  /** いま超えるべきプレイの持ち主。場が流れていれば null。 */
  leadSeatName: string | null;
  isFlushing?: boolean;
  /** 継続中のルール状態。局スコープは卓の左上、場スコープは場の中心に置く。 */
  statuses?: readonly GameStatusMarker[];
  /** カットイン中の場の保持モード。真のあいだは消えた場スコープの状態も残す。 */
  holdFieldStatuses?: boolean;
  onOpenStatus?: (ruleId: string) => void;
  /** 段重ねに収まらない局スコープの状態(「+N」)の行き先。 */
  onViewAllStatuses?: () => void;
};

/**
 * 画面 3 の卓。相手席の行と場を 1 つにまとめたもの。
 *
 * 席を菱形に置くことで、手番が時計回りに回ることを文字なしで示す。
 * 各席の場には最新のプレイ 1 回分だけを置く。「誰がいま何を出しているか」が
 * 常に見えていて、文字の実況ログを置かなくてよい。
 */
export function Table({
  seats,
  leadSeatName,
  isFlushing = false,
  statuses,
  holdFieldStatuses = false,
  onOpenStatus,
  onViewAllStatuses,
}: TableProps) {
  const gameStatuses = statuses?.filter((status) => status.scope === 'game');
  const fieldStatuses = statuses?.filter((status) => status.scope === 'field');
  return (
    <section
      className={cx(styles.table, isFlushing && styles.flushing)}
      aria-label="卓"
    >
      <StateRibbons
        {...(gameStatuses ? { statuses: gameStatuses } : {})}
        {...(onOpenStatus ? { onOpen: onOpenStatus } : {})}
        {...(onViewAllStatuses ? { onOverflow: onViewAllStatuses } : {})}
      />
      {/* preserveAspectRatio=none: 卓は横長なので、輪も卓の比率に合わせて潰す。 */}
      <div className={styles.diamond}>
        <svg
          className={styles.flow}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <ellipse
            cx="50"
            cy="50"
            rx="26"
            ry="23"
            fill="none"
            stroke="var(--color-green-500)"
            strokeWidth="1"
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
          {/* 時計回りを示す三角。上・右・下・左の順に進む向きを向く。 */}
          <g fill="var(--color-green-500)">
            <path d="M50 20 l3 2 l-3 2 z" />
            <path d="M83 50 l-2 3 l-2 -3 z" />
            <path d="M50 80 l-3 -2 l3 -2 z" />
            <path d="M17 50 l2 -3 l2 3 z" />
          </g>
        </svg>
        {seats.map((seat, index) => {
          const position = POSITIONS[index] ?? 'bottom';
          // 場に見せるのは最新のプレイ 1 回分だけ。前のプレイは新しいプレイで置き換える
          // (複数枚同時出しは 1 プレイなので、その全カードを見せる)。
          const cards = seat.plays.at(-1) ?? [];
          const displayName = seat.name;
          const isFinished = seat.finishedRank != null;
          // あがった席はもう手番も回らないので、考え中・パスの状態は出さない。
          const states = isFinished
            ? []
            : [
                ...(seat.status ? [seat.status] : []),
                ...(seat.hasPassed ? ['パス'] : []),
              ];

          return (
            <div
              key={seat.name}
              className={cx(
                styles.seat,
                styles[position],
                seat.isCurrentTurn && styles.turn,
                seat.hasPassed && styles.passed,
                isFinished && styles.finished,
                seat.name === leadSeatName && styles.lead,
              )}
            >
              {/* 名前 / 枚数・順位 / 状態 を 1 つのチップに詰めず、行で分ける。 */}
              <span className={styles.info}>
                <span className={styles.chip}>
                  <span className={styles.name}>{displayName}</span>
                  {seat.kind === 'ai' && <Tag variant="ai">AI</Tag>}
                </span>
                <span className={styles.meta}>
                  {isFinished ? (
                    <span className={styles.rank}>
                      {seat.finishedRank}位
                      {seat.finishedTitle && (
                        <span className={styles.title}>
                          {seat.finishedTitle}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className={styles.count}>{seat.handCount}枚</span>
                  )}
                  {states.map((label) => (
                    <span key={label} className={styles.state}>
                      {label}
                    </span>
                  ))}
                </span>
              </span>
              {cards.length === 0 ? (
                <span className={styles.empty} />
              ) : (
                <ul
                  className={styles.pile}
                  aria-label={`${displayName}が出した札`}
                >
                  {cards.map((card) => (
                    <li key={card.id}>
                      <Card card={card} size="small" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        <FieldStateChips
          {...(fieldStatuses ? { statuses: fieldStatuses } : {})}
          hold={holdFieldStatuses}
          isFlushing={isFlushing}
          {...(onOpenStatus ? { onOpen: onOpenStatus } : {})}
        />
      </div>
    </section>
  );
}
