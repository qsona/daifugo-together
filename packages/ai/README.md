# @daifugo/ai

外部 AI API を使わない大富豪の対戦 AI です。自席の `PlayerSnapshot` と、権威エンジンが列挙した合法手だけを入力にします。

初版は、観測できない札を seed 付きで一様に再配布する決定化と、深さ 1 のルート UCB1 を使います。探索は Node.js の `worker_threads` で動かし、メインイベントループを占有しません。親側の期限を超えた時点で進捗統計があれば partial-search の最善手を返し、まだ1プレイアウトも完了していなければ合法手のヒューリスティック選択へフォールバックします。

Node 26.5.0 の較正値は worker 1本、既定50/200ms、16プレイアウト、候補上限8、cutoff 24、進捗batch 4です。`pnpm validate:ai` は500セット（1,500ゲーム）の合法性・停止性、random-legal基準の平均報酬0.60、最大225ms以内を検査します。件数は `AI_STRENGTH_SETS` と `AI_VALIDATION_GAMES` で縮小できます。

サーバー統合は `@daifugo/server` の `runAiTurn` を使います。1秒watchdog、engine fallback、探索メトリクス、0.4〜1.2秒の演出遅延を探索ライブラリの外側で扱います。

`legalPlays` が空の強制パスは、`AiDecision.play` が `Play` のみを表す契約のため、AI を呼ぶ前にゲームループ側で処理します。
