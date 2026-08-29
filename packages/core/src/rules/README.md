# ルール契約 v1

正準仕様は [`docs/epics/E01-game-engine.md`](../../../../docs/epics/E01-game-engine.md) の §2.5、§2.8〜2.11、§3.5 です。実装上の型は [`contract.ts`](contract.ts)、Effect の競合解決は [`priority/effects.ts`](../priority/effects.ts) にあります。

自動実装されるルールは `RuleModule` として独立登録し、状態を直接変更せず `Effect` を返します。同一バッチの全ルールは、権威状態から複製して深く凍結した同一時点のビューを受け取ります。メモリと乱数はルール ID ごとに分離されます。

`rule.ts` は `@daifugo/core` だけをimportし、`export const rule:
RuleModule` を1件公開します。`rule.test.ts` は `@daifugo/core`、`vitest`、
同じディレクトリの `./rule.js` だけをimportできます。テストは `./rule.js` から
`rule` をimportし、提出した実装本体を検証してください。`rule.meta` は同じ
ディレクトリの `meta.json` 全フィールドを正確に複製してください。CIは型だけでなく
JSONとのdeep equalityも検査します。

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

契約 v1 はプレイヤーへの追加入力とパス起点のフックに対応しません。
契約 v2 は `afterPlay` と `onGameStart` の追加入力を `requestChoice` で追加します。
パス起点のフック、自由入力、宣言には引き続き対応しません。

## engineFeatures (エンジン機能の宣言)

`meta.engineFeatures` に機能名を列挙すると、エンジンネイティブの機能が有効になります。ルールコードで機能自体を再実装しないでください (形の判定・候補生成・代用・強さ比較はエンジンが行います)。ゲームで有効な機能はルールチェーン全体の宣言の和集合です。

| 機能       | 内容                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| `sequence` | 階段: 同一スートで連続する 3 枚以上の手型を追加。強さは連続列の上端ランクで比較                                        |
| `jokers`   | ジョーカー 2 枚をデッキに追加。単体は最強 (`repRank: 'joker'`、強さ反転の影響を受けない)。set/階段では任意カードを代用 |

宣言だけのルール (例: 階段) は `hooks: {}` で構いません。フック引数の `Card` は判別可能ユニオンです: `suit`/`rank` を読む前に `card.kind === 'natural'` で narrowing してください (`kind: 'joker'` の札に suit/rank はありません)。

## フック

| フック            | 発火点                                 | 戻り値                                     |
| ----------------- | -------------------------------------- | ------------------------------------------ |
| `modifyLegality`  | プレイ検証・合法手列挙                 | 合法性の変換。状態変更なし                 |
| `modifyStrength`  | 強さ比較の直前                         | 強さ順の変換。状態変更なし                 |
| `afterPlay`       | プレイ適用とあがり確定の後             | Effect。v2 は選択応答を第3引数で受け取れる |
| `afterFieldClear` | 自然条件または Effect で場が流れた直後 | Effect                                     |
| `onGameStart`     | 配札後、最初の手番前                   | Effect                                     |
| `onGameEnd`       | 全順位確定後、`gameEnded` イベントの前 | Effect                                     |

## Effect の許可範囲

許可されない Effect は例外にせず `effectRejected` として記録します。

| Effect                                                       | `afterPlay` | `afterFieldClear` | `onGameStart` | `onGameEnd` |
| ------------------------------------------------------------ | ----------- | ----------------- | ------------- | ----------- |
| `clearField`                                                 | ○           | ×                 | ×             | ×           |
| `requestChoice` (contract v2)                                | ○           | ×                 | ○             | ×           |
| `skipTurns` / `reverseTurnOrder` / `forceRank` / `moveCards` | ○           | ○                 | ○             | ×           |
| `setMemory`                                                  | ○           | ○                 | ○             | set のみ    |
| `announce`                                                   | ○           | ○                 | ○             | ○           |

KV はルール・スコープごとに分離し、最大 32 キー、1 値 1KB、名前空間合計 16KB です。超過した書込みは棄却します。1 ルールが 1 フックで返せる Effect は最大 8 件です。

適用された Effect は原則として `ruleFired` になり、クライアントで発動カットインとして表示されます。発動そのものではない初期化・解除・次ゲーム用の記録には、`setMemory` の `silent: true` を指定してください。`modifyLegality` と `modifyStrength` は判定の変換であり、それだけでは `ruleFired` になりません。

`announce` は通常、全員の公開履歴へ `ruleFired` を出します。`players` に1〜4人の
プレイヤーIDを指定した場合は、その対象者の個別スナップショットにだけ通知を載せ、
公開履歴・公開発動数には載せません。秘密の条件や役割を知らせる用途では、手札や
カードIDを文言へ含めず、成立事実と行動条件だけを `messageKey` で通知してください。

`afterPlay`、`afterFieldClear`、`onGameStart`、`onGameEnd` の
`context.game.strength` は、同じ状態に `modifyStrength` チェーンを適用した
実効 StrengthOrder です。特に `afterPlay` では、そのプレイを出す直前の
合法性判定で使った実効順序を受け取ります。革命中かどうかを他ルールと共有して
判断するときは、別ルールのメモリやランキングの見た目を参照する代わりに
`context.game.strength.revolution === true` を使ってください。革命系ルールは
ランキングを反転すると同時にこの値を反転します。イレブンバックなどの一時的な
強さ反転はランキングだけを変え、`revolution` は変更しません。フックが
`revolution` を省略して返した場合、エンジンは直前の値を維持します。

