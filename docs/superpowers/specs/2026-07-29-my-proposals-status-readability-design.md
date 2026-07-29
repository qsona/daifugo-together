# マイ提案のステータス表示を読めるようにする — 設計

作成: 2026-07-29

## 背景

マイ提案画面（`packages/web/src/screens/MyProposalsScreen.tsx`）は、1枚のカードの中でステータスを2か所に出している。右上のバッジ（`.status`）と、その下のステッパー（`ProposalStepper`）である。開発者から3点の指摘があった。

1. ステータスが色分けされているのに、いま結局どこなのかが分かりにくい。
2. 「審査中 / 実装中 / リリース」の3語がもう少し平易にならないか。
3. 右上のバッジは下のステッパーと色を統一するか、そもそも不要にできそう。

### なぜ「いまどこか」が読めないか

`packages/web/src/components/ProposalStepper.module.css` を読むと原因は4つある。

- **通過済み＝紺ベタが一番濃い。** `.done` は `--color-navy-800` のベタ塗り、`.now` は `--color-gold-400` のベタ塗り。クリーム地のカード上では紺ベタが最も明度差が大きく、視線は「済んだ工程」に吸われる。過去が現在より目立っている、というのが主因。
- **色以外の手がかりがない。** 3つのチップは同じ寸法・同じ形で、違いは塗りの色だけ。デザインシステム.md §5「色だけに頼らない」から外れている。
- **連結線が状態を持たない。** `.line` は常に `--color-navy-300` の一色で、どこまで進んだかを線が語っていない。
- **同じ情報を別の配色で2回言っている。** 右上バッジは `--color-cream-200` 地で、ステッパーの現在ステップの色（金）と対応しない。どちらが正か迷わせる。

## 決定

開発者との検討で以下を選択した。

- レイアウト: **案A（ステッパーを主役にし、右上バッジを廃止）**。
- 3ステップの文言: **確認中 / 開発中 / あそべる**。

検討したが採らなかった案:

- 案B（ステッパーを「いま 開発中 2/3」の1行＋3分割バーに置換）— 情報量は最小になるが、次に何が来るかが読めなくなる。
- 案C（バッジを残してステッパーの現在ステップと同色に揃える）— 変更は小さいが、同じ情報の二重表示という原因が残る。

## 1. 文言

`MyProposalsScreen.tsx` の `STATUS_LABELS` と `statusSteps()` の両方を書き換える。

| `ProposalStatus` | 現在 | 変更後 |
| --- | --- | --- |
| `screening` | 審査中 | 確認中 |
| `implementing` | 実装中 | 開発中 |
| `released` | リリース | あそべる |
| `rejected` | 却下 | 見送り |
| `failed` | 実装失敗 | 開発できず |

「リリース」を「あそべる」にするのがこの変更の中心。「リリース」は作り手の語で、プレイヤーにとって何が変わるかを言っていない。「あそべる」はそのルールが対戦で出るようになったという結果そのものを言う（UI文言ガイド 原則3「結果で伝える」）。トーンは企画書 §2.3 の基準（子供がメインだが子供向けすぎない、桃太郎電鉄水準）に合わせ、漢語の「確認中 / 開発中」と終点の「あそべる」を組み合わせる。

`rejected` / `failed` は開発者の選択肢に含まれていなかったため本設計での提案。「開発中」に語を揃えて「開発できず」とする。

### 波及先

同じ工程を2つの名前で呼ばないよう、提案フォーム側も揃える。

- `packages/web/src/screens/ProposalFormScreen.tsx:280` の受付直後バッジ「審査中」→「確認中」。
- 同 `:289` の Callout「提案はAIが審査します。」→「提案はAIが確認します。」。同じ文の後続（不正な命令はイエローカードの対象です／都道府県は遊んでいた記録として残ります）は変えない。

`packages/pipeline` や `packages/server` の「却下」はパイプライン運用者向けの語であり、プレイヤーに出る文言ではないため変更しない。

## 2. ステッパー部品

`packages/web/src/components/ProposalStepper.tsx` と同 `.module.css` を変更する。設計の芯は **「済み」を弱くし、「いま」を強くする**（現在の強弱が逆になっているのを入れ替える）。

### 各状態の見た目

| 状態 | 背景 | 枠線 | 文字 | 寸法・その他 |
| --- | --- | --- | --- | --- |
| `done` | `--color-bg-surface` | `--border-control` solid `--color-border-control` | `--color-text-secondary` | 現行の基本形のまま。先頭に✓アイコン |
| `now` | `--color-gold-400` | `--border-bold` solid `--color-border-strong` | `--color-warning-ink` | `--font-size-caption`（他は `--font-size-micro`）、パディング `5px 12px`、`--shadow-hard-s`、先頭に「いま」 |
| `pending` | なし（透明） | `--border-control` **dashed** `--color-navy-300` | `--color-text-secondary` | 塗りと実線を持たないことで後退させる |
| `released` | `--color-green-700` | `--border-bold` solid `--color-border-strong` | `--color-text-on-fill` | `now` と同じ寸法・影 |
| `rejected` | `--color-red-600` | `--border-bold` solid `--color-border-strong` | `--color-text-on-fill` | `now` と同じ寸法・影 |

