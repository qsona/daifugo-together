# 最終戦リザルトとセットリザルトの分離 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** セット最終戦のゲーム結果とセット総合結果を別画面にし、セットリザルトに1位の強調と紙吹雪を入れる。

**Architecture:** サーバーは `SetResultView` に最終戦の結果（既存の `GameResultView` 形）を1つ足すだけで、フェーズ・タイマー仕様は変えない。クライアントは `setResult` フェーズに入った直後にローカルの表示段階として最終戦リザルトを挟み、10秒のカウントダウンでセットリザルトへ進む。順位行の部品は「ゲーム結果行」と「セット結果行」に分割する。

**Tech Stack:** TypeScript / React 19 / CSS Modules / Vitest + @testing-library/react / pnpm workspace（`@daifugo/core` → `@daifugo/server` → `@daifugo/web`）

設計: [docs/superpowers/specs/2026-07-28-set-result-split-design.md](../specs/2026-07-28-set-result-split-design.md)

---

## ファイル構成

| ファイル | 役割 | 変更 |
| --- | --- | --- |
| `packages/core/src/protocol.ts` | `SetResultView.finalGame` の型 | 修正 |
| `packages/server/src/room/view.ts` | `setResultView` で `finalGame` を組む | 修正 |
| `packages/server/src/room/room.test.ts` | 完走セット／中断セットの `finalGame` | 修正 |
| `packages/web/src/lib/prefers-reduced-motion.ts` | 動きを減らす設定の参照（jsdom 安全） | 新規 |
| `packages/web/src/components/Confetti.tsx` / `.module.css` | 紙吹雪（装飾のみ） | 新規 |
| `packages/web/src/components/GameRankRows.tsx` / `.module.css` | ゲーム結果の順位行（加点＋合計点のカウントアップ） | 新規 |
| `packages/web/src/components/SetRankRows.tsx` / `.module.css` | セット結果の1位カード＋2〜4位の行 | 新規 |
| `packages/web/src/components/RankRow.tsx` / `.module.css` | 上記2つに分割して削除 | 削除 |
| `packages/web/src/screens/GameResultScreen.tsx` | `GameRankRows` を使う | 修正 |
| `packages/web/src/screens/SetResultScreen.tsx` | `SetRankRows` ＋ 紙吹雪 | 修正 |
| `packages/web/src/App.tsx` | 最終戦リザルトの表示段階と `finalGameRanks` | 修正 |
| `packages/web/src/fixtures/demo.ts` | ローカル見本の順位データ | 修正 |

---

### Task 1: サーバーが最終戦の結果を配る

**Files:**
- Modify: `packages/core/src/protocol.ts:148-163`
- Modify: `packages/server/src/room/view.ts:236-275`
- Test: `packages/server/src/room/room.test.ts`
- Modify（型を通すため）: `packages/web/src/App.test.tsx:613`, `:848`, `:995`

- [ ] **Step 1: 失敗するテストを書く**

`packages/server/src/room/room.test.ts` の `describe('pure room reducer', ...)` の中に追加する。既存の `viewFor` / `reduceRoom` インポートと、`fourHumanRoom()` / `start()` / `finishSet()`（`packages/server/src/room/room.test.ts:89`。`playing` の間ずっと進めて `setResult` まで運ぶ）をそのまま使う。

```ts
  it('完走セットのビューは最終戦の順位と順位点を持ち、中断セットでは持たない', () => {
    const completed = finishSet(start(fourHumanRoom())).state;

    expect(completed.engine?.outcome?.completion).toBe('completed');
    const finalGame = viewFor(completed, 'member-1').setResult?.finalGame;
    expect(finalGame?.gameNo).toBe(3);
    expect(finalGame?.standings.map((standing) => standing.rank)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(finalGame?.standings.map((standing) => standing.points)).toEqual([
      5, 3, 2, 1,
    ]);
    expect(finalGame?.standings[0]?.title).toBe('大富豪');

    const draining = reduceRoom(start(fourHumanRoom()), {
      type: 'requestDrain',
      now: 2_000,
    }).state;
    const drained = finishSet(draining).state;

    expect(drained.engine?.outcome?.completion).toBe('drained');
    expect(drained.engine?.results).toHaveLength(1);
    expect(viewFor(drained, 'member-1').setResult?.finalGame).toBeNull();
  });
```

`member-1` が `fourHumanRoom()` の参加者にいることを確認する（`packages/server/src/room/room.test.ts` 冒頭のヘルパーを読む）。いなければ実在する memberId に置き換える。

- [ ] **Step 2: テストが失敗することを確認する**

```bash
pnpm exec vitest run packages/server/src/room/room.test.ts -t 最終戦
```

Expected: FAIL（`finalGame` が `undefined` で `gameNo` が取れない）

- [ ] **Step 3: protocol に型を足す**

`packages/core/src/protocol.ts` の `SetResultView` に `finalGame` を足す。

