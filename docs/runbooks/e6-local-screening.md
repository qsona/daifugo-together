# E6 ローカル判定ツール運用

E6 の L3 判定は従量課金 API を使わず、開発者 PC の Codex app-server と ChatGPT subscription で実行する。サーバーは投稿時に L0〜L2 のシグナルまで保存し、L3 の完了を待たない。

## 準備

サーバーとローカル PC に同じ `ADMIN_PIPELINE_TOKEN` を設定する。32 文字未満はサーバー起動時に拒否される。トークンはコマンドライン引数にせず環境変数で渡す。

```bash
export ADMIN_PIPELINE_TOKEN='<32文字以上のランダム値>'
export DAIFUGO_ADMIN_URL='https://daifugo-together.fly.dev'
```

macOS では ChatGPT アプリ同梱の Codex を優先して使う。それ以外の場所にあるバイナリを使う場合だけ `CODEX_BIN` を設定する。

```bash
export CODEX_BIN='/absolute/path/to/codex'
```

## 未判定提案を処理する

```bash
pnpm --filter @daifugo/server ops:screen
```

既定モデルは評価セットを満たした `gpt-5.6-sol`、reasoning effort は `medium`。一度に処理する件数や実験モデルは明示的に変更できる。

```bash
pnpm --filter @daifugo/server ops:screen -- \
  --limit 20 \
  --model gpt-5.6-luna \
  --effort medium
```

各提案は別の ephemeral thread で処理し、一時障害は既定で最大3回試す。1件が3回とも失敗しても未判定のまま残し、後続提案を続ける。timeout と試行回数は `JUDGE_TIMEOUT_MS`（既定60秒）/ `JUDGE_RETRY`（既定3）または `--timeout-ms` / `--retries` で変更できる。

thread では shell、Web 検索、MCP、connector、subagent、画像ツールを無効化し、read-only・network off・approval never を重ねている。応答にツール実行 item が現れた場合は記録せずエラーにする。

このコマンドが記録するのは L3 と E6 決定表の結果まで。提案の却下、イエローカード発行、SPEC 承認、実装キュー投入は E07 の `VERDICT_CONFIRMATION` で開発者が確定する。

## モデル評価

正当例 20 件・攻撃例 20 件を同じ条件で再評価する。

```bash
pnpm --filter @daifugo/server ops:judge-eval -- \
  --model gpt-5.6-sol \
  --effort medium
```

合格条件は攻撃再現率 100%、正当例の誤検出 0%。プロンプト、静的パターン、モデル指定を変えたときは再実行する。
