# マイ提案のステータス表示を読めるようにする 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** マイ提案カードで「いまどの工程か」が一目で読めるようにし、工程名を平易な語に置き換え、状態の二重表示をなくす。

**Architecture:** ステッパー部品（`ProposalStepper`）の状態スタイルの強弱を入れ替える。いまは「通過済み＝紺ベタ」が最も濃く現在地より目立つので、通過済みを白地の淡いチップ＋✓に落とし、現在地（`now` / `released` / `rejected`）だけを太枠・大きめの文字・ベタ落ち影で立てる。連結線にも通過済み／未到達の2状態を持たせる。呼び出し側（`MyProposalsScreen`）は文言を差し替え、重複していた右上の状態バッジを削除する。部品の props と型は変えないので、変更は各ファイルに閉じる。

**Tech Stack:** TypeScript / React 19 / CSS Modules / Vitest + @testing-library/react / pnpm workspace（`@daifugo/core` → `@daifugo/web`）

設計: [docs/superpowers/specs/2026-07-29-my-proposals-status-readability-design.md](../specs/2026-07-29-my-proposals-status-readability-design.md)

## Global Constraints

- 表示語は次の5つで統一する。`screening`=**確認中** / `implementing`=**開発中** / `released`=**あそべる** / `rejected`=**見送り** / `failed`=**開発できず**。
- 色・寸法・影・角丸はすべて `docs/design/design-tokens.css` の既存トークン（`var(--…)`）で組む。生の hex を新しく足さない。`pnpm lint:design` が `scripts/check-design-tokens.mjs` でこれを検査する。
- `--color-text-disabled`（`navy-300`）を文字色に使わない。クリーム地に対して WCAG AA を満たさず、無効化された操作でもないため。後退の表現は破線と塗りなしで行う。
- 視覚的に隠して支援技術には読ませる場合は、`packages/web/src/styles/global.css` の既存クラス `sr-only` を使う（CSS Modules 側に同等物を作らない）。
- `ProposalStatus` そのもの（サーバー・プロトコルの値）は変更しない。変えるのは表示語だけ。
- 各タスクの最後に必ずコミットする。

---

## ファイル構成

| ファイル | 役割 | 変更 |
| --- | --- | --- |
| `packages/web/src/components/ProposalStepper.tsx` | ステップの描画、現在地の印、連結線の状態出し分け | 修正 |
| `packages/web/src/components/ProposalStepper.module.css` | 5状態のチップと連結線2状態のスタイル | 修正 |
| `packages/web/src/components/ProposalStepper.test.tsx` | 部品単体のテスト | 新規 |
| `packages/web/src/screens/MyProposalsScreen.tsx` | 表示語、バッジ削除、日付の畳み込み | 修正 |
| `packages/web/src/screens/MyProposalsScreen.module.css` | `.status` の削除 | 修正 |
| `packages/web/src/screens/MyProposalsScreen.test.tsx` | 画面のテスト | 修正 |
| `packages/web/src/screens/ProposalFormScreen.tsx` | 受付直後バッジと Callout の語を追随 | 修正 |
| `packages/web/src/screens/ProposalFormScreen.test.tsx` | 「審査中」を期待している2箇所 | 修正 |
| `docs/design/design-system.html` | §5-9 の見本と `.c-steps` の CSS | 修正 |
| `docs/design/デザインシステム.md` | §6「色だけに頼らない」の記述 | 修正 |

---

### Task 1: ステッパー部品の強弱を入れ替える

**Files:**
- Modify: `packages/web/src/components/ProposalStepper.tsx`
- Modify: `packages/web/src/components/ProposalStepper.module.css`
- Test: `packages/web/src/components/ProposalStepper.test.tsx`（新規）

**Interfaces:**
- Consumes: `cx()`（`packages/web/src/lib/cx.ts`、シグネチャ `(...values: Array<string | false | null | undefined>) => string`）、`sr-only`（`packages/web/src/styles/global.css` のグローバルクラス）。
- Produces: `ProposalStepper` と型 `ProposalStep` / `StepState` は**シグネチャを変えない**。Task 2 はこれまでどおり `<ProposalStepper steps={...} />` で呼ぶ。DOM 上の約束として、現在ステップの `<li>` は `aria-current="step"` を持ち、`done` の `<li>` は末尾に「済み」というテキストを含む。

