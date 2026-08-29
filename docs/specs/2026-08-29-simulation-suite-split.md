# CX-03 simulation suite split

- 日付: 2026-08-29 / 状態: 完了
- 関連: [E07 Codex pipeline](../epics/E07-codex-pipeline.md) §2.5・§3.3、[decision-log](../decision-log.md) C-14

## 1. 背景と目的 [変更不可]

CX-03 の大量シミュレーションは、生成ルール単体および全ルール共存時に、終了・カード保存・状態整合・ルール実行の不変条件が壊れないことを広い局面で検査するためにある。現状は全ゲームの全手で本番相当の対戦 AI を動かすため、1,000 ゲームに約 45 分かかり、設計上の simulation 5 分以内という予算を満たさない。

大量の局面探索と AI 互換性検査を分離し、それぞれの目的に必要な計算だけを行う。

## 2. ユーザー体験 [変更不可]

- release CI では、大量不変条件検証と AI 互換性 smoke の成否を別々のステップとして確認できる。
- ローカルでも同じ 2 種類を CLI オプションで個別に再現できる。
- どちらかが失敗した release は本番デプロイされない。

## 3. 受け入れ条件 [変更不可]

- 大量不変条件検証は固定 seed のランダム合法手で 200 ゲーム × 5 seed を実行する。
- AI 互換性 smoke は本番と同じ先読み長の AI で 20 ゲーム × 1 seed を実行する。
- 両方が `new-only` と `all` の各構成で個別実行できる。
- 大量不変条件検証は終了・カード保存・状態整合・ルール例外・不正 Effect を検査する。
- AI smoke は上記に加え、AI が権威側の合法手を返すことと safe/fast 実装の一致を検査する。
- soft deadline で得た部分探索結果は合法である限り smoke の失敗にしない。heuristic / engine fallback は失敗にする。
- AI の実時間性能はこの smoke の合否に含めない。

## 4. スコープ外 [変更不可]

- AI の思考品質・勝率評価
- 固定局面による AI 性能ベンチマーク
- シミュレーション対象ルールやゲームルール自体の変更

## 5. 詳細仕様 [変更可・記録必須]

- CLI は `--mode invariants|ai-smoke` を受け付ける。未指定時は既存互換のため `ai-smoke` とする。
- rule PR でも 20 ゲーム × 1 seed の両モードを実行し、軽量段階で両経路の破損を検知する。
- release の変更ルール単体検証は、従来どおり変更ルールごとに直列実行する。

## 6. 技術設計メモ [参考]

- 既存の `runRuleSimulations` を `invariants` に、`runAiRuleSimulations` を `ai-smoke` に対応させる。
- 両モードで既存の `simulationViolations` とレポート形式を共有する。
- ミニゲームはどちらも headless の仮想 tick で進め、実時間待機しない。

## 7. 未決事項

- なし。AI 性能ゲートが必要になった場合は、固定局面・固定手数の独立ベンチマークとして別途設計する。

## 8. 実装記録

- 着手時点のコミット: `e0c9d8e`

### 置いた仮定

| 仮定 | 理由 | 覆ったときの影響 |
|---|---|---|
| AI smoke は 20 ゲーム × 1 seed とする | 既存 rule PR smoke の実績があり、互換性確認に必要な複数局面を約 1/50 のゲーム数で踏める | ゲーム数・seed 数は CI 引数だけで調整可能 |
| `partial-search` は互換性成功として扱う | soft deadline 到達時にも探索済みの合法手を返す正常な縮退で、共有 runner の速度に依存するため | 厳格な性能判定が必要なら独立ベンチマークを追加する |

### 詳細仕様の変更

| 変更 | 理由 |
|---|---|
| なし | - |

### 検証

- `pnpm exec vitest run packages/sim/src/cli.test.ts packages/sim/src/runner.test.ts scripts/red-team.test.ts`: 3 files / 22 tests 成功。
- `pnpm --filter @daifugo/sim typecheck`: 成功。
- `pnpm verify`: 178 files / 1,374 tests、format / lint / design lint / typecheck / build を含め成功。初回は sandbox の localhost listen 禁止で失敗したため、通常権限で再実行した。
- 全ルール `invariants` 200 ゲーム × 5 seed: 1,000 完走、違反 0、ビルド込み 68.39 秒。
- 全ルール `ai-smoke` 20 ゲーム × 1 seed: 20 完走、違反 0、fallback 0、ビルド込み 17.03 秒。

### 積み残し・提案

- AI の応答時間を release gate に戻す場合は、共有 runner の実時間に依存する大量対局ではなく、固定局面・固定手数の独立ベンチマークとして設計する。
