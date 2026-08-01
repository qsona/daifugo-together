# 発注書 2/5: 認証・アカウント UI — 認証の実行経路と結果(廃止D-6・RES-1〜RES-3)

> 全体像・裁定待ちの前提表・共通ルールは [0/5 概要](2026-08-02-auth-account-ui-0-overview.md) を先に読むこと。
> **前提: 発注書 1/5 が完了・コミット済みであること**(RES-3 の「もう一度ためす」が DLG-1 を開き直すため)。

## 1. 目的

認証が**アプリの外へ落ちる構造**をなくし、結果を**どの画面にいても見える場所**で伝える。

- **廃止D-6**: 隠しフォーム POST をやめ、`POST /api/auth/begin` → `{ authUrl }` → `location.href` に差し替える(J4-1)。**これをやらないと RES-3 のダイアログはそもそも表示されない**
- **N-4**: 結果の受け皿をアプリのルート直下に置く(J3-2・J4-2・J4-3)
- **RES-1 / RES-2 / RES-3**: outcome と失敗原因を区別して伝える(J4-4・J5-1・J5-2)

## 2. 着手前の裁定依存

| 事項 | 扱い |
|---|---|
| **Q-5**(失敗系の部品) | **モーダル(`Dialog`)で進めてよい**。確定時に E15 §2.8 の 3 行(503・ott 失効・denied)へ読み替えノートを入れる(本フェーズの作業に含む)。覆った場合は §7 参照 |
| **Q-8**(`switched` の通知部品) | **ダイアログで進めてよい**(コントローラー承認済み)。確定時に E15 §2.7「outcome に応じたトースト」へ読み替えノート |
| Q-1・Q-2・Q-6・Q-7 | 本フェーズは非依存(Q-9 は `817409b` が決着させたので裁定そのものが無い) |

## 3. やること

### 3.1 認証開始・完了の経路を差し替える(廃止D-6)

`packages/web/src/auth/client.ts` を書き換える。

- `begin(userToken)`: `fetch('POST /api/auth/begin')` に `Authorization: Bearer <userToken>` を付けて呼び、`{ authUrl }` を受けてから `location.href = authUrl` に入れる。**戻り値は Promise にし、失敗はステータスを保った例外として投げる**(呼び出し側が 401 / 503 / その他を区別できるようにする)
- **`credentials: 'include'` を必ず付ける**(同一オリジンでも明示する。将来オリジンが分かれたときに黙って壊れないため)。理由: begin の成功応答は `__Host-daifugo-auth-flow` Cookie(`app-server.ts:41`。`HttpOnly; Secure; SameSite=None`)を `Set-Cookie` で返し、**callback がこの nonce Cookie と `state` を照合する**(E15 §2.3)。**この Cookie が保存されないと認証は必ず失敗する。**隠しフォーム POST ではブラウザが自動で扱っていた部分なので、fetch 化で最も壊れやすいのがここ
- 同じ理由で `complete` にも `credentials: 'include'` を付ける
- `complete(ott)`: `fetch('POST /api/auth/complete', { ott })` で `{ outcome, userToken, displayName }` を受け取る。**JSON を返す形にする**
- **`#submit`(隠しフォーム POST)と `takeResult()`(結果 Cookie の読み出し)は削除する。**あわせて `#/auth/result` 経路を使わなくなるので、`App.tsx` のハッシュ分岐も `#/auth/complete` の 1 本にまとめる
- **注意(見落としやすい)**: `#/auth/result` の分岐には Push の「ログイン後に通知の提示を続ける」仕組み(`pushApi.consumeOfferAfterLogin()` → `pushApi.offer()`)がぶら下がっている。分岐を統合するときに**この処理を `#/auth/complete` の成功パスへ移す**こと。落とすと「通知を受け取る → Googleでつなぐ → 戻ってきたら通知の提示が出る」という既存の流れが黙って壊れる
- サーバー変更は不要。`/api/auth/begin`(Bearer 必須)と `/api/auth/complete`(body の `ott`)は `packages/server/src/app-server.ts` に実装済みで、`/auth/google/begin` などのブラウザ POST 経路は**サーバー側には残したまま**にする(削除はサーバー変更にあたるので本発注の対象外)

エラーの分類(E15 §2.8 と `app-server.ts` の実装に対応):

| 経路 | 起きること | UI |
|---|---|---|
| begin 503 `auth_unavailable` | OAuth 未設定 | RES-3 の「今はつなげません」 |
| begin 401 | トークン無効 | **画面を出さない。**既存のセッション再取得フローに任せ、自動で 1 回だけ再試行する。それでも失敗したら RES-3 の「途中で時間がすぎました」に合流 |
| callback → `#/auth/complete?error=expired` | state 不一致・期限切れ | RES-3 の「途中で時間がすぎました」 |
| complete 410 / ott 欠落 | ott 二重使用・期限切れ | 同上 |
| callback の `error=denied` 相当 | ユーザーが Google 側でやめた | **何も出さない**(RES-3 の注記 4) |