- [ ] **Step 1: 失敗するテストを書く**

`packages/web/src/components/ProposalStepper.test.tsx` を新規作成する。

```tsx
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProposalStepper } from './ProposalStepper';

afterEach(cleanup);

describe('ProposalStepper', () => {
  it('進行中のステップだけを現在地として示す', () => {
    render(
      <ProposalStepper
        steps={[
          { label: '確認中', state: 'done' },
          { label: '開発中', state: 'now' },
          { label: 'あそべる', state: 'pending' },
        ]}
      />,
    );

    const current = screen.getAllByRole('listitem', { current: 'step' });
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain('開発中');
    expect(current[0].textContent).toContain('いま');
  });

  it('通過済みのステップは支援技術に「済み」を読ませる', () => {
    render(
      <ProposalStepper
        steps={[
          { label: '確認中', state: 'done' },
          { label: '開発中', state: 'now' },
          { label: 'あそべる', state: 'pending' },
        ]}
      />,
    );

    const done = screen.getByRole('listitem', { name: /確認中.*済み/ });
    expect(done.getAttribute('aria-current')).toBe(null);
  });

  it('終点のリリース・却下も現在地として示す', () => {
    const { rerender } = render(
      <ProposalStepper
        steps={[
          { label: '確認中', state: 'done' },
          { label: '開発中', state: 'done' },
          { label: 'あそべる', state: 'released' },
        ]}
      />,
    );
    expect(
      screen.getByRole('listitem', { current: 'step' }).textContent,
    ).toContain('あそべる');

    rerender(
      <ProposalStepper
        steps={[
          { label: '確認中', state: 'done' },
          { label: '見送り', state: 'rejected' },
        ]}
      />,
    );
    expect(
      screen.getByRole('listitem', { current: 'step' }).textContent,
    ).toContain('見送り');
  });

  it('連結線は通過済み区間と未到達区間で別のクラスを持つ', () => {
    const { container } = render(
      <ProposalStepper
        steps={[
          { label: '確認中', state: 'done' },
          { label: '開発中', state: 'now' },
          { label: 'あそべる', state: 'pending' },
        ]}
      />,
    );

    const lines = container.querySelectorAll('ol > span');
    expect(lines).toHaveLength(2);
    expect(lines[0].className).not.toBe(lines[1].className);
  });
});
```

`getByRole('listitem', { name: ... })` は `<li>` のアクセシブル名を内容から取る。`sr-only` の「済み」は DOM 上に存在するので、jsdom でも読める（`sr-only` の CSS は jsdom では適用されないが、テストは DOM のテキストを見ているだけなので影響しない）。

- [ ] **Step 2: テストを走らせて失敗を確認する**

Run: `pnpm vitest run packages/web/src/components/ProposalStepper.test.tsx`
Expected: FAIL。`aria-current` が付いていないため `getAllByRole('listitem', { current: 'step' })` が0件になり、「済み」も「いま」も存在しない。

- [ ] **Step 3: 部品を書き換える**

`packages/web/src/components/ProposalStepper.tsx` を次の内容にする。

```tsx
import { Fragment } from 'react';

import { cx } from '../lib/cx';

import styles from './ProposalStepper.module.css';

export type StepState = 'pending' | 'done' | 'now' | 'released' | 'rejected';

export type ProposalStep = {
  label: string;
  state: StepState;
};

const stateClass: Record<StepState, string> = {
  pending: styles.pending,
  done: styles.done,
  now: styles.now,
  released: styles.released,
  rejected: styles.rejected,
};

/** 現在地として強調する状態。released / rejected は終点かつ現在地。 */
const CURRENT_STATES: readonly StepState[] = ['now', 'released', 'rejected'];

type ProposalStepperProps = {
  steps: readonly ProposalStep[];
  /** 見送り・開発できずのときの説明文。 */
  reason?: string;
};

export function ProposalStepper({ steps, reason }: ProposalStepperProps) {
  return (
    <div>
      <ol className={styles.steps}>
        {steps.map((step, index) => (
          <Fragment key={step.label}>
            {index > 0 && (
              <span
                className={cx(
                  styles.line,
                  steps[index - 1].state === 'done' && styles.linePassed,
                )}
                aria-hidden="true"
              />
            )}
            <li
              className={cx(styles.step, stateClass[step.state])}
              aria-current={
                CURRENT_STATES.includes(step.state) ? 'step' : undefined
              }
            >
              {step.state === 'done' && (
                <svg
                  className={styles.check}
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M1.5 5.5 4 8l4.5-6" />
                </svg>
              )}
              {step.state === 'now' && (
                <span className={styles.nowMark}>いま</span>
              )}
              {step.label}
              {step.state === 'done' && <span className="sr-only"> 済み</span>}
            </li>
          </Fragment>
        ))}
      </ol>
      {reason && <p className={styles.reason}>見送りの理由: {reason}</p>}
    </div>
  );
}
```

