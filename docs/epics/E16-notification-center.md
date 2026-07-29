# E16: アプリ内通知センター

- 作成日: 2026-07-29
- 状態: 提案(方向性は 2026-07-29 に開発者承認済み。詳細レビュー待ち)
- 一次情報源: `docs/リテンション施策提案.md`(§1.2・§2 施策A段階1)/ `docs/epics/E05-rule-proposal.md`(§3.3 通知方式の比較検討)/ `docs/epics/E12-tech-stack.md`(単一プロセス・SQLite・Socket.IO)/ `docs/epics/E03-multiplayer.md`(Socket.IO 接続・匿名トークン)

> **注意(実装済みコードとの関係)**: 提案の状態機械・案 A の未読バッジ(`users.proposals_seen_at`)・Socket.IO 接続基盤は本書の作成時点で**実装済み**である。本書は新規機能(通知センター)の設計と、**実装済みコードへの差分**(§4)を分けて書く。実装エージェントは §4 を作業リストとして使うこと。
>
> **位置づけ**: 本書が定義する通知イベントモデル(§2.2)は、E17(Web Push)・E18(フレンド)・E19(提案者スタッツ)が通知種別を追加登録する**土台**である。種別の一覧・スキーマの正は常に本書とする。

---

## 1. Epic 概要

### 1.1 目的

「自分のルール提案が通った(リリースされた)ことを知りたい」という中核ユースケース(リテンション施策提案 §2)に、**E15(ログイン)を待たず、匿名ユーザーのまま**応える。具体的には、

1. ヘッダーのベルアイコン+未読数バッジと、通知一覧画面(新しい順・通知ごとの既読)。
2. 提案の状態変化(リリース・却下・実装失敗・実装中入り)と新ルール登場を通知として配る仕組み。
3. 通知タップ→該当画面への遷移と、その計測(通知経由再訪数。施策提案 §1.2 の補助指標)。

外部サービス・追加インフラはゼロ。既存の単一 Node プロセス + SQLite + Socket.IO に完全に閉じる(E12 の運用物最小方針)。

### 1.2 決定の要約(2026-07-29 開発者承認)

| # | 決定 | 内容 |
|---|---|---|
| NC-D1 | 方式 | **E05 §3.3 案 B(アプリ内通知センター)の採用**。E15 不要で、匿名ユーザーにもそのまま動く。案 C(Web Push)は E17 として分離し、本 Epic の計測結果を投資判断の入力にする(E17 §1.2) |
| NC-D2 | 案 A との関係 | 実装済みの案 A(マイ提案の未読バッジ、`users.proposals_seen_at` の単一既読タイムスタンプ)とは**置換ではなく併存**。案 A の契約(「画面 7 を見たか」)は温存し、通知センターは通知レコードごとの既読(`read_at`)を独立に持つ。二重表示の混乱が観測されたら「センター側既読時に案 A 側も既読化」する片方向同期を後続検討する |
| NC-D3 | データ・配信 | `notifications` テーブルを **1 つ**追加(userId, type, payload, createdAt, readAt 相当。§2.3)。配信は Socket.IO **接続時の同期 + 接続中のリアルタイム push**。外部サービスなし |
| NC-D4 | 種別モデル | 通知種別のイベントモデルは **E16 が所有**し、後続 Epic が種別を追加登録する**拡張点**として設計する(§2.2)。初期種別は「提案リリース(最高)/提案却下・実装失敗(高)/審査中→実装中(中)/新ルール登場(全ユーザー・低)」。E18 のフレンド系 3 種別(誘い・申請・承認)・E19 の評価マイルストーンは**予約種別**として一覧に載せ、詳細は各 Epic に委ねる |
| NC-D5 | 計測 | 通知センター経由の再訪(通知タップ→該当画面遷移)を記録する(`opened_at`。§2.6)。施策提案 §1.2 の「通知経由再訪数」の計測元 |

### 1.3 担当ストーリー

| ID | 概要 | 依存 |
|---|---|---|
| NC-01 | 通知の発生と永続化(種別レジストリ + `notifications` テーブル + 既存イベント箇所への接続) | なし(E05/E07 の状態遷移実装済みが前提) |
| NC-02 | ベル + 未読数 + 通知一覧画面(既読管理・タップ遷移) | NC-01 |
| NC-03 | リアルタイム配信と計測(Socket.IO 配信・`opened_at` 記録) | NC-01・NC-02 |

