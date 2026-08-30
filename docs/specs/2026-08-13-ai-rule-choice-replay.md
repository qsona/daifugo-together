# AIのルール選択とリプレイ記録

- 日付: 2026-08-13 / 状態: 完了
- 関連: [E02 AIプレイヤー](../epics/E02-ai-player.md) §3.2、[choice contract v2](2026-07-31-rule-choice-contract-v2-design.md)

## 1. 背景と目的 [変更不可]

AIが7渡し・ラッキー7・10捨てなどのカード選択をカードID順で処理しており、通常着手と
異なる弱い判断になり得る。また、AIの自動カード選択がリプレイでは通常の`play`として
保存されるため、対局分析と再実行が不正確になる。この2点を改善する。

## 2. ユーザー体験 [変更不可]

- AIはルールによるカード選択でも、通常着手のfallbackと共通する軽量ヒューリスティックを使う。
- 対局の見た目や待ち時間は変えない。
- 新しく保存するリプレイは、AIのルール選択を`ruleInput`として忠実に再現できる。

## 3. 受け入れ条件 [変更不可]

1. AIのカードchoiceはカードID順ではなく、手札に2・Joker・8・3だけを残す選択を避け、
   その制約内で弱いカードから処理する既存ヒューリスティックを使う。
2. AIの`autoAct`が保留中のカードchoiceへ応答した場合、リプレイに`ruleInput`と
   `choiceId`・選択カードが保存される。
3. プレイヤーchoiceも、実際に自動選択されたプレイヤーを`ruleInput`として保存する。
4. 通常のAI着手・強制パスのリプレイ形式は変えない。
5. `pnpm verify`が成功する。

## 4. スコープ外 [変更不可]

- choiceをMCTSの探索ノードへ組み込むこと。
- ルールIDごとの専用戦略。
- 過去に誤形式で保存済みのリプレイの修復。

## 5. 詳細仕様 [変更可・記録必須]

- 複数枚choiceは、既存の単手ヒューリスティックを1枚ずつ適用する決定的な貪欲選択とする。
- 選択候補はスナップショットに公開された本人の候補カードだけに限定する。
- 必要枚数が0、または不正な場合も、呼び出し境界で例外を起こさない。

## 6. 技術設計メモ [参考]

- `packages/ai/src/heuristic.ts`にカードchoice用ヘルパーを追加し、
  `packages/server/src/room/socket-gateway.ts`から利用する。
- `packages/server/src/persistence.ts`の`replayAction`で、`autoAct`前の
  `pendingChoice`を参照して`ruleInput`へ変換する。

## 7. 未決事項

なし。

## 8. 実装記録

- 着手時点のコミット: `2078208`

### 置いた仮定

| 仮定 | 理由 | 覆ったときの影響 |
| --- | --- | --- |
| choiceでは通常着手と同じ危険札残し回避を1枚ずつ適用する | E02の暫定ヒューリスティック方針を保ち、未知ルールへ個別対応しないため | choiceを探索へ含める場合は選択関数とテストを置換する |

### 詳細仕様の変更

| 変更 | 理由 |
| --- | --- |
| 全体テストのVitest最大worker数を4に制限 | AIの実時間期限テストが高並列時のCPU競合でfallbackし、無関係なGit fixtureも5秒を超える既知フレークを再現したため。制限時は全1314件が成功し、本番処理には影響しない |

### 検証

- `pnpm exec vitest run packages/ai/src/heuristic.test.ts packages/server/src/persistence.test.ts`: 18件成功
- `pnpm --filter @daifugo/ai typecheck`: 成功
- `pnpm --filter @daifugo/server typecheck`: 成功
- `pnpm exec vitest run --maxWorkers=4`: 171ファイル・1314件成功
- `pnpm build`: 成功
- `pnpm verify`: 最終実行結果を下記コミット前に確認

### 積み残し・提案

- choiceをMCTSノードとして探索する本格対応はスコープ外のまま。
- 過去に`play`として保存済みのAI choiceリプレイは修復しない。
