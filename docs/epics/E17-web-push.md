# E17: Web Push 通知(PWA 化を含む)

- 作成日: 2026-07-29
- 状態: 実装済み(2026-08-01。WP-01〜03。VAPID 設定と実機受入は runbook の実施待ち)
- 一次情報源: `docs/リテンション施策提案.md`(§2 施策A段階2)/ `docs/epics/E16-notification-center.md`(通知種別モデル・イベントソースの正)/ `docs/epics/E05-rule-proposal.md`(§3.3(g) Web Push 見送りの判断基準)/ `docs/epics/E15-auth-account.md`(登録済みユーザーの定義)/ `docs/epics/E12-tech-stack.md`(単一プロセス・運用物最小方針)

> **前提(着手ゲート)**: 本 Epic は設計を先に固めるが、**着手には 2 つの前提がある**(§1.1)。(1) **E15(Google 紐付け)のリリース** — 本書の対象者「提案者」は E15 後は全員登録済みになる。E15 は本書の作成時点で**実装未着手**である。(2) **E16 の計測による投資判断** — 「センターでは届かない層」(未読の `proposal_released` を放置して再訪しないユーザー)の規模を E16 で計測し(E16 §2.6・NC-T3)、E05 §3.3(g) の判断基準「離脱ユーザーに届かない問題が再訪に効くか」をデータで確認してから着手する。**この判断を経ずに実装着手しない**(例外: WP-01 の PWA 化のみ両前提と独立に先行できる。§1.3)。
>
> **2026-08-01 上書き裁定**: 開発者が今回に限り上記ゲートを明示的に上書きし、E16 に続けて **E17 全体(WP-01〜03)を実装する**と裁定した。ゲートの設計意図と計測 SQL は将来の効果検証用に残す。

---

## 1. Epic 概要

### 1.1 目的と依存

アプリを開いていない提案者に「自分の提案の結果が出た」ことを届ける。E16 の通知センターはプル型(再訪しないと気づけない)であり、最も熱量の高い瞬間(提案リリース)を離脱中の提案者に届けられない — その穴を Web Push で塞ぐ。

依存関係(順序は施策提案 §5 のロードマップどおり):

```
E16(通知センター)──計測──▶ 投資判断ゲート ──▶ E17 着手
E15(Google 紐付け)────── リリース ─────────▶ E17 着手
```

Push は**常に E16 の複製**である(WP-D4)。通知の発生・種別・ペイロードは E16 の種別モデル(E16 §2.2)をそのまま使い、E17 は「センターに書かれた通知を、購読者へ Push でも送る」送信経路を 1 本足すだけ。通知ロジックの二重実装はしない。

### 1.2 決定の要約(2026-07-29 開発者承認)

| # | 決定 | 内容 |
|---|---|---|
| WP-D1 | 着手ゲート | **E15 リリース + E16 計測にもとづく投資判断**の 2 つを満たすまで実装着手しない(冒頭注)。E05 §3.3 で Web Push が見送られた 3 理由(恒久チャネル無し・許諾摩擦・運用負荷)への回答が施策提案 §2 の表であり、本書はその回答を設計に固定する |
| WP-D2 | 対象者 | **当初は提案者限定**。E15 後は提案者 = 全員 Google 紐付け済み(`users.google_sub IS NOT NULL`)なので恒久 ID が保証される。**匿名ユーザーに Push 購読を求めない**(許諾 UI 自体を出さない) |
| WP-D3 | オプトイン | **文脈付きオプトイン**。初回訪問時に許諾 UI を一切出さない。**提案送信直後**に「結果が出たら通知を受け取る?」を提示し、承諾した場合のみブラウザの許諾ダイアログへ進む(提案しない限り Push 許諾 UI は存在しない) |
| WP-D4 | センターとの関係 | Push 種別ごとに ON/OFF 可能。**Push は常にセンターの複製**であり、Push でしか得られない情報を作らない(許諾しない・できない子供が不利にならない) |
| WP-D5 | 子供向け配慮 | **夜間(21:00〜翌 7:00、Asia/Tokyo 固定)は全種別の Push 送信を抑止**し、通知はセンターに積まれたままにする。Push 文面に個人情報を含めない(表示名以外) |
| WP-D6 | 技術方式 | Service Worker + Web App Manifest(PWA 化)+ VAPID + `web-push` npm。`push_subscriptions` テーブルを追加。送信は **E16 と同じイベントソース**から、既存の単一 Node プロセス内で完結。外部サービス・追加インフラなし |