ストーリー本文と受け入れ条件は本書 §3 が正。

### 1.4 他 Epic との接続

| 接続先 | 関係 |
|---|---|
| **E05(提案受付)** | 提案の状態機械(`transitionProposal`)は E05 所有のまま。E16 は遷移の**呼び出し元**(E7 のサービス群)に通知発行を差し込む(§2.4)。案 A の未読機構(`proposals_seen_at`・`unreadCount`)には触れない(NC-D2) |
| **E07(パイプライン)** | 却下・実装中入り・実装失敗・リリースの遷移を行う実装済みサービスが通知のイベントソース(§2.4)。E7 側のロジックは変えず、遷移成功時に通知発行を追加するだけ |
| **E03(マルチプレイ)** | Socket.IO 接続・匿名トークン認証・`activeByUser`(ユーザー ID→接続中ソケット)をそのまま使う。プロトコルに通知イベントを追加(§2.5) |
| **E17(Web Push)** | E16 と**同一のイベントソース・同一の種別モデル**から Push を送る(通知ロジックの二重実装はしない)。センターの未読滞留の計測(§2.6)が E17 の投資判断ゲートの入力になる |
| **E18(フレンド)/ E19(提案者スタッツ)** | 種別レジストリ(§2.2)に予約済みの種別を追加登録する。テーブル・配信・画面は E16 のものを使う |
| **E15(認証)** | **依存しない**(匿名で全部動く)。E15 後もユーザー行は同じなので通知は自然に引き継がれる |

---

## 2. 技術仕様

### 2.1 【決定】コンセプト: 「状態変化はすでに起きている。それを届ける」

提案の状態遷移・ルールの有効化はすべて実装済みで、DB に記録されている。本 Epic が足すのは、それらの**発生箇所に「通知レコードの作成」を 1 行差し込み、届けて、既読を管理する**ことだけである。ゲームロジック・提案パイプラインの挙動は一切変えない。

### 2.2 通知種別モデル(E16 所有の拡張点)

種別は `packages/server` 内の**種別レジストリ**(TS 定数マップ)で定義する。1 種別 = 種別コード + 優先度 + 対象(個人/全員) + ペイロード型 + 遷移先の定義。後続 Epic は**このマップに 1 エントリ追加する**ことで種別を登録する(テーブル・API・画面の変更は不要)。

```ts
// packages/server(E16 所有)。E17/E18/E19 がエントリを追加する
export interface NotificationTypeDefinition {
  type: string;                    // 種別コード(下表)
  priority: 'highest' | 'high' | 'medium' | 'low';
  audience: 'user' | 'broadcast';  // 個人宛 / 全ユーザー宛(§2.3 の配り方が変わる)
  // payload(JSON)の形と、タップ時の遷移先の導出はエントリごとに定義。
  // チャネル(センターのみ / センター+Push)は E17 が Push 側で参照する属性。
}
```

**種別一覧**(リテンション施策提案 §2 の表を基に、実装済み状態機械(却下/失敗の分割)と E18 の申請系 2 種別を反映して拡張。チャネル列の「+Push」は E17 実装後に有効になる)。

| 種別コード | 意味 | トリガー(実コード上の発生箇所は §2.4) | 対象 | チャネル | 優先度 | 状態 |
|---|---|---|---|---|---|---|
| `proposal_released` | 提案リリース | 自分の提案が `implementing → released` | 提案者 | センター+Push | 最高 | **E16 で実装** |
| `proposal_rejected` | 提案却下 | `screening → rejected` | 提案者 | センター+Push | 高 | **E16 で実装** |
| `proposal_failed` | 実装失敗 | `implementing → failed` | 提案者 | センター+Push | 高 | **E16 で実装** |
| `proposal_implementing` | 審査中→実装中 | `screening → implementing` | 提案者 | センターのみ | 中 | **E16 で実装** |
| `rule_debut` | 新ルール登場 | 他者の提案ルールが有効化 | 全ユーザー | センターのみ | 低 | **E16 で実装** |
| `friend_invite` | フレンドの部屋への誘い | E18 | フレンド | センター+Push | 高 | **予約**(詳細は E18) |
| `friend_request` | フレンド申請が届いた | E18 | 申請された人 | センターのみ | 中 | **予約**(詳細は E18) |
| `friend_accepted` | フレンド申請が承認された | E18 | 申請した人 | センターのみ | 中 | **予約**(詳細は E18) |
| `stats_milestone` | 自ルールの評価集計(「◯卓で高評価」) | E19(週 1 上限) | 提案者 | センター+Push(週1上限) | 中 | **予約**(詳細は E19) |

