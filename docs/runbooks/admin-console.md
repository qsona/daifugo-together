# 本番管理画面 runbook

本番管理画面は、利用者向けWebと同じFly Appで `https://daifugo-together.fly.dev/admin` に公開する。運用概要、提案一覧、ユーザー一覧、ルール公開、お知らせ配信を提供する。

## 画面構成

- **概要**: 直近30分、直近3時間、本日（JST）の接続、新規ユーザー、完走卓、プレイ数。提案、稼働ルール、評価、提案ステータスも表示する。
- **提案**: 提案番号、内容、ステータス、提案者、却下・失敗理由、実装フェーズを表示する。ステータス絞り込みと全文検索に対応する。
- **ユーザー**: 表示名、Google登録状態、作成・登録・最終プレイ日時、参加卓、完走卓、提案、評価の件数を表示する。登録状態絞り込みと検索に対応する。
- **ルール**: 実装済みルールの状態と公開準備状態を表示する。`公開待ち` かつ公開準備が整ったルールは、確認後に公開できる。公開するとルールが次のセットから利用可能になり、対応する提案も `公開済み` へ遷移する。

ユーザートークンとGoogle subjectは管理APIへ返さない。ルール公開以外の更新・削除などの管理操作は提供しない。

## 認証

`/admin` と `/admin/api/*` は次の二段階で保護する。

1. HTTP Basic認証
2. Google OAuth。確認済みメールが `ADMIN_ALLOWED_EMAIL` と完全一致した場合だけ、8時間有効の署名済み管理セッションを発行する。

Google OAuthは既存の `https://daifugo-together.fly.dev/auth/google/callback` を共有するため、Google Auth PlatformのリダイレクトURI追加は不要。管理フローは専用state、PKCE、HttpOnly Cookieで利用者向け認証と分離する。

通常環境変数は `fly.toml` に置く。

```text
ADMIN_ALLOWED_EMAIL=mori.jmk@gmail.com
ADMIN_BASIC_USERNAME=mori
FLY_ORG_SLUG=personal
```

次の値はFly secretsに置く。

- `ADMIN_BASIC_PASSWORD`: 20文字以上のランダム値
- `ADMIN_SESSION_SECRET`: 32文字以上のランダム値
- `FLY_METRICS_TOKEN`: Fly organizationのread-only token。HTTP/WebSocket指標の読み取りだけに使う

`GOOGLE_CLIENT_ID` と `GOOGLE_CLIENT_SECRET` は利用者向けGoogle連携と同じ既存secretを使う。

## secretの設定

Basic認証のパスワードはパスワードマネージャーに保存する。管理セッションsecretはログイン用パスワードとして使わず、表示・共有しない。

この本番環境ではBasic認証パスワードをmacOSキーチェーンのservice `daifugo-together-admin-basic`、account `mori` に保存する。必要なときだけ次で表示する。

```sh
security find-generic-password \
  -a mori \
  -s daifugo-together-admin-basic \
  -w
```

Flyメトリクスには、個人tokenやdeploy tokenではなくread-only organization tokenを使う。期限は必要な範囲に絞り、期限前にローテーションする。

```sh
fly tokens create readonly \
  --org personal \
  --name daifugo-admin-metrics \
  --expiry 8760h
```

3つの値をsecretとして設定した後、次でsecret名だけを確認する。

```sh
fly secrets list --app daifugo-together
```

一覧に `ADMIN_BASIC_PASSWORD`、`ADMIN_SESSION_SECRET`、`FLY_METRICS_TOKEN` があり、状態が `Deployed` ならよい。値はコマンド履歴、Issue、ログ、リポジトリへ残さない。

## 稼働確認

1. `https://daifugo-together.fly.dev/admin` がBasic認証を要求する。
2. Basic認証後、Googleログイン画面を表示する。
3. `mori.jmk@gmail.com` でログインすると管理画面を表示する。
4. 別のGoogleアカウントは拒否する。
5. 概要の更新、提案の検索・絞り込み、ユーザーの検索・絞り込みが動作する。
6. ルール画面で公開待ちルールの公開準備が整うと「公開」ボタンが有効になる。公開後に状態が「公開中」へ変わり、提案一覧でも対応する提案が「公開済み」になる。
7. DevToolsのNetworkで `/admin/api/*` の応答に `userToken`、`googleSub`、`google_sub` が含まれない。
8. ログアウト後、管理APIがHTTP 401を返す。

メトリクスtokenの期限切れやFly API障害時も、DB由来の概要・提案・ユーザーは表示する。接続とHTTP件数だけを取得不可として扱う。
