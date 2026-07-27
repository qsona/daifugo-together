# E10: 運用・観測

- 作成日: 2026-07-24
- 状態: 提案(開発者の承認待ち)
- 改訂: 2026-07-24 確定済みの E05(提案受付)・E08(評価・淘汰)の設計に合わせて計測方式を再構成(遮断は E6 検査ログを読む二源集計 / 評価は 3 値 rating / 排除は rule_eliminations を読む / テーブル名を game_sets・set_rules に修正)
- 一次情報源: `docs/企画書.md`(§8 / §9-8 / §10 / §11)、`docs/product-backlog.md`(OP-01〜OP-04)、`docs/epics/E12-tech-stack.md`(§4.4 / §4.7 / §6)、`docs/epics/E05-rule-proposal.md`(proposals・状態機械)、`docs/epics/E08-evaluation.md`(game_sets・set_rules・set_evaluations・rule_evaluations・rule_eliminations)

> **実装時の仮置き改訂ノート(2026-07-27、E-18/C-2/C-6/G-8〜G-12 を反映):** フェーズ2のコード実装ではこのノートを本文中の旧前提より優先するが、decision-logの未決項目を実装者が決定するものではない。判定・実装は開発者マシン上のローカルツール/skillから人間承認で起動し、従量課金APIもサーバー常駐workerも使わない。このため現時点ではOP-01のレートgovernor、`settings`のcodex上限、`ops_events.codex_started`は作らない。キュー・試行・内部失敗の正準ソースは既存`pipeline_jobs`、投稿の正準ソースは全送信で行を作る`proposals`、L3/CX-01/開発者確定は`proposal_checks`/`judgements`とする。ユーザー向け実装失敗は`implementation_failed`の一値、内部内訳は`pipeline_jobs.error_code`から集計する。OP-01はキュー可視化として先行実装する。E-15で実際にdrainを起こすのはCodex起動ではなくマージ後のデプロイなので、その時刻を人間が選ぶ運用とするかは正式裁定を待つ。D-4が未決の間は単一の「採用率」を固定せず、分母を明記した終端結果ベースと全投稿ベースを併記する。D-5の解消とOP-01受け入れ条件の改訂も開発者裁定待ち。§1〜§5の`ops_events`/`settings`/governor/二源遮断集計に関する記述は履歴として残す。

---

## 1. Epic 概要

### 1.1 目的

E10 は「計器を用意する Epic」である。他 Epic が作る機能(提案・検査・実装・評価・対局)が動いた結果を**計測し、開発者が読める形にまとめ、閾値を動かす判断材料にする**。狙いは 2 つ。

1. **利用枠を守る(守りの運用)**: codex は開発者の subscription 枠で回る(企画書 §4.2・§8)。提案ラッシュで枠を使い切るとパイプライン全体が止まる。提案キュー(E7 所有)からの codex 実行頻度に上限を設け、消費状況を可視化する(OP-01)。
2. **成功指標とカオス化を測る(攻めの運用)**: 企画書 §11 の成功指標(提案数・採用率・「面白かった」率・実装/排除ルール数・都道府県カバー数)を、パイプライン稼働の初日から追える状態にする(OP-02・OP-03)。そのうえで、ルールが増えても「面白かった」率が下がらないよう、定期観測と閾値チューニングの運用手順を回す(OP-04)。

**設計上の最優先制約は「見ない計器を作らない」こと。** 個人開発の運用負荷を最小にするため、専用の管理画面は作らず(§2.4)、計測は**可能な限り他 Epic が既に書くデータ(proposals・rule_eliminations・set_evaluations 等)を読むだけで済ませ**、E10 が新設する計測テーブルは codex 実行テレメトリ 1 つに絞る(§2.1)。豪華なダッシュボードより、CLI 一発で必要な数字が出ることを優先する。

### 1.2 担当ストーリー

| ID | 一言 | フェーズ | 依存 |
|---|---|---|---|
| OP-01 | 提案キューと codex 実行頻度の上限・枠消費の可視化 | 2 | CX-02 |
| OP-02 | 提案数・採用(自動実装成功)率の計測(遮断/却下/実装失敗の内訳つき) | 2 | RP-01, CX-02 |
| OP-03 | 「面白かった」率・実装済み/排除ルール数・都道府県カバー数の計測 | 3 | EV-01, EV-03, RP-02 |
| OP-04 | カオス化の定期観測とチューニングの運用手順書 | 3 | OP-03, PR-02, EV-03 |

OP-01・OP-02 はフェーズ 2(提案パイプラインが動き始めたら即座に必要)、OP-03・OP-04 はフェーズ 3(評価・淘汰・人気度が揃ってから)である。**この Epic は 2 フェーズにまたがる**ので、本文書もフェーズ 2 分(§3.1・§3.2)とフェーズ 3 分(§3.3・§3.4)で着手時期が分かれる前提で書く。ただし §2 の計測基盤(`ops_events` と `settings`、集計ビューの枠組み)はフェーズ 2 で先に作り、フェーズ 3 はその上に読み取りを足すだけにする。

### 1.3 他 Epic との接続

E10 は自前でデータを生み出さない。**他 Epic が起こしたイベントを最小限だけ記録し(codex 実行のみ)、他 Epic が書いたデータを読む**のが役割である。

| 接続先 | E10 が前提にするもの(読む) | E10 が足すもの |
|---|---|---|
| **E5(提案受付)** | `proposals` テーブル(`status` ∈ screening/implementing/released/rejected/failed。E05 §2.1)。状態遷移は E5 の `transitionProposal(id, from, to, patch)` に集約(E05 §2.2)。**遮断された投稿は proposals に行を作らない**(E05 §2.1) | 提案ファネル(OP-02)は `proposals.status` を**そのまま**読む。E5 に計装フックの同梱を要請(§5) |
| **E6(検査・イエローカード / YC-01)** | インジェクション検査の**検出記録(検査ログ)**。遮断は proposals ではなくここに残る(E05 §2.1・§5) | OP-02 の**遮断数**は検査ログを**系統 B として読む**(§2.1・§3.2)。集計可能な取得点を E6 に要請(§5) |
| **E7(codex パイプライン)** | 提案キュー(=`proposals` の `status='implementing'`。E05 §3.1)、段階的 auto-merge、CI 失敗=`failed` 遷移 | OP-01 の**レート governor**(キューから codex を起動してよいかの判定)。codex 実行の一次記録 `ops_events`(§2.1)。CI 失敗段階の内訳計測 |
| **E8(評価・淘汰)** | `set_evaluations`(`rating` ∈ fun/neutral/boring)、`rule_evaluations`(vote ∈ up/down)、**`rule_eliminations`(排除履歴)**、`game_sets` + `set_rules`(E08 §2.1・§2.2) | OP-03 の集計(「面白かった」率・排除数・カバー数)。OP-04 で「面白かった」率低下時に **EV-03 の排除閾値(θ/N_min/z)** を動かす運用 |
| E9(優先順位・人気度) | PR-02 の人気度→優先度変換 | OP-04 で優先度換算パラメータの調整を判断材料にする |
| E11(ルール閲覧) | RV-02 図鑑が読む `rules`(状態・都道府県) | 都道府県カバー数の**集計定義を RV-02 と共有**(§5) |
| E12(技術基盤) | SQLite + Drizzle(§4.4)、pipeline 常駐ワーカー(§4.7)、単一 VM・単一プロセス(§3) | `ops_events`・`settings` テーブルの追加を要請(§5) |

**キューそのものは E7 の持ち物**であり、**排除の実行は E8(rule_eliminations + CX-04 の無効化フラグ)の持ち物**である。E10 が新規に作るのは「codex 起動の頻度を絞る governor」と「codex 実行の一次記録」と「集計・運用手順」に限る。この境界を守ることで E10 のスコープを小さく保つ。

### 1.4 スコープ境界(やること / やらないこと)

| E10 がやる | E10 がやらない(他 Epic の持ち物) |
|---|---|
| codex 実行のレート制御(頻度上限・枠消費チェック)と、その一次記録 `ops_events` | 提案キュー本体・直列消化ワーカー(E7 §4.7)、状態遷移 `transitionProposal`(E5) |
| 集計ビュー + 管理 CLI + 運用手順書 | インジェクション検査・検査ログ(E6)、可否判断(CX-01)、codex 実行そのもの(CX-02) |
| OP-01 の上限値の初期案と変更手段(`settings`) | 評価 UI・排除の実行・rule_eliminations(E8)、人気度算出(E9) |
| 「面白かった」率が下がったときの閾値調整の**手順**の文書化 | 排除閾値(θ/N_min/z)・優先度換算式の**値そのもの**の決定(EV-03/PR-02 が決める。E10 は動かし方を書く) |

