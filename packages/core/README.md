# @daifugo/core

I/O を持たない大富豪ゲームエンジンと共有型を提供するパッケージです。

規範となる仕様:

- [`docs/epics/E01-game-engine.md`](../../docs/epics/E01-game-engine.md)
- [`docs/epics/E12-tech-stack.md`](../../docs/epics/E12-tech-stack.md)

検証はリポジトリルートから `pnpm verify` で実行します。

## 公開面

- `startGame` / `reduceGame`: 1 ゲームの純粋な状態遷移
- `startSet` / `reduceSet`: 複数ゲーム、draining、セット結果
- `createSimulationApi`: E2 が使う合法手列挙、状態適用、終局判定、秘匿ビュー、安全手、JSON 直列化
- `simulate`: random-legal 対局と不変条件レポート
- `createReplayInit` / `replaySet`: 受理済みアクション列の再実行

`createSimulationApi` は静的な `GameConfig`、セット表示用の `SnapshotContext`、任意の `RuleRuntime` を一つの入力として固定し、各プレイアウト状態を引数に取ります。照会は渡された複製状態だけを扱い、権威状態の RNG・`hookCalls`・発動記録を進めません。