`reason` prop は現状どの画面からも渡されていない（`MyProposalsScreen` は自前の `<p>` で理由を出している）。今回は削除せず、語だけ「却下理由」→「見送りの理由」に揃える。

- [ ] **Step 4: スタイルを書き換える**

`packages/web/src/components/ProposalStepper.module.css` の `.step` から `.line` までを次の内容に置き換える。冒頭のコメント行（`/* design-system.html §5-9 … */`）と `.steps`、末尾の `.reason` はそのまま残す。

```css
.step {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--font-size-micro);
  font-weight: var(--font-weight-bold);
  border: var(--border-control) solid transparent;
  border-radius: var(--radius-pill);
  padding: 3px 10px;
  white-space: nowrap;
}

/* 通過済み=白地の淡いチップ+✓(現在地より弱くする) */
.done {
  background: var(--color-bg-surface);
  border-color: var(--color-border-control);
  color: var(--color-text-secondary);
}

/* 未到達=塗りなし+破線 */
.pending {
  background: transparent;
  border-style: dashed;
  border-color: var(--color-navy-300);
  color: var(--color-text-secondary);
}

/* 現在地は状態を問わず、太枠・1段大きい文字・ベタ落ち影で立てる */
.now,
.released,
.rejected {
  border-width: var(--border-bold);
  border-color: var(--color-border-strong);
  font-size: var(--font-size-caption);
  padding: 5px 12px;
  box-shadow: var(--shadow-hard-s);
}

/* 進行中=金(注意=「いま動いている」) */
.now {
  background: var(--color-gold-400);
  color: var(--color-warning-ink);
}

/* リリース=緑(成功) */
.released {
  background: var(--color-green-700);
  color: var(--color-text-on-fill);
}

/* 見送り・開発できず=赤 */
.rejected {
  background: var(--color-red-600);
  color: var(--color-text-on-fill);
}

.check {
  width: 10px;
  height: 10px;
  flex-shrink: 0;
}

.nowMark {
  font-size: var(--font-size-micro);
}

/* 通過した区間だけ線を濃くして、進み具合を線にも語らせる */
.line {
  width: 12px;
  height: 2px;
  background: var(--color-navy-200);
  flex-shrink: 0;
}

.linePassed {
  background: var(--color-navy-800);
}
```

- [ ] **Step 5: テストを走らせて通ることを確認する**

Run: `pnpm vitest run packages/web/src/components/ProposalStepper.test.tsx`
Expected: PASS（4件）

- [ ] **Step 6: トークン検査と型検査**

Run: `pnpm lint:design && pnpm --filter @daifugo/web typecheck`
Expected: どちらも成功。失敗する場合、生の色値を足していないか（`lint:design`）、`styles.pending` などのクラスが CSS 側に無いか（typecheck では検出されないので Step 5 の見た目で確認）を疑う。

- [ ] **Step 7: コミット**

```bash
git add packages/web/src/components/ProposalStepper.tsx packages/web/src/components/ProposalStepper.module.css packages/web/src/components/ProposalStepper.test.tsx
git commit -m "feat: ステッパーの現在地を強く、通過済みを弱くする"
```

---

### Task 2: マイ提案カードの文言・バッジ・日付

