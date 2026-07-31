# E13 本番運用手順

## 本番構成

- URL: `https://daifugo-together.fly.dev/`
- Fly app: `daifugo-together`
- primary region: `nrt`
- Machine: shared CPU 1 / 512MB / 1台
- Volume: `daifugo_data` / 1GB / `/data`
- Database: `/data/daifugo.sqlite`

進行中の部屋とタイマーは単一Nodeプロセス内にある。Machineを2台以上に増やさず、`fly scale count 1`を維持する。SQLiteも単一Volumeを使うため水平スケールはできない。

## 初回構築

```sh
fly apps create daifugo-together --org personal
fly volumes create daifugo_data \
  --app daifugo-together \
  --region nrt \
  --size 1 \
  --count 1 \
  --yes
fly deploy --remote-only --ha=false --wait-timeout 10m
fly scale count 1 --app daifugo-together
```

`fly.toml`の`DATABASE_PATH=/data/daifugo.sqlite`と`[[mounts]] destination="/data"`は一緒に保つ。片方だけ変えると、再デプロイ時にDBが消える構成になり得る。

## CDの有効化

`.github/workflows/deploy.yml`は、`CI`がmainへのpushで成功した`head_sha`だけをデプロイする。fork PR、PR上のCI、失敗したCIからはdeploy jobが実行されない。

GitHubで次を一度だけ設定する。

1. Environment `production`を作る。
2. Deployment branchesを`main`だけに制限する。
3. app限定・期限付きのFly deploy tokenを作る。

   ```sh
   fly tokens create deploy \
     --app daifugo-together \
     --name github-production \
     --expiry 2160h
   ```

4. 出力されたtokenをEnvironment secret `FLY_API_TOKEN`へ登録する。tokenをシェル履歴、Issue、ログ、リポジトリへ保存しない。

   ```sh
   gh secret set FLY_API_TOKEN \
     --env production \
     --repo OWNER/REPOSITORY
   ```

5. 90日ごとに新tokenへ入れ替え、旧tokenを失効させる。

このリポジトリのremoteが未設定の環境では、Environment作成とsecret登録はリポジトリ作成・接続後に行う。

## 稼働確認

```sh
curl --fail https://daifugo-together.fly.dev/health
fly status --app daifugo-together
fly checks list --app daifugo-together
fly volumes list --app daifugo-together
```

通常時は`{"status":"ok","db":"ok"}`、SIGTERM後のdrain中はHTTP 200のまま`{"status":"draining","db":"ok"}`を返す。DB疎通に失敗した場合だけHTTP 503と`{"status":"error","db":"error"}`を返す。

3戦セットを実経路で完走する確認:

```sh
node scripts/verify-production-set.mjs \
  https://daifugo-together.fly.dev
```

本番DBの件数確認は、Machine上の本番依存を使ってreadonly接続する。WALファイルを直接コピーしない。

```sh
fly ssh console --app daifugo-together
node --input-type=module -e '
import { createRequire } from "node:module";
const require = createRequire("/app/packages/server/package.json");
const Database = require("better-sqlite3");
const db = new Database("/data/daifugo.sqlite", { readonly: true });
console.log(db.prepare("select count(*) as count from set_results").get());
db.close();
'
```

## ルール提案データをローカルへ同期

ルール提案の再現調査では、次のコマンドで本番の提案、L0–L3検査記録、
AI・開発者の判定履歴、実装ジョブだけを専用のローカルDBへ同期する。

```sh
pnpm sync:production-proposals
DATABASE_PATH="$PWD/data/production-proposals.sqlite" pnpm start
```

同期処理は本番DBをreadonlyで一貫したスナップショットとして読み取る。
`users`テーブル、対局、評価、イエローカード、異議申立ては取得しない。
提案者、検査対象ユーザー、判定者の識別子はすべてローカル専用の
「本番提案データの神」ユーザーへ置き換える。

既に同期先DBがある場合は、検証済みの新しいDBへ丸ごと入れ替え、
直前のDBを`data/production-proposals.sqlite.backup`へ保存する。
別のFly appや保存先を使う場合は`--app`、`--database`で指定する。

```sh
pnpm sync:production-proposals -- --app daifugo-together \
  --database data/production-proposals.sqlite
```

## ログ

```sh
fly logs --app daifugo-together
fly logs --app daifugo-together --no-tail
```

アプリのJSONログで主に見る`event`:

- `server_listening`: 起動完了
- `server_drain_started` / `server_drain_completed`: graceful restart
- `server_drain_failed`: drain失敗
- `socket_internal_error`: Socket処理、タイマー、永続化の予期しない例外
- `ai_fallback`: AI watchdog・不正決定・worker失敗によるfallback
- `uncaught_exception`: 未捕捉例外。直後にMachineが再起動したかも確認する

外部通知は初回スコープ外なので、障害は自動通知されない。

## 手動デプロイとdrain確認

```sh
fly deploy \
  --remote-only \
  --ha=false \
  --image-label "$(git rev-parse HEAD)" \
  --wait-timeout 10m
```

対局中デプロイの確認は、別端末で`verify-production-set.mjs`を開始してから上記を実行する。デプロイ中に次を確認する。

1. `/health`がdrain中も200を返す。
2. 新規create/join/start/continueは`server is draining`で拒否される。
3. 進行中ゲームが完了し、`set_results`が1件増える。
4. ログに`server_drain_started`と`server_drain_completed`が順に出る。
5. 復帰後に新しい部屋を作れる。

## ロールバック

Flyには専用のrollbackコマンドはない。直前の正常イメージを再デプロイする。

```sh
fly releases --app daifugo-together --image
fly deploy \
  --app daifugo-together \
  --image registry.fly.io/daifugo-together:PREVIOUS_IMAGE_TAG \
  --strategy rolling \
  --wait-timeout 10m
curl --fail https://daifugo-together.fly.dev/health
fly status --app daifugo-together
fly logs --app daifugo-together --no-tail
```

ロールバックで戻るのはコンテナイメージだけで、SQLiteのデータ、DBスキーマ、secret、`fly.toml`由来の現在の設定は戻らない。破壊的マイグレーション導入後は別の復旧手順が必要になる。古いイメージはレジストリから永久には保持されない。

コマンドはFly公式の[Rollback Guide](https://fly.io/docs/blueprints/rollback-guide/)と[`fly releases`](https://fly.io/docs/flyctl/releases/)を2026-07-27に確認した。
