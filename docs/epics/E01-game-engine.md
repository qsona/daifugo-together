# E1: 素の大富豪ゲームエンジン 詳細設計

> **改訂反映ノート(2026-07-25、E12 改訂による)** — 矛盾する記述は E12 を正とする。
> - **契約は全面有効**: フック・Effect 語彙・優先順位・決定性・リプレイ形式など本書の契約設計はそのまま生きる。
> - **読み替え**: サンドボックス隔離を前提とした記述(純粋性の「構造による強制」・バンドルの動的ロード)は、「静的 import + 設計規約 + レビュー/CI/lint による強制」に読み替える(E12 §4.6 改訂: ルール = packages/rules の通常 TS モジュール、有効/無効は DB フラグ)。
> - **アクションログの永続化が要件に昇格**(E12 §4.4): 本書の ReplayInit + アクション列 JSONL を「任意のデバッグ出力」ではなく追記専用で永続化する(保存先・保持期間は E10 と確定)。
> - **GE-05 に追加が必要**: デプロイ時の draining(新規ゲーム開始停止・進行中ゲーム完走)と、**セット途中打ち切り**(そこまでの結果で setResult へ遷移し評価に進む)の状態遷移(E12 §4.5)。
> - choice 機構などの契約拡張は、デプロイ方式への変更で実施しやすくなった(契約変更とルールが同一コミットで揃い、バンドル版ズレ問題が消滅)。
>
> **MP-03 改訂ノート(2026-07-27)** — 画面 5a の情報量が増えた実機確認を受け、ゲーム間リザルトの既定待ち時間を **5 秒から 15 秒(仮)** に変更した。全員一律の server タイマー・個人別早送りなしは維持し、server が確定した終了時刻を snapshot に含めて表示バーと遷移時刻を一致させる。以下の旧「5 秒」記載は 15 秒へ改訂した。

- 作成日: 2026-07-24
- 状態: 承認済み(2026-07-27 開発者レビュー。§5 の要決定事項を除き確定 — 裁定は decision-log 参照)
- 一次情報源: `docs/企画書.md`(§3.1〜3.4, §4.3〜4.5)/ `docs/product-backlog.md`(GE-01〜GE-05)
- 前提文書: `docs/epics/E12-tech-stack.md`(以下「E12」。特に §4.1 言語・共通基盤、§4.6 ルールプラグイン契約、§6 の E1 への引き継ぎ事項)
- 突き合わせ済み文書: `E02-ai-player.md` / `E03-multiplayer.md` / `E08-evaluation.md` / `E09-priority-popularity.md`(それぞれ「E02」「E03」「E08」「E09」。相互の依頼・回答は §5.2〜5.3 に集約)
- 画面参照: `docs/design/wireframes.html`(画面 3 / 4 / 5a / 5b)

---

## 1. Epic 概要

### 1.1 目的

基本ルールのみの「素の大富豪」を最後まで遊び切れるゲームエンジンを `packages/core` に実装し、あわせて**後からルールを個別に差し込める構造**(ルールプラグイン契約の実装側)を確立する。E12 が方針として定めたルール契約(RuleModule / Effect 語彙)の**確定版**を本書で定義し、フェーズ 2 の自動実装パイプライン(E7)が依存する「受け入れ境界」を文書化する。

エンジンは **I/O を持たない純粋関数の集合**(同じ入力 → 同じ出力。DB・ネットワーク・時計・`Math.random` に触れない)として実装する(E12 §3 責務分割)。ネットワーク(E3)・永続化(E12 §4.4)・サンドボックス実体(E12 §4.8)は本 Epic の範囲外だが、それらと接続するための**型と抽象インターフェース**は本 Epic が定義する。

### 1.2 担当ストーリー

| ID | 要約 | フェーズ | 依存 |
|---|---|---|---|
| GE-01 | 「基本ルール」の範囲の明文化(実装の仕様・提案ルールとの差分基準線) | 1 | なし |
| GE-02 | 配札・手札秘匿・手番のプレイ/パス・場流れ | 1 | GE-01 |
| GE-03 | あがり判定・順位・称号・ゲーム決着 | 1 | GE-02 |
| GE-05 | 3 戦 1 セットの進行(簡易リザルト → 自動次戦 → セット総合) | 1 | GE-03 |
| GE-04 | ルールを個別に追加・削除・入れ替えできる構造 | 1 | GE-02 |

実装着手順はバックログどおり GE-01 → 02 → 03 → 05 → 04 とする(GE-04 は GE-02 完了後なら GE-03/05 と並行可)。ただし本書の §2 は全ストーリー横断の仕様なので、GE-02 の実装開始時点から従う。

### 1.3 他 Epic との依存・接続

| 相手 | 方向 | 内容 |
|---|---|---|
| E12(技術選定) | E12 → E1 | TypeScript strict / pnpm / Vitest(§4.1)、ルール契約の骨子と Effect 語彙(§4.6)、優先順位適用(§4.6(3))、AI CPU 予算と合法手列挙の引き継ぎ(§6)。本書はこれらの実装側確定。E12 と齟齬が出た点は変更せず §5 に修正提案として記載 |
| E2(対戦 AI) | E1 → E2 | AI は本エンジンの候補生成器・合法手判定・ルールチェーン参照(§2.9)の上でプレーする。E02 §3.1(c) が要求する `SimulationApi` は §2.12 で契約に含めた。`simulate` ハーネス(§4.3)の random-legal ボットが AI の最小実装例を兼ねる |
| E3(マルチプレイ) | E1 → E3 | エンジンはトランスポート非依存の `GameAction` / `PublicGameEvent` / `PlayerSnapshot`(§2.7)を定義し、E3 はそれを `PlayerRoomView`(E03 §2.3)に組み込んで運ぶ。席番号(`SeatId`)と `PlayerId` の対応・切断・代打ちは E3 の責務(代打ちは E2 のロジックを呼ぶ)。エラーコードの対応は §3.2(d) |
| E7(codex パイプライン) | E1 → E7 | ルール契約 v1(§3.5)と CI 用シミュレーションハーネス(§4.3)を提供する。フック発火タイミング表(§2.5)は codex プロンプトの素材になる。契約 v1 で表現できない提案の却下区分は §5.3(E7)に引き継ぐ |
| E8/E9(評価・優先順位) | E1 → E8/E9 | セット単位でルールチェーンを固定する構造(§2.4)が評価の紐付け単位。Effect 競合解決と「発動した」の述語は **E09 §2.4 が確定版を所有**し、本書 §2.5 はその実装仕様(齟齬時は E09 が正)。セット終了時の `game_sets` / `set_participants` / `set_rules` への書込み素材は §5.3(E8) |
| E11(ルール閲覧) | E1 → E11 | スナップショットに有効ルール名一覧を含める(§2.7)。画面 4 のデータ源 |

### 1.4 用語(初出定義)

- **ゲーム**: 配札からあがり順確定までの 1 局。**セット**: 同一メンバーで連続する 3 ゲーム(企画書 §3.4)。
- **場(トリック)**: 直前に出されたプレイが乗っている領域。**場が流れる**: 場のカードが捨て札へ移り、次の**リード**(場が空の状態で最初に出すこと)に移ること。
- **プレイ**: 手番でカードの組を出す行為。**パス**: 手番で出さない宣言。
- **フック**: ルールモジュールがエンジンの特定タイミングに差し込む関数(E12 §4.6(2))。**Effect**: フックが返す宣言的な作用。エンジンだけが Effect を状態に適用する。
- **アクティブプレイヤー**: まだあがっても退場してもいないプレイヤー。
- **順位(Standing)** と **称号(Title)**: 順位は 1〜4 の数値、称号は大富豪/富豪/貧民/大貧民の表示名。E12 §4.6(2) の `forceRank` の `Rank` は本書の `Standing` に相当する(カードのランクとの衝突を避ける改名。§5 に提案として記載)。

## 2. Epic 横断の技術仕様

### 2.1 設計原則

1. **エンジンは純粋関数**: `reduce(state, action) → { state, events }` 形式のリデューサ(状態と入力から次状態を計算する純粋関数)を核にする。乱数はシード付き RNG の状態を `state` 内に持ち回る(§2.6)。
2. **基本ルールはエンジン本体に固定実装**する。プラグイン化するのは追加ルール(提案ルール)のみ。基本進行までプラグインにすると「全部が外せる」ことになり、失敗時のフェイルセーフ(§2.5.5)の土台が消えるため。8切り・革命などの既知ルールは、契約の検証用**フィクスチャルール**としてテスト内にのみ実装する(GE-04)。
3. **ルールは Effect でしか状態に触れない**(E12 §4.6(2) の一方向性)。エンジン内部でも、フック由来の状態変更は必ず Effect 適用器(§2.5.4)を通す。
4. **観測可能な状態はスナップショット経由のみ**: クライアントに渡る情報は `PlayerSnapshot`(§2.7)の型に載るものだけ。手札秘匿は redact(秘匿情報の削除)関数の型で保証する。

### 2.2 ゲーム状態のデータモデル(TypeScript 型定義)

> **開発者レビュー反映(2026-07-25): 状態モデルを「config 外出し + 3 分割」に再構成する。** 以下を新しい正とし、本節の旧 `GameState` 定義は対応表で読み替える(実装時に本節全体を書き直す)。
>
> **(1) 静的な設定の外出し** — ゲーム開始前に確定しゲーム中は不変のものを `GameConfig` として分離し、リデューサの独立引数にする(`reduce(config, state, action)`)。`ReplayInit` は実質 `GameConfig` そのものになる。
>
> **(2) `GameState` はトップレベルを public / private / players の 3 つに分割** — 「誰に見せてよいか」を型構造で保証する。スナップショット生成は `{ ...config公開部, ...public, me: players[自分], others: players から枚数のみ導出 }` となり、`private` は**型ごと配信対象外**(E03 の allow-list `viewFor()` の構造的裏付け)。
>
> ```ts
> // ゲーム開始前に確定・ゲーム中不変(リプレイの ReplayInit 相当)
> export interface GameConfig {
>   gameIndex: number;            // セット内の何戦目か
>   seats: PlayerId[];            // 席順(時計回り)
>   gameSeed: Seed;               // setSeed から導出(§2.6)
>   ruleChain: RuleChainEntry[];  // セット開始時に固定されたチェーン(SetState と共有)
> }
>
> export interface GameState {
>   public: PublicGameState;                  // 全員に公開してよい
>   private: PrivateGameState;                // エンジン専用。誰にも配信しない
>   players: Record<PlayerId, PlayerState>;   // 各プレイヤー本人にのみ配信
> }
> ```
>
> | 旧 GameState のフィールド | 移動先 | 理由 |
> |---|---|---|
> | `gameIndex`・`seats` | **config** | ゲーム中不変 |
> | `phase`・`direction`・`turn`・`field`・`discard`・`standingsTaken`・`history`・`firedRules`・`turnCount` | **public** | 全員に公開してよい進行情報(`direction` は reverseTurnOrder で変わるため config ではなく public) |
> | `excluded`(退場者の手札処分先)・`memory`(ルール KV。E12 §4.3 でクライアント非配信確定)・`rng`・`hookCalls` | **private** | 非公開情報および エンジン内部状態。配り切りのため山札はないが、「手札以外の非公開ゾーン」はここに集約する(将来の伏せ札系ルールの置き場もここ) |
> | `players`(各人の手札等) | **players** | 本人にのみ配信。他人へは `handCount` 等の導出値だけ |
>
> **(3) §2.5 への追記論点(開発者コメント、2026-07-25)**: 逐次適用の意味論は一旦 OK とするが、**「同じきっかけを食い合うルールの排他」は今後の検討課題**。例: 8切りと「8渡し」が両方有効なとき、現行の競合キー意味論では Effect が異なるため両方発動するが、体験としてはどちらか一方が分かりやすい。一方で同時発動してよい組み合わせも確実にある。「Effect の競合(現行の競合キー)」とは別レイヤーの「**トリガの排他**」という概念が要るかを、実例が増えた時点で E9 と共同で再検討する(ルール追加に伴い柔軟に見直す)。

`packages/core` の公開型。コードは骨子であり、フィールド名・型は実装の規範とする(変更時は本書を更新)。