### 1.3 担当ストーリー

| ID | 概要 | 依存 |
|---|---|---|
| WP-01 | PWA 化(manifest + Service Worker 基盤。Push なしでもホーム画面追加が成立する) | なし(E15/E16 と独立に先行可能な唯一の部分) |
| WP-02 | Push 購読と文脈付きオプトイン(購読 API + 提案送信直後の提示 + 種別ごと設定) | WP-01・E15・E16 |
| WP-03 | Push 送信(E16 イベントソース接続・夜間抑止・失効処理・Push 経由再訪の計測) | WP-02 |

ストーリー本文と受け入れ条件は本書 §3 が正。

### 1.4 他 Epic との接続

| 接続先 | 関係 |
|---|---|
| **E16(通知センター)** | 種別モデル・イベントソース・ペイロードの正は E16。E17 は種別レジストリの「チャネル」属性(センター+Push の種別。E16 §2.2 の表)を参照して送信対象を決める。E16 §2.6 の計測(未読放置ユーザー数)が着手ゲートの入力 |
| **E15(認証)** | 購読は登録済みユーザー(`google_sub IS NOT NULL`)限定(WP-D2)。購読は `users.user_id` に紐づくため、別端末ログイン(E15 AU-D3 のトークン切替)後も同一ユーザーとして購読が引き継がれる(端末ごとに購読行は別) |
| **E18(フレンド)/ E19(スタッツ)** | `friend_invite`・`stats_milestone` が「センター+Push」チャネルの予約種別(E16 §2.2)。各 Epic が種別を実装すれば、E17 の送信経路に自動で乗る(E17 側の追加実装は不要) |
| **E12(技術基盤)** | 単一プロセス内で `web-push` により直接送信。運用物の増加は VAPID 鍵ペア 1 組(環境変数)のみ |
| **E13(デプロイ)** | Service Worker のキャッシュ戦略はデプロイ(アセット更新)と干渉しうる(§2.2)。SW はキャッシュ最小(Push 受信専用に近い形)から始める |

---

## 2. 技術仕様

### 2.1 全体像

```
E16 NotificationService.publish()
  ├─ notifications INSERT(センター。E16 §2.4)
  ├─ Socket.IO emit(接続中ユーザー。E16 §2.5)
  └─ PushSender.send()(E17 追加)
       ├─ 種別のチャネルが「センター+Push」か? ─ No → 何もしない
       ├─ 夜間(21:00〜7:00 JST)か? ─ Yes → 何もしない(§2.6)
       ├─ 対象ユーザーの有効な購読 × 種別 ON か?(§2.4)
       └─ web-push で各購読 endpoint へ送信(失敗コードにより購読失効 §2.5)
```

送信は通知発生時のインライン処理(fire-and-forget の非同期呼び出し)とし、キュー・スケジューラを新設しない(単一プロセス・運用物最小)。送信失敗はセンターが常に正であるため許容できる(WP-D4 の設計上の利点)。

### 2.2 PWA 化(WP-01)

- **Web App Manifest**: `packages/web/public/manifest.webmanifest` を新設し、`index.html` に `<link rel="manifest">` を追加。アイコンは既存の事前生成物(`packages/web/public/icon-192.png` / `icon-512.png`。2026-07-29 実コード確認で存在)をそのまま使う。`theme-color`(`#2B6FC2`)・タイトル・説明は `index.html` の既存値と一致させる(design-tokens の CI 照合 `scripts/check-design-tokens.mjs` との整合に注意)。
- **Service Worker**: `packages/web/` に SW ソースを新設(Vite のビルドに組み込む。プラグイン選定は実装時。自前の小さな SW で足りる想定 — プリキャッシュはせず、`push` / `notificationclick` ハンドラ + 最小の fetch フォールバックのみ)。**アプリ本体のオフラインキャッシュは本 Epic ではやらない**(キャッシュ起因の「更新が届かない」事故は Push の価値を損なう。§5)。
- **iOS(WP-T1 確認済み: 2026-08-01)**: WebKit の公式情報で、iOS/iPadOS 16.4 以降は**ホーム画面に追加した Web App**が Web Push を使え、許諾要求はボタン操作などの直接的なユーザー操作から行う必要があることを確認した。実装は standalone 判定で「ホーム画面に追加」案内に分岐し、提案送信後の「通知を受け取る」操作だけが `Notification.requestPermission()` を呼ぶ。Safari 18.4 の Declarative Web Push は任意の新方式であるため、初期実装は幅広い互換性を優先し Push API + Service Worker を維持する。出典: [WebKit: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Apple: Sending web push notifications](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers), [WebKit: Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/)。