**Files:**
- Modify: `packages/web/src/screens/MyProposalsScreen.tsx:18-24`, `:56-89`, `:155-175`
- Modify: `packages/web/src/screens/MyProposalsScreen.module.css:26-45`
- Test: `packages/web/src/screens/MyProposalsScreen.test.tsx`

**Interfaces:**
- Consumes: Task 1 の `ProposalStepper`（props は不変）。`done` の `<li>` は「済み」を含み、現在ステップは `aria-current="step"` を持つ。
- Produces: なし（画面の末端）。

- [ ] **Step 1: 失敗するテストを書く**

`packages/web/src/screens/MyProposalsScreen.test.tsx` の1つ目の `it(...)` の末尾（`expect(onUnreadCountChange.mock.calls).toEqual([[2], [0]]);` の直後）に次を足す。

```tsx
    expect(screen.getByText('あそべる')).toBeTruthy();
    expect(screen.getByText('開発できず')).toBeTruthy();
    expect(screen.queryByText('リリース')).toBe(null);
    expect(screen.queryByText('実装失敗')).toBe(null);
    expect(screen.getByText('2026/7/29 から あそべる')).toBeTruthy();
```

`statusChangedAt` が `2`（1970年）のままだと日付文字列が合わないので、同じテスト内の2件のアイテムの `statusChangedAt` を `Date.UTC(2026, 6, 29, 3)` に、`markProposalsSeen` の期待値も同じ値に変える。`Date.UTC(2026, 6, 29, 3)` は JST で 2026-07-29 12:00 になり、`Intl.DateTimeFormat('ja-JP')` の結果が実行環境のタイムゾーンに左右されにくい。

同じファイルに、状態の二重表示が消えたことのテストを新しい `it` として足す。

```tsx
  it('状態はステッパーだけが持ち、見出しにバッジを重ねない', async () => {
    const api: ProposalApi = {
      submit: vi.fn(),
      mine: async () => ({
        unreadCount: 0,
        items: [
          {
            id: 'implementing',
            kind: 'original',
            prefectureCode: null,
            prefectureName: null,
            name: '開発中ルール',
            body: '本文',
            status: 'implementing',
            reason: null,
            releasedRuleId: null,
            popularity: null,
            priorityRank: null,
            unread: false,
            createdAt: 1,
            statusChangedAt: Date.UTC(2026, 6, 29, 3),
          },
        ],
      }),
      markProposalsSeen: vi.fn(async () => undefined),
    };

    render(<MyProposalsScreen api={api} onBack={() => undefined} />);

    expect(await screen.findByText('開発中')).toBeTruthy();
    expect(screen.getAllByText('開発中')).toHaveLength(1);
    expect(
      screen.getByRole('listitem', { current: 'step' }).textContent,
    ).toContain('いま開発中');
    expect(screen.getByText('2026/7/29 更新')).toBeTruthy();
  });
```

`textContent` は要素間の空白を含まないので `いま開発中` で照合する（表示上は `gap` で分かれる）。

- [ ] **Step 2: テストを走らせて失敗を確認する**

Run: `pnpm vitest run packages/web/src/screens/MyProposalsScreen.test.tsx`
Expected: FAIL。`あそべる` が見つからない、`リリース` が残っている、`開発中` が2件（バッジとステッパー）ある、日付が `リリース日: …` の形になっている。

- [ ] **Step 3: 表示語を書き換える**

`packages/web/src/screens/MyProposalsScreen.tsx:18-24` の `STATUS_LABELS` を置き換える。

```tsx
const STATUS_LABELS: Record<ProposalStatus, string> = {
  screening: '確認中',
  implementing: '開発中',
  released: 'あそべる',
  rejected: '見送り',
  failed: '開発できず',
};
```

続いて `:56-89` の `statusSteps()` を、ラベルを `STATUS_LABELS` から引く形に置き換える（文言の定義を1か所に保つ）。

