# E07 ルール単位ロールバック

対象ルールだけを止める。最初にDBフラグで即時停止し、コードを残さないと判断した場合だけrevert PRへ進む。

## 1. 即時無効化

1. 対象IDと現在状態を確認する。

   ```sh
   curl -fsS -H "Authorization: Bearer $ADMIN_PIPELINE_TOKEN" \
     "$APP_URL/admin/rules/r0042"
   ```

2. `rollback`理由で無効化する。

   ```sh
   curl -fsS -X POST \
     -H "Authorization: Bearer $ADMIN_PIPELINE_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"reason":"rollback"}' \
     "$APP_URL/admin/rules/r0042/disable"
   ```

3. 応答が`updated`または同じ状態の`unchanged`で、`status=disabled`、`disabledReason=rollback`であることを確認する。変更前から進行中のセットは固定済みチェーンで続行し、次に開始するセットから対象ルールだけが外れる。
4. 対象コードが全ルールCIを落とす場合だけ、人手PRで`packages/rules/rules-exclude.json`へ対象IDを一時追加する。対象以外を変更しない。

誤操作で、コードと契約が正常なルールを復帰する場合:

```sh
curl -fsS -X POST \
  -H "Authorization: Bearer $ADMIN_PIPELINE_TOKEN" \
  "$APP_URL/admin/rules/r0042/enable"
```

`removed`、コード欠落、契約不一致、meta不一致は復帰を拒否する。

## 2. 恒久revert

1. `rule_versions.merge_sha`とPR番号をDBまたは管理情報から特定する。
2. 通常ブランチ`revert/r0042-slug`を最新mainから作る。ブランチ末尾は対象ディレクトリ名と完全一致させ、`rule/**`は使わない。
3. 対象がmerge commitなら`git revert -m 1 {merge_sha}`、単一parentのmerge方式なら`git revert {merge_sha}`を実行する。
4. 差分を次に限定する。

   - `packages/rules/r0042-*/SPEC.json`
   - `packages/rules/r0042-*/meta.json`
   - `packages/rules/r0042-*/rule.ts`
   - `packages/rules/r0042-*/rule.test.ts`
   - 一時excludeを追加していた場合だけ、`rules-exclude.json`から対象IDを削除

5. 通常PRを作り、全CIと開発者レビューを通してマージする。依存する他ルールの修正が必要なら、revert差分へ混ぜず先行PRで依存を解消する。
6. 通常デプロイ後、起動時同期がコード欠落を検出する。同期は対象versionを`is_current=0`、`reverted_at=<検出時刻>`とし、`rules`行は`status=disabled / disabled_reason=rollback`のまま保持する。

## 3. 事後確認

```sql
SELECT id, status, disabled_reason, updated_at
FROM rules
WHERE id = 'r0042';

SELECT version, merge_sha, is_current, reverted_at
FROM rule_versions
WHERE rule_id = 'r0042'
ORDER BY version DESC;
```

次を全て確認する。

- 対象だけが`disabled`で、他のactiveルールは変化していない
- 対象versionに`reverted_at`があり、currentではない
- 対象ディレクトリがmainに存在しない
- `rules-exclude.json`に対象IDが残っていない
- 基本ルールのみのsimulationと全体CIがgreen

問題が残る場合は対象を再enableせず、incidentとCIログを添えて修正PRへ切り替える。
