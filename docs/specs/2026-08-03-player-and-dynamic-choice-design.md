# Player and dynamic choice design

Date: 2026-08-03

## Decision

Contract v2 の `requestChoice` にプレイヤー候補 `players` を追加する。応答は
`RuleInput { kind: 'player', choiceId, playerId }` とする。候補は発動時の active
プレイヤーに絞り、対象本人だけへ候補名を公開する。

応答付き `afterPlay` が次の `requestChoice` を返した場合、エンジンは同一ルールの
動的な次段として処理する。前段の値を後段で使うルールは、許可済み候補のseat indexを
次の `choiceId` に符号化し、共有されないルールメモリを待機状態の代用にしない。

## Ordering and atomicity

同一ルールの次段を完了してから、低優先ルールの要求を最新状態で再評価する。入力待ち中の
手番は現在の応答者として配信し、AI・切断代行・simulationは候補の安定順で選ぶ。

交換は2つの `moveCards` を同じEffect batchで返す。selectorはどちらもbatch開始時の
手札から解決され、transition完了までsnapshotを公開しないため、途中状態は観測されない。