### 2.3 データモデル

```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL REFERENCES users(user_id),  -- 登録済みユーザーのみ(§2.4)
  endpoint       TEXT NOT NULL UNIQUE,   -- Push サービスの endpoint URL
  keys_p256dh    TEXT NOT NULL,          -- 購読の公開鍵
  keys_auth      TEXT NOT NULL,          -- 購読の認証秘密
  created_at     INTEGER NOT NULL,
  last_sent_at   INTEGER,                -- 直近の送信成功(観測用)
  revoked_at     INTEGER                 -- NULL=有効。失効(410 等)・ユーザー OFF で設定
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions(user_id);

-- 種別ごとの Push ON/OFF(ユーザー単位。購読=端末単位とは独立)
CREATE TABLE IF NOT EXISTS push_preferences (
  user_id    TEXT NOT NULL REFERENCES users(user_id),
  type       TEXT NOT NULL,              -- E16 種別コード
  enabled    INTEGER NOT NULL,           -- 0/1
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, type)
);
```

- 1 ユーザー n 端末 = n 購読行。端末の区別はしない(endpoint が事実上の端末 ID)。
- `push_preferences` に行が無い種別は**既定 OFF**。オプトイン(WP-D3)で承諾した場合に「自分の提案の結果」系(`proposal_released` / `proposal_rejected` / `proposal_failed`)を ON にする。それ以外の種別(予約種別含む)は設定画面で明示的に ON にしたときだけ送る(施策提案 §2 のオプトイン設計)。
- 既存の起動時マイグレーション方式(`persistence.ts`)に従う。E16 の `notifications` とは独立したテーブルで、E16 側への変更はない。

### 2.4 購読 API と対象者ゲート

`app-server.ts` のハンドラ連鎖に `handlePush` を追加。認証は既存 Bearer(匿名トークン)。

| エンドポイント | 役割 |
|---|---|
| `GET /api/push/config` | `{ vapidPublicKey, available }` を返す(未設定環境では `available: false`。§2.8) |
| `POST /api/push/subscriptions` | 購読登録。body = PushSubscription JSON(endpoint + keys)。**登録済みユーザー(`google_sub IS NOT NULL`)でなければ 403 `registration_required`**(E15 §2.6 の提案 API ゲートと同じエラー語彙)。同一 endpoint の再登録は upsert(冪等) |
| `DELETE /api/push/subscriptions` | body の endpoint の購読を失効(`revoked_at`)。ブラウザ側の購読解除と対で呼ぶ |
| `GET /api/push/preferences` / `PUT /api/push/preferences` | 種別ごとの ON/OFF の取得・更新(センター+Push チャネルの種別のみ受け付ける) |

- 匿名ユーザーにはクライアント側で購読導線自体を出さない(WP-D2)。API の 403 は防御の二重化。
- E15 のログアウト(トークン破棄→新規匿名化)時は、クライアントがブラウザ購読を解除し DELETE を呼ぶ(共有端末で他人に通知が届き続けることを防ぐ。§2.9 エッジケース)。

### 2.5 送信(WP-03)

