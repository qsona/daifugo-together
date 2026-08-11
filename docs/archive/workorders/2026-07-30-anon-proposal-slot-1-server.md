# 発注書 1/3: 匿名おためし提案枠 — サーバー(型・リポジトリ・投稿ゲート)

> 進め方の共通ルールは [implementation-workorder.md](../implementation-workorder.md) を参照。本書はこの発注の内容だけを書く。
> 実装手順書は `docs/plans/2026-07-30-anonymous-trial-proposal.md`(以下「計画」)。計画冒頭の superpowers サブスキル指定はこのセッションでは無視し、**計画の Task 1・Task 2 のステップをそのまま順に実行する**こと(テストコード・実装コードは計画に全文がある)。

## 目的

未登録(匿名)ユーザーにも「同時進行 1 件」のルール提案枠を与えるため、サーバー側の土台を作る。設計の背景と決定は `docs/specs/2026-07-30-anonymous-trial-proposal-design.md` を先に読むこと。

## やること(= 計画の Task 1・Task 2)

1. **Task 1**: `ProposalListItem` に `occupiesSlot: boolean` を追加(`packages/core`)、`ProposalRepository` に `hasInflight(authorId)` を追加し `toListItem` で `occupiesSlot` を計算(`packages/server`)。`ProposalListItem` をリテラル構築している web 側の全箇所(`grep -rn "unread:" packages/web/src`)に `occupiesSlot` を補って型を通す。
2. **Task 2**: 投稿ゲートの「登録確認(403 `registration_required`)」を「匿名枠確認(403 `anonymous_inflight_limit`)」に置き換える(`packages/server/src/proposal/submission.ts` の `authorize`/`submit` と結果型)。**枠拒否は重複確認(冪等返却)の後ろに置く** — 理由と正確な順序は計画の Task 2 Step 3 と Global Constraints を参照。`submission.test.ts`・`app-server.test.ts` の期待値を更新し、計画記載の新テスト(枠の占有・解放、登録済み無制限、匿名+停止中、authorize、冪等再送)を追加する。

## やらないこと

- Web の画面変更(発注書 2/3)。Task 1 で行う web の変更は「`occupiesSlot` フィールド追加で型を通す」だけ
- イエローカード・提案停止・読み取り系 API・レート制限まわりの変更
- ドキュメント類の更新(発注書 3/3)

## 完了条件

- 計画 Task 1・Task 2 の全ステップのチェックボックスが埋まり、各 Task 末尾のコミットが積まれている
- `pnpm exec vitest run packages/server/src` が緑、`packages/core`・`packages/server`・`packages/web` の typecheck が通る
- `grep -rn "registration_required" packages` がヒットしない

## 注意

- 作業ツリーに本件と無関係の未コミット変更が残っている場合がある。`git add` は計画のコミット手順どおり**ファイル/ハンク単位**で行い、無関係の変更を巻き込まないこと
- テスト初回実行の前に `pnpm --filter @daifugo/ai... build` が必要