---

## 2. Epic 横断の技術仕様

### 2.1 計測イベントのスキーマ(何をいつ記録するか)

#### 2.1.1 計測対象と記録点の一覧

計測すべき事象は 6 種(提案・遮断・却下・実装成否・対局・評価)である。**これらの大半は既に他 Epic が自分のテーブルに書いている**ので、E10 はそれを読むだけにする。E10 が新たに記録するのは、既存テーブルからは取れない 1 点 ——「codex を実際に起動したこと(枠消費のタイムスタンプ)」—— だけである。したがって計測は次の 2 系統に分ける。

- **系統 A: codex 実行テレメトリ `ops_events`(E10 が新設・所有)** — 枠消費の判定(OP-01)に必要な `codex_started` と、CI 失敗段階の内訳(OP-02 補助)に使う `impl_failed` の 2 種だけ。提案の状態そのものは持たない(それは `proposals`)。
- **系統 B: 他 Epic のテーブルを読むだけ** — 提案の状態は `proposals`(E5)、遮断は E6 検査ログ、排除は `rule_eliminations`(E8)、対局・評価は `game_sets`/`set_rules`/`set_evaluations`/`rule_evaluations`(E1/E8)。**E10 はこれらに書き込まない**。

各事象がどこに・いつ記録されるかを 1 表にまとめる。これが「何をいつ記録するか」の定義である。

| 事象 | 記録先(所有 Epic) | 記録の発火点 | E10 の読み方 |
|---|---|---|---|
| 提案(RP-01) | `proposals` status=`screening`(E5) | 検査通過後に INSERT(遮断投稿は行を作らない) | `proposals` を読む |
| 遮断(YC-01) | **E6 検査ログ**(E6) | 検査が検出・遮断した時。proposals には残らない | **E6 検査ログを読む**(系統 B。§3.2) |
| 却下(CX-01) | `proposals` status=`rejected`(E5、E7 が遷移) | 実装不可判断時。`reason_code`/`reason_text` 付与 | `proposals` を読む |
| 実装可・キュー投入 | `proposals` status=`implementing`(E5、E7 が遷移) | 可否=可の時。以後 codex 待ち〜実行 | `proposals` を読む(= codex キュー) |
| **codex 起動(枠消費)** | **`ops_events` type=`codex_started`(E10)** | governor 通過後 `codex exec` を起動する直前 | **E10 が記録**(OP-01 の一次データ) |
| 実装失敗(CX-03) | `proposals` status=`failed`(E5) + `ops_events` type=`impl_failed`(E10) | CI 検証失敗時。proposals に粗い理由、ops_events に CI 段階 | 両方を読む |
| 採用・反映(CX-05) | `proposals` status=`released`(E5、E7 が遷移) | バンドル登録・DB 反映完了時。`rule_id` 付与 | `proposals` を読む |
| 排除(EV-03) | **`rule_eliminations`(E8)** | 低評価による排除確定時(eliminated_at) | **rule_eliminations を読む**(§3.3) |
| ルール無効化・ロールバック(CX-04) | `rules.status`(E12/E7) | 運用停止・巻き戻し時 | 現存数は `rules.status` を読む |
| 対局(セット結果) | `game_sets` + `set_rules`(E1/E8) | セット終了時 | `game_sets`(id/ended_at)+ `set_rules`(was_active/did_fire)を読む |
| セット評価(EV-01) | `set_evaluations`(E8) | セット終了時の評価入力時(rating 3 値) | 読む |
| ルール評価(EV-02) | `rule_evaluations`(E8) | 同上(vote up/down) | 読む(補助指標) |

#### 2.1.2 codex 実行テレメトリ `ops_events`(系統 A)

E10 が新設する唯一の計測テーブル。**codex を起動したという事実**を追記専用(append-only)で残す。提案の状態は持たない(`proposals.status` が正)。Drizzle(SQLite)。

```sql
CREATE TABLE ops_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT    NOT NULL CHECK (type IN ('codex_started','impl_failed')),
  proposal_id  TEXT    NOT NULL REFERENCES proposals(id),  -- ULID(E05。TEXT であることに注意)
  attempt_no   INTEGER NOT NULL DEFAULT 0,                 -- codex 試行番号(0=初回, 1=リトライ)。proposals.attempt_count と対応
  reason_code  TEXT,                                       -- impl_failed の CI 失敗段階(下記)。codex_started では NULL
  occurred_at  INTEGER NOT NULL,                           -- unix epoch ミリ秒(UTC 保存)
  meta         TEXT                                        -- JSON。codex_ms・ci_run_url・bundle_hash 等の付随情報
);
CREATE INDEX idx_ops_events_type_time ON ops_events(type, occurred_at);
CREATE INDEX idx_ops_events_proposal  ON ops_events(proposal_id);
```

`type` の値:

| type | 意味 | reason_code | なぜ ops_events が要るか |
|---|---|---|---|
| `codex_started` | codex を起動した(枠 1 消費) | — | **枠消費のタイムスタンプは他テーブルに無い**。`proposals.attempt_count` は回数カウンタで時刻を持たない。OP-01 のレート制御に必須 |
| `impl_failed` | CI 検証が失敗した | `diffguard`/`typecheck`/`test`/`simulation`/`sandbox` | `proposals.reason_code` は `codex_failed`/`ci_failed`/`retry_exhausted` の粗い区分(E05 §3.3)。どの CI 段階で落ちたかは CI の穴発見と Stage 0→1 移行判断(E12 §4.7)に効くので、細分は E10 のテレメトリで持つ |

- **`codex_started` は「起動前に記録」**する。記録に失敗したら起動もしない(順序を「記録 → 起動」に固定)。枠は過小より過大に数える方が安全(枠を守るのが目的)なので、この方向へ倒す。
- **リトライは別行**(`attempt_no=1`)として記録し、`daily_cap` にカウントする(§3.1)。
- **`impl_failed` は funnel の一次ソースではない**。ファネルの「実装失敗」件数は `proposals.status='failed'` を正とし、`impl_failed` はその内訳(CI 段階)を補うだけ。両者は「起動してから CI で落ちた提案」で対応するが、集計上は proposals を主・ops_events を従とする。

#### 2.1.3 系統 B のテーブルからの読み取り契約

OP-02・OP-03 が読むテーブルと、E10 が依存するカラム。スキーマ確定は各 Epic だが、E10 が集計に必要とする**最小カラム**を読み取り契約として明示する。

| テーブル(所有) | E10 が使うカラム | 用途 |
|---|---|---|
| `proposals`(E5) | `id`、`author_id`、`kind`、`prefecture_code`、`status`、`reason_code`、`created_at`、`status_changed_at` | 提案ファネル(OP-02)、実装済み推移・都道府県カバー(OP-03) |
| E6 検査ログ(E6) | 遮断された投稿の**件数**(distinct 投稿単位)と発生時刻(日次で集計できること) | 遮断数・遮断率(OP-02)。取得点を §5 で要請 |
| `game_sets`(E1/E8) | `id`、`ended_at` | 評価の時系列バケット(OP-03) |
| `set_rules`(E1/E8) | `set_id`、`rule_id`、`was_active`、`did_fire` | **セットの有効ルール数** = `COUNT(*) WHERE was_active=1`。専用カラムは追加せず COUNT で導出(§5 で修正)。「面白かった」率をルール数に重ねる核 |
| `set_evaluations`(E8) | `set_id`、`user_id`、`rating`(`'fun'`/`'neutral'`/`'boring'`)、`created_at` | 「面白かった」率(OP-03)。**二値 `is_fun` ではなく 3 値 rating**(§3.3) |
| `rule_evaluations`(E8) | `set_id`、`rule_id`、`vote`(up/down) | 補助(ルール別の受け/不受け。OP-04 の材料) |
| `rule_eliminations`(E8) | `rule_id`、`eliminated_at`、`reverted_at` | **排除数と推移**(OP-03)。ops_events では持たず、この履歴表を読む |
| `rules`(E12/E7/E9) | `id`、`status`(有効/無効/排除済み) | 現存有効ルール数の現在値(OP-03) |

