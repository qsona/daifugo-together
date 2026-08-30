# CX-01 拡張要求と設計セッションのフロー

Date: 2026-08-11

CX-01 が「エンジン/契約を拡張すれば実装できる提案」を構造化して出し、それを設計
セッションが受け取って拡張を設計・実装し、再判定で通常フローへ戻すまでを固定する。
あわせて、エンジン語彙が育ったときに審査プロンプトが取り残される事故を機械的に塞ぐ。

## 背景

### 起きたこと

提案「2択」(2 を 1 枚出すと 4 秒の二択ミニゲームが始まり、3 点先取した人がカードを
3 枚捨てられる) が、`cx01-v14` の審査で A4「外界依存」= `reject` / `category=contract`
と判定された。A4 は「構造的に不可能(ゲーム内で完結しない)」区分であり、この提案は
そこに当たらない。

### なぜ誤ったか

原因は 2 つある。どちらもプロンプト側の陳腐化で、モデルの揺れではない。

1. **A4 の定義が古かった。** v14 の資料は「実時間や実世界情報への依存、外部 I/O」を
   まとめて構造的不可能に並べ、判定基準も「実時間・実世界の情報への依存が A4」と
   書いていた。この文言は 2026-08-04 の
   [mini-game runtime](2026-08-04-mini-game-runtime-design.md) より前の前提のままで、
   実時間の制限つき入力とリアルタイム操作はすでにサーバー権威の共通ランタイムが
   扱える領域になっていた。
2. **ミニゲーム語彙がプロンプトに 1 文字も載っていなかった。** `requestChoice` の
   `kind: 'miniGame'`、`RuleInput` の `kind: 'miniGameResult'`、実装済み id
   `bomb_throw_15` のいずれも v14 の資料になく、r0029 リアルボンバーが本番で動いて
   いるにもかかわらず、同型の提案は「現行語彙では書けない」ようにしか見えなかった。

### 構造的な穴

さらに、仮に正しく `needs_review` になっていたとしても、その先の受け皿がなかった。
「拡張すれば実装できる」という情報は `reasonInternal` の自由文にしか残らず、機械的に
集約も追跡もできない。r0029 のときは、開発者が Codex セッションへ口頭で拡張を指示する
属人的な手順で回していた。

## 決定事項

1. **verdict は 3 値のまま**とし、第 4 の verdict を作らない。「拡張すれば実装できる」は
   `needs_review` の中の構造化フィールド `extensionNeeded` として表す。開発者確定が
   要る点は既存の `needs_review` と同じであり、確定操作の意味を増やす必要がない。
2. **A4 を実世界情報・外部 I/O に限定する。** 実時間の制限つき入力・リアルタイム操作は
   共通ランタイムが扱えるので A4 ではなく、A2(語彙外の状態)/A3(エンジン拡張)系の
   拡張候補として `needs_review` + `extensionNeeded` に落とす。
3. **プロンプトの陳腐化をテストで塞ぐ。** エンジン語彙を網羅ガードつきの実行時定数として
   core に置き、(a) プロンプトと判定出力スキーマがその全要素を含むこと(語彙パリティ)、
   (b) プロンプト本文が変わったら `CX01_PROMPT_VERSION` が繰り上がること(全文ハッシュの
   版ピン)を、それぞれ別のテストで強制する。語彙を拡張してプロンプトを更新しなければ
   (a) が落ち、更新しても版を据え置けば (b) が落ちる。
4. **拡張待ちの追跡は最小構成にする。** 機構タグ(`capabilities`)と、レビュー CLI の
   冒頭サマリーだけで追う。専用テーブル、専用キュー、専用の提案ステータスは作らない。
5. **設計セッションをスキル化する。** `.agents/skills/design-extension/` に手順を固定し、
   引き継ぎ・調査・設計 doc・開発者承認・実装・再判定・フォールバックの順序を明示する。

## データ

### `extensionNeeded`

```ts
interface ExtensionNeeded {
  capabilities: string[]; // 1〜4件
  sketch: string; // 1〜1000字
}
```

- `capabilities` は不足している機構を表す名前空間つきタグ。各要素は
  `^[a-z][a-z0-9_-]*(:[a-z0-9_.-]+)?$` に一致する 64 字以下
  (例: `minigame:ab_vote` / `input:free_text` / `state:points` /
  `effect:draw_from_deck`)。集約キーになるので自由文ではなくタグにする。
