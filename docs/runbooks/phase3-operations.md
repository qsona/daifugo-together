# Phase 3 評価・淘汰・カオス観測 runbook

## 目的

ルール数が増えても「面白かった」率が下がっていないかを週次で確認し、必要な場合だけ排除パラメータを一つずつ調整する。常駐ジョブや管理画面は増やさず、既存の SQLite と `ops` CLI を使う。

本番では Fly.io の SSH 内で、build 済み成果物を直接実行する。

```sh
DATABASE_PATH=/data/daifugo.sqlite node packages/server/dist/ops.js metrics --since 2026-07-01
```

ローカル開発ではリポジトリ root から次を使う。

```sh
DATABASE_PATH=/absolute/path/to/daifugo.sqlite pnpm ops metrics --since 2026-07-01
```

## ローカル運用ダッシュボード

Fly.ioへログイン済みの開発端末で、次を実行する。

```bash
pnpm ops:dashboard
```

`http://127.0.0.1:4173` が開き、直近30分・3時間・当日(JST)の接続回数、新規ユーザー、開始/完走卓、ゲーム数、評価、提案、稼働ルールを表示する。約60秒ごとに更新し、45秒以内の再読込にはキャッシュを使う。Fly.ioの認証トークンはローカルNodeプロセスだけが取得し、ブラウザへ渡さない。サーバーも`127.0.0.1`だけでlistenする。

- 接続回数はFly ProxyのHTTP 101レスポンス数であり、再接続を含む。ユニークユーザー数ではない。
- 新規ユーザーは期間内に初めて作成されたユーザー記録であり、既存ユーザーの再訪は含まない。
- HTTP件数は静的ファイルとAPI通信を含むため、PVとして扱わない。
- 自動でブラウザを開かない場合は`pnpm ops:dashboard -- --no-open`を使う。
- ポートを変える場合は`OPS_DASHBOARD_PORT=4174 pnpm ops:dashboard`を使う。

## 週次観測

1. 過去30日と直近7日の `metrics` を保存する。日付だけの `--since` は JST 00:00 として扱われる。
2. `daily` で `funRate`、`boringRate`、`averageActiveRules` の同時推移を見る。
3. `byRuleBand` で、高ルール数帯だけ `funRate` が低下していないかを見る。
4. `rules` の released / active / removed / reinstated と日次推移を見る。
5. `completedSets` と `partialSets` を確認する。3戦未満の打ち切りセットも評価率へ含めるが、件数は `partialSets` として必ず別に読む。
6. 評価母数が少ない帯は率だけで判断しない。最低でも該当帯の `evaluations` と日次の継続傾向を併記する。

`funRate` は `fun / (fun + neutral + boring)`、`boringRate` は `boring / 全評価`。未評価者は分母に入らない。

## 調整判断

一度の観測サイクルで動かすレバーは一つだけにする。

- 高ルール数帯で `funRate` が継続低下し、`boringRate` が上昇し、排除がほぼ発生していない場合:
  - まず個別の事故ルールでないことを競合ログ・ルール別評価で確認する。
  - 全体傾向なら `elimination_theta` を小さくするか、`elimination_n_min` を小さくする。二つを同時に変えない。
- ルール数に関係なく全帯で低下している場合:
  - 排除閾値を先に動かさない。障害、UI、特定ルール、評価母数の偏りを調べる。
- 特定ルールのバグ・不快表現が原因の場合:
  - 集計による淘汰を待たず、CX-04 の個別 disable を使う。
- 誤排除の場合:
  - 理由を記録して手動復活する。復活前の票は次の排除窓に持ち越されない。

## 設定変更

現在値は SQLite の `settings` で確認する。初期値は次のとおり。

| key | 初期値 | 意味 |
|---|---:|---|
| `elimination_theta` | `0.70` | 低評価率の Wilson 下限しきい値 |
| `elimination_n_min` | `10` | 判定に必要な最小票数 |
| `elimination_z` | `1.96` | Wilson 下限の信頼係数 |
| `evaluation_ttl_ms` | `3600000` | セット終了後の評価可能時間 |

例:

```sh
DATABASE_PATH=/data/daifugo.sqlite node packages/server/dist/ops.js settings set elimination_theta 0.65
```

`elimination_*` の変更は再起動なしで反映され、変更直後に active ルールを全件再判定する。変更前の値、変更後の値、時刻、根拠、観測期間を運用記録へ残す。