```ts
// ---------- カード ----------
export type Suit = "spade" | "heart" | "diamond" | "club";
export type CardRank =
  | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10"
  | "J" | "Q" | "K" | "A" | "2";
export type CardId = string; // 例 "S03"(スペード3), "JK0"(ジョーカー0)。54 枚で一意

export type Card =
  | { kind: "natural"; id: CardId; suit: Suit; rank: CardRank }
  | { kind: "joker"; id: CardId; index: 0 | 1 };

// ---------- 強さ ----------
/** 弱い順のランク列。基本ルールでは ["3","4",...,"A","2"]。革命系ルールが反転させる */
export interface StrengthOrder {
  ranking: CardRank[];        // 弱 → 強
}
// 2026-07-30 改訂: 予約していた jokerSingleTop は採用しない。単騎ジョーカー最強は
// compareRanks が 'joker' を +∞ として扱うエンジン固定の規則とし(safe-port の
// StrengthOrder 検証を変えないため)、例外(スペ3返し等)は modifyLegality で表現する。

// ---------- プレイ ----------
export type PlayKind = "single" | "set" | "sequence";
// 2026-07-30 改訂: "sequence"(階段)は engineFeatures 'sequence' の宣言で有効化される
// エンジンネイティブの手型として導入済み(§2.9)。ルールが任意の手型を追加する仕組みはない

export interface Play {
  kind: PlayKind;
  cards: Card[];                     // 実カード(ジョーカー含む)
  count: number;                     // cards.length
  repRank: CardRank | "joker";       // 代表ランク(強さ比較用)。ジョーカーのみ構成なら "joker"
}

// ---------- プレイヤー・順位 ----------
export type PlayerId = string;       // ルーム層(E3)が払い出す安定 ID
export type Standing = 1 | 2 | 3 | 4;
export type Title = "大富豪" | "富豪" | "貧民" | "大貧民";
export const TITLE_BY_STANDING: Record<Standing, Title> = {
  1: "大富豪", 2: "富豪", 3: "貧民", 4: "大貧民",
};

export type PlayerStatus = "active" | "finished" | "retired";
// finished: 手札を出し切ってあがった / retired: forceRank 等で退場させられた(§2.10)

export interface PlayerState {
  id: PlayerId;
  hand: Card[];                      // 権威状態。スナップショットでは本人以外 redact
  status: PlayerStatus;
  standing?: Standing;               // status !== "active" のとき必須
  skipCount: number;                 // skipTurns Effect の残回数
}

// ---------- 場 ----------
export interface FieldState {
  current?: { play: Play; by: PlayerId };  // undefined = 場が空(リード待ち)
  passedSinceLastPlay: PlayerId[];         // 最新プレイ以降にパスしたプレイヤー
                                           //   (skipTurns の消化もパスとして加える。BR-8・§2.5.1 手順 9)
}

// ---------- ルール KV メモリ(§2.8) ----------
export type JsonValue =
  | null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };
export type RuleId = string;
export type RuleMemory = Record<RuleId, Record<string, JsonValue>>;

// ---------- ゲーム状態 ----------
export type GamePhase = "awaitingPlay" | "finished";
// dealing は同期処理で完結するため観測可能フェーズには置かない(§2.4)

// 【旧定義】§2.2 冒頭の決定ブロック(2026-07-25)の「config 外出し + 3 分割」へ再配置される。
// フィールドの意味・コメントは引き続き有効(移動先は決定ブロックの対応表)。
export interface GameState {
  gameIndex: number;                 // セット内の何戦目か(0 始まり)→ config へ
  phase: GamePhase;
  seats: PlayerId[];                 // 席順(時計回り)。ゲーム間で不変
  direction: 1 | -1;                 // 回り順(reverseTurnOrder で反転)
  turn: PlayerId | null;             // phase === "awaitingPlay" のとき非 null
  players: Record<PlayerId, PlayerState>;
  field: FieldState;
  discard: Card[];                   // 場流れで積まれたカード(全て公開済み情報)
  excluded: Card[];                  // 退場者の手札処分先(非公開ゾーン。§2.10)
  standingsTaken: Standing[];        // 使用済み順位スロット
  memory: RuleMemory;                // ゲームスコープ KV(ゲーム終了で破棄)
  history: PublicGameEvent[];        // このゲームの公開イベント列の全量(§2.7.1。GameView.history と
                                     //   スナップショット全量履歴(E03 §2.3)のデータ源)
  firedRules: RuleId[];              // 「発動した」と判定済みのルール(E09 §2.4(7) の述語。§2.5.7)
  hookCalls: Record<string, number>; // "ruleId:hook" → 権威リデューサでの通算呼出し回数(§2.6 の乱数導出用)
  turnCount: number;                 // 消化した手番数(強制終局ガード §4.1 用)
  rng: RngState;                     // シード乱数の現在状態(§2.6)
}
// GameState は JSON 値のみで構成する(関数・class インスタンス・Date を含めない)。
// リプレイ(§2.6)と AI isolate への持ち込み(§2.12 serialize)の前提であり、§4 の不変条件に含める。

// ---------- セット状態(GE-05) ----------
export interface SetConfig {
  gamesPerSet: number;               // 既定 3。調整余地(企画書 §3.4)のため定数化しない
  interimAutoAdvanceMs: number;      // 簡易リザルトの自動進行待ち。既定 15000
}

export interface SetMember {
  id: PlayerId;
  displayName: string;
  isAI: boolean;                     // AI 構成もセット内で不変(企画書 §3.4)
}

export interface GameResult {
  gameIndex: number;
  standings: { player: PlayerId; standing: Standing; title: Title }[];
  firedRuleIds: RuleId[];            // このゲームで「発動した」ルール(E09 §2.4(7) の述語で判定。§2.5.7。
                                     //   E8 の set_rules.did_fire と EV-02 の投票対象の素材)
}

export type SetPhase =
  | { name: "gameInProgress"; gameIndex: number }
  | { name: "interimResult"; gameIndex: number }   // 第 1..N-1 戦の後
  | { name: "setResult" };                          // 第 N 戦の後

export interface SetState {
  setId: string;
  config: SetConfig;
  phase: SetPhase;
  members: SetMember[];
  ruleChain: RuleChainEntry[];       // セット開始時に固定(E12 §4.6(4))
  setSeed: string;
  results: GameResult[];             // 終了済みゲームの結果 = ctx.setHistory の実体
  setMemory: RuleMemory;             // セットスコープ KV(セット終了で破棄)
  currentGame: GameState | null;
}

export interface RuleChainEntry {
  ruleId: RuleId;
  name: string;
  position: number;                  // 0 = 最高優先。E09 §2.1 のチェーン position と同一
  priority: PriorityKey;             // (popularityScore 降順, activatedAt 昇順, ruleId 辞書順)。E09 §2.2。
                                     //   ルールコードは自分の優先度を知らない
  bundleHash: string;                // 実行バンドルの内容ハッシュ(リプレイの固定に使う §2.6)
  contractVersion: number;
}
// PriorityKey・comparePriority は E09 §2.2 が所有する(packages/core/src/priority/)。
// E1 は position 済みのチェーンを受け取るだけで、整列は E9 のレジストリ仕様(E09 §2.3)に従う。
```

**ゾーンの全域性(カード保存)**: 任意の時点で、54 枚のカードは「各プレイヤーの `hand`」「`field.current`」「`discard`」「`excluded`」のいずれか 1 か所だけに属する。これは §4 の不変条件テストの第一項になる。

### 2.3 エンジンのモジュール構成

```
packages/core/src/
├─ cards/
│  ├─ card.ts          # Card / Suit / CardRank / CardId、54 枚の定義
│  ├─ deck.ts          # デッキ生成・シャッフル(Fisher–Yates、rng 注入)・配札
│  └─ strength.ts      # StrengthOrder、基本順序定数、強さ比較
├─ play/
│  ├─ play.ts          # Play、カード組 → Play への解釈(ジョーカー代用の代表ランク推定)
│  ├─ candidates.ts    # 合法手候補の生成器(§2.9)。PlayKind ごとの生成器レジストリ
│  └─ legality.ts      # 基本ルールの合法判定 + modifyLegality チェーン適用
├─ engine/
│  ├─ reducer.ts       # reduceGame(state, action, chain) → { state, events }
│  ├─ turn.ts          # 次手番計算(direction・skip・非アクティブのスキップ)
│  ├─ finish.ts        # あがり判定・順位スロット割当・退場処理(§2.10)
│  ├─ effects.ts       # 採用済み Effect の適用(§2.5.4)。競合解決は priority/ を呼ぶ
│  └─ failsafe.ts      # ルール起因の進行不能に対する保護(§2.5.5)
├─ priority/           # E09 が仕様を所有(E09 §3.1(c)): comparePriority / PriorityKey /
│                      #   resolveEffectBatch(競合解決)/ applyTransformChain / conflictKeyOf
├─ set/
│  ├─ set-reducer.ts   # reduceSet(state, action, chain):ゲーム跨ぎの進行(§2.4)
│  └─ scoring.ts       # セット総合順位の算出(GE-05)
├─ rules/
│  ├─ contract.ts      # RuleModule / RuleHooks / Effect / RuleContext / Legality(契約 v1)
│  ├─ chain.ts         # RuleChainPort(下記)とチェーン呼び出し順の実装
│  └─ memory.ts        # KV メモリの読み書き・スコープ・クォータ(§2.8)
├─ rng/rng.ts          # シード付き決定的 RNG(§2.6)
├─ replay/replay.ts    # 対局ログ(JSONL)形式とリプレイ実行(§2.6)
├─ snapshot/snapshot.ts# PlayerSnapshot 生成(redact 含む。§2.7)
├─ sim/simulate.ts     # シミュレーションハーネス(§4.3。CI が使用)
└─ index.ts
```

**サンドボックスとの境界 — `RuleChainPort`**: core は純粋でありサンドボックス(QuickJS)を直接は持てない。そこで core は同期インターフェースを定義し、実装は呼び出し側が注入する:

```ts
// packages/core/src/rules/chain.ts
export interface RuleChainPort {
  /** チェーン(優先度つき有効ルール列)に対する各フックの一括呼び出し。
   *  実装は server(QuickJS ホストブリッジ)/ テスト(プロセス内実行)が提供する */
  modifyLegality(entries: RuleChainEntry[], ctx: RuleContext, plays: Play[], base: Legality[]):
    { results: Legality[]; influenced: RuleId[] };
  modifyStrength(entries: RuleChainEntry[], ctx: RuleContext, base: StrengthOrder):
    { result: StrengthOrder; influenced: RuleId[] };
  collectEffects(
    hook: "afterPlay" | "afterFieldClear" | "onGameStart" | "onGameEnd",
    entries: RuleChainEntry[], ctx: RuleContext, arg?: Play | Standings,
  ): { ruleId: RuleId; effects: Effect[] }[];
}
```

- `modifyLegality` が **`plays: Play[]`(候補の配列)を一括で受ける**点は E12 §6 の緩和策 2(isolate 内一括評価)を契約レベルで固定するもの。1 候補ずつのホスト⇔isolate 往復を禁止する。
- **`influenced`**: 変換フックの適用中、あるルールの出力が入力と異なった(deepEqual 不一致)場合にそのルール ID を返す。E09 §2.4(1) `applyTransformChain` の差分検出をポート契約に載せたもので、検出は isolate 内で各ルール適用ごとに行い、境界越え回数は増やさない。「発動した」判定(§2.5.7)の入力になる。
- ルール実行時の例外・上限超過はポート実装側(server)が捕捉し、「そのルールをチェーンから外して続行 + 記録」(E12 §4.8。E09 §2.3-4 のとおり除去のみで、残るルールの相対順序は変えない)。core はポートが常に値を返す前提で書ける。

### 2.4 ターン進行ステートマシン

観測可能な状態(スナップショットに現れる phase)を最小にし、途中処理はリデューサ内で同期的に畳み込む。

**ゲーム内(`reduceGame`)**:

```
[配札(同期処理)]
      │ gameStarted
      ▼
awaitingPlay ──(play/pass 受理: §2.5 の手順で処理)──┐
      ▲                                              │
      └──── 次手番を決めて戻る(ゲーム継続時)◄──────┘
                                                     │ アクティブが 1 人以下になった
                                                     ▼
                                                  finished
```

**セット(`reduceSet`)**(GE-05 の中核。N = `config.gamesPerSet`、既定 3):

```
セット開始(ルールチェーン固定・setSeed 決定)
      │ onGameStart フック → 第 1 戦へ
      ▼
{gameInProgress, i} ──ゲーム finished──► onGameEnd フック → results[i] 確定
      │                                        │
      │                                        ├─ i < N-1 ──► {interimResult, i}(画面 5a)
      │                                        │                   │ advance アクション
      │                                        │                   ▼
      │◄─── 配札して第 i+1 戦開始(onGameStart)┴───────────────────┘
      │
      └─ i = N-1 ──► {setResult}(画面 5b)
                        │「もう 1 セット」→ 新しい SetState を生成(§3.4)
                        └「ホームへ」→ 解散(部屋のライフサイクルは E3)
```

- `interimResult` から次戦への遷移は `{ type: "advance" }` アクションで行う。**タイマーは I/O なのでエンジンは持たない**。server が `interimAutoAdvanceMs`(既定 15 秒・MP-03 の仮値)後に `advance` を投入する。server は確定した終了時刻も snapshot に含め、画面 5a の残量バーと遷移を同じ時計に従わせる。
- 配札・あがり処理などの中間状態は 1 回のリデュース内で完結させ、フェーズとして観測させない。クライアントの演出(配る動き等)はイベント列から再構成する。

**アクション型**:

```ts
export type GameAction =
  | { type: "play"; player: PlayerId; cards: CardId[]; kind?: PlayKind } // kind は将来の曖昧手用の予約。v1 では省略
  | { type: "pass"; player: PlayerId };

export type SetAction =
  | GameAction
  | { type: "advance" };            // interimResult → 次戦(server タイマーが投入)
```

### 2.5 ルールフックの発火順序と Effect 適用アルゴリズム

#### 2.5.1 手番 1 回の処理手順(正規順序)

`play` アクション受理時、リデューサは以下を**この順で**実行する。

1. **前提検査**: `phase === "awaitingPlay"` か、`action.player === turn` か。違反は拒否(状態不変・エラーイベントのみ)。
2. **プレイ解釈**: `cards`(CardId 列)を手札と照合し `Play` に解釈する。手札にないカード・成立しない形は拒否。
3. **合法性判定**:
   a. エンジンが基本ルール上の合法性を判定する(§3.1 の基本ルール + 現在の `StrengthOrder`)。強さ比較に先立ち `modifyStrength` チェーンを適用する(**優先度の低い順**に適用し、高優先度が後から上書き。E12 §4.6(3)・E09 §2.4(1))。
   b. `modifyLegality` チェーンを適用する(同じく低 → 高の順)。最終 `Legality` が `legal: false` なら拒否(`reasonKey` をエラーイベントに載せる)。
   c. この経路(**権威判定**)での変換フックの `influenced`(§2.3)を `GameState.firedRules` の判定材料として記録する(§2.5.7)。AI の照会(§2.12)は権威判定ではないため記録しない。
4. **プレイ適用**: カードを手札 → 場へ移動。`field.passedSinceLastPlay` をクリア。`played` イベント。
5. **あがり判定**: 手札が 0 になったら、その場で順位スロットの空き最上位を割り当て `status = "finished"`(§2.10 の割当規則)。`playerFinished` イベント。**この確定は手順 6 のフックから `ctx` 経由で見える**(都落ちの発火条件。E12 §4.6(2))。
6. **afterPlay フック**: 全ルールから Effect を収集 → 競合解決(§2.5.3)→ 適用(§2.5.4)。採用された `clearField` はこの時点では**場流れ予約フラグを立てるだけ**で、場のカードはまだ動かさない(移動とイベントは手順 8 に一元化)。
7. **ゲーム終了判定**: アクティブが 1 人以下なら残者に残スロットを割り当て、`onGameEnd` フック(許可 Effect は表 §2.5.6 のとおり限定)→ `gameEnded` イベントで `finished` へ。以降の手順は行わない。
8. **場流れ判定**: 手順 6 で場流れ予約フラグが立ったか、または自然条件(BR-8: 最後に出した者以外の全アクティブが連続パス — play 直後は該当しない)なら、**ここで**場 → 捨て札へ移動し `fieldCleared` イベント(場の実移動はこの手順でのみ起きる)。続けて **afterFieldClear フック**(収集 → 解決 → 適用。ここでの `clearField` は場が空なので no-op)。
9. **次手番決定**: `direction`・`skipCount`・非アクティブのスキップを反映して次の手番者を決める(§2.10)。`skipCount` の消化はパスとして扱い `field.passedSinceLastPlay` に加える(BR-8。E09 §3.1(b) トレース 3 のようなスキップ系ルールとの相互作用)。スキップ消化の結果として全員パス条件(BR-8)が成立した場合は、その場で手順 8 へ戻って場流れを処理してから次手番を決め直す。場が流れた場合のリードは「最後に出した者。その者が非アクティブなら、そこから回り順で次のアクティブ」。リード者自身が `skipCount` を持つ場合もスキップは消化され、リード権はそこから回り順で次のアクティブへ移る。`turnChanged` イベント。
10. **スナップショット生成・配信**(配信自体は server の仕事。エンジンは全員分の `PlayerSnapshot` を返す)。

`pass` アクションは 1 → (合法性: リードでのパスは禁止 §3.1)→ `passed` イベント → 場流れ判定(全員パス条件)→(流れたら afterFieldClear)→ 次手番 → スナップショット、の順。**パスでは afterPlay は発火しない**(パスはプレイではない。パス起点のルールは契約 v1 の対象外。§5)。

#### 2.5.2 フック発火タイミング一覧(codex プロンプト素材)

E12 §4.6(2) の要請に基づく確定表。この表は契約ドキュメントとして `packages/core/src/rules/contract.ts` の doc コメントにも転記し、E7 が codex プロンプトへ埋め込む。

