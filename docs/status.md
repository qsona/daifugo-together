# 現在地(status)

進行中の実装・外部ゲート・人間判断待ち・小粒の残件だけを持つ薄いファイルです。**完了した項目は行ごと消します**(履歴として残しません)。
詳細な経緯は各 PRD の実装記録と [archive/](archive/) を参照してください。

## 進行中

- **CX-02 job 32「強化Jバック」** — `cx01-v20` で再判定・SPEC承認済み。自然なJを
  n枚出した後の次n手番だけ強さ順を反転し、パス・自動スキップも1手番に数える実装待ち。
- **CX-02 job 27「2択クイズ」** — rule PR #41 の `diff-guard` / `quality` / `rule-tests` は成功したが、
  `simulation` が20分上限でcancelされた。原因は `SimulationApi` が二択クイズの200ms tickを
  MCTS内で逐次再生していたこと。phase境界へのfast-forwardをroot `main`で実装・検証中で、
  mainのdeploy後にjob 27を行政的rebuildして同じrule実装を再submitする。
- **通知設定画面 × 認証の残件 J9-4 / J9-5 / J9-7(+ J9-3)** — 端末の通知状態を読まない / 購読・解除がブラウザとサーバーでずれる / OS 拒否後の回復導線なし / 失敗文言が 1 種。着手前に発注書 §5 の不変条件(user activation の維持、ガードのない入口を足すと J9-2 が再発)を読むこと。出典: [archive/workorders/2026-08-02-auth-account-ui-5-push-crossing-followup.md](archive/workorders/2026-08-02-auth-account-ui-5-push-crossing-followup.md)
- **TU-03 の観察テスト(E14 §4)** — 実装側は完了、開発者による観察テストの実施記録なし。E14-P3-2(AI 間合い 3000〜4500ms)の値確定がこれ待ち。出典: [epics/E14-tutorial.md](epics/E14-tutorial.md) §4
- **CX-01 の実 app-server 評価(評価セット 23 件)** — 評価 CLI と Fake テストは完成。実モデルでの評価セット完走の記録がない(稼働実績は代替にならない)。P12「強化Jバック」の単独評価は2026-08-31に一致確認済み。出典: [archive/impl-progress.md](archive/impl-progress.md)「E7 CX-01」節
- **CX-02 の初回実ジョブ(scaffold 後に停止)の始末** — 以後のパイプラインは健全に一周している。当該 attempt が resume 済みか打ち切りかは本番 SQLite の `pipeline_jobs` を見ないと判らない。出典: [product-backlog.md](product-backlog.md) CX-02
- **`/about`(プライバシー・保存データの説明)が未実装** — サーバーに `about` ルートなし。Google Console が Privacy policy URL を必須にしている場合のみ必須へ昇格。出典: [release-checklist-2026-08-02.md](release-checklist-2026-08-02.md) §0 #9
- **SQLite バックアップの定期化(優先度低)** — スクリプトと runbook は揃い、リリース前後は実行済み。`schedule:` トリガのワークフローが 0 件で自動化されていない。出典: [decision-log.md](decision-log.md) C-9 / [runbooks/production-backup.md](runbooks/production-backup.md)

## 外部ゲート・受入待ち

- **E16/E17 の実 Push 受入(デスクトップ / iOS)** — VAPID 本番設定(WP-T2)は完了。実 Push・夜間抑止・ログアウト解除の受入記録が runbook 指定先にない。出典: [runbooks/E16-E17-notifications.md](runbooks/E16-E17-notifications.md) §7 / [epics/E17-web-push.md](epics/E17-web-push.md) §7
- **E15 の実 Google 通し受入** — 本番 OAuth は稼働しているが、実セット完走後の登録導線・最終文言を一つずつ確認した記録がない。出典: [runbooks/E15-google-oauth.md](runbooks/E15-google-oauth.md) §7 / [production-e2e-test-plan-2026-08-02.md](production-e2e-test-plan-2026-08-02.md)
- **⚠ 上 2 件の前提: runbook の文言が G-26 改称前のまま** — [runbooks/E15-google-oauth.md](runbooks/E15-google-oauth.md) 内の旧語彙(「Googleでつなぐ」語族)全箇所と [runbooks/E16-E17-notifications.md](runbooks/E16-E17-notifications.md) L58。実装は「Googleでログイン」。**受入は「最終文言の確認」を含むため、runbook を先に直さないと実行できない**
- **CX-04 の revert リハーサル** — 即時 disable → 復帰 → 恒久 revert PR → CD → 起動時同期の一周が未実施(revert ブランチ・PR の痕跡なし)。出典: [runbooks/E07-rule-rollback.md](runbooks/E07-rule-rollback.md)
- **CX-04 の開発者通知経路** — `auto_incident` の自動 disable が診断ログ止まりで、監視済みアラート or 永続 outbox に未接続。既存の [runbooks/production-alerting.md](runbooks/production-alerting.md) は CI/CD 失敗と `/health` 外形監視のみが対象。出典: [archive/impl-progress.md](archive/impl-progress.md)「E7 CX-04」節(仮定 E7-CX04-P2-2 の完了レビュー変更)
- **実機のノッチ / セーフエリア確認** — ブラウザでは `env(safe-area-inset-*)` が 0 になるため実機必須。本番 URL 公開後は実施可能。出典: [epics/E04-design.md](epics/E04-design.md) §(d) / [release-checklist-2026-08-02.md](release-checklist-2026-08-02.md) §0 #11