**有効ルール数はセット単位で不変**である。レジストリはセット開始時に有効ルールセットを固定する(E12 §4.6(4)・E08 §2.1)ので、`set_rules.was_active` はセット開始時に確定し、そのセットを通じて変わらない。したがって `COUNT(set_rules WHERE was_active=1)` は「そのセットが評価された時点の有効ルール数」を過不足なく表し、評価と 1 対 1 で結べる(OP-03 の設計上の肝。過去時点の有効数を再構成する必要がない)。

#### 2.1.4 書き込み規律(計装は既存の遷移関数に同梱)

- **E10 は proposals にも rule_eliminations にも書かない。** ファネル・排除・評価は他 Epic の書き込みをそのまま読む。E10 が書くのは `ops_events`(codex 実行)と `settings` だけ。
- `ops_events` への追記は**単一のヘルパ** `recordOpsEvent(tx, {...})` に集約する。呼ぶのは E7(パイプライン)で、次の 2 点に同梱する(§5 で E7 へ計装要請):
  - `codex_started`: E10 の governor がゲートを通した直後、`codex exec` を起動する直前(E7 のワーカー内)。
  - `impl_failed`: `implementing → failed` 遷移(E5 の `transitionProposal` を E7 が呼ぶ点)と**同じトランザクション**で、CI 段階を `reason_code` に載せて追記。
- 同一トランザクションに乗せることで「proposals は failed になったのに CI 段階が残らない/その逆」を防ぐ。SQLite の単一ライタ(E12 §4.4)なので同一プロセス内で完結する。

### 2.2 集計の置き場

**方針: SQLite ビュー + 管理 CLI。バッチ(cron)やマテリアライズドなスナップショットテーブルは初期には作らない。**

書き込みは提案・評価・結果あわせて毎秒数件にも届かない(E12 §6)。総行数もフェーズ 3 まで通して数万〜十数万行のオーダー。この規模では集計のたびに全期間をスキャンするビューで**レイテンシは体感ゼロ**であり、日次で数字を固める cron を回す運用負荷を負う理由がない。「見ない計器を作らない」原則に従い、**必要になった瞬間に CLI がビューを叩いて計算する** pull 型にする。

用意するビュー(代表):

```sql
-- 提案ファネル(proposals 由来。遮断は E6 検査ログから CLI が加算する。§3.2)
-- proposals.status が単一の権威列なので、終端は status を読むだけ。リトライ中は
-- 状態機械上 status='implementing'(E05 §2.2)= 進行中に自然に入り、二重計上は起きない。
CREATE VIEW v_proposal_funnel_daily AS
SELECT
  date(created_at/1000,'unixepoch','+9 hours')  AS d,        -- 提案日(コホート)
  COUNT(*)                                        AS proposals_total,
  SUM(status='released')                          AS 採用,
  SUM(status='rejected')                          AS 却下,
  SUM(status='failed')                            AS 実装失敗,
  SUM(status IN ('screening','implementing'))     AS 進行中
FROM proposals
GROUP BY d;

-- codex 枠の当日消費(JST 基準。§2.3 の settings を参照)
CREATE VIEW v_codex_budget_today AS
SELECT
  (SELECT COUNT(*) FROM ops_events
     WHERE type='codex_started'
       AND date(occurred_at/1000,'unixepoch','+9 hours') = date('now','+9 hours')) AS used_today,
  (SELECT CAST(value AS INTEGER) FROM settings WHERE key='codex_daily_cap')          AS daily_cap,
  (SELECT MAX(occurred_at) FROM ops_events WHERE type='codex_started')               AS last_started_at,
  (SELECT COUNT(*) FROM proposals WHERE status='implementing')                       AS implementing_now; -- codex 待機+実行中

-- 「面白かった」率 × 有効ルール数(セット単位。§11 の中心指標。§3.3)
CREATE VIEW v_set_fun_rules AS
SELECT
  g.id                                            AS set_id,
  g.ended_at                                      AS ended_at,
  ar.active_rules                                 AS active_rules,   -- セット開始時に固定・不変
  SUM(e.rating='fun')                             AS n_fun,
  SUM(e.rating='neutral')                         AS n_neutral,
  SUM(e.rating='boring')                          AS n_boring,
  COUNT(e.user_id)                                AS n_eval
FROM game_sets g
JOIN (SELECT set_id, COUNT(*) AS active_rules FROM set_rules WHERE was_active=1 GROUP BY set_id) ar
  ON ar.set_id = g.id
LEFT JOIN set_evaluations e ON e.set_id = g.id
GROUP BY g.id;
```

- **時刻はすべて UTC の unix ミリ秒で保存し、日次バケットは JST(+9 時間)で切る**(運用者が日本にいるため)。日本に夏時間はないので固定オフセットで足りる。この規約をビューに閉じ込め、CLI は日付を意識しない。
- 「推移(時系列)」が必要な指標(実装済みルール数の累積、排除数の推移)は、`proposals`(status='released')と `rule_eliminations` を日次で畳むビューで出す(§3.3 に SQL)。
- **昇格条件(バッチ導入の目安)**: 総行数が数百万規模に達し、代表クエリが 1 秒を超えるようになったら、その時に日次スナップショットテーブルへ移す。現規模では不要。

### 2.3 設定値の置き場(`settings`)

OP-01 の上限値や EV-03 の排除閾値のような**運用中に変えたい値**を環境変数に置くと、変更のたびに再デプロイが要り、再デプロイは進行中セットを落とす(E12 §4.5)。これを避けるため、キー・バリューの `settings` テーブルを置き、ワーカーが**読み直す**ことで再起動なしに変えられる。

```sql
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
-- OP-01(E10 が読む。§3.1 で根拠)
--   codex_min_interval_sec = 600   1 件あたり最短 10 分間隔
--   codex_daily_cap        = 30    1 日あたり最大 30 件
--   codex_concurrency      = 1     同時実行は 1(E12 §4.7 の直列消化)
-- EV-03(E8 が読む。E08 §3.3。この settings を共用する)
--   elimination_theta      = 0.70  低評価割合の下側信頼限界しきい値
--   elimination_n_min      = 10    最小票数ゲート
--   elimination_z          = 1.96  信頼係数
```

`settings` は **E10 と E8 で共用**する(E08 §3.3 は EliminationParams を「設定テーブルから読む」としており、同じ 1 テーブルに相乗りさせる)。OP-04 のチューニング(§3.4)は `ops settings set` でここを書き換える。

### 2.4 管理手段の方針

**専用の管理画面(開発者向けダッシュボード)は作らない。** これはワイヤーフレームでも「E10 の開発者向け画面は本ワイヤーフレームの対象外」と明記された前提と一致する。代わりに次の 3 段で始める。

| 手段 | 用途 | 実体 |
|---|---|---|
| **管理 CLI** | 日常運用の定型操作(枠確認・ファネル・指標表示・設定変更・排除ルールの手動復活) | `packages/pipeline` 内の Node スクリプト。`pnpm ops <cmd>` で実行。本番では `fly ssh console` 経由 |
| **SQL 直参照** | 定型化していないアドホックな調査 | VM 上の SQLite に `fly ssh console` + `sqlite3`。§2.2 のビューがあるので大半は 1 行クエリ |
| **最小限の管理エンドポイント** | 初期は**設けない**。CLI + SSH で全操作が届くため。ただし E8 が定義する運営復活 API(`POST /api/admin/rules/:id/reinstate`。E08 §3.3(d))の認証基盤だけは E10 の領分として将来必要になる(§5) | (将来)トークン保護の read-only JSON か極小の管理ページ |

想定する CLI サブコマンド(初期):

```
ops budget                          # v_codex_budget_today を整形表示(使用/上限/残/次回起動可能/滞留)
ops funnel  [--since] [--detail]    # 提案ファネル(総提案/遮断/却下/実装失敗/採用/進行中)と採用率・遮断率
ops metrics [--since]               # ルール数バンド別「面白かった」率、実装/排除推移、都道府県カバー
ops settings set <key> <value>      # OP-01 上限・EV-03 閾値の変更(再起動なし)
ops rule reinstate <ruleId> <理由>   # 排除ルールの手動復活(実体は E8 の reinstate を呼ぶ)
```