| フック | 発火タイミング | 典型ルール | 備考 |
|---|---|---|---|
| `modifyLegality` | 合法性判定のたび(プレイ検証・候補列挙 §2.9・AI 照会) | 縛り、あがり禁止系(2 あがり禁止) | 候補配列を一括で受ける。**状態を変えられない**(判定のみ) |
| `modifyStrength` | 強さ比較の前(合法性判定・候補列挙に内包) | 革命(`ctx.memory` の発動状態を見て反転) | 判定のみ |
| `afterPlay` | プレイ適用・あがり確定の**後**(手順 6) | 8切り(`clearField`)、都落ち(1 位確定を見て `forceRank`)、革命の発動記録(`setMemory`) | あがり確定済みの順位が `ctx` から見える |
| `afterFieldClear` | 場が流れた直後(自然流れ・Effect 起因の両方) | 「流れたら次は縛り解除」系の記録 | ここでの `clearField` は no-op |
| `onGameStart` | 配札直後・第 1 手番の前 | ゲーム開始時の宣言・(将来)献上系 | 都落ちをここで書くのは**誤り**(E12 §4.6(2)) |
| `onGameEnd` | 全順位確定直後 | ゲームまたぎの記録(`setMemory` の set スコープ) | 状態変更系 Effect はほぼ無効(表 §2.5.6) |

Effect を返す 4 フックの `ctx.game.strength` は、同じ状態に
`modifyStrength` チェーンを適用した実効 `StrengthOrder` とする。
`afterPlay` には、そのプレイの合法性判定で実際に使った
「プレイ直前」の実効順序を渡す。これにより、革命状態そのものを
ルール間共有 KV にせず、他ルールは合成済みの強さ順から革命相当の
共有シグナルを読める。

#### 2.5.3 Effect の競合解決(E09 §2.4 の実装)

「矛盾する Effect は最高優先度のみ採用」(E12 §4.6(3))の確定版は **E09 §2.4(3)〜(5) が所有する**。本節はエンジン側の実装仕様であり、齟齬があれば E09 が正。解決関数 `resolveEffectBatch` は E09 §3.1(c) のとおり `packages/core/src/priority/` に置かれ、エンジンはフック発火位置でそれを呼ぶ。

1. **収集**: 実装ルールを優先度降順に呼び、`(ruleId, position, effectIndex, effect)` として集める。**バッチ内の全ルールは同一の不変状態ビューを受け取り、互いの Effect や `setMemory` を見ることはできない**(E09 §2.4(2)・§5.3-1。呼び出し順はログの安定性のためだけに固定する)。1 ルールが同一フックで返せる Effect は最大 8 件(超過分は rejected + 記録。エンジン側ガード)。
2. **ルール内前処理**: 同一ルールが同一の静的競合キーへ複数 Effect を返した場合、`effectIndex` の大きい方(後の文)を残し、先行を `superseded`(ルール内上書き)にする(E09 §2.4(4) 手順 2)。
3. **競合キーによるグループ化と裁定**(E09 §2.4(3) の競合キー表に従う):

| Effect | 競合キー(E09 表記) | 同一ペイロード時 | ペイロード相違時 |
|---|---|---|---|
| `clearField` | `"field"` | `deduped`(場は 1 回だけ流れる) | (ペイロードなし) |
| `skipTurns` | `"turn:{player}"` | `deduped` | 矛盾 → 最高優先を `adopted`、他は `rejected`(回数は合算しない) |
| `reverseTurnOrder` | `"turnOrder"` | `deduped`(反転は 1 回だけ。パリティ累積させない) | (ペイロードなし) |
| `forceRank` | `"rank:{player}"` | `deduped` | 矛盾 → 最高優先のみ `adopted` |
| `moveCards` | 動的: 全 `moveCards` のセレクタをバッチ共通ビューで**具象カード集合へ解決**(§2.12 の `resolveCardSelector`)し、集合が推移的に重なるものを union-find で 1 グループにまとめる。ログ上のキーは `cards:{具象 CardId 昇順連結}` | グループ内は最高優先ルールの分(同一ルールの複数 move は配列順すべて)を `adopted`、他ルール分を `rejected`。重ならなければ全部 `adopted` | 同左 |
| `setMemory` | `"memory:{ruleId}:{key}"` | 自ルールの KV にしか書けない(§2.8)ためルール間競合は構造上ない。ルール内重複は手順 2 の `superseded` | 同左 |
| `announce` | なし | 競合しない。次項の抑制規則のみ適用 | — |

4. **announce の抑制**(E09 §2.4(5)): あるルールの `announce` は、同バッチ内にそのルールの「`adopted` または `deduped` の非 announce Effect」が 1 つ以上あるとき、またはそのルールの返却が announce のみだったときに採用する。非 announce がすべて `rejected` のときは `suppressed-announce` として棄却する(作用が実現していないのに「発動!」と表示される嘘を防ぐ)。
5. **記録**: 全 emission に resolution ステータス(`adopted` / `deduped` / `rejected` / `superseded` / `suppressed-announce`)を付け、`effectApplied` / `effectRejected` イベントとしてエンジンの戻り値に含める(PR-01 の受け入れ条件・CX-06 の情報源)。server はこれを構造化ログ(全バッチ)と `conflict_events`(競合・重複・抑制が起きたバッチのみ)の二層に書く(E09 §3.1(c))。

**Effect 語彙を追加するときは、この競合キー表(= E09 §2.4(3))への行追加を契約ドキュメントの必須手順とする**(E09 §5.3-4)。実装は `conflictKeyOf(effect, resolvedCards)` の exhaustive switch(default 節 `never` 検査)とし、キー未定義の新語彙はコンパイルエラーで落とす。

#### 2.5.4 Effect 適用アルゴリズム

採用(`adopted`)された Effect は **`(position 昇順, effectIndex 昇順)`**(= 優先度の高いルールから、各ルールが返した配列順)で逐次適用する(E09 §2.4(4) 手順 6・(6))。適用は決定的で、途中で他フックを再帰的に呼ばない。**契約 v1 の語彙ではカスケードは構造的に最大 1 段**(afterPlay → 場流れ → afterFieldClear のみ。afterFieldClear 内の `clearField` は no-op なので再連鎖しない)。E09 §2.4(6) の連鎖深さ上限(暫定 8)は将来の語彙拡張に備えた安全弁として実装するが、v1 では到達しない(§5.3 の E9 への連絡事項)。各 Effect の適用意味論:

| Effect | 適用 |
|---|---|
| `clearField` | **場流れ予約フラグを立てるのみ**。場 → 捨て札の実移動と `fieldCleared` イベントは §2.5.1 手順 8 に一元化(移動時点の二重定義を避ける) |
| `skipTurns` | 対象の `skipCount += count`(count は 1〜3 に clamp。過大値は縮めて記録)。消化時はパス扱い(§2.5.1 手順 9・BR-8) |
| `reverseTurnOrder` | `direction` を反転 |
| `forceRank` | §2.10 の退場・再割当処理 |
| `moveCards` | 解決済みの具象カード集合をゾーン間で移動。解決不能(既に無い等)は no-op + 記録。`cardsMoved` イベントを積む — **可視性**: `field` / `discard` が絡む移動はカード面公開、`hand` → `hand` は全員には枚数のみ公開(札面は当事者のスナップショットにのみ現れる。§2.7.1・E02 §6-8 への回答は §5.3) |
| `setMemory` | §2.8 のスコープ・クォータ検査のうえ書込み |
| `announce` | 状態は変えず `ruleFired` イベントを積む(画面 3 の発動バナー・ログ、5b の発動ルール一覧の表示素材。抑制済み announce はイベントにならない) |

#### 2.5.5 フェイルセーフ(ルール起因の進行不能への保護)

提案ルールは合法性を歪められるため、エンジン自身が進行保証を持つ:

- **リード手詰まり保護**: リード(場が空)で候補手が 0 件になった場合、`modifyLegality` チェーンの結果を無視して**基本ルール上の合法手を許可**する。発生を `failsafe` イベントで記録し、server は該当ルールの特定材料として E10/CX-04 へ流す。
- **強制終局ガード**: `turnCount` が上限(既定 1000。§4.1)を超えたらゲームを強制終了し、未確定プレイヤーへ残り手札枚数の昇順(同数は席順)で残スロットを割り当てる。本番での発生は想定外(発生 = ルール不具合)であり、CI シミュレーション(§4.3)ではこのガード発動自体を失敗として扱う。

#### 2.5.6 フック × Effect 許可表

フックの文脈で意味を持たない Effect は**棄却して記録**する(例外は投げない。生成ルールの誤りでゲームを止めないため)。

| Effect \ フック | afterPlay | afterFieldClear | onGameStart | onGameEnd |
|---|---|---|---|---|
| clearField | ○ | ×(no-op) | ×(場が空) | × |
| skipTurns | ○ | ○ | ○ | × |
| reverseTurnOrder | ○ | ○ | ○ | × |
| forceRank | ○ | ○ | ○(奇習的だが意味は定義される) | × |
| moveCards | ○ | ○ | ○ | × |
| setMemory | ○ | ○ | ○ | ○(**set スコープのみ**。game スコープは破棄直前のため棄却) |
| announce | ○ | ○ | ○ | ○ |

#### 2.5.7 「発動した」の判定(E09 §2.4(7) の実装)

`GameState.firedRules` / `GameResult.firedRuleIds` に載せる「発動した」の述語は E09 §2.4(7) の確定どおり:

> ルール R がゲーム G で発動した ⇔ (1) G のいずれかの Effect バッチで R の非 announce Effect が **`adopted` または `deduped`** になった、または (2) R の返却が announce のみのバッチでその announce が `adopted` になった、または (3) G 中の**実際に行われたプレイの権威判定**で R の変換フックの出力が入力と異なった(ポートの `influenced`。§2.3)。

- `rejected` しかないルールは発動に数えない(プレイヤーは作用を目撃していない)。
- (3) は権威判定経路(§2.5.1 手順 3)のみ。AI の探索照会(§2.12)・スナップショット用の候補列挙で `influenced` が返っても記録しない(E09 §5.3-5)。
- エンジンはこの述語をリデューサ内で評価して `firedRules` に積み、`gameEnded` 時に `GameResult.firedRuleIds` へ確定する。**消費者**: E8 の `set_rules.did_fire`(3 戦の OR。E08 §2.1)、EV-02 の投票対象、画面 5b の発動ルール一覧、CX-06。書込み素材の受け渡しは §5.3(E8)。
- 発動バナー(`ruleFired` イベント)は announce 採用時のみ出るのに対し、発動判定は (1)(3) を含むため**バナーなしで発動扱いになるルールがある**(変換系)。これは E09 が意図した仕様(常時変換系ルールが評価対象から漏れる穴を塞ぐ)。

### 2.6 決定性(シード乱数・リプレイ)

**目的**: 同じ初期条件と同じアクション列から常に同一の状態列を再現できること。生成ルールのバグ調査(E12 §4.6(2))と CI シミュレーションの再現性の土台。

- **RNG**: `splitmix`/`mulberry32` 系の 32bit 決定的 PRNG を自前実装(依存を増やさない・全実行環境で同一結果)。`RngState` は数値のみで JSON 化可能。
- **シードの導出**: セット生成時に server が `setSeed`(乱数文字列)を 1 個だけ発行する。以降はすべて決定的に導出する:
  - `gameSeed = hash(setSeed, gameIndex)` — 各ゲームのシャッフル・エンジン乱数の種。
  - **ルール向け乱数**: `ctx.rng` は `hash(gameSeed, ruleId, hookName, invocationIndex)` で初期化されたルール専用ストリーム。`invocationIndex` はそのルール・フックの通算呼出し番号で、`GameState.hookCalls`(キー `"ruleId:hook"`。§2.2)として状態に持ち回る。**数え方の規約**: (i) カウントするのは**権威リデューサ内の呼出しのみ**(AI 照会は複製状態上で行われ、複製内のカウンタだけが進む。権威状態には影響しない。§2.12)。(ii) ポートの一括呼び出し(§2.3)は**バッチ 1 回 = 1 呼出し**(候補数分ではない)。(iii) 同一局面の判定キャッシュ(§2.9)にヒットした場合はカウントしない(キャッシュの有無で乱数列が変わらないようにするため)。
  - この導出の性質: **乱数シードの導出がルール間で結合しない**(あるルールの乱数消費・呼出し回数が、他ルールのストリーム初期化に影響しない)。したがって**状態遷移列が同一である限り**、あるルールの有効/無効を切り替えても他ルール・エンジンの乱数列は不変であり、ロールバック検証(CX-04)とテストの独立性が保たれる。注意: 切り替えたルールが状態遷移そのもの(場流れ・手番など)を変える場合は、以降の呼出し回数・乱数列も当然変わる — 保証は「導出の独立性」であって「挙動の不変」ではない(GE-04 (f)-2 のテスト設計はこの前提に従う)。
- **対局ログ(リプレイ形式)**: エンジンは初期化レコードとアクションレコードを定義する。server はこれを JSONL でデバッグ出力できる(E12 §4.4「行動ログ出力は任意」に対応。永続化はしない)。

```ts
export interface ReplayInit {
  formatVersion: 1;
  engineVersion: string;             // packages/core のバージョン
  contractVersion: number;           // ルール契約バージョン(v1)
  setSeed: string;
  config: SetConfig;
  members: SetMember[];
  ruleChain: RuleChainEntry[];       // bundleHash を含む(同一コードでの再実行を担保)
}
export interface ReplayAction { seq: number; action: SetAction; }
// リプレイ = ReplayInit から SetState を再構築し、ReplayAction を順に reduceSet へ流すだけ
```

- **再現の前提条件**: 同一の `engineVersion`・`contractVersion`・`bundleHash` 群。ルールバンドルは内容ハッシュで固定される(E12 §4.6(4))ため、DB のバンドル置き場から当時のコードを取り出せば再現できる。ハッシュ不一致のときリプレイ実行器は警告を出して続行する(挙動差の調査自体が目的の場合があるため)。
- サンドボックスは `Date`・`Math.random` 等を遮断済み(E12 §4.8)なので、決定性を破る口はエンジン側の実装規律(`ctx.rng` 以外の乱数を使わない・オブジェクトキー列挙順に依存しない)に限られる。これは §4 の決定性テストで担保する。

### 2.7 スナップショット(per-player 状態ビュー)と合法手プレビュー

#### 2.7.1 含める公開情報の確定

E12 §4.3(全量スナップショット + イベント/手札秘匿・ルール KV 非配信は確定済み)を受け、含める情報を確定する。

```ts
export interface PlayerSnapshot {
  forPlayer: PlayerId;               // 誰向けのビューか
  setId: string;
  setPhase: SetPhase;
  gameIndex: number;                 // 「第 n 戦」表示(画面 3 アプリバー)
  gamePhase: GamePhase | null;
  turn: PlayerId | null;
  direction: 1 | -1;
  trickNumber: number;               // このゲームで何巡目の場(トリック)か。1 始まり・場流れごとに +1。
                                     //   history の fieldCleared 件数から導出(画面 3「第1戦(3巡目)」表示用)
  seats: PlayerId[];
  players: {
    id: PlayerId;
    displayName: string;
    isAI: boolean;                   // AI バッジ(画面 3/5a/5b)
    handCount: number;               // 他人は枚数のみ(画面 3「残り n 枚」)
    status: PlayerStatus;
    standing: Standing | null;
    title: Title | null;
  }[];
  hand: Card[];                      // 自分の手札のみ(強さ順ソート済み)
  field: { play: Play; by: PlayerId } | null;  // 場の最新プレイ(出されたカードはすべて公開情報)
  passedSinceLastPlay: PlayerId[];
  discardCount: number;              // 捨て札は枚数のみ(内容はプレイ履歴から自明のため冗長送信しない)
  excludedCount: number;             // 退場処分カードは枚数のみ(内容非公開 §2.10)
  legalMoves: Play[] | null;         // ★自分が手番のときのみ。他人の手番では null(§2.7.2)
  canPass: boolean;                  // リードではパス不可(§3.1)を UI に伝える
  strengthNote: { inverted: boolean };// 現在の強さ順が基本と逆か(革命系の表示用。詳細順序は送らない)
  setResults: GameResult[];          // セット内の済んだゲームの結果(画面 5a/5b)
  effectiveRules: { ruleId: RuleId; name: string }[];
                                     // 名前のみ(画面 4 / RV-01。人気度等は含めない §4.5)。
                                     // 並び順はチェーンの position 順 = 優先順位の高い順(E09 §3.1(c) の
                                     // 「対局中は set_rule_snapshots の position 順」と一致)
  history: PublicGameEvent[];        // 当該ゲームの公開イベント列の**全量**(GameState.history の写し。
                                     //   E03 §2.3 の再接続前提: 復帰時のログ再構築を全量履歴で自明にする)
}
```

