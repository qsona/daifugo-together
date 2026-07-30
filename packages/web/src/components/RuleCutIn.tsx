import { useEffect, useRef, useState } from 'react';

import { cx } from '../lib/cx';

import styles from './RuleCutIn.module.css';

/** 1 手で発動した 1 つのルール。名前以外は任意。 */
export type RuleActivation = {
  ruleId: string;
  /** リボンに収める前提で、提案時に 12 文字以内へ制限する(E5 へ申し送り)。 */
  name: string;
  /** 盤面の変化だけでは伝わらない効果のための短い補足。12 文字以内。 */
  effectLabel?: string;
  /** このプレイヤーが初めて見るルールか。初登場だけ演出を強くする。 */
  isFirstSeen: boolean;
};

/** 1 ボレーの尺。段重ねを足しても 1.2 秒以内に収める。 */
const HOLD_MS = 750;
const STAGGER_MS = 180;
const MAX_VISIBLE = 3;
/**
 * リボンが走り込むまでの間。出した札が場に着地したことを見せるための一拍で、
 * この間に場は流さない。
 */
const LEAD_IN_MS = 300;

type RuleCutInProps = {
  /** 空なら何も出さない。要素が入ったら 1 ボレーを再生する。 */
  activations: readonly RuleActivation[];
  onDone: () => void;
};

/**
 * ルール発動のカットイン。
 *
 * - 文字はルール名に全振りし、「ルール発動!」のような語は置かない
 *   (赤リボンが走り込むこと自体が「発動した」の記号)。
 * - 効果は原則この演出では説明せず、直後の盤面アニメーションが見せる。
 * - 同時発動は逐次ではなく段重ね + 連発バッジ。
 *   逐次表示はテンポを殺し、1 枚に統合するとどのルールか消える。
 *   段重ねは両方を守り、入り乱れをコンボとして祝祭化する。
 * - 進行はブロックせず、タップでスキップできる。
 */
export function RuleCutIn({ activations, onDone }: RuleCutInProps) {
  const shown = activations.slice(0, MAX_VISIBLE);
  const overflow = activations.slice(MAX_VISIBLE);
  const total =
    LEAD_IN_MS + HOLD_MS + STAGGER_MS * Math.max(0, shown.length - 1);
  const [showRibbons, setShowRibbons] = useState(false);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (activations.length === 0) {
      setShowRibbons(false);
      return;
    }
    setShowRibbons(false);
    const leadIn = setTimeout(() => {
      setShowRibbons(true);
    }, LEAD_IN_MS);
    const done = setTimeout(() => {
      setShowRibbons(false);
      onDoneRef.current();
    }, total);
    return () => {
      clearTimeout(leadIn);
      clearTimeout(done);
    };
  }, [activations, total]);

  if (activations.length === 0) return null;

  return (
    <>
      <button
        type="button"
        className={styles.skip}
        aria-label="演出をとばす"
        onClick={() => {
          setShowRibbons(false);
          onDone();
        }}
      />
      {showRibbons && (
        <div className={styles.layer} role="status">
          {shown.map((activation, index) => (
            <p
              key={activation.ruleId}
              className={cx(
                styles.ribbon,
                index > 0 && styles.stacked,
                index > 0 &&
                  (index % 2 === 1 ? styles.tiltLeft : styles.tiltRight),
                activation.isFirstSeen && styles.newRule,
              )}
              style={{ animationDelay: `${String(index * STAGGER_MS)}ms` }}
            >
              {activation.isFirstSeen && (
                <span className={styles.newBadge}>NEW RULE</span>
              )}
              <span className={styles.name}>{activation.name}</span>
              {activation.effectLabel && (
                <span className={styles.effect}>{activation.effectLabel}</span>
              )}
            </p>
          ))}
          {activations.length > 1 && (
            <span
              className={styles.comboBadge}
              style={{
                animationDelay: `${String(shown.length * STAGGER_MS)}ms`,
              }}
              aria-label={`${String(activations.length)}件同時発動`}
            >
              ×{activations.length}
            </span>
          )}
          {overflow.length > 0 && (
            <p className={styles.overflow}>
              ほか: {overflow.map((activation) => activation.name).join('・')}
            </p>
          )}
        </div>
      )}
    </>
  );
}
