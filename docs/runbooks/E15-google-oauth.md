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

## 4. AU-01 / AU-02を受け入れる

ブラウザDevToolsのNetworkで **Preserve log** を有効にしてから実施する。

1. 未登録状態でメニューの「引き継ぎ・ログイン」を押し、Googleログインを完了する。
2. `/auth/google/callback`が **POST** で、Request URLに`code`や`user_token`が含まれないことを確認する。
3. メニューへ戻り「引き継ぎ登録したよ」または「おかえり!」が表示され、ボタンが「登録済み・ログアウト」になることを確認する。
4. Application → Cookiesで`__Host-daifugo-auth-flow`がcallback後に残っていないことを確認する。
5. 登録後は提案フォームが表示され、提案を送信できることを確認する。
6. ログアウトすると新しい匿名sessionへ切り替わり、提案画面がログイン案内へ戻ることを確認する。
7. 別ブラウザまたはシークレットウィンドウで同じGoogleアカウントへログインし、元の表示名・アカウントへ戻ることを確認する。
8. Google側で拒否した場合は匿名のまま戻り、再試行できることを確認する。

## 5. AU-03を375×812で受け入れる

1. DevToolsのviewportを375×812にする。
2. 未登録状態でbasicの3戦セットを完走する。
3. 初回セットリザルトに小さい「きろくをのこす」導線が表示され、順位・次セット導線を圧迫せず、横スクロールがないことを確認する。
4. 同じブラウザで次セットを完走し、登録導線が再表示されないことを確認する。
5. 対局中には「引き継ぎ・ログイン」が表示されないことを確認する。

## 6. AU-T3の文言を確定する

実画面で次の文言を確認し、変更する場合はUI文言ガイドに従って別コミットにする。

- メニュー未登録: 「引き継ぎ・ログイン」
- メニュー登録済み: 「登録済み・ログアウト」
- 提案画面: 「提案するには引き継ぎ登録が必要です」/「Googleでログイン」
- セットリザルト: 「きろくをのこす」
- 初回紐付け成功: 「引き継ぎ登録したよ」
- 既存アカウント復帰: 「おかえり!」
- OAuth利用不可: 「いまは使えないみたい」

## 7. 完了記録

`docs/impl-progress.md`のE15「残る開発者確認」へ、実施日、Google Cloud project、OAuth client名、本番確認結果を追記する。Client ID全文・Client secret・認可コード・`user_token`は記録しない。