直前の遷移で起きたイベント(演出の再生用)は、スナップショットとは別に `reduceGame` の戻り値 `events` として返し、E3 が `PlayerRoomView.events` に載せて配る(E03 §2.3: 演出用イベントは状態構築に使わず、復帰時の全量再送では空になる)。スナップショット側の `history` は状態の一部であり、常に全量。

**含めないもの(確定)**: 他人の手札の内容 / 山札(配り切りのため存在しない)/ `excluded` の内容 / ルール KV メモリ(game・set 両スコープとも。E12 §4.3 の秘匿持ち出し対策)/ シード・RNG 状態・`hookCalls` / ルールの優先度・人気度の数値(対局まわりの画面では出さない。企画書 §4.5)/ Effect の採用・棄却ログの詳細(resolution ステータスはサーバー内部記録とし、クライアントへは採用済み announce 由来の `ruleFired` のみ配る)。

`PublicGameEvent` は `GameEvent` から上記の非公開情報を除いた版。`played` / `passed` / `fieldCleared` / `ruleFired` / `playerFinished` / `playerRetired` / `cardsMoved` / `turnChanged` / `gameStarted` / `gameEnded` / `setEnded` を含む。`cardsMoved` は `{ by: RuleId; from: Zone; to: Zone; count: number; cardIds?: CardId[] }` で、`cardIds` は公開ゾーン(`field` / `discard`)が絡む移動のときのみ載せる(§2.5.4 の可視性)。`hand` → `hand` 移動の札面は当事者(移動元・移動先)の `hand` の変化としてのみ本人スナップショットに現れる。

#### 2.7.2 クライアント合法手プレビューの方式(E12 引き継ぎ (4) への回答)

**採用: サーバーが合法手集合をスナップショットに同梱する方式**(E12 §4.1 の代替案)。手番プレイヤー向けスナップショットの `legalMoves` に、候補生成(§2.9)+ ルールチェーン適用済みの合法 `Play` 全件を入れる。クライアントは計算せず、選択中カードが `legalMoves` のいずれかと一致するかだけを判定して「出す」ボタンとカードのグレーアウトを制御する。

理由:

1. **正確さが恒久的に保たれる**: 共有ロジックプレビューは提案ルールを知らないため、合法性介入ルールが増えるほどズレが拡大する(E12 自身が指摘)。フェーズ 2 の初日から縛り系ルールが入りうる以上、初期だけ共有ロジックで済ませても移行作業が前倒しで発生するだけ。
2. **サイズ・頻度が問題にならない**: 候補数は §2.9 の生成方式で高々数百件・数 KB。手番プレイヤー 1 人にしか載せず、ターン制で送信は手番ごと 1 回。
3. **クライアントが薄くなる**: web は `packages/core` から型とカード表示ユーティリティだけを使い、判定ロジックのバンドルを持たない。

トレードオフ: 手番が来るまで自分の出せる手が画面で分からない(手番外のカード選択の予行に正確なプレビューを出せない)。対局 UI は手番時のみ操作可能にする設計(画面 3)なので許容する。

この決定は E12 §4.1(初期は共有ロジック案)と E03 §2.3(「フェーズ 1 は非配信。`legalPlays?: CardId[][]` を予約」・§5.3-6)の記述と食い違うため、両文書への更新提案(**初期から同梱・型は `CardId[][]` でなく `Play[]`**)を §5.2 に記載する。

### 2.8 ルール KV メモリのスコープ区分(E12 引き継ぎ (1) への回答)

**採用: Effect のフィールドで区分する**(キー接頭辞方式は不採用)。

```ts
export type MemoryScope = "game" | "set";
// Effect(確定): { type: "setMemory"; scope: MemoryScope; key: string; value: JsonValue }
// 読み取り(確定): ctx.memory.game / ctx.memory.set(いずれも自ルール分のみの読み取り専用ビュー)
```

- 理由: 接頭辞方式(例: `"set:"` で始まるキー)は文字列規約であり、型検査で守れず codex の書き間違いが実行時まで検出されない。フィールド方式は契約の型(`scope` は union 型)で強制でき、判断基準「型による制約」(E12 §2-1)に合う。
- **スコープの実体**: `game` は `GameState.memory`(ゲーム終了で破棄)、`set` は `SetState.setMemory`(セット終了で破棄。次セットへは持ち越さない)。
- **分離**: ルールは**自ルールの名前空間しか読み書きできない**(`memory[ruleId]` のみ)。ルール間のデータ共有は契約 v1 では提供しない(共有は暗黙の結合を生み、単独ロールバック(CX-04)を壊すため)。革命相当の状態など、エンジンがすでに計算している派生概念は、Effect フックの `ctx.game.strength` のような合成済み読み取りビューで共有する。
- **クォータ**: 1 ルール・1 スコープあたりキー 32 個・値は JSON 文字列化で 1KB まで・名前空間合計 16KB まで。超過した `setMemory` は棄却 + 記録(ゲームは続行)。
- 都落ちが参照する「前ゲームの順位」は KV ではなく `ctx.setHistory`(エンジン提供)から読む(E12 §4.6(2) の確定を踏襲)。

### 2.9 合法手列挙 — 候補生成方式(E12 引き継ぎ (2) への回答)

**採用: 候補の生成はエンジン側の「候補生成器レジストリ」が握り、ルールは判定(`modifyLegality`)のみを担う。** ルールが候補を追加宣言できる仕組みは設けない。

- 理由: 部分集合列挙(手札 n 枚 → 最大 2^n)をサンドボックス内の任意コードに委ねると、生成量も計算時間も統制できず、AI の CPU 予算(E12 §6: 平常 50ms・上限 200ms)とスナップショット同梱(§2.7.2)の両方が壊れる。生成器をエンジンが持てば、候補数は**手の種類ごとの構造的な列挙**(下記)で多項式に抑えられる。
- **新しい手の種類(階段など)の追加 = エンジン拡張**であり、人手レビューの PR になる(E12 §4.6(1) の差分ガードと整合)。
- 2026-07-30 改訂: 階段とジョーカーはエンジンネイティブ機能として実装済みで、ルールは `RuleMeta.engineFeatures`(`'sequence'` / `'jokers'`)の**宣言**で有効化できる(docs/specs/2026-07-30-engine-features-sequence-joker-design.md)。CX-01 はこれらを却下しない。engineFeatures にまだ無い手型・カード種を要する提案は reject ではなく needs_review とし、開発者が語彙拡張を判断する。

```ts
// packages/core/src/play/candidates.ts
export interface CandidateGenerator {
  kind: PlayKind;
  /** 手札から、この種類のプレイ候補をすべて列挙する(基本ルール上の形の成立のみを見る) */
  generate(hand: Card[]): Play[];
}
// v1 のレジストリ: [singleGenerator, setGenerator]
// 階段を将来入れる場合: sequenceGenerator を追加し PlayKind に "sequence" を足す(契約のマイナー拡張)
```

**v1 の生成アルゴリズム**(ジョーカー所持数 j = 0..2):

1. **single**: 手札の各カード 1 枚(ジョーカー単騎含む)。最大 14 件。
2. **set(同ランク k 枚、k = 2..4)**: ランクごとに自然カード c 枚をグループ化し、自然 m 枚(1 ≤ m ≤ min(c, k))+ ジョーカー k − m 枚(≤ j)の組合せをスートの組合せまで展開(縛り系ルールがスートを見るため実カードで列挙)。1 ランクあたり C(4, m) ≤ 6 通り × ジョーカー配分。ジョーカー 2 枚のみのペア(`repRank: "joker"`)も列挙。
3. **追従フィルタ**: 場にプレイがある場合、同種・同枚数かつ現在の `StrengthOrder`(`modifyStrength` 適用済み)で厳密により強い候補だけ残す。
4. **`modifyLegality` 一括適用**: 残候補の配列を 1 回のポート呼び出しでチェーンに渡す(§2.3)。

総候補数は最悪でも数百件(13 ランク × 枚数 × スート組合せ ≤ 300 程度)であり、AI(E2)の照会・スナップショット同梱の双方に足りる。同一手番内での結果は場が変わるまでキャッシュしてよい(E12 §6 緩和策 3)。

### 2.10 forceRank と退場処理の意味論(E12 引き継ぎ (3) への回答)

#### 順位スロットの一般規則

- 順位は 1〜4 の**スロット**。あがり(手札 0)による確定は「未使用スロットの最上位(最小番号)」を取る。
- **`forceRank { player, rank }`** は指定スロットの強制取得。`rank` は 1〜4 の具体スロットに加え `'lowest'` を取れる。`'lowest'` は適用時にプレイヤー数(4 人戦なら 4)へ解決され、以降は具体スロット指定と同じ規則(使用中なら近傍再割当)に従う。反則あがり系(「〜であがったら最下位」)のルールは具体番号でなく `'lowest'` を用いることを推奨する。同一バッチで複数の反則あがりが `'lowest'` を指定した場合、先に適用された方(§2.5.4 の適用順で優先度が高い側)がより低い順位を得る(近傍再割当規則からの帰結であり、エンジンがテストで保証する)。適用手順:
  1. 対象が `active` の場合: `status = "retired"` とし、手札の残カードを**すべて `excluded` ゾーンへ移す**(内容は公開しない。捨て札 `discard` は「公開の場に出たカード」の集積であり、未公開の手札を混ぜると情報が漏れるため別ゾーンとする)。`playerRetired` イベント(枚数のみ公開)。
  2. 対象が `finished` / `retired`(既に順位を持つ)場合: 旧スロットを解放してから新スロットを取得する(付け替え)。既確定の他プレイヤーの順位は動かさない。解放されたスロットは以後のあがりで再利用される。
  3. **指定スロットが使用中**の場合: **近傍未使用スロットへの再割当**を行う — 下位方向(番号の大きい側)で最も近い未使用スロットを優先し、下位に空きがなければ上位方向で最も近い未使用スロットへ。この再割当は `effectApplied` イベントに記録する(例: 2 つのルールが同一バッチで**別人**を 4 位指定 → 競合キー `rank:{player}` が異なるため両方 `adopted`。高優先側の適用が先(§2.5.4 の適用順)なので高優先側の対象が 4 位、もう 1 件の対象は下位に空きがなく上位方向で最も近い 3 位へ再割当)。
- **手番の扱い**: `retired` は以降の手番決定(§2.5.1 手順 9)で常にスキップされる。退場者が「最後に場へ出した者」のままだった場合のリード権は「そこから回り順で次のアクティブ」へ移る。退場者は `field.passedSinceLastPlay` の全員パス判定の母数からも除く。`skipTurns` との相互作用(スキップ消化はパス扱い)は §2.5.1 手順 9・BR-8。
- **終局との関係**: 退場・あがりの結果アクティブが 1 人になったら、その 1 人へ残る最上位スロットを与えて終局する(手順 7)。アクティブ 0 人(同時退場の極端例)でも全スロットが埋まるので終局する。

#### 都落ちの適用例(E12 §4.6(2) の対応例の完成形)

第 2 戦、前戦大富豪 = P1。P3 のプレイで P3 の手札が 0 になり 1 位を確定(手順 5)。afterPlay(手順 6)で都落ちルールが `ctx` の確定順位に 1 位が付いたことを検知し、`ctx.setHistory[last]` の大富豪 P1 と照合。P3 ≠ P1 なので `[{ type: "forceRank", player: "P1", rank: 4 }, { type: "announce", messageKey: "miyako-ochi" }]` を返す。エンジンは P1 を退場(手札 5 枚 → `excluded`、4 位確定)させ、発動バナー(画面 3)を出す。以降は P2・P4 で 2 位・3 位を争い、次のあがりで 2 位、最後の 1 人が 3 位となって終局する。

**P1 が既に 2 位であがった後に別人が 1 位確定したケース**: 都落ちは同様に発火し、P1 は 2 位を解放して 4 位へ付け替え。解放された 2 位スロットは残りのプレイヤーのあがりで埋まる。

### 2.11 choice 機構(プレイヤー追加入力)への拡張余地(E12 引き継ぎ (5) への回答)

E12 §7-7 の暫定 B(**契約 v1 は追加入力を要するルール非対応**。7渡し・10捨て等は CX-01 で「実装不可(契約 v1 非対応)」として却下)を前提とする。ただし将来の案 A(`requestChoice`)導入で**破壊的変更にならないよう**、v1 の設計に次の逃げ道を確保しておく(実装はしない):

1. **フェーズは判別可能ユニオン**: `GamePhase` は文字列 union であり、`"awaitingChoice"` の追加が既存分岐を壊さない(`switch` の網羅性チェックで追加漏れはコンパイルエラーになる)。
2. **アクションに予約型**: `SetAction` に将来 `{ type: "ruleInput"; player; choiceId; value }` を追加する余地を、アクション処理の入口を型 `switch` 一本にすることで確保する。リプレイ形式(§2.6)は `SetAction` をそのまま記録するため、ログ形式の変更も不要。
3. **スナップショットに予約フィールド**: `PlayerSnapshot` に `pendingChoice?: {...}` を将来追加する(optional 追加は非破壊)。
4. **フック再呼び出し規約の予約**: 契約 v2 では「`requestChoice` Effect を返したルールに対し、応答を引数に**同名フックを再呼び出しする**」規約とする方針だけを契約ドキュメントに明記しておく(E12 §4.6(2) の「フックの再呼び出し規約」)。v1 のルールは再呼び出しを前提にしない書き方(フックは 1 回で完結)を守ればよく、v2 移行時に既存ルールの改修は不要。
5. **契約バージョンの機械検査**: `RuleModule.meta` に `contractVersion` を持たせ、レジストリはエンジンの対応バージョンと照合する。choice 導入時は v2 ルールだけが `requestChoice` を使える。

### 2.12 対戦 AI 向けシミュレーション API(E02 §3.1(c) の要求への回答)

E2 の探索(決定化モンテカルロ)がエンジン知識を参照する唯一の面として、core は次を公開する。依存方向は ai → core のみ(E02 §3.1(d))。