通常のランキングでは表せない限定的な強弱関係（例: 単体ジョーカーに対する
スペードの3）は、`comparisonOverrides` に
`{ stronger: '3', weaker: 'joker' }` を追加します。比較例外は指定された2ランク間
だけに適用され、配列後方の指定が優先されます。フックが
`comparisonOverrides` を省略して返した場合は直前の値を維持し、空配列を返すと
既存の例外を明示的に解除します。

`context.game.ruleIds` は、セット開始時に固定された有効ルールIDを優先順位順で
保持します。別ルールが同じゲームに適用されている場合だけ発動・非発動を切り替える
合成条件は、この配列を参照してください。ルール間のKVメモリ共有には使いません。

`forceRank` の `rank` は `1`〜`4` または `'lowest'` を受け付けます。`'lowest'` は適用時にプレイヤー数(最下位順位)へ解決されます。反則あがりのように「最下位」を意図する場合は `'lowest'` を使い、数値を直書きしないでください。複数のプレイヤーが `forceRank` で同じ順位(例: `'lowest'`)を指定された場合、先に適用された対象がその順位を確保し、後の対象は近傍の空きスロットへ再割当されます(先に反則した方がより低い順位になる、エンジンが保証する挙動です)。

## contract v2 のカード選択

`requestChoice` は `afterPlay` または `onGameStart` から、対象プレイヤー自身の手札を
選択肢として正確な枚数を選ばせるか、`players` に列挙した候補からプレイヤー1人を
選ばせます。要求するルールは
`meta.contractVersion: 2` とし、最初の呼び出しでは `requestChoice` だけを
返してください。入力待ち中は次の手番へ進みません。

応答後、同じ `afterPlay(context, play, input)` または
`onGameStart(context, input)` が再び呼ばれます。開始時選択では、応答と
残りの開始時 Effect が完了するまで最初の手番を開始しません。
カード選択は `input.kind === 'cards'`、プレイヤー選択は
`input.kind === 'player'` と `input.playerId` を確認します。`input.choiceId` も確認し、
`input.cardIds` を `moveCards` の `specific` selector に渡して通常の Effect
として適用します。1つの発動で複数プレイヤーに要求する場合は、先頭の要求に
`additionalChoices` を付けます。各 player と `from.player` は一致させ、同じ
player または `choiceId` を重複させてはいけません。先頭から順に1件ずつ応答を
処理し、すべて完了するまで手番を進めません。応答処理は次の `requestChoice` を
1件返すこともでき、エンジンは同じルールの動的な次段として直列処理します。
`simultaneous: true` を指定した場合は、`additionalChoices` を全対象者へ同時に
提示します。各回答は全員が確定するまで非公開かつ未適用で保持し、揃った時点で
要求順に一括適用します。ミニゲームには指定できません。

複数のルールが同じプレイで choice を要求した場合は、ルール優先順位順に直列処理
します。同一ルールの `additionalChoices` をすべて適用した後の状態から次のルールを
再評価するため、残り手札に応じた要求枚数もルールごとに再計算されます。

### 共通ミニゲーム

`requestChoice.kind = 'miniGame'` はサーバー権威の共通ランタイムを開始します。
ルールは参加者と設定だけを宣言し、操作、時計、得点、勝敗を保持または計算しません。
完了後は同じ `afterPlay` が再実行され、単一勝者なら `miniGameResult`、複数勝者なら
`miniGameMultiResult` を受け取ります。

- `bomb_throw_15`: 2〜4人、12秒固定の単一勝者ミニゲームです。
- `binary_quiz_race`: 2〜4人へ同じ二択問題を出し、正解者全員へ1点を与えます。
  1問は1〜4秒、目標は1〜3点、最大12問です。同じラウンドで目標点へ達した全員を
  勝者とし、最大問数では最高得点者全員を勝者とします。未回答はルール指定のA/Bで
  確定します。

二択クイズの問題集合はserver側の版付きtrusted dataです。正解は回答締切までclientへ
配信されません。出題スナップショット、回答、tickをactionとして記録するため、問題集合を
将来追加しても既存replayは同じ結果を再現します。

## 競合キー

| Effect             | 競合単位                                                                                |
| ------------------ | --------------------------------------------------------------------------------------- |
| `clearField`       | `field`                                                                                 |
| `requestChoice`    | `choice:{ruleId}`（同一・異なるルールとも要求順に直列処理）                             |
| `skipTurns`        | `turn:{player}`                                                                         |
| `reverseTurnOrder` | `turnOrder`                                                                             |
| `forceRank`        | `rank:{player}`                                                                         |
| `moveCards`        | バッチ開始時に解決した CardId 集合の推移的な重なり                                      |
| `setMemory`        | `memory:{ruleId}:{key}`                                                                 |
| `announce`         | 競合なし。非 announce Effect が全棄却なら同時に抑制。`players` 指定時は対象者だけへ通知 |

競合はチェーンの最高優先ルールを採用します。同一ペイロードは `deduped`、同一ルール・同一キーの先行 Effect は `superseded` です。語彙を追加する変更では、この表と `conflictKeyOf` の exhaustive switch を同時に更新します。

## 自動実装ルールの受け入れ境界

ルール追加時は `packages/rules/r{id}-{slug}/` の新規ディレクトリだけを変更し、次をすべて通します。

1. 契約型検査とルール単体テスト
2. Effect 上限・フック許可・KV クォータの検査
3. 固定シードの決定性・リプレイ同一性・秘匿性検査
4. `sim/simulate.ts` の random-legal シミュレーションで、不変条件違反と強制終局ガードが 0 件
5. ルール差分ガード

本番の QuickJS 実行境界と自動無効化は E7/TS-03 の責務です。core は `RuleChainPort` を通じて同期的にルールを呼び、Effect の解決・適用と進行フェイルセーフを所有します。
