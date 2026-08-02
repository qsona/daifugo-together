# Multi-player card choice design

Date: 2026-08-03

## Decision

Contract v2 の `requestChoice` に任意の `additionalChoices` を追加する。各要求は
`player`、本人の hand zone、selector、固定選択枚数、`choiceId`、`messageKey` を持つ。
同じ player と `choiceId` の重複は許可しない。

エンジンは先頭要求から順に1件ずつ公開し、応答ごとに同じルールの `afterPlay` を
`RuleInput` 付きで再実行する。同一ルールの全要求が完了するまで手番を進めず、その後に
優先順位が低いルールの choice を最新状態から再評価する。

## Compatibility and limits

`additionalChoices` を省略した既存ルール、リプレイ、ルームの挙動は変えない。入力待ちの
公開スナップショットは従来どおり現在の1件だけを含むため、クライアント変更は不要である。

要求列は最初の発動時に固定する。自由入力、対象者そのものを選ぶ入力、ある選択結果に
応じて次の要求を生成する動的な入れ子は対象外とする。