```ts
// packages/core/src/sim/api.ts
export function createSimulationApi(chain: RuleChainEntry[], port: RuleChainPort): SimulationApi;

export interface SimulationApi {
  enumerateLegalPlays(state: GameState, player: PlayerId): Play[]; // 候補生成 + チェーン適用済み(§2.9)
  applyPlay(state: GameState, action: GameAction): { state: GameState; events: PublicGameEvent[] };
                                                                   // reduceGame の別名(純粋関数・Effect 適用済み)
  isTerminal(state: GameState): Standings | null;
  getEffectiveStrengthOrder(state: GameState): StrengthOrder;      // modifyStrength チェーン適用済みの現在の強弱
  getPlayerView(state: GameState, player: PlayerId): PlayerSnapshot; // 秘匿情報を落としたビュー(§2.7.1 の redact)
  fallbackPlay(state: GameState, player: PlayerId): GameAction;    // 常に合法な安全手: パスが合法ならパス、
                                                                   //   リード時は基礎生成器の最弱単騎(E02 §3.1(b))
  serialize(state: GameState): string;                             // JSON 文字列。GameState は JSON 値のみで
                                                                   //   構成される(§2.2 の不変条件)ため無損失
}
```

- **カード選択セレクタの具象化**(E09 §5.3-2 の要求)も core の公開純粋関数として提供する: `resolveCardSelector(view: GameView, from: Zone, selector: CardSelector, rng: RuleRng): CardId[]`。`resolveEffectBatch` の moveCards 競合判定(union-find。§2.5.3)と Effect 適用の双方がこれを使う。
- **権威記録との分離**: `SimulationApi` 経由の適用・照会は渡された `state`(複製)の中だけで完結する。`hookCalls` と `firedRules` も複製内でのみ進み、権威状態の発動判定(§2.5.7)・乱数列(§2.6)に影響しない。純粋関数なのでこれは構造的に保証される。
- **isolate への持ち込み**(E02 §3.1(d) の sim isolate): core は Node API 非依存の純 TS であり、QuickJS(WASM)isolate 内でもそのまま動作する。E2 は「core + 有効ルールバンドル」を AI 専用 isolate に読み込み、プレイアウトを isolate 内で一括実行できる。`serialize` / 逆直列化(`JSON.parse` + 型検証)が状態の持ち込み口。isolate 内では `RuleChainPort` は境界越えのないプロセス内(isolate 内)実装になる。
- スループットの実測は TS-03(E02 §5 が計測項目を追加依頼済み)。E1 としての提供物はこの API の形と純粋性・JSON 直列化可能性の保証まで。

## 3. ストーリー別詳細仕様

### 3.1 GE-01: 基本ルールの明文化

**(a) 原文**

> **[GE-01]** 開発者(運営)として、素の大富豪の「基本ルール」の範囲を明文化したい。それは以後の実装の仕様であり、提案ルールとの差分の基準線になるためだ。
> - 受け入れ条件:
>   - 基本ルールに含める要素(配札、カードの強さ関係、出し方、パス、場流れ、あがりと順位)が 1 つの文書に列挙されている
>   - 8切り・都落ちなどの追加ルールが「初期状態に含まれない」ことが明記されている
>   - 企画書が触れていない曖昧点(ジョーカーの扱い、複数枚出しの採否など)に決定が付いている

**(b) 基本ルール(案)— 本節が GE-01 の成果物のたたき台**

以下を「素の大富豪」の基本ルール v1 とする。番号は実装・テストから参照する規範 ID。

> **【確定版】素の大富豪 v1(2026-07-25 開発者決定)** — 以下が GE-01 の成果物であり、実装の仕様。旧 BR-1〜15(この決定ブロックの後に原文を残置)から次を変更した: **ジョーカーを初期から除外(52 枚)/ 配り始めはランダム / 先手は毎ゲーム ダイヤの 3 保持者 / 反則あがりは追加ルール扱い**。
>
> 対戦型ゲームの定義として **(1) 初期状態 (2) 合法手の集合 (3) 終了条件** の 3 本柱で書き下す。BR 番号は旧版から引き継ぎ、削除項目は欠番として記録する(§3.1(e) のテスト対応表の追跡性を保つため)。
>
> #### 記法と前提
>
> - プレイヤーは 4 人固定(企画書 §3.2)。席を `seats[0..3]` とし、席順は時計回り。
> - カードはランクとスートを持つ。**ランクの強さ**を `strength(rank)` と書く。
> - ゲーム状態は §2.2 の `GameConfig` / `GameState`(public / private / players)で表現する。
>
> ---
>
> #### (1) 初期状態
>
> - **BR-1 使用カード**: **ジョーカーを含まない 52 枚**(4 スート × 13 ランク)。ジョーカーの導入は追加ルール候補(BR-14)。
> - **BR-2 配札**: シード乱数による Fisher–Yates シャッフルの後、**配り始めの席を乱数で選び**、そこから回り順に 1 枚ずつ配り切る。52 枚 ÷ 4 人 = **全員 13 枚**で均等。山札は残らない。
>   - 配り始めをランダムにするのは、**将来ジョーカー等でデッキ枚数が 4 の倍数でなくなった場合に、枚数差が特定の席に固定されないようにする**ため(v1 では均等なので結果に影響しないが、規則として先に定める)。
> - **BR-11 先手(リード開始者)**: **毎ゲーム、ダイヤの 3 を持つプレイヤー**。第 1 戦も第 2 戦以降も同じ規則で、前戦の結果には依存しない。先手は BR-5 の任意の手でリードできる(「ダイヤの 3 を含む手を出す」という縛りは採用しない)。
> - **BR-13 ゲーム開始時のカード交換(献上)**: **行わない**。追加ルール候補(BR-14)。
> - **場・捨て札**: ゲーム開始時、場は空(リード状態)、捨て札は空。確定順位は空。
>
> **v1 ではゲームをまたぐ状態が存在しない**(先手は毎ゲーム ダイヤ 3 固定、献上なし、都落ちなし)。したがって 3 戦 1 セット(BR-15)の意味は現時点では「**同じメンバーで続けて遊ぶ単位**」と「**セット単位の評価(E8)の対象**」であり、ゲームまたぎルール(都落ち等)が追加されたときに初めて戦績の連続性が効きはじめる。E1 のセット状態(`SetState`)はその追加に備えて前戦順位を保持する(§3.4)。
>
> ---
>
> #### (2) 合法手(Move)の集合
>
> 手番プレイヤー `p` が取れる Move は次の 2 種類のみ:
>
> ```
> Move := Play(cards: Card[])   // 手札から 1 枚以上を出す
>       | Pass                   // 出さずに手番を渡す
> ```
>
> **BR-3 ランクの強さ順序**: 手の優劣を決めるための順序関係。弱い順に `3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2`。**スートに強弱はない**(同ランク間の優劣は存在しない)。この順序は BR-6-4 の追従判定にのみ使い、初期状態やカードの属性そのものではない(革命などの追加ルールは、この順序を変換するフックとして表現される。§2.5.2 `modifyStrength`)。
>
> **BR-5 手の種類(Play の形)**: `Play(cards)` が形として成立するのは次のいずれか。
> 1. **単騎**: `cards` が 1 枚。
> 2. **同ランク複数枚出し**: `cards` が 2〜4 枚で、**全て同じランク**(スートは任意)。
>
> **階段(同スート連番)は v1 に含めない**(追加ルール候補 BR-14。手の種類の追加はエンジン拡張 §2.9)。手の**種類**は「枚数」で一意に決まる(単騎=1 枚、ペア=2 枚、…)。手の**強さ**はランクで決まる。
>
> **BR-6 Play の合法条件**: `Play(cards)` が合法であるのは、次を**すべて**満たすとき。
> 1. `cards` がすべて `p` の手札に実在する(重複使用なし)。
> 2. `cards` が BR-5 の形として成立する。
> 3. **場が空(リード)のとき**: 追加条件なし(任意の形・任意のランクを出せる)。
> 4. **場にプレイがあるとき**: 場のプレイと **枚数が等しく**、かつ **`strength(cards のランク) > strength(場のランク)`**(**厳密に強い**。同ランクは不可)。
>
> **BR-7 Pass の合法条件**: **場にプレイがあるときのみ合法**。出せる手があってもパスしてよい(パスの強制はない)。
> - **リード(場が空)でのパスは非合法**。手札が 1 枚でもあれば単騎が必ず出せるため、リードのパスは手番を捨てるだけの操作であり、認めない。
> - パスの効果はその手番限り。**場が流れる前でも、次に手番が回ってくれば出せる**(パスによる縛りはない)。
>
> **BR-9 手番の進行**: 席順の時計回りに、あがり済み・退場済みでない(= アクティブな)プレイヤーへ手番が移る。v1 で回り順の反転は起きない(`reverseTurnOrder` は追加ルール用の語彙)。
>
> **BR-8 場流れ(トリックの終了)**: 最後にカードを出したプレイヤー以外の**アクティブ全員が連続してパス**したら、場が流れる。
> - 場のカードは捨て札へ移る。次のリードは**最後にカードを出したプレイヤー**(その者があがり・退場済みなら、そこから回り順で次のアクティブプレイヤー)。
> - 追加ルールのスキップ(`skipTurns`)で消化された手番は**パスとして数える**(v1 単体では発生しないが、場流れ条件の一部としてここで規定する。§2.5.1 手順 9)。
> - リードのプレイ直後に他の全員があがっている場合など、判定対象が 0 人になったときも場は流れる(次のリードは上記規則で決まる)。
>
> **合法手が常に存在すること**: リードでは手札がある限り単騎が必ず合法(BR-5-1・BR-6-3)。追従時は Pass が必ず合法(BR-7)。よって**アクティブなプレイヤーの合法手集合が空になることはない**(§2.5.5 のフェイルセーフはルール追加時の保険)。
>
> ---
>
> #### (3) 終了条件
>
> **BR-10 あがりと順位**: 手番の `Play` によって手札が 0 枚になったプレイヤーは**あがり**となり、その時点で確定順位が 1 つ埋まる(あがった順に 1 位、2 位、…)。あがったプレイヤーは以後アクティブでなくなる(手番が回らない)。
>
> **ゲームの終了**: **3 人があがった時点で、残る 1 人が自動的に 4 位となりゲームが終わる**(最後の 1 人は手札を出し切る必要がない)。
>
> **称号**: 1 位から順に 大富豪 / 富豪 / 貧民 / 大貧民(4 人固定のため中間称号はこの 2 つ)。
>
> **BR-12 反則あがり**: **v1 では設けない**(どのカードであがってもよい)。これは追加ルール扱いとする — 反則あがりの定義は「どの追加ルールが有効か」に依存して変わる(禁止対象が 2・ジョーカー・8切り成立時…と増えていく)ため、基本ルールに固定的な定義を置くと後続の全ルールに制約が波及する、という判断。エンジンは追加ルールが反則あがりを表現できるよう、合法性判定時に「このプレイがあがりになるか」を `ctx` から判定可能にしておく(手札とプレイの突き合わせで判る)。
>
> **BR-15 セットの終了**: 3 戦 1 セット(既定値。設定で変更可能に実装する)。セットの終了条件・総合順位・打ち切り時の扱いは GE-05(§3.4)。
>
> ---
>
> #### 欠番・追加ルール候補
>
> - **BR-4(ジョーカー)は欠番**。ジョーカーの導入(枚数・単騎最強・ワイルド代用の可否)はすべて追加ルールとして提案経由で入る。
> - **BR-14 v1 に含めない追加ルールの例(明文)**: **ジョーカーの導入**、**反則あがり(2 あがり禁止等)**、**献上(カード交換)**、8切り、都落ち、革命・革命返し、階段、縛り(スート縛り・数字縛り)、スペ3返し、7渡し、10捨て、11バック、5スキップ、9リバース、砂嵐、Q ボンバー等。これらはすべてユーザー提案(フェーズ 2)で入る側であり、初期実装に**いかなる形でも**含めない(テスト用フィクスチャを除く。GE-04)。
>
> #### この決定の波及(実装時に該当箇所を更新すること)
>
> - §2.2 `Card` 型: ジョーカーの表現を v1 の型から外す(追加ルールで再導入する際に判別可能ユニオンを拡張する形にする)。
> - §3.1(e) テスト対応表: 配札テストは「全員 13 枚・52 枚が重複なく分配・配り始めがシードで決まる」に変更。ジョーカー関連テストは削除。
> - 先手決定のテスト: 「毎ゲーム、ダイヤの 3 保持者が先手」(前戦順位に依存しないこと)を検証する。
> - decision-log A-3 を「決定済み」に更新。
>
> ---
>
> **以下は旧版(2026-07-24)の BR-1〜15 の原文。上記確定版に置き換わったが、変更の経緯を追えるよう残置する。**

- **BR-1 使用カードと人数**: ジョーカー 2 枚を含む 54 枚。プレイヤーは 4 人固定(企画書 §3.2)。
- **BR-2 配札**: シード乱数による Fisher–Yates シャッフルの後、**席順の先頭(`seats[0]`)から**回り順に 1 枚ずつ**配り切る**。配り始めは毎ゲーム `seats[0]` 固定であり、**先手(BR-11)とは独立**(先手はダイヤの 3 の所持など配札結果から決まるため、配り始めを先手に依存させると循環定義になる)。54 枚 ÷ 4 人のため、`seats[0]`・`seats[1]` が 14 枚、`seats[2]`・`seats[3]` が 13 枚になる(枚数差は配り切りの伝統として許容する)。山札は残らない。
- **BR-3 カードの強さ**: 弱い順に 3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2。スートに強弱はない。
- **BR-4 ジョーカー**: (i) 単騎で出すと最強(2 より強い。基本ルールではジョーカー単騎に勝てる手はない。スペ3返しは追加ルール)。(ii) 複数枚出しでは任意ランクの代用(ワイルドカード)にでき、その組の強さは代表ランク(自然カードのランク)で決まる。(iii) ジョーカー 2 枚のみのペアは最強のペアとして扱う。
- **BR-5 出せる手の種類**: **単騎**(1 枚)と**同ランク複数枚出し**(2〜4 枚。ジョーカー代用可)を採用する。**階段(同スート連番)は基本ルールに含めない**(追加ルール候補。§2.9 のとおり導入はエンジン拡張)。
- **BR-6 追従の条件**: 場にプレイがあるとき、出せるのは**同じ種類・同じ枚数**で、代表ランクが**厳密により強い**手のみ(同ランクは不可)。場が空(リード)のときは BR-5 の任意の手を出せる。
- **BR-7 パス**: 手番で出さない宣言。出せる手があってもパスできる。パスはその手番限りで、**場が流れる前でも次に手番が回れば出せる**(パスによる縛りなし)。ただし**リードでのパスは不可**(手札が 1 枚でもあれば単騎が必ず出せるため、意味を持たない)。
- **BR-8 場流れ**: 最後にカードを出したプレイヤー以外の**アクティブ全員が連続してパス**したら場が流れる。場のカードは捨て札へ。次のリードは最後に出したプレイヤー(あがり・退場していればそこから回り順で次のアクティブプレイヤー)。スキップ(追加ルールの `skipTurns`)で消化された手番は**パスとして数える**(基本ルール単体では発生しないが、場流れ条件の一部としてここで規定する。§2.5.1 手順 9)。
- **BR-9 回り順**: 席順の時計回り。基本ルールで反転は起きない(`reverseTurnOrder` は追加ルール用の語彙)。
- **BR-10 あがりと順位・称号**: 手札を出し切ったら**あがり**で、あがった順に 1 位から順位が付く。3 人があがった時点で残る 1 人が自動的に 4 位となりゲーム終了。称号は 1 位から 大富豪/富豪/貧民/大貧民(4 人固定なので中間称号はこの 2 つ)。
- **BR-11 先手(リード開始者)**: セットの第 1 戦は**ダイヤの 3 を持つプレイヤー**。第 2 戦以降は**前戦の大貧民**。先手は任意の手でリードできる(「最初はダイヤの 3 を含む手を出す」という縛りは採用しない — 曖昧点への決定)。
- **BR-12 反則あがり**: 基本ルールでは**設けない**。どのカードでもあがれる(ジョーカーあがり・2 あがりの禁止は追加ルール候補)。エンジンは追加ルールが反則あがりを表現できるよう、合法性判定時に「このプレイであがりになるか」を `ctx` から判定可能にしておく(手札とプレイの突き合わせで判る)。
- **BR-13 カード交換(献上)**: 基本ルールに**含めない**。前戦順位によるゲーム開始時のカード交換は追加ルール候補とする(初期状態を「基本進行だけ」に保つ企画書 §3.1 の趣旨。ゲームまたぎ要素は BR-11 の先手決定のみ)。
- **BR-14 初期状態に含めない追加ルールの例(明文)**: 8切り、都落ち、革命・革命返し、階段、縛り(スート縛り・数字縛り)、スペ3返し(ジョーカー返し)、7渡し、10捨て、11バック、5スキップ、9リバース、砂嵐、Q ボンバー等。これらはすべてユーザー提案(フェーズ 2)で入る側であり、初期実装に**いかなる形でも**含めない(テスト用フィクスチャを除く。GE-04)。
- **BR-15 試合形式**: 3 戦 1 セット(既定値。調整可能な実装とする)。詳細は GE-05。