- 提案書の「提案却下/実装失敗」行は、実装済みの状態機械が `rejected` と `failed` を別遷移で持つ(E05 §2.2)ため、**同優先度の 2 種別コード**に分ける。ユーザー向けの見え方は同格。
- `payload` は種別ごとに最小限(例: `proposal_released` は `{ proposalId, ruleId, ruleName }`)。表示文はクライアントの種別→文言マッピングで組み立てる(E05 §3.3 の reason 表示と同じ流儀。文言は `docs/design/UI文言・情報量ガイド.md` に従う)。**個人情報は表示名以外含めない**(E17 §2.6 の Push 文面制約とペイロードを共通化するため、センター側から同じ規律で作る)。
- タップ時の遷移先: `proposal_*` → マイ提案(画面 7、`/proposals/mine`)。`rule_debut` → **ルール図鑑(`/rules`)を開く**(該当ルールへのスクロール・ハイライトは任意の演出。図鑑への個別ルール深リンクは現状の `SCREEN_PATHS` に無く、本 Epic の必須要件にしない)。予約種別の遷移先は各 Epic が定義。

### 2.3 データモデル

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(user_id),
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL,          -- JSON(種別ごとの最小データ)
  dedupe_key TEXT NOT NULL,          -- イベント固有 ID(冪等化。下記)
  created_at INTEGER NOT NULL,       -- エポックミリ秒
  read_at    INTEGER,                -- NULL=未読
  opened_at  INTEGER                 -- NULL=タップ遷移なし(計測用 §2.6)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications(user_id, created_at DESC);
-- 冪等化キー(同一イベントの二重発行防止 §2.4)
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe
  ON notifications(user_id, type, dedupe_key);
```

- `dedupe_key` はイベント固有 ID(提案系 = `proposalId`、`rule_debut` = `ruleId`)。パイプラインの at-least-once 再実行(E05 §2.2 の `noop` 設計)で同じ通知が二重に積まれない。
- 既存の起動時マイグレーション方式(`persistence.ts` の `CREATE TABLE IF NOT EXISTS` + `PRAGMA table_info` による列追加)に従う。
- **個人宛(audience=user)**: イベント発生時に対象ユーザーの行を 1 件 INSERT(fan-out on write)。対象は常に 1 人(提案者)なので書き込みは増えない。
- **全ユーザー宛(audience=broadcast、現状 `rule_debut` のみ)**: 全 `users` 行への一斉 INSERT は行わない(一見客の匿名行を含め無際限に膨らむ)。代わりに**取得時の遅延実体化**とする: 通知一覧の取得または Socket.IO 接続時に、そのユーザーの `users.notifications_seeded_at`(新設列。NULL=未実体化)以降に**初回有効化**されたルールを `rules` から引き、`rule_debut` 行を最大 10 件 INSERT してカーソルを進める。「有効化時点」の基準列は **`rules.activated_at`**(実装済み: 初回有効化時に `COALESCE(activated_at, now)` で 1 回だけ書かれ、以後更新されない — 2026-07-29 に `rules/repository.ts` で確認)。したがって disable→再 enable・ロールバック復帰では `activated_at` が動かず**再 debut しない**(冪等キー = `ruleId` も二重発行を防ぐ)。初回実体化はその時点から(過去のルールで新規ユーザーを埋めない)。自分の提案のルールは除外(`proposal_released` と重複するため)。なお `activated_at` のバックフィルは `status='active'` 行のみのため、移行前から disabled の旧ルールは NULL のまま残り、後日再 enable されるとその時刻で debut 扱いになりうる — 発生条件は極めて狭く、「再登場のおしらせ」として実害もないため許容する。これにより行数は「実際に再訪したユーザー × 直近のルール」に自然に絞られる。
- 保持期間: 初期は無制限(行は小さい)。将来の削除は E10 の CLI 流儀で(§5)。

### 2.4 イベントソース(実コード上の発火点)

すべての提案状態遷移は `ProposalRepository.transitionProposal`(`packages/server/src/proposal/repository.ts`)を経由するが、リポジトリ層は通知・ソケットを知るべきでないため、**遷移の呼び出し元(サービス層)に `NotificationService.publish()` を差し込む**。呼び出し元は以下の 4 か所で全部である(2026-07-29 実コード確認)。

| # | 発生箇所(実ファイル) | 遷移 | 発行する種別 |
|---|---|---|---|
| 1 | `pipeline/service.ts` `PipelineJudgementService.confirmE6Rejection` / `confirmCxRejection` | `screening → rejected` | `proposal_rejected` |
| 2 | `pipeline/service.ts` `PipelineJudgementService.approveSpec` | `screening → implementing` | `proposal_implementing` |
| 3 | `pipeline/jobs.ts` `PipelineJobService.fail` | `implementing → failed` | `proposal_failed` |
| 4 | `rules/service.ts` `RuleRegistryService`(`enable()` → `#releaseProposal`) | `implementing → released` + ルール有効化 | `proposal_released`(提案者宛)+ `rule_debut`(全ユーザー宛の実体化対象として `rules` に記録済み。§2.3) |

