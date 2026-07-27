# フェーズ2 運用レポート

E10 OP-01/OP-02 の初期運用は、管理画面や常駐集計を増やさず、既存SQLiteを読み取るCLIで行う。状態変更、Codex起動、マージ、デプロイはこのCLIから実行しない。

## 開発環境

ソース変更をbuildしてから実行する。

```bash
DATABASE_PATH='data/daifugo.sqlite' pnpm ops status
DATABASE_PATH='data/daifugo.sqlite' pnpm ops funnel --since 2026-08-01
```

`status`はscreeningと実装のキューを各20件ずつ返す。続きは`--offset`、1ページの件数は`--limit`（最大1000）で指定する。

```bash
DATABASE_PATH='data/daifugo.sqlite' pnpm ops status --limit 100 --offset 100
```

`funnel --since YYYY-MM-DD`の日付だけの指定はJST 00:00として扱う。日時を指定する場合は、実行PCのtimezoneに依存させないため`Z`またはUTC offsetを必須とする。

```bash
DATABASE_PATH='data/daifugo.sqlite' pnpm ops funnel \
  --since 2026-08-01T09:30:00+09:00
```

## 本番コンテナ

本番imageにはコンパイラやソースを入れない。buildを伴う`pnpm ops`ではなく、imageに格納済みのJavaScriptをNodeで直接実行する。

```bash
DATABASE_PATH='/data/daifugo.sqlite' \
  node packages/server/dist/ops.js status --limit 100

DATABASE_PATH='/data/daifugo.sqlite' \
  node packages/server/dist/ops.js funnel --since 2026-08-01
```

Fly.ioでは上記を`fly ssh console`で開いたshellから実行する。DBを別パスで開くと空のSQLiteが作られて全件0に見えるため、必ずserverと同じ`DATABASE_PATH`を指定する。

## 出力の読み方

- `queue.screening.items[].stage`: `awaiting_l3` → `awaiting_cx01` → `awaiting_developer_confirmation`のどこで待っているか。
- `queue.*.total/truncated/limit/offset`: 表示が全件か、続きがあるか。
- `judgementSignals.l3`: L3のシグナル。`block_soft`/`block_card`だけで確定却下とは数えない。
- `judgementSignals.developerSources.e6Rejected`: 開発者がE6遮断を確定した件数。
- `judgementSignals.developerSources.cx01Rejected`: 開発者がCX-01却下を確定した件数。
- `judgementSignals.developerSources.specApproved`: 開発者がSPECを承認した件数。
- `byStatus.rejected`と`rejectionReasons`: ユーザー向けに確定した却下。E6由来の確定却下は`inappropriate`。
- `implementationFailures`: `pipeline_jobs.error_code`由来の開発者向け内部区分。台帳欠損は黙って落とさず`unclassified`。
- `rates.terminalOutcomes`: `released / (released + rejected + failed)`。
- `rates.allSubmissions`: `released / 全投稿`。

D-4が未決のため、2つの率のどちらかを単に「採用率」とは呼ばない。判断には率だけでなく`byStatus`の生件数も併記する。

## 人間承認で残る運用境界

このCLIはキューを可視化するが、Codex実行数を自動制限しない。ローカル判定・実装skillは開発者が明示起動する。E-15のダウンタイムを実際に起こすのはCodex起動ではなく、ルールPRのマージ後に走るデプロイである。

D-5の解消とOP-01受け入れ条件の改訂、および「遊ばれている時間帯を避ける」マージ/デプロイ運用の正式化は、開発者のdecision-log裁定が付くまで未決として扱う。
