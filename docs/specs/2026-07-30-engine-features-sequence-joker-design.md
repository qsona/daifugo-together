# エンジン機能宣言 (engineFeatures)・階段・ジョーカー設計

日付: 2026-07-30
状態: 実装中
背景: developer 提案「階段」(01KYQNNS0QARBJJRB8M5TJ4TT3) と「ジョーカー(2枚・オールマイティ)」(01KYQNNS31SPSYD7A4DME9Q2D1) が CX-01 で contract/A3 (エンジン拡張が必要) として reject された。定番ルールが表現できないのは契約語彙の不足であり、エンジン側を拡張して両提案を実装可能にする。あわせて、表現力不足を理由とする reject を needs_review へ改め、将来の語彙拡張につなげる審査方針へ変更する。

## 方針の要約

1. **候補生成はエンジン専権のまま**(E01 §2.9 の設計判断は維持)。階段・ジョーカーはエンジンのネイティブ機能として実装し、ルールモジュールは **宣言 (engineFeatures)** でそれを有効化する。サンドボックス制約・CPU 予算・スナップショット同梱の前提は崩さない。
2. **contract v1 の後方互換なマイナー拡張**とする (contractVersion は 1 のまま)。既存ルール・既存リプレイに影響しない: engineFeatures 未宣言のルールチェーンでは挙動は完全に従来どおり。
3. 審査 (CX-01) は「契約語彙で表現できない」case を reject ではなく **needs_review** に倒し、開発者がエンジン語彙を拡張するか判断する。reject は真に対象外のもの (追加入力・外部依存・進行/参加破壊など) に限定する。
4. プロンプト版を上げたとき、**未確定 (developer 未 confirm) の AI 判定は再判定対象に戻る**。保留中の 2 件はこの機構で cx01-v4 により再判定される。

## 1. engineFeatures 機構

### 型 (packages/core/src/rules/contract.ts)

```ts
/** エンジンのネイティブ機能のうち、ルールが宣言で有効化できるもの。 */
export type EngineFeature = 'sequence' | 'jokers';

export interface RuleMeta {
  // 既存フィールドは不変
  /** このルールが要求するエンジン機能。省略時は []。 */
  engineFeatures?: readonly EngineFeature[];
}

export interface RuleChainEntry {
  // 既存フィールドは不変
  engineFeatures?: readonly EngineFeature[]; // meta から転記される
}
```

- ゲームで有効な機能集合 = ルールチェーン全エントリの engineFeatures の和集合。`GameConfig` は変更しない (ruleChain から導出)。
- 転記箇所: server の `RulesService` がルール登録時に meta から保存し、部屋のチェーン構築時に entry へ載せる。sim の `entries(modules)`、replay も同様。
- `engineFeatures` は **機能の有効化のみ**を意味する。挙動の詳細 (あがり禁止等) は従来どおり hooks で書く。

### 機能 'sequence' (階段)

- `PlayKind` に `'sequence'` を追加。
- 定義: **同一スートで、CARD_RANKS 順 (3..A,2) で連続する 3 枚以上**。ラップアラウンド (2→3) なし。ジョーカー機能が同時に有効なら、ジョーカーは任意の位置を代用できる (スートは列のスートとみなす)。ただし自然カード 1 枚以上を含むこと。
- `Play.count` = 枚数。`Play.repRank` = **連続列の上端 (CARD_RANKS 順で最大のランク)**。ジョーカーが上端を代用する場合も代用先のランクを用いる。**規範**: 任意の StrengthOrder 下で、階段の強さは「上端 repRank の ranking 上の位置」として定義する。厳密な反転 (革命) では同枚数の連続列について上端の反転比較と下端の反転比較が同値であり、提案文の「革命中は最も低いランクが強い」と一致する。反転以外の任意順列ではこの定義 (上端比較) が正となる。
- 合法判定 (baseLegality): 場が sequence のとき、同 kind・同 count・repRank がより強い、のみ。スートの一致は要求しない (提案文に従う)。場が single/set のとき sequence は出せない (逆も同様)。K-A-2 のように上端が 2 の連続列は有効 (ラップアラウンド 2→3 のみ禁止)。
- 候補生成: 生成器レジストリ (`CandidateGenerator`) を導入し、`single` / `set` / (有効時) `sequence` の生成器で構成する。E01 §2.9 の予約どおり。