エッジケースの決定:

- 最後の 1 人(4 位確定者)の残り手札はプレイされず、そのままゲーム終了(公開しない)。
- 全員パス判定の母数は「アクティブプレイヤー − 最後に出した者」。あがった者のプレイが場に残ったまま全員パスした場合も BR-8 のとおり流れる。
- 手番中のプレイヤーがあがった直後の次手番は、通常の回り順で次のアクティブプレイヤー。

**(c) 画面仕様**: なし(文書ストーリー)。

**(d) データ・API**: BR-3 の順序は `strength.ts` の定数 `BASE_STRENGTH_ORDER: StrengthOrder`、BR-14 の除外リストはドキュメントのみ(コードに「含めない」ものは現れないのが正)。

**(e) 実装方針**: 本節 (b) を `docs/epics/E01-game-engine.md` の一部として維持し、`packages/core` の README から参照する。規範 ID(BR-n)をテスト名に使い、仕様とテストの対応を機械的に追えるようにする。

**(f) 受け入れ条件の精緻化(検証手順)**

1. 本節 (b) に、配札(BR-2)・強さ(BR-3, 4)・出し方(BR-5, 6)・パス(BR-7)・場流れ(BR-8)・あがりと順位(BR-10)の全要素が列挙されていることを目視確認する。
2. BR-14 に 8切り・都落ちが明示され、「初期状態に含まれない」ことが書かれていることを確認する。
3. 曖昧点(ジョーカーの扱い = BR-4、複数枚出しの採否 = BR-5、パスの拘束 = BR-7、先手 = BR-11、反則あがり = BR-12、献上 = BR-13)のそれぞれに一意の決定が付いていることを確認する。
4. 開発者が (b) 全体を承認する(承認をもって GE-01 完了。修正があれば本書を更新)。

**(g) 未解決事項**

- ジョーカー枚数(2 枚)と配り切りの枚数差(14/14/13/13)の受容は開発者確認事項。1 枚(53 枚、14/13/13/13)案もある。挙動仕様への影響は BR-2/BR-4 に閉じる。
- BR-11 の第 1 戦先手を「ランダム」にする案との比較(ダイヤ 3 案は説明可能性で勝る。乱数でも決定性は保てる)。

### 3.2 GE-02: 配札・手札秘匿・手番のプレイ/パス

**(a) 原文**

> **[GE-02]** プレイヤーとして、カードが配られて自分の手札だけを見ながら、手番にカードを出すかパスしたい。それは大富豪の基本進行そのものだからだ。
> - 受け入れ条件:
>   - ゲーム開始時に配札され、自分の手札だけが自分に見える
>   - GE-01 のルール上出せるカードだけが出せる(不正な手は拒否される)
>   - 全員がパスすると場が流れ、次のリードに移る

**(b) 挙動仕様**

正常系:

1. ゲーム開始で BR-2 のとおり配札され、`gameStarted` イベント(先手・各人の枚数)と全員分の `PlayerSnapshot` が生成される。手札は本人のスナップショットにのみ載る。
2. 手番プレイヤーが `play` アクションを送る。§2.5.1 の手順で検証・適用され、全員に `played` イベントと新スナップショットが届く。
3. 手番プレイヤーが `pass` を送ると `passed` イベント。BR-8 の条件が成立したら `fieldCleared`(`reason: "allPassed"`)が続き、リードへ移る。
4. 手番プレイヤー向けスナップショットには `legalMoves`(§2.7.2)と `canPass` が同梱され、クライアントはそれだけで UI 制御できる。

エッジケース:

- 出せる手が 1 つもない手番(追従不能): `legalMoves` は空配列、`canPass: true`。パスのみ可能。
- リード(場が空): `canPass: false`。`legalMoves` は必ず 1 件以上(BR-7 の根拠)。ルール介入で 0 件になった場合はフェイルセーフ(§2.5.5)が基本ルールの合法手を返す。
- ジョーカー代用を含むプレイ: クライアントは実カード(`CardId` 列)を送るだけでよく、代表ランクはエンジンが推定する(自然カードが混在すればそのランク、ジョーカーのみなら `"joker"`)。v1 の手の種類に解釈の曖昧さはない(§2.4 の `kind` フィールドは省略)。

エラー(拒否時は状態不変。`actionRejected` を**本人にのみ**返す):

| エラーコード | 条件 |
|---|---|
| `NOT_YOUR_TURN` | 手番外のアクション(phase 不一致含む) |
| `CARD_NOT_IN_HAND` | 手札にない `CardId` を含む |
| `INVALID_PLAY_SHAPE` | 単騎でも同ランク複数枚でもない組(BR-5) |
| `TOO_WEAK` | 種類・枚数不一致、または場より強くない(BR-6) |
| `FORBIDDEN_BY_RULE` | `modifyLegality` により不合法(ルールの `reasonKey` を添付) |
| `PASS_ON_LEAD` | リードでのパス(BR-7) |

同一アクションの重複送信(二重タップ・再送)は 1 件目適用後、2 件目が `NOT_YOUR_TURN` 等で自然に拒否される。エンジンとしては冪等性の特別扱いをしない(再送制御は E3 の責務)。

**(c) 画面仕様(画面 3: 対戦画面)**

- 他プレイヤー枠: `players[].handCount / isAI / status`、手番者は `turn` で強調(「手番」ラベル)。
- 場: `field.play` のカードと「◯◯が △ を出した」(直近の `played` イベント)。
- 手札: `hand`(ソート済み)。選択中カードの組が `legalMoves` に含まれない間は「えらんだカードを出す」を無効化。`canPass: false` のとき「パス」を無効化。
- ログ欄: `history`(直近分)から `played` / `passed` / `fieldCleared` / `ruleFired` を整形。演出(バナーのアニメーション再生)は `PlayerRoomView.events`(E03 §2.3)側で駆動する。ルール発動バナー(黄)は `ruleFired` を表示(基本ルールのみの初期状態では発生しない)。
- アプリバーの「第 n 戦」は `gameIndex + 1`、「(n巡目)」は `trickNumber`、「有効ルール 31」は `effectiveRules.length`(遷移先の画面 4 は E11)。

**(d) データ・API/イベント定義**

- アクション: `GameAction`(§2.4)。イベント: `PublicGameEvent`(§2.7.1)。スナップショット: `PlayerSnapshot`(§2.7.1)。
- ワイヤ規約は **E03 §2.2 で確定済み**: client→server は `game:play { turnSeq, cards: CardId[] }` / `game:pass { turnSeq }`(ack 応答)。E3 が席・`turnSeq` を検証してから `GameAction` に変換して `reduceGame` を呼び、結果を `room:state`(`PlayerRoomView`。その `game` 部と `events` 部の素材が本書の `PlayerSnapshot` / `reduceGame` の戻り値イベント)として配る。E03 の `PublicPlay`(履歴 1 件)の実体は本書の `PublicGameEvent` の `played` / `passed` である。
- **エラーコードの対応**(E1 の拒否コード → E03 の ack コード):

| E1(`reduceGame` の拒否) | E03 ack | 備考 |
|---|---|---|
| `NOT_YOUR_TURN` | `NOT_YOUR_TURN` | E3 が席・`turnSeq` を先に検証する(E03 §2.2)ため、エンジン側は防御的な再検査 |
| `PASS_ON_LEAD` / `INVALID_PLAY_SHAPE` / `CARD_NOT_IN_HAND` / `TOO_WEAK` / `FORBIDDEN_BY_RULE` | `ILLEGAL_PLAY` | E1 の詳細コードと `reasonKey` を ack の `message` に載せる(UI 文言・デバッグ用) |

**(e) 実装方針**

- `reduceGame(state, action, chain, port): { state, events, rejections }` を純粋関数で実装。server は戻り値の `state` を部屋オブジェクトに差し替え、`events` から各人の snapshot を作って配る(snapshot 生成も core の `buildSnapshot(state, setState, forPlayer)`)。
- AI(E2)・人間の区別はエンジンに存在しない。AI の手番では server が E2 のロジックに snapshot 相当(または権威状態への読み取りアクセス)と `legalMoves` を渡し、返ってきた `GameAction` を同じ `reduceGame` に通す(検証経路を人間と共通化)。

**(f) 受け入れ条件の精緻化(検証手順)**

1. **配札と秘匿**: シードを固定してゲームを開始し、(i) `seats[0]`・`seats[1]` が 14 枚、`seats[2]`・`seats[3]` が 13 枚であること(BR-2。配り始めは先手と無関係に `seats[0]`)、(ii) 54 枚が重複なく分配されること、(iii) 各 `PlayerSnapshot` の `hand` が本人分のみで、他人分は `handCount` だけであることをユニットテストで確認する。
2. **不正手の拒否**: (b) のエラーコード 6 種それぞれについて、拒否されること・状態が変わらないこと・エラーが本人にのみ返ることをテストする。
3. **合法手のみ受理**: プロパティテスト(§4)で「サーバーが受理したプレイは直前に同梱した `legalMoves` に必ず含まれる」を確認する。
4. **場流れ**: 3 人が連続パス → `fieldCleared` が発火し、最後に出したプレイヤーがリードになることをテストする。あがり済みプレイヤーを除いた母数で判定されるケースを含む。

**(g) 未解決事項**

- 手番の制限時間(持ち時間切れの自動パス)は本 Epic では設けない。マルチプレイの実運用で必要になるため E3 の検討事項として引き継ぐ(エンジンは「タイムアウト = server が `pass` を代行投入」で対応可能。追加機構不要)。

### 3.3 GE-03: あがり判定・順位・称号・決着

**(a) 原文**

> **[GE-03]** プレイヤーとして、手札を出し切った順に大富豪〜大貧民の順位が決まり、ゲームの決着を見たい。それは 1 ゲーム遊び切った実感を得るためだ。
> - 受け入れ条件:
>   - GE-01 で確定した決着ルールに従い、あがり順に順位・称号が付く
>   - ゲーム終了時に全員の結果が表示される
>   - 続けて次のゲームを開始できる(3 戦 1 セットとしての進行・リザルト表示は GE-05 で扱う)

**(b) 挙動仕様**

正常系:

1. プレイ適用後に手札 0 なら即時にあがり確定(§2.5.1 手順 5)。未使用スロット最上位の順位と称号が付き、`playerFinished` イベント。
2. 3 人目のあがり(またはアクティブ 1 人以下)で残者に残スロットが付き、`onGameEnd` フック → `gameEnded` イベント(`standings` 全員分)→ `GameResult` が `SetState.results` へ積まれる。
3. 進行は GE-05 のセットステートマシンに引き継がれる(第 1・2 戦後は `interimResult`、第 3 戦後は `setResult`)。

エッジケース:

- あがったプレイヤーのプレイが場に残っている間の進行は BR-8 のとおり(§3.1 エッジケース)。
- `forceRank` による退場・順位付け替えとの相互作用は §2.10 に定義(基本ルールのみの初期状態では発生しないが、エンジンの決着処理は最初から §2.10 の一般規則で実装する。後からルールを差し込んでも決着系のコードが変わらないため)。
- 最後の 1 人の残り手札は非公開のままゲーム終了(`hand` はゲーム破棄と同時に消える。次戦は再配札)。

**(c) 画面仕様**: ゲーム終了時の結果表示は画面 5a(第 1・2 戦後)/ 画面 5b(第 3 戦後)であり、レイアウト仕様は GE-05 側(§3.4 (c))で扱う。GE-03 としては `gameEnded` イベントと `GameResult` に「全員分の順位・称号・AI バッジ用の `isAI`」が揃っていることが画面成立の条件。

**(d) データ・API/イベント定義**: `Standing` / `Title` / `GameResult`(§2.2)、`playerFinished` / `playerRetired` / `gameEnded` イベント(§2.7.1)。

**(e) 実装方針**: 順位スロット管理(`standingsTaken`)と割当・付け替え・近傍再割当(§2.10)を `engine/finish.ts` に一元化する。あがり由来も `forceRank` 由来も同じ割当関数を通す。

**(f) 受け入れ条件の精緻化(検証手順)**

1. シード固定の 4 人対局をあがりまで進め、あがり順に 1〜4 位・大富豪〜大貧民が付くことをテストで確認する(3 人あがり時点で 4 人目が自動確定することを含む)。
2. `gameEnded` イベントに全員分の `{ player, standing, title }` が含まれ、スナップショットの `setResults` から結果画面が構成できることを確認する。
3. `gameEnded` 後に `advance` で次ゲームが開始でき、再配札されること(前ゲームの手札・場・game スコープ KV が持ち越されないこと)を確認する。
4. §2.10 の一般規則の単体テスト: スロット衝突時の近傍再割当(下位優先・無ければ上位)、確定済み順位の付け替え、退場による終局。

**(g) 未解決事項**: なし(順位まわりの一般規則は §2.10 で確定。E09 §2.4 の競合解決の下でも、採用された `forceRank` に対する割当規則自体は不変)。

### 3.4 GE-05: 3 戦 1 セットの進行

**(a) 原文**

> **[GE-05]** プレイヤーとして、同じメンバー(AI 構成も同じ)のまま 3 戦 1 セットで続けて遊びたい。それは 1 戦ごとの解散はテンポが悪く、都落ちのようなゲームをまたいで効くルールが機能しなくなるからだ(§3.4)。
> - 受け入れ条件:
>   - 3 戦を 1 セットとして、同一メンバー・同一 AI 構成で連続して対局できる(セット数(3 戦)は今後調整できる実装とする §3.4)
>   - ゲーム間は順位のみの簡易リザルトを表示して次戦へ進み、セット終了時に 3 戦の総合結果が表示される
>   - 順位などのゲーム結果がセット内で次のゲームに引き継がれ、ゲームをまたいで効くルールから参照できる

**(b) 挙動仕様**

セットの生成と不変条件:

