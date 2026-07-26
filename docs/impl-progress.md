# 実装進捗

## 現在

- Epic: E12 / 周: 単回レビュー / ストーリー: TS-02 / 次にやること: レビューと並行して E1 GE-02 のプロセス1へ進む

## 完了したストーリー

| ストーリー | 周 | コミット | 検証結果 |
|---|---|---|---|
| TS-02 | 単回 | この行を含むコミット | `pnpm verify` 成功。format / lint / typecheck / 4 tests / 6 packages build がすべて成功 |

## 置いた仮定（レビューで裁定してもらう）

| 仮定した内容 | なぜそう決めたか | 出典 | 覆ったときの影響範囲 |
|---|---|---|---|
| Node.js 26 を CI の基準バージョン、pnpm 11.17.0 を固定バージョンとする | 趣味プロジェクトとして安定版より最新追随を優先する方針がユーザーから明示された。TypeScript は `typescript-eslint` の対応上 6.0.3 とする | ユーザー判断 (2026-07-26)、E12 §4.1 | `package.json`、lockfile、CI のランタイム設定 |
| `rule-change` ラベル付き PR を「ルール PR」と判定する | E12 はルール PR をラベルで区別すると定める一方、ラベル名は未指定。通常の開発 PR にルール差分制約を課さない識別子が必要 | E12 §4.7「リポジトリ運用」 | `.github/workflows/rule-diff-guard.yml`、将来の pipeline の PR 作成処理、リポジトリのラベル設定 |
| Prettier は `docs/` を検査対象外にする | 既存設計文書は Prettier の書式と一致せず、設計書は実装作業で変更しない契約になっている | implementation-workorder §4、初回 `pnpm verify` の結果 | `.prettierignore`。将来 docs の書式を統一する場合は除外を外して一括整形が必要 |
| 差分ガードは `packages/rules/` 配下かだけを検査し、「単一の新規ルールディレクトリだけ」という制約は E7 で追加する | TS-02 の受け入れ条件は配下外変更の拒否を要求している。ルール ID・slug・許可ファイルの最終生成規約は pipeline 実装と一緒に固める方が手戻りが少ない | product-backlog TS-02、E12 §4.6(1)・§4.7 | `scripts/check-rule-diff.mjs` とテスト。厳格化は後方互換に影響せず追加可能 |

## 2 周目に回したもの

TS-02 は実装指示によりプロセスを分けないため、該当なし。

## 詰まっている点（人間の判断待ち）

- この作業ツリーには Git remote がないため、GitHub 上での Actions 実行と branch protection の必須チェック設定は未確認。ワークフローの実装とローカル相当検証までは完了している。
- E12 §4.1 は Node.js LTS を指定しているが、ユーザー判断で趣味プロジェクトとして Node.js 26 Current への最新追随を優先した。実装・CI・決定ログは Node 26.5.0 に更新済みだが、作業指示に従い `docs/epics/E12-tech-stack.md` 自体は変更していない。