### 機能 'jokers' (ジョーカー 2 枚)

- `Card` を判別可能ユニオンに拡張 (E01 §2.2 の予約どおり):
  ```ts
  export type Card =
    | { kind: 'natural'; id: CardId; suit: Suit; rank: CardRank }
    | { kind: 'joker'; id: CardId; index: 0 | 1 }; // id: 'JK0' | 'JK1'
  ```
- `createDeck(features)`: 'jokers' 有効時のみ 54 枚 (JK0, JK1 を追加)。配札は既存実装が不均等 (14/14/13/13) に対応済み。
- `Play.repRank: CardRank | 'joker'`。
- 意味論 (旧 BR-4 = E01 の確定仕様どおり):
  - 単体のジョーカーは **最強** (`repRank: 'joker'`)。ranking の反転 (革命・イレブンバック) の影響を受けず最強のまま。JK 単騎対 JK 単騎は `compareRanks = 0` で TOO_WEAK (乗せられない)。場の JK 単騎に 2 などの自然カードは出せない (例外はスペ3返し等のルールが `modifyLegality` で base の TOO_WEAK を legal に上書きして表現する。契約変更不要)。
  - set / sequence では任意カードの代用 (ワイルドカード)。set の枚数範囲は従来どおり 2..4 (ジョーカー込みでも 5 枚組は生成しない)。repRank は代用を含む実効ランク。ジョーカー 2 枚のみのペアは `repRank: 'joker'` で最強のペア。sequence は自然カード 1 枚以上を要求 (JK は 2 枚しかないため 3 枚下限からも自動排除)。
  - `compareRanks` は `'joker'` を全ランクより強い (+∞) として扱う。`StrengthOrder` の shape (`{ ranking }`) は変えない (safe-port の検証・既存 modifyStrength ルールへの互換のため)。E01 §2.2 が予約していた `jokerSingleTop: boolean` は採用しない (ジョーカー最強はエンジン固定とし、可変性は modifyLegality で表現する)。E01 §2.2 の当該予約は本設計に合わせて改訂する。
  - **候補の重複除去**: 同一 (kind, count, repRank, 自然カード ID 集合, ジョーカー使用枚数) の候補は 1 つに正規化する (使用するジョーカーは ID 昇順で選ぶ)。同じカード ID 集合でも repRank や kind が異なる解釈は別候補として保持する。
- `CardSelector.byRank` はジョーカーを選択できない (既存の制約のまま)。ジョーカーを対象にする moveCards が必要になった時点で selector 語彙を拡張する。

### プレイ解釈の刷新 (interpretPlay → 候補照合)

ワイルドカード・階段導入で「カード集合 → Play」が一意でなくなる (例: 7♠+JK0+JK1 は 7 の 3 枚組にも 5♠-6♠-7♠ 相当の階段にもなりうる。4♠-5♠-JK の JK は 3 か 6)。なお同一スート規範により 7♠7♥JK のようなスート混在の集合は階段にはなり得ない (set のみ)。

- クライアントは従来どおり **CardId 列のみ**を送る (E01 §合意済み)。`GameAction.play.kind` (既存の予約フィールド) を任意で受け付け、protocol の `game:play` スキーマにも optional `kind` を追加する。
- reducer は選択カード集合と一致する候補 (生成器の出力) を全て集め:
  1. `kind` 指定があればその kind に絞る。
  2. 合法な解釈 (failsafe 発動時は failsafe 後の最終合法集合で判定する) があればそのうち **最弱**を採用する (プレイヤー有利の最小コミット)。「最弱」は `evaluateCandidates` が算出した **実効 StrengthOrder** (modifyStrength 適用後) 上の repRank 位置で比較する ('joker' は +∞)。
  3. 同順位のタイブレークは決定的に行う: kind の優先順 single < set < sequence、次いでカード ID 列の辞書順。リプレイ安定性のため生成順に依存しない。
  4. 合法な解釈がなければ従来どおり reject する。拒否コードの出し分け (CARD_NOT_IN_HAND / INVALID_PLAY_SHAPE / TOO_WEAK / FORBIDDEN_BY_RULE) は現行 reducer と同じ規則を維持する。