**なぜ画面を作らないか**: 画面は「管理するものが 1 つ増える」こと自体がコストで(E12 §2 判断基準 2)、UI・認証・デプロイの保守が乗る。個人開発・単一運用者・SSH 到達可能という前提では CLI がほぼ同じ速さで、実装ゼロに近い。

**昇格条件(画面 or 管理エンドポイントを作ってよくなる条件)**:

1. 運用者が 2 人以上になる(SSH 鍵共有が回らなくなる)、または非エンジニアが操作する必要が出た。
2. ラップトップ/SSH なしで(スマホから)日次以上の頻度で数字を確認する運用が定着した。
3. ある指標を**毎日**見るようになり、CLI 起動の往復自体が摩擦になった(= その計器は「見る計器」に昇格したので可視化投資が正当化される)。
4. 操作に監査ログ(誰がいつ復活・排除したか)が要るようになった。

昇格するときも、まず read-only の JSON エンドポイント 1 本 → 静的な 1 ページ、と最小から積む。書き込み操作(復活)を Web に出すのは 4 の条件を満たしてからにする。

---

## 3. ストーリー別詳細仕様

### 3.1 OP-01: 提案キューと codex 実行頻度の上限・枠消費の可視化

#### (a) 原文引用

> **[OP-01]** 開発者(運営)として、提案をキューイングして codex の実装頻度に上限を設けたい。それは subscription の利用枠を提案ラッシュで使い切り、パイプライン全体が止まる事態を防ぐためだ。
> - 受け入れ条件:
>   - 提案が明示された順序のキューで処理される
>   - 単位時間あたりの codex 実行数に上限があり、超過分は待機する
>   - 利用枠の消費状況を開発者が確認できる

#### (b) 仕様

キュー本体は E7/E5 の持ち物である。E5 は「`proposals` テーブルそのものをキューとする」設計で、E7 は可否=可となった **`status='implementing'` の提案を古い順に取り出して codex を回す**(E05 §3.1)。E10 が足すのは、その取り出し口で codex を起動してよいかを判定する**レート governor**、上限を運用中に変える手段、消費の可視化の 3 点。専用キューテーブルは作らない(E05 §3.1 の想定どおり proposals で足りる)。

**レート governor のアルゴリズム**(E7 の pipeline ワーカーのループに挿入):

```
ループ(ワーカー常駐):
  1. settings を読み直す(codex_min_interval_sec, codex_daily_cap, codex_concurrency)
  2. いま codex 実行中のジョブ数 >= concurrency なら待機(既定 concurrency=1 なので実行中なら待つ)
  3. 当日(JST)の codex_started 件数 >= daily_cap なら、翌 JST 0 時まで待機
  4. 直近の codex_started から経過秒 < min_interval_sec なら、差分だけ待機
  5. すべて満たしたら、status='implementing' の最古の提案を 1 件取り、
     まず ops_events に codex_started(attempt_no)を追記 → その後 codex exec を起動
```

- **順序**: 「明示された順序」= `implementing` に入った提案を `created_at`(または status_changed_at)昇順で取り出す FIFO。飢餓を避けるため優先度付けは初期には入れない。
- **枠消費の一次記録は「起動前に記録」**: `codex_started` を先に書いてから `codex exec` する。記録失敗時に起動が走る(見えない消費)ことを防ぐ。逆に「記録したが起動失敗」は 1 枠を過大計上しうるが、**枠は過小より過大に数える方が安全**なのでこの方向で倒す。
- **リトライは枠を消費する**: CI 失敗時のリトライ(E12 §4.7・E05 §2.2、1 回まで)も `codex exec` を再起動するので `codex_started`(`attempt_no=1`)をもう 1 行記録し、`daily_cap` にカウントする。E5 のリトライ辺(`failed→implementing`)を通ってから起動する。
- **他用途の codex 消費への配慮**: エンジン開発の PR や手動 codex 利用も同じ subscription 枠を食う。governor が管理できるのは**パイプライン分だけ**なので、`daily_cap` は subscription の実上限より**余裕を残して**設定する(§下)。

**上限の初期案と根拠**:

| 設定 | 初期値 | 根拠 |
|---|---|---|
| `codex_min_interval_sec` | 600(10 分) | ラッシュ時でも 1 時間に最大 6 件に均す。1 件の CI(型・テスト・シミュレーション・サンドボックス)を数分で回す想定(E12 §4.1 の高速テスト方針)と噛み合う |
| `codex_daily_cap` | 30 | subscription の実上限が未確定(E12 §7-2)のため保守的に置く。手動 codex 利用の余地を残す。実上限判明後に §5 の手順で較正 |
| `codex_concurrency` | 1 | E12 §4.7 の「キューは直列消化」に合わせる。並列は枠とサーバー負荷を跳ね上げるので初期は 1 固定 |

**変更方法**: `ops settings set codex_daily_cap 50` のように CLI で書き換える。ワーカーは次ループで読み直すので**再起動不要**(§2.3)。

**枠消費の可視化**: `ops budget` が `v_codex_budget_today` を整形して次を表示する。

- 当日使用数 / 日次上限 / 残数
- 次に起動可能な時刻(`last_started_at + min_interval_sec`)
- codex 待機+実行中の数(`implementing_now` = `status='implementing'` の提案数)

#### (c) データ定義

- **codex 起動 1 件** = `ops_events` の `type='codex_started'` 1 行。リトライは `attempt_no=1` の別行。
- **当日消費** = 当日(JST)の `codex_started` 件数。
- **枠残** = `codex_daily_cap` − 当日消費。
- **待機+実行中** = `proposals.status='implementing'` の件数(`implementing_now`)。厳密な「未起動の待機数」が要れば `implementing` のうち対応する `codex_started` がまだ無い提案数を数える。
- 上限値は `settings` の `codex_min_interval_sec` / `codex_daily_cap` / `codex_concurrency`。

#### (d) 実装方針

- governor は `packages/pipeline` のワーカーループ内の純粋な判定関数 `canStartCodex(now, settings, recentStarts): { ok, waitMs, reason }` として切り出し、単体テスト可能にする(§4)。
- `daily_cap` 到達時は「翌 JST 0 時まで待機」。境界(23:59 と 00:00)の判定は JST 換算を 1 か所に閉じる(§2.2 と同じ規約)。
- 提案の取り出しは E7 の既存クエリ(`status='implementing'` 古い順)をそのまま使い、E10 は起動可否の gate と `codex_started` 記録だけを挟む。

#### (e) 受け入れ条件の精緻化

1. `implementing` の古い順に 1 件ずつ codex が起動し、`concurrency=1` の間は同時に 2 件起動しない(テストで並行起動が起きないことを確認)。
2. 単位時間あたりの起動数が上限を超えない: `min_interval_sec` 未満の間隔で 2 件目が起動しない/`daily_cap` 到達後は当日それ以上起動しない(境界含めテスト)。超過分は `implementing` のまま待機する(消えない・順序が保たれる)。
3. `ops budget` が「当日使用/上限/残/次回起動可能時刻/待機+実行中」を返し、値が `ops_events`・`proposals` の実データと一致する。
4. `ops settings set codex_daily_cap <n>` の変更が**再起動なしで**次の起動判定に反映される。
5. リトライ起動(`attempt_no=1`)が `daily_cap` にカウントされる。

#### (f) 未解決事項

- **subscription の実上限とウィンドウ形状**が未確定(E12 §7-2)。実際の codex プランはローリングウィンドウ(数時間/週次)で効くことが多く「日次 cap」は近似。実上限判明後、min_interval と daily_cap をそのウィンドウへ写す較正が要る(§5)。
- **キュー滞留が長期化したときの提案者体験**(順番待ち表示など)は RP-03(E5)の管轄。E10 は滞留数を出すところまで。
- 手動 codex 利用分を governor は知れない。運用で「手動実行日は cap を一時的に下げる」等の回避に留める(OP-04 の手順に含める)。

---

### 3.2 OP-02: 提案数・採用率の計測(内訳つき)

#### (a) 原文引用