```tsx
function statusSteps(status: ProposalStatus): ProposalStep[] {
  if (status === 'rejected') {
    return [
      { label: STATUS_LABELS.screening, state: 'done' },
      { label: STATUS_LABELS.rejected, state: 'rejected' },
    ];
  }
  if (status === 'failed') {
    return [
      { label: STATUS_LABELS.screening, state: 'done' },
      { label: STATUS_LABELS.implementing, state: 'done' },
      { label: STATUS_LABELS.failed, state: 'rejected' },
    ];
  }
  return [
    {
      label: STATUS_LABELS.screening,
      state: status === 'screening' ? 'now' : 'done',
    },
    {
      label: STATUS_LABELS.implementing,
      state:
        status === 'implementing'
          ? 'now'
          : status === 'screening'
            ? 'pending'
            : 'done',
    },
    {
      label: STATUS_LABELS.released,
      state: status === 'released' ? 'released' : 'pending',
    },
  ];
}
```

- [ ] **Step 4: バッジを外し、日付を畳み込む**

`packages/web/src/screens/MyProposalsScreen.tsx` の見出しから状態バッジの3行を削除する。

```tsx
              <div className={styles.heading}>
                <h2>{item.name}</h2>
                {item.unread && <span className={styles.unread}>未読</span>}
              </div>
```

日付の段落を、ラベル形式から畳み込み形式にする。

```tsx
              <p className={styles.date}>
                {item.status === 'released'
                  ? `${dateLabel(item.statusChangedAt)} から ${STATUS_LABELS.released}`
                  : `${dateLabel(item.statusChangedAt)} 更新`}
              </p>
```

- [ ] **Step 5: CSS から `.status` を消す**

`packages/web/src/screens/MyProposalsScreen.module.css:26-45` の `.status, .unread { … }` と `.status { … }` を、`.unread` 単独の宣言に置き換える。

```css
.unread {
  padding: var(--space-1) var(--space-2);
  border: var(--border-thin) solid var(--color-border-strong);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-micro);
  font-weight: var(--font-weight-bold);
  background: var(--color-action-primary);
  color: var(--color-text-on-fill);
}
```

- [ ] **Step 6: テストを走らせて通ることを確認する**

Run: `pnpm vitest run packages/web/src/screens/MyProposalsScreen.test.tsx`
Expected: PASS

- [ ] **Step 7: コミット**

```bash
git add packages/web/src/screens/MyProposalsScreen.tsx packages/web/src/screens/MyProposalsScreen.module.css packages/web/src/screens/MyProposalsScreen.test.tsx
git commit -m "feat: マイ提案の工程名を平易にし、重複した状態バッジを外す"
```

---

### Task 3: 提案フォームの語を追随させる

同じ工程を2つの名前で呼ばないようにする。提案を送った直後のバッジと、その下の Callout が旧語「審査」を使っている。

**Files:**
- Modify: `packages/web/src/screens/ProposalFormScreen.tsx:280`, `:289`
- Test: `packages/web/src/screens/ProposalFormScreen.test.tsx:60`, `:207`

**Interfaces:**
- Consumes: Task 2 で決めた表示語「確認中」。
- Produces: なし。

- [ ] **Step 1: テストの期待値を新しい語に変える**

`packages/web/src/screens/ProposalFormScreen.test.tsx:60` を変える。

```tsx
    expect((await screen.findByRole('status')).textContent).toBe('8切り確認中');
```

`:207` を変える。

```tsx
    expect((await screen.findByRole('status')).textContent).toContain('確認中');
```

- [ ] **Step 2: テストを走らせて失敗を確認する**

Run: `pnpm vitest run packages/web/src/screens/ProposalFormScreen.test.tsx`
Expected: FAIL。実際の描画は `8切り審査中` のまま。

- [ ] **Step 3: 画面の文言を変える**

`packages/web/src/screens/ProposalFormScreen.tsx:280` を変える。

```tsx
              <span className={styles.status}>確認中</span>
```

`:289` の Callout の1文目を変える。残りの2文は変えない。

```tsx
            提案はAIが確認します。不正な命令はイエローカードの対象です。都道府県は遊んでいた記録として残ります。
```

`ProposalFormScreen.module.css` の `.status` はこの画面専用の別クラスなので削除しない（Task 2 で消したのは `MyProposalsScreen.module.css` 側）。

- [ ] **Step 4: テストを走らせて通ることを確認する**

Run: `pnpm vitest run packages/web/src/screens/ProposalFormScreen.test.tsx`
Expected: PASS