- 既知の制約 (受容): repRank ヒントはワイヤに載せないため、同一カード集合で複数解釈が合法なとき、プレイヤーは最弱解釈より強い解釈を意図的に選べない (kind でのみ絞れる)。必要になれば action への repRank ヒント追加を将来検討する。AI (MCTS) が選んだ解釈もサーバでは同規則で再解釈される。
- `interpretPlay` の「枚数 > 4 で reject」は撤廃し、生成器と同じシェイプ判定に委譲する。protocol の `cards` 上限 (`max(4)`) は 14 に緩和する (手札上限)。engineFeatures 未宣言の部屋では 5 枚以上はエンジンの INVALID_PLAY_SHAPE として reject される (従来は zod の BAD_PAYLOAD。応答経路のみの差で実害なし)。

### 変更ファイル一覧 (core)

- `cards/card.ts`: Card ユニオン、JK ID/生成、createDeck(features)、compareCards のジョーカー順 (ソートでは最後尾)。
- `play/play.ts`: PlayKind、Play.repRank、interpretPlay の置き換え (候補照合ヘルパへ)。
- `play/candidates.ts`: CandidateGenerator レジストリ、sequence/ワイルド生成、baseLegality。
- `play/strength.ts`: compareRanks の 'joker' 対応 (シグネチャは repRank 型を受ける)。
- `game/start-game.ts`: createDeck(features)。features 導出ヘルパ (`engineFeaturesOf(ruleChain)`) は rules/contract.ts 近傍に置く。
- `engine/reducer.ts`: 候補照合ベースの reducePlay。
- `rules/safe-port.ts`: 変更不要 (StrengthOrder shape 不変)。ただし検証はそのまま通ることをテストで確認。
- `snapshot/snapshot.ts`: inverted 判定は ranking (13 ランク) のまま影響なし。legalPlays 同梱は生成器経由で自動追随。
- protocol/AI/web/sim の追随は §3。

## 2. 審査 (CX-01) とパイプラインの変更

### プロンプト cx01-v4 (packages/pipeline/src/judge-prompt.ts)

- CONTRACT 節に追記:
  - `engineFeatures 宣言: ルールは meta の engineFeatures で 'sequence' (階段: 同スート連続3枚以上の手型) と 'jokers' (ジョーカー2枚・単体最強・ワイルド代用) を有効化できる`
  - 表現できないものから「新しい手の種類」を削除し、「engineFeatures にない手型・カード種の新設」へ置換。
- CRITERIA 節の A3 の扱いを変更:
  - 「契約語彙・engineFeatures で表現できないが、ゲーム進行として成立するルール」は **reject ではなく needs_review** とし、内部理由に不足している語彙を明記する (開発者が語彙拡張を検討する)。
  - reject (contract) は A1 (追加入力)・A4 (外界依存) など構造的に不可能なものに限定する。
- SPEC スキーマ: `engineFeatures?: string[]` を追加 (approve 時のみ、既知集合から選ぶ)。

### SPEC / scaffold / サーバ検証

- `RuleSpecification` に `engineFeatures: EngineFeature[]` (省略時 []) を追加。
- server `parseSpec` (pipeline/service.ts): 既知集合 {'sequence','jokers'} で検証。
- scaffold (pipeline/scaffold.ts): meta.json に `engineFeatures` を転記。
- rules 登録 (server/rules/service.ts): meta の engineFeatures を検証 (既知集合外は登録 fail-closed) し、チェーン構築 (availableRules) で RuleChainEntry へ転記。DB への永続化は不要 — rules テーブルは meta を保存しておらず、meta はデプロイ済みコード (code registry) が唯一の保存場所であるため。リプレイは record_json 内の ruleChain に engineFeatures ごと保存され round-trip する。

### 再判定機構

- `pendingCx(limit, currentPromptVersion?)`: 従来の「AI 判定なし」に加え、`currentPromptVersion` 指定時は **latest AI 判定が未確定 (developer confirmation なし) かつ promptVersion ≠ current (NULL は常に ≠ とみなす)** の提案を含める。`currentPromptVersion` 未指定時は従来挙動 (後方互換)。
- confirm 済み判定の再判定は構造的に起きない: confirmCxRejection は proposal を rejected へ、approveSpec は implementing へ遷移させるため、screening のみを見る `screeningForJudgment()` から外れる。
- 旧版・未確定判定を持つ提案は再判定対象と pendingConfirmations の両方に載る (許容する)。旧判定を developer がそのまま confirm することは引き続き可能であり、再判定が新しい判定を挿入した後は latest ガード (`latestAiJudgement(...)?.id !== source.id` → conflict) が旧判定の confirm を弾く。
- admin API のスクリーニング一覧エンドポイントに `promptVersion` クエリを追加し、pipeline (judge-run) は常に自分の `CX01_PROMPT_VERSION` を渡す。
- `recordAi`: 既存の runId 冪等性 (同一ランの再送は already_recorded) は**そのまま維持**する。加えて「latest AI 判定の promptVersion が送信判定と同一」の場合も already_recorded とする (旧版判定があるだけなら新規挿入し、それが latest になる)。promptVersion ベースの重複防止に DB 制約は置かないため並行ラン時の競合はあり得るが、latest が勝つ規則により実害はない。approveSpec の「latest 判定のみ承認可」ガードはそのまま機能する。

