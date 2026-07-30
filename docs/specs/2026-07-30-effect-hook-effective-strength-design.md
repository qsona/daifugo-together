# Effect フックへ実効 StrengthOrder を渡す

## 背景

`RuleContext.game.strength` は「現在の強さ順」を表す契約だが、
`afterPlay` などの Effect フックには常に基本順序が渡されていた。
そのため、革命中の反則あがりのように、別ルールとの合成後の強さを
Effect フックで判断するルールが書けなかった。革命フラグを共有 KV に
置く方法は、ルール間の暗黙結合と単独ロールバック不能を招く。

## 決定

- `afterPlay` には、そのプレイの権威的な合法性判定で実際に使った
  実効 `StrengthOrder` をそのまま渡す。これはプレイ直前のルール状態を表す。
- `afterFieldClear`、`onGameStart`、`onGameEnd` は、各フック開始時の状態へ
  `modifyStrength` チェーンを副作用なしで適用し、実効順序を渡す。
- 実効順序の再評価では `modifyStrength` の権威呼び出し回数を増やさない。
- ルール固有の発動状態は従来どおり分離 KV に置ける。他ルールはその KV を
  読まず、`context.game.strength` という合成済みビューを共有シグナルに使う。

## 互換性

Effect、hook、`RuleContext` の型語彙は変えない。`modifyStrength` がない構成では
従来どおり基本順序になる。既存ルールのコードと bundle hash は変わらない。
CX-01 の出力語彙も変わらないため、judge prompt の版上げは不要。

## 検証

- 別ルールがゲーム内メモリに基づいて強さを反転した状態で、
  `afterPlay` の observer が反転済み順序を受け取ること。
- 常時反転ルールがある構成で、`onGameStart` の observer も
  反転済み順序を受け取ること。
- format、lint、全パッケージ型検査、全テスト、全 build が成功すること。