**`denied` を判別できるかを実装前に確かめること。**サーバーの callback がリダイレクト先フラグメントに載せる `error` の値を読み、`denied` が来ない実装であれば「denied を判別できない」旨を報告し、暫定として**「途中で時間がすぎました」に合流させない**(何も出さない側に倒す)か、開発者に確認する。**サーバーを変更して `denied` を足すことはしない。**

### 3.2 ルート直下の通知口(N-4)

- **設置場所はアプリのルート。**`MenuScreen` の中に置くと、部屋が生きている経路で一度も描画されない(J3-2 の直接の原因。部屋の画面はメニューより先に return される)
- `MenuScreen` の `authMessage` と裸の `<p role="status">`(`MenuScreen.tsx:79`)を**廃止**(廃止D-2)。`MenuScreen` から `authMessage` prop を外す

### 3.3 `Toast` の自動退場(新規実装)

`packages/web/src/components/Toast.tsx` は現在タイマーを持たない純粋な表示部品。**3 秒で退場**(design-system.html §5-13)を満たすため、退場タイマーと退場アニメーションを足す。

- 既存の呼び出し側(`GameScreen.tsx` のあがり演出など)の挙動を壊さないこと。**タイマーは opt-in にする**(例: `duration` を渡したときだけ自動で消える)のが安全
- `prefers-reduced-motion` を尊重する(design-tokens の既存の扱いに合わせる)

### 3.4 RES-1: `linked` / `already` = トースト

```
linked : Googleでつなぎました
already: すでにつないであります
```

- 1 文なので**句点なし**(ガイド §3)
- 確認の本体はアカウント行のバッジが「どの端末でも」に変わること。**トーストは状態表示の代わりではない**(N-4 補足 1)
- 現行の `App.tsx:1084-1086`(`linked` かどうかだけで分岐し `switched` と `already` を「おかえり!」にまとめる)を、**3 outcome の区別**に直す(J5-1)

### 3.5 A-6: サインアウト完了のトースト(**廃止D-2 と同時に移す**)

1/5 では「サインアウトしました」を現行の `authMessage`(メニューの裸の `<p>`)に入れている。§3.2 で `authMessage` を廃止するので、**同じ変更でこの通知をルート直下の `Toast` に移す**。移し忘れると、**2/5 を取り込んだ瞬間にサインアウトの通知が消える**(A-6 の回帰)。

```
サインアウトしました        ← 1 文なので句点なし。3 秒で退場
```

- サインアウト直後はメニューに留まり、再接続が済むまでアカウント行は「接続中」+ なまえ `—`(A-6・A-5 と同じ)。新しいゲスト名は接続完了後に入る
- トーストを許す 3 条件(N-4 補足 1)を満たす: 一度きり / 取り消しに別操作(再ログイン)が要る / 押したボタンごと画面が作り直される

### 3.6 RES-2: `switched` = ダイアログ 2 種(Q-8)

**出し分けの軸は E15 のケース番号ではなく「begin を押した直前に自分が登録済みだったか」。**クライアントはケース番号を判定できない(ワイヤー §7)。begin の直前の `state.registered` を保持しておき、完了時に読む。**サーバー変更は不要。**

```
S-a(直前が匿名)
  見出し: おかえりなさい、{displayName}さん
  本文  : この端末で前にあそんでいた記録は、もう見られません。
  ボタン: 閉じる

S-b(直前が登録済み)
  見出し: 別のアカウントに切り替わりました
  本文  : 今は「{displayName}」の記録であそんでいます。
  ボタン: 閉じる
```

- **表示する名前は `complete` が返す `displayName` をそのまま使う**(クライアントで組み立てない)。ケース 4 では発番されたばかりの既定名になりうる
- S-a が J5-2(匿名の記録の放棄が示されない)の解消そのもの。**事前予告はしない**(原則 4)
- 閉じるとメニューへ。状態(アカウント行・マイ提案)は既に新しいアカウントのものに入れ替わっている

### 3.7 RES-3: 失敗 = ダイアログ(Q-5)

```
expired / state 不一致 / ott 二重使用・期限切れ(410)
  見出し: 途中で時間がすぎました
  本文  : もう一度ためせば大丈夫です。
  primary: もう一度ためす   → DLG-1 を開き直す(いきなり Google へ飛ばさない)
  副    : 閉じる

503 auth_unavailable
  見出し: 今はつなげません
  本文  : 時間をおいてから、もう一度ためしてください。
  primary: 閉じる            ← 「もう一度ためす」は出さない(ユーザーの操作では直らない)

denied
  何も出さない。匿名のまま続行する
```

- 「もう一度ためす」は既存表記に揃えた語(`RuleDexScreen.tsx:154`・`RuleDetailModal.tsx:64`)
- 2 文目の「もう一度ためしてください。」は `messages.ts` の `RETRY_GENERIC_ERROR` と共通するので、**共通部分を定数として切り出して共有する**(ガイド §11.3)。`RETRY_GENERIC_ERROR` 自体は他画面が使っているのでそのまま残す
- 失敗時に `authPending` を必ず落とす