- #4 には既存の `onReleased` フック(`bin.ts` で `rule_released` ログに使用中)があり、通知発行はこのフックに相乗りする(フックは best-effort だが、通知発行自体を下記のとおりコミット後の best-effort と定めるため方針と一致する)。
- 通知の発行は**遷移トランザクションのコミット後の best-effort**とする(2026-07-29 裁定)。実コードの `transitionProposal` は自前のトランザクションを張るため、「同一トランザクション化」は呼び出し元の外側トランザクション化 = 遷移ロジックの変更を要してしまい、差分-2 の「遷移ロジック不変」と両立しない。呼び出し元は遷移結果が `transitioned` のときだけ `publish()` を呼び(`noop`/`forbidden` では発行しない)、`publish()` 内の失敗(INSERT・emit)は捕捉してログに留め、遷移・パイプラインの成否に影響させない(NC-01 の不変条件)。
- この方式の帰結として、冪等キー(§2.3)は再実行時の**二重発行**を防ぐが、コミット直後のクラッシュ等による**取り落とし**は防がない。通知センターは best-effort のチャネルであり、確定情報は常にマイ提案(案 A)側で得られる、という整理で許容する(E17 の Push 送信が fire-and-forget であるのと同じ方針)。Socket.IO への emit の失敗も同様に無視してよい(次回接続時の同期 §2.5 が拾う)。

### 2.5 配信(Socket.IO)

E03 の既存接続をそのまま使う。`socket-gateway.ts` は接続時に匿名トークンからセッションを解決し、`activeByUser: Map<userId, Socket>` を維持している — リアルタイム配信はこの Map を引いて emit するだけ。

`packages/core/src/protocol.ts` の `ServerToClientEvents` に追加:

| イベント | ペイロード | 発火タイミング |
|---|---|---|
| `notification:sync` | `{ unreadCount: number }` | 接続確立時(`session:ready` の直後)と、既読操作後の再計算時 |
| `notification:new` | `{ item: NotificationView }` | 接続中に新しい通知が発生したとき(ベルの未読数を +1 する) |

- 一覧の中身はソケットで流さず HTTP(§2.6)で取る(接続時ペイロードを重くしない。E12 §4.3 の「全量は状態、付随はイベント」の流儀)。
- **対局中の扱い**: `notification:new` は受信するがトースト等の割り込み演出は出さず、ベルの数字だけ更新する(ゲーム集中を妨げない。ベル自体も対局系画面には置かない §2.7)。

### 2.6 HTTP API と計測