```ts
export interface SetResultView {
  standings: {
    memberId: string;
    totalRank: number;
    title: string;
    ranks: number[];
    /** points はセット(3 戦)の合計順位点。 */
    points: number;
  }[];
  /**
   * 最終戦の結果。セットを完走したときだけ入る。
   * 中断で終わったセット(drained)では、最後に完走した戦が「最終戦」とは限らないので null。
   */
  finalGame: GameResultView | null;
  firedRules: {
    ruleId: string;
    ruleName: string;
    count: number;
  }[];
  respondBy: number;
}
```

`GameResultView` は同じファイル内（`packages/core/src/protocol.ts:114`）に既にある。

- [ ] **Step 4: view で組み立てる**

`packages/server/src/room/view.ts` の `setResultView` は今 `state` しか受け取っていない。座席の対応表が要るので引数を足す。

```ts
function setResultView(
  state: RoomState,
  seats: ReadonlyMap<string, SeatId>,
): SetResultView | null {
```

関数の中の `return {` の直前に次を足す。

```ts
  const finalResult =
    engine.results.length === engine.config.gamesPerSet
      ? engine.results.at(-1)
      : undefined;
```

返り値の `standings:` の直後に次のプロパティを足す。

```ts
    finalGame: finalResult ? resultView(finalResult, seats) : null,
```

`resultView`（`packages/server/src/room/view.ts:44`）は `rank` を順位順に並べないので、`resultView` の `standings` を組むところを順位順に固定する。

```ts
    standings: [...result.standings]
      .sort((left, right) => left.standing - right.standing)
      .map((standing) => ({
        seat: requiredSeat(seats, standing.player),
        rank: standing.standing,
        title: standing.title,
        points: POINTS_BY_STANDING[standing.standing],
      })),
```

呼び出し側（`packages/server/src/room/view.ts:314` 付近の `viewFor` の中）を差し替える。

```ts
    setResult: setResultView(state, seats),
```

- [ ] **Step 5: テストが通ることを確認する**

```bash
pnpm exec vitest run packages/server/src/room/room.test.ts
```

Expected: PASS（既存テストも含めて緑）

- [ ] **Step 6: web のテスト用データに `finalGame` を足す**

`finalGame` は必須プロパティなので、`setResult` を書いている web のテスト3か所に `finalGame: null,` を足す。`respondBy:` の行のとなりに置く。

```bash
grep -n "respondBy:" packages/web/src/App.test.tsx
```

3か所すべての `setResult: { ... }` オブジェクトに `finalGame: null,` を追加する。

- [ ] **Step 7: 型検査を通す**

```bash
pnpm typecheck
```

Expected: エラーなし

- [ ] **Step 8: コミット**

```bash
git add packages/core/src/protocol.ts packages/server/src/room/view.ts packages/server/src/room/room.test.ts packages/web/src/App.test.tsx
git commit -m "feat: expose final game result in set result view"
```

---

### Task 2: 紙吹雪と「動きを減らす」設定の参照

**Files:**
- Create: `packages/web/src/lib/prefers-reduced-motion.ts`
- Create: `packages/web/src/components/Confetti.tsx`
- Create: `packages/web/src/components/Confetti.module.css`
- Test: `packages/web/src/components/Confetti.test.tsx`

- [ ] **Step 1: 失敗するテストを書く**

`packages/web/src/components/Confetti.test.tsx`

```tsx
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Confetti } from './Confetti';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Confetti', () => {
  it('装飾なので支援技術には露出しない', () => {
    const view = render(<Confetti />);

    const root = view.container.firstElementChild!;
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(root.children.length).toBeGreaterThan(0);
  });

  it('動きを減らす設定では何も描かない', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );

    const view = render(<Confetti />);

    expect(view.container.firstElementChild).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
pnpm exec vitest run packages/web/src/components/Confetti.test.tsx
```

Expected: FAIL（`./Confetti` が解決できない）

- [ ] **Step 3: 設定の参照を書く**

`packages/web/src/lib/prefers-reduced-motion.ts`

```ts
/**
 * 「動きを減らす」設定。CSS の @media では表せない演出(数のカウントアップ、
 * 紙吹雪の DOM 生成)の出し分けに使う。
 * matchMedia を持たない実行環境(テストの jsdom)では false として扱う。
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
```

- [ ] **Step 4: 紙吹雪を書く**

`packages/web/src/components/Confetti.tsx`

```tsx
import { prefersReducedMotion } from '../lib/prefers-reduced-motion';

import styles from './Confetti.module.css';

/** 紙の色。KV の4色を順に回す。 */
const COLORS = ['red', 'green', 'blue', 'gold'] as const;
const PIECES = 24;

/**
 * 1位の発表に添える紙吹雪。装飾なので支援技術には出さない。
 * 位置と間は index から決めていて、描画のたびに散り方が変わらない。
 */
export function Confetti() {
  if (prefersReducedMotion()) return null;
  return (
    <div className={styles.field} aria-hidden="true">
      {Array.from({ length: PIECES }, (_, index) => (
        <span
          key={index}
          className={styles[COLORS[index % COLORS.length]!]}
          style={{
            left: `${String((index * 37) % 100)}%`,
            animationDelay: `${String((index % 8) * 120)}ms`,
            animationDuration: `${String(1_600 + (index % 5) * 220)}ms`,
          }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: 紙吹雪の CSS を書く**

`packages/web/src/components/Confetti.module.css`

生の色は書けない（`scripts/check-design-tokens.mjs` が止める）。色はトークン参照のみ。

```css
/* インゲーム部品: 1位の発表に添える紙吹雪 */