1. セット開始時(部屋の「開始する」。E3 から `members` と有効ルール構成を受け取る)に `SetState` を生成する: `setSeed` 発行、`ruleChain` を DB の有効ルール・優先度で固定(E12 §4.6(4)。**セット途中でルールの追加・削除・優先度変更は反映しない**)、`config.gamesPerSet`(既定 3)を確定。
2. `members`(人間/AI の別を含む)はセット内で不変。離脱時の AI 代打ちは E3 の責務だが、**席とプレイヤー ID は変わらない**(代打ちは「その席の操作者が変わる」だけで、エンジンから見た `PlayerId` は同一)。

ゲーム間の進行:

3. 第 i 戦(i < N−1)終了 → `interimResult` フェーズ。スナップショットの `setResults` に第 i 戦までの順位が入り、画面 5a が表示できる。server が 15 秒後(`interimAutoAdvanceMs`、MP-03 の仮値)に `advance` を投入し、第 i+1 戦を開始する(BR-11: 先手は前戦の大貧民)。
4. 第 N−1 戦(最終戦)終了 → `setResult` フェーズ。総合結果(下記)を確定して画面 5b が表示できる。評価入力の受付・保存は E8(フェーズ 3)。
5. **セット総合順位の算出**(`set/scoring.ts`): 各ゲームの順位を順位点(1 位 = 4 点、2 位 = 3 点、3 位 = 2 点、4 位 = 1 点。一般式は 人数 − 順位 + 1)に換算して合計し、降順で総合 1〜4 位。**同点は最終戦の順位が上の者を上位**とする(最終戦順位は一意なので必ず決まる)。総合称号は総合順位に大富豪〜大貧民を対応させる(画面 5b の表示どおり)。
6. **「もう 1 セットあそぶ」**: **新しい `SetState`** を生成する(新しい `setSeed`・新しい `ruleChain` — この時点の有効ルール構成を反映するので、直前のセット中にリリースされたルールはここで初めて入る)。`members` は **E3 が「もう 1 セット」の待ち合わせ結果から再構成して渡す新たな入力**であり、離脱者の席の AI 化・AI 再補充により前セットと異なりうる(E03 §2.2 `room:continue`)。企画書 §3.4 の「同一メンバー」の保証は**セット内のみ**で、セットをまたいでは保証しない。`setMemory`(set スコープ KV)・`results` は引き継がない。**セットをまたいで効くルールは契約 v1 では表現できない**(仕様。都落ちの「前回」はセット内の前戦を指す)。

ゲームをまたぐ状態の保持(受け入れ条件 3 の実現):

- `SetState.results`(= ルールから見える `ctx.setHistory`)、`SetState.setMemory`(set スコープ KV。§2.8)、`seats` / `direction` … `direction` は**ゲーム開始時に 1 へリセット**する(回り順の反転はゲーム内効果。ゲームをまたぐ反転は setMemory + `onGameStart` で表現可能)。skip 残数・場・game スコープ KV はゲーム終了で破棄。

エッジケース:

- `interimResult` 中の `play` / `pass` は `NOT_YOUR_TURN`(phase 不一致)で拒否。
- `advance` の重複投入(タイマーと操作の競合)は 2 件目を no-op として拒否。
- セット途中の解散(全員離脱等)は E3 が部屋を破棄する。エンジンにセット中断状態は設けない(結果の永続化はセット/ゲーム終了時のみ。E12 §4.4)。

**(c) 画面仕様**

- 画面 5a(ゲーム間リザルト): アプリバー「第 n 戦 おわり / セット i / N 戦」= `gameIndex` と `config.gamesPerSet`。順位一覧は `setResults[last].standings`(称号タグ・AI バッジ付き)。「第 n+1 戦へ(5 秒後に自動で進む)」はカウントダウン表示のみで、押下による早送りは行わない(全員一律のサーバータイマー。個人別の早送りは同期状態を分岐させるため設けない)。評価入力は置かない(企画書 §4.4)。
- 画面 5b(セットリザルト): 総合順位・総合称号・「1位→1位→2位」の推移表示は `setResults` 全件から構成。評価 UI(おもしろかった?・ルール単位評価)は E8 のスコープで、本 Epic では領域が空でも画面が成立する。「もう 1 セットあそぶ」→ 新セット生成(上記 6)、「ホームへ」→ 解散(E3)。

**(d) データ・API/イベント定義**: `SetState` / `SetPhase` / `SetConfig` / `GameResult`(§2.2)、`SetAction.advance`(§2.4)、イベント `setEnded`(総合結果 `totals: { player, points, totalStanding, title }[]` を含む)。セット終了時の永続化スキーマは **E08 §2.1 が確定済み**(`game_sets` / `set_participants` / `set_rules(was_active, did_fire)`)。エンジンは `setResult` 到達時にその書込み素材 `SetOutcome`(§5.3 E8 の項)を返し、server(E3)が DB へ書く。

**(e) 実装方針**: `reduceSet` が `GameAction` を内部の `reduceGame` へ委譲し、`gameEnded` を検知してフェーズ遷移・`results` 追記・(最終戦なら)`scoring` を行う。タイマー・DB 書込み・評価受付はすべて server 側。`gamesPerSet` は `SetConfig` 経由でのみ参照し、リテラル 3 をコードに書かない(4 戦案への調整余地)。

**(f) 受け入れ条件の精緻化(検証手順)**

1. シード固定で 3 ゲームを通し、(i) メンバー・席順・AI 構成が 3 戦で同一、(ii) 第 1・2 戦後に `interimResult`、第 3 戦後に `setResult` になることをテストで確認する。`gamesPerSet: 4` でも同様に通ることを確認する(調整可能性)。
2. `interimResult` のスナップショットが順位のみで構成でき(画面 5a)、`advance` で次戦が開始され先手が前戦大貧民であること(BR-11)を確認する。
3. 総合結果: 既知の 3 戦結果を与えて順位点合計・同点時の最終戦タイブレークが仕様どおりであることをテストする。
4. ゲームまたぎ参照: フィクスチャルール(都落ち相当)が第 2 戦の `afterPlay` で `ctx.setHistory` から前戦大富豪を特定し `forceRank` できること、set スコープ KV が第 2 戦から読めることをテストする(GE-04 のチェーン機構を使用)。

**(g) 未解決事項**

- 画面 5a の自動進行 5 秒は固定でよいか(全員 ready での早期開始を入れるか)。エンジンは `advance` の投入契機を問わないため、E3 の判断で後から変更できる。
- セット数の既定(3 か 4 か)は運用調整(企画書 §3.4)。`SetConfig` で吸収済み。

### 3.5 GE-04: ルールを個別に追加・削除・入れ替えできる構造

**(a) 原文**

> **[GE-04]** 開発者(運営)として、ルールを個別に追加・削除・入れ替えできる構造でゲームエンジンを実装したい。それはフェーズ 2 で自動実装されたルールを安全に差し込み、問題時に単独で外すための土台だからだ。
> - 受け入れ条件:
>   - 個々のルールが独立した単位としてエンジンに登録される
>   - ルール単位の有効/無効の切り替えでゲームの挙動が変わることをテストで確認できる
>   - この構造と自動実装ルールの受け入れ境界が文書化されている

**(b) 挙動仕様**

- ルールの単位は E12 §4.6(1) の 4 層一貫(1 ディレクトリ = 1 バンドル = 1 実行単位 = 1 DB 行)。エンジンから見える単位は `RuleChainEntry`(§2.2)であり、**エンジンはルールの中身を知らず、チェーンとポート(§2.3)しか見ない**。
- 有効/無効は DB フラグ → レジストリ(server)→ **次のセット開始時**のチェーン構成に反映(E12 §4.6(4))。エンジン側には「チェーンが違えば挙動が変わる」以上の機構を持たない。進行中セットは影響を受けない。
- ルール実行時の例外・上限超過は、ポート実装(server)が当該ルールを**当該セットのチェーンから除外して続行** + `ruleDisabled` 記録(E12 §4.8。自動無効化の閾値は E10/実装時)。core はフェイルセーフ(§2.5.5)で進行を守る。

**契約 v1 の確定**(E12 §4.6(2) の骨子との差分を含む完全版):

```ts
// packages/core/src/rules/contract.ts(契約 v1・確定)
export const ENGINE_CONTRACT_VERSION = 1;

export interface RuleMeta {
  ruleId: RuleId;                    // r{連番}-{slug}
  name: string;                      // 表示名(画面 3 バナー・画面 4)
  description: string;
  kind: "local" | "original";
  prefecture?: string;               // 任意(企画書 §4.1)
  proposalId: string;
  contractVersion: number;           // = 1
  messages: Record<string, string>;  // announce の messageKey → 文言テンプレート({param} 置換)
}

export interface RuleModule {
  meta: RuleMeta;
  hooks: Partial<RuleHooks>;
}

export type Legality =
  | { legal: true }
  | { legal: false; reasonKey?: string };

export interface Standings {
  standings: { player: PlayerId; standing: Standing; title: Title }[];
}

export interface RuleHooks {
  modifyLegality(ctx: RuleContext, play: Play, base: Legality): Legality;
  modifyStrength(ctx: RuleContext, base: StrengthOrder): StrengthOrder;
  afterPlay(ctx: RuleContext, play: Play): Effect[];
  afterFieldClear(ctx: RuleContext): Effect[];
  onGameStart(ctx: RuleContext): Effect[];
  onGameEnd(ctx: RuleContext, standings: Standings): Effect[];
}
// 注: RuleChainPort(§2.3)は modifyLegality を候補配列で一括呼び出しするが、
// ルール実装者(codex)が書くシグネチャは 1 プレイ単位のまま(バッチ化はホストブリッジの仕事)。

export interface RuleContext {
  contractVersion: 1;
  game: GameView;                    // 読み取り専用の全量ビュー(全員の手札を含む。サーバー内のみ)
  setHistory: GameResult[];          // 済んだゲームの結果(前戦の順位など)
  memory: {
    game: Readonly<Record<string, JsonValue>>;  // 自ルールの game スコープ KV
    set: Readonly<Record<string, JsonValue>>;   // 自ルールの set スコープ KV
  };
  rng: { next(): number; int(maxExclusive: number): number };  // 決定的(§2.6)
}

export interface GameView {
  gameIndex: number;
  seats: PlayerId[];
  direction: 1 | -1;
  turn: PlayerId | null;
  players: {
    id: PlayerId;
    hand: readonly Card[];           // ルールはサーバー側で秘匿情報を読める(E12 §4.3)
    status: PlayerStatus;
    standing: Standing | null;
  }[];
  field: FieldState;
  discard: readonly Card[];
  history: readonly PublicGameEvent[];  // このゲームのイベント列(「このゲームで 8 が何回出たか」等)
  strength: StrengthOrder;              // 現在の(チェーン適用済み)強さ順
}

export type Zone =
  | { kind: "hand"; player: PlayerId }
  | { kind: "field" }
  | { kind: "discard" };
// excluded はルールから操作不可(エンジン専用ゾーン)

export type CardSelector =
  | { kind: "specific"; cardIds: CardId[] }
  | { kind: "byRank"; rank: CardRank }
  | { kind: "random"; count: number }    // ctx.rng と同系の決定的乱数で解決
  | { kind: "all" };

export type Effect =
  | { type: "clearField" }
  | { type: "skipTurns"; player: PlayerId; count: number }
  | { type: "reverseTurnOrder" }
  | { type: "forceRank"; player: PlayerId; rank: Standing | "lowest" }
  | { type: "moveCards"; from: Zone; to: Zone; cards: CardSelector }
  | { type: "setMemory"; scope: MemoryScope; key: string; value: JsonValue }
  | { type: "announce"; messageKey: string; params?: Record<string, string> };
```

E12 骨子からの確定差分(いずれも E12 が「確定は E1」と委譲した範囲): `setMemory` に `scope` フィールド(§2.8)/ `forceRank` の `Rank` → `Standing` 改名 / `announce` に `params` 追加 / `modifyStrength` の引数名 `order` → `base`(modifyLegality と対称)/ `moveCards` の `Zone`・`CardSelector` の具体化(`excluded` 除外。具象化は `resolveCardSelector` §2.12)/ `RuleMeta.messages` の追加(announce 文言をコードでなくメタに置き、演出側の差し替えを容易にする)。

契約ドキュメント(`contract.ts` の doc コメント + 本書)には、§2.5.2 の発火表・§2.5.6 の許可表に加えて **E09 §2.4(3) の競合キー表を含める。Effect 語彙を追加する PR では競合キー表への行追加を必須手順とする**(E09 §5.3-4。`conflictKeyOf` の exhaustive switch により漏れはコンパイルエラーでも検出される)。

**(c) 画面仕様**: 直接の画面はない。`announce` → `ruleFired` イベントが画面 3 の発動バナー・ログ(CX-06)と `GameResult.firedRuleIds`(画面 5b の発動ルール一覧・E8 の評価対象)の供給源になることが本ストーリーの画面接点。

**(d) データ・API/イベント定義**: 契約 v1(上記)、`RuleChainPort`(§2.3)、`RuleChainEntry`(§2.2)。`meta.json` は `RuleMeta` と同内容(E12 §4.6(1))。

**(e) 実装方針**

- core は契約とチェーン呼び出し順序(§2.5)のみ実装。**フィクスチャルール**(8切り・革命・都落ち・スート縛り相当の 4 本)を `packages/core` のテスト内に置き、契約の実装可能性(E12 §7-6 の机上検証を実コードで裏付け)とチェーン機構のテストに使う。フィクスチャは製品コードにバンドルしない(BR-14)。
- server 側レジストリ・QuickJS ホストブリッジ(`RuleChainPort` の本番実装)は E7/TS-03 のスコープ。E1 のテストはプロセス内実装のポートで行う。

**(f) 受け入れ条件の精緻化(検証手順)**

1. **独立登録**: フィクスチャルール 4 本を任意の部分集合でチェーンに構成でき、互いのコードに依存しない(1 本だけの構成でもテストが通る)ことを確認する。
2. **有効/無効で挙動が変わる**: (a) 挙動差 — 8 のプレイを含むアクション列で「8切りフィクスチャ有効」と「無効」を実行し、有効時のみ場が流れることを確認する。(b) 乱数導出の独立性(§2.6)— **8 が一度も出ない(8切りが発動せず状態遷移列が同一になる)シード・アクション列**を選び、有効/無効の両実行で全状態列・全イベント列が一致することを確認する(切替ルールが遷移を変える場合に下流が変わるのは仕様であり、(a) と (b) は別のテストとして書く)。
3. **優先順位と競合解決**: 競合する 2 ルール(例: 同一プレイで同一プレイヤーへ `forceRank` を別順位で出す 2 フィクスチャ)で、最高優先側が `adopted`・他方が `rejected` になり、`rejected` 側の `announce` が `suppressed-announce` になること(E09 §3.1(b) トレース 1 相当)、同一ペイロードの場合は `deduped` になり両ルールとも発動扱い(§2.5.7)になること(同トレース 3 相当)を確認する。
4. **受け入れ境界の文書化**: 本書 §2.5(発火順序・許可表)・§2.8〜2.11・本節の契約 v1 が、自動実装ルールが従うべき境界の文書であることを README から参照可能にする(E7 はこの境界 + 差分ガード + §4.3 ハーネスを受け入れゲートとして使う)。

**(g) 未解決事項**

