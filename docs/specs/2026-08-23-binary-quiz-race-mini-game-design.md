# Binary quiz race mini-game design

Date: 2026-08-23

## 判断

`requestChoice` の mini-game 実装に `binary_quiz_race` を追加する。新しい Effect、
hook、`engineFeature` は増やさず、既存のサーバー権威 mini-game 境界を再利用する。

各ラウンドで全参加者へ同じ二択問題を出し、正解者全員へ1点を与える。
同じラウンドで目標点へ達した参加者は全員を勝者とし、サドンデス、回答速度による順位、
抽選による単独勝者化は行わない。

問題文、ジャンル、難易度、正解内容はこの機構設計の外で決める。ここでは問題データの
境界、版管理、秘匿、決定性だけを定める。productionで利用する前に、後述の契約を満たす
question setを少なくとも1つ用意する。

## ルール境界

`MiniGameChoiceRequest` を mini-game ID ごとの判別可能 union にし、ルールは
`afterPlay` から次の要求を1件返す。

```ts
{
  type: 'requestChoice',
  kind: 'miniGame',
  miniGame: 'binary_quiz_race',
  player,
  participants,
  questionSet: 'general_v1',
  defaultOption: 'a',
  roundDurationMs: 4_000,
  targetScore: 3,
  maxRounds: 12,
  seed,
  choiceId,
  messageKey,
}
```

共通ランタイムとして再利用できる範囲を保ちつつ進行時間を制限するため、
`participants` は2〜4人、`roundDurationMs` は1,000〜4,000ms、`targetScore` は
1〜3、`maxRounds` は`targetScore`以上かつ最大12とする。`defaultOption` は
`'a' | 'b'`、`questionSet` は実装済みIDだけを受け付ける。

完了時は、既存の単一勝者 `miniGameResult` を変えず、複数勝者用の新しい入力を同じ
`afterPlay` へ返す。

```ts
{
  kind: 'miniGameMultiResult',
  choiceId,
  miniGameId,
  winnerPlayerIds,
  scores: Record<PlayerId, { score: number }>,
}
```

`winnerPlayerIds` は元の `participants` 順で重複なく並べ、1〜4人を保証する。
ルールは参加者、question set、既定側、制限時間、目標点、最大ラウンド数、seedを宣言し、
返された勝者ID列を報酬処理に使うだけである。問題、正解、ラウンド状態、回答、時計、得点を
ルールメモリや `choiceId` に保持してはならない。

## 問題データ境界

問題カタログはserver所有の版管理されたtrusted dataとし、rule moduleやweb bundleへ
正解を持たせない。1問の論理形は次とする。

```ts
{
  id: 'general_v1_001',
  prompt: '...',
  options: [
    { id: 'a', label: '...' },
    { id: 'b', label: '...' },
  ],
  correctOption: 'b',
}
```

同じquestion set内でIDを重複させず、promptとlabelに表示長上限と既存のinjection pattern
screenを適用する。各setは`maxRounds`以上の問題を持ち、対局中は重複出題しない。
問題文・選択肢・正解の編集方針と実データは別の設計・レビューで決めてよいが、
question set IDと内容を同時に版固定する。既存IDの内容は書き換えず、改訂は新しいIDを作る。

serverはseedと未使用問題IDから次問を決定し、権威 `SetAction` に問題スナップショットを
含める。これにより将来カタログが更新されても過去replayを再現できる。correctOptionは
ラウンド確定までclient snapshotへ含めない。

## 進行と所有権

1. engineはラウンド番号、締切までの経過時間、現在問題、非公開の回答、得点、直前結果、
   勝者列をJSON状態として保持する。回答は1ラウンドにつき1人1回で、送信後は変更できない。
2. serverはquestion setの解決と出題、権威tickの予約、接続状態と操作主体の判定、
   per-player snapshot生成を所有する。問題の正解をラウンド確定前に配信しない。
3. 人間の回答は締切まで他プレイヤーへ公開しない。締切時の未回答は
   `defaultOption` として確定する。
4. AI、切断中、AI代行中の席は、seed・ラウンド番号・player IDから決まる回答を
   同じ入力境界へ送る。人間が復帰した場合は次の未回答ラウンドから操作を戻す。
