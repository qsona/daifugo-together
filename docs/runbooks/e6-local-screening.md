# E6 ローカル判定ツール運用

E6 の L3 判定は従量課金 API を使わず、開発者 PC の Codex app-server と ChatGPT subscription で実行する。サーバーは投稿時に L0〜L2 のシグナルまで保存し、L3 の完了を待たない。

## 準備

サーバーとローカル PC に同じ `ADMIN_PIPELINE_TOKEN` を設定する。32 文字未満はサーバー起動時に拒否される。トークンはコマンドライン引数にせず、リポジトリ直下の Git 管理外ファイル `.env.local` に保存する。

```dotenv
ADMIN_PIPELINE_TOKEN=<サーバーと共有する32文字以上のランダム値>
DAIFUGO_ADMIN_URL=https://daifugo-together.fly.dev
ADMIN_PIPELINE_URL=https://daifugo-together.fly.dev
RULE_REPOSITORY_URL=git@github.com:qsona/daifugo-together.git
```

`DAIFUGO_ADMIN_URL` は `judge` / `review` / `confirm` / `design:handoff`、`ADMIN_PIPELINE_URL` と `RULE_REPOSITORY_URL` は `implement*` が使う。`packages/pipeline` の各運用コマンドは、このファイルがあれば自動で読み込む。シェルで同名の環境変数を明示した場合は、その値を優先する。`.env.local` は必ず Git 管理外のまま、ファイルモード `0600` で保持する。

各運用コマンドは build 済みの pipeline CLI を再利用する。core / ai /
rules / server / pipeline の source または依存設定が前回 build より新しい場合だけ、
初回起動時に自動で 1 回 build する。連続する judge / review / implement 操作では
毎回 build しない。

macOS では ChatGPT アプリ同梱の Codex を優先して使う。それ以外の場所にあるバイナリを使う場合だけ `CODEX_BIN` を設定する。

```bash
export CODEX_BIN='/absolute/path/to/codex'
```

## 未判定提案を処理する

```bash
pnpm --filter @daifugo/pipeline judge
```

既定モデルは評価セットを満たした `gpt-5.6-sol`、reasoning effort は `medium`。一度に処理する件数や実験モデルは明示的に変更できる。

```bash
pnpm --filter @daifugo/pipeline judge -- \
  --limit 20 \
  --model gpt-5.6-luna \
  --effort medium
```

各提案は別の ephemeral thread で処理し、一時障害は既定で最大3回試す。1件が3回とも失敗しても未判定のまま残し、後続提案を続ける。timeout と試行回数は `JUDGE_TIMEOUT_MS`（既定60秒）/ `JUDGE_RETRY`（既定3）または `--timeout-ms` / `--retries` で変更できる。

thread では shell、Web 検索、MCP、connector、subagent、画像ツールを無効化し、read-only・network off・approval never を重ねている。応答にツール実行 item が現れた場合は記録せずエラーにする。

同じコマンドが E6 pass 後の提案を CX-01 まで判定し、末尾に
`stage=confirmation` の JSON 行を表示する。普段は `--review` を付け、判定後に
そのまま対話レビューへ進む。

```bash
pnpm --filter @daifugo/pipeline judge:review
```

中断したレビューの再開や、すでに判定済みの提案だけを確認するときは
`review` を単独で起動する。

```bash
pnpm --filter @daifugo/pipeline review
```

確定待ちの提案を1件ずつ表示し、`a`（SPEC承認）または `r`（却下確定）、
`e`（エディタで内容を編集して確定）、`s`（保留）、`q`（終了）で処理する。
キー入力には Enter が必要。`needs_review` はそのまま確定する選択肢を出さず、
理由を記入した却下か、`e` で `approve_spec` へ書き換えた SPEC 承認のどちらかを
開発者が選ぶ。中断・保留した提案は次回の `review` に再表示される。
actor は Git の `user.email` を既定で使う。Git email がなければ
`local:<ローカルユーザー名>` を使う。明示する場合だけ `.env.local` の
`PIPELINE_ACTOR` または `--actor` で上書きする。

非対話で確定する場合は、確定内容を JSON ファイルへ保存し、ローカルツールから
送る。E6 遮断の確定例:

```json
{
  "action": "confirm_e6_rejection",
  "proposalId": "01EXAMPLE",
  "checkId": 7,
  "actor": "developer@example.com"
}
```

```bash
pnpm --filter @daifugo/pipeline confirm -- --file ./confirmation.json
```

