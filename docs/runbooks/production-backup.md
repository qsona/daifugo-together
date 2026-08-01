# 本番 SQLite バックアップ

本番 DB は WAL モードで動くため、稼働中の `.sqlite` ファイルを直接コピーしない。SQLite の `VACUUM INTO` で整合したスナップショットを作り、手元へ転送してから `integrity_check` と主要テーブルの件数を検証する。

## 手元へのバックアップ

リポジトリルートで次を実行する。

```sh
node scripts/backup-production-sqlite.mjs data/backups/daifugo-production-YYYY-MM-DD.sqlite
```

スクリプトは次をすべて成功した場合だけ、指定したファイル名へ確定する。

1. Fly Machine 上で `/data/daifugo.sqlite` に `VACUUM INTO` を実行する。
2. 一時スナップショットを Base64 で転送し、転送前後のバイト数を照合する。
3. 手元で `PRAGMA integrity_check` が `ok` になることを確認する。
4. `users`、`proposals`、`set_results`、`replay_records`、`game_sets` の件数を出力する。

出力先の `data/` は `.gitignore` 対象である。バックアップにはユーザー情報と提案内容が含まれるため、Git へ追加せず、端末の暗号化ストレージ内で管理する。

## Fly Volume スナップショット

手元コピーの検証後、Fly 側にもスナップショットを作る。

```sh
fly volumes list --app daifugo-together
fly volumes snapshots list <VOLUME_ID>
fly volumes snapshots create <VOLUME_ID>
```

Volume スナップショットは Fly アカウント側の保険であり、手元コピーの代わりにはしない。
