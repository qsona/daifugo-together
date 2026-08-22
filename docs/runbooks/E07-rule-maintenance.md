# Existing generated rule maintenance

既存の生成ルールを、元提案との対応と実行 provenance を保ったまま人間レビュー付きPRで更新する手順です。新規ルールの `rule/**` と恒久巻き戻しの `revert/**` は従来の経路を使い、この保守経路へ混ぜません。

## 1. ブランチとPR宣言

信頼済みの最新 `main` から、対象PRDのファイル名に一致する専用ブランチを作ります。

```sh
git switch -c maintenance/rules/2026-08-17-rule-balance-adjustment
```

PR本文にはブロックをちょうど1件記載し、PRDと変更する全ルールを宣言します。

```text
<!-- daifugo-rule-maintenance
prd: docs/specs/2026-08-17-rule-balance-adjustment.md
rule: r0015-lucky-seven
rule: r0027-bomberman
rule: r0029-real-bomber
end-daifugo-rule-maintenance -->
```

ブランチは `maintenance/rules/<PRDの拡張子なしファイル名>` と完全一致させます。PR作成者は `RULE_PR_ALLOWED_AUTHORS` の許可対象でなければなりません。

## 2. 許可される差分

宣言した各既存ルールについて、次の4ファイルを同じPRで全て変更します。

- `meta.json`
- `SPEC.json`
- `rule.ts`
- `rule.test.ts`

これらに加えて、次だけを変更できます。

- `packages/rules/src/rule-interactions.test.ts`
- `packages/rules/rule-versions.json`
- `packages/rules/rule-bundles.json`

対象外のルール、ほかの製品コード、設定、依存関係、ドキュメントは混ぜられません。ルールの `ruleId`、ディレクトリslug、`proposalId`、`kind`、`prefecture`、`SPEC.json.source` は不変です。code側の `rule.meta` は `meta.json` と一致させます。

## 3. Versionとbundle hash

対象ルールは全て現在版から正確に1つ繰り上げます。実装とテストを更新した後、ルートで次を実行します。

```sh
pnpm rules:bump-changed
pnpm rules:check-versions
```

前者が対象ルールの `rule-versions.json` と `rule-bundles.json` を更新します。保守PRの差分ガードは、宣言したルールだけが +1 され、新しいbundle hashになっていることを検査します。CIの `rules:check-versions` は実際のbuild結果からhashを再計算します。

保守変更のprovenanceは、`rule-versions.json` と `rule-bundles.json` の変更コミットから保守PRのGitHubマージ履歴をたどって確認します。DBの `rule_versions.pr_number` と `rule_versions.merge_sha` は元提案の実装ジョブを指し、保守PRの番号やmerge SHAへは更新されません。保守変更の追跡にこれらのDB列を使わないでください。

## 4. 検証とレビュー

対象ルールの単体テスト、共有相互作用テスト、全体検証を実行します。

```sh
pnpm exec vitest run \
  packages/rules/r0015-lucky-seven/rule.test.ts \
  packages/rules/r0027-bomberman/rule.test.ts \
  packages/rules/r0029-real-bomber/rule.test.ts \
  packages/rules/src/rule-interactions.test.ts
pnpm verify
```

PRを作成し、CIがgreenになっても自動マージしません。PRD、4ファイル同期、元提案の保持、相互作用、version/hashを人間がレビューしてマージします。複数ルールを同じ反映単位にする調整では、分割PRを作らず1件の保守PRにまとめます。

## 5. 本番反映後

マージ後は対象PRDの運用手順に従って同じreleaseへ載せます。新しく開始したセットで全対象ルールのversion・読み込み・挙動を確認します。利用者向けお知らせがある場合は、この本番確認が終わるまで配信しません。
