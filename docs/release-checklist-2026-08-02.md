# リリース前技術・運用チェックリスト

- 対象: `daifugo-together`(https://daifugo-together.fly.dev/)
- 監査日: 2026-08-01 / リリース予定: 2026-08-02(土)昼、X で告知
- 姉妹文書: [x-launch-plan-2026-08-02.md](x-launch-plan-2026-08-02.md)(告知の投稿文・メディア・投稿後運用はそちら)

## 2文書の統合タイムライン(どちらから読むか)

1. **今夜(8/1)**: 本書「前夜」3項目(コード修正 + Google Console 確認。Console が privacy policy URL を要求する場合は推奨-2 を昇格するため、**Console 確認を最初に**やる)→ X告知プラン §0(投稿文・メディア準備)。合計 3.5〜4 時間、Console 次第で最大約 6 時間。
2. **8/2 朝**: 本書 §5 タイムライン(08:00〜)。10:35 の基準値スナップショット(`ops metrics`)が X告知プラン §0 の「`rules.active` を控える」を兼ねるので、二度実行しない。実機一周(本書 推奨-5)も朝の 1 回でよく、X告知プラン §0 側の実機プレイは軽い動作確認で足りる。
3. **12:00 以降**: X告知プラン §4(投稿と初動運用)。デプロイフリーズ(本書 必須-7)を維持する。
- 調査範囲: リポジトリのコードと docs のみ。本番環境(fly CLI / Google Cloud Console / 実 URL)へは一切アクセスしていない。本番でしか確定できないものは「本番確認手順」として手順のみ書いた。
- 根拠表記: `file:line`。探索して見つからなかったことも根拠として明示した。

想定シナリオは「X の告知から数十〜数百人が同時に URL を踏み、招待リンク/QR で友だちを呼び、一部が提案を書く」である。以下の優先度はこのシナリオを前提にしている。

---

## 0. 要約(先に読む用)

| # | 項目 | 判定 | 区分 |
|---|---|---|---|
| 1 | `.png` に `Content-Type` が付かない。OGP 画像が X カードで出ない可能性がある | 問題あり(octet-stream になることはコードで確定。カードへの影響は本番で確認) | 必須 |
| 2 | `room:join` のレート制限キーが Fly プロキシ IP になり全ユーザー共有(10回/分)の疑い | 問題あり(強い状態証拠。本番で最終確認) | 必須 |
| 3 | SQLite のバックアップ経路が存在しない(自プロジェクトの決定では「E7 着手前は必須」) | 問題あり | 必須 |
| 4 | E15 Google OAuth の本番受け入れ未完了 + 公開ステータス(Testing/In production)が runbook に未記載 | 未完了 | 必須 |
| 5 | 障害の外部通知が存在しない(設計上の意図的スコープ外) | 問題あり(既知) | 必須(軽量版) |
| 6 | 提案 API にレート制限がない(IP は渡っているが未使用) | 問題あり | 必須(最小版) |
| 7 | 告知前後のデプロイフリーズ運用が未確立(main への push が即本番) | 問題あり | 必須(運用) |
| 8 | 静的配信に圧縮も長期キャッシュも ETag もない | 問題あり | 推奨 |
| 9 | プライバシーポリシー/利用規約/問い合わせ窓口が存在しない | 問題あり | 推奨 |
| 10 | リリース日の来訪者数・遊んだ人数の基準値スナップショット未取得 | 未実施 | 推奨 |
| 11 | 375×812 実画面 / 実機セーフエリアの確認が開発環境の制約で未実施のまま | 未確認(本番 URL なら実施可) | 推奨 |
| 12 | AI worker が1本固定(仮値)、過負荷時は 1 秒 watchdog で弱手にフォールバック | 問題なし(degrade 設計)/要観測 | 初週 |
| 13 | Volume 1GB と `replay_records` の無制限増加 | 要観測 | 初週 |
| 14 | ロールバック手順、drain、E7 暴走リスク、管理 API 認証、招待導線 | 問題なし | §4 |
| 15 | ルーム・セッションのメモリ特性(`room:create` は無制限だが部屋は 30 分で自動回収) | 通常シナリオでは問題なし / 攻撃者には増やされうる | §4-3, 初週 |

---

## 1. リリース前必須(明日昼までにやらないと危険)

### 必須-1. 静的ファイルの PNG に `Content-Type` が付かない(X カードに OGP 画像が出ない可能性がある)

**何を**: サーバーの静的配信 MIME テーブルに `.png` が無く、`/ogp.png` が `application/octet-stream` で返る。

**なぜ**: 今回のリリースは「X で告知」が主目的で、`twitter:card=summary_large_image` を効かせることが告知の中心。画像が出ないと告知の効果が大きく落ちる。X/Twitter のクローラは og:image に画像 MIME を期待するため、`application/octet-stream` はカード生成に失敗しうる。

**根拠**:
- `packages/server/src/app-server.ts:43-51` — `CONTENT_TYPES` は `.css / .html / .js / .json / .svg / .woff / .woff2` の 7 種のみ。`.png` が無い。
- `packages/server/src/app-server.ts:148-151` — `CONTENT_TYPES[extname(path)] ?? 'application/octet-stream'`。未登録拡張子は無条件で octet-stream。
- `packages/web/index.html:29-32` — `og:image` は `https://daifugo-together.fly.dev/ogp.png`、`twitter:card` は `summary_large_image`。
- `packages/server/src/app-server.ts:943-966` — `/ogp.png` はどのハンドラにも一致せず `createStaticHandler` に落ちる。
- `packages/web/dist/ogp.png` は存在し 1200x630 PNG(`scripts/generate-design-images.mjs:33-34` の `OGP_WIDTH/HEIGHT` と一致、実ファイルを `sharp` で確認)。**画像そのものは正しい。壊れているのは配信ヘッダだけ**。
- 同じ理由で `favicon-32.png` と `apple-touch-icon-180.png` も octet-stream になる(`packages/web/dist/` に実在)。

**本番確認手順**(現状把握と、修正後の事後確認の両方に使う):

```sh
curl -sI https://daifugo-together.fly.dev/ogp.png | grep -i '^content-type'
# 修正前: application/octet-stream のはず / 修正後: image/png であること
curl -sI https://daifugo-together.fly.dev/apple-touch-icon-180.png | grep -i '^content-type'
```

**実施手順**(修正は数行。**curl の結果を待たず無条件で実施する** — `.png` が MIME テーブルに無いことはコード上確定しており、追加して困ることが何も無いため。curl は事後確認に使う):
1. `packages/server/src/app-server.ts:43-51` の `CONTENT_TYPES` に `'.png': 'image/png'` を追加する。`'.webp': 'image/webp'`、`'.jpg'/'.jpeg': 'image/jpeg'` も入れておくと以後の画像追加で同じ事故が起きない(`.ico` は `packages/web/dist` に存在しないので不要。`favicon.svg` は `.svg` が登録済みで問題ない)。
2. `packages/server/src/app-server.test.ts` に `/ogp.png` の Content-Type アサーションを 1 本足す(現状 PNG の content-type を検証するテストは無い。`grep -n "ogp\|octet-stream" packages/server/src/app-server.test.ts` でヒットなし)。
3. `pnpm verify` → main へ push → CI 成功で自動デプロイ(`.github/workflows/deploy.yml:19-42`)。
4. デプロイ後に上の curl を再実行。
5. 告知に使う URL を実際に X の下書きに貼ってプレビューを目視確認する。X のキャッシュが古い画像/カードを掴むことがあるので、**告知の数時間前に一度貼って確認**しておく。

**注意**: 必須-2、必須-6 と同じデプロイにまとめること(§必須-7 のフリーズ方針)。

---

### 必須-2. `room:join` のレート制限が「全ユーザーで 1 バケット共有」になっている疑い(10回/分)

**何を**: 招待コードでの入室に 10回/60秒 のレート制限がかかっているが、キーが `socket.handshake.address`(TCP のリモートアドレス)。Fly の HTTP プロキシ経由だとこれはクライアント IP ではなくプロキシのアドレスになるため、**全ユーザーが 1 つのバケットを共有し、1 分あたり全体で 10 回しか join できない**可能性が高い。

**なぜ**: 直近コミット `7492ff1 feat(web): add room invite links and QR sharing` の招待リンク/QR が、まさに「リンクを踏む → join」導線。X 告知でこの導線に人が集中すると、11 人目以降が `RATE_LIMITED` で入室できない。しかも失敗するのは「友だちに誘われて来た人」で、最も逃がしたくない層。

**根拠**:
- `packages/server/src/room/socket-gateway.ts:167-169` — 既定値 `{ maxAttempts: 10, windowMs: 60_000 }`。
- `packages/server/src/room/socket-gateway.ts:446` — `joinRateLimiter.allow(socket.handshake.address, now())`。
- `packages/server/src/app-server.ts:175-180` — **HTTP 側は明示的に `fly-client-ip` ヘッダを読んでいる**(`clientIp()`)。同じリポジトリ内で HTTP は Fly プロキシを意識し、Socket 側は生の remoteAddress を使っているという非対称がある。
- `grep -rn "fly-client-ip" packages docs` のヒットは `app-server.ts:176` の 1 箇所のみ。Socket 側で `fly-client-ip` を読む実装は存在しない。
- `packages/server/src/room/manager.ts:14-15` — 招待コードは 5 桁(10万空間)。総当たり防御としての join 制限には意味があるので、制限自体を外すのは非推奨。

**本番でのみ確定できること**: `socket.handshake.address` が実際に何になるか。ただしコードの非対称性から見て「プロキシのアドレス」である可能性が高い。

**実施手順**(プロキシ IP でもクライアント IP でも壊れない向きの修正。ただし下記 4 のメモリ注意あり):
1. `socket-gateway.ts:446` のキーを、`socket.handshake.headers['fly-client-ip']` を優先し、無ければ `socket.handshake.address` にフォールバックする形へ変える。`app-server.ts:175-180` の `clientIp()` と同じ考え方を共通化するのが素直。
2. 同時に `maxAttempts` の既定値を見直す。1 人の人間が 1 分に 10 回 join するのは異常だが、**もし共有バケットのままリリースするなら 10 は確実に足りない**。修正が間に合わない場合の応急策として、`joinRateLimit` を `{ maxAttempts: 300, windowMs: 60_000 }` 相当まで緩めて起動する選択肢がある(`socket-gateway.ts:88` の `joinRateLimit` オプション経由。ただし現状 `bin.ts` から渡す経路が無いため、env で渡すなら配線も要る)。
3. `socket-gateway.test.ts:596-616` に既存のレート制限テストがあるので、キー変更に合わせて 1 ケース足す。
4. **`FixedWindowRateLimiter` にはエビクションが無い**。`packages/server/src/room/rate-limit.ts:14` の `#windows = new Map<string, Window>()` はキーを追加するだけで、`allow()`(:29-38)は期限切れエントリを上書きするだけで削除しない。今はキーがプロキシ IP 1 個(= エントリ 1 個)なので問題が表面化していないが、**クライアント IP に変えると、見たすべての IP がプロセスが生きている限り Map に残り続ける**。1 エントリは数十バイト程度なので数万 IP でも数 MB で、512MB を即座に壊すものではないが、無制限に増える構造であることは認識しておく。対処は次のどちらか。
   - `allow()` の中で、既存エントリが期限切れだったときに近傍のキーをいくつか掃除する(数行)。
   - `windowMs` を短く保つ + 定期的に Map ごと作り直す(`setInterval` で `#windows.clear()`、`unref()` 付き)。
   明日昼までなら**注記だけ入れて放置でも許容**だが、`windowMs` を長くする方向の変更(§必須-6 で 1 時間窓を提案している)と組み合わせるとエントリの寿命が延びるので、そちらでは掃除を入れるほうがよい。
5. 必須-1 と同じデプロイに乗せる。

**本番確認手順**(デプロイ後):
- 2 つの異なるネットワーク(自宅 Wi-Fi と スマホの LTE)から、片方で 11 回以上 join を試みたあと、もう片方から join できるかを見る。もう片方も弾かれるなら共有バケットのまま。
- 告知後は `fly logs --app daifugo-together` に `RATE_LIMITED` 関連の異常が出ていないかを見る(現状 join 拒否はサーバーログに出ない設計なので、ログでは検知できない点に注意。ユーザーからの「入れない」報告が唯一の信号になる)。

---

### 必須-3. リリース直前の SQLite バックアップを 1 回取る

**何を**: 本番 SQLite(`/data/daifugo.sqlite`)のバックアップ経路が存在しない。告知前に手動で 1 回取る。

**なぜ**: プロジェクト自身の決定として「E7 着手前は必須」と書かれており、E7(codex パイプライン)は既に稼働している。つまり**自分たちの基準で既に期限超過**。提案者・提案状態・イエローカードは SQLite にしか無く、消えると復旧できない。Volume 1 本・Machine 1 台なので、Volume 障害 = 全損。

**根拠**:
- `docs/epics/E13-deployment.md:59` — 初回公開に含めないものの表:「**SQLite の定期バックアップ・エクスポート** … **E7 着手前は必須**(§5-1・decision-log 登録済み)。提案者・提案状態・イエローカードは SQLite にしか存在せず、消えると復旧できない」。
- `docs/epics/E13-deployment.md:252` — 未決事項 5-1:「Fly のボリュームスナップショットで足りるかを検証し、足りなければ定期エクスポート(**WAL があるので `VACUUM INTO` かオンラインバックアップ API を使う。ファイルコピーは不可**)」/ 状態: **未決**。
- `docs/product-backlog.md:262` — 初回公開に含めないものとして「定期バックアップ」を明記。
- `packages/server/src/persistence.ts:212` — `journal_mode = WAL`。よって単純な `.sqlite` ファイルコピーは不整合を生む。
- `grep -rn "backup|バックアップ" docs/runbooks/*.md` の結果、バックアップ手順は存在しない。ヒットするのは `E13-production.md:107` の `data/production-proposals.sqlite.backup` だけで、これは**提案データのローカル同期の副産物**。同期対象は「提案、L0–L3 検査記録、判定履歴、実装ジョブ」だけで、`users`・対局・評価・イエローカード・異議申立ては**取得しない**(`docs/runbooks/E13-production.md:97-103`)。**バックアップの代用にならない**。

**実施手順**(20〜40分)

> **各手順は、前の手順がエラーなく終わったことを確認してから次へ進む。** 途中でエラーが出たら止めて原因を潰す。「たぶん取れているだろう」で先へ進むと、バックアップを取ったつもりで何も無い状態になる。

**前提となる搬出経路の注意**: このリポジトリのプロジェクトメモ(`~/.claude/projects/-Users-qsona-projects-daifugo-together/memory/production-developer-account.md`)に、本番 SQLite への直接操作で**実績があるのは `fly ssh console --app daifugo-together -C "node --input-type=module" < script.mjs` の形式**で、`node /dev/stdin` / `sh -c 'cat > ...'` / **`fly ssh sftp` は「ブロックまたは動作しない」**と記録されている。この記録は Claude Code のコマンド許可判定を経由した場合の話なので、開発者が自分のターミナルで直接叩けば `fly ssh sftp get` が通る可能性はある。**ただし当てにはしない**。以下は sftp に依存しない経路を主にし、sftp は「通ったら儲けもの」の位置づけにしている。

**手順 0. サイズを確認する**(base64 で流すので、先に大きさを知っておく)

```sh
fly ssh console --app daifugo-together
# 対話 shell の中で:
ls -l /data/daifugo.sqlite /data/daifugo.sqlite-wal
df -h /data
exit
```

数百 MB を超えていたら base64 転送は現実的でないので、手順 2 を飛ばして手順 4 の Volume スナップショットを主手段にする。リリース前の段階なら通常は数 MB〜数十 MB のはず。

**手順 1〜2. スナップショットを作って、そのまま手元へ流す**(1 回の実行で完結)

次の内容を `backup-prod.mjs` としてローカルに保存する。

```js
import { createRequire } from 'node:module';
import { createReadStream, statSync, unlinkSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';

// createRequire に相対パスは渡せない(ERR_INVALID_ARG_VALUE)。必ず絶対パス。
const require = createRequire('/app/packages/server/package.json');
const Database = require('better-sqlite3');

const SRC = '/data/daifugo.sqlite';
const OUT = '/data/daifugo.sqlite.snapshot-tmp';

// VACUUM INTO の行き先は SQL の「文字列リテラル」。シングルクォートで囲む。
// JSON.stringify はダブルクォートを出すため SQLite が識別子と解釈して失敗する。
const db = new Database(SRC, { readonly: true });
db.exec(`VACUUM INTO '${OUT.replaceAll("'", "''")}'`);
db.close();

// 進捗と検算用のバイト数は stderr へ(stdout は base64 専用にする)。
process.stderr.write(`SNAPSHOT_BYTES=${String(statSync(OUT).size)}\n`);

try {
  await pipeline(
    // highWaterMark を 3 の倍数にすると、途中のチャンクに base64 パディング(=)が入らない。
    createReadStream(OUT, { highWaterMark: 3 * 16384 }),
    async function* (source) {
      for await (const chunk of source) yield chunk.toString('base64') + '\n';
    },
    process.stdout,
  );
} finally {
  // Volume は 1GB しかないので、成功・失敗どちらでも一時ファイルを残さない。
  unlinkSync(OUT);
}
```

```sh
# 実績のある形式。stdout が base64、stderr に SNAPSHOT_BYTES が出る。
fly ssh console --app daifugo-together -C "node --input-type=module" \
  < backup-prod.mjs > backup-prerelease.b64

# SNAPSHOT_BYTES の値を控える(手順 3 の検算に使う)。
# 復号の前に 2 段階で掃除する:
#   grep -v : fly ssh console -C は PTY 経由なので、stderr の SNAPSHOT_BYTES 行が
#             stdout 側(.b64)へ混ざることがある。混ざったまま復号すると壊れる。
#   tr -cd  : PTY 由来の CR など base64 以外の文字を落とす。
grep -v '^SNAPSHOT_BYTES' backup-prerelease.b64 \
  | tr -cd 'A-Za-z0-9+/=\n' \
  | base64 -d > backup-prerelease.sqlite
wc -c < backup-prerelease.sqlite   # SNAPSHOT_BYTES と一致すること
```

バイト数が一致しなければ**ここで止まる**。転送が壊れている。`backup-prerelease.b64` の先頭数行を目視して、`SNAPSHOT_BYTES=` 以外の想定外の出力(警告やプロンプト)が混ざっていないかも確認する。

**手順 3. 中身が読めることを確認する**(これをやらないと「取った気になる」だけ)

次を `verify-backup.mjs` としてローカルに保存し、`node verify-backup.mjs` で実行する。

```js
import { createRequire } from 'node:module';
// ローカル実行でも createRequire は絶対パス。import.meta.url ベースでもよい:
// const require = createRequire(new URL('./packages/server/package.json', import.meta.url));
const require = createRequire('/Users/qsona/projects/daifugo-together/packages/server/package.json');
const Database = require('better-sqlite3');

const db = new Database('./backup-prerelease.sqlite', { readonly: true });
console.log('integrity:', db.pragma('integrity_check')[0].integrity_check);
for (const t of ['users', 'proposals', 'set_results', 'replay_records']) {
  console.log(t, db.prepare(`select count(*) as c from ${t}`).get().c);
}
db.close();
```

**合格条件は次の 2 つを両方満たすこと。**

1. `integrity: ok` が出る。
2. **4 テーブルすべての件数行が出力され、その値が本番の実感と合っている。**

**2 を省いてはいけない。** 0 バイトや空の SQLite ファイルでも `integrity_check` は `ok` を返すため、`integrity: ok` だけでは「中身がある」ことの証明にならない。テーブルが存在しなければ `no such table` で落ちるので、件数行がすべて出ること自体が中身の証明になる。

ここまで通って初めて「バックアップがある」と言える。出力した件数はそのまま §推奨-3 の基準値スナップショットとして流用する(推奨-3 を別途実行する必要はない)。

**手順 4. Fly の Volume スナップショットを保険として明示的に作る**

手順 1〜3 が何らかの理由で通らなかった場合の保険であり、通った場合でも二重化として取っておく。

```sh
fly volumes list --app daifugo-together                # VOLUME_ID を確認
fly volumes snapshots list <VOLUME_ID>                 # 自動スナップショットの有無・保持期間
fly volumes snapshots create <VOLUME_ID>               # 直前の時点を明示的に固定する
```

`fly volumes snapshots create` は**確認ではなく作成**なので必ず実行する。ただしスナップショットは Fly 側にしか無く、リージョン障害やアカウント側の事故には効かないため、手順 1〜3 の手元コピーの代わりにはならない。

**注意**:
- `VACUUM INTO` は読み取り負荷がかかる。人がいない時間帯にやる。
- `readonly: true` のまま WAL 有効の DB に対して `VACUUM INTO` が成立し、**未チェックポイントの WAL の内容も含まれる**ことは、この監査でローカル再現して確認済み(WAL にしか無い行が snapshot に入ることを実測)。サーバーを止める必要はない。
- 手順 1〜2 は 1 回の `fly ssh console -C` で完結するので、Volume 上へ一時ファイルを置いたまま別コマンドで消しに行く必要がない(`--command "rm ..."` 形式に依存しない)。

---

### 必須-4. E15 Google OAuth の本番受け入れを完了させる(特に「公開ステータス」)

**何を**: 実 Google での通し確認が未完。加えて、Google Auth Platform の **公開ステータス(Testing / In production)** の切替が runbook に書かれていない。

**なぜ**: Testing のままだと、明示的にテストユーザーとして登録したアカウント以外はログインできない(かつ 100 ユーザー上限)。X 告知で来た人が「引き継ぎ登録」を押して失敗すると、提案(このサービスの中核機能)に到達できない。

**根拠**:
- `docs/archive/impl-progress.md:1633` — 「実 Google 通し、実セット完走後の登録導線、最終文言は本番デプロイ後の受け入れ確認で完了させる」。
- `docs/runbooks/E15-google-oauth.md:9-12` — Audience の `External` / `Internal` 選択までは書かれている。
- `grep -n "公開|production|Testing|テストユーザー|Publishing" docs/runbooks/E15-google-oauth.md` — **Publishing status / Testing / テストユーザーへの言及は 1 件も無い**(ヒットは Internal の説明文中の「検証」2 件のみ)。runbook の穴。
- `packages/server/src/bin.ts:59-72` — Client ID/secret が無い/失敗すると `google_auth_provider_unavailable` をログして起動は続行。`packages/server/src/app-server.ts:270-273` — provider が無いと `/api/auth/*` は 503 `auth_unavailable`。つまり**サーバーは落ちずに静かにログイン不能になる**。
- `docs/runbooks/E15-google-oauth.md` 末尾に「アプリが要求する scope は `openid` だけで、メール、氏名、アイコンは取得しない」— 機微 scope は無いので Google の審査(verification)は不要な想定。

**実施手順**:
1. Google Cloud Console → Google Auth Platform → **Audience** を開き、**Publishing status が「In production」**であることを確認する。Testing なら「Publish app」する。scope が `openid` だけなら verification は不要なはず(要画面上での確認)。
   - **同時に Branding 画面で「Privacy policy URL」「Terms of service URL」が必須項目になっていないかを確認する。** 「Publish app」の前提としてこれらの入力を求められる場合、**§推奨-2(このゲームについてページ)はその場で「推奨」から「必須」へ昇格する**。必須-4 が推奨-2 にブロックされる形になるので、この確認は前夜のうちに済ませておく(そうすれば推奨-2 を当日朝に慌てて書かずに済む)。URL は公開後に `https://daifugo-together.fly.dev/about` を指す想定で、ページ側を先に作れば埋められる。
   - 逆にこれらが任意なら、推奨-2 は当初どおり「推奨」のままでよい。
2. **Clients** → Authorized redirect URIs に `https://daifugo-together.fly.dev/auth/google/callback` が完全一致で登録されていることを確認(`docs/runbooks/E15-google-oauth.md:15-20`)。
3. Fly secrets が入っているか確認: `fly secrets list --app daifugo-together` に `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` が出るか(`docs/runbooks/E15-google-oauth.md:29-40`)。
4. 起動ログに `google_auth_provider_unavailable` が出ていないか: `fly logs --app daifugo-together --no-tail | grep google_auth_provider_unavailable`。
5. **自分のアカウント以外**(家族・別 Google アカウント)で、シークレットウィンドウから実際にログインを通す。これが Testing 状態の唯一の確実な検出方法。
6. `docs/runbooks/E15-google-oauth.md` §4〜§6 の受け入れ手順(AU-01/AU-02/AU-03、375×812)を通す。時間が足りない場合、**最低でも §4 の 1〜5(実ログイン → 提案送信)だけは通す**。
7. 実施記録は `docs/runbooks/E15-google-oauth.md` 末尾の「実施記録」節へ追記し(節がなければ作る)、`docs/status.md` の該当行を更新する(完了なら行を削除する)。同 runbook §7 のとおり、Client ID 全文・secret・認可コード・`user_token` は書かない。

**フォールバック**: 万一 OAuth が本番で動かないまま告知時刻になった場合、匿名のままでも遊べる(匿名おためし提案枠が同時 1 件ある。`docs/archive/impl-progress.md:6`、`packages/server/src/proposal/submission.ts:108-113,137-140`)。壊滅ではないが、告知文で「ログインは調整中」と書くか、ログイン導線を隠す判断が要る。

---

### 必須-5. 落ちたことに気づける最低限の仕組みを 1 つ入れる

**何を**: 外形監視を 1 本だけ入れる(所要 10〜15 分)。

**なぜ**: 現状、サーバーが落ちても開発者に通知は来ない。Fly の health check は Machine を再起動させるが、**開発者へは何も通知しない**。告知直後に落ちて誰も気づかない状態が一番損失が大きい。

**根拠**:
- `docs/runbooks/E13-production.md:131` — 「外部通知は初回スコープ外なので、**障害は自動通知されない**」(設計上の意図的スコープ外であることが明記されている)。
- `fly.toml:26-31` — `[[http_service.checks]]` は `/health` を 15 秒間隔で叩くだけ。
- `fly.toml:39-40` — shared CPU 1 / 512MB、`min_machines_running = 1`(`fly.toml:24`)。1 台構成なので単一障害点。
- Sentry / エラートラッキングの導入なし(`packages/server`・`packages/web` に該当依存・初期化コードなし)。エラーは `bin.ts:26-38` の JSON 構造化ログとして stdout/stderr に出るだけで、`fly logs` を人が見に行かないと分からない。
- `packages/server/src/app-server.ts:905-941` — `/health` は `{"status":"ok","db":"ok"}`(drain 中は `status:"draining"`、DB 疎通失敗のみ 503)。**外形監視の対象として素直に使える**。

**実施手順**:
1. UptimeRobot / Better Stack / Cronitor など無料枠のサービスで、`https://daifugo-together.fly.dev/health` を 1〜5 分間隔の HTTP モニタとして登録する。通知先はスマホのプッシュかメール。
2. キーワード監視が使えるなら、レスポンス本文に `"db":"ok"` を含むことを条件にする。503 だけでなく DB 異常も拾える。
3. 告知直後の 1〜2 時間は `fly logs --app daifugo-together` を手元で開いたままにする。特に見る `event`(`docs/runbooks/E13-production.md:117-129`):
   - `uncaught_exception` — 未捕捉例外。直後に Machine が再起動したかも確認
   - `socket_internal_error` — Socket/タイマー/永続化の予期しない例外
   - `rule_auto_disabled` / `rule_load_failure` — ルールの自動無効化
   - `ai_fallback` — 頻発していれば AI worker が飽和している(§初週-11)

**やらないこと**: Sentry の導入は明日昼までにやる価値に対してリスク(初期化ミス、PII、依存追加)が大きい。外形監視で足りる。

---

### 必須-6. 提案 API に IP レート制限を 1 本入れる(最小版)

**何を**: `POST /api/proposals` に IP ベースのレート制限が無い。既存の `FixedWindowRateLimiter` を流用して数行で足せる。

**なぜ**: 匿名ユーザーは「同時進行 1 件」枠しか無いが、`localStorage` の `userToken` を捨てれば**新しい `users` 行が無制限に作られ、枠がリセットされる**。X 告知で不特定多数の目に触れるので、悪意ある大量投稿に対して構造的な防御が無い。溢れると `proposals` テーブルが膨らみ(Volume 1GB)、開発者の審査キューが埋まる。

**根拠**:
- `packages/server/src/app-server.ts:851-855` — `options.proposals.submit({ token, ip: clientIp(request), body })` と、**IP は渡している**。
- `packages/server/src/proposal/submission.ts:47,106` — `ip: string` はインターフェースに存在するが、`grep -n "input.ip" packages/server/src/proposal/submission.ts` は**ヒット 0**。**受け取っているが一切使っていない**。実装途中の名残と思われる。
- `packages/server/src/proposal/submission.ts:108-113,137-140` — 制限は `!isRegistered(authorId) && hasInflight(authorId)` の 1 件枠(`anonymous_inflight_limit`)と、イエローカードによる `proposal_suspended` のみ。**登録済み(Google 紐付け)ユーザーには件数制限が無い**。
- `packages/server/src/persistence.ts:96-140` — `SqliteSessionStore.resolve()` は未知トークンに対して無条件で `users` 行を INSERT する。トークン発行に制限は無い。
- 対比として `/api/rules` には 120回/60秒 の制限がある(`packages/server/src/app-server.ts:239-244,371-379`)。**提案 API だけ抜けている**。
- 緊急停止手段が乏しい: `pnpm ops` の CLI コマンドは status/budget/funnel/metrics/settings/rule/popularity/list-appeals/revoke-card/reject-appeal のみ(`packages/server/src/ops.ts:33-127`)。**特定ユーザーを止める `suspend` コマンドは無い**。停止はイエローカード経由でしかできない。

**実施手順**(30〜60分):
1. `packages/server/src/app-server.ts` の `createAppServer` 内、`ruleCatalogRateLimiter`(:239)の隣に提案用の `FixedWindowRateLimiter` を 1 本作る。まずは緩めの値(例: `{ maxAttempts: 10, windowMs: 60 * 60_000 }` = 1 IP あたり 1 時間に 10 件)で十分。正常な人が 1 時間に 10 件の新ルールを書くことはまずない。
   - **注**: `FixedWindowRateLimiter` はエントリを削除しない(`rate-limit.ts:14,29-38`。詳細は §必須-2 の手順 4)。1 時間窓にすると各 IP のエントリが最低 1 時間は生き、しかも期限切れ後も Map からは消えない。手っ取り早い緩和は、窓を 10 分程度に縮めて件数も比例させる(例: `{ maxAttempts: 3, windowMs: 10 * 60_000 }`)か、`allow()` に掃除を足すこと。既存の `/api/rules` 用リミッタ(120回/60秒)も同じ性質だが、こちらは既に本番で動いており実害が出ていない。
2. `handleProposal` の `isCreate` 分岐(`app-server.ts:836` の authorize 直前あたり)で `clientIp(request)` をキーに `allow()` を呼び、超過したら `writeJson(response, 429, { error: 'rate_limited' })`。`/api/rules` の実装(`app-server.ts:371-379`)をそのまま真似ればよい。
3. `app-server.test.ts` に 429 のケースを 1 本足す(既存のレート制限テストの形をコピー)。
4. クライアント側は `packages/web/src/proposal/client.ts` が 429 をどう扱うか要確認。未対応でもフォームがエラー表示になるだけなので、明日昼までなら未対応で許容できる。
5. 必須-1、必須-2 と同じデプロイに乗せる。

**やるべきでないこと**: `ip` を使った本格的な多層防御(登録ユーザーの日次上限、CAPTCHA、Cloudflare 前段)は明日昼までには入らない。1 本のシンプルな上限で「殺到しても壊れない」状態を作るだけにする。

**監視クエリ**(告知後に定期実行して異常を検知する):

```sh
# 対話 shell に入ってから実行する(--command / sh -c 形式は §必須-3 の注意のとおり当てにしない)
fly ssh console --app daifugo-together
# shell の中で:
DATABASE_PATH=/data/daifugo.sqlite node packages/server/dist/ops.js funnel --since 2026-08-02
exit
```

対話 shell を開かずに済ませたい場合は、`ops.js` を `process.argv` を差し替えてから読み込むスクリプトを stdin で流す(§必須-3 と同じ、実績のある形式)。

```sh
cat > funnel.mjs <<'EOF'
process.env.DATABASE_PATH = '/data/daifugo.sqlite';
process.argv = [process.argv[0], 'ops', 'funnel', '--since', '2026-08-02'];
await import('/app/packages/server/dist/ops.js');
EOF
fly ssh console --app daifugo-together -C "node --input-type=module" < funnel.mjs
```

---

### 必須-7. 告知前後のデプロイフリーズを決める

**何を**: 必須-1/2/6 の修正を **2026-08-02 の朝までに 1 回のデプロイでまとめて入れ**、以降は告知〜当日夜まで main へ push しない。

**なぜ**: main への push は CI 成功で**自動的に本番デプロイになる**。デプロイ中は drain が走り、その間に来た人は新規の create/join/start ができない。X の告知直後に URL を踏んだ人がちょうどそのタイミングだと、いきなり失敗画面を見る。しかも drain 中の UI 文言は未決のまま。

**根拠**:
- `.github/workflows/deploy.yml:19-42` — `CI` が main への push で成功すると `flyctl deploy` が自動実行される。手動承認ステップは無い(`environment: production` はあるので、GitHub 側で Required reviewers を付ければ止められる)。
- `docs/runbooks/E13-production.md:141-150` — drain 中は「新規 create/join/start/continue は `server is draining` で拒否される」。
- `packages/server/src/room/socket-gateway.ts:414-417,441-444` — 実際に `draining` チェックで `INTERNAL: server is draining` を返す。
- `docs/epics/E13-deployment.md:120` — 「**drain 中は新しい部屋を作れない・入れない**。… このときの UI 文言は decision-log B-3(**未決**)」。
- `docs/runbooks/phase2-operations.md:58,60` — 「E-15 のダウンタイムを実際に起こすのは Codex 起動ではなく、ルール PR のマージ後に走るデプロイである」「『遊ばれている時間帯を避ける』マージ/デプロイ運用の正式化は … **未決**」。つまり**この運用ルールは自分たちで必要性を認識しつつ未確立**。
- `fly.toml:4` — `kill_timeout = "300s"`。進行中の対局は最大 5 分待ってから切られる。

**実施手順**:
1. 明日 **08:00〜10:40 を修正デプロイの窓**とし、**実際のデプロイはその中の 08:40 の 1 回だけ**にする(§5 のタイムラインと同じ)。必須-1/2/6 を 1 本の PR にまとめ、前夜のうちに `pnpm verify` を通しておく。窓の終端 10:40 が §5 のフリーズ開始時刻であり、告知(12:00)まで 80 分の余白を残している。
2. デプロイ後、`docs/runbooks/E13-production.md:141-150` の drain 確認手順(`node scripts/verify-production-set.mjs https://daifugo-together.fly.dev` を別端末で走らせながらデプロイ)で、対局が完走することを確認する。
3. 確認が済んだら(遅くとも 10:40)**告知まで main に push しない**。ルール PR のマージも止める(ルール PR のマージ = デプロイ = ダウンタイム)。10:40 までに drain 確認が終わらない場合は、**デプロイを取り消してロールバックし(手順 5)、フリーズへ入る**。中途半端な状態で告知時刻を迎えない。
4. 保険として GitHub の `production` Environment に Required reviewers を設定しておくと、うっかり push でも本番へ出ない。
5. 告知当日に緊急修正が必要になった場合のロールバック手順は `docs/runbooks/E13-production.md:151-167` にある(**実際に一度実行して戻せることを検証済み**: `docs/archive/impl-progress.md:1537`)。この節を明日開いておく。

---

## 2. リリース前推奨(数時間で可能・費用対効果が高い)

### 推奨-1. 静的アセットの長期キャッシュ(+可能なら圧縮)

**何を**: `/assets/` 配下(内容ハッシュ付き)に `cache-control: public, max-age=31536000, immutable` を返す。時間があれば gzip も。

**なぜ**: 現状すべての静的ファイルが `cache-control: no-cache` で、**ETag も Last-Modified も無い**。つまり再訪・リロードのたびに全ファイルをフルダウンロードする。圧縮も無い。X 告知で来た人がモバイル回線で初回 418KB の JS + 431KB の CSS を非圧縮で引くのは、体感速度にも 512MB / shared CPU 1 台の帯域にも効く。

**根拠**:
- `packages/server/src/app-server.ts:148-157` — 設定するヘッダは `content-type` と `cache-control: no-cache` のみ。ETag / Last-Modified / Content-Encoding のいずれも設定していない。条件付きリクエスト(`If-None-Match`)の処理も無いので 304 は返せない。
- `grep -rn "gzip|brotli|zlib|compress|content-encoding" packages/server/src` — **ヒットなし**。圧縮は一切していない。
- `packages/web/dist/assets/index-BuIRR0Sk.js` 418,654 バイト、`fonts--EcXM3Rb.css` 431,943 バイト、`index-Bg03Mhrb.css` 56,401 バイト(いずれも非圧縮のまま配信される)。`dist` 全体は 13MB / 726 ファイル(大半はフォントのサブセットで、1 ページで全部は読まない)。
- ファイル名に内容ハッシュが入っている(Vite の既定)ので、`/assets/` 配下は immutable にして安全。

**実施手順**(30分):
1. `createStaticHandler`(`app-server.ts:112-159`)で、解決後のパスが `/assets/` 配下かどうかを見て `cache-control` を出し分ける。`index.html` は `no-cache` のまま維持する(ここを長期キャッシュにすると新デプロイが反映されなくなる)。
2. 圧縮まで入れるなら、`Accept-Encoding` に gzip があり、かつ拡張子が `.js`/`.css`/`.svg`/`.json` のときだけ `createReadStream(path).pipe(zlib.createGzip()).pipe(response)` にして `content-encoding: gzip` を付ける。ただし毎リクエスト CPU を使うので、shared CPU 1 台では**事前圧縮(`.gz` を build 時に作って優先配信)のほうが安全**。時間が無ければ圧縮は見送り、キャッシュだけ入れる。
3. `app-server.test.ts` にヘッダのアサーションを足す。

**判断**: キャッシュだけなら明日の朝のデプロイに乗せてよい。圧縮は当日入れるにはリスクがあるので初週送りでもよい。

---

### 推奨-2. 「このゲームについて」ページ(プライバシー・利用規約・問い合わせ)を最小構成で置く

**何を**: メニューから開ける静的な 1 セクションを追加する。中身は (a) 保存しているデータ、(b) 提案文が公開される旨、(c) 連絡先(X のアカウント or メール)、(d) Google ログインで何を取得するか、の 4 点。

**なぜ**: X で不特定多数に告知して、問い合わせ先が無いのは運用上つらい(不具合報告も不快なルールの通報も届かない)。加えて Google OAuth の同意画面を「In production」にする際、Homepage / Privacy policy URL の入力を求められることがある(必須-4 と連動)。

**根拠**:
- `grep -rn "プライバシー|利用規約|問い合わせ|お問い合わせ|privacy|terms" packages/web/src packages/web/index.html` — **該当ページ・リンクのヒットなし**(ヒットするのは `docs/design/` 内のレビュー文書と、無関係な「フィードバック」という語のみ)。
- `packages/web/src/routing.ts:5-15` — 画面は title / menu / proposal / myProposals / activeRules / ruleDex / 各種デモのみ。about / privacy / terms に相当するルートは無い。
- 保存されるデータの実態(記述内容の裏取り):
  - `packages/server/src/persistence.ts:96-140` — 匿名ユーザーは `users` 行(`userId` / `userToken` / 表示名 / 作成時刻)。Cookie ではなく localStorage のトークン(`packages/web/src/multiplayer/client.ts:52-57`)。
  - `docs/runbooks/E15-google-oauth.md` 末尾 — 「アプリが要求する scope は `openid` だけで、**メール、氏名、アイコンは取得しない**」。プライバシー記述としては非常に書きやすい。
  - `docs/runbooks/phase3-operations.md:113` — 対局アクションは `replay_records` に保存。
- IP は提案時に受け取っているが保存も利用もしていない(必須-6 の根拠のとおり `input.ip` は未使用)。**必須-6 で IP レート制限を入れるなら、この記述に「不正防止のため IP を一時的に使う」を足すこと**。

**実施手順**(1〜2時間):
1. `packages/web/src/screens/` に `AboutScreen.tsx` を足し、`routing.ts:5-15` の `SCREEN_PATHS` に `/about` を追加する。既存画面のパターンをそのまま踏襲すればよい。
2. メニュー(`MenuScreen.tsx`)の下部に小さくリンクを置く。
3. 文言は既存のトーン(`docs/design/` のガイド)に合わせる。堅い法務文書は不要で、「なにを保存しているか」「なにかあったらここへ」が伝われば十分。
4. 連絡先は X アカウントで足りる。メールを晒したくないなら X の DM 開放でよい。

---

### 推奨-3. 告知直前に「基準値スナップショット」を取る

**何を**: 告知の直前に `users` / `game_sets` / `set_results` / `proposals` の件数を控える。所要 5 分。

**なぜ**: これが無いと「リリース日に何人来て何人遊んだか」を、それ以前の開発中データと切り分けられない。既存の CLI は `--since` を取れるが、生件数の before/after があると読み違いが減る。

**根拠と、実際に何が測れるか**:
- **来訪者数**: 専用の計測は無いが、`users` テーブルの件数が実質的な「アプリを開いたブラウザ数」になる。理由: `packages/web/src/main.tsx` が起動時に `App` をマウント → `packages/web/src/multiplayer/client.ts:272-277` の `getBrowserMultiplayerClient()` が即座に Socket.IO を接続 → `packages/server/src/room/socket-gateway.ts:376` の `sessions.resolve(...)` が未知トークンに対して `users` 行を作る(`packages/server/src/persistence.ts:96-140`)。トークンは localStorage に保存される(`multiplayer/client.ts:52-57`)ので、リピーターは重複しない。`users.createdAt` があるので日付で絞れる。
- **遊んだ人数/卓数**: `ops metrics --since` の `completedSets` / `partialSets`(`packages/server/src/operations/repository.ts:132-133`、読み方は `docs/runbooks/phase3-operations.md:26-28`)。
- **提案数**: `ops funnel --since`(`packages/server/src/ops.ts:44-52`、読み方は `docs/runbooks/phase2-operations.md:40-53`)。
- **設計上、クライアント計測は意図的に無い**: `docs/epics/E10-operations.md:21` —「**見ない計器を作らない**」「専用の管理画面は作らず、計測は他 Epic が既に書くデータを読むだけで済ませる」。gtag/plausible/posthog/umami のヒットが無いのは実装漏れではなく方針。

**実施手順**:

**1.(主経路)§必須-3 手順 3 の出力をそのまま転記する。** バックアップの検証で `users` / `proposals` / `set_results` / `replay_records` の件数を既に出しているので、**この項目のために本番へ入り直す必要はない**。転記するときは取得時刻も一緒に控える。

**2. ファネルと指標を併せて取る。**

```sh
# 対話 shell 版
fly ssh console --app daifugo-together
# shell の中で:
DATABASE_PATH=/data/daifugo.sqlite node packages/server/dist/ops.js funnel --since 2026-08-01
DATABASE_PATH=/data/daifugo.sqlite node packages/server/dist/ops.js metrics --since 2026-08-01
exit
```

stdin スクリプト形式で済ませたい場合は §必須-6 の `funnel.mjs` と同じ書き方(`process.argv` を差し替えて `/app/packages/server/dist/ops.js` を `import`)を使う。`--command` / `sh -c` 形式は使わない(§必須-3 の注意)。

出力をそのままメモに貼る。翌日以降 `--since 2026-08-02` で差分を見る。

**代替(必須-3 を実行しなかった場合のみ)**: 件数だけを取りたいなら、次を `count-prod.mjs` として保存し `fly ssh console --app daifugo-together -C "node --input-type=module" < count-prod.mjs` で流す。

```js
import { createRequire } from 'node:module';
const require = createRequire('/app/packages/server/package.json');
const Database = require('better-sqlite3');
const db = new Database('/data/daifugo.sqlite', { readonly: true });
for (const t of ['users', 'proposals', 'set_results', 'replay_records']) {
  console.log(t, db.prepare(`select count(*) as c from ${t}`).get().c);
}
db.close();
```

---

### 推奨-4. クライアントアナリティクスは「入れるとしても最小」

**判定**: リリース前に入れる必要は**低い**。人数・卓数・提案数はサーバー側で取れる(推奨-3)。

**入れる価値がある唯一の情報**は「X の告知からどれだけ流入したか(referrer)」と「トップ画面から実際に遊び始めた率(離脱ポイント)」。これはサーバー側では分からない。

**入れるなら**: 自前で 1 エンドポイント(`POST /api/hit` で `document.referrer` と画面 ID だけを記録)を足すのが、外部 SDK を入れるより設計方針(`docs/epics/E10-operations.md:21`)と整合し、プライバシー記述も簡単。ただし**明日昼までにやる価値は薄い**。推奨-2 のプライバシー記述にも影響するので、入れるなら同時に。

**やるべきでないこと**: 外部アナリティクス SDK を告知前日に入れること。CSP も無い状態で外部スクリプトを増やすとリスクだけ増える。

---

### 推奨-5. 実機(スマホ実物)で本番 URL を一周する

**何を**: 手持ちのスマホで `https://daifugo-together.fly.dev/` を開き、(a) 3戦セット完走、(b) 提案フォーム、(c) 招待リンクを別端末で開いて入室、の 3 つを通す。所要 30〜40 分。

**なぜ**: 実画面での確認が**開発環境の制約で残ったまま**になっている項目が複数ある。これらは「本番 URL ができた今なら実行できるが、まだ実行されていない」性質のもので、告知前に潰す価値が高い。X の告知経由の来訪者はほぼスマホなので、ここが崩れていると全部無駄になる。

**根拠**:
- `docs/archive/impl-progress.md:6` — 匿名おためし提案枠について「**375×812 実画面だけブラウザの localhost 遮断で未確認**」。
- `docs/archive/impl-progress.md:99` — 「375×812 で未登録フォームと枠埋まりパネルを実画面確認 | Browser / Chrome とも localhost をクライアント側で遮断したため**未確認**。自動 UI テストは成功」。**localhost 遮断が原因なので、本番 URL では実行できる**。
- `docs/archive/impl-progress.md:1100` — 「**実機のノッチ/ホームインジケータでの見え**は未確認。ブラウザでは `env(safe-area-inset-*)` が 0 になるため、セーフエリアの効きそのものは検証できていない」。これは**実機でしか確認できない**。
- `packages/web/index.html:5-9` — `viewport-fit=cover` を指定しており、セーフエリアに依存した実装になっている。
- `docs/runbooks/E15-google-oauth.md:72-78`(§5)に 375×812 での AU-03 受け入れ手順があり、必須-4 と重複するので**まとめて 1 回で済ませられる**。

**実施手順**: 必須-4 の受け入れ(§4・§5)と同じセッションで、DevTools のエミュレータではなく**実機**で通す。特に見る点は (1) ノッチ・ホームインジケータにボタンや手札が隠れていないか、(2) 提案フォームで横スクロールが発生しないか、(3) キーボード表示中に送信ボタンが押せるか。

---

## 3. リリース後でよい(初週)

### 初週-1. AI worker の飽和を観測する

- **現状**: worker は **1 本固定**。`packages/ai/src/worker-pool.ts:25` — `readonly size = 1`。`packages/ai/src/ai-player.test.ts:185-188` —「B-7 の仮値として worker pool を 1 本に固定する」。`docs/decision-log.md:31` — B-7(プール本数と予算の実測調整)は**未決**。
- **過負荷時の挙動は degrade であってハングではない**: `packages/server/src/ai-turn.ts` のwatchdogで応答不能時も最初の合法手へ進み、通常完了以外は`ai_fallback`へ記録する。ルームAIの探索予算は`hardMs: 150`、`maxPlayouts: 3`。時間内に途中結果があれば`partial-search`、探索開始前にキュー期限へ達した場合などは`heuristic`へ段階的に退避する。
- **つまり**: 同時卓が増えると AI が弱くなるだけで、対局は止まらない。設計として妥当。
- **観測**: `ai_fallback`の個別記録に加え、`ai_turn_summary`の1分ごとの手番数、fallback内訳、wall time・playout数のP95/最大を見る。fallbackが常時増えるようになったら予算かマシンサイズを調整する。CPU が1コアなので**プールを増やしても効果は薄い**。

### 初週-2. Volume 使用量を毎日見る

- `docs/runbooks/E13-production.md:8` — Volume は **1GB**。
- `docs/runbooks/phase3-operations.md:113` — 「対局アクションは `replay_records` に保存する … 保持期間は decision-log B-4 の人間判断が未完了のため、**自動削除を追加しない**。決定までは本番 Volume 使用量を**週次**で確認する」。`docs/decision-log.md:28` — B-4 は未決。
- **リリース週は週次では粗い**。告知でトラフィックが跳ねる週なので毎日見る。

```sh
fly ssh console --app daifugo-together
# shell の中で:
df -h /data
exit
```

`--command "df -h /data"` 形式はプロジェクトメモの記録上あてにならない(§必須-3 の注意)。対話 shell を使う。

- 逼迫したら `fly volumes extend` で拡張するか、B-4 を決めて古い `replay_records` を削除する。

### 初週-3. 提案キューの実態を見てから防御を追加する

- E7 パイプラインは**ユーザー操作では起動しない**ので、提案が殺到しても API 課金や codex 枠が勝手に燃えることはない(§4-4 参照)。燃えるのは開発者の審査時間。
- 1 週間 `ops status` / `ops funnel` を見て、実際の投稿量とスパム比率を掴んでから、登録ユーザーの日次上限や自動スクリーニングの締め方を決める。
- 併せて `users` テーブルの増え方も見る。**`room:create` にはレート制限が無く、トークンを捨てて開き直せば部屋もユーザー行も作り放題**(§4-3)。増え方が来訪実感と乖離していたら、§必須-2 で入れた IP キーの仕組みを `room:create` にも広げる。

### 初週-4. 圧縮・独自ドメイン・定期バックアップの自動化

- 圧縮は推奨-1 の後半。独自ドメインは `docs/epics/E13-deployment.md:58` で「人に広く宣伝する段になったら」とされており、まさに今がその段だが、DNS/TLS 作業を告知前日にやる理由は無い。
- 必須-3 は手動 1 回。定期化(cron / GitHub Actions からの `VACUUM INTO` + 外部保管)は初週で仕組み化する。`docs/epics/E13-deployment.md:252` の 5-1 を決着させる。

### 初週-5. セキュリティヘッダ

- `app-server.ts:148-157,226-235` — CSP / X-Content-Type-Options / Referrer-Policy いずれも未設定。`force_https = true`(`fly.toml:21`)なので HTTPS は担保されているが HSTS ヘッダは無い。
- 現状の攻撃面は小さい(外部スクリプトを読まない、フォーム送信先は同一オリジンのみ)ので緊急ではないが、初週で `X-Content-Type-Options: nosniff` と基本的な CSP は入れておくとよい。**ただし必須-1 の PNG 修正より先にやってはいけない**(nosniff を先に入れると octet-stream の画像がより確実にブロックされる)。

---

## 4. 確認したが「問題なし」と判断した領域

### 4-1. ロールバック手順(観点9)— 問題なし

- `docs/runbooks/E13-production.md:151-167` に、`fly releases --image` で直前のイメージを特定して `fly deploy --image` で戻す手順が実コマンド付きで記載されている。戻らないもの(SQLite データ、スキーマ、secret、`fly.toml` 由来の設定)も明記されている。
- **机上ではなく実際に実行済み**: `docs/archive/impl-progress.md:1537` —「Fly CLI v0.4.69 で `fly releases --image` から直前の `e13-initial` を特定し、`fly deploy --image` で実際に切り替えた。`/health` passing と `replay_records=333` / `set_results=2` の保持を確認後、同じ手順で `e13-final` へ復帰」。
- 唯一の注意点として「古いイメージはレジストリから永久には保持されない」(`E13-production.md:167`)。明日戻す先が消えている可能性は低いが、**明日朝のデプロイ前に `fly releases --app daifugo-together --image` を実行して、戻り先のタグを控えておく**と確実。

### 4-2. graceful restart / drain(観点9)— 問題なし

- `packages/server/src/bin.ts:203-232` — SIGTERM/SIGINT で `beginDrain()` → `close()` → `persistence.close()`。`fly.toml:3-4` の `kill_signal = "SIGTERM"` / `kill_timeout = "300s"` と整合。
- `packages/server/src/room/socket-gateway.ts:789-807` — drain 開始時に進行中の部屋へ `requestDrain` を送り、全部屋が `playing` でなくなったら解決する。
- `/health` は drain 中も 200 のまま `status:"draining"` を返す(`app-server.ts:933-939`)。ヘルスチェックが drain 中に落ちて即殺されることがない。
- 実行確認手順も runbook にある(`docs/runbooks/E13-production.md:141-150`)。

### 4-3. ルームとセッションのメモリ特性(観点2)— 通常の告知シナリオでは問題なし / 意図的な攻撃者には増やされうる

- RoomState はプロセス内だが、**すべての生存期間に上限がある**: `packages/server/src/room/reducer.ts:25-30` — 手番 60 秒 / 切断中の手番 15 秒 / 中間 15 秒 / セットリザルト 120 秒 / **ロビー TTL 30 分** / **放置タイムアウト 5 分**。
- 60 秒ごとの sweep で期限切れを回収する(`packages/server/src/room/socket-gateway.ts:352-364`)。
- 切断時に `activeByUser` と `readySocketIds` から確実に削除される(`socket-gateway.ts:756-762`)。接続数に比例したメモリは残らない。
- **セッションはメモリではなく SQLite に持つ**(`packages/server/src/persistence.ts:70,336` の `SqliteSessionStore`)。`InMemorySessionStore`(`room/session.ts:21-`、無制限に貯まる)は使われていない。
- Socket.IO 側の入力制限あり: `packages/server/src/app-server.ts:977-982` — `maxHttpBufferSize: 16 * 1024`、`serveClient: false`、`pingInterval: 10_000` / `pingTimeout: 8_000`。HTTP ボディも 8KB 上限(`app-server.ts:184,199`)、管理 API のみ 64KB(`app-server.ts:654`)。
- **判定(通常シナリオ)**: 512MB でメモリが先に尽きる構造にはなっていない。先に詰まるのは CPU(§初週-1)。
- **判定(意図的な攻撃者がいる場合)— 条件付きで問題あり**: `room:create` には**レート制限が無い**(`packages/server/src/room/socket-gateway.ts:408-437`。`room:join` の :441-450 と違って `joinRateLimiter` を通らない)。加えて `SqliteSessionStore.resolve()` は未知トークンごとに `users` 行を作る(`packages/server/src/persistence.ts:96-140`)ので、**トークンを捨てて開き直せば同一人物が部屋をいくつでも作れる**(1 ユーザー 1 部屋の制約は `ALREADY_IN_ROOM` で効くが、ユーザーは作り放題)。作られた部屋はロビー TTL 30 分で自動的に消える(`packages/server/src/room/reducer.ts:29`)ので**恒久的なリークではなく、30 分ぶんの滞留**にとどまる。招待コードの枯渇も `MAX_INVITE_ATTEMPTS = 64`(`manager.ts:16`)と 10 万空間で当面安全。
  - 残る実害は `users` テーブルの行数増加(Volume 1GB、§初週-2)と、§推奨-3 の「来訪者数 ≒ `users` 件数」という計測前提が汚れること。
  - **明日昼までの対処は不要**と判断する。理由は (a) 部屋は 30 分で自動回収される、(b) `room:create` にレート制限を足すのは §必須-6 より優先度が低い、(c) 攻撃されたら §必須-2 で入れる IP キーの仕組みを `room:create` にも広げれば塞げる。初週の観測項目に入れておく(§初週-3)。

### 4-4. E7 codex パイプラインの暴走リスク(観点7)— 問題なし

- **ユーザーの操作では codex は起動しない**。`docs/runbooks/phase2-operations.md:58` —「このCLIはキューを可視化するが、**Codex 実行数を自動制限しない。ローカル判定・実装 skill は開発者が明示起動する**」。`docs/epics/E10-operations.md` の改訂ノート(冒頭) —「判定・実装は開発者マシン上のローカルツール/skill から**人間承認で**起動し、**従量課金 API もサーバー常駐 worker も使わない**。このため現時点では OP-01 のレート governor、`settings` の codex 上限、`ops_events.codex_started` は作らない」。
- したがって**「悪意ある提案が殺到 → 勝手に実装されて本番に入る」経路は存在しない**。人間のマージが必ず挟まる。コスト上限が未実装なのは「自動起動が無いので不要」という設計判断であり、穴ではない。
- 提案の受け口には静的インジェクション検査が入る: `packages/server/src/bin.ts:49-52` — `InjectionSignalRecorder(new InjectionStaticAnalyzer(), ...)`。`packages/server/src/proposal/submission.ts:141` — 投稿時に必ず `analyze()` してシグナルを記録し、開発者のキューに載せる。
- ルール PR 側にも境界がある: `.github/workflows/rule-pr.yml:20-58` — `pull_request_target` を使いつつ、**信頼できる base リビジョンから** `diff-guard.mjs` をチェックアウトして実行し、PR の作者を `RULE_PR_ALLOWED_AUTHORS` で制限している。fork PR から任意コードが特権実行される典型的な穴を塞いである。
- ルール単位の緊急停止手段もある: `docs/runbooks/E07-rule-rollback.md` に `POST /admin/rules/{id}/disable` の手順(`packages/server/src/app-server.ts:392-509`)。
- **残るリスクは §必須-6 の「投稿量そのもの」だけ**で、コストではなく DB と審査工数。

### 4-5. 管理 API の認証境界(観点7)— 問題なし

- `/admin/*` と `/api/admin/*` は Bearer トークン必須(`app-server.ts:410-413,565-568`)。比較は sha256 + `timingSafeEqual`(`app-server.ts:168-173`)でタイミング攻撃に配慮あり。
- トークン未設定なら 503 でエンドポイント自体が機能しない(`app-server.ts:406-409,561-564`)。`bin.ts:53-56` — 32 文字未満は起動時に拒否。
- 総当たりに対するレート制限は無いが、32 文字以上のランダム値が前提(`docs/runbooks/e6-local-screening.md:7`)なので実用上の問題は無い。

### 4-6. 静的配信のパストラバーサル(観点2/8)— 問題なし

- `packages/server/src/app-server.ts:134-142` — `resolve(root, relative)` の結果が root 配下でなければ `index.html` にフォールバックする。`..` を含むパスで dist 外へ抜けられない。
- メソッド制限あり(`app-server.ts:119-123`、GET/HEAD 以外は 405)。`decodeURIComponent` の失敗は 400(`app-server.ts:129-132`)。

### 4-7. OGP 画像そのものと招待導線(観点8)— 画像・導線ともに問題なし(配信ヘッダのみ §必須-1)

- `packages/web/public/ogp.png` / `packages/web/dist/ogp.png` ともに実在し、**1200x630 の PNG**(`sharp` の metadata で確認)。`scripts/generate-design-images.mjs:33-34` の定義値と一致。`summary_large_image` の推奨サイズを満たす。
- `Dockerfile:47` — `COPY --from=builder /app/packages/web/dist packages/web/dist` で本番イメージに入る。`fly.toml:15` — `WEB_DIST_DIR = "/app/packages/web/dist"` と一致。**ファイルが本番に無いという心配は不要**。
- 招待リンクの導線: `packages/web/src/routing.ts:34-43` — 招待 URL は `https://.../?room=NNNNN`。`inviteCodeFromSearch` は 5 桁数字のみ受理。
- `packages/web/src/App.tsx:613-619` — 起動時に `?room=` を読んで参加シートを自動で開く。`App.tsx:1543` — 招待コードがフォームに事前入力される。`App.tsx:1553-1567` — 名前を入れて join。**「リンクを踏む → 名前を入れる → 入室」の 1 ステップで、ログイン不要**(`packages/web/src/components/InviteCode.tsx:52` の文言「このリンクを送ると、ログインしていない友だちも参加できます」と実装が一致)。
- QR も同じ URL を埋め込む(`InviteCode.tsx:61-74`、`qrcode.react`)。
- **初見ユーザーの障害物**: SPA なので `/?room=NNNNN` は `index.html` にフォールバックし(`app-server.ts:134-142`)、クエリは保持される。導線としての問題は見つからなかった。**唯一の実害リスクは §必須-2 の join レート制限**。

### 4-8. ルール図鑑 API のレート制限(観点2)— 問題なし

- `packages/server/src/app-server.ts:239-244` — 120回/60秒。`app-server.ts:371-379` — 超過で 429。キーは `clientIp()` = `fly-client-ip` を読む正しい実装(`app-server.ts:175-180`)。**Socket 側(§必須-2)と違ってこちらは正しい**。

### 4-9. `/health` の設計(観点3)— 問題なし

- `packages/server/src/app-server.ts:905-941` — DB 疎通を実際に確認し(`bin.ts:134` の `persistence.checkHealth()`)、失敗時のみ 503。drain 中は 200 + `status:"draining"`。外形監視の対象として素直。`fly.toml:26-31` で 15 秒間隔・タイムアウト 5 秒・grace 15 秒。

### 4-10. 構造化ログ(観点3)— 実装は十分、届ける先が無いだけ

- `packages/server/src/bin.ts:27-39` — JSON 1 行ログ(timestamp / level / event / fields)。
- 記録される主要イベント: `server_listening`(:200)、`server_drain_started`/`completed`/`failed`(:206,211,214)、`uncaught_exception`(:219-223)、`socket_internal_error`(:187)、`ai_fallback`(:191)、`rule_auto_disabled`(:78)、`rule_load_failure`(:84)、`rule_released`(:91)、`google_auth_provider_unavailable`(:70)。読み方は `docs/runbooks/E13-production.md:117-129`。
- **ログの中身は必要十分**。足りないのは §必須-5 の「人に届ける経路」だけ。

---

## 5. 明日の実行順(タイムライン案)

| 時刻 | 作業 | 所要 | 参照 |
|---|---|---|---|
| 前夜 | 必須-1/2/6 のコード修正 + `pnpm verify` | 1.5〜2h | §必須-1,2,6 |
| 前夜 | 必須-4 の Google Console 公開ステータス確認(**privacy policy URL の要否もここで判定**) | 20分 | §必須-4 |
| 前夜(条件付き) | 上で URL が必須と判明した場合のみ、推奨-2 の About ページを書く | 1〜2h | §推奨-2 |
| 07:55 | `fly releases --image` で戻り先タグを控える | 5分 | §4-1 |
| 08:00 | **必須-3 のバックアップ**(人がいないうちに。検証まで済ませる) | 40分 | §必須-3 |
| 08:40 | 修正を main へ push → CD 完了 → drain 確認 | 40分 | §必須-1,2,6,7 |
| 09:20 | 必須-1 の curl 確認 + X 下書きでカード目視 | 15分 | §必須-1 |
| 09:35 | 必須-4 の実 Google ログイン受け入れ(別アカウント)+ 推奨-5 の実機一周 | 45分 | §必須-4, §推奨-5 |
| 10:20 | 必須-5 の外形監視を登録 | 15分 | §必須-5 |
| 10:35 | 推奨-3 の基準値スナップショット | 5分 | §推奨-3 |
| 10:40 | **デプロイフリーズ開始** | — | §必須-7 |
| 12:00 | 告知 | — | — |
| 12:00〜14:00 | `fly logs` を張り付き。`uncaught_exception` / `ai_fallback` / 入室できない報告を見る | — | §必須-5 |

余力があれば推奨-1(キャッシュ)を 08:40 のデプロイに同梱。推奨-5 は必須-4 と同じセッションで済ませる。

**08:40 枠の見積り根拠**(`gh run list` の実測、2026-07-31 の 8 回分):CI は push から完了まで **2分40秒〜3分**、Deploy production はその後 **1分20秒〜2分05秒**。したがって **push → 本番反映は実測で約 4分30秒〜5分**。ワークフロー定義上の上限(CI のジョブタイムアウト、deploy の `--wait-timeout 10m` / `timeout-minutes: 15`)はいずれも実測とかけ離れており、上限に張り付いた実績は無い。40 分枠にしているのは CD 自体が長いからではなく、**(a) CI が落ちて 1 回やり直す余地(+5分)と、(b) `verify-production-set.mjs` で 3 戦セットを実経路で完走させる drain 確認**(`docs/runbooks/E13-production.md:141-150`)に時間がかかるため。CD だけなら 10 分で足りる。

**間に合わない場合に落とす順**: 推奨-1 → 推奨-5 の一部(実機セーフエリアのみ残す) → 推奨-2(**ただし §必須-4 手順 1 で Google の Branding が privacy policy URL を必須にしていた場合、推奨-2 は必須へ昇格しており落とせない**) → 必須-6(ただしその場合は `ops funnel` を当日 2 時間おきに見る運用で代替) → 必須-4 の §5/§6 の細かい受け入れ(§4 の 1〜5 だけは通す)。**必須-1、必須-2、必須-3、必須-5、必須-7 は落とさない**。
