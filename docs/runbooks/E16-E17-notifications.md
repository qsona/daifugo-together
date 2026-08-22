# E16/E17 通知・Web Push 受入 runbook

E16 通知センターと E17 Web Push を本番で有効化し、NC-01〜03 / WP-01〜03 を受け入れる手順。Push を設定しない環境でも通知センターは動作し、`GET /api/push/config` は `available: false` を返す。

## 1. VAPID 鍵を生成する

鍵ペアは本番用に 1 回だけ生成し、秘密鍵をリポジトリ、Issue、Slack、シェル履歴へ残さない。

```sh
pnpm --filter @daifugo/server exec web-push generate-vapid-keys --json
```

出力された `publicKey` / `privateKey` を安全な保管先へ移す。`VAPID_SUBJECT` は本番 origin `https://daifugo-together.fly.dev` を使う。

## 2. Fly secrets を stage する

```sh
read "VAPID_PUBLIC_KEY_VALUE?VAPID public key: "
read -s "VAPID_PRIVATE_KEY_VALUE?VAPID private key: "
printf '\n'
printf 'VAPID_PUBLIC_KEY=%s\nVAPID_PRIVATE_KEY=%s\nVAPID_SUBJECT=%s\n' \
  "$VAPID_PUBLIC_KEY_VALUE" "$VAPID_PRIVATE_KEY_VALUE" \
  'https://daifugo-together.fly.dev' \
  | fly secrets import --app daifugo-together --stage
unset VAPID_PUBLIC_KEY_VALUE VAPID_PRIVATE_KEY_VALUE
fly secrets list --app daifugo-together
```

`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` の 3 名が表示されることだけを確認する。値は記録しない。

## 3. デプロイ後の基盤を確認する

```sh
curl -fsS https://daifugo-together.fly.dev/health
curl -fsS https://daifugo-together.fly.dev/api/push/config
curl -fsSI https://daifugo-together.fly.dev/manifest.webmanifest
curl -fsSI https://daifugo-together.fly.dev/service-worker.js
```

- Push config が `available: true` で、公開鍵が返る。
- manifest は `application/manifest+json`、Service Worker は JavaScript として配信される。
- DevTools の Application → Service Workers で `/service-worker.js` が activated になる。Cache Storage にアプリ本体のキャッシュを作らない。

## 4. E16 通知センターを 375×812 で受け入れる

1. DevTools の viewport を 375×812 にする。
2. メニュー、提案、マイ提案、ルール図鑑のベルを開く。待機・対局・リザルトにベルが出ないことも確認する。
3. 通知が無いときは空状態、あるときは新しい順、未読ドット、相対時刻、99+上限のバッジを確認する。横スクロールがないことを確認する。
4. 通知を押すとマイ提案またはルール図鑑へ移動し、バッジが減る。「すべて既読」で 0 になる。
5. 接続中に対象提案を状態遷移させ、再読み込みなしでバッジが増えることを確認する。

## 5. E17 のオプトインと実通知を受け入れる

### デスクトップ Chrome / Firefox

1. 登録済みユーザーで提案を送信する。それ以前にブラウザの通知許可が出ないことを確認する。
2. 送信成功後の「結果が出たら知らせる？」で「通知を受け取る」を押したときだけ、ブラウザ許諾が出ることを確認する。
3. 通知設定は端末単位のオプトインだけであること(種別ごとのトグルは無い。G-24で撤去済み)を前提に、「この端末で通知を受け取る」での購読開始、「この端末への通知を止める」での解除、未登録時の「Push通知を受け取るには、Googleでつないでください。」の認証導線を確認する。
4. 7:00〜20:59 JST に対象通知を発生させ、OS 通知がセンターと同じ文面で届くことを確認する。タップで該当画面が開き、URL の `src` / `nid` が記録後に取り除かれる。
5. ログアウト後、その端末へ旧ユーザーの通知が届かないことを確認する。

### iPhone / iPad

iOS/iPadOS 16.4 以降を使う。Safari の共有メニューからホーム画面に追加し、追加したアプリから上記手順を行う。Safari タブのままでは「ホーム画面に追加」案内になり、ブラウザ許諾を直接出さないことを確認する。

追加の確認項目(2026-08-02 の A2HS 促進。E17 §2.2):

1. Safari タブで提案を送信すると、「非対応」ではなく共有ボタンの図つきの追加手順が出る。通知設定からも同じ手順にたどれる。
2. **ホーム画面に追加したアプリを開いたとき、Safari のログイン状態が引き継がれず匿名になる**ことを実機で確かめる(案内の「もう一度 Google でログイン」の記述が実態と合っているか)。挙動が違えば E17 §2.2 の記述を実機結果へ合わせる。
3. 追加後に再ログインして提案 → 購読まで通せることを確認する。`SELECT COUNT(*) FROM users WHERE standalone_seen_at IS NOT NULL;` が増えることも合わせて見る。
4. LINE や X のアプリ内ブラウザで開くと、「Safari で開く」案内とリンクのコピーが出る。

## 6. 計測 SQL

本番 DB は `docs/runbooks/E13-production.md` の手順で readonly 接続する。以下は SQLite で実行する。日付は JST にそろえる。

種別・流入元・日別の開封数:

```sql
SELECT date(opened_at / 1000, 'unixepoch', '+9 hours') AS day_jst,
       type,
       opened_via,
       COUNT(*) AS opened
FROM notifications
WHERE opened_at IS NOT NULL
GROUP BY day_jst, type, opened_via
ORDER BY day_jst DESC, type, opened_via;
```