- `web-push` npm + VAPID。E16 の `NotificationService.publish()` から、センター INSERT・ソケット emit に続けて `PushSender.send(userId, notification)` を呼ぶ(§2.1 のフロー)。E16 側の差分はこの 1 呼び出しの追加のみ。
- 送信条件: 種別チャネルが「センター+Push」∧ 夜間でない ∧ ユーザーの `push_preferences` で当該種別 ON ∧ 有効な購読が 1 件以上。
- **ペイロード**: `{ type, title, body, url, notificationId }`。文面はセンターの表示文と同一のマッピングから生成(E16 §2.2。表示名以外の個人情報を含めない — E16 側でペイロード規律を共通化済み)。`url` は E16 の種別ごとの遷移先に `?src=push&nid=<notificationId>` を付けたもの(§2.7)。
- **失効処理**: 送信が 404/410 を返した購読は `revoked_at` を立てて以後送らない(Push サービス側の購読失効)。その他のエラーはログのみ(リトライしない — センターが正)。
- 週 1 上限つきの `stats_milestone`(E19 予約)のレート制御は E19 側の発行時制御に委ね、E17 は送らない判断をしない(E16 NC-T4 と同じ整理)。

### 2.6 夜間抑止(WP-D5)

- **21:00〜翌 7:00、タイムゾーンは Asia/Tokyo 固定**(ユーザーのローカル時刻ではない。利用者はほぼ国内想定で、実装と検証が単純になる方を取る)。判定はサーバー側 `PushSender` 内で送信直前に行う。
- 抑止された通知は**後追い送信しない**(朝のまとめ送信はしない)。センターには通常どおり積まれているので情報は失われない。まとめ送信をやるにはスケジューラという運用物が増えるため、必要性が観測されてから検討する(§5・WP-T3)。

### 2.7 計測

- Push 経由の再訪 = SW の `notificationclick` で開く URL に **`?src=push` と `nid=<notificationId>` の両方**を付与する(SW はペイロードの `notificationId` を URL に転写する。開いたページは SW のペイロードを直接参照できないため、URL パラメータだけで `POST /api/notifications/:id/opened` を打てることが要件)。クライアントは起動時に `src=push` と `nid` を検出して opened を記録し、パラメータを URL から除去する。センター内タップと同じ `opened_at` に集約され、**流入元(センター/Push)は URL パラメータ経由で区別して記録**する(`notifications` に `opened_via` 列を足すか、opened API の body で渡す — 実装時に軽い方を選ぶ。E16 §2.6 の集計 SQL がチャネル別に切れることが要件)。
- 観測したい指標: Push 許諾率(オプトイン提示→承諾)、Push 送信数/開封数(種別別)、Push 経由セッションの提案者 7 日再訪率への寄与(施策提案 §2 の期待効果)。当面 SQL 直読み(E10 の流儀)。

### 2.8 設定・シークレット

| 変数 | 内容 |
|---|---|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `web-push generate-vapid-keys` で 1 回生成する鍵ペア |
| `VAPID_SUBJECT` | `mailto:` または本番 URL(Push サービスへの連絡先表明) |

- 未設定なら Push 機能だけ無効。役割別に確定する: **`GET /api/push/config` は 200 + `{ available: false }`**(クライアントの導線出し分け用の照会であり、エラーではない)。**購読系 API(`POST`/`DELETE /api/push/subscriptions`、`GET`/`PUT /api/push/preferences`)は 503 `{ error: 'push_unavailable' }`**(E15 §2.9 の `auth_unavailable` 503 と同じ縮退の流儀)。開発・テストは `web-push` をモックした `FakePushTransport`(§2.10)で実クレデンシャルなしに完了できる。
- **開発者タスク**(WP-T2): 鍵の生成と `fly secrets set`。

### 2.9 エラー・エッジケース

| ケース | 挙動 |
|---|---|
| ブラウザ許諾で「拒否」 | 購読せず終了。センターで全情報が得られる旨を一言表示。再提示はしない(設定画面からはやり直せる) |
| 許諾済みだが購読が失効(410) | `revoked_at`。次回アプリ起動時にクライアントが購読状態の不一致を検出したら再購読を提案 |
| ログアウト(E15) | クライアントが購読解除 + DELETE(§2.4)。呼び漏れた場合も、新匿名ユーザーは購読を持たないため誤配はない(旧ユーザー宛が届き続ける問題への保険として、設定画面に「この端末への通知を止める」を置く) |
| 別端末ログイン(E15 分岐 2) | 端末 A・B それぞれの購読が同一ユーザーに並ぶ(正常)。両端末に届く |
| 匿名ユーザーが購読 API を直叩き | 403 `registration_required`(§2.4) |
| VAPID 未設定環境 | 導線非表示。config は 200 + `available: false`、購読系 API は 503 `push_unavailable`(§2.8) |
| iOS で PWA 未追加 | Push 購読不可(前提)。オプトイン導線がホーム画面追加の案内に分岐(§2.2。WP-T1 の確認結果で確定) |
| 送信時にプロセス再起動 | 送り漏れはあり得る(fire-and-forget)。センターが正なので許容(§2.1) |

