# 設計: Push オプトイン簡素化(E17 改訂の差分実装)

- 作成日: 2026-08-02
- 状態: 実装済み(2026-08-02)
- 一次情報源: `docs/epics/E17-web-push.md`(2026-08-02 改訂ノート・WP-D3/WP-D4・§2.3〜2.5)/ `docs/epics/E16-notification-center.md`(§2.2 種別レジストリ = チャネル属性の正)/ `docs/epics/E15-auth-account.md`(§2.7 ログイン完了フロー)/ `docs/specs/2026-07-30-anonymous-trial-proposal-design.md`(匿名おためし提案枠)
- 関連決定: decision-log G-24(Push オプトイン簡素化)。G-23(A2HS の「提示は 1 回のみ」)を再提示ポリシーの点のみ改める
- 前提: E16・E17 は 2026-08-01 に実装済み(本番リリース直前、**購読者ゼロ**)。本書はその実装済みコードからの**差分**を作業リストとして書く

---

## 1. 背景と目的

E17 実装直後の 2026-08-02 に開発者が以下を裁定した(番号は本書全体で「裁定 1〜5」として参照する)。

1. **Push 種別の選択 UI を廃止し、Push 対象を終端結果 3 種(`proposal_released` / `proposal_rejected` / `proposal_failed`)に固定する**。設定画面のトグル(「提案の確認結果が出た」「ルールの実装結果が出た」)はユーザーに区別不能だった。オプトインの約束は「結果が出たら通知」であり、実装失敗も結果なので 3 種すべて含める。`proposal_implementing`・`rule_debut` はセンターのみ(現状どおり変更なし)。
2. **`push_preferences`(テーブル・API・設定画面のトグル)を撤去**し、E16 種別レジストリのチャネル属性を唯一の真実とする。設定画面は「この端末への通知を止める」(購読解除)のみ残す。購読者ゼロの今なら移行問題はない。
3. **オプトイン動線の強化**: 提案送信直後のオファー(実装済み)は維持しつつ、**匿名おためし提案の送信直後にアカウント登録を強めに促す導線**を追加し、E15 ログイン完了の戻りで Push オファーへ継続する。提案直後の熱量を登録インセンティブに接続する。
4. **再提示ポリシーの緩和**: 「提示は 1 回のみ」を改め、明示的に「受け取らない」を選んだ端末を除き、次回以降の提案送信時にも再オファーしてよい。
5. マイ提案画面への未購読者向けインラインバナーは**スコープ外**(§7)。

**不変の原則**(本改訂で一切変えない):

- 初回訪問時に許諾 UI を出さない(文脈付きオプトイン。WP-D3)。
- Push は常にセンターの複製であり、Push でしか得られない情報を作らない(WP-D4。許諾しない・できない子供が不利にならない)。
- 夜間(21:00〜翌 7:00、Asia/Tokyo)は全種別の Push を抑止する(WP-D5)。
- **匿名ユーザーへの Push 購読は提供しない**(WP-D2)。裁定 3 は「匿名には登録を促す」のであって匿名購読ではない。購読 API の 403 `registration_required` ゲートは維持する。

## 2. 変更仕様

### 2.1 送信条件(裁定 1・2)

`PushSender.send()` の送信条件を次に変える:

> 種別チャネルが `center_push` ∧ 夜間でない ∧ 対象ユーザーに有効な購読が 1 件以上

現行実装との差は「ユーザーの `push_preferences` で当該種別 ON」の条件を**外す**ことだけ。チャネル判定は実装済みの `NOTIFICATION_TYPE_REGISTRY`(`packages/server/src/notification/registry.ts`)の `channel` 属性をそのまま使う。現時点で `center_push` は終端結果 3 種のみであり、レジストリ側の変更は**不要**(E16 §2.2 が正、という構造も不変)。将来 `friend_invite`・`stats_milestone` が実装されれば自動で送信対象に乗る。

### 2.2 購読 = オプトインの全体(裁定 2)

