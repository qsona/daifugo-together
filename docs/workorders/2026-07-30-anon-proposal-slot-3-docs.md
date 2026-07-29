# 発注書 3/3: 匿名おためし提案枠 — ドキュメント反映と全体検証

> 進め方の共通ルールは [implementation-workorder.md](../implementation-workorder.md) を参照。
> 実装手順書は `docs/plans/2026-07-30-anonymous-trial-proposal.md`(以下「計画」)。**計画の Task 4 のステップをそのまま順に実行する**こと。

## 前提

- 発注書 1/3・2/3 が完了・コミット済みであること(コードが最終形でないと、ここで書くドキュメントが実装と食い違う)

## やること(= 計画の Task 4)

1. `docs/decision-log.md` の G 節に裁定 1 行を追加(既存の採番に続く次の番号。文面は計画 Task 4 Step 1)
2. `docs/epics/E15-auth-account.md` 冒頭に改訂ノート、`docs/epics/E05-rule-proposal.md`・`docs/epics/E06-injection-yellowcard.md` の冒頭ノートに 1 行ずつ追記(文面は計画 Task 4 Step 2・3)
3. `docs/specs/2026-07-30-anonymous-trial-proposal-design.md` §2 のゲート順を実装の最終形(認証 → 停止 → 検証 → 重複(冪等返却)→ 枠 → 保存)に訂正し、理由を 1 文添える(計画 Task 4 Step 4)
4. 全体検証: `pnpm test` が全パッケージで緑。`grep -rn "registration_required" packages` がヒットしないこと

## やらないこと

- コードの変更(検証で問題を見つけたら修正せず報告。ただし grep で `registration_required` の消し忘れが出た場合の削除は可)
- 各設計書本文の書き直し(冒頭ノートによる読み替え方式を維持)

## 完了条件

- 計画 Task 4 の全ステップのチェックボックスが埋まり、コミットが積まれている
- `pnpm test` 緑の実行結果を記録している

## 注意(重要)

- `docs/decision-log.md`・`docs/epics/E05-rule-proposal.md` には**本件と無関係の未コミット変更が既に存在しうる**。コミット時は `git add -p` で本件の追記ハンクだけをステージし、無関係の変更を絶対に巻き込まないこと