### 2.10 テスト戦略

- `PushSender` を transport 注入(`WebPushTransport` / `FakePushTransport`)にする(E15 の FakeAuthProvider・FakeCodexRunner と同じ流儀)。
- 単体: 送信条件の全分岐(チャネル外種別は送らない・OFF は送らない・夜間は送らない・失効購読は送らない)、夜間境界(20:59/21:00/6:59/7:00 JST)、410 での失効、endpoint upsert の冪等性、403 ゲート、preferences の既定 OFF。
- E16 結合: `publish()` 1 回でセンター INSERT + Push 送信が同一ペイロード源から出ること(文面の二重定義がないこと)。
- クライアント: オプトイン提示の条件(提案送信直後・登録済み・未購読のときだけ)、`?src=push&nid=<notificationId>` 検出→ opened 記録→パラメータ除去(§2.7)、設定画面の ON/OFF round-trip。
- 実ブラウザでの通し確認(デスクトップ Chrome/Firefox + iOS 実機のホーム画面追加)は WP-T1/T2 完了後に手動で行い、手順を impl-progress に記録。

---

## 3. ストーリー詳細・受け入れ条件

### WP-01: PWA 化(manifest + Service Worker 基盤)

「プレイヤーとして、ホーム画面からアプリのように起動したい(Push の受け皿を整える)」

受け入れ条件:

- [ ] manifest が配信され、Chrome・iOS Safari でホーム画面追加すると standalone 起動する(アイコン・テーマ色は既存デザイン生成物と一致)
- [ ] Service Worker が登録され、アプリ本体の表示・更新(デプロイ後の新アセット取得)を妨げない(オフラインキャッシュはしない)
- [ ] SW 未対応・未登録環境でも従来どおり全機能が動く
- [ ] Push 未実装のこの段階では許諾ダイアログが一切出ない

### WP-02: Push 購読と文脈付きオプトイン

「提案者として、提案を送った流れのなかで『結果が出たら知らせて』を選びたい。それ以外の場面で許諾をせがまれたくない」

受け入れ条件:

- [ ] 初回訪問・通常プレイ・匿名ユーザーには Push 許諾 UI が一切出ない
- [ ] 登録済みユーザーの提案送信直後にだけ「結果が出たら通知を受け取る?」が提示され、承諾時のみブラウザ許諾→購読登録が走る(拒否してもセンターで全情報が得られる)
- [ ] 購読は `push_subscriptions` に保存され、匿名ユーザーの購読 API は 403 `registration_required`
- [ ] 種別ごとの ON/OFF が設定でき、既定は「自分の提案の結果」系のみ ON 候補として提示される
- [ ] ログアウトで購読が解除される
- [ ] FakePushTransport で上記が自動テストされている

### WP-03: Push 送信・夜間抑止・計測

「離脱中の提案者として、自分の提案がリリースされたら端末の通知で知りたい。運営として、夜間に子供へ通知を飛ばしたくない」

受け入れ条件:

- [ ] E16 の通知発生(センター INSERT)と同一イベント・同一文面源から、「センター+Push」チャネル種別のみが購読端末へ届く
- [ ] Push の内容がセンターの複製であること(Push でしか得られない情報がないこと)がテストで担保されている
- [ ] 21:00〜7:00(Asia/Tokyo)は全種別の Push が送信されず、センターには通常どおり積まれる。後追い送信もされない
- [ ] 文面に表示名以外の個人情報が含まれない
- [ ] 失効した購読(410)へ送り続けない
- [ ] Push 通知タップでアプリの該当画面が開き、`opened_at` が Push 経由と識別可能な形で記録される

---

## 4. 既存実装への差分(作業リスト)

2026-07-29 に実コードを確認した現状に基づく(E16 §4 の差分適用後を前提とする)。