### 3.8 ドキュメントの読み替えノート

- `docs/epics/E15-auth-account.md` 冒頭の改訂ノートに 2 行足す。**本文は書き換えない**
  - §2.8 の「トースト」は**失敗系については `Dialog`** に読み替える(Q-5)。対象は 503・ott 失効・denied の 3 行
  - §2.7 の「outcome に応じたトースト」は、**`switched` だけ `Dialog`** に読み替える(Q-8)

## 4. やらないこと

- サーバー変更(`/auth/google/*` のブラウザ POST 経路の削除を含む)
- 認証の入口の追加(A2HS・提案画面・退室後の誘い)→ **3/5**
- なまえ関連 → **4/5**
- 通知設定画面のエラー分類(J9-3)→ **5/5**。**同じ形の欠落だが対象コードが別**(`push/client.ts`)なので混ぜない

## 5. このフェーズだけを入れた状態

認証の往復が完結し、失敗もアプリ内に留まる。入口はまだアカウント画面 1 か所(+ リザルトの旧「記録を残す」)なので、Critical (3) は 3/5 まで残る。

## 6. 受け入れ条件

- [ ] `grep -rn "createElement('form')\|form.submit()" packages/web/src/auth` が 0 件(隠しフォーム POST の廃止)
- [ ] `auth/client.ts` に `takeResult` と結果 Cookie の読み出しが残っていない
- [ ] `begin` が `POST /api/auth/begin` を Bearer 付きで呼び、`{ authUrl }` を受けてから `location.href` に入れる(テストで検証)
- [ ] begin が 503 を返したとき、**ブラウザに JSON が出ずに** RES-3「今はつなげません」が出る(「もう一度ためす」は出ない)
- [ ] `#/auth/complete?error=expired` で RES-3「途中で時間がすぎました」が出て、「もう一度ためす」で **DLG-1 が開く**(Google へ直行しない)
- [ ] complete が 410 のときも同じダイアログに合流する
- [ ] begin 401 では画面を出さず、セッション再取得後に 1 回だけ自動再試行する。再試行も失敗したら「途中で時間がすぎました」
- [ ] `denied` では何も表示されない(判別できない場合はその旨を報告している)
- [ ] `linked` で「Googleでつなぎました」、`already` で「すでにつないであります」のトーストが出て、**3 秒で消える**
- [ ] `switched` で RES-2 のダイアログが出る。**begin 直前が匿名なら S-a、登録済みなら S-b**
- [ ] S-a に「この端末で前にあそんでいた記録は、もう見られません。」が出る
- [ ] 通知がルート直下に置かれ、**部屋にいる状態で完了しても表示される**(`MenuScreen` に依存しない)
- [ ] `MenuScreen` から `authMessage` と裸の `<p role="status">` が消えている
- [ ] **サインアウトの通知が消えていない** — DLG-3 で確定すると「サインアウトしました」がルート直下の `Toast` で出て 3 秒で消える(A-6。`authMessage` 廃止と同時に移す)
- [ ] `Toast` の自動退場が既存の呼び出し側(`GameScreen` のあがり演出)の挙動を変えていない
- [ ] **ログイン後の通知提示が従来どおり動く**(`markOfferAfterLogin` → 認証往復 → `consumeOfferAfterLogin` → `offer()` → `PushOfferDialog`)
- [ ] 既存の回帰なし: 通知ベル / `PlaySheet` のなまえ入力 / A2HS 案内(`InstallGuide`)/ サインアウトの流れ(1/5 で作った DLG-3)
- [ ] E15 冒頭に Q-5・Q-8 の読み替えノートが 2 行入っている
- [ ] `pnpm exec vitest run packages/web/src` 緑、typecheck が通る
- [ ] 375×812 相当で RES-1(2 種)・RES-2(2 種)・RES-3(2 種)を目視確認し、記録する

## 7. Q-5 が覆った場合(失敗系 = トースト)

RES-3 をトースト化し、「もう一度ためす」はアカウント画面からの再操作に委ねる。**その場合でも廃止D-6 は必要**(生 JSON がブラウザに出る問題は部品の選択と無関係)。覆ったら本発注書ではなくワイヤー RES-3 を直す。

## 8. テスト方針

- `auth/client.test.ts`(新規): `fetch` をモックし、begin の Bearer・`authUrl` への遷移・ステータス別の例外を検証する
- `App.test.tsx`: ハッシュ経路(`#/auth/complete?ott=…` / `?error=expired`)ごとに何が描画されるかを検証。outcome 3 種 × 直前の `registered` 2 通りで RES-1 / RES-2 の出し分けを確認
- `components/Toast.test.tsx`(新規): タイマーで消えること、`duration` を渡さない既存呼び出しでは消えないこと(fake timers)
- 部屋にいる状態で完了しても通知が描画されることを 1 ケース入れる(J3-2 の回帰防止)
