# clearSuitBinding engine vocabulary

## Context

Q解きは、現在のスート縛りを満たすQのプレイを解決した後だけ、その縛りを解除する。
既存のしばりルールは公開履歴から縛りを再計算しており、ルールごとに分離されたKVを
別ルールから変更できない。Q解きの `modifyLegality` でしばりの不合法判定を上書きする
案は、人気度で変わるルール優先順位に結果が依存し、他の不合法理由も誤って覆し得るため
採用しない。

## Decision

- `clearSuitBinding` Effectを追加し、`afterPlay` だけで許可する。
- Effectは現在の公開プレイのCardId集合を `PrivateGameState.suitBindingResetAfter` に保存する。
  手札情報は保存せず、既に公開された場札だけを解除境界に使う。
- `RuleContext.game.suitBindingResetAfter` を読み取り専用で公開する。
- coreの `suitBindingFromHistory`、`previousPlayForSuitBinding`、
  `playMatchesSuitBinding` が、解除境界以後の履歴に対する共通の縛り計算を所有する。
- 既存のしばりルールも同じ共通計算へ移行する。解除後に同じスート構成が再び連続すれば、
  新しい縛りが通常どおり成立する。
- 競合キーは `suitBinding`。同じフックで複数の解除が発生しても1回に重複除去する。
- 場流れは履歴中の `fieldCleared` によって従来どおり縛りをリセットする。解除境界が
  private stateに残っていても、同じカードはそのゲーム中に再びプレイされないため、
  後続フィールドの判定へ影響しない。

## Compatibility

`clearSuitBinding` を使わないゲームでは解除境界は `null` であり、共通計算は従来の
履歴全体に対するしばり判定と同じ結果を返す。既存ルール `r0008` のコードを変更するため、
`packages/rules/rule-versions.json` の版を4へ上げる。

## Verification

- Effectのpayload、hook許可、競合キー、適用結果をcoreテストで固定する。
- 既存のしばり単体テストを維持し、解除境界後の自由なプレイと再成立を追加する。
- pipelineのEffect allow-list、CX-01 schema/prompt、core契約文書を同時更新し、
  prompt versionを `cx01-v19` へ上げる。