## 人間判断待ち

- **決定台帳の未決・保留項目** — [decision-log.md](decision-log.md) の未決(B-2 / B-4 / B-5 / B-7 / C-11 / D-1〜D-5)と保留(B-6 / B-12 / C-8 / C-9 / C-12 / C-13)を参照。**台帳が正で、ここでは二重管理しない**。うち D-1〜D-3 は設計初期値のまま実装済みで正式承認待ち、B-7 は TS-03 実測で較正済みだが台帳が未更新
- **Epic 間連絡(decision-log E 節)の「未反映」15 件** — 大半は台帳側で追跡する。個別に注意が要るのは **E-14(ルール名 12 文字 vs C-3 の 40 文字。実装は 40 文字で確定済みで、裁定記録がないまま実装が先行)** と **E-13(DS-02 受け入れ条件 2 の最終クローズ。E1/E3 は完了済みなので逸脱チェック手順の再適用が宙に浮いている)**、**E-16(`playerRetired` の席バッジ・告知の設計)**
- **E4「詰まっている点」の残り 2 件** — 7 = 上記 E-13 と同一、11 = 実機のノッチ確認(外部ゲート節と同一項目)
- **AI 席の表示名プール差替え — 実施か受容かの裁定** — E4 のトーン確定(A-5、2026-07-26)が差替えのトリガーだったが、`reducer.ts` は今も `AIプレイヤーA/B…` のハードコード。以後の設計・実装文書は機械名を正として扱っており実質受容の公算が高いが、裁定記録がない。出典: [archive/impl-progress.md](archive/impl-progress.md) E3 の仮定・次工程表 / [epics/E03-multiplayer.md](epics/E03-multiplayer.md) §3.2
- **G-26 備考: 「サインアウト」を「ログアウト」に改めるか** — 未決。出典: [decision-log.md](decision-log.md) G-26
- **OP-01 の受け入れ条件改訂の正式化** — コードは非強制の読み取り専用なので裁定後の手戻りはない。D-5 と対。出典: [archive/impl-progress.md](archive/impl-progress.md)「E10 OP-01」節
- **E11 の `disabled` 表示** — E11 §3.2(g) が未決のまま、仮定 E11-P1-2 で図鑑・summary から除外中。台帳に項目がない
- **未裁定の仮定(E1・E2)** — E1 の仮定表の残り 5 行(`turnCount>1000`・KV クォータ、B-4 の追記ポート、draining 挙動、空 field への `moveCards` 棄却、`field.current` の discard 移送)と E2 の仮定表 5 行。B-2 / B-4 の未決に紐づく。出典: [archive/impl-progress.md](archive/impl-progress.md) E1・E2 の仮定表
- **未裁定の仮定(E7 パイプライン)** — CX04-P2-1(閾値 24 時間内 3 distinct set)・P2-3(起動時 revert 同期の根拠)、CX05-P1-1 / P1-3 / P1-4、CX06-P1-1 / P1-4(実装で決着済みだが裁定行がない)。いずれも実装は稼働中
- **AI02-P1-2(権威状態の worker 複製)は「暫定採用」のまま** — KV に公開/秘匿区分が入るまで置き換え待ち。出典: [archive/impl-progress.md](archive/impl-progress.md) AI-02 節
- **DS-02 の未裁定の仮定 12 / 13 / 14 / 16 / 18** — トークン検査の対象範囲、`c-input` の color-mix 置換、13/10/9px の非トークン化、カード選択表現、コンテンツ幅 480px。13・14 はカタログ側の修正提案が未処理(小粒の残件と対)
- **設計書の不整合(未更新のまま積まれている)** — E01 の 54 枚記述・BR-11 の旧記述と順位点 4-3-2-1(実装は 5-3-2-1・4 人固定)、`createSimulationApi` の読み替え、E02 §3.1(d)/§4.4/§6-5 の旧 worker 記述、E04 §2.1.1 / §1.3、E12 §4.1 の Node.js LTS 表記(実装・CI は Node 26 系)、`design-system.html` §5-4 のフォーカスリング規約違反

## 小粒の残件

- 匿名おためし提案枠の **375×812 実画面確認**(ローカル遮断で未実施。本番では確認可能。当該画面は稼働中)
- Push オプトイン簡素化の **実画面確認**(同上)
- `design-system.html` に残るカタログ側の規約違反・非トークン値(DS-02 仮定 13・14。実装側は修正済み)
- **Drizzle の `skipLibCheck` 解除** — 上流(Drizzle の `.d.ts` × TypeScript)の不整合が解けたら解除。依存を上げるたびに再評価する申し送り