人気度の集計ドリフトを疑う場合は、各ユーザーの最新票から全件再計算する。

```sh
DATABASE_PATH=/data/daifugo.sqlite node packages/server/dist/ops.js popularity recompute
```

## 人気度の事前分布（α / β）を調整する

α / β は日常的に動かす設定ではなく、人気度の式そのものを変える値である。正本は `packages/core/src/priority/score.ts` の `POPULARITY_PRIOR`。初期値は `alpha=5 / beta=5` で、D-2 の正式値は開発者承認待ちのため、変更は通常のコードレビューとデプロイを通す。runtime の `settings` からは変更しない。

調整を検討するのは、十分な評価母数があるのに少数票のルールが頻繁に順位を大きく動かし、競合ログでも順位の揺れと `funRate` 低下の対応が続く場合に限る。初手では α と β を同じ量だけ増やし、中立値 0.5 を保ったまま変動を弱める。人気・不人気の基準値自体をずらす非対称変更は、別の意味を持つため D-2 の追加判断なしに行わない。

変更手順:

1. 変更前に、同じ `--since` の `ops metrics` 出力、`GET /api/admin/rules/priority` の現在値、対象期間、変更理由、現在の α / β、コミット SHA を運用記録へ残す。
2. `POPULARITY_PRIOR` を変更し、`packages/core/src/priority/score.test.ts` の数値トレースを新しい値へ更新する。
3. `CI=true pnpm verify` を実行する。人気度純粋関数、ユーザー別 latest-wins、評価保存と人気度更新の同一トランザクション、次セットだけが新順位を使う回帰を含め、すべて成功させる。
4. 通常の PR・必須 CI・デプロイを通す。デプロイ完了後、build 済みの新コードで一度だけ全ルールを再計算する。

   ```sh
   DATABASE_PATH=/data/daifugo.sqlite node packages/server/dist/ops.js popularity recompute
   ```

5. `GET /api/admin/rules/priority` で全ルールの score・順位・更新時刻を確認し、変更後の α / β、デプロイ SHA、再計算時刻を記録する。この runbook の初期値表記と、D-2 を承認・変更した場合の `docs/decision-log.md` も同じ PR で更新する。
6. 数セットから次回週次観測まで待ち、変更前と同じ期間幅で `funRate`、`boringRate`、ルール数帯、競合ログを比較する。直後の1セットだけで結論を出さない。

改善しない、または順位変動が不自然に弱くなった場合は、`POPULARITY_PRIOR` を直前の値へ戻す revert PR を作り、必須 CI・デプロイ後に `popularity recompute` を再実行する。戻した値、revert SHA、再計算時刻も記録する。α / β の変更と排除閾値の変更は同じ観測サイクルで行わない。

## 手動復活

SSH で本番ホストへ入り、理由を必須で指定する。

```sh
DATABASE_PATH=/data/daifugo.sqlite node packages/server/dist/ops.js rule reinstate r0001-example --reason "誤排除。再現試験で問題なし"
```

復活すると `rule_eliminations.reverted_at` と `revert_reason` が記録される。初回有効化時刻は変更されないため、同点時の優先順位も不要に動かない。

## 効果確認と戻し方

- 設定変更直後の1セットでは結論を出さない。新しい評価が蓄積するまで数セットから数日待ち、次の週次観測で同じ期間幅・同じ指標を比較する。
- 改善しない、または排除が急増した場合は、同じCLIで直前の値へ戻す。戻す操作も一つの変更として記録する。
- `theta`、`nMin`、`z` を同時に変えない。因果を判別できなくなる。

## 初回ドライラン

2026-07-29、空の一時 SQLite に対して build 済みCLIで `metrics`、`settings set elimination_theta 0.70`、`popularity recompute` を実行する。期待結果は、評価帯・日次が空配列、各件数が0、設定変更と再計算が成功JSONを返し、再起動を要求しないこと。実施結果は `docs/impl-progress.md` の Phase 3 プロセス2へ記録する。

## アクションログ

対局アクションは既存の `replay_records` に SQLite 内で保存する。Phase 3 の成功指標は `game_sets` / `set_rules` / 評価・排除テーブルから読み、replayを集計元にしない。保持期間は decision-log B-4 の人間判断が未完了のため、自動削除を追加しない。決定までは本番Volume使用量を週次で確認する。