> **[OP-02]** 開発者(運営)として、ルール提案数と採用(自動実装成功)率を計測したい。それは成功指標をパイプライン稼働の初日から追えるようにするためだ。
> - 受け入れ条件:
>   - 提案数・採用数・採用率が集計され、参照できる
>   - 遮断(YC-01)・却下(CX-01)・実装失敗(CX-03)の内訳が分かる

#### (b) 仕様

**遮断された投稿は `proposals` に行を作らない**(E05 §2.1)ため、ファネルは**二源集計**になる。

- **proposals 由来**(検査を通過して行になった提案): `status` を読むだけで終端が分かる。`released`=採用、`rejected`=却下、`failed`=実装失敗、`screening`/`implementing`=進行中。**`proposals.status` は単一の権威列なので、リトライで一時的に `implementing` に戻っている提案は自然に「進行中」に入り、`failed` と `released` に二重計上されることはない**(E05 §2.2 の状態機械)。
- **E6 検査ログ由来**(遮断): 遮断数は E6 の検査ログから読む(件数と発生時刻。§5 で取得点を要請)。

**ファネルと内訳の定義**(B=遮断、P=proposals 行数):

```
総提案数 T          = B(遮断) + P(proposals 行数)         ← 二源
  ├ 遮断  B         = E6 検査ログの遮断投稿数(YC-01)
  └ P                = proposals 行(検査通過して行になった提案)
       ├ 却下       = status='rejected'   (CX-01)
       ├ 実装失敗    = status='failed'     (CX-03。deploy 失敗も含む。§5)
       ├ 採用       = status='released'    (自動実装成功・反映済み)
       └ 進行中      = status IN ('screening','implementing')(未終端)
```

**恒等式(二源でも成立)**:

```
B + 却下 + 実装失敗 + 採用 + 進行中
= B + (rejected + failed + released + screening + implementing)
= B + P
= T
```

B と P は別テーブル由来だが**互いに素**(遮断投稿は proposals 行を持たない)なので重複はなく、恒等式は常に成立する。P の内訳は単一列 `status` の排他値なので、P 内でも二重計上は起きない。

**採用率・遮断率の定義**:

- **採用率 = 採用 ÷ (却下 + 実装失敗 + 採用)。** 分母から**遮断 B と進行中を除く**。遮断は「攻撃かどうか」の結果で「実装可否」ではないため、採用率(=実装パイプラインの実力)に混ぜると攻撃増加時に率が歪む。進行中はまだ結果が出ていないので分母から外す。
- **遮断率 = B ÷ T = B ÷ (B + P)。** 攻撃波の観測用に別建て。
- 集計はコホート方式(**提案日でグルーピング**)を基本にする。「6 月に提案されたもののうち何%が採用されたか」が意味を持つ形。

**内訳の細分**:

- **実装失敗の CI 段階**(`diffguard`/`typecheck`/`test`/`simulation`/`sandbox`): `ops_events` の `impl_failed.reason_code` を集計。CI の穴発見と E12 §4.7 Stage 0→1 移行判断の材料。
- **却下理由**(E05 §3.3 の `reason_code`: `infeasible_technical`/`breaks_game`/`out_of_scope`/`duplicate_rule`/`other`): `proposals.reason_code` を集計。`infeasible_technical`(追加入力要求ルール等を含む)が多ければ E12 §4.6(2) の choice 機構導入の判断材料になる。

#### (c) データ定義

`v_proposal_funnel_daily`(§2.2)を提案日でフィルタ・集計し、CLI が遮断数(E6 検査ログ)を足して率を出す。

```sql
-- proposals 由来(期間 [:from,:to)・提案日基準)
SELECT
  COUNT(*)                                       AS proposals_total,
  SUM(status='released')                         AS 採用,
  SUM(status='rejected')                         AS 却下,
  SUM(status='failed')                           AS 実装失敗,
  SUM(status IN ('screening','implementing'))    AS 進行中
FROM proposals
WHERE created_at >= :from AND created_at < :to;

-- 遮断(E6 検査ログ。テーブル名・列は E6/YC-01 の確定に従う。§5 の要請)
-- 例: SELECT COUNT(*) AS 遮断 FROM <e6_injection_log> WHERE blocked=1 AND blocked_at >= :from AND blocked_at < :to;

-- CLI が合成:
--   総提案 T = 遮断 + proposals_total
--   採用率   = 採用 / NULLIF(却下 + 実装失敗 + 採用, 0)
--   遮断率   = 遮断 / NULLIF(T, 0)

-- 実装失敗の CI 段階内訳(--detail)
SELECT reason_code AS ci_stage, COUNT(*) AS n
FROM ops_events
WHERE type='impl_failed' AND occurred_at >= :from AND occurred_at < :to
GROUP BY reason_code;

-- 却下理由内訳(--detail)
SELECT reason_code, COUNT(*) AS n
FROM proposals
WHERE status='rejected' AND status_changed_at >= :from AND status_changed_at < :to
GROUP BY reason_code;
```

- `NULLIF(...,0)` で 0 件期間のゼロ除算を回避(率は NULL = 「—」表示)。

#### (d) 実装方針

- 集計は `ops funnel` CLI がビュー + 上記クエリ + E6 検査ログのカウントを合成して表で返す。専用の集計ジョブは持たない(§2.2)。
- `--since 2026-08-01` のような期間指定を受け、既定は「直近 30 日」。
- E6 検査ログの参照は、E6 が公開する読み取り口(件数取得関数 or ビュー)を通す。E6 未実装の間は遮断=0 として動く(パイプラインの段差吸収。E05 §1.3 と同じ考え方)。

#### (e) 受け入れ条件の精緻化

1. `ops funnel` が総提案・遮断・却下・実装失敗・採用・進行中の件数と、採用率・遮断率を返す。
2. 恒等式 `遮断 + 却下 + 実装失敗 + 採用 + 進行中 = 総提案` が常に成立する(二源でも。テストで検証)。P 内は単一列 `status` の排他値なので二重計上が起きない(リトライ中は進行中に入る)。
3. 実装失敗の CI 段階内訳(ops_events)・却下理由内訳(proposals)が `--detail` で参照できる。
4. 0 件期間で率が NULL(「—」)として壊れず返る。
5. E6 検査ログ未実装時は遮断=0 でファネルが成立する。

#### (f) 未解決事項

- 「採用率」の分母から遮断を除く定義は本文書の提案。開発者が「攻撃込みの生採用率も見たい」なら両方出す(容易)。§11 は分母を規定していないので確定させたい。
- **遮断カウントの単位**(投稿単位か検出イベント単位か)は E6 検査ログのスキーマ次第。E10 は「distinct 遮断投稿数」を必要とする(§5 で明示)。
- コホート(提案日基準)か発生日基準かは OP-04 の推移の見せ方と関わる。基本コホート、稼働量を見たいときだけ発生日基準の補助を足す。

---

### 3.3 OP-03: 「面白かった」率・実装済み/排除ルール数・都道府県カバー数

#### (a) 原文引用

> **[OP-03]** 開発者(運営)として、「面白かった」率・実装済み/排除ルール数・都道府県カバー数を計測したい。それは企画書 §11 の成功指標で、淘汰の機能と地域資産の広がりを確かめるためだ。
> - 受け入れ条件:
>   - 「面白かった」率を実装済みルール数の推移と重ねて確認できる(ルールが増えても下がらないかを見る)
>   - 実装済みルール数と排除されたルール数の推移が確認できる
>   - ローカルルールの都道府県カバー数が確認できる

#### (b) 仕様

3 指標を、それぞれ**算出定義を確定**して集計する。中心は「『面白かった』率 × 有効ルール数」で、これが企画のコア命題(§11「ルールが増えても下がらない」)の可視化そのものである。

**指標1: 「面白かった」率 × 有効ルール数の推移**

- セット評価は 3 値 `rating`(`fun`/`neutral`/`boring`。E08 §2.2)である。**「面白かった」率の定義を確定する**:
  - **fun_rate = `fun` 件数 ÷ 全評価件数(fun + neutral + boring)。** neutral(ふつう)は**分母に含める**(= 「積極的に面白い」ではない側)。
  - **理由**: §11 の成功条件は「面白かった」(積極的に楽しめている)ことである。`neutral` は「可もなく不可もなく」で、積極的な面白さではない。neutral を分母から外すと率が実態より高く出て、生ぬるい受容を「面白い」に見せかける。淘汰の効き目を厳しめに見るためにも neutral は分母に残す。
  - あわせて **boring_rate = `boring` ÷ 全評価件数** を副指標として出す。負の裾(つまらなさ)を直接見え、OP-04 で EV-03 の排除閾値を動かす引き金になる。
