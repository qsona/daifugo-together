# ルール契約 v1

正準仕様は [`docs/epics/E01-game-engine.md`](../../../../docs/epics/E01-game-engine.md) の §2.5、§2.8〜2.11、§3.5 です。実装上の型は [`contract.ts`](contract.ts)、Effect の競合解決は [`priority/effects.ts`](../priority/effects.ts) にあります。

自動実装されるルールは `RuleModule` として独立登録し、状態を直接変更せず `Effect` を返します。同一バッチの全ルールは、権威状態から複製して深く凍結した同一時点のビューを受け取ります。メモリと乱数はルール ID ごとに分離されます。

`rule.ts` は `@daifugo/core` だけをimportし、`export const rule:
RuleModule` を1件公開します。`rule.test.ts` は `@daifugo/core` と `vitest`
だけをimportできます。`rule.meta` は同じディレクトリの `meta.json`
全フィールドを正確に複製してください。CIは型だけでなくJSONとのdeep equalityも検査します。

```ts
import type { RuleModule } from '@daifugo/core';

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0001-example',
    name: '例ルール',
    description: '例の説明',
    kind: 'original',
    proposalId: 'proposal-id',
    contractVersion: 1,
    messages: { fired: '例ルールが発動しました' },
  },
  hooks: {
    afterPlay(context, play) {
      return play.cards.some((card) => card.rank === '8')
        ? [{ type: 'clearField' }]
        : [];
    },
  },
};
```

テストでは公開契約の `RuleContext` を満たす最小fixture builderを
`rule.test.ts` 内に置きます。fixtureは固定値だけを使い、発動・非発動・
境界/複数枚と `SPEC.json.testPoints` を検証します。

契約 v1 では、プレイヤーへの追加入力、パス起点のフックには対応しません。

## engineFeatures (エンジン機能の宣言)

`meta.engineFeatures` に機能名を列挙すると、エンジンネイティブの機能が有効になります。ルールコードで機能自体を再実装しないでください (形の判定・候補生成・代用・強さ比較はエンジンが行います)。ゲームで有効な機能はルールチェーン全体の宣言の和集合です。

| 機能       | 内容                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| `sequence` | 階段: 同一スートで連続する 3 枚以上の手型を追加。強さは連続列の上端ランクで比較                                        |
| `jokers`   | ジョーカー 2 枚をデッキに追加。単体は最強 (`repRank: 'joker'`、強さ反転の影響を受けない)。set/階段では任意カードを代用 |

宣言だけのルール (例: 階段) は `hooks: {}` で構いません。フック引数の `Card` は判別可能ユニオンです: `suit`/`rank` を読む前に `card.kind === 'natural'` で narrowing してください (`kind: 'joker'` の札に suit/rank はありません)。

## フック

| フック            | 発火点                                 | 戻り値                     |
| ----------------- | -------------------------------------- | -------------------------- |
| `modifyLegality`  | プレイ検証・合法手列挙                 | 合法性の変換。状態変更なし |
| `modifyStrength`  | 強さ比較の直前                         | 強さ順の変換。状態変更なし |
| `afterPlay`       | プレイ適用とあがり確定の後             | Effect                     |
| `afterFieldClear` | 自然条件または Effect で場が流れた直後 | Effect                     |
| `onGameStart`     | 配札後、最初の手番前                   | Effect                     |
| `onGameEnd`       | 全順位確定後、`gameEnded` イベントの前 | Effect                     |

## Effect の許可範囲

許可されない Effect は例外にせず `effectRejected` として記録します。

| Effect                                                       | `afterPlay` | `afterFieldClear` | `onGameStart` | `onGameEnd` |
| ------------------------------------------------------------ | ----------- | ----------------- | ------------- | ----------- |
| `clearField`                                                 | ○           | ×                 | ×             | ×           |
| `skipTurns` / `reverseTurnOrder` / `forceRank` / `moveCards` | ○           | ○                 | ○             | ×           |
| `setMemory`                                                  | ○           | ○                 | ○             | set のみ    |
| `announce`                                                   | ○           | ○                 | ○             | ○           |

KV はルール・スコープごとに分離し、最大 32 キー、1 値 1KB、名前空間合計 16KB です。超過した書込みは棄却します。1 ルールが 1 フックで返せる Effect は最大 8 件です。

`forceRank` の `rank` は `1`〜`4` または `'lowest'` を受け付けます。`'lowest'` は適用時にプレイヤー数(最下位順位)へ解決されます。反則あがりのように「最下位」を意図する場合は `'lowest'` を使い、数値を直書きしないでください。複数のプレイヤーが `forceRank` で同じ順位(例: `'lowest'`)を指定された場合、先に適用された対象がその順位を確保し、後の対象は近傍の空きスロットへ再割当されます(先に反則した方がより低い順位になる、エンジンが保証する挙動です)。

## 競合キー

| Effect             | 競合単位                                            |
| ------------------ | --------------------------------------------------- |
| `clearField`       | `field`                                             |
| `skipTurns`        | `turn:{player}`                                     |
| `reverseTurnOrder` | `turnOrder`                                         |
| `forceRank`        | `rank:{player}`                                     |
| `moveCards`        | バッチ開始時に解決した CardId 集合の推移的な重なり  |
| `setMemory`        | `memory:{ruleId}:{key}`                             |
| `announce`         | 競合なし。非 announce Effect が全棄却なら同時に抑制 |

競合はチェーンの最高優先ルールを採用します。同一ペイロードは `deduped`、同一ルール・同一キーの先行 Effect は `superseded` です。語彙を追加する変更では、この表と `conflictKeyOf` の exhaustive switch を同時に更新します。

## 自動実装ルールの受け入れ境界

ルール追加時は `packages/rules/r{id}-{slug}/` の新規ディレクトリだけを変更し、次をすべて通します。

1. 契約型検査とルール単体テスト
2. Effect 上限・フック許可・KV クォータの検査
3. 固定シードの決定性・リプレイ同一性・秘匿性検査
4. `sim/simulate.ts` の random-legal シミュレーションで、不変条件違反と強制終局ガードが 0 件
5. ルール差分ガード

本番の QuickJS 実行境界と自動無効化は E7/TS-03 の責務です。core は `RuleChainPort` を通じて同期的にルールを呼び、Effect の解決・適用と進行フェイルセーフを所有します。