- ユーザーが選べるのは「この端末で受け取るか」(購読の有無)だけ。購読解除は既存の `DELETE /api/push/subscriptions` + ブラウザ側 `unsubscribe()`(`PushClient.disableThisDevice()`)をそのまま使う。
- `GET`/`PUT /api/push/preferences` は**廃止**(後方互換は不要 — クライアントとサーバーは同時デプロイで、外部利用者はいない)。
- `push_preferences` テーブルは起動時マイグレーションに `DROP TABLE IF EXISTS push_preferences;` を足して**落とす**。実コードのマイグレーション方式(`persistence.ts` の起動時 `exec`、冪等 DDL)に合う形で、購読者ゼロ・本番未リリースのため安全。放置ではなく DROP を選ぶのは、参照コードを全撤去した後にスキーマだけ残すと将来の読み手を迷わせるため。

### 2.3 オファーの再提示(裁定 4)

方針: 「受け取らない」(および A2HS 案内の「今後は出さない」)を明示した端末には出さない。それ以外の未購読端末には、**提案送信のたびに**再オファーしてよい。

実装済みコードの確認結果(2026-08-02): `PushClient.offer()` は `localStorage` の `daifugo.pushOfferDeclined`(`declineOffer()` で設定)と購読済み判定だけで抑制しており、**「1 回のみ」を強制する仕組みは元々ない** — つまりクライアントの挙動はすでに裁定 4 と一致している。本項の作業は挙動変更ではなく、この挙動を仕様として確定させること(+テストで固定すること)である。

### 2.4 匿名おためし提案 → 登録 → Push オファー継続(裁定 3)

匿名ユーザーがおためし提案(2026-07-30 導入)を送信成功したとき、受理表示に続けて**登録を強めに促す**。文言(仮。実装時に `docs/design/UI文言・情報量ガイド.md` で最終化):

> けっかが出たらお知らせできるよ。Google で引き継ぎ登録すると通知が受け取れる

E15 のログインはフルページ遷移(form POST → Google → callback → `/#/auth/complete?ott=` → form POST → `/menu#/auth/result` + 結果 Cookie)であり、React の状態は生き残らない。継続は **localStorage のフラグ**で運ぶ:

1. 匿名の提案送信成功 → 登録促し UI を表示。「Google でログイン」を押したら、`localStorage` に `daifugo.pushOfferAfterLogin = '1'` を書いてから既存の `beginLogin`(`AuthClient.begin`)を呼ぶ。
2. 戻り: `App.tsx` の `#/auth/result` ハンドラ(実装済み: `auth.takeResult()` → `client.switchSession(result.userToken)` → トースト)。この成功パスの末尾でフラグを消費し、`pushApi.offer()` を照会して非 null なら **`PushOfferDialog` をメニュー画面上に表示**する。`takeResult()` が null(失敗)の場合もフラグは**消す**(次回ログインで文脈なく出さない)。
3. 表示された `PushOfferDialog` の中身・分岐(iOS 未追加なら `install` 種別 = ホーム画面追加案内、`decline` = `daifugo.pushOfferDeclined`)は実装済みのものをそのまま使う。**`Notification.requestPermission()` はダイアログ内ボタンのクリックから呼ばれる**ため、user activation 要件(E17 §2.2 の WebKit 制約)はこの動線でも満たされる。

補足:

- `offer()` は「辞退済み・購読済み・Push 不可(config unavailable)」で null を返すので、継続時の抑制条件は追加実装不要。
- 登録済みユーザーの提案送信直後のオファー(`ProposalFormScreen` の `registered && pushOffer` 分岐)は現状のまま。
- 匿名への促しにも `daifugo.pushOfferDeclined` を尊重する: 「受け取らない」を選んだ端末には登録促しの**通知文言**を出さない(登録導線そのもの = 既存の `ANONYMOUS_SLOT_HINT` 系は従来どおり)。

## 3. パッケージ別の差分作業リスト

### 3.1 packages/server