| # | 対象 | 現状 | 変更 |
|---|---|---|---|
| 差分-1 | `packages/web/public/` / `index.html` | icon-192/512・apple-touch-icon・theme-color は存在。**manifest・Service Worker は無い**(2026-07-29 確認) | `manifest.webmanifest` 追加 + `<link rel="manifest">`。SW ソースと登録コードを追加(§2.2。Vite ビルドへの組み込み方法は実装時選定) |
| 差分-2 | `packages/server/src/persistence.ts` | E16 差分-1 適用後: `notifications` あり | `push_subscriptions`・`push_preferences` を既存マイグレーション方式で追加。`PushRepository` 新設 |
| 差分-3 | E16 の `NotificationService` | センター INSERT + Socket.IO emit | `PushSender.send()` 呼び出しを 1 行追加(§2.1)。種別レジストリのチャネル属性を参照 |
| 差分-4 | `packages/server/src/app-server.ts` | E16 差分-6 適用後: `handleNotifications` あり | `handlePush`(§2.4 の 4 エンドポイント)を同型で追加 |
| 差分-5 | `packages/server/src/bin.ts` | 各サービスの組み立て | `PushSender`(VAPID 設定読み込み・未設定時は無効化)を構築し配線 |
| 差分-6 | `packages/web/src/screens/ProposalFormScreen.tsx` ほか | 提案送信成功→マイ提案へ遷移 | 送信成功後のオプトイン提示(登録済み・未購読のときのみ。E15 の未登録分岐と共存)。設定画面(種別 ON/OFF・「この端末への通知を止める」)の追加 |
| 差分-7 | `packages/web/src/App.tsx` / 起動処理 | — | SW 登録・`?src=push` 検出→ opened 記録・購読状態の不一致検出(§2.9) |
| 差分-8 | 依存 | — | `web-push` を server に追加 |
| 差分-9 | 設定 | — | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`。未設定時は機能無効(§2.8) |

既存データへの影響: なし(テーブル追加のみ)。E16 の `notifications` スキーマ・API は不変(`opened_via` の扱いのみ §2.7 の実装時判断)。

---

## 5. スコープ外・将来課題

| 項目 | 扱い |
|---|---|
| 匿名ユーザーへの Push | やらない(WP-D2)。E15 の登録が広がるほど対象が自然に広がる |
| 夜間抑止分の朝まとめ送信 | やらない(スケジューラという運用物が増える)。センター未読で足りない実態が観測されたら再検討(WP-T3) |
| アプリ本体のオフラインキャッシュ・オフライン対応 | やらない(§2.2)。Push 受信専用 SW から始める |
| メール・SMS 等の他チャネル | 採らない(E15 のメール非取得方針) |
| 通知のグルーピング・サマリ配信(週次ダイジェスト Push) | C-1(週次ダイジェスト)の検討時に。本 Epic は単発通知のみ |
| リッチ通知(画像・アクションボタン) | 初期はテキストのみ。効果が見えたら |
| 送信のキュー化・リトライ | しない(センターが正、fire-and-forget)。送信量が増えて Push サービスのレート制限に当たる規模になったら再設計 |

## 6. 未決事項・開発者タスク

| # | 内容 | デフォルト案 | 期限 |
|---|---|---|---|
| WP-T1 | **iOS の Web Push 最新挙動の再確認**(ホーム画面追加が受信の前提か、許諾 UI の制約、standalone 判定方法) | **2026-08-01 完了**。§2.2 に公式情報と実装判断を記録 | 完了 |
| WP-T2 | VAPID 鍵の生成・`fly secrets set` | — (開発は FakePushTransport で先行可) | WP-03 の実ブラウザ通し確認まで |
| WP-T3 | 投資判断ゲートの実施(E16 計測値のレビューと着手可否の裁定。閾値の目安は E16 NC-T3) | **2026-08-01 に開発者が今回の着手ゲートを明示的に上書き**。閾値と SQL は効果検証用に維持 | 上書き済み |
| WP-T4 | オプトイン提示の文言と再提示ポリシー(拒否後に設定画面以外で再び誘うか) | 再提示しない(せがまない)。文言は UI 文言ガイド準拠で仮置き→レビュー | WP-02 完了レビュー |
| WP-T5 | 夜間帯(21:00〜7:00)の妥当性確認(ターゲット年齢帯の生活時間として) | 提案書の値のまま開始し、苦情・実態が見えたら調整 | WP-03 完了レビュー |