- [ ] **Step 5: 旧語が残っていないことを確かめる**

Run: `grep -rn "審査\|実装中\|リリース\|却下\|実装失敗" packages/web/src | grep -v "\.test\."`
Expected: 出力なし。テストファイルは除外する（`MyProposalsScreen.test.tsx` が「旧語が出ないこと」を確かめるために旧語を書いているため）。`packages/pipeline` と `packages/server` の「却下」は運用者向けの語なので対象外（この grep の範囲にも入らない）。

- [ ] **Step 6: コミット**

```bash
git add packages/web/src/screens/ProposalFormScreen.tsx packages/web/src/screens/ProposalFormScreen.test.tsx
git commit -m "feat: 提案フォームの工程名を「確認中」に揃える"
```

---

### Task 4: デザイン見本とドキュメントを実装に合わせる

デザインシステム.md §6 の運用（部品を変えたら `design-system.html` の見本を更新する）に従う。見本が古いままだと、次に触る人が旧仕様を正だと読む。

**Files:**
- Modify: `docs/design/design-system.html:393-405`（`.c-steps` の CSS）, `:1146-1161`（§5-9 の見本4種と注記）
- Modify: `docs/design/デザインシステム.md:126`

**Interfaces:**
- Consumes: Task 1 の `ProposalStepper.module.css`（見本はこれと同じ見た目になる）。
- Produces: なし。

- [ ] **Step 1: 見本の CSS を実装に合わせる**

`docs/design/design-system.html:393-405` の `/* ステッパー(提案ステータス) */` ブロックを置き換える。

```css
/* ステッパー(提案ステータス) */
.c-steps { display: flex; align-items: center; gap: var(--space-1); flex-wrap: wrap; }
.c-steps .st {
  display: inline-flex; align-items: center; gap: var(--space-1);
  font-size: var(--font-size-micro); font-weight: var(--font-weight-bold);
  border: var(--border-control) solid transparent;
  border-radius: var(--radius-pill); padding: 3px 10px; white-space: nowrap;
}
.c-steps .st.-done { background: var(--color-bg-surface); border-color: var(--color-border-control); color: var(--color-text-secondary); }
.c-steps .st.-pending { background: transparent; border-style: dashed; border-color: var(--color-navy-300); color: var(--color-text-secondary); }
.c-steps .st.-now, .c-steps .st.-released, .c-steps .st.-rejected {
  border-width: var(--border-bold); border-color: var(--color-border-strong);
  font-size: var(--font-size-caption); padding: 5px 12px; box-shadow: var(--shadow-hard-s);
}
.c-steps .st.-now { background: var(--color-gold-400); color: var(--color-warning-ink); }
.c-steps .st.-released { background: var(--color-green-700); color: var(--color-text-on-fill); }
.c-steps .st.-rejected { background: var(--color-red-600); color: var(--color-text-on-fill); }
.c-steps .st .mk { font-size: var(--font-size-micro); }
.c-steps .ln { width: 12px; height: 2px; background: var(--color-navy-200); flex-shrink: 0; }
.c-steps .ln.-passed { background: var(--color-navy-800); }
```

素の `.st`（クラス無し）が未到達を表していた見本があるため、`-pending` を明示するクラスに変えた。Step 2 で見本側の markup も揃える。

- [ ] **Step 2: 見本4種を新しい文言と状態に差し替える**

`docs/design/design-system.html:1146-1161` の `<h3>5-9. …</h3>` 直後の `<div class="panel" …>` の中身を置き換える。✓は実装と同じ SVG を使う。