5. 締切時に正解者全員へ1点を加える。1人以上が目標点へ達した場合は、そのラウンドで
   目標点へ達した全員を勝者として終了する。
6. 全員不正解が続いても停止しないよう、`maxRounds`到達時は最高得点者全員を勝者として
   終了する。全員同点なら全参加者が勝者になる。
7. clientは問題、二択、残り時間、公開済み得点と確定結果だけを表示し、正誤や勝者を
   計算しない。回答中は本人の選択済み状態だけを本人へ返し、個別回答と選択人数は
   ラウンド確定まで隠す。

## 決定性・リプレイ・代行

初期seedはルールへ分離された`context.rng`から生成する。出題順、bot回答は
`seed + round + question/player`から決定し、反復順序には依存させない。

serverがラウンドを開始するときは、将来のカタログ変更からreplayを独立させるため、
問題スナップショットを含む権威actionを保存する。

```ts
{
  type: 'miniGameQuestion',
  player,
  miniGameId,
  round,
  question: {
    id,
    prompt,
    options,
    correctOption,
  },
}
```

人間の回答も通常 `SetAction` として保存する。

```ts
{
  type: 'miniGameCommand',
  player,
  miniGameId,
  round,
  option: 'a' | 'b',
}
```

権威tickは既存どおり `miniGameTick` として保存する。tickにはその時点の
`automatedPlayerIds` が含まれるため、bot回答、締切時の既定回答、得点確定を同じaction列から
再現できる。古いラウンド番号の回答は棄却し、再送が次ラウンドへ混入しないようにする。

## 後方互換性

`MiniGameState`、`MultiplayerGameView.miniGame`、mini-game commandをID/kindで分岐する
unionへ変える。`bomb_throw_15` のpayload、単一勝者結果、状態遷移、画面、既存actionの
意味は変えない。`binary_quiz_race`を要求しない既存ルール、既存room、既存replayは
従来どおり動く。

古いclientが新しい画面を描画できなくても、未回答は既定側として処理されるため対局は
停止しない。新clientは`kind`で既存`BombThrowMiniGame`と新しいクイズ画面を出し分ける。

## 語彙同期と実装箇所

- `packages/core/src/rules/contract.ts`: mini-game request union、`MINI_GAME_IDS`、
  `miniGameMultiResult`と`RULE_INPUT_KINDS`。
- `packages/core/src/minigame/`: `binary-quiz-race.ts` と回答秘匿、期限、得点、複数勝者、
  最大ラウンド終了のテスト。
- `packages/core/src/engine/effects.ts` / `reducer.ts` / `game/types.ts` / `protocol.ts`:
  ID別の生成・入力・tick・結果dispatchとpayload検証。
- `packages/server/src/quiz/`: question set registry、schema検証、版管理された問題データ。
  実際の問題内容は別途レビューする。
- `packages/server/src/room/types.ts` / `reducer.ts` / `view.ts` / `timers.ts` /
  `socket-gateway.ts`、`packages/server/src/persistence.ts`: 出題action、回答受付、代行、tick、
  snapshot、`SetAction`記録。
- `packages/web/src/multiplayer/client.ts` / `App.tsx` / `components/`:
  クイズ画面、回答送信、kind別表示。既存ボム画面は変更しない。
- `packages/core/src/rules/README.md` と `docs/epics/E01-game-engine.md`:
  新mini-gameの境界、問題秘匿、上限、複数勝者、replay規約。
- `packages/pipeline/src/judge-prompt.ts`: `MINI_GAME_SUMMARIES`、複数勝者入力、契約説明を
  更新し、`CX01_PROMPT_VERSION`を上げ、`PROMPT_HASHES`へ新hashを追記する。
  `judge-prompt-vocabulary.test.ts`と`judge-prompt-version.test.ts`で同期を検証する。

SPECのhook/effect/engineFeatures語彙は増えないため
`packages/pipeline/src/app-server-judge.ts`と`packages/server/src/pipeline/service.ts`のallow-set、
`scripts/diff-guard.mjs`は変更しない。既存ルールの`rule.ts`も変更しないため
`packages/rules/rule-versions.json`の更新も不要である。