- 有効ルール数 = `COUNT(set_rules WHERE was_active=1)`(セット開始時に固定・不変。§2.1.3)。
- 見方は 2 通り: **(i) 時系列**(日/週バケットで fun_rate と平均有効ルール数を並べる)と **(ii) 有効ルール数バンド別**(0–10 / 11–20 / 21–30 … の帯ごとに fun_rate)。§11 の問いは「ルール数が増えても率が落ちないか」なので **(ii) バンド別が本命**(横軸をルール数にすると命題に直答)。(i) は日々の監視用。

**指標2: 実装済みルール数・排除ルール数の推移**

- 実装済み(累計) = `proposals.status='released'` の累計(反映=released は終端で `status_changed_at` が反映時刻を保持。E05 状態機械で released は終端)。
- 現存有効数 = `rules.status='有効'`(現在値。rules テーブル、E12/E7)。
- 排除数 = **`rule_eliminations` を読む**(E8)。ops_events では持たない。現存排除 = `reverted_at IS NULL` の件数、推移 = `eliminated_at` の日次発生数(復活は `reverted_at` で表現)。

**指標3: 都道府県カバー数**

- 定義(確定案): **一度でも実装到達(released)したローカル提案に紐づく都道府県の distinct 数。** `proposals` で `kind='local'` かつ `status='released'` かつ `prefecture_code IS NOT NULL` の `prefecture_code` の異なり数。
- **排除済みも数える**: 一度実装された地域報告は「地域性という資産」として残る(図鑑にも排除済みとして残る。企画書 §4.5)。`proposals.status='released'` は終端で、後にルールが排除されても proposals 側は released のままなので、この定義は「一度でも実装到達した」を正しく捉える(現在の有効/排除で絞らない)。
- **提案止まり(却下・遮断・進行中)は数えない**: 資産は「実装されたルール」。通らなかった提案の都道府県を数えると広がりを過大に見せる。
- **E11/RV-02 と集計定義を共有**する(§5)。図鑑の都道府県表示・カバー数と本指標が食い違わないよう、単一の定義(同じ抽出条件)を 1 か所に置く。
- 補助として「提案ベースカバー(提案された都道府県の異なり数)」も出せるが、主指標は実装ベース。都道府県は「出自の記録」であり分布実態ではない(企画書 §4.1・E05 §3.2)注記を CLI 出力に添える。

#### (c) データ定義

```sql
-- 指標1(ii): 有効ルール数バンド別の「面白かった」率(本命)
SELECT
  CASE
    WHEN active_rules <= 10 THEN '00-10'
    WHEN active_rules <= 20 THEN '11-20'
    WHEN active_rules <= 30 THEN '21-30'
    ELSE '31+'
  END                                     AS rule_band,
  SUM(n_eval)                             AS n_eval,
  1.0 * SUM(n_fun)    / NULLIF(SUM(n_eval),0) AS fun_rate,
  1.0 * SUM(n_boring) / NULLIF(SUM(n_eval),0) AS boring_rate
FROM v_set_fun_rules
GROUP BY rule_band ORDER BY rule_band;

-- 指標1(i): 日次の推移
SELECT
  date(ended_at/1000,'unixepoch','+9 hours')   AS d,
  SUM(n_eval)                                   AS n_eval,
  1.0 * SUM(n_fun) / NULLIF(SUM(n_eval),0)      AS fun_rate,
  AVG(active_rules)                             AS avg_active_rules
FROM v_set_fun_rules
GROUP BY d ORDER BY d;

-- 指標2: 実装済み(累計)の推移(proposals 由来)
SELECT date(status_changed_at/1000,'unixepoch','+9 hours') AS d, COUNT(*) AS 実装
FROM proposals WHERE status='released'
GROUP BY d ORDER BY d;   -- 累計は CLI 側で running sum、または window 関数

-- 指標2: 排除の推移(rule_eliminations 由来。E8)
SELECT date(eliminated_at/1000,'unixepoch','+9 hours') AS d, COUNT(*) AS 排除発生
FROM rule_eliminations
GROUP BY d ORDER BY d;
-- 現存排除数 = SELECT COUNT(*) FROM rule_eliminations WHERE reverted_at IS NULL;
-- 現存有効数 = SELECT COUNT(*) FROM rules WHERE status='有効';

-- 指標3: 都道府県カバー数(E11/RV-02 と共有する定義)
SELECT COUNT(DISTINCT prefecture_code) AS covered_prefectures
FROM proposals
WHERE kind='local' AND prefecture_code IS NOT NULL AND status='released';
```

- 現存有効数(`rules.status='有効'`)は CX-04 の一時無効化(`無効`)や排除(`排除済み`)を除いた**現在値**で、推移用の「実装済み累計」(proposals released)とは別物である旨を CLI 出力に明記する(現在値と累計で参照元が違う)。
- バンドの刻み(10 刻み)は初期値。ルールの増加速度を見て OP-04 で調整する。

#### (d) 実装方針

- すべて `ops metrics` CLI が読み取り専用クエリで返す。フェーズ 3 で `set_evaluations`/`game_sets`/`set_rules`/`rule_eliminations`/`proposals` が揃ってから、§2 の枠組みに読み取りを足すだけで完成する(**E10 が新設するテーブルは無い**)。
- 有効ルール数は `set_rules.was_active` の COUNT で導出する(専用カラムは追加しない。§5 で E08 §5.2-2 の要請に統合)。
- CLI 出力は数表(ASCII テーブル)で足りる。グラフ化は「見る計器に昇格したら」(§2.4 昇格条件)。

#### (e) 受け入れ条件の精緻化

1. 有効ルール数バンド別の fun_rate(と boring_rate)が出て、「ルール数が増える帯で率が落ちていないか」を 1 表で判断できる(§11 の中心命題への直答)。日次推移でも重ねて見られる。
2. 実装済み(累計、proposals released)・現存有効(rules)・排除数(rule_eliminations)が参照でき、実装と排除の推移が確認できる。
3. 都道府県カバー数が「実装到達したローカル提案の都道府県 distinct 数(排除済み含む・提案止まり除く)」の定義どおり算出され、E11/RV-02 と同じ定義を共有する。
4. 評価 0 件・ルール 0 件でも壊れず「—/0」を返す(NULLIF)。

#### (f) 未解決事項

- fun_rate を「fun ÷ 全体(neutral を分母に含む)」で確定した(本文書の判断)。段階評価への変更は E08 が 3 値 rating で確定済みのため不要。boring_rate を OP-04 の主トリガにするかは §3.4 で運用する。
- バンドの刻み幅、時系列バケット(日/週)の既定は運用しながら OP-04 で調整。
- カバー数を「実装ベース」に確定してよいか(提案ベースも並記するか)は開発者判断。本文書は実装ベースを主指標として提案。

---

### 3.4 OP-04: カオス化の定期観測とチューニングの運用手順書

#### (a) 原文引用

> **[OP-04]** 開発者(運営)として、ルール増加に伴うゲーム体験の変化(カオス化)を定期的に観測し、チューニングしたい。それはカオスを「面白いカオス」に保つことがフェーズ 3 の主題だからだ。
> - 受け入れ条件:
>   - OP-03 の指標を使った定期観測が運用手順として文書化され、実施されている
>   - 「面白かった」率が下がったときの対応手順(排除閾値や優先度換算の調整など)が文書化されている

#### (b) 仕様 — 定期観測の運用手順書

OP-04 の成果物は**動く仕組みではなく手順書**である。以下をそのまま運用ドキュメントとして採用する。

**定期観測(週次を基本)**: 週 1 回、CLI 3 本を順に叩いて数字を読む。所要 5 分を目安にする(重い運用にしない)。

```
ops budget            # ① 枠が詰まっていないか(滞留・残枠)
ops funnel  --since   # ② 提案の勢いと採用率・遮断率、実装失敗の CI 段階内訳
ops metrics --since   # ③ ルール数バンド別 fun_rate / boring_rate、実装/排除推移、都道府県カバー
```

**各回で見る点(トリアージ)**:

| 見る数字 | 健全なサイン | 注意サイン → 深掘りへ |
|---|---|---|
| ① 待機+実行中・残枠 | 滞留が翌日には捌ける | 滞留が増え続ける/毎日 cap 到達 |
| ② 採用率 | 横ばい〜上昇 | 継続的に低下 → 実装失敗の CI 段階内訳を見る |
| ② 遮断率 | 低位安定 | 急上昇 → 攻撃波。YC(E6)側の運用へ |
| ③ ルール数バンド別 fun_rate | 高ルール数帯でも落ちない | 高ルール数帯で明確に低い → **カオス過多** |
| ③ boring_rate | 低位安定 | 上昇 → つまらなさの蓄積 |
| ③ 排除発生(rule_eliminations) | 低評価ルールが排除されている | 実装は増えるが排除ゼロ → 淘汰が効いていない |
| ③ 都道府県カバー | 緩やかに増える | (成長指標。低下はしない) |

**「面白かった」率が下がったときの対応手順(閾値の動かし方)**:

中心命題は「ルールが増えても『面白かった』率が下がらない」。下がったら、**原因を切り分けてから 1 つずつ閾値を動かす**(同時に複数動かすと効果が測れない)。動かせるレバーは 3 つ。

| 症状(③ で観測) | 推定原因 | 動かすレバー | 具体操作 | 期待効果 |
|---|---|---|---|---|
| 高ルール数帯で fun_rate 低下 / boring_rate 上昇、排除発生が伸びていない | つまらないルールが淘汰されず溜まる | **EV-03 の排除閾値を下げる**(より排除されやすく) | `ops settings set elimination_theta 0.65`(または `elimination_n_min` を下げる)。値の意味は E08 §3.3。閾値式は E8 所有 | 低評価ルールがより早く抜け、実効ルール数が下がって fun_rate 回復 |
| ルール数に関わらず fun_rate 低い / 競合時に不人気ルールが勝つ | 人気度→優先度の反映が弱い | **PR-02 の優先度換算パラメータを調整** | E9 の変換式パラメータを調整(値は PR-02 が所有) | 競合時に人気ルールが生き残り体験が締まる |
| 枠に対して提案が多すぎ、粗いルールが大量流入 | 流入速度過多 | **OP-01 の上限を一時的に絞る** | `ops settings set codex_daily_cap <小さい値>` | 実装ペースを落とし、評価・淘汰が追いつく時間を作る |

**運用ルール**:

- 1 回の観測サイクルで動かすレバーは**原則 1 つ**。次の週次観測で効果(fun_rate の変化)を確認してから次を動かす。
- どのレバーを、いつ、どの値からどの値へ動かしたかを運用ログ(`settings.updated_at` + コミット)に残す。効果の因果を後から追えるようにする。
- **効果のラグ**: 排除閾値や優先度換算を動かしても、評価が新たに溜まるまで数セット〜数日かかる。動かした直後の 1 回では判断せず、次週まで待つ。EV-03 は評価送信を起点に走る(E08 §2.4)ため、対局数が少ない期間はラグが伸びる。
- **緊急停止**: 事故的なルール(バグ・不快)が原因で急落した場合は、チューニングではなく個別のルール無効化(CX-04、E7)で落とす。閾値調整は「全体の傾向」に、個別無効化は「特定ルール」に使い分ける。誤って排除されたルールの復活は `ops rule reinstate`(実体は E8 の reinstate。E08 §3.3(d))。

#### (c) データ定義

新規データは持たない。OP-01(枠)・OP-02(ファネル)・OP-03(指標)のビューと CLI をそのまま使う。手順書は本ファイル(または運用 README)に置き、実施記録は `settings` 変更履歴とコミットログで代替する。

#### (d) 実装方針

- **実装物はほぼ無い**。OP-01〜03 の CLI が揃っていれば、OP-04 は「手順の文書化」と「定期的に叩く運用」だけ。個人開発なのでカレンダーのリマインダ + 手順書で足りる。将来自動リマインドが欲しくなったら、週次で `ops metrics` を実行して出力を通知に流す小スクリプトを足す(初期は作らない)。
- レバーの実値(排除閾値=E8、優先度換算=E9)は各 Epic が所有する。E10 の手順書は「どの設定をどちらへ動かすか」を参照するに留め、値は各 Epic 文書へリンクする。排除閾値は共用 `settings`(§2.3)経由で `ops settings set` から動かせる。

#### (e) 受け入れ条件の精緻化

1. §3.4(b) の週次手順(見る CLI・見る数字・注意サイン)が文書として存在し、少なくとも 1 回実施した記録がある。
2. 「面白かった」率低下時の対応表(症状→原因→動かすレバー→操作)が文書化され、各レバーが実際に操作可能(排除閾値=`ops settings set elimination_*`、優先度換算=E9、codex 上限=`ops settings set codex_*`)である。
3. 「一度に 1 レバー・変更記録を残す・効果ラグを待つ」運用ルールが明記されている。

#### (f) 未解決事項

- 観測の頻度(週次)は初期案。稼働が伸びたら日次/自動通知にする判断は運用実績を見てから。
- レバー間の相互作用(排除閾値と優先度換算を両方動かすと切り分け不能)は「1 度に 1 つ」で回避するが、効果が出るまでのラグ実測値はフェーズ 3 稼働後に追記。
- カオス化の「体験としての」観測(数字に出ない面白さ/つまらなさ)は自分/協力者が実際に遊ぶ定性チェックで補う。定量指標だけに依存しない旨を手順書に添える。

---

## 4. テスト観点

計測は「数字が正しいこと」が価値なので、集計の恒等式とレート制御の境界を重点的に検証する。判定ロジックは純粋関数に切り出して高速テストする(E12 §2 判断基準 1)。

**codex 実行テレメトリ(`ops_events`)の健全性**
- codex 起動のたびに `codex_started` が**ちょうど 1 行**(初回 `attempt_no=0`、リトライ `attempt_no=1`)残る。
- CI 失敗のたびに `impl_failed` が 1 行、正しい CI 段階(`reason_code`)で残り、`implementing→failed` 遷移(proposals)と同一トランザクションで書かれる(片方だけ残る状態が作れない)。
- `codex_started` が「起動前」に書かれる順序(記録失敗時に起動が走らない)。

**ファネルの整合(OP-02、二源集計)**
- 恒等式 `遮断 + 却下 + 実装失敗 + 採用 + 進行中 = 総提案(= 遮断 + proposals 行数)` が任意データで成立する。B(E6 検査ログ)と P(proposals)が互いに素であること(遮断投稿が proposals に現れない)を前提に検証。
- proposals 内の内訳が単一列 `status` の排他値で、二重計上が起きない。**リトライ中の提案(`failed→implementing`)が「進行中」に入り、「実装失敗」と「採用」に二重計上されない**(E05 状態機械に沿ったフィクスチャで確認)。
- deploy(バンドル build/登録)失敗が `failed`(reason_code=`deploy_failed`)として「実装失敗」に入り、`implementing` に永久滞留しない(§5 の reason_code 前提)。
- 0 件期間で採用率・遮断率が NULL を返しクラッシュしない(ゼロ除算)。
- E6 検査ログ未実装時に遮断=0 でファネルが成立する。

**レート governor(OP-01)**
- `canStartCodex` が `min_interval` 未満で 2 件目を弾く(境界: ちょうど `min_interval` で許可)。
- `daily_cap` ちょうどで当日それ以上起動しない/翌 JST 0 時で復帰する(日跨ぎ境界、JST 換算)。
- `concurrency=1` で実行中は起動しない。
- リトライ起動(`attempt_no=1`)が cap にカウントされる。
- `settings` 変更が次ループで反映される(再起動不要)。
- 取り出し順(`implementing` 古い順)が保たれ、待機提案が消えない。

**指標の算出(OP-03、E08 スキーマ突き合わせ)**
- fun_rate = `fun ÷ (fun+neutral+boring)`、boring_rate = `boring ÷ 全体`(neutral を分母に含む定義どおり)。
- 有効ルール数 = `COUNT(set_rules WHERE was_active=1)`。`game_sets`(id)と `set_evaluations.set_id`・`set_rules.set_id` の JOIN が正しく張れる(存在しない `game_results` を参照しない)。
- ルール数バンド集計が境界(10/20/30)で正しい帯に入る。
- 排除数・推移が `rule_eliminations`(eliminated_at / reverted_at)から算出され、ops_events を参照しない。復活(reverted_at)済みが現存排除から外れる。
- 実装済み累計が `proposals.status='released'` から、現存有効が `rules.status='有効'` から出て、両者の参照元の違いが出力に明示される。
- 都道府県カバーが distinct・released・kind=local・prefecture_code 非 null の定義どおり。同一県の複数提案を重複カウントしない。E11/RV-02 と同じ結果になる(共有定義)。