CX-01 の却下は `action=confirm_rejection` と `judgementId` を使う。
`needs_review` を却下する場合は `rejectCategory` / `rejectSubtype` /
`reasonForUser` も開発者が記入する。SPEC 承認は `action=approve_spec` とし、
`spec`（不変な `SPEC.json` の元）と `scaffoldMeta`（slug / messages）を分ける。
サーバーは対象ID・提案状態・E6 passを再確認し、監査行・カード／却下または
queuedジョブを同じtransactionで確定する。確定ファイルには管理tokenを書かない。

## 拡張前提の提案を設計セッションへ渡す

CX-01 は「エンジン/契約を拡張すれば実装できる」提案を `needs_review` +
`extensionNeeded`(機構タグ + スケッチ)で返す。`review` はこの種の提案を対話
ループの前に機構タグ別へ集約して表示するので、どのタグに何件たまっているかは
一覧の冒頭で分かる。個別表示では、その提案 ID を埋めた引き継ぎコマンドが出る。

```bash
pnpm --filter @daifugo/pipeline design:handoff -- <提案ID>
```

`ADMIN_PIPELINE_TOKEN` と `DAIFUGO_ADMIN_URL` は `judge` / `review` と同じものを
使う。書き出し先は既定で `<一時ディレクトリ>/daifugo-design-handoff/proposal-<提案ID>.json`
(モード `0600`)で、パスは標準出力に表示される。`--out` で変更できる。確定待ちの
CX-01 判定がない提案 ID を渡すとエラーになる。

このファイルを Codex App の新しいタスクへ渡し、設計 skill を起動する。

```text
$design-extension
このハンドオフの提案について拡張を設計して
```

skill は契約の一次情報を読んで `docs/specs/` に拡張設計 doc を書き、**開発者の
承認を得てから**拡張を実装する。実装はルール PR ではなく通常のエンジン開発なので、
`pnpm verify` の後 `main` へ push し、デプロイまで行う。

拡張のデプロイ後に `judge` を再実行するのが主経路になる。プロンプト版を繰り上げると
未確定の AI 判定が再判定対象へ戻るため、対象提案は新しい語彙で判定し直され、通常は
`approve` + SPEC が出る。あとは `review` で SPEC を承認し、`$implement-rule` へ進む。
再判定しても `needs_review` のままだった場合だけ、設計セッションが SPEC と
scaffoldMeta を手書きし、`action=approve_spec` の確定ファイルを `confirm` で送る
(`judgementId` は再判定で作られた最新の AI 判定を使う)。

フロー全体の設計判断は [specs/2026-08-11-judge-extension-flow-design.md](../specs/2026-08-11-judge-extension-flow-design.md) にある。

## 承認済みルールを実装する

Codex Appで新しいタスクを開き、次のようにskillを起動する。

```text
$implement-rule
次の承認済みルールを実装して
```

skillは`implement:prepare`で不変scaffoldと一時workspaceを準備し、そのCodex
セッション自身が`rule.ts` / `rule.test.ts`だけを実装する。続いて
`implement:submit`が差分、scaffold SHA、静的制約、型検査、対象テストを再確認し、
成功時だけcommit・push・PR作成と`pr_open`記録を行う。別の`codex exec`は起動しない。
Codex Appから`gh`を使うprepare / submitは、macOS Keychainを読めるよう
sandbox外の承認付きで実行する。sandbox内だけで`gh auth status`が失敗しても、
すぐに再ログインせず承認付き実行で再確認する。

中断したjobは、新しいCodexタスクでjob IDを指定して同じattemptを再開する。

```text
$implement-rule
job 1を再開して
```

`implement:retry`は同じworkspaceでの修正や通信再送には使わない。内容起因で
scaffoldからやり直すと開発者が明示した場合だけ、1回の新attemptとして使う。

## モデル評価

正当例 20 件・攻撃例 20 件を同じ条件で再評価する。

```bash
pnpm --filter @daifugo/server ops:judge-eval -- \
  --model gpt-5.6-sol \
  --effort medium
```

合格条件は攻撃再現率 100%、正当例の誤検出 0%。プロンプト、静的パターン、モデル指定を変えたときは再実行する。

CX-01 は A1〜C3 と境界例を含む別評価セットで測る。

```bash
pnpm --filter @daifugo/pipeline judge:eval -- \
  --model gpt-5.6-sol \
  --effort medium
```

モデルを変えたときは exact match（verdict + reject category/subtype）を比較する。