```html
      <div>
        <div class="c-steps"><span class="st -done"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 5.5 4 8l4.5-6"/></svg>確認中</span><span class="ln -passed"></span><span class="st -done"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 5.5 4 8l4.5-6"/></svg>開発中</span><span class="ln -passed"></span><span class="st -released">あそべる</span></div>
      </div>
      <div>
        <div class="c-steps"><span class="st -done"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 5.5 4 8l4.5-6"/></svg>確認中</span><span class="ln -passed"></span><span class="st -now"><span class="mk">いま</span>開発中</span><span class="ln"></span><span class="st -pending">あそべる</span></div>
      </div>
      <div>
        <div class="c-steps"><span class="st -done"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 5.5 4 8l4.5-6"/></svg>確認中</span><span class="ln -passed"></span><span class="st -rejected">見送り</span></div>
        <div class="c-reason">見送りの理由: ゲームの成立を損なうため実装不可と判断しました。</div>
      </div>
      <div>
        <div class="c-steps"><span class="st -done"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 5.5 4 8l4.5-6"/></svg>確認中</span><span class="ln -passed"></span><span class="st -done"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 5.5 4 8l4.5-6"/></svg>開発中</span><span class="ln -passed"></span><span class="st -rejected">開発できず</span></div>
      </div>
      <div class="note">現在地は状態を問わず「太枠・1段大きい文字・ベタ落ち影」で立てる(進行中=金 / あそべる=緑 / 見送り・開発できず=赤)。通過済みは白地の淡いチップに✓を付けて後退させ、未到達は塗りなしの破線。連結線は通過した区間だけ紺で塗る。色が見えなくても現在地が読めるよう、進行中には「いま」の語を添える。理由ボックスは赤の破線枠で、審判の裁定ではなく実装可否の説明として淡く出す。</div>
```

- [ ] **Step 3: 見本を目で確認する**

`docs/design/design-system.html` をブラウザで開き、§5-9 の4種を見る。確認する点は3つ。

1. 4種すべてで、一番大きく影の付いたチップが1つだけあり、それが現在地になっている。
2. 通過済みのチップが現在地より弱く見える（紺ベタになっていない）。
3. 連結線が、通過した区間だけ濃い紺になっている。

- [ ] **Step 4: デザインシステム.md の記述を直す**

`docs/design/デザインシステム.md:126` の「色だけに頼らない」の行を書き換える。

```markdown
- **色だけに頼らない**: 高評価/低評価は選択で文言を「〜済み」に変える。ステッパーは色+文言に加えて、現在地を寸法(太枠・1段大きい文字・影)と「いま」の語で示し、通過済みには✓を付ける。人気度バーは数値ラベルを必ず併記する。
```

- [ ] **Step 5: 検査を通す**

Run: `pnpm format:check && pnpm lint:design`
Expected: どちらも成功。`format:check` が落ちたら `pnpm format` を走らせてから差分を確認する。

- [ ] **Step 6: コミット**

```bash
git add docs/design/design-system.html docs/design/デザインシステム.md
git commit -m "docs: ステッパーの見本と注記を新しい状態スタイルに更新"
```

---

### Task 5: 実画面で確かめる

UI文言ガイド §0 の対策「書いたあとに実画面を 375px で描画して読み返す」を実行する。

**Files:** なし（確認のみ。修正が要れば該当タスクのファイルに戻る）

- [ ] **Step 1: 全体検査を走らせる**

Run: `pnpm verify`
Expected: `format:check` / `lint` / `lint:design` / `typecheck` / `test` / `build` がすべて成功。

- [ ] **Step 2: 開発サーバでマイ提案画面を開く**

`.claude/launch.json` の `web`（ポート 5188）を起動し、幅 375px でマイ提案画面を開く。提案データが無い場合は `packages/web/src/fixtures/demo.ts` のローカル見本フローか、`MyProposalsScreen.test.tsx` と同じ形のデータで確認する。

- [ ] **Step 3: 3つの指摘が解けているか読み返す**

1. カードを見て、いまどの工程かが1秒で分かるか。分からなければ現在地の強調（`--shadow-hard-s` / `--border-bold` / `--font-size-caption`）が効いていない。
2. 「確認中 / 開発中 / あそべる」が画面上で読んで自然か。
3. 同じ状態語がカード内に2度出ていないか。

- [ ] **Step 4: 直しが無ければ何もコミットしない**

直しが出た場合は該当タスクのファイルを修正し、そのタスクのテストを走らせてからコミットする。

---

## 完了の条件

- `pnpm verify` が通る。
- マイ提案カードで現在地が一目で分かり、状態語がカード内に1度しか出ない。
- `packages/web/src` に「審査」「実装中」「リリース」「却下」「実装失敗」の表示語が残っていない。
- `docs/design/design-system.html` §5-9 の見本が実装と同じ見た目になっている。