**時刻・タイムゾーン**
- JST 日次バケットが UTC 保存値から正しく切られる(日本の 00:00 前後のイベントが正しい日に入る)。

**CLI・運用**
- `ops budget/funnel/metrics` の出力がビュー・proposals・rule_eliminations・E6 検査ログの実値と一致する。
- `ops settings set`(codex_* / elimination_*)が再起動なしで反映される。
- `ops rule reinstate` が E8 の reinstate を呼び、排除復活が rule_eliminations に反映される。

**フィクスチャ**
- 合成データ(proposals の各終端 + リトライ + deploy_failed、E6 遮断ログ、rule_eliminations、game_sets/set_rules/set_evaluations)を投入し、上記の恒等式・率・推移を end-to-end で検証するフィクスチャを 1 本用意する(回帰の土台)。

---

## 5. 未決事項・E12 / 他 Epic への修正提案

### 5.1 E12(技術基盤)への追加要請

1. **`ops_events` テーブルの新設**(E10 所有、§2.1.2)。E12 §4.4 の永続化対象一覧に「codex 実行テレメトリ(codex_started / impl_failed)」の行を追加する。**proposal_id は TEXT(ULID)**(E05 の `proposals.id` に合わせる)。
2. **`settings` テーブルの新設**(キー・バリュー、§2.3)。OP-01 の上限を**再デプロイなしに**変えるため(環境変数だと再起動が要り進行中セットを落とす。E12 §4.5)。**この `settings` は E8 の EliminationParams(`elimination_theta`/`elimination_n_min`/`elimination_z`)と共用**する(E08 §3.3 が「設定テーブルから読む」としているため、テーブルを二重に作らない)。所有は E10、E8 は同表のキーを読み書きする、と分担を明記。
3. **有効ルール数カラムの新設要請は撤回**。旧版で提案した「`game_results.active_rule_count` 追加」は、そもそも `game_results` が存在せず(E08 の実モデルは `game_sets` + `set_rules`)、有効ルール数は `COUNT(set_rules WHERE was_active=1)` で導出できるため不要。**E10 が必要とするのは E08 §5.2-2 が既に E1/E3 へ要請している `set_rules.was_active` の書き込みだけ**であり、E10 独自の追加カラムは要らない(E08 の §5 提案に相乗りする)。
4. **deploy 失敗の終端 reason_code を定義**(§3.2・§4)。CI 通過・マージ後の「バンドル build・DB 登録」(E12 §4.6(4)・§4.7 手順6)が失敗した場合、提案が `implementing` のまま永久滞留しうる。これを `implementing → failed`(`reason_code='deploy_failed'`)へ遷移させることを E7/E5 に要請する(E05 §2.2 の failed 遷移群に 1 種追加)。これによりファネルの「進行中」に居座らず「実装失敗」に計上される。
5. **計装の同梱を E7 へ要請**(§2.1.4)。`recordOpsEvent` の呼び出しを (a) codex 起動直前(E10 governor 通過後、E7 ワーカー)に `codex_started`、(b) `implementing→failed` 遷移(E5 `transitionProposal` を E7 が呼ぶ点)と同一トランザクションで `impl_failed`(CI 段階)として同梱する。E10 は proposals/rule_eliminations に一切書かないため、この 2 点の計装だけが E7 側の負担になる。

### 5.2 E5 / E6 への要請

1. **遮断カウントの取得点**(§3.2)。遮断された投稿は `proposals` に行を作らない(E05 §2.1 で確定)ため、OP-02 の遮断数は E6 の検査ログから読むしかない。E6/YC-01 の検査ログに、**「遮断された投稿を distinct 単位で数えられ、発生時刻で日次集計できる」取得点**(件数ビュー or 読み取り関数)を用意することを要請する。E05 §5 が既に「検査ログは E6 所有の別テーブル」と E12 へ明記を求めており、その延長として E10 の集計要件を追記する。

### 5.3 E11 への要請

1. **都道府県カバー数の集計定義の共有**(§3.3)。OP-03 のカバー数と E11/RV-02 の図鑑側集計が食い違わないよう、**単一の共有集計関数**を使う。**正準ソースは `rules` 側(図鑑カタログ。E11 §3.2(e) の定義)で確定**する — released 提案 ⟷ rules 行は 1:1 で prefecture を引き継ぐため §3.3 の proposals ベースのクエリは同値な導出であり、検算用として扱う。都道府県は「出自の記録」で分布実態ではない(企画書 §4.1)注記の扱いも揃える。

### 5.4 決定待ち(開発者判断)

1. **codex subscription の実上限とウィンドウ形状**(E12 §7-2)。OP-01 の初期値(min_interval 600 秒 / daily_cap 30)は保守的な仮置きで、実上限判明後にローリングウィンドウへ較正が要る。手動 codex 利用やエンジン開発 PR も同じ枠を食う点を織り込み余裕を残す。
2. **採用率の分母定義**(§3.2)。本文書は「遮断・進行中を分母から除く」を提案。攻撃込みの生採用率も見たいなら両方出す。§11 が分母を規定していないので確定させたい。
3. **fun_rate の定義**(§3.3)を「fun ÷ 全評価(neutral を分母に含む)」で確定した(本文書の判断)。boring_rate を副指標に添え、OP-04 の排除閾値調整の引き金にする。
4. **都道府県カバーの定義**(§3.3)。実装到達ベース(排除済み含む・提案止まり除く)を主指標として提案。提案ベースを並記するかは開発者判断。
5. **インジェクション検査・可否判断に LLM を使う場合のコスト計測**(企画書 §9-8)。E6/CX-01 が従量課金 LLM を使う設計になったら、1 提案あたりの LLM コストも観測対象に加える(`ops_events.meta` にトークン/コストを載せ、`ops funnel` にコスト列を足す拡張で対応可能)。方式決定は E6/CX-01 待ちのため、本文書ではフック(meta へ載せられる構造)だけ用意し集計は後日足す。
6. **E8 の運営復活 API(reinstate)の認証基盤**(E08 §3.3(d) が E10 へ委譲): 昇格条件 4(管理 Web 化)到達までは CLI + SSH(`ops rule reinstate`)で代替し認証基盤は設けない。Web 化する場合に E10 がトークン保護の管理エンドポイントとして用意する(§2.4 の方針と対応)。

---

## 付録: 用語と参照

- **枠(利用枠)**: 開発者が subscription 契約している codex の実行可能量。従量課金 API ではなく契約済み枠で回す(企画書 §4.2・§8)ため、使い切るとパイプラインが止まる。OP-01 が守る対象。
- **二源集計**: 提案ファネルを `proposals`(検査通過分)と E6 検査ログ(遮断分)の 2 テーブルから合成すること。遮断投稿が proposals に行を持たない(E05 §2.1)ため必要になる。両者は互いに素で恒等式が成立する(§3.2)。
- **コホート集計**: 結果ではなく**開始時点**(ここでは提案日)でグルーピングする集計。採用率を歪みなく測るために OP-02 で採用。
- **有効ルール数**: セット開始時にレジストリが固定した有効ルールの数(E12 §4.6(4)・E08 §2.1)。`set_rules.was_active` の COUNT で導出し、そのセットを通じて不変。
- **レバー**: OP-04 でカオスを調整するために動かせる設定。EV-03 の排除閾値(θ/N_min/z、共用 settings)・PR-02 の優先度換算・OP-01 の codex 上限の 3 つ。値の所有は各 Epic、動かし方の手順は OP-04。
- 参照: 企画書 §8 / §9-8 / §10 / §11、バックログ OP-01〜04、E12 §4.4 / §4.7 / §6、E05(proposals・状態機械・遮断は行を作らない)、E08(game_sets・set_rules・set_evaluations の rating・rule_evaluations・rule_eliminations・EliminationParams)。
