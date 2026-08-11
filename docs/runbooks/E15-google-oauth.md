# E15 Google OAuth 受入 runbook

E15 の実 Google OAuth を本番で有効化し、AU-01〜AU-03を受け入れるための開発者作業。対象 Fly App は `daifugo-together`、本番 origin は `https://daifugo-together.fly.dev`。

## 1. Google Auth Platform を設定する

1. 本番用 Google Cloud project を選び、Google Auth Platform の **Branding** を開く。
2. App name を「みんなでつくろう 大富豪」とし、User support email とDeveloper contact informationを設定する。ロゴは任意。
3. **Audience** を選ぶ。
   - 一般のGoogleアカウントを許可するなら `External`。
   - 組織内だけの検証なら `Internal`。組織外アカウントでは利用できない。
4. **Clients** → **Create client** → Application type **Web application** を選ぶ。
5. Authorized redirect URIsへ次を完全一致で登録する。末尾スラッシュは付けない。

   ```text
   https://daifugo-together.fly.dev/auth/google/callback
   http://localhost:3000/auth/google/callback
   ```

   `127.0.0.1`や別portで検証する場合は、その完全一致URIも追加する。Authorized JavaScript originsは不要。

6. 作成直後に表示されるClient IDとClient secretを安全な保管先へ保存する。secretはリポジトリ、Issue、Slack、シェル履歴へ貼らない。

アプリが要求するscopeは`openid`だけで、メール、氏名、アイコンは取得しない。

## 2. Fly secrets をstageする

E15コードのデプロイと同時に有効化する場合は、先にsecretをstageする。次をzshで実行し、プロンプトへ値を貼り付ける。

```sh
read "GOOGLE_CLIENT_ID?Google client ID: "
read -s "GOOGLE_CLIENT_SECRET?Google client secret: "
printf '\n'
printf 'GOOGLE_CLIENT_ID=%s\nGOOGLE_CLIENT_SECRET=%s\n' \
  "$GOOGLE_CLIENT_ID" "$GOOGLE_CLIENT_SECRET" \
  | fly secrets import --app daifugo-together --stage
unset GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET
fly secrets list --app daifugo-together
```

一覧に`GOOGLE_CLIENT_ID`と`GOOGLE_CLIENT_SECRET`が表示されることを確認する。値そのものは表示されない。

`PUBLIC_ORIGIN=https://daifugo-together.fly.dev`は`fly.toml`の通常環境変数に設定済みであり、secretにはしない。

## 3. E15をデプロイする

1. `codex/e15-auth-account`のコミットをmainへ取り込む。
2. mainのCIと本番デプロイが成功するまで待つ。stageしたsecretはこのデプロイからMachineへ注入される。
3. 次を確認する。

   ```sh
   curl -fsS https://daifugo-together.fly.dev/health
   fly status --app daifugo-together
   fly logs --app daifugo-together
   ```

起動ログに`google_auth_provider_unavailable`が出る場合は、Client ID・secret・外向き通信を確認する。

> **2026-08-02 改訂** — 認証・アカウントUI(work order 2026-08-02 auth-account-ui 1〜4)の実装に合わせ、§4〜§6の画面名・文言を現行UIへ更新した。旧文言(「引き継ぎ・ログイン」「きろくをのこす」等)は廃止済み。

## 4. AU-01 / AU-02を受け入れる

ブラウザDevToolsのNetworkで **Preserve log** を有効にしてから実施する。

1. 未登録状態でメニュー上部のアカウント行(ゲスト名+「ゲスト」タグ)を押して記録画面を開き、「Googleでつなぐ」→ 確認ダイアログ「Googleでつなぎますか?」の「Googleへ進む」からログインを完了する。
2. `/auth/google/callback`が **POST** で、Request URLに`code`や`user_token`が含まれないことを確認する。
3. 完了後の表示を確認する。初回紐付けはトースト「Googleでつなぎました」。既存アカウントへの切替はダイアログ(匿名からは「おかえりなさい、○○さん」/登録済みからは「別のアカウントに切り替わりました」)。記録画面のタグが「Googleでつないである」になり、「別のアカウントにする」「サインアウト」が現れ、メニューのアカウント行から「ゲスト」タグが消える。
4. Application → Cookiesで`__Host-daifugo-auth-flow`がcallback後に残っていないことを確認する。
5. 登録後は提案フォームが表示され、提案を送信できることを確認する。
6. 記録画面の「サインアウト」→確認ダイアログ「サインアウトしますか?」で実行すると、トースト「サインアウトしました」とともに新しい匿名ゲストへ切り替わり、提案画面が匿名の枠ゲートへ戻ることを確認する。
7. 別ブラウザまたはシークレットウィンドウで同じGoogleアカウントへログインし、元の表示名・アカウントへ戻ることを確認する。
8. Google側で拒否した場合は匿名のまま戻り、再試行できることを確認する。

## 5. AU-03を375×812で受け入れる

リザルト内の登録導線(旧「きろくをのこす」)は廃止され、**退室直後のメニューで誘う**(F-2、Q-1=B)。

1. DevToolsのviewportを375×812にする。
2. 未登録状態でbasicの3戦セットを完走する。
3. セットリザルトに登録導線が無いことを確認し、「ホームへ」で退室する。直後のメニューにCallout「今日の記録は、この端末だけに残っています。Googleでつなぐと、ほかの端末でも続きをあそべます。」+「Googleでつなぐ」が表示され、メニュー操作を圧迫せず、横スクロールがないことを確認する。
4. 同じブラウザで次のセットを完走し、誘いが再表示されないことを確認する(初回+以降3セットごと)。
5. 対局中(部屋の画面)にはアカウント行・認証導線が表示されないことを確認する。

## 6. AU-T3の文言を確定する

実画面で次の文言を確認し、変更する場合はUI文言ガイドに従って別コミットにする。

- メニュー未登録: アカウント行にゲスト名+タグ「ゲスト」
- メニュー登録済み: アカウント行は名前のみ(バッジなし)
- 記録画面 未登録: タグ「記録はこの端末だけ」/ボタン「Googleでつなぐ」
- 記録画面 登録済み: タグ「Googleでつないである」/「別のアカウントにする」「サインアウト」
- 実行確認ダイアログ: 「Googleでつなぎますか?」/「Googleへ進む」/「もどる」
- 提案画面(匿名・枠うまり): 「提案は1つずつです。結果が出たら次の提案ができ、Googleでつなぐといくつでも提案できます。」
- 退室後の誘い: 「今日の記録は、この端末だけに残っています。Googleでつなぐと、ほかの端末でも続きをあそべます。」
- 初回紐付け成功: トースト「Googleでつなぎました」
- 既存アカウントへの切替: 「おかえりなさい、○○さん」(匿名から)/「別のアカウントに切り替わりました」(登録済みから)
- 紐付け済みで再実行: トースト「すでにつないであります」
- 失敗系: 「途中で時間がすぎました」(もう一度ためす)/「今はつなげません」
- サインアウト: 「サインアウトしますか?」→ トースト「サインアウトしました」

## 7. 完了記録

実施記録は本 runbook 末尾の「実施記録」節へ追記し(節がなければ作る)、`docs/status.md` の該当行(E15 の実 Google 通し受入)を更新する(完了なら行を削除する)。追記する内容は、実施日、Google Cloud project、OAuth client名、本番確認結果。Client ID全文・Client secret・認可コード・`user_token`は記録しない。
