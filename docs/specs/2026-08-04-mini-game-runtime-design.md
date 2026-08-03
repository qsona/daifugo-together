# Contract v2 mini-game runtime

`requestChoice` に、カード・プレイヤー選択とは独立した短時間ミニゲームを待つ
`kind: 'miniGame'` を追加する。最初の実装は `bomb_throw_15` であり、ルールモジュールと
クライアントのどちらにも勝敗判定を持たせない。

## ルール境界

ルールは `afterPlay` から次の要求を1件返す。

```ts
{
  type: 'requestChoice',
  kind: 'miniGame',
  miniGame: 'bomb_throw_15',
  player,
  participants,
  durationMs: 12_000,
  seed,
  choiceId,
  messageKey,
}
```

共通ランタイムが完了すると、エンジンは同じ `afterPlay` を次の入力で再実行する。

```ts
{
  kind: 'miniGameResult',
  choiceId,
  miniGameId,
  winnerPlayerId,
  scores,
}
```

この入力はクライアント向けSocket APIには公開しない。エンジンは保持中のミニゲーム状態から
結果を再計算し、権威tickが15秒分完了した場合だけルールへ渡す。ルールは勝者IDを報酬処理に
使えるが、移動、爆弾、時計、得点、同点抽選を保持または再計算しない。

## `bomb_throw_15`

- 7×7アリーナ、開始演出2秒、対戦12秒、結果1秒。
- サーバーが200msごとにtickし、方向入力と投擲入力を状態へ適用する。
- 爆弾は向いている方向の最大3マス先へ着地し、1秒後に上下左右2マスへ爆発する。
- 同時爆弾は1人1個、投擲間隔は1.4秒。爆風は連鎖する。
- 他人の爆風への被弾で投げ手に1点を与え、被弾者は700ms無敵になる。
- 残り4秒は外周を危険地帯にする。
- 得点、被弾数、seedによる決定的順序の順で勝者を1人に確定する。
- AI、切断中、AI代行中の参加者は、同じコマンド境界を使う決定的botが操作する。

## 同期とリプレイ

クライアントは盤面の権威スナップショットを受け取り、方向・投擲コマンドだけを送る。
表示時計も権威状態の `elapsedMs` から算出する。リプレイには各コマンドと各tickを通常の
`SetAction` として記録するため、seed、参加者、最終得点、被弾数、勝者を再現できる。

ミニゲーム中も既存の `awaitingChoice` を使うが、`pendingChoice.kind === 'miniGame'` の間は
通常手番と通常の選択タイマーを停止し、ミニゲーム専用timerを優先する。完了後に同じルールが
カード選択を返した場合は、既存の直列choice処理へ戻る。