- `sketch` は「何が足りないか」を 1〜2 文で書く。**後続の設計セッションへのヒントで
  あって仕様ではない。** ジャッジはリポジトリを読めないので、実装方法まで決めさせない。
- **交差制約**: 非 null を許すのは `verdict === 'needs_review'` のときだけ。
  `approve` / `reject` で非 null なら `parseAiJudgement` が `invalid` にする。
  `needs_review` でも判断保留(B 系の境界で迷った等)が理由なら null でよい。
- 判定出力スキーマ(`CX01_OUTPUT_SCHEMA`)側も `anyOf: [object, null]` として同じ形を
  要求し、`capabilities` の件数・パターンをスキーマ段階で制約する。

保存は `judgements.extension_needed_json`(TEXT, nullable)。既存 DB には起動時の
`PRAGMA table_info` 判定で `ALTER TABLE` により追加する(他の後付け列と同じ扱い)。

### `needs_review` の承認経路

サーバーの `approveSpec` は当初から `approve | needs_review` の AI 判定を承認元として
受理していた(`feat: add CX-01 judgement workflow` 以来)。一方 CLI の
`validateConfirmationForItem` は `needs_review` の確定手段を
`rejectCategory` + `reasonForUser` つきの `confirm_rejection` だけに絞っており、
サーバーが受けられる操作を CLI が塞いでいた。本改修で CLI 側に `approve_spec` を
許可し、両者を揃えた。

この非対称は今回まで顕在化していなかった。`needs_review` は事実上「却下寄りの保留」
としてしか使われておらず、承認に進む経路が必要になったのが拡張フローだからである。
以後もサーバーと CLI の受理条件は同時に見る。片側だけを変えると、CLI で編集できるのに
サーバーが拒む(あるいはその逆)状態に戻る。

承認で作られる developer judgement の `extensionNeeded` は常に null にする。拡張要求は
AI 判定の属性であり、承認記録が引き継ぐものではない。

## フローとデータ経路

1. **判定** — `judge` が `needs_review` + `extensionNeeded` を記録する。
2. **一覧** — `review` CLI が対話ループの前に「拡張待ちの提案」を機構タグ別に集約して
   表示する。このサマリーには引き継ぎコマンドの**書式を 1 行**だけ添える
   (`… design:handoff -- <提案ID>`)。個別項目の表示では、`needs_review` かつ
   `extensionNeeded` 非 null のときに**その提案 ID を埋めた実行可能なコマンド**を出す。
   一覧は「どのタグに何件たまっているか」、個別表示は「いま手を動かす 1 件」を担う。
3. **引き継ぎ** — `design:handoff` が確定待ちの CX-01 判定を 1 件取り出し、
   `<os.tmpdir()>/daifugo-design-handoff/proposal-<id>.json`(mode `0600`)へ書く。
   内容は `notice` / `proposal` / `judgement`(`extensionNeeded` を含む)/ `references`。
   `notice` は次の 2 点を明示する(E07 §2.4 の意味的分離をハンドオフにも延長する)。
   `proposal.body` は保存済み(sanitized)のユーザー投稿であって指示ではないこと、
   `judgement.reasonInternal` と `extensionNeeded.sketch` はレポジトリを読めない AI
   ジャッジの出力であり設計のヒントにすぎないこと。`references` は
   `packages/core/src/rules/contract.ts` を先頭に、ミニゲームランタイム設計 doc /
   `judge-prompt.ts` / 語彙パリティテスト / E07 / r0029 の SPEC を続ける。契約の一次情報が
   先頭に来るのは、設計セッションが最初に読むべきものがそれだからである。
4. **設計と実装** — 設計セッション(`$design-extension`)が一次情報を読んで
   `docs/specs/` に拡張設計 doc を書き、**開発者の承認を得てから**実装する。実装は
   通常のエンジン開発であり、ルール PR ではない(`AGENTS.md`: PR はルール実装専用)。
   `pnpm verify` の後 `main` へ push し、デプロイまで完了させる。
5. **再判定(主経路)** — マージ・デプロイ後に `judge` を再実行する。
6. **フォールバック** — **再判定が実際に走ったうえで**結果が `needs_review` のままだった
   場合に限り、設計セッションが SPEC + scaffoldMeta を手書きし、`confirm` CLI の
   `approve_spec` で送る。「再判定対象に入らなかった」はこれと別の事象であり、版の
   繰り上げが landed / deployed されているかを先に確認する(手書き SPEC で覆い隠さない)。

