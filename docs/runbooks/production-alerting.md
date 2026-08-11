# 本番アラート運用

本番停止と CI・デプロイ失敗を、Discord の通知専用チャンネルへ集約する。

## 1. Discord

1. 通知専用チャンネルで `チャンネルの設定` → `連携サービス` → `ウェブフック` を開く。
2. `Daifugo Alerts` という Incoming Webhook を作り、Webhook URL をコピーする。
3. GitHub の `Settings` → `Secrets and variables` → `Actions` で、Repository secret `DISCORD_WEBHOOK_URL` に URL を保存する。
4. Discord では通知専用チャンネルだけ `すべてのメッセージ` を通知する。

Webhook URL は、そのチャンネルへ投稿できる秘密値として扱う。リポジトリ、Issue、チャット、ログへ記録しない。

`.github/workflows/ci.yml` は CI 失敗、`.github/workflows/deploy.yml` は本番デプロイ失敗をこの Webhook へ送る。Secret が未設定なら通知ステップは安全にスキップする。

## 2. 外形監視

Better Stack Uptime の無料枠で、次の HTTP monitor を 1 本作る。

- 名前: `Daifugo Together production health`
- URL: `https://daifugo-together.fly.dev/health`
- Method: `GET`
- Check frequency: 1〜3分
- Required keyword: `"db":"ok"`
- Recovery period: 180秒
- 通知: メールまたはモバイル push を最低1つ有効にする

Discord にも障害開始を送る場合は、Better Stack の `Integrations` → `Exporting data` → `Outgoing webhooks` で Incident webhook を追加する。

- URL: Discord で作った Webhook URL
- Trigger: incident started のみ
- Method: `POST`
- Header: `Content-Type: application/json`
- Body template:

```json
{
  "content": "🚨 **Production health check failed**\n**$NAME**\n$CAUSE\n$URL"
}
```

保存後にテスト通知を送り、Discord に表示されることを確認する。Better Stack 側の外形監視は GitHub Actions とは独立して動くため、アプリ停止と CI 失敗を同じチャンネルで確認できる。

## 3. 告知直後

告知後 1〜2 時間は Discord 通知に加えて `fly logs --app daifugo-together` を開き、`uncaught_exception`、`socket_internal_error`、`rule_auto_disabled`、`rule_load_failure`、`ai_fallback`、`ai_turn_summary` を確認する。`ai_turn_summary` では1分ごとのAI手番数、fallback内訳、world数・候補評価数・模擬手数、queue/setup/search/wall time、worker再利用数のP95と最大値を見る。