.field {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.piece {
  position: absolute;
  top: -12px;
  width: 8px;
  height: 12px;
  border: var(--border-hairline) solid var(--color-border-strong);
  animation-name: confetti-fall;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}

.red {
  composes: piece;
  background: var(--color-red-500);
}

.green {
  composes: piece;
  background: var(--color-green-500);
}

.blue {
  composes: piece;
  background: var(--color-blue-400);
}

.gold {
  composes: piece;
  background: var(--color-gold-400);
}

@keyframes confetti-fall {
  from {
    transform: translateY(0) rotate(0deg);
    opacity: 1;
  }
  to {
    transform: translateY(220px) rotate(540deg);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .piece {
    animation: none;
    display: none;
  }
}
```

`--border-hairline` が `docs/design/design-tokens.css` に無ければ、既存の細い枠線トークン（`--border-control` など、`grep -n "border-" docs/design/design-tokens.css` で確認）に置き換える。

- [ ] **Step 6: テストが通ることを確認する**

```bash
pnpm exec vitest run packages/web/src/components/Confetti.test.tsx
```

Expected: PASS（2件）

- [ ] **Step 7: デザイントークン検査を通す**

```bash
pnpm lint:design
```

Expected: エラーなし

- [ ] **Step 8: コミット**

```bash
git add packages/web/src/lib/prefers-reduced-motion.ts packages/web/src/components/Confetti.tsx packages/web/src/components/Confetti.module.css packages/web/src/components/Confetti.test.tsx
git commit -m "feat: add confetti component"
```

---

### Task 3: ゲーム結果の順位行（加点 → 合計点のカウントアップ）

**Files:**
- Create: `packages/web/src/components/GameRankRows.tsx`
- Create: `packages/web/src/components/GameRankRows.module.css`
- Test: `packages/web/src/components/GameRankRows.test.tsx`
- Modify: `packages/web/src/screens/GameResultScreen.tsx`
- Modify: `packages/web/src/fixtures/demo.ts:105-140`

- [ ] **Step 1: 失敗するテストを書く**

`packages/web/src/components/GameRankRows.test.tsx`

```tsx
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { GameRankRows } from './GameRankRows';

afterEach(cleanup);

const RANKS = [
  {
    place: 1,
    name: 'あなた',
    kind: 'human' as const,
    title: '大富豪',
    gainedPoints: 5,
    totalPoints: 13,
  },
  {
    place: 2,
    name: 'プレイヤーB',
    kind: 'ai' as const,
    title: '富豪',
    gainedPoints: 3,
    totalPoints: 9,
  },
];

describe('GameRankRows', () => {
  it('順位・称号・獲得順位点を出す', () => {
    render(<GameRankRows ranks={RANKS} />);

    expect(screen.getByText('大富豪')).toBeTruthy();
    expect(screen.getByText('+5')).toBeTruthy();
    expect(screen.getByText('+3')).toBeTruthy();
  });

  it('合計点は獲得前から数え上がり、最後は合計に落ち着く', async () => {
    render(<GameRankRows ranks={RANKS} />);

    expect(screen.getByText('8点')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('13点')).toBeTruthy();
    });
    expect(screen.getByText('9点')).toBeTruthy();
  });

  it('カウントアップを止めると最初から合計を出す', () => {
    render(<GameRankRows ranks={RANKS} countUp={false} />);

    expect(screen.getByText('13点')).toBeTruthy();
    expect(screen.queryByText('8点')).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
pnpm exec vitest run packages/web/src/components/GameRankRows.test.tsx
```

Expected: FAIL（`./GameRankRows` が解決できない）

- [ ] **Step 3: 部品を書く**

`packages/web/src/components/GameRankRows.tsx`

```tsx
import { useEffect, useState } from 'react';

import { cx } from '../lib/cx';
import { prefersReducedMotion } from '../lib/prefers-reduced-motion';

import { Tag } from './Tag';
import styles from './GameRankRows.module.css';

/** 1 戦のリザルトが出す内容だけを持つ view-model。 */
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
    <li className={cx(styles.row, rank.place === 1 && styles.top)}>
      <span className={styles.place}>{rank.place}</span>
      <span className={styles.name}>{rank.name}</span>
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
```

- [ ] **Step 4: CSS を書く**

`packages/web/src/components/GameRankRows.module.css` は、削除予定の `packages/web/src/components/RankRow.module.css` から `.rows` `.row` `.top` `.place` `.name` `.title` `.score` `.gain` をそのまま写す（`.history` は写さない）。写したうえで `.gain` に加点が乗る動きを足す。

```css
/* この戦で得た分。合計の上に小さく添える。 */
.gain {
  display: block;
  font-size: var(--font-size-micro);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-caution);
  animation: gain-pop 240ms var(--ease-out, ease-out);
}

@keyframes gain-pop {
  from {
    transform: translateY(6px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .gain {
    animation: none;
  }
}
```

`--ease-out` が `docs/design/design-tokens.css` に無ければ `ease-out` を直接書く（`grep -n "ease" docs/design/design-tokens.css` で確認）。

- [ ] **Step 5: テストが通ることを確認する**

```bash
pnpm exec vitest run packages/web/src/components/GameRankRows.test.tsx
```

Expected: PASS（3件）

- [ ] **Step 6: GameResultScreen を差し替える**

`packages/web/src/screens/GameResultScreen.tsx` のインポートと `ranks` の型・描画を差し替える。

```tsx
import { GameRankRows } from '../components/GameRankRows';
import type { GameRankView } from '../components/GameRankRows';
```

props の型は `ranks: readonly GameRankView[];`、本文の `<RankRows ranks={ranks} />` は `<GameRankRows ranks={ranks} />` にする。

- [ ] **Step 7: 見本データを合わせる**

`packages/web/src/fixtures/demo.ts` の `DEMO_GAME_RANKS` は「第3戦のあと」を見せるので、累計点に直す。型注釈も `readonly GameRankView[]` に変える（インポート元は `../components/GameRankRows`）。

```ts
export const DEMO_GAME_RANKS: readonly GameRankView[] = [
  {
    place: 1,
    name: 'あなた',
    kind: 'human',
    title: '大富豪',
    gainedPoints: 5,
    totalPoints: 13,
  },
  {
    place: 2,
    name: 'プレイヤーB',
    kind: 'ai',
    title: '富豪',
    gainedPoints: 3,
    totalPoints: 10,
  },
  {
    place: 3,
    name: 'プレイヤーC',
    kind: 'human',
    title: '貧民',
    gainedPoints: 2,
    totalPoints: 7,
  },
  {
    place: 4,
    name: 'プレイヤーD',
    kind: 'ai',
    title: '大貧民',
    gainedPoints: 1,
    totalPoints: 6,
  },
];
```

- [ ] **Step 8: 型検査とテストを通す**

```bash
pnpm typecheck && pnpm exec vitest run packages/web
```

Expected: 型エラーなし。`RankRow` を使う `SetResultScreen` はまだ残っているので web のテストは緑のまま。

- [ ] **Step 9: コミット**

```bash
git add packages/web/src/components/GameRankRows.tsx packages/web/src/components/GameRankRows.module.css packages/web/src/components/GameRankRows.test.tsx packages/web/src/screens/GameResultScreen.tsx packages/web/src/fixtures/demo.ts
git commit -m "feat: show gained points and counting total in game result rows"
```

---

### Task 4: セット結果の1位カードと2〜4位の行

**Files:**
- Create: `packages/web/src/components/SetRankRows.tsx`
- Create: `packages/web/src/components/SetRankRows.module.css`
- Test: `packages/web/src/components/SetRankRows.test.tsx`
- Modify: `packages/web/src/screens/SetResultScreen.tsx`
- Modify: `packages/web/src/screens/SetResultScreen.test.tsx:56-80`
- Modify: `packages/web/src/fixtures/demo.ts:141-180`
- Delete: `packages/web/src/components/RankRow.tsx`, `packages/web/src/components/RankRow.module.css`

- [ ] **Step 1: 失敗するテストを書く**

`packages/web/src/components/SetRankRows.test.tsx`

```tsx
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SetRankRows } from './SetRankRows';
import styles from './SetRankRows.module.css';

afterEach(cleanup);

const RANKS = [
  {
    place: 1,
    name: 'あなた',
    kind: 'human' as const,
    title: '大富豪',
    totalPoints: 13,
    isYou: true,
  },
  {
    place: 2,
    name: 'プレイヤーB',
    kind: 'ai' as const,
    title: '富豪',
    totalPoints: 10,
  },
];

describe('SetRankRows', () => {
  it('1位を花形カードにし、称号と合計点を出す', () => {
    const view = render(<SetRankRows ranks={RANKS} />);

    const champion = view.container.querySelector(`.${styles.champion}`);
    expect(champion).toBeTruthy();
    expect(champion!.textContent).toContain('1位');
    expect(champion!.textContent).toContain('大富豪');
    expect(champion!.textContent).toContain('あなた');
    expect(champion!.textContent).toContain('13点');
  });

  it('2位以下は行にし、自分の行だけ目印を付ける', () => {
    const view = render(
      <SetRankRows
        ranks={[
          { ...RANKS[0]!, isYou: false },
          { ...RANKS[1]!, isYou: true },
        ]}
      />,
    );

    expect(screen.getByText('10点')).toBeTruthy();
    expect(view.container.querySelectorAll(`.${styles.you}`)).toHaveLength(1);
  });

  it('各戦の順位の推移は出さない', () => {
    render(<SetRankRows ranks={RANKS} />);

    expect(screen.queryByText(/→/)).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
pnpm exec vitest run packages/web/src/components/SetRankRows.test.tsx
```

Expected: FAIL（`./SetRankRows` が解決できない）

- [ ] **Step 3: 部品を書く**

`packages/web/src/components/SetRankRows.tsx`

```tsx
import { cx } from '../lib/cx';

import { Tag } from './Tag';
import styles from './SetRankRows.module.css';

/** セット総合の順位が出す内容だけを持つ view-model。 */
export type SetRankView = {
  place: number;
  name: string;
  kind: 'human' | 'ai';
  /** 大富豪・富豪・貧民・大貧民。 */
  title?: string;
  /** セット 3 戦の合計順位点。 */
  totalPoints: number;
  isYou?: boolean;
};

/**
 * セットリザルトの順位。1 位だけ花形カードにして、2 位以下は 1 行ずつ。
 * 各戦の内訳は直前の最終戦リザルトで見せているので、ここは合計点だけ。
 */
export function SetRankRows({ ranks }: { ranks: readonly SetRankView[] }) {
  const champion = ranks.find((rank) => rank.place === 1);
  const rest = ranks.filter((rank) => rank.place !== 1);
  return (
    <div className={styles.wrap}>
      {champion && (
        <div className={cx(styles.champion, champion.isYou && styles.you)}>
          <span className={styles.crown}>{champion.place}位</span>
          {champion.title && (
            <span className={styles.championTitle}>{champion.title}</span>
          )}
          <span className={styles.championName}>{champion.name}</span>
          <span className={styles.championScore}>
            {String(champion.totalPoints)}点
          </span>
          <Tag variant={champion.kind}>
            {champion.kind === 'human' ? '人間' : 'AI'}
          </Tag>
        </div>
      )}
      <ol className={styles.rows}>
        {rest.map((rank) => (
          <li
            key={rank.name}
            className={cx(styles.row, rank.isYou && styles.you)}
          >
            <span className={styles.place}>{rank.place}</span>
            <span className={styles.name}>{rank.name}</span>
            {rank.title && <span className={styles.title}>{rank.title}</span>}
            <span className={styles.score}>{String(rank.totalPoints)}点</span>
            <Tag variant={rank.kind}>
              {rank.kind === 'human' ? '人間' : 'AI'}
            </Tag>
          </li>
        ))}
      </ol>
    </div>
  );
}
```

- [ ] **Step 4: CSS を書く**

`packages/web/src/components/SetRankRows.module.css`

`.rows` `.row` `.place` `.name` `.title` `.score` は `packages/web/src/components/RankRow.module.css` から写す（`.top` `.history` `.gain` は写さない）。そのうえで下記を足す。`.champion` は紙吹雪の親になるので `position: relative` が要る。

```css
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* 1 位。セットの主役なので、行ではなく面で見せる。 */
.champion {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  background: var(--color-gold-200);
  border: var(--border-bold) solid var(--color-border-strong);
  border-radius: var(--radius-m);
  padding: var(--space-4) var(--space-3);
  box-shadow: var(--shadow-hard-m);
  animation: champion-pop 320ms ease-out;
}

.crown {
  font-size: var(--font-size-title-s);
  font-weight: var(--font-weight-heavy);
  color: var(--color-text-caution);
}

.championTitle {
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-secondary);
}

.championName {
  font-size: var(--font-size-title-l);
  font-weight: var(--font-weight-heavy);
  line-height: 1.2;
}

.championScore {
  font-size: var(--font-size-title-m);
  font-weight: var(--font-weight-heavy);
}

/* 自分の行。1 位でなくても自分の結果に目が行くようにひと弾みだけさせる。 */
.you {
  animation: you-bounce 420ms ease-out;
}

@keyframes champion-pop {
  from {
    transform: scale(0.9);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes you-bounce {
  0% {
    transform: translateY(6px);
  }
  60% {
    transform: translateY(-3px);
  }
  100% {
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .champion,
  .you {
    animation: none;
  }
}
```

`--space-1` `--space-4` `--radius-m` `--shadow-hard-m` `--font-size-title-l` が `docs/design/design-tokens.css` に無ければ、実在する近いトークンに置き換える（`grep -n "space-\|shadow-hard\|font-size-title" docs/design/design-tokens.css` で確認）。

- [ ] **Step 5: テストが通ることを確認する**

```bash
pnpm exec vitest run packages/web/src/components/SetRankRows.test.tsx
```

Expected: PASS（3件）

- [ ] **Step 6: SetResultScreen を差し替え、紙吹雪を足す**

`packages/web/src/screens/SetResultScreen.tsx` のインポートを差し替える。

```tsx
import { Confetti } from '../components/Confetti';
import { SetRankRows } from '../components/SetRankRows';
import type { SetRankView } from '../components/SetRankRows';
```

props の型は `ranks: readonly SetRankView[];`。`<RankRows ranks={ranks} />` を次に差し替える。

```tsx
        <SetRankRows ranks={ranks} />
```

紙吹雪は「自分が1位のときだけ」。`SetRankRows` の中ではなく画面が出す（1位カードの上に重ねるため、`SetRankRows` を包む要素に `position: relative` が要る）。`SetResultScreen.tsx` の該当箇所を次にする。

```tsx
        <div className={styles.podium}>
          {ranks.some((rank) => rank.place === 1 && rank.isYou) && <Confetti />}
          <SetRankRows ranks={ranks} />
        </div>
```

`packages/web/src/screens/SetResultScreen.module.css` に足す。

```css
/* 紙吹雪を 1 位カードの上に重ねるための土台。 */
.podium {
  position: relative;
}
```

- [ ] **Step 7: 既存の画面テストを新しい形に直す**

`packages/web/src/screens/SetResultScreen.test.tsx` の「順位行にセット合計点を出す」を次に置き換える。

```tsx
  it('1位を花形カードにして合計点を出し、順位推移は出さない', () => {
    render(
      <SetResultScreen
        ranks={[
          {
            place: 1,
            name: 'あなた',
            kind: 'human',
            title: '大富豪',
            totalPoints: 13,
            isYou: true,
          },
        ]}
        funRating={null}
        firedRules={[]}
        onChangeFunRating={() => undefined}
        onVoteRule={() => undefined}
        onPlayAgain={() => undefined}
        onHome={() => undefined}
        showEvaluation={false}
      />,
    );

    expect(screen.getByText('13点')).toBeTruthy();
    expect(screen.queryByText(/→/)).toBeNull();
  });

  it('自分が1位のときだけ紙吹雪を出す', () => {
    const rank = {
      place: 1,
      name: 'あなた',
      kind: 'human' as const,
      title: '大富豪',
      totalPoints: 13,
    };
    const props = {
      funRating: null,
      firedRules: [],
      onChangeFunRating: () => undefined,
      onVoteRule: () => undefined,
      onPlayAgain: () => undefined,
      onHome: () => undefined,
      showEvaluation: false,
    } as const;

    const won = render(
      <SetResultScreen {...props} ranks={[{ ...rank, isYou: true }]} />,
    );
    expect(
      won.container.querySelectorAll('[aria-hidden="true"] span').length,
    ).toBeGreaterThan(0);
    cleanup();

    const lost = render(
      <SetResultScreen
        {...props}
        ranks={[
          { ...rank, name: 'プレイヤーB', kind: 'ai', isYou: false },
          {
            place: 2,
            name: 'あなた',
            kind: 'human',
            title: '富豪',
            totalPoints: 10,
            isYou: true,
          },
        ]}
      />,
    );
    expect(lost.container.querySelector(`.${confettiStyles.field}`)).toBeNull();
  });
```

ファイル先頭に `import confettiStyles from '../components/Confetti.module.css';` を足し、勝ったほうの検査も `confettiStyles.field` で書く（`aria-hidden` の総当たりは他の装飾を拾うので使わない）。

```tsx
    expect(won.container.querySelector(`.${confettiStyles.field}`)).toBeTruthy();
```

- [ ] **Step 8: 見本データを合わせる**

`packages/web/src/fixtures/demo.ts` の `DEMO_SET_RANKS` から `history` を落とし、型を `readonly SetRankView[]`（インポート元は `../components/SetRankRows`）にして、1位に `isYou: true` を足す。

```ts
export const DEMO_SET_RANKS: readonly SetRankView[] = [
  {
    place: 1,
    name: 'あなた',
    kind: 'human',
    title: '大富豪',
    totalPoints: 13,
    isYou: true,
  },
  {
    place: 2,
    name: 'プレイヤーB',
    kind: 'ai',
    title: '富豪',
    totalPoints: 10,
  },
  {
    place: 3,
    name: 'プレイヤーC',
    kind: 'human',
    title: '貧民',
    totalPoints: 7,
  },
  {
    place: 4,
    name: 'プレイヤーD',
    kind: 'ai',
    title: '大貧民',
    totalPoints: 6,
  },
];
```

- [ ] **Step 9: 古い部品を消す**

```bash
git rm packages/web/src/components/RankRow.tsx packages/web/src/components/RankRow.module.css
grep -rn "RankRow\|RankView" packages/web/src | grep -v "GameRankRow\|SetRankRow"
```

Expected: 2つ目のコマンドの出力が空（`App.tsx` に残る `RankView` は Task 5 で直すので、ここで出た場合は Task 5 まで持ち越さずこの場で `SetRankView` / `GameRankView` に直す）

- [ ] **Step 10: テストと型検査を通す**

```bash
pnpm typecheck && pnpm exec vitest run packages/web
```

Expected: すべて PASS

- [ ] **Step 11: コミット**

```bash
git add -A packages/web/src
git commit -m "feat: celebrate the set winner with a champion card and confetti"
```

---

### Task 5: 最終戦リザルトを挟む

**Files:**
- Modify: `packages/web/src/App.tsx:462-500`（`gameRanks` の隣に `finalGameRanks`）, `:740-745`（`visibleSetResultRoom` の手前）
- Test: `packages/web/src/App.test.tsx`

- [ ] **Step 1: 失敗するテストを書く**

`packages/web/src/App.test.tsx` の末尾に足す。`tutorialSetResultRoom` と同じ形の部屋を作るヘルパーを新しく書く（既存ヘルパーは1人しかいないので、最終戦の順位が出せない）。

```tsx
function finalGameRoom(
  finalGame: NonNullable<
    import('@daifugo/core').PlayerRoomView['setResult']
  >['finalGame'],
): import('@daifugo/core').PlayerRoomView {
  return {
    v: 20,
    roomId: 'final-room',
    inviteCode: '01234',
    mode: 'community',
    phase: 'setResult',
    members: [
      {
        memberId: 'member-1',
        seatId: 0,
        displayName: 'ホスト',
        isAI: false,
        isHost: true,
        connected: true,
        aiActing: false,
        departed: false,
        handCount: 0,
        finishedRank: 1,
        wantsNextSet: false,
      },
      {
        memberId: 'member-2',
        seatId: 1,
        displayName: 'プレイヤーB',
        isAI: true,
        isHost: false,
        connected: true,
        aiActing: false,
        departed: false,
        handCount: 0,
        finishedRank: 2,
        wantsNextSet: true,
      },
    ],
    you: { memberId: 'member-1', seatId: 0 },
    activeRules: [],
    game: null,
    setResult: {
      standings: [
        {
          memberId: 'member-1',
          totalRank: 1,
          title: '大富豪',
          ranks: [1, 2, 1],
          points: 13,
        },
        {
          memberId: 'member-2',
          totalRank: 2,
          title: '富豪',
          ranks: [2, 1, 2],
          points: 10,
        },
      ],
      finalGame,
      firedRules: [],
      respondBy: 1_800_000_000_000,
    },
    events: [],
  } satisfies import('@daifugo/core').PlayerRoomView;
}

const FINAL_GAME = {
  gameNo: 3,
  standings: [
    { seat: 0 as const, rank: 1 as const, title: '大富豪' as const, points: 5 },
    { seat: 1 as const, rank: 2 as const, title: '富豪' as const, points: 3 },
  ],
  firedRuleIds: [],
};

describe('セット最終戦のリザルト', () => {
  afterEach(cleanup);

  it('setResultに入るとまず最終戦の結果を出し、押すとセットリザルトへ進む', async () => {
    const user = userEvent.setup();
    const client = fakeClient(finalGameRoom(FINAL_GAME));
    render(<App client={client} />);

    expect(screen.getByText('第3戦 おわり')).toBeTruthy();
    expect(screen.getByText('+5')).toBeTruthy();
    expect(screen.queryByText('セットリザルト')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'セット結果へ' }));

    expect(screen.getByText('セットリザルト')).toBeTruthy();
    expect(screen.getByText('13点')).toBeTruthy();
  });

  it('進んだあとの更新で最終戦の結果へ巻き戻らない', async () => {
    const user = userEvent.setup();
    const client = fakeClient(finalGameRoom(FINAL_GAME));
    render(<App client={client} />);

    await user.click(screen.getByRole('button', { name: 'セット結果へ' }));
    act(() => {
      client.push({ ...finalGameRoom(FINAL_GAME), v: 21 });
    });

    expect(screen.getByText('セットリザルト')).toBeTruthy();
    expect(screen.queryByText('第3戦 おわり')).toBeNull();
  });

  it('最終戦の結果が無いセットでは直接セットリザルトを出す', () => {
    const client = fakeClient(finalGameRoom(null));
    render(<App client={client} />);

    expect(screen.getByText('セットリザルト')).toBeTruthy();
    expect(screen.queryByText(/おわり/)).toBeNull();
  });
});
```

クライアントは既存の `observableTutorialClient`（`packages/web/src/App.test.tsx:557`。`{ client, setRoom }` を返す）を使う。上のテストの `fakeClient(x)` / `client.push(y)` はそれぞれ次に読み替えて書く。

```tsx
    const observable = observableTutorialClient(finalGameRoom(FINAL_GAME));
    render(<App client={observable.client} />);
    // 更新は act(() => { observable.setRoom({ ...finalGameRoom(FINAL_GAME), v: 21 }); });
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
pnpm exec vitest run packages/web/src/App.test.tsx -t 最終戦
```

Expected: FAIL（最初から「セットリザルト」が出ている）

- [ ] **Step 3: 最終戦の順位を組む関数を足す**

`packages/web/src/App.tsx` の `gameRanks` の下に足す。

```tsx
/**
 * セットリザルト直前に見せる最終戦の順位。
 * 加点は最終戦の順位点、合計点はセットの合計(最終戦なので両者は一致する)。
 */
function finalGameRanks(room: PlayerRoomView): GameRankView[] {
  const finalGame = room.setResult?.finalGame;
  if (!finalGame) return [];
  const totals = new Map(
    (room.setResult?.standings ?? []).map((standing) => [
      standing.memberId,
      standing.points,
    ]),
  );
  const bySeat = new Map(
    room.members.flatMap((member) =>
      member.seatId === null ? [] : ([[member.seatId, member]] as const),
    ),
  );
  return [...finalGame.standings]
    .sort((left, right) => left.rank - right.rank)
    .map((standing) => {
      const member = bySeat.get(standing.seat);
      return {
        place: standing.rank,
        name:
          member?.memberId === room.you.memberId
            ? 'あなた'
            : (member?.displayName ?? `席${String(standing.seat + 1)}`),
        kind: member?.isAI ? ('ai' as const) : ('human' as const),
        title: standing.title,
        gainedPoints: standing.points,
        totalPoints: member
          ? (totals.get(member.memberId) ?? standing.points)
          : standing.points,
      };
    });
}
```

`setRanks` は `isYou` を足す（`SetRankView` になったので）。返り値の型を `SetRankView[]` にして、`title: standing.title,` の隣に足す。

```tsx
        isYou: standing.memberId === room.you.memberId,
```

`history: standing.ranks,` の行は消す。

- [ ] **Step 4: 表示段階を足す**

`packages/web/src/App.tsx` の `ConnectedApp` の中、他の `useState` が並ぶあたりに足す。

```tsx
  /** 最終戦リザルトを見終えたセット。`sync` や再接続で画面が巻き戻らないようにする。 */
  const [finalResultSeen, setFinalResultSeen] = useState<string | null>(null);
  const finalResultDeadline = useRef<{ key: string; at: number } | null>(null);
```

ファイル上部の定数のそばに足す。

```tsx
/** 最終戦リザルトを見せる時間。サーバーは関与しない、この端末だけの間。 */
const FINAL_RESULT_MS = 10_000;
```

`visibleSetResultRoom` の定義（`packages/web/src/App.tsx:740`）の直後に、セットリザルトの分岐（`if (visibleSetResultRoom) {`）より前で分岐を足す。

```tsx
  const finalResultKey =
    room?.phase === 'setResult' && room.setResult?.finalGame
      ? `${room.roomId}:${String(room.setResult.respondBy)}`
      : null;
  if (room && finalResultKey && finalResultSeen !== finalResultKey) {
    const gameNo = room.setResult!.finalGame!.gameNo;
    if (finalResultDeadline.current?.key !== finalResultKey) {
      finalResultDeadline.current = {
        key: finalResultKey,
        at: Date.now() + FINAL_RESULT_MS,
      };
    }
    return show(
      <GameResultScreen
        title={`第${String(gameNo)}戦 おわり`}
        progressLabel={`セット ${String(gameNo)} / ${String(gameNo)} 戦`}
        ranks={finalGameRanks(room)}
        nextLabel="セット結果へ"
        autoAdvanceMs={FINAL_RESULT_MS}
        autoAdvanceAt={finalResultDeadline.current.at}
        onNext={() => {
          setFinalResultSeen(finalResultKey);
        }}
      />,
    );
  }
```

`useRef` が `react` からインポート済みでなければ足す。

- [ ] **Step 5: テストが通ることを確認する**

```bash
pnpm exec vitest run packages/web/src/App.test.tsx
```

Expected: すべて PASS（既存の setResult まわりのテストは `finalGame: null` なので素通りする）

- [ ] **Step 6: コミット**

```bash
git add packages/web/src/App.tsx packages/web/src/App.test.tsx
git commit -m "feat: show the final game result before the set result"
```

---

### Task 6: ローカル見本フローの文言を合わせる

**Files:**
- Modify: `packages/web/src/App.tsx:311-323`（`case 'gameResult':`）

- [ ] **Step 1: 見本の文言を最終戦に合わせる**

見本フローは `第1戦 → セットリザルト` になっていて、実際の動線（最終戦 → セットリザルト）と食い違う。`case 'gameResult':` の props を直す。

```tsx
    case 'gameResult':
      return (
        <GameResultScreen
          title="第3戦 おわり"
          progressLabel="セット 3 / 3 戦"
          ranks={DEMO_GAME_RANKS}
          nextLabel="セット結果へ"
          autoAdvanceMs={10_000}
          autoAdvanceAt={Date.now() + 10_000}
          onNext={() => {
            go('setResult');
          }}
        />
      );
```

- [ ] **Step 2: 見本フローが動くことを確認する**

```bash
pnpm exec vitest run packages/web
```

Expected: すべて PASS

- [ ] **Step 3: コミット**

```bash
git add packages/web/src/App.tsx
git commit -m "chore: align the demo flow with the final game result screen"
```

---

### Task 7: 仕上げ

**Files:**
- Modify: `docs/impl-progress.md`

- [ ] **Step 1: 全体検証を走らせる**

```bash
pnpm verify
```

Expected: `format:check` `lint` `lint:design` `typecheck` `test` `build` がすべて成功。`format:check` が落ちたら `pnpm format` をかけ直す。

- [ ] **Step 2: 進捗記録を足す**

`docs/impl-progress.md` の書式（既存の行を読んで合わせる）に沿って、最終戦リザルトとセットリザルトを分けたことを1行足す。

- [ ] **Step 3: コミット**

```bash
git add docs/impl-progress.md
git commit -m "docs: record the set result split"
```

---

## 動作確認（任意）

ローカルで見た目を確かめるときは web の開発サーバーを起動し、見本フロー（タイトル → メニュー → 見本のゲーム → パスで `gameResult`）で 第3戦 → セットリザルト の2枚を通す。1位カードと紙吹雪、加点から合計点へのカウントアップを目で見る。OS の「視差効果を減らす」を入れると紙吹雪とカウントアップが止まることも確認する。