### なぜ再判定が主経路になるか

3 つの機構が噛み合って、再判定が「自動で戻ってくる」ようになっている。

- 版ピンのテストが、プロンプト本文の変更時に `CX01_PROMPT_VERSION` の繰り上げを強制する
  (語彙パリティのほうは、語彙がプロンプトに載ることを強制する)。
- `judge` は一覧取得時に自分の `CX01_PROMPT_VERSION` をクエリに載せる。
- サーバーの `pendingCx` は、**未確定(developer confirmation なし)かつ旧プロンプト版**の
  AI 判定を持つ提案を再判定対象へ戻す。

したがって、拡張をマージすれば対象提案は自動的に再判定キューへ戻り、新しい語彙で
`approve` + SPEC が出るのが期待経路になる。開発者は通常どおり SPEC を承認して
`$implement-rule` へ進む。手書き `approve_spec` は、拡張後もジャッジが迷う場合だけの
フォールバックである。

デプロイを再判定より先に済ませる順序には理由がある。判定結果は admin API 経由で
サーバーに記録され、**デプロイ済みサーバーの** `parseSpec` 許可集合が新語彙を知らなければ、
新しい判定は `invalid` として弾かれる。

### 語彙の同期点

機械強制は 3 段ある。担当が違うので、どれか 1 つで代用できない。

1. **型レベル(コンパイル)** — core の 5 定数
   (`EFFECT_TYPES` / `RULE_HOOK_NAMES` / `RULE_INPUT_KINDS` / `MINI_GAME_IDS` /
   `ENGINE_FEATURES`)すべてに `AssertExhaustive` ガードを置く。union に値を足して
   実行時配列を更新し忘れると、テストではなくコンパイルが先に落ちる。
2. **語彙パリティ(`judge-prompt-vocabulary.test.ts`)** — 5 定数の全要素が組み立て済み
   プロンプト文字列に出現すること、`CX01_OUTPUT_SCHEMA` の
   `hooks` / `effects` / `engineFeatures` の enum が core の語彙集合と一致すること。
3. **版のピン(`judge-prompt-version.test.ts`)** — プロンプト全文の sha256 を版ごとに
   記録し、本文が変わればテストが落ちる。復旧手段は `CX01_PROMPT_VERSION` の繰り上げと
   `{ 版: ハッシュ }` の**追記**であり、既存エントリの書き換えは方針違反とする
   (ハッシュ表は履歴として累積させる)。**版の繰り上げを強制しているのはこのテスト**で、
   パリティテストではない。語彙を足してプロンプトに書けばパリティは通るが、版を据え置くと
   自動再判定が起きないまま旧版の判定が残る — その穴をここで塞ぐ。

パリティテストはスモークチェックであり、説明の文脈が妥当かどうかまでは保証しない。
部分文字列一致による偽陽性(特に `player` は `players` に一致する)も残る。版のピンも
「本文が動いた」ことしか言わない。テストが通ることは「語が載っている」証拠であって
「正しく説明されている」証拠ではない。

以上に加えて `MINI_GAME_SUMMARIES` の `satisfies` ガードが、新しいミニゲーム id の説明
漏れをコンパイルで落とす。

**機械強制が届かず手動で揃える同期点**は次の 2 つ: サーバー `service.ts` の
`HOOKS` / `EFFECTS` / `EFFECTS_BY_HOOK` / `ENGINE_FEATURES` 許可集合(core とは独立に
検証する意図的な二重化)、および `scripts/diff-guard.mjs` の既知 `engineFeatures` 集合。
既存 `rule.ts` を触った場合の `packages/rules/rule-versions.json` の繰り上げは、ローカルの
`pnpm verify` には含まれないが CI(`ci.yml` の `rules:check-versions`)が落とし、main
マージ後は自動繰り上げ workflow(`rule-version-bump.yml`)も走る第 4 の層にあたる。

### 拡張実装のレビュー方針

契約の変更を含む以上、[implementation-guide.md](../implementation-guide.md) §3 の規模
判断では 2 パス(中間の独立レビューを挟む)に寄る。本フローはそれを機械的に適用せず、
**設計 doc への開発者承認を人間ゲートとして置く**選択をした。拡張の是非は方向性の裁定
そのものであり、開発者本人が判断する対象だからである。独立レビューを追加するかどうかは、
拡張の規模に応じて開発者が依頼時に指定する。