既存の `app-server.ts` のハンドラ連鎖(`handleProposal` 等)と同型の `handleNotifications` を追加する。認証はすべて既存の Bearer(匿名トークン)。

| エンドポイント | 役割 |
|---|---|
| `GET /api/notifications` | 自分の通知一覧(新しい順・上限 50 件 + `unreadCount`)。取得時に broadcast の遅延実体化(§2.3)を行う |
| `POST /api/notifications/:id/read` | 単一既読化(`read_at = now`)。204 |
| `POST /api/notifications/:id/opened` | タップ遷移の記録(`opened_at = now`。未読なら同時に既読化)。204 |
| `POST /api/notifications/read-all` | 全件既読化。204(一覧画面の「すべて既読」) |

**計測(NC-D5)**: 「通知経由再訪」= `opened_at` の記録である。タップで該当画面へ遷移する直前にクライアントが `:id/opened` を打つ。集計は SQL 1 本(種別×日別の opened 数、未読滞留数)で足り、当面はダッシュボード化せず E10 の流儀(CLI + SSH)で読む。**E17 の投資判断ゲート**に使う「センターでは届かない層」= 「未読通知(特に `proposal_released`)を N 日以上放置しているユーザー数」もこのテーブルから SQL で出る。

### 2.7 UX 導線

文言・トーンは `docs/design/UI文言・情報量ガイド.md` に従う(ここに書く文言は仮)。

| 場面 | 挙動 |
|---|---|
| **ベルの配置** | 現状ヘッダーは常設でなく、`AppBar` コンポーネントを画面ごとに置く構成(メニュー/タイトルは `BrandHero` でヘッダーなし)。ベルは (a) `AppBar` に通知スロットを追加し図鑑・マイ提案等の画面で表示、(b) メニュー画面(画面 1b)の右上に単独配置、の両方で出す。**対局系画面(待機・対局・リザルト)には置かない**(集中と画面密度。E15 の「対局中はログイン導線非表示」と同じ判断) |
| **未読数バッジ** | ベル右上に未読数(99+ 上限。`MenuScreen` の既存未読バッジと同じ表現)。接続中は `notification:sync` / `notification:new` で更新 |
| **通知一覧(新画面)** | 新しい順。各行 = 種別アイコン + 表示文 + 相対時刻 + 未読ドット。タップで `opened` 記録 → 該当画面へ遷移。空状態は「おしらせはまだないよ」系の一文(`EmptyState` コンポーネント流用)。「すべて既読」を右上に |
| **案 A との併存(NC-D2)** | センターで `proposal_*` 通知を読んでも、マイ提案ボタンの未読バッジ(案 A)は画面 7 を開くまで残る。**これは仕様**(案 A の契約温存)。混乱が観測されたら片方向同期(センター既読→ `proposals_seen_at` 更新)を後続で足す |
| **リアルタイム受信** | メニュー等の非対局画面では、ベルの数字更新に加えて控えめなトースト(既存 `Toast` 流用)を出してよい(頻度は低い)。対局系画面では数字のみ(§2.5) |

### 2.8 テスト戦略

- 種別レジストリ: 全種別のペイロード生成・遷移先導出。予約種別(`friend_invite`/`friend_request`/`friend_accepted`/`stats_milestone`)が未実装のまま一覧・表示を壊さないこと。
- 発行: §2.4 の 4 発火点それぞれで通知が 1 件できる。遷移 `noop` 時は発行されない。同一イベント再実行で冪等(UNIQUE)。
- broadcast 実体化: 初回接続で過去ルールが積まれない / 2 回目以降の取得で新規有効化分だけ積まれる / 自分のルールは除外 / 上限 10 件。
- API: 認証(401)・他人の通知に触れない・既読/opened/read-all の各遷移・`unreadCount` の整合。
- 配信: 接続時 `notification:sync`、接続中発生で `notification:new`、切断中の発生が次回接続の sync に反映。
- クライアント: ベル表示画面の出し分け(対局系で非表示)・一覧・タップ遷移・375×812 での目視確認(既存 Epic と同じ検証水準)。

---

## 3. ストーリー詳細・受け入れ条件

### NC-01: 通知の発生と永続化

