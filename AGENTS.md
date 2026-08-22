# Codex へのプロジェクト指示

## PR を使用する範囲

PR を作成するのは、原則としてルール実装のワークフローだけとする。ルール実装では、そのワークフローおよび `implement-rule` skill の指示に従って PR を作成し、人間によるレビューとマージを待つ。

ルール実装以外の通常の実装では PR を作成しない。作業ブランチを使用した場合は、必要な実装と検証が完了したらローカルで `main` へマージし、`main` をリモートへ push する。最初から `main` 上で作業している場合は、同じ条件を満たした時点で変更を `main` に直接 commit し、リモートへ push する。

## `main` への取り込み

`main` への取り込みは比較的気軽に行ってよい。原則として、依頼された作業の実装と必要なテストが完了したら、ユーザーへあらためて確認せずに `main` への commit またはマージと push まで行う。

長期間にわたる作業では、依頼全体の完了を待たず、機能や工程などの区切りがよい時点で `main` へ取り込む。その時点の変更が独立して動作し、必要な検証を通過していることを確認する。

ただし、ユーザーがマージまたは push しないよう明示した場合、未解決の重要な問題や失敗した必要なテストがある場合、または個別のワークフローで PR や人間によるマージが明示的に必要とされている場合は、その指示を優先する。ブランチ保護など、リポジトリで強制される制約も回避しない。

## `main` push guard

- cloneごとに一度`pnpm hooks:install`を実行し、リポジトリ管理の`pre-push` hookを有効にする。状態は`pnpm hooks:check`で確認する
- `main`へのpushは、`main`をcheckoutしているworktreeから`git push origin main`で行う。`HEAD:main`、作業ブランチからの`branch:main`、作業ブランチのworktreeからの`git push origin main`は禁止する
- `--no-verify`でhookを回避してはならない。hookが拒否した場合は、ローカル`main`への取り込みと実行worktreeを修正する

## ファイル名の言語

新規に作成するファイル・ディレクトリの名前には日本語を使わず、英語(ASCII)で命名する。ドキュメントの本文は日本語でよい。既存の日本語名ファイル(`docs/企画書.md` など)は、明示的な指示がない限りリネームしない。

## 実装フローのドキュメント

機能実装の進め方は `docs/implementation-guide.md`、独立レビューは `docs/review-guide.md` に従う。対象機能の PRD は `docs/specs/` にあり、現在の残件は `docs/status.md` で管理する。設計側セッションが PRD を書いて実装を依頼するときは `.claude/skills/feature-prd/` のスキルを使う。

## dev-state(プロジェクト状態管理)

このプロジェクトの状態は `/Users/qsona/dev-state/daifugo-together/` で管理する(全worktree共通。ディレクトリ名から推測せず、必ずこの絶対パスを使う)。

- セッションの区切り(まとまった作業の完了時)に `STATUS.md` を更新する: リリース状態 / 判断待ち(人間が考えること) / 進行中・浮いているブランチ / やらないと決めたこと / 再開するならここから。事実は git 等の証拠に基づき、不確実な点は「未確認」と明記する
- プランの受け渡しは `plans/NNN-slug.md`(frontmatter: `status: draft|ready|claimed|done`, `claimed_by`, `created`, `prd`)。実装セッションは開始時に `status: ready` のプランを探し、あれば `claimed` + `claimed_by` を書いてから着手し、完了時に `done` にして結果メモを末尾に追記する
- 恒久的な仕様・PRD はこのリポジトリの `docs/` に書き、plans には参照だけを置く(dev-state=ワーキングメモリ、repo=長期記憶)
- dev-state 側の commit/push は自動同期に任せてよい。詳細規約は `/Users/qsona/dev-state/README.md`
