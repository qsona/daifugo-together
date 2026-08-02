# 本番通しテスト計画(リリース前受け入れ・2026-08-02)

- 対象: `daifugo-together`(https://daifugo-together.fly.dev/)
- 位置づけ: [release-checklist-2026-08-02.md](release-checklist-2026-08-02.md)(2026-08-01 監査)の姉妹文書。チェックリストのうち「本番でしか確定できない確認」を、認証・アカウント UI(work order 0〜4)実装後の最終状態に合わせて 1 本の実行計画に統合した
- 前提とする実測(2026-08-02 調査時点):
  - デプロイは **`release` ブランチへの push** で走る(`.github/workflows/deploy.yml`。チェックリスト必須-7 の「main へ push すると即本番」は**旧記述**)。`origin/release` は `795a1b4` で止まっており、main の feature 6 件(`5f99276` 5枚組/階段修正、`2b820ca` 退出導線、`8be7d2c` スート4色、`b1bbd2f` A2HS、`817409b` Push簡素化、`7feb264` 共有/支援リンク)は**本番未反映**
  - チェックリスト必須-1/2/6 のコード修正・バックアップスクリプト化は `a995ba4` で実装済み。本番の `/ogp.png` は既に `image/png` を返す
  - Google OAuth の secrets、VAPID 鍵は本番設定済み(`/api/push/config` が `available: true`)
  - 前日バックアップ `data/backups/daifugo-production-2026-08-01-prerelease.sqlite` は取得済み

## 0. 開始条件(これが揃うまで §2 以降に進まない)

| # | 条件 | 確認方法 |
|---|---|---|
| 0-1 | 認証・アカウント UI(work order 1/5〜4/5)が main にマージ済み | `git log origin/main` に該当コミット。`CI=true pnpm verify` 成功 |
| 0-2 | E16/E17 受入 runbook の陳腐化修正 | **済(2026-08-02)**。§5 手順 3 を端末単位オプトイン(G-24 後)の記述へ書き替えた |
| 0-2b | E15 受入 runbook の読み替え準備 | **済(2026-08-02)**。§4〜§6 を現行 UI(アカウント行 / DLG-1 / F-2 / 現行文言)へ更新した |
| 0-3 | リリース判断が要る残件の裁定(下表) | 本計画の実施可否には影響しないが、告知前に決める |

**告知前に裁定が要る残件**(通しテストと並行して決める):

| 論点 | 出典 | 選択肢 |
|---|---|---|
| main の branch protection / `rule/**` ruleset が未登録(PUBLIC リポジトリで E7 入口条件 G-4 ④が未達) | `docs/impl-progress.md:917-918`、実測(`gh api` で Branch not protected / rulesets 空) | 告知前に required checks(diff-guard / quality / rule-tests / simulation)を登録するのが安全 |
| DP-03「落ちたことは通知されないことを許容」の記述が stale(CI/CD には既に Discord webhook 送出が実装済みで、runbook も確立済み) | `docs/product-backlog.md:286`、`deploy.yml:51-63` | 外形監視 + webhook 登録は §6-4 で**無条件実施**。残件は backlog 側の記述更新のみ |
| C-14: 全ルール同時有効の all-rules simulation をリリースゲートにする決定が実装待ち | `docs/decision-log.md:64` | 告知前に 1 回手動実行するか、初週送りを明示する(§7-2) |
| /about(プライバシー・保存データ説明)が未実装(連絡先リンクのみ実装済み) | チェックリスト推奨-2 | Google Console の Branding が Privacy policy URL を必須にしている場合のみ必須昇格(§2-1 で判定) |

## 1. 道具と役割

- **実行者**: 開発者 1 名。iPhone 実機(iOS 16.4+)+ PC(Chrome / Firefox)+ 可能なら家族等の別 Google アカウント
- **回線 2 系統**: 自宅 Wi-Fi とスマホ LTE(招待レート制限と「別人」再現に使う)
- **本番 DB の読み取り**: `fly ssh console --app daifugo-together -C "node --input-type=module" < script.mjs` 形式(実績のある唯一の経路。`docs/runbooks/production-backup.md` / チェックリスト必須-3 の注意どおり)
- **developer アカウント**: 本番に登録済み扱いの developer ユーザーがある(プロジェクトメモ)。**受け入れは原則「新規の実ユーザー」として行い**、developer トークンは API 検証・後片付けにだけ使う
- **注意**: 本番で作ったテストデータ(部屋・提案)は基準値スナップショット(§6-1)を**取った後**に作るか、件数メモに含める

## 2. フェーズ A: デプロイ前夜(Google Console・最終ビルド)

1. **2-1. Google Auth Platform 確認**(チェックリスト必須-4 手順 1〜3): Publishing status が In production か。Branding が Privacy policy URL を必須にしていないか(必須なら /about を先に実装)。redirect URI と `fly secrets list` の確認
2. **2-2. ローカル最終検証**: main で `CI=true pnpm verify`。`node scripts/verify-production-set.mjs` の実行準備
3. **2-3. 戻り先の確保**: `fly releases --app daifugo-together --image` で現行イメージタグを控える(ロールバック先。`docs/runbooks/E13-production.md` §ロールバック)

## 3. フェーズ B: 昇格デプロイとインフラ疎通(朝・人が少ない時間帯)

1. **3-1. 当日バックアップ**: [production-backup.md](runbooks/production-backup.md) の手順で再取得し、integrity + 4 テーブル件数の検証まで通す。`fly volumes snapshots create` も実行
2. **3-2. release 昇格**: main を `release` へ fast-forward push(これが本番デプロイの引き金。以後、告知当日夜まで release へ push しない = デプロイフリーズ)
3. **3-3. drain 確認**: **CI の成功を確認してから**(push から本番デプロイ開始まで実測約 3 分。早く始めるとデプロイ前にセットが終わる)別端末で `node scripts/verify-production-set.mjs https://daifugo-together.fly.dev` を走らせ、デプロイをまたいで対局が完走することを確認(`docs/runbooks/E13-production.md:141-150`)
4. **3-4. 疎通 curl 一式**:
   ```sh
   curl -fsS https://daifugo-together.fly.dev/health
   curl -sI https://daifugo-together.fly.dev/ogp.png | grep -i content-type   # image/png
   curl -fsS https://daifugo-together.fly.dev/api/push/config                 # available: true
   curl -fsSI https://daifugo-together.fly.dev/manifest.webmanifest
   curl -fsSI https://daifugo-together.fly.dev/service-worker.js
   ```
5. **3-5. 稼働イメージの確認**: `fly logs` に `google_auth_provider_unavailable` / `rule_load_failure` が出ていないこと。`GET /api/rules` が active 10 件を返すこと
6. **3-6. 起動時 revert 同期の実確認**: 本番 `bin.ts` が静的 registry と接続され起動時同期を行うか(`docs/impl-progress.md:994` の記述が stale か)をログで確認し、impl-progress を実態に合わせる

## 4. フェーズ C: プレイ通し(スマホ実機・匿名)

新しく入って来る人の姿そのままで通す。**iPhone 実機・Safari・匿名**で:

1. **4-1. 初見一周**: タイトル → メニュー → あそぶ → きほん(1人練習)1 戦。チュートリアルガイド 5 cue・dim 表示・タイマーなし・AI の間合いを確認
2. **4-2. みんなのルール 3 戦セット完走**: 途中で「やめる」導線(`2b820ca`)、スートの図形 4 色(`8be7d2c`)、5 枚以上の組・階段が出せること(`5f99276`)、カットイン演出、継続状態表示
3. **4-3. セーフエリア実機確認**: ノッチ / ホームインジケータにボタン・手札が隠れないこと(`docs/impl-progress.md:1157`。ブラウザでは原理的に検証不能、実機必須)。提案フォームの横スクロールなし・キーボード表示中に送信ボタンが押せること
4. **4-4. マルチと招待**: PC 側で部屋を作り、iPhone(LTE)で招待リンク → 名前入力 → 入室。QR でも 1 回。OS 共有シート(`navigator.share`)の文面確認。2 人で 1 戦し、片方切断 → 復帰も見る
5. **4-5. join レート制限の分離確認**(チェックリスト必須-2 の本番確認): Wi-Fi 側で 11 回 join を試み、LTE 側が弾かれないこと

## 5. フェーズ D: 認証・提案・通知・Push の受け入れ

既存 runbook を正とし、今回実装した認証 UI の受け入れを重ねる:

1. **5-1. E15 受入**: [E15-google-oauth.md](runbooks/E15-google-oauth.md) §4(AU-01/02 の 8 手順: POST callback、URL に code/token が出ない、`__Host-daifugo-auth-flow` の消滅、ログアウト、別ブラウザでの復帰、拒否時の匿名復帰)→ §5(AU-03 を 375×812。**手順 3-4 は §0-2b の読み替えで、リザルト内導線ではなく退室後の誘いを確認する**)→ §6 文言(同じく §0-2b のとおり最終語彙を正とする)
2. **5-2. 認証 UI(work order 0〜4)の本番受け入れ**: アカウント行の状態表示、アカウント画面、DLG-1〜3(つなぐ / 別のアカウントにする / サインアウト)、RES-1〜3(成功 / 失敗がアプリ内で完結し生 JSON に落ちない)、なまえ変更(C-1〜3)、提案画面と退室後の誘いから DLG-1 へ届くこと。各 work order の受け入れ条件を 375×812 実画面で
3. **5-3. 匿名おためし提案枠**: 匿名で提案 1 件送信 → 2 件目が枠 403 パネル → 登録導線(`docs/impl-progress.md:6` の実画面未確認の消化)
4. **5-4. 通知センター**: [E16-E17-notifications.md](runbooks/E16-E17-notifications.md) §4 の 5 手順。状態遷移はローカル判定ツール(`e6-local-screening.md`)で自分の提案を進めて発生させる
5. **5-5. Push(デスクトップ)**: 同 §5(修正済み手順で)。提案送信前に許諾が出ない → オプトインでのみ許諾 → 実通知受信 → 深いリンクと `src`/`nid` 除去 → ログアウト解除。夜間(21:00〜7:00 JST)に当たる場合は抑止どおり届かないことを確認し、翌 7:00 以降の送出を見る
6. **5-6. Push(iOS 実機・A2HS)**: Safari タブで共有ボタン付き追加手順が出る → ホーム画面追加 → **ログイン状態が引き継がれないことの実確認**(案内文言の正否を確定し、違えば E17 §2.2 を実態へ合わせる)→ 再ログイン → 提案 → 購読 → 実受信。`standalone_seen_at` の増加も SQL で確認。LINE / X のアプリ内ブラウザで「Safariで開く」案内
7. **5-7. シェア・支援導線**: セット結果の順位別 X シェア文面、図鑑シェア、メニューの支援リンク(きほんでは支援非表示)。**X の下書きに本番 URL を貼り OGP カードを目視**(告知数時間前までに)

## 6. フェーズ E: 運用準備(告知直前)

1. **6-1. 基準値スナップショット**: §3-1 のバックアップ検証件数を転記 + `ops funnel` / `ops metrics`(チェックリスト推奨-3。テストで作ったデータ件数をメモに添える)
2. **6-2. E16/E17 計測 SQL を 1 回実行**(同 runbook §6)して動くことを確認
3. **6-3. 受け入れ記録**: 実施結果を `docs/impl-progress.md` へ追記(E15 は「残る開発者確認」節が無いので新設)。secret・トークン類は書かない
4. **6-4. アラート(無条件実施)**: 外形監視(`/health`、keyword `"db":"ok"`)の登録と、GitHub secret `DISCORD_WEBHOOK_URL` の登録([production-alerting.md](runbooks/production-alerting.md) §1-§2。チェックリスト必須-5 相当であり落とさない)
5. **6-5. フリーズ**: 以後 release へ push しない。`fly logs` を開いたままにし、告知後 1〜2 時間は `uncaught_exception` / `socket_internal_error` / `ai_fallback` / `rule_auto_disabled` を監視

## 7. リリース後・初週に回すもの(このテストでは実施しない)

1. E07 ルール緊急停止 runbook のリハーサル(disable → 復帰 → revert PR → CD)— ルール 10 本稼働中の今、未実証
2. C-14 の all-rules simulation 常設化(§0-3 で初週送りにした場合)
3. TU-03 観察テスト(未経験者 1 セット完走の教育効果)
4. Volume 使用量の毎日確認、AI fallback 率、`users` 増加の観測(チェックリスト初週-1〜3)
5. 静的アセットの長期キャッシュ・圧縮、セキュリティヘッダ(推奨-1 / 初週-5)

## 8. 中断基準

- §3 で drain 確認が通らない / `/health` が落ちる → §2-3 のイメージへロールバックし、原因を潰すまで告知しない
- §5-1 で実 Google ログインが通らない → チェックリスト必須-4 のフォールバック(匿名のままでも遊べる)を採るか告知延期かをその場で判断
- それ以外の単発の表示崩れは記録して続行し、告知可否は Critical(進行不能・データ破壊・認証不能)の有無で決める
- **時間切れの扱い**: 開始条件 0-1(認証 UI のマージ)が遅れてフェーズ C〜D を告知予定時刻までに消化できない場合は、**告知時刻を後ろ倒しにする**(中途半端な状態で告知しない。チェックリスト必須-7 の方針と同じ)。なお Push の夜間抑止確認(§5-5 後半)は昼実施では原理的に当日完了しない項目なので、残っていても告知可否には影響させない