- ルール実行時エラーの自動無効化の閾値(E12 §7-8。E10/実装時に決定)。
- フィクスチャの縛りルールが `modifyLegality` で表現しきれるかは実装時の確認事項(場の履歴 `GameView.history` から直前プレイのスートを読む設計で足りる見込み)。

## 4. テスト観点(不変条件)

CI シミュレーション(E12 §4.7 手順 4)と core のプロパティテストで常時検査する不変条件。`sim/simulate.ts` ハーネス(下記 §4.3)が検査主体になる。

### 4.1 ゲーム進行の不変条件

1. **カード保存**: 全ゾーン(`hand×4 + field + discard + excluded`)の合併が常に 54 枚・重複なし(§2.2)。
2. **終局性**: すべてのゲームは有限手番で `finished` に達する。基本ルールでは「リードでは必ず 1 枚以上出せる(BR-7)」ため場は毎トリック最低 1 枚減り、自然に終局する。ルール介入下でもフェイルセーフ(§2.5.5)が進行を保証する。強制終局ガード(`turnCount > 1000`)の発動はシミュレーション上の**失敗**として報告する。
3. **順位の全単射**: `finished`/`retired` の `standing` は重複せず、終局時に 1〜4 が全て埋まる。
4. **手番の整合**: `turn` は常にアクティブプレイヤーであり、`skipCount`・`direction`・退場を反映した §2.5.1 手順 9 の計算結果と一致する。
5. **合法性の権威一致**: 受理されたプレイは、直前に生成した `legalMoves` に必ず含まれる(§2.7.2 の同梱方式の整合性)。

### 4.2 決定性・秘匿の不変条件

6. **リプレイ同一性**: 同一 `ReplayInit` + 同一アクション列 → 全スナップショット・全イベントがバイト単位で一致(§2.6)。
7. **乱数導出の独立性**: 状態遷移列が同一である限り、あるルールの有効/無効切替が他ルール・エンジンの乱数消費列を変えない(§2.6。GE-04 (f)-2(b) の形式でテストする)。AI 照会(§2.12)を挟んでも権威状態の `hookCalls`・乱数列が進まない。
8. **秘匿の保証**: 任意の時点・任意のプレイヤーの `PlayerSnapshot` に、他人の `hand` の内容・`excluded` の内容・KV メモリ・RNG 状態・`hookCalls` が現れない(redact のプロパティテスト。JSON 直列化して `CardId` の露出を走査する。公開情報(場・履歴・公開 `cardsMoved`)に出たカードは除外して判定 — E03 §4 の漏えい走査と同じ規約)。
9. **Effect ログの整合**: 収集された全 emission に E09 §2.4(4) の resolution ステータス(`adopted` / `deduped` / `rejected` / `superseded` / `suppressed-announce`)のいずれかが必ず付く。`firedRules` は §2.5.7 の述語の評価結果と常に一致する。
10. **JSON 直列化可能性**: `GameState` / `SetState` は JSON 値のみで構成され、`serialize` → `JSON.parse` の往復で同値になる(§2.2・§2.12 の前提)。

### 4.3 シミュレーションハーネス(E7 への提供物)

```ts
// packages/core/src/sim/simulate.ts
export interface SimulateOptions {
  games: number;                     // 例: CI 既定 200 セット
  seed: string;
  ruleChain: RuleChainEntry[];       // 検証対象ルールを有効化した構成
  port: RuleChainPort;               // CI ではサンドボックス実装を注入(E7)
  botPolicy?: "randomLegal";         // 合法手からシード乱数で選ぶボット(パスも選択肢)
}
export interface SimReport {
  completed: number;
  invariantViolations: { game: number; invariant: string; detail: string }[];
  failsafeActivations: number;       // §2.5.5 の発動回数(> 0 は要調査として報告)
  avgTurnsPerGame: number;
  ruleFiredCounts: Record<RuleId, number>;  // §2.5.7 の述語で計数。新ルールが一度も発動しない場合の検知に使える
}
```

- CI(CX-03)は「`invariantViolations` 0 件・強制終局ガード発動 0 件」をマージ条件にする。`failsafeActivations > 0` と `ruleFiredCounts[newRule] === 0` は警告(自動 fail にはしない — 発動条件が稀なルールがあり得るため。扱いは E7 で確定)。
- random-legal ボットは E2 の対戦 AI の最小実装例を兼ねる(E2 はこれを置き換える形で開発できる)。
- 実行時間の目安: 純粋関数 + プロセス内ポートなら 200 セットで数秒以内(E12 §2-1「全テスト数十秒以内」に収まる)。サンドボックス実装ポートでの所要は TS-03 の計測に含める。

## 5. 未決事項・他 Epic への修正提案・連絡

### 5.1 開発者の決定が必要な事項・E1 預かりの検討事項

1. **GE-01 基本ルール案(§3.1(b))の承認**。特にジョーカー 2 枚・配り切りの枚数差(BR-2/BR-4)、献上を含めない判断(BR-13)。
2. **choice 機構は暫定 B を確定とするか**(E12 §7-7)。本書は B 前提で契約 v1 を確定した(§2.11 で A への拡張余地は確保済み)。B 確定に伴う CX-01 の却下区分は §5.3(E7)に引き継ぎ済み。
3. **強制終局ガードの上限値**(§2.5.5 の 1000 手)と KV クォータ(§2.8)の初期値。いずれも保守的な仮置きであり、TS-03 の計測後に調整してよい。
4. **契約 v2 候補の検討バックログ(E1 預かり。v1 では実装しない)**: choice 機構(案 A。§2.11)/ `afterPass` フック(§5.2-5)/ KV メモリのキー単位可視性区分(E02 §6-3。§5.3 E2-2)/ アトミック Effect グループ(E09 §3.1(f)-1)。実運用の却下・競合データ(OP-02・`conflict_events`)を優先度判断の材料にする。

### 5.2 E12・E3 への修正提案(相手文書は本書からは変更しない。反映は各文書側の更新で行う)

**E12 へ**:

1. **§4.1「ゲームロジックの共有」**: クライアント合法手プレビューは「サーバーが合法手集合をスナップショットに同梱する」方式を**初期から採用**と確定した(§2.7.2)。「初期は共有ロジック・後に移行」の併用案は不採用。web が core から使うのは型・表示ユーティリティのみとなる旨の更新を提案する。
2. **§4.6(2) Effect 語彙**: `setMemory` の `scope` フィールド、`forceRank` の `Rank` → `Standing` 改名、`announce` の `params`、`Zone`/`CardSelector` の確定(§3.5(b))。骨子コメントの「確定は E1」への回答であり矛盾ではないが、E12 のコード片を確定版に差し替える更新を提案する。
3. **§4.6(3) 競合解決**: 「矛盾する Effect」の定義・同点タイブレークは **E09 §2.4・§2.2 で確定済み**であり、本書 §2.5.3 はその実装仕様。E12 の暫定文(「同点の暫定案はルール登録の古い順」)の更新は E09 §5.2-1 が既に提案済みのため、本書からの重複提案はしない(E12 更新時は E09 の文言を正とする)。
4. **§6 合法手列挙**: 「候補生成はエンジンの生成器レジストリが握り、ルールは判定のみ。手の種類追加はエンジン拡張(人手レビュー)」で確定(§2.9)。E2 の探索設計はこの前提でよい(E02 §3.1(b) は両案いずれでも AI 側変更不要と確認済み)。
5. **パス起点のフックが契約 v1 に無い**: 「パスしたら〜」系の提案ルール(例: パス縛り)は v1 で表現できない。頻出するようなら `afterPass` フックの追加(契約のマイナー拡張)を検討する。CX-01 の線引き資料への追記は §5.3(E7)に含めた。

**E3 へ**(E03 の該当記述の更新提案):

6. **合法手集合の同梱(E03 §2.3 配信可否表・`GameView.legalPlays?: CardId[][]` 予約・§5.3-6)**: E1 の決定(§2.7.2)により「フェーズ 1 から同梱」へ更新を提案する。型は `CardId[][]` ではなく **`Play[]`**(§2.2。ジョーカー代用の代表ランク・種類を含むため、クライアントは一致判定だけで済む)。配信は手番プレイヤーのビューにのみ載せる点は E03 の per-player フィルタ方式にそのまま乗る。
7. **借用型の実体確定の連絡(E03 §2.2 共有型定義)**: E03 が `unknown` と置いた `PublicPlay` は本書の `PublicGameEvent`(`played` / `passed`)、`GameResultView` は `GameResult`(§2.2)が実体。`Card` の形は §2.2(E03 の骨子 `{ id, suit, rank }` と異なり判別可能ユニオン)。`GameView.history` の全量方針は E03 §2.3 と一致済み(§2.7.1)。
8. **バックログへの気づき(ストーリー変更はしない)**: GE-03 の受け入れ条件「ゲーム終了時に全員の結果が表示される」の画面実体は GE-05 の画面 5a と同一であり、GE-03 単体の完了判定はイベント・データの充足(§3.3(f)-2)で行うのが実務的。次回バックログ更新時の注記候補。

### 5.3 他 Epic への回答・連絡

#### E9(優先順位)— E09 §5.3 の引き継ぎ要求への対応表

| E09 の要求 | 本書の対応 |
|---|---|
| §5.3-1 バッチ内の全フックが同一の不変状態ビューを受け取る | §2.5.3 手順 1 で契約化(Effect・`setMemory` の適用は解決後) |
| §5.3-2 `CardSelector` の具象化 API | `resolveCardSelector`(§2.12)を core の公開純粋関数として追加。`resolveEffectBatch` の union-find 競合判定と Effect 適用の双方が使用 |
| §5.3-3 適用順 `(position, effectIndex)` とカスケードの非交互実行・深さ上限 | §2.5.4 で採用。**契約 v1 の語彙ではカスケードは構造的に最大 1 段**(afterFieldClear 内の `clearField` は no-op)であり、上限値は E09 の暫定どおり 8 で実装するが v1 では到達しない(E09 §3.1(f)-4 への回答) |
| §5.3-4 語彙追加時の競合キー表の行追加を契約ドキュメントの必須手順に | §2.5.3 末尾に必須手順として明記。`conflictKeyOf` の exhaustive switch で機械的にも強制 |
| §5.3-5 変換フックの入出力差分検出を権威判定経路にのみ | `RuleChainPort` の `influenced`(§2.3)+ §2.5.1 手順 3-c・§2.5.7。AI 照会は複製状態上で権威記録に触れない(§2.12) |
| (整合の連絡)moveCards の競合キー | 本書初稿の「`from:to:ruleId` で原則併存」案は破棄し、**E09 §2.4(3) の具象集合 union-find に統一**した(§2.5.3) |
| (整合の連絡)チェーン表現 | `RuleChainEntry` は独自の優先度数値を持たず **`position` + `PriorityKey`**(E09 §2.1/§2.2)を参照する形に統一。同点タイブレークは `activatedAt` 昇順 → `ruleId` 辞書順 |

#### E8(評価と淘汰)— セット終了時の書込み素材(E08 §2.1・§5.2 提案 2 への応答)

エンジンは `setResult` 到達時に次の `SetOutcome` を返し、**server(E3 の部屋層)が DB へ書く**(E1 は I/O を持たないため書込み主体にならない):

```ts
export interface SetOutcome {
  setId: string;
  standings: { player: PlayerId; totalStanding: Standing; title: Title; points: number }[]; // AI 含む(game_sets.standings 素材)
  members: SetMember[];              // isAI 付き。set_participants には isAI=false の席だけを
                                     //   userId に対応付けて入れる(対応付けは E3。AI 席は入れない — E08 §2.1)
  wasActiveRuleIds: RuleId[];        // = ruleChain 全件(set_rules.was_active 素材。E09 の set_rule_snapshots とも一致)
  firedRuleIds: RuleId[];            // = 各 GameResult.firedRuleIds の和集合(set_rules.did_fire 素材)
  results: GameResult[];             // ゲームごとの順位・発動ルール
}
```

- **`set_rules.did_fire` の判定述語は本書 §2.5.7(= E09 §2.4(7))であり、E8 は発動判定ロジックを持たない**(E08 §3.2 の前提どおり)。`did_fire` = 3 戦のいずれかで発動、はこの和集合で満たす。
- `was_active` 集合と E09 `set_rule_snapshots` の ruleId 集合の一致は共有の不変条件(E09 §5.4-4)。テーブル統合の判断は E09 §5.4-4 のとおり実装時に E1/E3・E8・E9 で確定する。

#### E2(対戦 AI)— E02 §3.1(c)・§6-3・§6-8 への回答

1. **`SimulationApi`**: §2.12 で契約に追加した(E02 の要求シグネチャどおり。`SeatId` ↔ `PlayerId` の対応だけ E3 の席割当に従う)。core は QuickJS isolate 内で動作し、`GameState` の JSON 直列化可能性を不変条件(§4.2-10)として保証する — sim isolate への core + ルールバンドル持ち込み(E02 §3.1(d))の前提はこれで満たされる。
2. **KV メモリの可視性区分(E02 §6-3)**: **契約 v1 では導入しない**。v1 語彙で KV に書ける値はルール自身が `ctx` から観測した情報に限られ、AI が決定化の初期値としてコピーを読んでも、人間プレイヤーに対する構造的な情報優位は限定的(E02 自身の評価と同じ)。「秘匿情報を KV に書くルール」が実際に現れた時点で、契約 v2 の候補(キー単位の公開/秘匿宣言、または AI 決定化用の KV マスク)として E1 が検討する — §5.1 の検討事項に登録した。
3. **`moveCards` の可視性(E02 §6-8)**: §2.5.4 で定義した — 公開ゾーン(`field`/`discard`)が絡む移動はカード面公開、`hand` → `hand` は全員には**枚数のみ公開**(`cardsMoved` イベント。札面は当事者のスナップショットにのみ現れる)。これにより v1 でも部分観測手(ランダムセレクタの hand→hand 移動)が生じうるが、E02 §2.4 の graceful degradation の範囲。観測整合フィルタの置き場所は**決定化器(E2)側**とし、エンジンは `cardsMoved` に from/to/枚数(公開時は札面)を含めることで観測材料を提供する。

#### E7(codex パイプライン)— CX-01 の却下区分への引き継ぎ

契約 v1 で構造的に実装できない提案の却下区分を、CX-01 の線引き資料に明記してほしい:

| 却下区分 | 該当する提案 | 根拠 |
|---|---|---|
| 契約 v1 非対応(追加入力) | 7渡し・10捨てなど「選ぶ・宣言する」系 | §2.11(E12 §7-7 暫定 B) |
| ~~エンジン拡張が必要(手の種類)~~ | ~~階段など「出せる手の種類を増やす」系~~ | 2026-07-30 改訂: 階段・ジョーカーは engineFeatures 宣言で実装可能になり却下対象外。未対応の手型・カード種は reject でなく needs_review(語彙拡張の検討材料)とする |
| エンジン拡張が必要(フック不足) | パス起点(「パスしたら〜」)系 | §5.2-5(`afterPass` は v1 に無い)。同上の方針により needs_review とする |

これらの却下は**採用率(企画書 §11 の成功指標)を構造的に下げる方向に働く**。OP-02 の却下内訳で「契約制約による却下」を独立区分として計測し、頻度が高い区分から契約拡張(v2)の優先度を決める材料にすることを推奨する(E7/E10 へ)。