| # | ファイル | 作業 |
|---|---|---|
| S-1 | `src/persistence.ts` | `CREATE TABLE IF NOT EXISTS push_preferences (...)` を削除し、同じ起動時マイグレーション内に `DROP TABLE IF EXISTS push_preferences;` を追加(冪等。§2.2) |
| S-2 | `src/push/repository.ts` | `preference()` / `preferences()` / `setPreferences()` を削除 |
| S-3 | `src/push/sender.ts` | `send()` から `if (!this.#repository.preference(userId, item.type)) return;` の 1 行を削除。チャネル判定・夜間判定・失効処理は不変 |
| S-4 | `src/push/service.ts` | `getPreferences()` / `setPreferences()` / `preferenceInput()` / `'invalid_preferences'` を削除。`PUSH_NOTIFICATION_TYPES` の import が不要になる(registry 側の export は E16 所有の一覧として残してよい) |
| S-5 | `src/app-server.ts` | `handlePush` から `/api/push/preferences`(`isPreferences` 分岐、GET/PUT)を削除。`AppServerOptions.push` の `Pick<PushService, ...>` から該当メソッドを外す |
| S-6 | `src/push/push.test.ts` | preferences 関連テストを削除し、置き換えを追加: 「購読があれば preferences 行なしで 3 種すべて送られる」「`proposal_implementing` / `rule_debut` は購読があっても送られない(チャネル判定)」 |
| S-7 | `src/app-server.test.ts` | `/api/push/preferences` の結合テスト(121 行付近)を削除。preferences なし購読→送信の結合が S-6 で足りるならそれでよい |

`src/notification/registry.ts` は**変更しない**(チャネル属性の正は E16。E16 設計書側も変更不要 — チャネル列は既に終端 3 種のみ `センター+Push`)。`bin.ts` は preferences を配線していないため変更不要(ビルドが通ることの確認のみ)。

### 3.2 packages/web

| # | ファイル | 作業 |
|---|---|---|
| W-1 | `src/push/client.ts` | `preferences()` / `setPreferences()` / `PushPreferences` 型 / `PROPOSAL_PUSH_TYPES` を削除。`subscribeProposalResults()` から購読後の `setPreferences(...)` 呼び出しを削除(POST subscriptions のみで完結)。`offer()` / `declineOffer()` / `disableThisDevice()` は不変 |
| W-2 | `src/screens/PushSettingsScreen.tsx` | `LABELS`・「受け取る内容」fieldset(トグル 3 つ)と preferences の取得・更新を削除。残すもの: 冒頭説明文(「アプリ内のおしらせと同じ内容だけ」+ 提案の結果 3 種が届く旨に更新)、「この端末で通知を受け取る」(購読)、A2HS 案内(`InstallGuide`)、「この端末への通知を止める」。`api` の `Pick` から `preferences`/`setPreferences` を外す |
| W-3 | `src/screens/ProposalFormScreen.tsx` | 匿名(`!registered`)の送信成功後に登録促し UI を追加(§2.4 手順 1)。`onLogin` を再利用しつつ、押下前に継続フラグを書く口が要るため、prop を拡張する(例: `pushOffer` に `markOfferAfterLogin: () => void` を足す、または `onLoginForPush?: () => void` を追加 — 実装時にテストしやすい方を選ぶ)。`daifugo.pushOfferDeclined` 済み端末では通知文言を出さない(§2.4 補足) |
| W-4 | `src/App.tsx` | `#/auth/result` ハンドラ(1056 行付近)の成功パス末尾で `daifugo.pushOfferAfterLogin` を消費 → `pushApi.offer()` → 非 null なら `PushOfferDialog` をメニュー上に表示(§2.4 手順 2)。失敗パスでもフラグは消す。ダイアログの `subscribe`/`decline` 配線は `proposal` 画面と同じ |
| W-5 | `src/push/client.test.ts` / `src/screens/PushSettingsScreen.test.tsx` ほか | W-1〜W-4 に追随。§5 のテスト観点を満たす |

`src/components/PushOfferDialog.tsx` と Service Worker は変更不要(文言は現状のまま「結果が出たら」で 3 種固定と整合)。

### 3.3 ドキュメント(本 spec と同時に反映済み)

| 対象 | 差分 |
|---|---|
| `docs/epics/E17-web-push.md` | 冒頭改訂ノート + WP-D3/D4・§2.1・§2.3〜2.6・§2.8〜2.10・§3 WP-02・§4 注記・§5・WP-T4(反映済み 2026-08-02) |
| `docs/decision-log.md` | G-24 追加(反映済み) |
| `docs/product-backlog.md` | WP-02 の「種別ごと ON/OFF」文言を更新(反映済み) |