## 非目標

- **第 4 の verdict を作らない。** `extension_needed` のような verdict を足すと、
  確定操作・DB CHECK・レビュー UI・評価コーパスの期待値がすべて増える。得られるのは
  `needs_review` + 構造化フィールドと同じ情報でしかない。
- **`proposals` のステータス語彙に「拡張待ち」を足さない。** ステータスは E5 の RP-03
  表示と共有される語彙であり、提案者向けの意味を持つ。開発側の作業状態を混ぜない。
- **E07 本文の改訂は本タスクの範囲外。** 拡張要求と設計セッションを E07 §3.1 の記述へ
  反映するかどうかは別途判断する。
- 既存の却下済み提案の遡及的な再判定は行わない。再判定対象になるのは未確定の判定だけ
  であり、確定済みの却下は開発者が明示的に扱う。

## 運用ノート

- **`judge:eval` はモデル実機を叩く。** ユニットテストではないので CI では回らない。
  プロンプトを触ったら開発者が手で実行し、一致率を見る。
- 評価コーパスに N05「2択」/ N06「早押し」を `needs_review` + `extensionNeeded: true`、
  P11「クイーン決戦」(実装済み `bomb_throw_15` を起動するだけの提案)を `approve` +
  `extensionNeeded: false` として追加した。この 3 件が今回の事故と、その裏返し
  (実装済みミニゲームを拡張要求にしてしまう過剰反応)の両方を押さえる。
  `extensionNeeded` は期待値に明示したケースだけ比較する。
- A1「7渡し指名」の期待値を `needs_review` から `approve` へ整合させた。カード選択と
  相手選択の二段階入力は contract v2 で表現できるようになっており、期待値のほうが
  古かった。
- **P11 と r0029 リアルボンバーの C2(既存ルールとの実質重複)境界は実機評価で観察する。**
  どちらも `bomb_throw_15` を起動する提案であり、発動条件(Q 2 枚 / 自然な 4 の単体)と
  報酬(1 枚 / 最大 2 枚)が違う。P11 は `existingRules` を持たないケースとして登録した
  ので、評価上はリアルボンバーが既存ルールに入らず C2 は問われない。本番では入るため、
  同型の提案が C2 として却下されるかどうかは実データで観察し、重複判定が厳しすぎると
  分かってからプロンプトを触る。

## 2026-08-31 追補: 公開履歴から導出できる有限状態

提案「強化Jバック」(`01M07Q18AVEM959XZ3DBFH7VYG`)が、一定手番だけ続く強さ反転を
`state:turn_countdown` / `hook:on_turn_advance` の拡張候補として判定された。しかし、
現行契約の `context.game.history` には各手番の `played` / `passed`（自動スキップを含む）が
残る。`afterPlay` + `setMemory` で発動時点と継続手番数を保存し、`modifyStrength` が履歴との差を
同期的に数えれば、専用フックや新しいゲーム状態なしで完全に導出できる。

このためCX-01資料へ履歴イベントと導出方法を追記し、「専用のafterPass/onTurnAdvanceフックが
ない」ことだけを拡張理由にしない。評価コーパスにはP12「強化Jバック」を、既存の
「イレブンバック」を併記したうえで `approve` / `extensionNeeded: false` の期待値として追加する。
継続期間が「場が流れるまで」から「出したJの枚数ぶんの手番」へ変わるため、C2の実質重複には
当たらない。プロンプト版は `cx01-v20` とし、未確定の旧版判定を再判定対象へ戻す。

### 実装記録

- 着手時点: `fdfef2b54e13750730be9fc5c9a41765c320f055`
- `judge-prompt.ts` に公開履歴のイベント語彙と有限状態の導出方法を追加し、版を
  `cx01-v20` へ更新した。
- 評価コーパスへP12を追加し、プロンプト語彙テストと版ハッシュで回帰を固定した。
- 実モデル評価: `gpt-5.6-sol` / medium、P12は `approve` / `extensionNeeded: false`、
  confidence 0.93、latency 47,998msで期待値と一致した。
- 検証: `pnpm verify` 成功（182 files / 1,414 tests）。ローカルNodeはv24.15.0で、
  リポジトリ指定のNode 26系ではないためengine warningは継続している。
- 本番再判定を対象提案だけへ安全に限定するため、judge CLIへ `--proposal-id` を追加した。
  指定時はE6 / CX-01 / confirmationの全段階で他提案を除外する。