「提案者として、自分の提案の結果(リリース・却下・実装失敗)が、アプリのどの画面にいても後から確実にわかる形で記録されてほしい」

受け入れ条件:

- [ ] `notifications` テーブルと種別レジストリが存在し、§2.2 の実装 5 種別が定義されている(予約 4 種別はコード上のコメント・一覧表として明示)
- [ ] §2.4 の 4 発火点で該当種別の通知が作成される(遷移 `noop` 時は作成されない)
- [ ] 同一イベントの再実行で通知が重複しない(冪等キー)
- [ ] `rule_debut` が遅延実体化で配られ、初回利用ユーザーに過去分が積まれない・自分のルール分が除外される
- [ ] 通知作成は既存の提案パイプライン・ルール有効化の成否に影響しない(通知側の失敗で遷移が失敗しない)

### NC-02: ベルと通知一覧

「プレイヤーとして、アプリを開いたとき未読のおしらせがあることに気づき、一覧から内容を確認して該当画面に飛びたい」

受け入れ条件:

- [ ] メニュー画面と非対局系の `AppBar` 画面にベル+未読数が出る。対局系画面(待機・対局・リザルト)には出ない
- [ ] 通知一覧が新しい順に表示され、未読が視覚的に区別される。タップで該当画面(マイ提案 / ルール図鑑)へ遷移し、その通知が既読になる
- [ ] 「すべて既読」で未読数が 0 になる
- [ ] 案 A のマイ提案未読バッジが従来どおり独立に動き続ける(センターの既読で消えない。既存テストが成立し続ける)
- [ ] 375×812 の実画面で導線一式を目視確認

### NC-03: リアルタイム配信と計測

「プレイヤーとして、アプリを開いている間に自分の提案がリリースされたら、その場で気づきたい。運営として、通知が再訪に効いたかを数えられるようにしたい」

受け入れ条件:

- [ ] Socket.IO 接続時に未読数が同期され、接続中の新規通知でベルの数字が即時に増える
- [ ] 切断中に発生した通知が、次回接続時の同期・一覧取得で漏れなく見える
- [ ] 通知タップで `opened_at` が記録され、種別×日別の通知経由遷移数が SQL で集計できる
- [ ] 「未読の `proposal_released` を N 日以上放置しているユーザー数」が SQL で出せる(E17 投資判断ゲートの入力)

---

## 4. 既存実装への差分(作業リスト)

2026-07-29 に実コードを確認した現状に基づく。