### implement-rule スキル

- `.agents/skills/implement-rule/SKILL.md`: SPEC.json の engineFeatures は scaffold が meta.json に転記済みであること、hooks では機能の再実装をしないこと (階段の形の判定・ジョーカーの代用はエンジンがやる) を追記。

## 3. 周辺の追随

- `core/src/protocol.ts`: `cards` の `.max(4)` → `.max(14)`、`game:play` に optional `kind` を追加。Card の zod スキーマは存在しない (client→server は CardId のみ) ため他の実行時検証変更は不要。server→client の TS 型はユニオン化に自動追随。旧クライアントが `kind:'sequence'` や suit なしカードを受けるのはジョーカー/階段ルールを含む部屋に限られる。
- `packages/ai`: heuristic の BASE_RANKING 複製を core import に置換 (境界検査が type import を許すか確認し、不可なら複製を更新)。`repRank 'joker'` は ranking 外 → 最強扱い (現行の `?? MAX_SAFE_INTEGER` の挙動を明示化しテストで固定)。
- `packages/web`: `CardView` にジョーカー表現 (suit なし札) を追加、`App.tsx` の変換点で分岐、`guide.ts` の複数枚ガイド文言を確認。
- `packages/sim` / fixtures: カード枚数保存チェックが 52 固定なら「configured deck size」に一般化。
- `docs/epics/E01-game-engine.md`: §2.9 ほか「階段・ジョーカーは reject」の記述を engineFeatures 経由の実装可能へ更新。

## 4. 両提案の実装イメージ (検証用)

- 階段: `meta.engineFeatures = ['sequence']`、hooks なし。
- ジョーカー: `meta.engineFeatures = ['jokers']`、hooks = afterPlay で「最後の手にジョーカーを含めて上がったら forceRank 'lowest'」。

この 2 つをプロトタイプとして core の統合テストで実走し、実装可能性を保証する。

## 4.5 後方互換性の担保

- **既存ルールソース**: Card のユニオン化により `play.cards.some((c) => c.rank === '8')` (r0001-eight-cut) は型エラーになるため、`c.kind === 'natural'` の narrowing を入れる修正を本変更に含める。**挙動は不変** (ジョーカーは 8 とみなさない = ジョーカーが 8 を代用しても 8切りは発動しない。これを r0001 の仕様として固定しテストで明示する)。rule.ts 変更により bundleHash が変わるため、server のルール再登録 (rule_versions) が正しく新バージョンを作ること、既存リプレイが bundleHash 警告つきで再生できることを統合検証 (T6) で確認する。
- **旧リプレイ**: 旧 ReplayInit の entry に engineFeatures はない → `engineFeaturesOf` が [] を返し 52 枚デッキ・従来生成器のみ、で完全に従来挙動。これをリプレイ後方互換テストで固定する。
- **engineFeatures 未宣言のチェーン**: デッキ 52 枚、生成器は single/set のみ、interpretPlay 相当の解釈も一意 → 全既存テストが無変更で通ることを担保とする。

## 5. 非目標 / 既知の残課題

- effect フック (afterPlay 等) の `ctx.game.strength` が常に基本順序である問題は本設計の範囲外 (革命系ルールの実装時に扱う)。
- 縛り系ルールとジョーカーのスート解釈 (ジョーカーは「スートなし」= 縛り条件を満たさない扱いを既定とする) は当該ルールの SPEC で確定する。
- イレブンバック等「場が流れるまでの一時状態」は memory + modifyStrength で表現可能なため語彙追加はしない。
- contractVersion 2 への引き上げは行わない (全変更が加法的・後方互換のため)。
