# E6 ローカル判定ツール運用

E6 の L3 判定は従量課金 API を使わず、開発者 PC の Codex app-server と ChatGPT subscription で実行する。サーバーは投稿時に L0〜L2 のシグナルまで保存し、L3 の完了を待たない。

## 準備

サーバーとローカル PC に同じ `ADMIN_PIPELINE_TOKEN` を設定する。32 文字未満はサーバー起動時に拒否される。トークンはコマンドライン引数にせず、リポジトリ直下の Git 管理外ファイル `.env.local` に保存する。

```dotenv
ADMIN_PIPELINE_TOKEN=<サーバーと共有する32文字以上のランダム値>
DAIFUGO_ADMIN_URL=https://daifugo-together.fly.dev
```

`packages/pipeline` の各運用コマンドは、このファイルがあれば自動で読み込む。シェルで同名の環境変数を明示した場合は、その値を優先する。`.env.local` は必ず Git 管理外のまま、ファイルモード `0600` で保持する。

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
`stage=confirmation` の JSON 行を表示する。この行にある `checkId` または
`judgementId` と、提案本文・理由・SPEC を確認してから確定する。

確定内容は JSON ファイルへ保存し、ローカルツールから送る。E6 遮断の確定例:

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