| # | 対象 | 現状 | 変更 |
|---|---|---|---|
| 差分-1 | `packages/server/src/persistence.ts` | `users`/`proposals` 等の `CREATE TABLE IF NOT EXISTS` + `PRAGMA table_info` 列追加マイグレーション。リポジトリ群を `SqlitePersistence` のフィールドとして構築 | `notifications` テーブル(§2.3)+ `users.notifications_seeded_at` 列を同方式で追加。`NotificationRepository` を新設しフィールドに追加 |
| 差分-2 | `packages/server/src/pipeline/service.ts` / `pipeline/jobs.ts` | `confirmE6Rejection`・`confirmCxRejection`・`approveSpec`(service.ts)、`fail`(jobs.ts)が `transitionProposal` を呼ぶ | 各遷移が `transitioned` を返した後(遷移トランザクションの外・コミット後)に `NotificationService.publish()` を best-effort で追加(コンストラクタ注入。§2.4)。遷移ロジックは不変 |
| 差分-3 | `packages/server/src/rules/service.ts` / `bin.ts` | `enable()` → `#releaseProposal` が `implementing → released` 遷移。`onReleased` フックあり(`bin.ts` がログに使用)。`rules.activated_at` は初回有効化時に記録済み | `onReleased` フックに相乗りして `proposal_released` をコミット後 best-effort で発行(§2.4 #4)。broadcast(`rule_debut`)は既存の `rules.activated_at` を基準に遅延実体化するため(§2.3)、有効化側への追加記録は不要 |
| 差分-4 | `packages/core/src/protocol.ts` | `ServerToClientEvents` は `session:ready`/`room:state`/`room:closed`/`session:superseded` の 4 つ | `notification:sync`・`notification:new` を追加(§2.5) |
| 差分-5 | `packages/server/src/room/socket-gateway.ts` | 接続時にセッション解決・`session:ready` emit。`activeByUser: Map<userId, Socket>` を維持 | 接続時に `notification:sync` を emit。`NotificationService` から userId 指定でリアルタイム emit できる口(`activeByUser` 参照)を提供 |
| 差分-6 | `packages/server/src/app-server.ts` | `handleProposal`/`handleYellowCards` 等のハンドラ連鎖 + Bearer 認証ヘルパ | `handleNotifications`(§2.6 の 4 エンドポイント)を同型で追加。`AppServerOptions` に通知サービスを追加 |
| 差分-7 | `packages/server/src/bin.ts` | 各サービスを組み立てて `createAppServer` に渡す構成 | `NotificationService` を構築し、pipeline 系サービス・`RuleRegistryService`・gateway・app-server に配線 |
| 差分-8 | `packages/web/src/routing.ts` / `store/screen.ts` | `SCREEN_PATHS` に画面 ID→パスの静的表 | `notifications: '/notifications'` を追加 |
| 差分-9 | `packages/web/src/App.tsx` | メニュー表示時に `proposalApi.mine()` で `unreadProposalCount` を取得(案 A) | 通知クライアント(`packages/web/src/notification/client.ts` 新設。`proposal/client.ts` と同型)・ソケットイベント購読・未読数 state・通知一覧画面の組み込み。案 A の取得ロジックは**不変** |
| 差分-10 | `packages/web/src/components/AppBar.tsx` / `screens/MenuScreen.tsx` | `AppBar` は title/back/action のみ。メニューはヘッダーなし | `AppBar` にベルスロット追加(非対局系のみ)。メニュー右上にベル配置(§2.7) |
| 差分-11 | 新画面 | — | `NotificationsScreen`(一覧。`EmptyState`・既存カード様式を流用) |

既存データへの影響: なし(テーブル・列の追加のみ。案 A の `proposals_seen_at` と関連 API は無変更)。

---

## 5. スコープ外・将来課題

| 項目 | 扱い |
|---|---|
| Web Push | **E17**(本 Epic の計測結果が投資判断の入力) |
| フレンド誘い通知・評価マイルストーン通知の実装 | E18 / E19(本書は種別コードの予約のみ) |
| 案 A との片方向同期(センター既読→提案バッジ既読) | 併存で出し、混乱が観測されたら後続で(NC-D2) |
| 通知の削除・保持期間 | 初期は無制限。必要になったら CLI(E10 の流儀)で古い既読分を削除 |
| 通知設定(種別ごとの表示 ON/OFF) | センターは全種別表示(情報の取りこぼしを作らない)。ON/OFF は E17 の Push にのみ導入 |
| メール通知 | 採らない(E15 のメール非取得方針。施策提案 §5 の枠外事項) |
| ダッシュボードでの計測可視化 | 当面 SQL 直読み(E10)。可視化はフェーズ 3 以降の判断 |

## 6. 未決事項・開発者タスク

| # | 内容 | デフォルト案 | 期限 |
|---|---|---|---|
| NC-T1 | `rule_debut` の遅延実体化の上限(1 回の取得で最大何件積むか)と、トースト表示の要否 | 上限 10 件・トーストは非対局画面のみ控えめに(§2.3・§2.7) | NC-01 実装レビュー |
| NC-T2 | ベルの具体配置(メニュー右上 + AppBar 通知スロットの見た目)と一覧画面の文言 | §2.7 案で仮実装し、375×812 の実画面レビューで裁定。文言は UI 文言ガイド準拠で仮置き | NC-02 完了レビュー |
| NC-T3 | E17 投資判断ゲートの閾値(「未読 `proposal_released` を N 日放置」の N と、判断に足るサンプル数) | N=7 日(提案者 7 日再訪率と整合)。判断時期はリリース後の実測を見て開発者が決める | E17 着手判断まで |
| NC-T4 | `stats_milestone`(E19)の「週 1 上限」をレジストリの共通属性(レート制限)にするか E19 個別実装にするか | E16 では汎用化しない(YAGNI)。E19 着手時に個別実装から始める | E19 着手時 |