`released` / `rejected` は終点であると同時に現在地でもあるため、`now` と同じ強調（太枠・大きめの文字・影）を持たせる。これで「いまどこか」は常に**一番大きく影のあるチップ**が答えになり、状態によって答えの探し方が変わらない。

`pending` の文字色を `--color-text-disabled`（`navy-300`）にしないのは意図的。クリーム地に対して AA を満たさず、無効化された操作でもないため。後退は破線と塗りなしで表現する。

### 色以外の手がかり

デザインシステム.md §5「色だけに頼らない」への対応。

- `done` の先頭に✓アイコン（インライン SVG、10×10、`stroke="currentColor"`、`aria-hidden="true"`）。加えて `<span class="sr-only">済み</span>` をチップ内に置き、支援技術には「確認中 済み」と読ませる。`sr-only` は `packages/web/src/styles/global.css` の既存ユーティリティ。
- `now` の先頭に「いま」の語を置く（例: 「いま 開発中」）。塗りが見えなくても現在地が読める。
- 寸法差（現在地だけ12px・太枠・影）そのものが手がかりになる。

### 連結線

`.line` に通過済みと未到達の2状態を持たせる。

- 通過済み（直前ステップが `done`）: `--color-navy-800`
- それ以外: `--color-navy-200`

`ProposalStepper` の描画側で `steps[index - 1].state === 'done'` を見てクラスを出し分ける。線の高さ・幅（2px / 12px）は変えない。破線にはしない — 高さ2pxでは破線がつぶれて読めないため、明度差だけで表す。

### アクセシビリティ

現在ステップの `<li>` に `aria-current="step"` を付ける。対象は `now` / `released` / `rejected`（`done` と `pending` には付けない）。

### 部品の API

`ProposalStep` / `StepState` の型と `ProposalStepper` の props は変更しない。呼び出し側の変更は文言だけになる。

## 3. カード

`MyProposalsScreen.tsx` と `MyProposalsScreen.module.css`。

- 見出しの `<span className={styles.status}>` と CSS の `.status` セレクタを削除する。`.unread` は残す（新着の走査に使う）。`.status, .unread` の共通宣言は `.unread` 単独に書き換える。
- `STATUS_LABELS` はバッジ削除後も残す。`statusSteps()` の各ラベルをこの表から引き、文言の定義を1か所に保つ。
- 日付をラベルに頼らない形へ畳み込む（UI文言ガイド 原則2）。
  - `released`: `リリース日: 2026/7/29` → `2026/7/29 から あそべる`
  - それ以外: `更新日: 2026/7/29` → `2026/7/29 更新`

## 4. ドキュメント

部品を変えたら見本を更新する運用（デザインシステム.md §6）に従う。

- `docs/design/design-system.html` §5-9「提案ステータスのステッパー」の見本4種を、新しい文言と新しい状態スタイルに更新する。同ファイル内の `.c-steps` / `.st` の CSS（393行付近）も実装と同じ見た目に合わせる。
- 同節の注記「状態色: 通過済み=紺 / 進行中=金 …」を新仕様に書き換える。通過済みが紺ベタではなくなるため、記述が実装と食い違う。
- `docs/design/デザインシステム.md` §5 の「ステッパーは色+文言」の記述に、現在地は寸法と「いま」の語でも示すことを追記する。

## 5. テスト

`packages/web/src/screens/MyProposalsScreen.test.tsx` と新規 `packages/web/src/components/ProposalStepper.test.tsx`。

- バッジ削除後もカードから状態が読めること（「いま 開発中」「あそべる」などのチップが出る）。バッジがあった頃の重複表示が消えたこと（同じ状態語がカード内に1度しか出ない）。
- 新しい文言の全5状態（確認中 / 開発中 / あそべる / 見送り / 開発できず）。
- 現在ステップに `aria-current="step"` が付き、`done` / `pending` には付かないこと。
- 連結線が、通過済み区間と未到達区間で別のクラスになること。
- `done` のチップが支援技術に「済み」を読ませること。
- `ProposalFormScreen.test.tsx` の「審査中」を期待している2箇所（`:60`, `:207`）を「確認中」に更新する。

`pnpm lint:design`（`scripts/check-design-tokens.mjs`）が通ること。新しい色・寸法はすべて既存トークンで組み、生の hex を足さない。

## やらないこと

- ステッパー部品の props / 型の変更。
- `ProposalStatus` そのもの（サーバー・プロトコルの値）の変更。表示語だけを変える。
- ルール図鑑（`RuleDexScreen`）の状態表示。マイ提案の工程とは別物で、今回の指摘の対象外。
- `packages/pipeline` / `packages/server` の運用者向け「却下」表記。