7 日以上未読の `proposal_released` を持つユーザー数と、同通知を受けた全ユーザーに対する割合:

```sql
WITH released_users AS (
  SELECT DISTINCT user_id FROM notifications WHERE type = 'proposal_released'
), stale_users AS (
  SELECT DISTINCT user_id
  FROM notifications
  WHERE type = 'proposal_released'
    AND read_at IS NULL
    AND created_at <= (unixepoch('now') * 1000 - 7 * 24 * 60 * 60 * 1000)
)
SELECT (SELECT COUNT(*) FROM stale_users) AS stale_users,
       (SELECT COUNT(*) FROM released_users) AS released_users,
       ROUND(
         1.0 * (SELECT COUNT(*) FROM stale_users)
         / NULLIF((SELECT COUNT(*) FROM released_users), 0),
         3
       ) AS stale_ratio;
```

Push 許諾中の登録ユーザー数と有効購読端末数:

```sql
SELECT COUNT(DISTINCT user_id) AS subscribed_users,
       COUNT(*) AS active_devices,
       SUM(last_sent_at IS NOT NULL) AS devices_ever_sent
FROM push_subscriptions
WHERE revoked_at IS NULL;
```

## 7. 完了記録

実施記録は本 runbook 末尾の「実施記録」節へ追記し(節がなければ作る)、`docs/status.md` の該当行(E16/E17 の実 Push 受入)を更新する(完了なら行を削除する)。追記する内容は、実施日、ブラウザ/OS、375×812 の結果、Push 受信・夜間抑止・ログアウト解除の結果。VAPID 鍵、endpoint、`user_token`、Google 識別子は記録しない。

## 8. 3ルールのバランス調整を配信する

この手順は `docs/specs/2026-08-17-rule-balance-adjustment.md` 専用です。ルール保守PRのマージ後、同じreleaseでラッキー7 v2、ボンバーマン v3、リアルボンバー v2を本番へ反映し、新しく開始したセットで3件とも動作確認してから実行します。確認前や、いずれかのルールをdisableした状態では配信しません。

本番DBへreadonly接続し、`@deployed_at_ms`を本番反映時刻のUnixミリ秒へ設定して次を確認します。

```sql
.parameter set @deployed_at_ms 0

SELECT r.id, r.status, r.disabled_reason, v.version, v.bundle_hash
FROM rules AS r
JOIN rule_versions AS v ON v.rule_id = r.id AND v.is_current = 1
WHERE r.id IN (
  'r0015-lucky-seven',
  'r0027-bomberman',
  'r0029-real-bomber'
)
ORDER BY r.id;

SELECT rule_id, type, set_id, detail, created_at
FROM rule_incidents
WHERE rule_id IN (
  'r0015-lucky-seven',
  'r0027-bomberman',
  'r0029-real-bomber'
)
  AND created_at >= @deployed_at_ms
ORDER BY created_at;

SELECT set_results.set_id,
       json_extract(fired.value, '$.count') AS real_bomber_count
FROM set_results, json_each(set_results.fired_rules) AS fired
WHERE set_results.created_at >= @deployed_at_ms
  AND json_extract(fired.value, '$.ruleId') = 'r0029-real-bomber'
ORDER BY set_results.created_at;
```

- 3件がすべて`active`で、versionが順に2、3、2、bundle hashがmanifestと一致する。
- 本番反映後の`rule_incidents`が0件である。
- 本番反映後に完了した各setの`real_bomber_count`が1以下である。

続いて7:00〜21:00 JSTに管理画面の「運営お知らせ」で次を入力します。`YYYY-MM-DD`は本番反映を確認したJST日付へ置き換えます。確認ダイアログでは、タイトル、本文、URLと、既存一覧に同じタイトルの配信がないことを再確認し、1回だけ送信します。

```text
タイトル: 3つのルールを調整しました
本文: 対局のテンポと、カードを捨てる効果の強さを整えるため、ラッキー7・ボンバーマン・リアルボンバーを調整しました。変更内容と理由を確認できます。
URL: /notifications/rule-balance-2026-08-17?released=YYYY-MM-DD
```

配信結果の`announcementId`を控え、readonly接続で次を実行します。ID以外の値は変更しません。

```sql
.parameter set @announcement_id 0

SELECT id, title, body, url, recipient_count, created_at
FROM announcements
WHERE id = @announcement_id;

WITH targets(proposal_id, rule_name) AS (
  VALUES
    ('01KZ0F33DXRJFH9QB47SSJEB3D', 'ラッキー7'),
    ('01KZ41N2RPV012951SHW3G99KD', 'ボンバーマン'),
    ('01KZ4JJ2KM3F2BTS237DPGM478', 'リアルボンバー')
)
SELECT targets.rule_name,
       proposals.author_id,
       notifications.id AS notification_id,
       notifications.created_at
FROM targets
JOIN proposals ON proposals.id = targets.proposal_id
LEFT JOIN notifications
  ON notifications.user_id = proposals.author_id
 AND notifications.type = 'announcement'
 AND notifications.dedupe_key = CAST(@announcement_id AS TEXT)
ORDER BY targets.rule_name;
```

お知らせ行のタイトル、本文、日付付きURLが入力値と一致し、提案者3人の`notification_id`がすべて非NULLであることを確認します。管理画面の一覧でも同じお知らせが1件だけであること、375×812で詳細ページを開けて「もどる」でお知らせBoxへ戻れることを確認し、実施日時・反映日・announcementId・recipient count・提案者3件の確認結果を本節へ追記します。
