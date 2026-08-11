# 発注書 2/3: 匿名おためし提案枠 — Web(提案画面・枠埋まりパネル)

> 進め方の共通ルールは [implementation-workorder.md](../implementation-workorder.md) を参照。
> 実装手順書は `docs/plans/2026-07-30-anonymous-trial-proposal.md`(以下「計画」)。計画冒頭の superpowers サブスキル指定はこのセッションでは無視し、**計画の Task 3 のステップをそのまま順に実行する**こと。

## 前提(このセッションを始める前に満たされていること)

- 発注書 1/3(サーバー)が完了・コミット済みであること。具体的には `ProposalListItem.occupiesSlot` が存在し、投稿 API が 403 `anonymous_inflight_limit` を返すこと。未了ならこの発注は着手不可
- 設計の背景は `docs/specs/2026-07-30-anonymous-trial-proposal-design.md` を先に読むこと

## やること(= 計画の Task 3)

1. 状態表示文言を `packages/web/src/proposal/status-labels.ts` に切り出し、`MyProposalsScreen` から import に置き換える
2. `ProposalFormScreen` を改修:
   - 未登録でもフォームを表示(旧「提案するには引き継ぎ登録が必要です」パネルと `registrationRequired` 分岐を撤去)し、注記 Callout を追加
   - 未登録時はマウント時に `api.mine()` で枠占有(`occupiesSlot`)を確認し、埋まっていれば「進行中提案の名前+状態+ログイン導線」パネルを表示
   - 送信時の 403 `anonymous_inflight_limit` は同パネルへフォールバック
3. `packages/web/src/proposal/client.ts` のエラーメッセージマッピングを更新(`registration_required` を削除し `anonymous_inflight_limit` を追加)
4. `ProposalFormScreen.test.tsx` の旧登録必須テスト 2 件を計画記載の新テスト 4 件に置き換える。`App.test.tsx` に旧文言への参照が残っていれば新挙動へ書き換える

文言・コンポーネント構成・テストコードの全文は計画の Task 3 にある。文言はすべて仮で、トーンは既存(子供向け・ひらがな多め)に合わせる。

## やらないこと

- サーバー側の変更(発注書 1/3 で完了済みのはず。不足を見つけたら実装せず報告)
- メニュー・リザルト画面の導線の表示条件・頻度の変更(現状維持)
- ドキュメント類の更新(発注書 3/3)

## 完了条件

- 計画 Task 3 の全ステップのチェックボックスが埋まり、Task 末尾のコミットが積まれている
- `pnpm exec vitest run packages/web/src` が緑、`packages/web` の typecheck が通る
- 375×812 相当のビューで「未登録・枠なし(フォーム+注記)」「未登録・枠埋まり(パネル)」の 2 状態を目視確認し、確認した旨を記録する(共通ルールの検証水準)

## 注意

- `git add` は計画のコミット手順どおりファイル単位で行い、無関係の未コミット変更を巻き込まないこと