## 4. 受け入れ条件

- [x] `push_preferences` がスキーマ(起動後の DB)・サーバーコード・クライアントコードのどこにも存在しない。既存 DB でも起動時に DROP される
- [x] 購読済みユーザーには、preferences 行なしで終端結果 3 種(`proposal_released` / `proposal_rejected` / `proposal_failed`)の Push が届き、`proposal_implementing` / `rule_debut` は届かない(センターには従来どおり全種別が積まれる)
- [x] `GET`/`PUT /api/push/preferences` が 404 相当(ルート不存在)になり、残りの push API(config / subscriptions / installed)の挙動は不変
- [x] 通知設定画面にトグルがなく、「この端末で通知を受け取る」「この端末への通知を止める」+ A2HS 案内だけがある
- [x] 登録済みユーザーが提案を送るたび、未購読かつ「受け取らない」未選択ならオファーが再提示される。「受け取らない」を選んだ端末には以後出ない
- [x] 匿名ユーザーのおためし提案送信成功直後に登録促しが出て、Google ログイン完了の戻り(メニュー)で Push オファーが継続表示される。ログイン失敗時は出ず、フラグも残らない
- [x] 匿名ユーザーに購読 UI が出ず、購読 API は 403 `registration_required` のまま(WP-D2)
- [x] 夜間抑止(21:00〜7:00 JST)・Push=センター複製・初回訪問時に許諾 UI を出さない、の各原則が変更されていない
- [x] `pnpm` の lint / typecheck / test が全パッケージで通る

## 5. テスト観点

サーバー(FakePushTransport):

- 購読あり・preferences なしで 3 種すべて送信 / チャネル外 2 種(`proposal_implementing`・`rule_debut`)は購読があっても不送信
- 夜間境界(20:59/21:00/6:59/7:00 JST)・410 失効・upsert 冪等・403 ゲート・503(VAPID 未設定)は既存テストの維持
- 既存 DB に `push_preferences` がある状態で起動 → テーブルが消え、他テーブルは無傷(マイグレーションの冪等性: 2 回起動しても壊れない)
- `/api/push/preferences` へのリクエストが 404 側の共通処理に落ちる

クライアント:

- `subscribeProposalResults()` が subscriptions POST のみを呼ぶ(preferences PUT を呼ばない)
- 設定画面: トグルが描画されない・購読/解除ボタンの動作
- オファー再提示: 送信成功 2 回目でも `offer()` が照会される/`declineOffer()` 後は `offer()` が null
- 匿名動線: 送信成功 → 登録促し表示 → ログインボタンでフラグ書き込み。`daifugo.pushOfferDeclined` 済みなら通知文言なし
- ログイン戻り: `#/auth/result` 成功 + フラグあり → `PushOfferDialog` 表示(subscribe 成功で購読 API が呼ばれる)/ フラグなし → 出ない / 失敗 → 出ない + フラグ消滅

## 6. 子供安全・プライバシー(不変の確認)

- 初回訪問時に許諾 UI を出さない(提案送信の文脈でのみ提示)。
- Push はセンターの複製のみ。許諾しない・できない端末(子供の iOS タブ等)もセンターで全情報が得られる。
- 夜間(21:00〜翌 7:00、Asia/Tokyo)は送信しない。
- Push 文面に表示名以外の個人情報を含めない(E16 のペイロード規律)。
- 本改訂はこれらに触れない。レビュー時に上記が変わっていないことを確認すること。

## 7. スコープ外

- **マイ提案画面の未購読者向けインライン購読バナー**(裁定 5): 今回はやらない。後続候補として記録のみ(E17 §5 にも登録済み)
- 匿名ユーザーへの Push 購読(WP-D2 の変更): やらない
- 夜間抑止・送信方式(fire-and-forget)・失効処理の変更: なし
- E16 種別レジストリ・チャネル属性の変更: なし(`friend_invite` 等の予約種別は各 Epic のまま)
- オファー・設定画面の文言の最終化: 実装時に UI 文言ガイドで確定(本書の文言は仮)
