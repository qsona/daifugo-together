# 実装進捗

## 現在

- **インゲーム演出改善 / プロセス2完了・独立再レビューPASS**: 出した札の一拍→カットイン→場を流す進行、部屋内ルール一覧・詳細モーダル、by-id 図鑑 API、自分の手番を示す手札トレイを実装。`PlayerRoomView` / `RuleRef` の契約変更なし
- **匿名おためし提案枠 / プロセス2完了・完了再レビューPASS**: 未登録ユーザーの同時進行1件枠、投稿ゲート、枠埋まり画面、設計差分を実装済み。初回独立完了レビューのImportant 1件(HTTP前段が冪等再送を遮断)を修正し、実HTTP回帰テストを追加。再レビューは `PASS / APPROVED`、`pnpm verify`成功。375×812実画面だけブラウザのlocalhost遮断で未確認
- **フェーズ 2 / E14 TU-01〜04 プロセス2完了・完了レビューPASS**: きほんの部屋、カード案内、初戦ガイド、初回卒業導線まで実装・自動テスト・375×812実画面確認を完了。独立完了レビューのImportant 1件を修正し、最新`main` (`1b15732`) 基点へ統合・全検証・独立再レビュー済み
- **フェーズ 1 完了(2026-07-27)**: TS-02・E1・E2・E3・E4 は main に統合済み、E13 は本番デプロイと動作検証(DP-01・DP-03)まで完了(`https://daifugo-together.fly.dev/`)。残りは DP-02 の仕上げ(GitHub Environment `production` + `FLY_API_TOKEN` 登録と初回 CD 実行確認)のみ
- **フェーズ 2 / E5 RP-01〜03 プロセス2完了**: E-18/C-3 の非同期受付に加え、マイ提案API・競合安全な未読/seen・画面7・メニューバッジを接続。独立完了レビューは **GO**、Critical / Important / Minorなし
- **C-5 追従完了**: E7 内包リトライの決定を反映し、`proposals.failed` を終端化。`failed` 遷移時に `attempt_count=1` を記録して同内容の再提案を即時解禁する
- **フェーズ 2 / E6 YC-01〜03 プロセス2完了**: E-18 の非同期構成、ローカル判定ツール、イエローカード表示・停止・救済まで実装済み。修正後 judge eval は Luna/Sol とも 40/40、平均 6.40秒 / 6.23秒のため既定を **GPT-5.6 Sol medium** とした。独立 GPT-5.6 Sol 完了レビューは要件適合 `PASS` / 品質 `APPROVED`
- **フェーズ 2 / E7 CX-01 プロセス2ほぼ完了**: 独立方向性レビュー `GO_WITH_FIXES` のImportant 4件と、初回完了レビューのImportant 2件を反映。完了再レビューはコード・自動テスト `PASS` / 品質 `APPROVED` / Critical・Importantなし。実app-server評価だけ明示許可待ち
- **フェーズ 2 / E7 CX-02 通常セッション方式へ更新**: 子`codex exec`を廃止し、`implement:prepare`→Codex App通常セッション自身による2ファイル実装→`implement:submit`へ分割。scaffold先行push、任意段階再開、全差分・履歴・静的制約・型・対象テストのsubmit再検証、1回retry、PR作成、失敗永続化を維持。初回実ジョブは旧CLI不整合でscaffold後に停止しており、同じattemptを新skillでresume可能
- **フェーズ 2 / E7 CX-03 プロセス2完了、外部受入ゲート待ち**: trusted diff-guard、untrusted quality/rule-tests/simulation、ローカルCI監視を実装。独立完了再レビューはコード・自動テスト `PASS` / 品質 `APPROVED` / Critical・Importantなし。実repositoryのbranch protection/ruleset登録はworkflowのmain反映後
- **フェーズ 2 / E7 CX-04 プロセス2コード完了**: 独立再レビューはコード・自動テスト範囲 `PASS` / 品質 `APPROVED` / Critical・Importantなし。実CD/revertリハーサル、通知経路、CX-05完全registry接続は外部・後続ゲート
- **フェーズ 2 / E2 AI-02 プロセス2コード完了**: workerへ権威runtime snapshotと実SHA-256検証済みbundleを渡し、E1 simulation generatorをworker AI 4席で駆動。独立完了再レビューは要件 `PASS` / 品質 `APPROVED` / Critical・Important・Minorなし
- **フェーズ 2 / E7 CX-05 プロセス2コード完了**: 第三操作、起動中registryのreadiness attestation、48時間リマインダーまで追加。独立完了再レビューはコード要件 `PASS` / 品質 `APPROVED` / Critical・Importantなし。実GitHub/CD/本番の3操作リハーサルとRP-03 UIは外部・後続ゲート
- **フェーズ 2 / E10 OP-01・OP-02 プロセス2コード完了**: 人間承認駆動に合わせたキュー・判定・失敗・ファネルCLIを既存台帳から読み取り専用で構成。独立完了レビューは `PASS / APPROVED / GO`、全指摘なし。D-5/OP-01/E-15の正式な文書裁定だけ外部ゲート
- **フェーズ 2 / E11 RV-01・RV-02 プロセス2完了・完了再レビューGO**: 待機/対局画面の固定ルール一覧と公開ルール図鑑を接続。方向性レビューのImportant 2件と初回完了レビューのImportant 1件を反映し、待機中のregistry変更追従、最終API契約、詳細・再試行・競合fetch・公開API保護、実DB境界、375×812実画面まで仕上げた
- E1〜E3 の実装記録は本書末尾の「並行進行」節、E13 は「E13」節。E4 の未解消の開発者判断は「詰まっている点」に残っている(1〜4・7・8・11)

## インゲーム演出改善(2026-07-30)

- 状態: 初回独立完了レビューの Important 2件と Minor 1件を修正。再レビューは要件 `PASS` / 品質 `APPROVED`。disabledの公開契約に関する指摘は下記裁定により現仕様を維持
- ブランチ: `codex/ingame-effects`

### ユーザーストーリーの確認

- `packages/web/src/App.test.tsx` で、8切り直後の空フィールド snapshot でも出した8をカットイン中は保持し、リボンが引いた後の320msだけ flush 状態にしてから消すことを確認
- 同テストと `packages/web/src/game/table.test.ts` で、保持対象を発動ボレー作成時のプレイへ固定し、次のプレイが着地した場合は古い札の吸い込みを省略すること、全員パスの場流しは保持しないことを確認
- `packages/web/src/components/RuleCutIn.test.tsx` で、300msの一拍、1050ms後の完了、一拍中のスキップを確認
- `packages/web/src/components/ActiveRulesModal.test.tsx` / `RuleDetailModal.test.tsx` と `App.test.tsx` で、盤面を残した一覧・詳細モーダル、名前の即時表示、説明文取得失敗後の再試行を確認
- `packages/web/src/App.test.tsx` で、一覧・詳細URLから `popstate` で戻ったときにモーダルだけ閉じて卓が残ることを確認
- `packages/web/src/screens/GameScreen.test.tsx` で、自分の番だけ「あなたの番」と残り時間バーが手札トレイ内に出て、相手の番でも札を読めることを確認
- `packages/server/src/rules/catalog.test.ts` / `app-server.test.ts` で、by-idの200/404、removedの公開、disabledの404、一覧と同じ指標フラグ、共通レート制限経路を確認

### 置いた仮定・競合時の裁定

- 設計書 §2.1 の「実在すれば status をそのまま返す」と、発注書 Task 1・G-17 の「disabled は404」が競合する。今回の依頼対象である発注書の具体的な受け入れ契約と開発者裁定を優先し、disabled は404を維持した。公開型 `RuleCatalogItem.status` も現行の `active | removed` から広げない

### 独立完了レビュー

- 初回判定: 要件適合 `PARTIAL` / 品質 `NEEDS_FIXES`。Criticalなし、Important 3件、Minor 1件
- 修正したImportant: reduced-motionでも場のflush animationが動く問題を、animationなしの即時消去へ変更
- 修正したImportant: 場保持が最新snapshotへ追従して別のプレイをflushし得る問題を、ボレー作成時の履歴位置へ固定。次のプレイ到着時は古いflushを省略し、全員パスは保持対象外にした。`RuleCutIn` の完了callback更新でもタイマーを再始動しない
- 修正したMinor: 一覧・詳細モーダルのAndroid戻る相当の `popstate` 統合テストを追加
- 維持したImportant候補: disabledの契約競合。上記「置いた仮定・競合時の裁定」のとおり発注書 Task 1・G-17を優先
- 再レビュー判定: 要件適合 `PASS` / 品質 `APPROVED`。Critical / Importantなし。残った「後続プレイ検出renderの1フレームだけflush classが付き得る」Minorも、描画時点でflushを無効化して反映
- 最新 `origin/main` 統合後の `CI=true pnpm verify`: format / lint / AI boundary / design lint / typecheck / 全テスト / 全build成功（**120 files / 861 tests成功**）
- 375×812のテストモード実画面で、卓・席・手札トレイが横スクロールなく収まり、自分の手番表示と札の可読性を確認

### 詰まっている点

- なし

## 匿名おためし提案枠(AU-D4緩和、2026-07-30)

- 状態: プロセス2完了・独立完了再レビューPASS
- ブランチ: `codex/anonymous-trial-proposal`
- コミット:
  - `977102b` `ProposalListItem.occupiesSlot` と `ProposalRepository.hasInflight`
  - `d09ff92` 登録必須ゲートから匿名1件枠ゲートへの置換
  - `f105ccc` 未登録フォーム・枠埋まりパネル・403フォールバック
  - `9c15ff7` 設計差分と本記録
  - `93845cc` Prettier整形
  - `6cb1f76` 初回完了レビュー指摘の修正と実HTTP回帰テスト
  - `664a144` 最終レビュー記録
  - 最新のローカルmain・リモートmain統合と再検証記録は本コミット

### ユーザーストーリーの確認

- `packages/server/src/proposal/submission.test.ts` で、匿名の初回受理、別内容2件目の403、終端後の再受理、同一内容再送の冪等200、登録済みの複数進行、停止中の拒否、`authorize` の入口判定を確認
- `packages/server/src/proposal/proposal.test.ts` の実 `createAppServer` + `ProposalSubmissionService` HTTPテストで、枠占有後も同一内容再送は同じIDの200、不正入力は400、別内容は枠403、停止中は停止403になる順序を確認
- 同テストで `screening` / `implementing` / `failed + attempt_count=0` の枠占有と、`attempt_count=1` の非占有を確認。`mine()` が同じ判定を `occupiesSlot` として返すことも固定
- `packages/web/src/screens/ProposalFormScreen.test.tsx` で、未登録・枠空きのフォームと注記、枠埋まり時の進行中提案+状態+ログイン導線、送信競合時の403フォールバック、登録済みでは枠照会を行わないことを確認
- 最新のローカルmainとリモートmainを統合後、`CI=true pnpm verify`: format / lint / AI boundary / design lint / typecheck / 全テスト / 全build成功(**100 files / 676 tests成功**)

### 独立完了レビュー

- 初回判定: 要件適合 `PARTIAL` / 品質 `NEEDS_FIXES`。Criticalなし、Important 1件、Minor 1件
- Important: HTTP POSTがbody前の`authorize()`で匿名枠を拒否し、`submit()`の停止・検証・重複順へ到達しない問題。`authorize()`を認証+停止だけに限定し、実HTTP回帰テストを追加して修正
- Minor: 匿名枠設計書の状態が「実装計画は未着手」のままだったため、「実装済み(main取り込み前)」へ更新
- ANON-P1は採用、ANON-P2はImportant修正を前提に採用
- 再レビュー判定: 要件適合 `PASS` / 品質 `APPROVED`。Critical / Important / Minorなし
- ANON-P1 / ANON-P2の採用判断は維持。ANON-P2の前提だった停止優先も実HTTP経路で成立

### 置いた仮定(レビューで裁定してもらう)

| # | 仮定した内容 | なぜそう決めたか | 出典 | 覆ったときの影響範囲 |
|---|---|---|---|---|
| ANON-P1 | 現行C-5では通常遷移で作れない`failed + attempt_count=0`を、境界テスト内だけDB行の直接更新で再現する | 実装計画のテスト例にある`failed → implementing`はC-5で廃止済み。一方、既存部分ユニーク索引と今回の契約はlegacy行も含む同じ述語を要求するため | E05冒頭C-5改訂、`docs/impl-progress.md` C-5追従、匿名枠設計§2 | テストハーネスのみ。productionの状態遷移・枠述語には影響なし |
| ANON-P2 | 匿名ユーザーが停止中かつ枠占有中の場合、提案画面では枠パネルより既存の停止モーダルを優先する | イエローカード・提案停止を変更しない契約と、投稿時に停止403を枠403より先に確定する順序をUIでも保つため | 匿名枠設計§2・§4、実装計画Global Constraints | `ProposalFormScreen`の表示優先順位のみ |

### プロセス2に回したもの

| 内容 | 状態 |
|---|---|
| 全体のformat / lint / design lint / typecheck / test / build | 最新main統合後も成功(**100 files / 676 tests**) |
| 375×812で未登録フォームと枠埋まりパネルを実画面確認 | Browser / Chromeともlocalhostをクライアント側で遮断したため未確認。自動UIテストは成功 |
| 独立GPT-5.6 Sol完了レビュー | 同じレビュアーによる再レビューで `PASS / APPROVED`。Critical / Important / Minorなし |

### 詰まっている点

- なし

### E-18 / C-2・C-3・C-6 再設計の反映(2026-07-27)

- 投稿 API は認証→停止確認→検証→重複確認→L0〜L2シグナルと提案の同一 transaction 保存までを同期実行し、疑わしい本文も含め常に `screening` として非同期受付する。旧 `block_*` 即時応答、503 fail-closed、遮断キャッシュ、投稿レート制限は撤去した
- 入力上限を名前40/内容1000へ変更。終端理由は C-6 の却下6値と `implementation_failed` のみに制約した
- L0〜L2 は `proposal_signal_checks`、ローカル L3/決定表は `proposal_checks` に分離。`pass` の最終記録がある提案だけを E7 実装キュー資格境界へ渡す
- 管理 Bearer token 専用の `GET /admin/pipeline/screening` と `POST /admin/proposals/:id/check` を追加。通常ユーザーの token では到達できず、設定がない環境は503にする
- `ops:screen` は Codex app-server の ephemeral thread を使い、モデルへ shell/Web/MCP/connector/subagent/画像ツールを与えない。read-only、network off、approval never も重ね、ツール item が現れた応答は記録しない
- judge eval 40件(正当20/攻撃20)の初回で Luna は38/40、Solは39/40。両方が見逃したA10境界のfew-shot不足を修正後、Luna/Solとも40/40。平均レイテンシは Luna 6,398ms、Sol 6,234msで、既定をSolに決定した
- イエローカードは L3 判定だけでは発行せず、開発者確定後に発行する。1枚の注意表示、2枚の24時間提案停止、3日失効、停止中の対戦継続、異議申し立て、取り消し時の停止解除と残カード復元を実装した
- 完了レビューの Important 4件を反映: L3結果をfirst-write-winsで不変化、app-serverを提案ごとに最大3回再試行して失敗後も後続継続、5秒pollで新規カードを自動提示、停止に使われた2枚それぞれから異議申し立て可能にした。2枚目の新規確定だけ演出し、停止中の再訪は静的表示に分離した
- `CI=true pnpm verify`: **40 files / 301 tests 成功**。format / lint / design lint / typecheck / 全 package build も成功
- 運用手順は `docs/runbooks/e6-local-screening.md`。却下・カード発行・SPEC承認・実装キュー投入を一体で確定する `VERDICT_CONFIRMATION` は E7 の責務

## フェーズ 2: E14 チュートリアル(TU-01〜04)

### TU-01 プロセス1

- 状態: プロセス2完了
- ブランチ: `codex/e14-tutorial`
- プロセス1コミット: `4db904e`
- プロセス2コミット: この記録を含むコミット
- ユーザーストーリーの確認:
  - `packages/server/src/room/manager.test.ts` の「availableRulesが非空でも、きほんの部屋は有効ルールを空に固定する」と 3 経路の「2セット目へ進んでも、きほんの部屋はみんなのルールに化けない」で、非空ルール供給下でも初回・2 セット目とも `availableRules` / `fixedRules` / `engine.ruleChain` が空であることを確認
  - `packages/server/src/room/socket-gateway.test.ts` で、`room:create({ mode: 'basic' })` が実 Socket.IO 経路を通り、作成者・参加者双方の `PlayerRoomView.mode` に `basic` が見えることを確認。モード未指定は `community` になることも確認
  - `packages/web/src/screens/PlaySheet.test.tsx` と `App.test.tsx` で、モード選択から `createRoom(mode)` へ値が渡ること、未プレイ時だけタグが出ること、1 戦完了後に `daifugo.playedBefore=true` を保存することを確認
  - 実ブラウザ 375×812 で、タイトル→メニュー→「あそぶ」→モード選択→きほん→部屋作成確認まで操作。タグが 1 行に収まり、`innerWidth=scrollWidth=375` / `innerHeight=scrollHeight=812` で横・縦の意図しないスクロールがないことを確認

#### 実装した方向

- 共有契約は E14 §2.1 の範囲だけを追加した: `RoomMode = 'basic' | 'community'`、任意の `room:create.mode`、必須の `PlayerRoomView.mode`
- `RoomState.mode` をルール解決より先に置き、きほんでは作成時とセット更新時の両方でルール一覧を空にする。`RoomManager` と純粋 reducer の二重境界で守る
- 旧クライアントの空 payload は Socket gateway で `community` へ既定化し、既存の `RoomManager.create(user)` も community として維持した
- 入室者はモードを選ばない。最初の ChoiceSheet に「友だちの部屋にはいる」を並べ、作成者だけが「きほん / みんなのルール」を選ぶ
- 既プレイ判定は `daifugo.playedBefore` だけを読み書きし、ゲーム間リザルトまたはセットリザルトを受けた時点で `true` にする

#### 置いた仮定(方向性レビューで裁定してもらう)

| # | 仮定した内容 | なぜそう決めたか | 出典 | 覆ったときの影響範囲 |
|---|---|---|---|---|
| E14-P1-1 | 入室導線はモード選択の同じ ChoiceSheet に置き、入室者はモード選択を経由しない | 「入る側はモードを選ばず部屋に従う」を、意味のない選択をさせずに守るため。作成者のモード選択は先頭に維持 | E14 §2.1、C-10 | `PlaySheet.tsx` と同テストのみ。ルーム契約・サーバーには影響なし |
| E14-P1-2 | `playedBefore` はゲーム間リザルトまたはセットリザルトの snapshot を初めて受けた時点で書く | クライアントが権威的に「1 戦完了」を観測でき、再接続で既に完了済みでも取りこぼさない最小条件 | E14 §2.1 | `App.tsx` の保存条件とテスト。サーバー契約には影響なし |

#### プロセス1方向性レビュー

- 独立 GPT-5.6 Sol の判定: **GO_WITH_FIXES**。Critical なし、契約逸脱・basic へのルール混入なし
- Important: `localStorage` の `getItem` / `setItem` と `window.localStorage` 取得時の例外防御をプロセス2で必須とする
- Minor:
  - 再接続 snapshot の `mode` を明示 assertion で固定する
  - 入室導線も含む初期 ChoiceSheet のアクセシブル名を「あそぶモードをえらぶ」から「あそびかたをえらぶ」へ正す
- 仮定 E14-P1-1 / E14-P1-2 はともに**承認**

#### プロセス1からプロセス2へ回したもの

| ストーリー | 内容 | 理由 |
|---|---|---|
| TU-01 | `localStorage` の読み書きが例外になる環境でも対局画面を止めない防御 | **完了**。保存領域の取得・読み取り・書き込みの各例外を隔離した |
| TU-01 | C-10 の将来案「招待コード入力後、入室前に部屋モードを見せる」 | **設計保留**。レビューでも TU-01 完了を妨げないと裁定。現契約に preview がないため、契約を広げず部屋参加後の view で見せる |

#### プロセス2で仕上げたもの

- `window.localStorage` 自体の取得、`getItem`、`setItem` のいずれが例外になっても、未プレイ扱いまたは保存なしで対局を続ける。専用ヘルパーの正常系・`SecurityError`・`QuotaExceededError` をテスト
- basic の作成時・`continue` / `leave` / `expireSetResult` 時には、非空の値を返す `availableRules` 供給関数自体が一度も呼ばれないことを明示
- 同一 token の再接続 snapshot に `mode: basic` が残ることを実 Socket.IO テストで明示
- 初期 ChoiceSheet のアクセシブル名を、作成モード2択と入室導線の全体を表す「あそびかたをえらぶ」へ変更。画面上の説明文は追加していない

#### 検証

- `CI=true pnpm verify`: 成功
  - Prettier: 全対象一致
  - ESLint / AI boundary: 成功
  - design lint: 84 ファイル、キービジュアル 3 ファイル、アウトライン 23 件が成功
  - TypeScript: 全 package 成功
  - Vitest: **36 files・260 tests** 成功
  - Build: 全 package 成功
- プロセス2対象テスト: **4 files・44 tests** 成功
- 実 Socket.IO: `socket-gateway.test.ts` **10 tests** 成功
- 実ブラウザ: プロセス1で 375×812 のモード選択タグと作成導線を確認。プロセス2の表示変更はアクセシブル名のみで、画面上の文言・レイアウトは不変

#### 設計への提案・気づいたこと

- E03 §2.3 / E12 §4.3 への `RoomMode` 契約同期は decision-log E-19 のとおり未反映。実装側では E14 §2.1 を正として最小差分だけ入れ、保護対象の Epic 設計書は変更していない

#### 詰まっている点

- なし。C-10 の入室前 preview は現契約を広げず、設計判断まで保留

### TU-02 プロセス1

- 状態: プロセス2完了
- ブランチ: `codex/e14-tutorial`
- プロセス1コミット: `b19b133`
- プロセス2コミット: この記録を含むコミット
- ユーザーストーリーの確認:
  - `packages/web/src/game/hints.test.ts` で、手番外・未選択・単騎だけ・ペア選択・3枚出し途中・不正な選択集合・合法手0件・空手札の8ケースを先に失敗させてから実装し、すべて成功
  - `packages/web/src/screens/GameScreen.test.tsx` の「dimmedのカードをタップしても選択せず、拒否フィードバックだけを返す」で、沈んだカードが `onToggleCard` を呼ばず `onDimmedCardTap` だけを呼ぶことを確認
  - 実サーバーの basic 1人+AI 3人対局を375×812で開始。場が2の単騎になり合法手0件となった手番で、手札13枚すべてが dim になること、`opacity: 0.42` + `saturate(0.15)`、選択状態に入らないことを確認

#### 実装した方向

- `deriveCardHints` は E14 §2.3 の純関数契約どおり Web に限定。`legalMoves === null` は全カード `playable`、選択中はその集合を含む合法手の和集合だけを `playable` にする
- hints は `room.mode === 'basic'` のときだけ生成し、みんなのルールでは従来どおり全カードを通常表示する
- `Card` は `dimmed` prop を受け、不透明度と彩度の両方で沈める。タップ時は選択を変えず、通常は左右の首振り、`prefers-reduced-motion` では transform を使わない縁の点滅へ切り替える
- dimmed カードは `aria-disabled=true` で支援技術へ状態を伝えるが、HTML の `disabled` 属性は付けず、タップとキーボード操作の拒否フィードバックを受け取れる

#### 置いた仮定(方向性レビューで裁定してもらう)

| # | 仮定した内容 | なぜそう決めたか | 出典 | 覆ったときの影響範囲 |
|---|---|---|---|---|
| E14-P2-1 | dimmed カードは `aria-disabled=true` とする一方、ネイティブの `disabled` は使わずフォーカス・クリック可能に保つ | 「選択には入れない」と「タップ時に首を振る」を両立し、支援技術にも現在選べないことを伝えるため | E14 §2.3、チュートリアル設計 §5 | `Card.tsx` と操作テスト。hints 導出には影響なし |

#### プロセス1方向性レビュー

- 独立 GPT-5.6 Sol の判定: **GO_WITH_FIXES**。Critical なし。`deriveCardHints` の規則、basic 限定ゲート、Card → HandTray → GameScreen → App の結線に契約逸脱なし
- Important:
  - App の basic / community / `legalMoves === null` と選択・拒否操作をスナップショット統合テストで固定する
  - 連続タップ、animation 終了、reduced-motion、native disabled 不使用、Enter / Space の拒否フィードバックを回帰テストにする
  - design-system.html §5-16 に dim / 拒否 / reduced-motion 状態を同期する
- 仮定 E14-P2-1 は**承認**

#### プロセス1からプロセス2へ回したもの

| ストーリー | 内容 | 理由 |
|---|---|---|
| TU-02 | `design-system.html` §5-16 の Card 見本へ dim / 拒否状態を追加 | **完了**。reduced-motion の縁点滅とキーボード操作も部品仕様へ記載 |
| TU-02 | basic / community の App 結線をスナップショット単位で明示する統合テスト | **完了**。`legalMoves === null`、選択解除、dimmed タップ非選択も同時に固定 |
| TU-02 | `prefers-reduced-motion` 用CSSと反復タップ時のアニメーション再始動の静的回帰 | **完了**。移動なしの縁点滅、連続操作、animation 終了時のクラス除去を固定 |

#### プロセス2で仕上げたもの

- App の実スナップショット統合テストで、basic だけが合法手外を dim にし、community と手番外(`legalMoves === null`)では沈まないことを確認
- 選択可能カードの再タップで解除でき、dimmed カードのタップは `aria-pressed=false` のまま選択へ入らないことを確認
- Card は `aria-disabled=true` でも native `disabled` を付けず、フォーカス可能なまま Enter / Space に拒否フィードバックを返すことを確認
- 連続タップごとに首振りクラスが再付与され、animation 終了で除去されることを確認。CSS の reduced-motion は `transform` を含まない縁点滅であることを静的検証
- design-system.html §5-16 に通常 / 選択 / dim / 拒否 / small の見本を並べ、手札見本の古い「横スクロール」記述も実装どおりの重ね表示へ同期

#### 検証

- `CI=true pnpm verify`: 成功
  - Prettier / ESLint / AI boundary / TypeScript / 全 package build: 成功
  - design lint: 87 ファイル、キービジュアル3ファイル、アウトライン23件が成功
  - Vitest: **39 files・275 tests** 成功
- TU-02プロセス2対象テスト: **4 files・42 tests** 成功
- 実ブラウザ: 375×812、実 Socket.IO + basic 1人/AI 3人。`innerWidth=scrollWidth=375` / `innerHeight=scrollHeight=812`、dim 13枚が重なり表示のまま判読可能で操作ボタンを圧迫しないことを確認

#### 設計への提案・気づいたこと

- なし。E14 §2.3 の入力だけで実装でき、共有契約や Core の変更は不要だった

#### 詰まっている点

- なし

### TU-03 プロセス1

- 状態: 縦切り実装完了・方向性レビュー待ち
- ブランチ: `codex/e14-tutorial`
- コミット: この記録を含むプロセス1コミット
- ユーザーストーリーの確認:
  - `room.test.ts` で、きほん1人AI戦は接続中の人間に `turnDeadlineAt=null`、切断時だけ15秒、きほん人間2人と community は従来の60秒であることを確認。初セットのきほん1人戦だけ人間を seat 0 に固定
  - `RoomTimerCoordinator` で community の既定800〜2500msを変えず、きほん1人戦だけ3000〜4500msのAI間合いを使うことを確認
  - `find-tutorial-seed.test.ts` を先に失敗させ、♦3・ペア・高位札スコア上位を判定する純関数を実装。`tutorial-11` は seat 0 に ♦3、3/7/K/2 のペア以上、高位札スコア13で4席中1位
  - 実AIを5回走らせ、`tutorial-11` は1位4回・2位1回、場流れ5回遭遇。勝敗・場流れの保証値ではなく候補比較の実測として記録
  - `reduceGuide` を7ケースのTDDで固定。最初の手番、2回目の非再演、ペア、合法手0件、場流れ、同時条件1件化、同一snapshot再送、出せない札タップ、2戦目無効を確認
  - 実Socket.IOで、きほん1人部屋の開始後に人間がseat 0・先頭手番・タイマーなしとなり、探索済み13枚が届くことを確認

#### 実装した方向

- タイマーなしは `basic` かつ非退出人間1人の接続中手番だけ。切断中は従来どおり15秒、2人以上のきほんとcommunityは60秒を維持
- AI間合いはタイマー調停時にルーム状態を見て切り替え、process全体の既定値を変更しない。きほん1人戦を3000〜4500msと仮置き
- 初セットのきほん1人戦だけ席シャッフルを省き、人間をseat 0へ置く。`tutorial-11` はサーバー定数とし、実行時探索は行わない
- ガイドはクライアントの純粋reducerで、snapshot keyとevent seqを既演出判定に使う。同じ更新から返すcueは1件だけで、残りは次のsnapshotで条件が続いたときに出す
- 6 cueを初期実装。3秒で引くToastのguideバリアントを既存の卓上レイヤーに1件だけ置き、漢字にrubyを付けた。初戦だけ手札右上へ「よわい ← → つよい」を出す
- 発動ゲートのうち未プレイ判定は端末localStorage、モード・人間数・gameNoは受信snapshotから判定する。2戦目、既プレイ端末、人間マルチでは文字と目盛りを出さない

#### 置いた仮定(方向性レビューで裁定してもらう)

| # | 仮定した内容 | なぜそう決めたか | 出典 | 覆ったときの影響範囲 |
|---|---|---|---|---|
| E14-P3-1 | 契約を§2.1から広げず、探索seedとseat 0固定は「初セットのきほん1人戦」すべてに適用し、未プレイ・既プレイの差は文字ガイドと強さ目盛りに限定する | 未プレイは端末localStorageだけが知り、serverへ渡す契約はE14に定義されていない。`room:create`へtutorialフラグを足すと承認済み契約範囲を超えるため | E14 §2.1・§2.4、チュートリアル設計 §4 | seed選択と席固定のゲート。ガイドreducer・UIには影響なし。既プレイにも「強い初配牌」だけは見える |
| E14-P3-2 | きほん1人戦のAI間合いを3000〜4500msとする | 既定800〜2500msより全域で遅く、「明確にゆっくり」を機械的に保証しつつ1手5秒未満に収めるため | E14 §2.2・§5 未確定事項 | `RoomTimerOptions`のbasic用既定値とテストのみ |
| E14-P3-3 | ガイドは設計案の6 cueをまずすべて実装し、375px確認と観察テストで不要なものを削る | reducerの境界を先に固定し、文言の削除はロジックを壊さず行える。プロセス1では初手文言が1行に収まることまで確認 | E14 §2.5・§5-7、UI文言ガイド §3 | `GuideMessage.tsx`の対応文言とreducer候補。ゲーム進行には影響なし |

#### プロセス2に回したもの

| ストーリー | 内容 | 理由 |
|---|---|---|
| TU-03 | design-system.html §5-13 / §5-16へguide Toastと強さ目盛りを同期 | 実対局の縦導線と375px判断を先に通した。部品カタログの同期は方向性確定後に行う |
| TU-03 | 6文言すべてのruby・1文制約・375px収まりを回帰固定し、削除テストを再適用 | プロセス1の実画面では最初の一言を確認。遭遇タイミングの異なる残り5件は仕上げで個別に確認する |
| TU-03 | 初戦終了→2戦目でガイドと目盛りが消える実スナップショット統合 | unitではgameNo=2と既プレイを固定済み。実ゲームの切替結線を仕上げで追加する |
| TU-03 | C-11の放置対策 | 仮値で着手可の未決事項。現設計どおりタイマーなしを優先し、playing中の長時間上限は追加していない |

#### 検証

- `CI=true pnpm verify`: 成功
  - Prettier / ESLint / AI boundary / TypeScript / 全package build: 成功
  - design lint: 90ファイル、キービジュアル3ファイル、アウトライン23件が成功
  - Vitest: **41 files・291 tests** 成功
- TU-03対象テスト: server room/timers/socket、seed、guide、App の計6ファイル
- 実ブラウザ: 375×812、実Socket.IO + basic 1人/AI 3人
  - 人間はseat 0・先頭手番、手札は探索済み13枚、ターンバーなし
  - 初手ガイドは305×46px・1行、ruby 2箇所。強さ目盛り16px高
  - `innerWidth=scrollWidth=375` / `innerHeight=scrollHeight=812`、手札・操作ボタンを圧迫しない
- 観察テスト(E14 §4): 開発者実施範囲のため未実施。実装側は自動テストと実機確認まで完了

#### 設計への提案・気づいたこと

- 「未プレイ」をserverへ渡す契約が設計にないため、seed/seatまで既プレイと厳密に出し分けるには追加契約が必要。E14-P3-1では契約を増やさず、既プレイ側に無害な教材配牌だけ共有した
- 実AI試行では場流れ100%だったが保証には格上げしない。ガイドは遭遇しなければ出ないままで進行できる

#### 詰まっている点

- なし。C-11は仮値どおり放置対策なしで進行。最終の教育効果は開発者の観察テストへ渡す

### TU-03 方向性レビュー・プロセス2

- 状態: **プロセス2完了**
- プロセス1コミット: `d134ce8`
- プロセス2コミット: この記録を含むコミット
- 独立レビュー: GPT-5.6-Sol / 別コンテキスト / **GO_WITH_FIXES**
  - Criticalなし、REDO要因なし
  - E14-P3-1 / P3-2を採用、P3-3は削除テストを条件に採用
  - 必須指摘「未完走退出後に別室へ入ると前室のガイド状態が残る」を、`roomId + gameNo` 単位のリセットとApp統合テストで修正

#### プロセス2で完了したもの

| ストーリー | 内容 |
|---|---|
| TU-03 | ガイド状態を部屋・初戦単位へ閉じ、未完走退出→別のbasic soloで最初から案内する回帰を追加 |
| TU-03 | 初戦終了snapshot→2戦目snapshotで、文字ガイドと強さ目盛りが消える統合テストを追加 |
| TU-03 | 既プレイ、community、basic人間複数でガイドを出さないAppゲートを回帰固定 |
| TU-03 | AI間合いの3000/4500ms境界、basic人間複数の従来値、教材seedとseat固定の初セット限定境界を固定 |
| TU-03 | seed候補の♦3・ペア・強さ順位を個別の負例で固定 |
| TU-03 | `design-system.html` §5-13 / §5-16へguide Toast・ruby・強さ目盛り・表示優先度を同期 |
| TU-03 | `seenSnapshots`の単調増加配列を直近snapshot keyへ簡略化し、初戦内の保持量を有界化 |

#### UI文言ガイドの削除テスト

- プロセス1の6 cueから `illegalTap` の文字ガイドを削除し、最終形を5 cueとした
- 理由: dim表示・首振り/縁点滅がその場で拒否を伝え、`followTurn` の「場より強いカード」と内容が重なる。削除しても選択失敗を増やさず、同時に表示候補が増える害のほうが大きい
- 残した5 cue: 初手、場への追従、同数まとめ出し、合法手0件のパス、全員パス後の場流れ
- 全5文言をcomponent testで「1文以内・ruby/rtあり」に固定

#### 375px実画面確認

- 375×812、production build、実Socket.IO、探索seedのbasic solo初戦で5 cueをすべて実際の対局中に遭遇して読み返した
  - 初手: `すきなカードを 1 枚 えらんで出そう`
  - 追従: `場のカードより つよいカードなら 出せるよ`
  - まとめ出し: `おなじ数字は 2枚 いっしょに出せるよ`
  - パス: `出せないときは「パス」`
  - 場流れ: `みんながパスしたので 場が ながれた! つぎは きみから`
- 初手Toastは321×46px、左右27px、横あふれなし。残り4件も同じ実画面の卓上レイヤーで、手札・操作ボタンを隠さず読めることを確認
- 強さ目盛り、dim、13枚重ね、タイマーなし、AI 3〜4.5秒の間合いも同じ対局で確認

#### 検証

- `CI=true pnpm verify`: **成功**
  - Prettier / ESLint / AI boundary / TypeScript / 全package build: 成功
  - design lint: **91ファイル**、キービジュアル3ファイル、アウトライン23件が成功
  - Vitest: **43 files・304 tests** 成功
- 方向性レビュー指摘の境界を含む対象検証: **7 files・93 tests** 成功
- 観察テスト(E14 §4): ユーザー指定どおり開発者実施範囲。実装側の自動テストと375px実機確認まで完了

#### 置いた仮定・裁定

| # | 裁定 | 内容 |
|---|---|---|
| E14-P3-1 | **採用** | 契約を§2.1から広げず、seed/seatは初セットbasic soloへ適用し、未プレイ差はUIだけに限定 |
| E14-P3-2 | **採用** | basic soloのAI間合い3000〜4500ms。観察後の値変更はoption既定値だけで可能 |
| E14-P3-3 | **条件を満たして採用** | 削除テストで6→5 cueとし、残す全文言を375pxで確認 |

#### 設計への提案・気づいたこと

- 文字を追加しなくてもCardのdim・拒否演出だけで失敗を伝えられるため、今後cueを増やす場合も「その文がないと操作に失敗するか」を先に問う
- C-11は契約を追加せず、仮値どおりplaying中の放置上限なし。観察テストで実害が出た場合に内部lifecycle上限を別途裁定する

#### 詰まっている点

- 実装上の詰まりなし
- TU-03の最終教育効果だけは、指定どおり開発者の観察テストで判定する

### TU-04 プロセス1

- 状態: **プロセス2完了・完了レビュー修正済み**
- ブランチ: `codex/e14-tutorial`
- プロセス1コミット: `5d534f8`（rebase前 `76bf1f7`）
- プロセス2コミット: `420779b`（rebase前 `2d5402f`）
- ユーザーストーリーの確認:
  - `SetResultScreen.test.tsx` で、「もう1セットあそぶ」と「みんなのルールで あそんでみる」が同じfooterに並び、後者の押下コールバックが1回呼ばれることを確認
  - `App.test.tsx` で、basicのセットリザルトだけ卒業導線を出し、押下時に `leaveRoom` 完了後 `createRoom('community')` の順で呼ぶことを確認
  - communityのセットリザルトには卒業導線がないことを画面統合で確認

#### 実装した方向

- `SetResultScreen` は卒業コールバックが渡された場合だけ導線を描画する。モード判定と退室→作成の副作用は画面部品へ入れず、`ConnectedApp` に置く
- Buttonの既存規律「primaryは1画面1個」を守り、初回basicクリアでは卒業導線をprimary・次セットをsecondaryにする。既プレイ時は次セットをprimary・卒業導線をsecondaryに戻す
- 初回強調のための共有契約は追加せず、未プレイ中に最初に入ったbasicの `roomId` をクライアント内だけで保持する
- 卒業導線は確認ダイアログを挟まず、文言どおり退室してcommunity待機室へ進む。ホームは既存どおり確認を残す

#### 置いた仮定(方向性レビューで裁定してもらう)

| # | 仮定した内容 | なぜそう決めたか | 出典 | 覆ったときの影響範囲 |
|---|---|---|---|---|
| E14-P4-1 | 初回だけ卒業導線を唯一のprimaryにし、「もう1セット」はsecondaryへ下げる。既プレイ時は逆にする | `Button`の「primaryは1画面1個」と「初回クリア後のみ強調」を同時に守り、常設のきほん継続も消さないため | E14 V4、チュートリアル設計 §6、design-system §5-1 | `SetResultScreen`のvariant選択だけ |
| E14-P4-2 | 初回強調はserver契約でなく、未プレイ中に入った最初のbasic roomIdをクライアント内で覚える | `playedBefore`は1戦後にtrueになるためsetResult時点だけでは初回を識別できない。RoomMode契約を広げないため | E14 §2.1・V4 | `ConnectedApp`のrefと強調propだけ。卒業導線の表示・作成modeには影響なし |

#### プロセス2に回したもの

| ストーリー | 内容 | 理由 |
|---|---|---|
| TU-04 | 初回/既プレイのbutton強調反転をDOMで直接固定 | 縦導線と副作用を先に通し、方向性レビューでprimaryの扱いを裁定してから固定する |
| TU-04 | `leaveRoom`失敗時にcommunityを作らないこと、連打時の重複作成防止 | エラー・競合境界はプロセス2で仕上げる |
| TU-04 | 375×812の実ブラウザでセットリザルト→community待機室を1周 | process1は画面/副作用の統合テストまで。production buildでの最終配置確認は仕上げに回す |

#### 検証

- `CI=true pnpm verify`: **成功**
  - Prettier / ESLint / AI boundary / design lint / TypeScript / 全package build: 成功
  - Vitest: **43 files・308 tests** 成功
- TU-04対象: **2 files・43 tests** 成功

#### 設計への提案・気づいたこと

- 「初回だけ強調」とButtonの単一primary規律を両立するには、2 CTAの優先度を入れ替えるのが最小。新しい説明文やバナーは不要

#### 詰まっている点

- なし。共有契約・Core・serverの変更なしで縦に通った

### TU-04 方向性レビュー・プロセス2

#### プロセス1方向性レビュー

- GPT-5.6-Solを別コンテキスト・読み取り専用で実施
- 判定: **GO_WITH_FIXES**
- E14-P4-1: **採用**。初回だけ卒業導線を唯一のprimaryにし、通常時は「もう1セット」をprimaryへ戻す
- E14-P4-2: **不採用**。`roomId` のメモリ内refだけでは、同一ルーム2セット目、未完走ルームからの作り直し、再読み込み/直接setResultを正しく扱えない
- 必須修正として、クライアントローカルの一度だけの状態、離脱/作成の部分失敗、再試行、pending中の重複操作防止、3 CTAのDOM規律、375px実導線をプロセス2へ反映した

#### プロセス2で仕上げたもの

- `daifugo.tutorialGraduation` に、未完走basic候補または「初回卒業導線を表示済み」のsnapshot識別子を保存する純関数reducerを追加
  - 同一ルーム2セット目は通常強調へ戻る
  - basicを未完走で離れ、別のbasicを初完走した場合も初回強調する
  - 既プレイ端末が保存状態なしでsetResultへ入った場合は通常強調のまま
  - 再読み込み/直接setResultでも候補が保存済みなら初回強調を復元する
  - storage取得・読み書きの例外は画面を壊さず無視する
- セットリザルトの3 CTAを同じfooter内に保ち、初回は「みんなのルールで あそんでみる」だけをprimary、通常は「もう1セットあそぶ」だけをprimaryにした
- 卒業処理中は「もう1セット」「みんなのルール」「ホームへ」をすべて無効化し、重複leave/createを防止
- `leaveRoom`失敗時はセットリザルトに留まり、短いエラー文と再試行可能な卒業CTAを表示。community作成は行わない
- leave成功後の`createRoom('community')`失敗時は、communityを選択済みの作成sheetを開き、同じエラー文からleaveを重ねず作成だけ再試行できる
- 共有契約、Core、serverは変更していない

#### プロセス2の検証

- TU-04対象: **4 files・66 tests** 成功
  - graduation reducer/storage、`SetResultScreen`、`PlaySheet`、`App`
- `CI=true pnpm verify`: **成功**
  - Prettier / ESLint / AI boundary / design lint / TypeScript / 全package build: 成功
  - 最新`main`統合後のVitest: **76 files・542 tests** 成功
- production buildを375×812で実ブラウザ確認
  - UI→typed Socket.IO→3ゲーム→セットリザルトを完走（確認時間短縮のため検証サーバーのAI待ち時間optionだけ0ms）
  - 3 CTAは上から「もう1セット」「みんなのルール」「ホームへ」、各351×48px、卒業CTAだけprimary
  - viewport 375×812、document scrollWidth 375、最下段bottom 792で横あふれ・画面外押し出しなし
  - 卒業CTA押下後、community作成の待機室へ遷移

#### 置いた仮定

| # | 裁定 | 内容 |
|---|---|---|
| E14-P4-1 | **採用** | 初回のみ卒業CTAを唯一のprimaryにし、通常時は「もう1セット」をprimaryへ戻す |
| E14-P4-2 | **置換** | server契約は増やさず、候補→初回強調表示済みをクライアントlocalStorageの小さな状態機械で一度だけ管理する |

#### 設計への提案・気づいたこと

- 「初回だけ」は`playedBefore`だけではsetResult時に失われるため、卒業導線自身の一度だけの状態を別に持つ必要がある。共有契約へ広げず、端末内の教育UI状態として閉じるのが最小
- leave成功・create失敗は元ルームへ戻せないため、エラーをセットリザルトへ偽装せず、community作成sheetで作成だけ再試行する

#### 詰まっている点

- 実装上の詰まりなし
- TU-03の観察テスト(E14 §4)は指定どおり開発者実施範囲。実装側の自動テストと375px実機確認は完了

#### E14完了レビュー

- GPT-5.6-Solを別コンテキスト・読み取り専用で実施
- 対象: `48cdd80..2d5402f` のE14全8コミット
- 判定: **GO_WITH_FIXES**
- Critical / Minor: なし
- Important: 卒業強調のsnapshot識別子に`room.v`を使うと、同じsetResult中の別メンバー応答でもversionが進み、初回強調が消える
- 反映:
  - 識別子を公開契約に既存の安定値`${roomId}:${setResult.respondBy}`へ変更
  - 同じsetResultで`v`だけ増えた場合は強調を維持し、次セットで`respondBy`が変わった場合だけ通常強調へ戻る回帰テストを追加
  - 共有契約の追加なし
- 修正後対象確認: **2 files・48 tests**、Web型検査ともに成功
- 最新`main`へrebase後、重なった`App`のルール発動表示・提案通知・setResult評価とE14卒業導線を併合
  - TU-04対象: **4 files・66 tests** 成功
  - `CI=true pnpm verify`: **76 files・542 tests**、全型検査・lint・design lint・全package build成功
- GPT-5.6-Solをさらに別コンテキストで統合差分だけ再レビューし、**PASS（actionable findingなし）**

## フェーズ 2: E5 ルール提案受付(RP-01・RP-02)

### プロセス1

> 以下のプロセス1/初回プロセス2記録には、E-18より前の同期遮断・12/400・レート制限の履歴が含まれる。現在の実装と検証結果は直前の「E-18 / C-2・C-3・C-6 再設計の反映」を正とする。

- 状態: 縦切り実装・方向性レビュー完了
- ブランチ: `codex/e5-rule-proposal`
- コミット: `0ae4450`
- ユーザーストーリーの確認:
  - `packages/web/src/screens/ProposalFormScreen.test.tsx` で、画面6からローカル区分・任意の都道府県・名前・本文を入力して送信し、「審査中」が表示されることを確認
  - `packages/server/src/proposal/proposal.test.ts` で、匿名セッショントークン付き `POST /api/proposals` → `proposals(status='screening')` 保存 → E7 用の古い順キュー取得までを実 HTTP で確認
  - `packages/core/src/proposal/proposal.test.ts` で、47 都道府県マスタ・NFC 正規化・12 文字の名前上限・original+都道府県拒否を確認

#### 実装した方向

- 共有契約・都道府県マスタ・正規化/検証は `packages/core/src/proposal/`、SQLite の提案リポジトリと送信パイプラインは `packages/server/src/proposal/`、画面6と HTTP クライアントは `packages/web/src/` に配置した
- E6 の検査は `ProposalScreeningGate` として差し替え可能にし、pass/block/検査不能(503)を表現した。E6 未実装の現在は pass-through。検査結果の確定 callback は proposal INSERT と同じ SQLite transaction 内で呼ばれる
- 専用キューテーブルは作らず、`status='screening' ORDER BY created_at,id` を E7 のキューとした
- 既存の Socket.IO 匿名セッショントークンを HTTP の Bearer token として再利用する。新しい認証基盤は追加しない
- RP-03 の画面7・一覧 API・既読通知は CX-02 後に実装する。現在は送信した 1 件の「審査中」を画面6内で確認できる

#### 置いた仮定と方向性レビューの裁定

| # | 仮定した内容 | 裁定 | 理由・影響 |
|---|---|---|---|
| E5-P1-1 | ルール名上限は **12 文字**、本文は 400 文字 | **採用** | decision-log E-14 と RuleCutIn の表示制約を正とする。core 定数・画面カウンタ・境界テストへ反映済み |
| E5-P1-2 | E6 の値(ユーザー5件/時・20件/日、IP 20件/時)をメモリ内 sliding window で実装 | **採用(初期構成限定)** | E12 の単一プロセス構成では妥当。再起動で履歴が消える弱点を明記し、`ProposalRateLimitPort` で永続ストアへ交換可能にした |
| E5-P1-3 | C-5 は E05 の「リトライ可能 failed も部分ユニーク索引に含める」方式を暫定採用 | **E7 内包モデルで決定・反映済み** | `failed → implementing` を廃止し、`failed` 遷移時に `attempt_count=1` を記録。同内容の再提案を即時解禁した。E7 内部の再試行は `pipeline_jobs.attempt` が管理する |
| E5-P1-4 | HTTP 認証は `Authorization: Bearer <Socket.IOで発行済みの匿名token>` | **採用** | 既存の匿名本人性を URL に露出せず HTTP と Socket.IO で共有できる。Cookie 化時は Web client/API と CSRF 対策が変更範囲 |

#### プロセス1レビューの結果と反映

- 独立 GPT-5.6 Sol の判定: **GO_WITH_FIXES**
- `pnpm verify` はレビュアー環境でも成功(32 files / 216 tests)
- Important: E6 導入前に保存された検査証跡のない `screening` 行が、そのまま E7 キューへ流れ得る構造だった
  - 対応: `ProposalRepository.queue()` に `ProposalQueueQualification` の注入を必須化した。E7 は E6 所有の検査証跡と照合して得た ID だけを受け取れる。旧行は再検査で資格を付けるまで空振りする
  - 回帰テスト: 資格なしの旧行がキューに出ず、明示的に資格 ID を返した後だけ出ることを確認

#### プロセス2で仕上げたもの

| ストーリー | 完了内容 |
|---|---|
| RP-01 入力 | 12/400 コードポイント境界、名前の改行拒否、C0/DEL/ゼロ幅/bidi 制御文字除去、CRLF・tab 正規化、NFC 保存と NFKC+case+空白の重複キーを検証 |
| RP-01 受付 | 認証→停止→レート→検証→重複→E6検査→transaction 保存の順序、soft/card/503、8KiB HTTP 上限、不正 JSON、並行 UNIQUE 競合、投稿者別重複を検証 |
| RP-01 状態 | E05 の許可遷移・冪等性・終端 patch 不変条件、failed の暫定1回 retry、rejected/released/枠切れ failed 後の再提案を実装・検証 |
| RP-02 | 47 都道府県全件と範囲外、local の県あり/なし、original+県のアプリ/DB 二重拒否、多言語・絵文字 ZWJ・改行の SQLite round-trip を検証 |
| RP-01 / RP-02 UI | タイトル→メニュー→提案画面、original 切替時の県入力消去、local の県未選択送信、同一セッショントークンの Bearer 利用、送信中 disable を検証 |

#### プロセス2の検証

- 対象テスト: **6 files / 60 tests 成功**
- 実ブラウザ: 375×812 でタイトル→メニュー→提案画面を操作し、横スクロールなし(`innerWidth=scrollWidth=375`)・全入力の判読性・original 切替で都道府県入力が消えることを確認
- プロセス2コミット: `c4c848a` + 完了レビュー修正を含むコミット

#### プロセス2完了レビューの結果と反映

- 独立 GPT-5.6 Sol の判定: **要件適合 PASS / 品質 APPROVED**
- Critical / Important: なし
- Minor: UI は入力を NFC 正規化する前にコードポイント上限で切っていたため、`e + combining acute` のような分解文字12個が、サーバーなら NFC 後12文字で受理できるのに UI では6文字へ短縮されていた
  - 対応: NFC 正規化後の値をコードポイント上限で切るよう変更し、分解文字12個が合成済み12文字として残る回帰テストを追加
- 最終 `pnpm verify`: **34 files / 244 tests 成功**。format / lint / design lint / typecheck / 全 package build も成功
- 確認を後続へ渡すもの: E6 の実検査証跡ストアと E7 の実ワーカー接続。C-5 は 2026-07-27 の決定を反映済み

## フェーズ 2: E6 インジェクション検査・イエローカード(YC-01〜03)

### プロセス1

> 以下はE-18より前の同期遮断方式で行った方向性レビューの履歴。旧503、遮断投稿を保存しない構成、送信レート制限、即時カード応答はすべて廃止済みであり、現在の正は本書冒頭の再設計反映節とE06冒頭ノートである。

- 状態: 縦切り実装完了・方向性レビュー待ち
- ユーザーストーリーの確認:
  - `packages/server/src/injection/injection.test.ts` で、正当提案が L0〜L3 を通って `proposal_checks(final_verdict='pass')` と同一トランザクションで保存され、pass 記録のある提案だけが後続キューへ出ることを確認
  - 同テストで、L1 hard または原文証拠付き L3 injection が提案を作らず遮断され、自己完結した検査記録とイエローカードを残すことを確認
  - 異なる攻撃文の2枚目で一律24時間の停止が発効し、その後の提案が検査前に403となる一方、提案以外の対局コードへ依存を追加していないことを確認
  - `packages/web/src/screens/ProposalFormScreen.test.tsx` で、`block_card` 応答から本人に「イエローカード!」モーダルと `1 / 2枚`、対戦継続可能の文言が表示されることを確認
- 実装した方向:
  - `packages/server/src/injection/` に L0正規化・L1静的パターン・L2構造特徴・L3 `InjectionJudge` port・決定表・台帳・E5接続を分離
  - 検査は E5 の認証→停止→レート→検証→重複の後、proposal INSERT 前に実行。pass の検査記録と proposal INSERT は同じ SQLite transaction、遮断時は `proposals` 行を作らない
  - `users.proposal_suspended_until`、`proposal_checks`、`yellow_cards`、`suspensions`、`card_appeals` のスキーマを追加。C-1 の決定どおり停止は毎回24時間、カード失効は3日
  - E5 の遮断確定 callback がトランザクション内で `YellowCardInfo` を返すようにし、カード枚数・停止情報を競合なく応答へ載せる

#### 置いた仮定(方向性レビューで裁定)

| # | 仮定した内容 | なぜそう決めたか | 出典 | 覆ったときの影響範囲 |
|---|---|---|---|---|
| E6-P1-1 | C-2 のモデル決定までは `InjectionJudge` port と Fake で縦切りを確認し、本番組み立ては `UnavailableInjectionJudge` で fail-closed(全提案503)にする | 未選定モデルを暗黙に採用せず、「検査できない提案は保存しない」を維持するため | decision-log C-2、E06 §2.3 L3・§2.4 行9 | `bin.ts` の judge 組み立てと外部クライアント。L0〜L2・DB・UIは維持 |
| E6-P1-2 | 英語 hard pattern の `ignore previous rules` は採用せず、`instructions/prompts` に限定する | E06 §2.2 の宛先原理と正当例「これまでのルールを無視」が、§2.3 の英語 hard 例に含まれる `rules` と衝突するため。誤カード回避を優先 | E06 §1.1・§2.2・§2.3 | `patterns.ts` 1箇所とコーパス期待値 |
| E6-P1-3 | プロセス1の累積確認は遮断応答のカード枚数とモーダル表示までとし、常設表示・GET・異議申し立てはプロセス2へ回す | 縦切りでは「検出→発行→本人が枚数確認→2枚で停止」が成立する。全導線と救済は受け入れ条件を満たし切るプロセス2でまとめる | implementation-workorder §3、E06 §3.2〜3.3 | Web/API/CLI。検出・台帳の方向性には影響なし |

#### プロセス2へ回したもの

| 項目 | 内容 |
|---|---|
| C-2 / L3実接続 | プロバイダー・モデル決定、構造化出力、10秒timeout+1回retry、モデル/latency記録、正式promptとfew-shot、外部API認証 |
| 検査の仕上げ | 24時間の遮断結果キャッシュ、LLM失敗ログ、全決定表、同形異字/難読化/併走、検査バージョン、完全な監査取得API |
| コーパス | attack/legitの初期検体と決定的CI、実モデルjudge evalの実行経路 |
| YC-02 UI/API | `GET /api/me/yellow-cards`、画面6注意帯、画面7バッジ、9a/9bの演出・スキップ・reduced-motion |
| YC-03救済 | appeal API、revoke/list CLI、取り消し時の停止解除とカード復元、本人への結果表示 |
| YC-03境界 | 3日失効、同時2件、停止期限経過、停止中も対局可能のE2E、履歴監査 |

#### プロセス1方向性レビューの結果と反映

- 独立 GPT-5.6 Sol の判定: **GO_WITH_FIXES**
- 仮定 E6-P1-1 は「プロセス1限定で採用」、E6-P1-2・3 は採用。C-2 は引き続き人間判断
- Important 1: L1 hard 判定が L3 障害時に 503 へ落ち、静的層の独立性を失っていた
  - 対応: hard ヒット時の L3 は参考試行にし、障害でも `block_card` を維持。`llm_verdict='error'` と review flag を監査記録へ残す回帰テストを追加
- Important 2: screening gate と pass 確定 callback が任意で、未検査 `screening` 行を作れる組み立てが残っていた
  - 対応: `ProposalSubmissionService` の screening と、`ProposalRepository.create()` の検査確定 callback を必須化。E5 単体テストだけ明示 Fake を注入する
- 修正後 `pnpm verify`: **35 files / 251 tests 成功**。format / lint / design lint / typecheck / 全 package build も成功

### 開発者レビューの反映(2026-07-26・プロセス2 のあと)

動くものを触ってもらった結果の指摘を反映した。**画面の作り直しを伴う指摘が中心**で、いずれもトーンではなく情報量と操作数の問題だった。

| 指摘 | 対応 |
|---|---|
| UI が文字に頼りすぎている | [UI文言・情報量ガイド.md](design/UI文言・情報量ガイド.md) を新設し、全画面にレビュー適用。フェーズ 1 の画面から説明文がゼロになった(残したのは 5b の問い 1 つだけ) |
| インゲームの実況ログが要らない。各自の直前の出し札は見せたい | 実況ログを廃止し、場を「人ごとの札山」に。さらに開発者の案を受けて**相手席の行と場を 1 つの卓に統合**し、4 人を菱形に置いて時計回りを位置で示す形にした |
| ルール発動をカットイン演出にしたい | `RuleCutIn` を追加。原則は「ルール名は文字で堂々と、効果は盤面で」。同時発動は段重ね + 連発バッジ、初登場は金の NEW RULE 面 |
| メニューのコンセプト一文が要らない | 削除(キービジュアルのコピーが同じことを言っている) |
| 「あそぶ」の次の画面が情報量が薄い | 画面 2a を廃止し、下から出る二択シートに。タップが 1 回減った |
| 手札の横スクロールはだめ。重ねて見せる | 送り幅を calc で必ず画面幅に収める重ね表示に。札の表記を左上の隅に集約して、重なっても全部読めるようにした |
| カウントダウンのリングが分かりにくい | 左から減るバーに変更 |
| 二択の文言 | 「じぶんの部屋をつくる」/「友だちの部屋にはいる」で対比させた |

**ワイヤーからの逸脱を 2 件行った**(どちらも開発者の指示):画面 2a の廃止と、実況ログの廃止。`wireframes.html` は変更していない。

### 開発者フィードバックの反映(2026-07-27・E3 統合後の実プレー)

E3 マージ後の実プレーで開発者から 4 件の指摘を受け、反映した。検証は `pnpm verify` 成功(45 files / 314 tests)+ ブラウザ実機 375px で 1 セット(3戦)通しプレー。

| 指摘 | 対応 |
|---|---|
| あがったことが認知しにくい | 席の残枚数を金の順位バッジ(「1位 大富豪」)に置き換え+席を減光。あがりの瞬間は Toast で数秒告知(「〇〇が1位であがり!」、自分は「あなた」表記)。再演出防止は「同一戦の history は単調増加」による増分検出で、再接続の全量スナップショットでは告知しない |
| 席チップの情報過多(名前が「AIプ…」に省略) | 1 チップに全部詰めるのをやめ、名前行(+AIタグ)と枚数バッジ・状態バッジ(考え中…/パス/切断中(AI代行)等)に分離。「AIプレイヤー2」程度は省略されずに読める。design-system.html §5-16 の見本も同じ構造に更新 |
| 場の札は前のプレイに完全に重ねたい | 各席の場は最新のプレイ 1 回分のみ表示(`plays.at(-1)`)。複数枚同時出しはその 1 プレイの全カードを見せる |
| 順位点を決めてセット総合順位を出したい(上から 5-3-2-1) | core の `scoreSet` の配点を **5-3-2-1** に変更し(`POINTS_BY_STANDING` を export)、同点タイブレーク(最終戦順位)は維持。`GameResultView` / `SetResultView` に `points` を追加して server が埋め、画面 5a に「この戦の得点+累計」、5b に合計点を表示 |

**E01 からの逸脱(開発者指示)**: E01 §「セット総合順位の算出」は順位点を 4-3-2-1(一般式 人数−順位+1)と記していたが、開発者の指示で 5-3-2-1・4 人固定に変更した。E01 側の記述更新を「設計への提案」に積む。

実行はサブエージェント 2 タスク(T1 インゲーム UI / T2 順位点)+各タスクの独立レビュー(いずれも PASS / APPROVED)+全体レビュー(READY)。未対応で引き継ぐ Minor: 切断中に複数人あがった場合は最後の 1 件のみ告知/`playerRetired`(フェーズ2)の席バッジは称号なし・告知なし/`.finished` の減光 0.55 のコントラスト実測は未実施/第 1 戦直後の 5a は獲得点と累計が同値で並ぶ。

### プロセス2 レビューの結果と反映

判定は **要件適合 PARTIAL / 品質 APPROVED**。PARTIAL の理由は実装の未達ではなく、**開発者にしか閉じられない項目が残っているため**(E04 の承認・DS-01 条件 3 の承認記録・§5-16 と favicon の目視承認)。指摘は Minor 4 件で、仮定 12〜18 はすべて採用。

| 指摘 | 対応 |
|---|---|
| Minor 1: `check-key-visual.mjs` に実在しない `ogp.svg` が残り、かつ対象の不在を無言でスキップしていた(改名で検査が空洞化する) | 死んだエントリを削除し、**対象の不在を fail に**した。TARGETS を export して「対象が全部実在すること」自体をテストで担保 |
| Minor 2: 検査が CSS 名前色・新しい色関数(oklch 等)・`border-radius` の px 直値を素通りする | 3 つとも検出するようにした。`border-radius` は影と同じくトークン参照(または `50%` / `0`)を強制。これに伴い唯一の非トークン値だった警告スロットの `4px` を `var(--radius-s)` に変更し、**design-system.html §5-14 側も同じ値に揃えた**(実装とカタログの食い違いを作らないため) |
| Minor 3: `public/favicon.svg` が正本と drift しても検知できない | 正本とのバイト一致検査を `lint:design` に追加(PNG は再生成に sharp が要るので SVG の一致を代理にする) |
| Minor 4: カタログ側の `rgba()` 直書きが残る(仮定 13) | 実装側は正しいとの裁定。**カタログの修正は開発者に起票済み**(下記「設計への提案」) |

検査のテストは 17 本 → **27 本**に増えた(全体 30 → 40 tests)。

## フェーズ 2: E7 codex パイプライン(CX-01〜04)

### CX-01 プロセス1

- 状態: 縦切り実装・独立方向性レビュー・Important修正完了。CX-01実モデル評価のみ明示許可待ち
- ユーザーストーリーの確認:
  - `packages/server/src/pipeline/service.test.ts` で、提案受付 → E6 pass → CX-01 払い出し → AI approve + 正規化SPEC記録 → 開発者SPEC承認 → `proposals.status='implementing'` + `pipeline_jobs.phase='queued'` を同一SQLite境界で確認
  - 同テストで、AI reject は開発者が対象 judgement ID を確定するまで `screening` に留まり、確定後だけ C-6 の公開理由へ写像して `rejected` になることを確認
  - 同テストで、E6 `block_card` は対象 check ID の開発者確定時だけ、カード発行・`inappropriate` 却下・監査 judgement を一体で記録することを確認
  - `packages/pipeline/src/app-server-judge.test.ts` で、ephemeral / read-only / network off / approval never / 全ツール無効の app-server thread と構造化出力スキーマを確認
  - `packages/server/src/app-server.test.ts` で、管理 Bearer token 付きの screening / check / judge / approve-spec API を実HTTPで確認
- 実装した方向:
  - サーバー側に append-only の `judgements` と提案ごとに一意な `pipeline_jobs` を追加。AI判定と開発者確定を別行にし、`source_check_id` / `source_judgement_id` / `actor` / `created_at` で確定対象と操作者を固定した
  - `GET /admin/pipeline/screening` は E6 未判定を `stage=e6`、E6 pass かつCX未判定を `stage=cx01`、人手確定待ちを `stage=confirmation` として作成順に払い出す。1回のローカルツール起動中に E6 pass 後の一覧を再取得してCX-01まで進める
  - CX-01 は契約v1の全hook/Effect語彙、A1〜C3の線引き、既存ルール一覧、保存済み提案だけを入力にし、approve / reject / needs_review とSPECを同時生成する
  - 可視文言は名前40文字・summary 1000文字・message 200文字、既知hook/Effect部分集合、slug、NG hard patternをサーバーで再検証する。提案由来の `source` はAI入力を信用せず保存済み行からサーバーが再構成する
  - E6 check・AI judgement・開発者確定はIDで結び、古い／別提案の判定では状態遷移しない。SPEC承認は developer judgement、queued job、提案の implementing 遷移を同一transactionにした
- 検証:
  - `CI=true pnpm exec vitest run packages/server/src/pipeline/service.test.ts packages/server/src/pipeline/app-server-judge.test.ts packages/server/src/app-server.test.ts`: **3 files / 10 tests 成功**
  - `CI=true pnpm --filter @daifugo/server typecheck`: 成功

#### 置いた仮定(方向性レビューで裁定)

| # | 仮定した内容 | なぜそう決めたか | 出典 | 覆ったときの影響範囲 |
|---|---|---|---|---|
| E7-P1-1 | 内部 `queued` は `pipeline_jobs.phase` にだけ持ち、ユーザー向け `proposals.status` はSPEC承認時に `implementing` へ進める | E5 の公開状態に queued はなく、E07 が二層状態を定義しているため | E05 §2.2、E07 §2.3・§3.2(c) | `approveSpec()` とRP-03表示 |
| E7-P1-2 | `judgements.spec_json` はCX-02の `SPEC.json` 本文に加え、scaffoldの `meta.json` 生成に必要な `slug` / `messages` も含む正規化仕様として保存する | E07の表例は `SPEC.json` と `meta.json` を分ける一方、judgementから後者を復元する専用列を定義していないため | E07 §2.4、§3.1(c) | **変更済み**: `spec_json` は正確なSPEC本文だけにし、slug/messagesは `scaffold_meta_json` へ分離 |
| E7-P1-3 | 重複判定用の既存ルール一覧は、当面 `pipeline_jobs.phase IN ('merged','done')` の開発者承認SPECから構成する | 現在の `packages/rules` に登録済み個別ルールがなく、CX-05の有効ルール台帳も未実装のため | E07 §3.1、CX-05依存 | **変更済み**: developer承認済みの全非failed jobを含める。CX-05で有効ルール台帳との和集合へ移行 |
| E7-P1-4 | SQLite・API・判定サービスと、既存E6 app-serverクライアントを再利用するローカルCLIを `packages/server` に置き、`packages/pipeline` はCX-02以降の実装ドライバから使用する | 現行E6の `ops:screen` がserver packageにあり、プロセス1では一つのローカルバッチとして縦に通すことを優先したため | E07 §2.3・§3.1(d) | **変更済み**: DB/API/transactionはserver、CLI/app-server client/prompt/eval/確定操作はpipelineへ分離 |

#### プロセス2へ回したもの

| 項目 | 内容 |
|---|---|
| 判定品質 | A1〜C3各行の評価セット、Luna/Sol一致率測定、実app-serverでのCX-01評価、既存ルール重複検体 |
| needs_review | 開発者によるapprove/reject両方向、修正SPEC、理由カテゴリ整合の全境界テスト |
| 冪等性・障害 | AI出力不正1回再試行、app-server障害3回、バッチ後続継続、API再送・並行確定、transaction rollback、再起動後の未処理再払い出し |
| 運用動線 | 未確定判定一覧、check/judgement IDを表示したカード・却下・SPEC確認手順、runbook |
| パッケージ境界 | E7-P1-4の裁定に従い、ローカル判定CLIを `packages/pipeline` に寄せるかserver内運用を確定する |
| CX-02〜04 | scaffold、実装skill、検収・差分ガード、PR/CI、マージ確認、enable/disableとロールバック |

#### プロセス1方向性レビューとプロセス2反映

- 独立 GPT-5.6 Sol の判定: **GO_WITH_FIXES**。Criticalなし、Important 4件
- Important 1（ルールID）: E5のULIDとE07の数値提案IDが衝突していた。E12の上位契約 `r{連番}` とE07の「提案由来」を両立するため、提案作成時に不変の `proposal_number` を割り当て、承認順に依存せず `r0001` 形式へ導出するよう変更。既存DBは作成順で一度だけbackfillする
- Important 2（package所有）: ローカル判定・確定CLI、prompt、app-server client、評価セットを `packages/pipeline` へ移動。serverはSQLite単一writerとadmin APIだけを所有
- Important 3（SPEC境界）: `SPEC.json`相当の `spec_json` と、`meta.json` 用slug/messagesの `scaffold_meta_json` を分離。AI approveと開発者承認の両方で別々に検証する
- Important 4（重複）: merged/doneだけでなく、queued/implementing/pr_openを含む全非failed・developer承認済みルールを重複判定へ渡す
- 追加申し送りも反映: 作成順でE6/CXを統合して飢餓を防止、同一起動中にE6→CXを連続処理、hook別Effect許可表をpromptとサーバーバリデータへ追加、`needs_review` のapprove/reject両方向、判定run IDによる再送冪等性と再判定追記、未確定一覧と確定CLI/runbookを追加
- 評価セットはA1〜C3全行 + approve 8件 + needs_review 2件の計22件。実app-server評価は `~/.codex` と外部モデル送信を伴う操作として権限審査で拒否されたため、迂回せず明示許可待ち。評価CLIと構造化出力のFakeテストは完成済み
- `CI=true pnpm verify`: **44 files / 315 tests 成功**。format / lint / design lint / 全package typecheck・buildも成功

#### プロセス2初回完了レビューと修正

- 独立 GPT-5.6 Sol の初回判定: 要件適合 `PARTIAL` / 品質 `NEEDS_FIXES`。Criticalなし、Important 2件
- Important 1（確認待ちによる飢餓）: E6/CX-01/確認待ちを作成順に統合した一覧へ先に `limit` をかけていたため、古い確認待ちが自動判定枠を消費していた。E6/CX-01だけを抽出してからlimitを適用し、確認待ちは枠外で全件表示するよう修正。確認待ち101件の後ろにあるE6/CX-01が選ばれる回帰を追加
- Important 2（障害・復旧回帰）: CX判定バッチをテスト可能な関数へ分離し、不正出力2回打ち切り、App Server障害3回再試行、1件失敗後の後続継続、同一run ID維持を回帰化。加えて、SQLite triggerでjob作成を強制失敗させた承認transaction rollback、確認の並行再送冪等、SQLite再起動後の未処理再取得を追加
- 修正コミット: `73b31ea`
- 独立完了再レビュー: コード・自動テスト要件 `PASS` / 品質 `APPROVED` / Critical・Importantなし。実モデル評価未実施だけを理由に全体要件適合は `PARTIAL`
- 実app-server評価は明示許可待ちのため未実行のまま。実モデル精度を除くコード・永続化・運用境界を再レビュー対象とした

### CX-02 プロセス1

- 状態: FakeCodexRunner を使う縦切り実装、独立方向性レビュー、プロセス2実装、初回完了レビュー修正、独立最終再レビューまで完了
- ユーザーストーリーの確認:
  - `packages/server/src/pipeline/jobs.test.ts` で、E6 pass + 開発者SPEC承認済みの `queued` jobだけを払い出し、提案・承認済みSPEC・scaffoldメタを同じjobへ結びつけることを確認
  - `packages/pipeline/src/implement.test.ts` で、払い出し → 不変 `meta.json` / `SPEC.json` scaffold → Fake publisherによるscaffold SHA固定 → compare-and-setで `implementing` claim → FakeCodexRunnerによる `rule.ts` / `rule.test.ts` 生成 → 検収、を縦に確認
  - 同テストで、scaffold改変、範囲外ファイル、禁止tokenを生成後検収で拒否することを確認
  - `packages/server/src/app-server.test.ts` で、Bearer保護された `GET /admin/pipeline/next` と `POST /admin/pipeline/jobs/{id}/update` を実HTTPで確認
- 実装した方向:
  - serverはSQLiteとjob払い出し・compare-and-set状態遷移だけを所有し、scaffold・publisher・CodexRunner・検収・実装driverを `packages/pipeline` に置いた
  - job払い出し時にE6 `pass` と最新judgementが開発者 `approve` であることを再確認する。AI approveだけ、古いdeveloper approveの後に新しいAI judgementがある場合、非queued jobは払い出さない
  - `meta.json` / `SPEC.json` は排他的作成と内容一致による冪等性を持たせ、CodexRunnerの前後でsha256を照合する
  - scaffoldを先にpublishしてcommit SHAを得た後、`queued → implementing` をcompare-and-setする。claim競合時はCodexRunnerを起動しない

#### 置いた仮定（方向性レビュー対象）

| # | 仮定した内容 | なぜそう決めたか | 出典 | 覆ったときの影響範囲 |
|---|---|---|---|---|
| E7-CX02-P1-1 | `meta.json` は現時点ではE07 §2.4の例どおり `id` + `slug` を持つ。E1 `RuleMeta.ruleId` との命名・ID形式の食い違いは方向性レビューで裁定し、CX-05のレジストリ実装前に一本化する | E07はE1スキーマ一致と書きつつ、同じ節の具体例が `id` + `slug`、E1は `ruleId=r{連番}-{slug}`、CX-01/jobは `rule_id=r{連番}` で相互に一致していないため | E07 §2.4、E01 §3.2、E07 §3.2(c) | scaffold、diff guard、ルールレジストリ、公開 `rule_id` |
| E7-CX02-P1-2 | scaffoldのpublish後に `queued → implementing` をclaimする | `scaffold_sha` はpush済みcommit SHAであり、状態遷移前には値を得られないため。競合時の同一branch再利用・履歴検証はプロセス2で完成させる | E07 §2.4、§3.2(b)(c) | source-control adapter、再起動冪等性 |
| E7-CX02-P1-3 | 生成・ローカル検収成功時点ではjobを `implementing` に保つ | `pr_open` は生成成功でなくPR作成成功を表すため。プロセス1はFakeCodexによるコード生成までを縦切りの終点とした | E07 §3.2(b)(c) | GitHub adapter、完了/失敗記録 |

#### プロセス2へ回したもの

| 項目 | 内容 |
|---|---|
| 実Codex・skill | subscriptionのCodex CLI runner、20分timeout、薄い実装CLI/skill定義、従量課金APIキー非使用の機械検査 |
| workspace/git | shallow clone、決定的branch、scaffold commit/push、履歴・祖先・blob一致検査、再起動冪等性 |
| GitHub | 生成commit/push、PR作成、機械可読scaffold SHA、`rule-change` label、障害時3回再試行 |
| job失敗 | `/fail` API、内部error_code、attempt/`-a2`、打ち切り時の `proposals.failed` + `implementation_failed`。生成成功はPR作成後に `pr_open` へ進める |
| 検収強化 | 差分ゼロ、symlink、import元、Date/Math.random、git差分・履歴、SHA/branch形式、サイズ境界、全違反fixture |
| CX-03境界 | diff-guardの入口条件G-4、quality/rule-tests/simulation CIはCX-03で実装 |

#### プロセス1の検証

- `CI=true pnpm --filter @daifugo/server typecheck`: 成功
- `CI=true pnpm --filter @daifugo/pipeline typecheck`: 成功
- `CI=true pnpm exec vitest run packages/pipeline/src/implement.test.ts packages/server/src/pipeline/jobs.test.ts packages/server/src/pipeline/service.test.ts`: **3 files / 16 tests 成功**
- `CI=true pnpm exec vitest run packages/server/src/app-server.test.ts`: localhost bind可能な環境で **1 file / 5 tests 成功**

#### プロセス1方向性レビューとプロセス2反映

- 独立 GPT-5.6 Sol の判定: **GO_WITH_FIXES**。Criticalなし、Important 4件
- Important 1（非同期Port）: `PipelineJobPort` を Promise 対応にし、Bearer保護された実HTTP adapterを追加。next/update/fail/resumeの契約をローカルHTTPで検証した
- Important 2（RuleMeta）: E12/E1の上位契約を正として、`meta.json` を `RuleMeta` と同じ `ruleId` に統一。公開rule IDとディレクトリ名を `r0001-yagiri` 形式にし、都道府県なしではpropertyを省略する
- Important 3（状態不変条件）: `queued → implementing` は決定的branch、40/64桁scaffold SHA、CX-02 prompt versionを必須化。`implementing → pr_open` はPR番号/head SHAと既存固定点を必須化し、欠落・古いphaseを拒否する
- Important 4（prompt version）: CX-01の判定prompt versionをqueued jobへ引き継がず、scaffold claim時に実装prompt版を記録する。authoring契約を強化した現在値は `cx02-v2`
- subscription実行: `SubscriptionCodexRunner` は認証済みローカル `codex exec` のみを `workspace-write` / ephemeral / 20分timeoutで起動する。LLM SDK・API key・専用隔離は使用しない。timeout/異常終了/生成物なしを内部区分へ写像する
- workspace/GitHub: shallow clone、決定的branch、`meta.json`/`SPEC.json` のscaffold commit先行push、remote branchからの中断再開、scaffold祖先・blob・全worktree差分検収、生成commit/push、既存PR回復または `rule-change` PR作成を実装した
- 失敗境界: `/admin/pipeline/jobs/{id}/fail` を追加。内部区分は `pipeline_jobs.error_code` に保存し、同じSQLite transactionで提案を公開理由 `implementation_failed`、`attempt_count=1` にする。最終失敗は開発者がskillから明示確定し、自動では打ち切らない
- 共有skill: `.agents/skills/implement-rule` を追加。次job実行、`implementing` job再開、最終失敗確定を分離し、Codex/GitHub認証がなければGUIで迂回しない手順にした
- 先行job警告: next APIは既存 `implementing` / `pr_open` jobをwarningとして返す。`GET /admin/pipeline/jobs/{id}` と `implement:resume` で中断jobを再取得できる

#### プロセス2の検証

- 対象実テスト: `CI=true pnpm exec vitest run ...`: **7 files / 30 tests 成功**。実ローカルHTTP、bare Git remoteへのscaffold push・別cloneからの回復、全差分検収、生成commit/push、Fake `gh` PR契約、CLI再試行・中断復旧を含む
- 全体 `CI=true pnpm verify`: **52 files / 346 tests 成功**。format / lint / design lint / 全package typecheck・buildも成功。AI boundary検査は `no LLM SDK or network I/O`
- skill validatorはfrontmatter/YAMLを手動確認済み。公式 `quick_validate.py` は実行したが、利用可能なPython環境にPyYAMLがなくスクリプト自体が起動不能だった
- 未実行: 実Codex subscriptionでの提案1件の生成、実GitHubへのbranch push/PR作成。外部状態を変える実ジョブは存在せず、自動テストではFake/ローカルremoteに限定した

#### 初回完了レビューと修正

- 独立 GPT-5.6 Sol の初回判定: 要件適合 `PARTIAL` / 品質 `NEEDS_FIXES`。Criticalなし、Important 4件。方向性レビューのImportant 4件はすべて解消済みと確認された
- Important 1（遅い段階の再開）: remoteに生成commit/PRがある `implementing` jobは、scaffold祖先・生成2ファイル・検収・head/PR一致を照合してCodexを再実行せず `pr_open` を回復する。scaffold push、生成push、PR作成後・API応答消失を同じbranch/head/PRへ収束させる
- Important 2（retry/attempt）: 開発者が明示した1回だけ `attempt=2` へCAS更新し、旧PRをコメント付きclose、旧branchを非forceで削除、`-a2` branchへ進む `implement:retry` を追加。clone/install/git remote/GitHub操作は最大3回の指数backoffにした
- Important 3（authoring契約）: 実装promptから正本 `packages/core/src/rules/README.md` を読むようにし、完了時typecheck/test commandを明記。外部import/re-export、`Date`、`Math.random`、dynamic importをpush前に拒否し、prompt版を `cx02-v2` に更新した
- Important 4（PR本文）: 開発者レビュー用に承認済み `SPEC.summary` をPR本文へ追加し、Fake `gh` 契約テストで固定した
- 初回修正後の独立再レビューはCriticalなし・Important 1件。CLIの旧PR close/comment、旧branch削除、retry CAS、clone/install再試行、workspace清掃を実行するオーケストレーション自体の回帰テスト不足を指摘された
- CLIオーケストレーションを注入可能なportへ抽出し、cleanup途中・CAS直後の応答消失、2回失敗後の3回目成功、二重retry拒否、成功/準備失敗時のworkspace清掃を回帰化した。既に `pr_open` のresumeは再実装しない正常no-op応答にした
- 正常完了した一時workspaceと準備失敗した一時workspaceを削除し、実装処理中に失敗したworkspaceだけを診断・再開用に残す
- `CI=true pnpm verify`: **52 files / 346 tests 成功**。format / lint / design lint / 全package typecheck・buildも成功
- 固定コミット `20ae51c` の独立最終再レビュー: コード・自動テスト要件 `PASS` / 品質 `APPROVED` / Critical・Important・Minorなし。focused **7 files / 30 tests** と差分検査もレビュアー環境で成功
- 外部受入ゲート: 認証済みsubscription Codexと実GitHubで、承認済み提案1件を生成→branch/PR→`pr_open` 永続化まで流すリハーサルは未実施。外部状態を変えるため自動実行せず、コード完了と分離して残す

### CX-03 プロセス1

- 状態: G-4の信頼済みdiff-guardを縦に通し、独立方向性レビュー `GO_WITH_FIXES` を経てプロセス2へ移行
- ユーザーストーリーの確認:
  - 正常なscaffold commit→生成commitのローカルGit fixtureを、PR本文の機械可読scaffold SHA・開発者author・決定的branchとともに検査して通過する
  - 範囲外変更、許可外ファイル、複数ルール、既存ファイル変更、branch不一致、第三者author、SHA欠落/重複、scaffold後のmeta/SPEC改変、不正scaffold履歴、不正meta schemaをすべて拒否する
  - `.github/workflows/rule-pr.yml` は `pull_request_target` でbase側のworkflowを使い、base SHAからcheckoutした `scripts/diff-guard.mjs` だけでuntrusted headのGit履歴・blobを読む。PR headのコードは実行しない
  - 非 `rule/**` PRは同じ `diff-guard` jobを安全なno-op成功にし、将来required checkへ登録しても通常開発PRを止めない

#### 置いた仮定（方向性レビュー対象）

| # | 仮定した内容 | なぜそう決めたか | 出典 | 覆ったときの影響範囲 |
|---|---|---|---|---|
| E7-CX03-P1-1 | `rule/**` PRは4ファイルすべてが新規追加(A)でなければ拒否する | G-4の「単一の新規ルールディレクトリ」を最も厳格に適用した。E07 §2.5の「削除方向も許可」は人手revertを `revert/**` で行いrule workflowを通さない§3.4と競合するため、安全側を採った | decision-log G-4、E07 §2.5・§3.4 | diff status許可表、revert PRのworkflow選択 |
| E7-CX03-P1-2 | 許可authorの既定はrepository owner、追加pipeline accountはrepository variable `RULE_PR_ALLOWED_AUTHORS` のcomma区切り | 現在のCX-02は開発者自身の `gh` 認証を使い専用accountを要求しない。public repoの第三者PRは既定で拒否できる | A-2、E07 §2.5(7) | repository設定、複数開発者運用 |
| E7-CX03-P1-3 | scaffold commitはPRのmerge-base直後の1 commitで、meta/SPECだけを追加する | CX-02 publisherの実履歴と一致し、途中commit挿入やSHA差し替えを機械的に拒否できる | E07 §2.4・§2.5(4)(5) | main追随/rebase運用、retry branch |

#### プロセス2へ回したもの

- `quality` / `rule-tests` / `simulation` の3ジョブと、4ジョブを束ねるrequired-check構成
- rule固有3ケース・行coverage 70%の機械判定、rules packageの禁止import/API lint
- E1 simulation harnessのCLI化、基本+新ルール/全ルール+新ルールの2構成×決定的seed、4不変条件、10分job timeout
- CI失敗の要約、開発者明示re-run/attempt 2/打ち切り、`pipeline_jobs.error_code=ci` と公開 `implementation_failed` への接続
- レッドチームfixtureと、GitHub ruleset/branch protectionへの4 required checks登録。実repository設定の変更は4ジョブ完成・方向性レビュー後に行う

#### 検証

- `CI=true pnpm exec vitest run scripts/diff-guard.test.ts`: **1 file / 10 tests 成功**
- `CI=true pnpm verify`: **52 files / 352 tests 成功**。format / lint / design lint / 全package typecheck・buildも成功

#### プロセス1方向性レビューと裁定

- 独立した別コンテキストの GPT-5.6 Sol 判定: **GO_WITH_FIXES**。Criticalなし、Important 4件
- Important 1（通常branch迂回）: branch名ではなく変更pathも分類し、通常branchから `packages/rules/r*/**` を変更する迂回を拒否。新規ルールは4ファイル追加だけ、恒久巻き戻しは信頼済みauthorの `revert/r{id}-{slug}` で4ファイル削除だけを許可する
- Important 2（workflow信頼境界）: `pull_request_target` ではbase revisionのデータ専用diff-guardだけを実行し、PRコードを実行するquality/rule-tests/simulationはsecretなし・read-onlyの `pull_request` workflowへ分離する
- Important 3（main追随履歴）: scaffoldの親を現在のmerge-baseに固定する方式を撤回。PR本文へ元base SHAを記録し、scaffold親=記録base、記録baseが現在mainの祖先、scaffoldがheadの祖先であることを別々に検査する。mainのmerge catch-upを許可し、rebase/固定点差し替えを拒否する
- Important 4（author allowlist）: repository ownerを常に許可し、`RULE_PR_ALLOWED_AUTHORS` は置換でなく追加集合にする。CX-02 CLIもjob claim前に現在の `gh` loginを同じ集合と照合する
- 仮定 P1-1は「新規追加のみ + 明示revert mode」で採用、P1-2はowner+追加accountへ修正、P1-3は元baseメタデータ方式へ修正した

### CX-03 プロセス2

- trusted gate:
  - `.github/workflows/rule-pr.yml` は `pull_request_target` でmainのguardをcheckoutし、untrusted headを実行せずGit objectとして検査する。main以外をtargetにしたPRは対象外
  - `scripts/diff-guard.mjs` は通常/pipeline/revertの3 modeをpathとbranchの両方で検証。pipelineは単一directoryの `meta.json` / `SPEC.json` / `rule.ts` / `rule.test.ts` の追加、決定的branch（初回/`-a2`）、author、機械可読SHA block、scaffold履歴・blob不変、meta exact schema、全ファイルの `100644 blob` を要求する
  - 非rule branchのgenerated path変更、空allowlist、第三者、symlink、既存変更・削除、複数directory、余分なpath、不正/重複SHA、main非祖先、scaffold後改変をfixture Git repositoryで拒否する
- untrusted checks:
  - `.github/workflows/rule-pr-checks.yml` にsecretなし/read-onlyの `quality` / `rule-tests` / `simulation` を分離。非rule PRは同名checkをno-op成功にしてrequired checkと共存する
  - generated `rule.ts` は `@daifugo/core` のみ、`rule.test.ts` はcoreと`vitest`のみimport可。ネットワーク・時刻・外部乱数・dynamic import/eval・明白な無限loop・長さ指定Arrayをlintで拒否するred-team suiteを追加
  - `scripts/check-rule-tests.mjs` は実行テスト3件以上と `rule.ts` 行coverage 70%以上をVitest JSON/V8 coverageで検査。正常fixtureを実コマンドで実行して100% coverageを確認した
  - `@daifugo/sim` はbuild済み全ルールを `meta.json` deep equality付きでloadし、新ルール単独/全ルールの2構成を各200ゲーム×5固定seedで実行する。終了・既存Sim invariant・無効Effect・hook例外/不正返値をfailにする
- 開発者動線:
  - 実装prompt/検収を `export const rule: RuleModule` とmeta exact equalityへ強化し、prompt versionを `cx02-v3` へ更新
  - PR本文へ `base-sha` を追加。publisherのGitHub owner抽出と `gh api user` preflightを実装し、許可外accountではclaim前に停止する
  - `implement:checks` はPRの4 checkを名前重複・欠落も含めて検査し、green/pending/failedを返す。失敗時はActions logの先頭100行だけをuntrusted dataとして提示する。共有skillはgreen後のSPEC/コード人間レビュー、フレークのrerun、内容起因の開発者承認retry/打ち切りを案内し、自動mergeしない

#### プロセス2の検証

- focused: **12 files / 68 tests 成功**。diff guard 3 mode、file mode/main追随、source policy、実coverage、simulation loader/runner、CI monitor、publisher/CLIを含む
- `CI=true node scripts/check-rule-tests.mjs --rule r9999-valid --rules-root fixtures/cx03/valid-rule`: 3 tests、line coverage **100%**、成功
- `CI=true pnpm --filter @daifugo/sim build`: 成功
- `CI=true pnpm verify`: **58 files / 383 tests 成功**。format / lint / design lint / 全package typecheck・buildも成功。sandbox内の初回はlocalhost listen禁止（`EPERM`）だけで失敗したため、同一コマンドをsandbox外で再実行して実HTTP/Socket.IOを含め成功

#### 完了レビュー前に残す外部受入ゲート

- mainのbranch protectionへ `diff-guard` / `quality` / `rule-tests` / `simulation` をstrict required checksとして登録する。現時点のmainは未保護。workflowがmainへ入ってcheck sourceを確定し、完了レビュー指摘を反映してから設定する
- `rule/**` のforce-push禁止・workflow path変更拒否をserver-side rulesetで設定し、実repository上で第三者風branchと通常PRのcheck挙動を確認する
- 承認済み提案を実subscription Codexで生成して実PRを作る受入リハーサルは、CX-02から継続して未実施。外部状態を変えるため、コード検証と分離する

#### 初回完了レビューと修正

- 別コンテキストの独立 GPT-5.6 Sol 判定: 要件 `PARTIAL` / 品質 `NEEDS_FIXES` / **NO_GO**。Criticalなし、Important 1件、Minor 1件
- Important（red-team fixture）: §4-4の悪性ケースがインラインlint例とrunner小規模テストに留まっていた。`fixtures/red-team/` に外部import・network・巨大Array・無限loop、カード複製を装う未知Effect、無限skip、memory quota超過、diff範囲外/複数ruleを追加した。`scripts/red-team.test.ts` とdiff-guard fixtureテストが、source policy・simulation・diff guardの各実ゲートで全件を拒否する
- Minor（prompt版）: prompt見出しの旧 `v1` を永続化値と同じ `cx02-v3` へ統一した
- 修正後focused: **4 files / 38 tests 成功**。全体 `CI=true pnpm verify`: **59 files / 392 tests 成功**。format / lint / design lint / 全package typecheck・buildも成功
- process1 Important 4件はレビュアーも全件closedと確認。残るNO_GO理由はmain protection/ruleset未設定と実repository受入だけで、workflowを含むE7差分をmainへ反映する前には設定できないため外部ゲートとして維持する

#### 完了再レビューと追加修正

- さらに別コンテキストの独立 GPT-5.6 Sol 判定: 要件 `PARTIAL` / 品質 `NEEDS_FIXES` / **NO_GO**。Criticalなし、Important 2件、Minor 1件
- Important（skip test）: JSON reportの`numTotalTests`だけを数えていたため3件すべてskipでも通過した。`numPassedTests >= 3`を必須にし、pending/skipped/todoが1件でもあれば拒否する。集計fallbackも`assertionResults[].status`のpassedだけを数える
- Important（CI順序）: `quality`のlintより先に並列`rule-tests / simulation`がnative codeを実行し得た。両jobへ`needs: quality`を設定し、静的source policy成功後だけnative実行へ進むDAGにした
- Minor（無限loop timeout）: 実native simulationで`onGameStart`が無限loopするfixtureを子processで起動し、500msの外側timeoutが`SIGKILL / ETIMEDOUT`にする回帰を追加した。workflow側にも`simulation → needs: quality / timeout-minutes: 10`があることをfixture suiteで検査する
- 追加修正後focused: **5 files / 45 tests成功**。正常rule fixtureは **3 tests / 100% line coverage**でgate通過
- 追加修正後の全体`CI=true pnpm verify`: **60 files / 400 tests成功**。format / lint / design lint / 全package typecheck・buildも成功

### E7 CX-04 プロセス1（ルール単位ロールバック）

- `rules`テーブルと`RuleRepository`を追加し、`active / disabled / removed`と`manual / auto_incident / rollback / pending_enable`をDB制約で表現した。`RuleRegistryService`はDBでactiveなIDとコード側`RuleChainEntry`の積集合だけを返すため、DBだけ・コードだけのルールを誤って実行しない
- `GET /admin/rules/{id}`、`POST /admin/rules/{id}/disable`、`POST /admin/rules/{id}/enable`を既存の管理Bearer境界に追加した。手動APIから指定できるdisable理由は`manual / rollback`だけに限定し、`removed`の再有効化は409相当の競合にする
- 本番`RoomManager`へregistryを接続した。部屋作成時だけでなく**最初のセット開始時**にも最新activeルールを再読込し、開始後は`fixedRules`を変更しない。これにより、部屋作成後・開始前のdisableも次のセットに正しく反映される
- ユーザーストーリー確認: `packages/server/src/rules/rules.test.ts`の「部屋作成後のdisableも最初のセット開始時に再読込し、進行中セットは固定する」で、A/BのうちAだけをDB無効化し、開始セットにはBだけが入り、開始後にBを無効化しても進行中の`fixedRules`はBのままであることを確認した。管理HTTP APIも実listenerで認証・照会・disable・enableを確認した
- focused検証: server typecheck成功。`app-server.test.ts / rules.test.ts / manager.test.ts`: **3 files / 14 tests成功**

#### 置いた仮定（方向性レビュー対象）

- コード側registryとDBのどちらか一方にしか存在しないルールは実行しない。CX-05の起動時同期が差を解消するまでfail-closedにする方が、未承認コードやrevert済みコードの誤実行を避けられる
- 管理APIの`reason`で指定できるのは運営操作に対応する`manual / rollback`だけとする。`auto_incident`はincident集計サービス、`pending_enable`は起動時同期だけが設定する
- `removed`はE8の淘汰provenanceを保持する終端状態として、CX-04の一般enable APIからは復帰させない。将来のE8専用reinstate操作は別サービス境界にする

#### プロセス2に回したもの

- `rule_incidents`、同一セット内の実行時ルール除去、coreの`RuleExecutionIssue`からの記録、24時間以内3 distinct setの自動disableと開発者通知
- `rule_versions`、起動時同期によるrevert検知、恒久revert後の`reverted_at`記録、runbookの実リハーサル
- APIの境界値・冪等性・DB再起動永続化、基本ルールのみの完走、他ルール非影響のシミュレーションを含む受け入れ条件の仕上げ

#### プロセス1方向性レビューとプロセス2反映

- 独立 GPT-5.6 Sol の判定: **GO_WITH_FIXES**。Criticalなし、Important 3件、Minor 2件
- Important（registry境界）: DB active順を権威にし、コード欠落・重複、contract version不一致、DB/meta不一致を全てfail-closedにした。load failureはセット開始を止めずincidentと通知ログへ送る
- Important（enable境界）: removedだけでなく、コード欠落・重複・契約不一致・meta不一致も409相当で復帰拒否する
- Important（状態遷移）: expected status付きの汎用CAS transitionとrepository transactionを追加し、CX-04・将来E8の競合を同じ原子境界で扱えるようにした。E8専用のremoved/reinstate公開操作は追加していない
- Minor（API）: 不正percent encodingを400、未知ruleを404、状態・コード競合を409、不正reasonを400、非対応methodを405として回帰化した
- Minor（永続化）: file SQLiteを閉じて再起動し、versionと恒久revert状態が保持されることを確認した

#### プロセス2実装

- `rule_incidents`を追加し、`exception / invalid_effect / load_failure`をルール・セット単位で冪等記録する。同一セットで複数回・複数種が起きても閾値上は1セットと数え、**24時間内3 distinct set**でactiveルールだけを`disabled / auto_incident`へ原子的に遷移させる
- hook例外・不正返値はcoreのセット専用portが当該ルールだけを以後のhookから除外する。`modifyLegality`が候補列の途中で失敗した場合は、その呼び出し中の部分変更も巻き戻す。engineがEffectを拒否した場合もserverが`invalid_effect`を記録し、同じセットの後続hookから除外する
- ルールchainはセット開始が権限・phase検証を通過してから読み込む。拒否されたstart操作をload incidentへ誤計上せず、開始後は固定し、次セットだけ最新DB状態を反映する。セット終了時に専用portを解放する
- `rule_versions`とcurrent一意制約を追加し、同期の再実行を冪等化した。起動時同期はcurrent versionに対応するコード欠落を検出し、`reverted_at`を記録してrule行を`disabled / rollback`のまま保持する
- revert PRの差分ガードは対象ルール4ファイルの削除に加え、一時excludeが存在する場合だけ**その1 entryの削除**を許す。他entryの削除・追加・並べ替えは拒否する
- `docs/runbooks/E07-rule-rollback.md`に即時disable、誤操作復帰、恒久revert、事後SQL・API確認、基本ルールsimulationまでを記載した

#### 置いた仮定（完了レビュー対象）

| # | 仮定した内容 | なぜそう決めたか | 出典 | 覆ったときの影響範囲 |
|---|---|---|---|---|
| E7-CX04-P2-1 | 自動無効化の閾値を24時間内3 distinct setで確定する | E07の暫定値を採用し、同一セット内の連鎖障害で即座に全卓から外れない一方、再現性のある事故は短時間で止めるため | E07 §3.4(b)(f)、E12 §7-8 | `AUTO_DISABLE_*`、incident集計テスト、運用アラート |
| E7-CX04-P2-2 | ~~開発者通知の当面の出口は構造化サーバーログとする~~ **変更: ログだけでは通知完了と扱わない** | 完了レビューで、監視されていないログは通知要件を満たさないと裁定された | E07 §3.4、E10 OP-01 | `bin.ts` callbackは診断ログとして維持。OP-01で永続outboxまたは監視済み通知へ接続 |
| E7-CX04-P2-3 | 起動時revert同期はコードregistryに一度でも登録されたcurrent versionだけを対象にする | rule rowだけでは未有効化と恒久削除を区別できないため。`rule_versions.is_current`をデプロイ済み版の根拠にする | E07 §3.4(b)・§3.5(c) | `markMissingCodeReverted()`、CX-05のmerge/version登録 |

#### 残る外部受入ゲート

- runbookの「即時disable → 復帰 → 恒久revert PR → CD → 起動時同期」を実repository・実環境で1回リハーサルする。実PR・mainデプロイを伴うため、自動テストとは分離して開発者の実施許可後に行う
- `packages/rules`の静的import registryと、merge時の`rules / rule_versions`登録はCX-05の実装で接続する。CX-04側のロード・revert同期境界はFake registryで回帰済み

#### プロセス2完了レビューと修正

- 独立 GPT-5.6 Sol の初回完了レビューは **NO_GO**。正常な優先度競合も`invalid_effect` incidentにして3セットで自動disableするCritical、同一core遷移内の後続hookまで不正Effectルールが残るImportant、空code registryで起動時revert同期するImportantを検出した
- incident対象を`effectRejected`のうち`resolution='rejected'`かつ失敗詳細を持つものに限定し、通常の競合・superseded・announce抑止を除外した。正常な競合を3セット発生させてもincident 0・両ルールactiveを維持する回帰を追加した
- `RuleChainPort.disableRule`を内部runtime制御として追加し、不正・適用不能Effectの解決時点で当該ルールを無効化する。同じ`startGame`遷移内の`onGameStart`失敗後に`onGameEnd`が呼ばれない回帰を追加した
- 本番`bin.ts`では完全な静的registryが未接続のため起動時revert同期を行わない。CX-05で全registryをロードできたことを条件に接続する
- 仮定 P2-2 はレビュー裁定で変更: 構造化ログだけでは「開発者通知完了」と扱わず、監視済みアラートまたは永続outboxへの接続を外部受入ゲートとする

## 完了したストーリー

| ストーリー | 周 | コミット | 検証結果 |
|---|---|---|---|
| TS-02 | 単回 | `bbb0cf3` | `pnpm verify` 成功。format / lint / typecheck / 4 tests / 6 packages build がすべて成功 |
| DS-01 | プロセス1 | `37981b8` | `pnpm verify` 成功(10 tests)。ブラウザ実描画で 375・768・1280 を目視確認 |
| DS-01 / DS-02 | プロセス2 | `4172616` + この行を含むコミット | `pnpm verify` 成功(format:check / lint / **lint:design** / typecheck / **40 tests** / 6 packages build)。ブラウザ実描画で 6 画面 × 3 ブレークポイントを確認。プロセス2 レビューの Minor 4 件を反映済み |

### プロセス1 レビューの反映

プロセス1 レビューの判定は **GO**、仮定 1〜11 はすべて「採用」(4・5・6・10 は条件付き)。指摘 3 件と条件はすべて処理済み。

| 指摘・条件 | 対応 |
|---|---|
| Minor: `fs.allow` がリポジトリ全体で広すぎる | `packages/web` 自身・`docs/design`・ワークスペースの `node_modules` の 3 つに絞った。**ただし当初 `node_modules` を落として Web フォントが全件 403 になり、フォントが一切適用されていなかった**(ブラウザのネットワークパネルで発覚)。修正済み |
| Minor: DS-01 受け入れ条件 2 のトーンガイド検証手順 1〜5 が宙に浮いている | 下の「DS-01 受け入れ条件 2 の検証記録」で 5 項目すべてを実施・記録 |
| Minor: `theme-color` の追随が手動 | `scripts/check-design-tokens.mjs` が `--color-bg-brand` の実値と照合するようにした(CI で fail する) |
| 仮定 4 の条件: DS-02 最終クローズの追跡 | 下の「詰まっている点」7 に明記。decision-log E 節への登録をレビュー側にお願いする |
| 仮定 5 の条件: フォントの実サイズ計測 | 実測した(下記)。初回描画 61KB / フェーズ 1 全 6 画面を回って累計 531KB |
| 仮定 6 の条件: favicon の開発者承認を関門に | 生成済み。承認は「詰まっている点」8 |

### DS-01 受け入れ条件の検証

**条件 1: 縦長 9:16 キービジュアルが表示される**

`packages/web/src/App.test.tsx` の 6 本(プロセス1 から継続)。ブラウザ実描画で 375×812 / 768×1024 / 1280×800 の 3 幅を確認し、ロゴ・コピー「毎日どこかで、新ルール。」・「タップしてはじめる」ピルがすべて判読可能・セーフエリア内であることを目視。

**条件 1': メニューは次画面に分離** — 画面 1a に「あそぶ」「ルールをていあんする」「ルール図鑑」が存在しないことをテストで検証。クリックとキーボード(Enter / Space)の両方で画面 1b へ遷移。

**条件 2: トーンガイドが文書化され基準になる**(E04 §3.1(b) の検証手順 1〜5)

| # | 検証項目 | 結果 |
|---|---|---|
| 1 | 4 ファイルの存在 | `docs/design/` に design-tokens.css / design-tokens.json / design-system.html / デザインシステム.md が揃っている |
| 2 | 配色: 2A の主要 7 色 + 補助がトークン化され、セマンティックが同ファミリーを参照 | 7 色すべてトレース確認: `#2B6FC2`→`--color-blue-500`(→`--color-bg-brand`)/ `#4585D4`→`--color-blue-400` / `#1C2447`→`--color-navy-800`(→`--color-text-primary`・`--color-border-strong`)/ `#FFF4DC`→`--color-cream-100`(→`--color-bg-app`)/ `#FFC53D`→`--color-gold-400`(→`--color-warning-bg`・`--color-category-original`)/ `#E14B3B`→`--color-red-500`(アクションは AA 確保のため `--color-red-600` を参照)/ `#2FA36B`→`--color-green-500`(→`--color-category-local`)。補助 5 色(`#B23A2E`・`#F0C48F`・`#14203D`・`#FFFFFF`・`#268A58`)も `--color-red-700` / `--color-skin-300` / `--color-navy-900` / `--color-white` / `--color-green-600` として定義済み |
| 3 | フォント | `--font-family-base` に M PLUS Rounded 1c → Hiragino Maru Gothic ProN → Hiragino Sans → Yu Gothic のフォールバックが定義され、weight(400/700/800)・size(7 段)・line-height(4 段)・letter-spacing(3 段)が揃っている |
| 4 | イラストのタッチ | デザインシステム.md §4 に Do/Don't が言語化され、design-system.html に見本がある。企画書 §6 の調整 2 決定(分かち書きの全角スペースを使わない / キャラクターに発言吹き出しを付けない)も §5-15 の注記などに明記されている |
| 5 | 役割の一貫性 | デザインシステム.md §3.2 に「赤=アクション / 金=祝祭・注意(審判の文脈のみ警告)/ 緑=ローカル・成功 / 青=情報・地」が明記され、イエローカードの黄の使用制限も規定済み |

なお **2 のトレーサビリティは目視照合**で、機械検査はしていない(トークン値の変更は稀で、design-tokens.css が正本である以上ここを機械検査する費用対効果が低いと判断)。

**条件 3: 開発者が承認済み** — 未達。記録先が E04 付録(設計書)のため実装担当には閉じられない(「詰まっている点」2)。

### DS-02 受け入れ条件の検証

**条件 1: 主要画面がトーンガイドに沿っている**

DS-02 直接責務の 6 フレームを実装した。すべて **表示専用(props ですべてのデータを受ける)** で、ゲームロジック・サーバ通信は持たない(仮定 3)。

| フレーム | 実装 | 使用部品 |
|---|---|---|
| 1b メニュー | `screens/MenuScreen.tsx` | BrandHero(ロゴ小)/ Button.primary(あそぶ)/ Button ×2 / Button.small ×2 / 注記一文 / HillDivider |
| 2a ルーム作成・参加 | `screens/RoomEntryScreen.tsx` | AppBar / SegmentedControl / Callout(4 人固定・自動補充)/ Button.primary / InputField(招待コード) |
| 2b 待機 | `screens/WaitingRoomScreen.tsx` | AppBar(2/4 人)/ MemberList(Seat ×4 + Tag)/ InviteCode / Callout+Button.small(件数+一覧)/ Button.primary |
| 3 対戦 | `screens/GameScreen.tsx` | AppBar(戦況+有効ルール導線)/ PlayerSeats ×3(手番=金)/ FieldArea / Toast(ルール発動=金)/ Log / HandTray(横スクロール・選択)/ Button ×2 |
| 5a ゲーム間リザルト | `screens/GameResultScreen.tsx` | RankRows ×4(Tag 人間/AI)/ Button(次戦へ) |
| 5b セットリザルト+評価 | `screens/SetResultScreen.tsx` | RankRows ×4 / SegmentedControl.mini(セット評価)/ VoteButton ×2×3 / Button ×2 |

部品は `packages/web/src/components/` に 22 個。うち design-system.html §5-1〜5-15 の 15 部品を React 化し、**カタログに無かったインゲーム部品 7 個(Card / HandTray / FieldArea / PlayerSeat / Log / RankRow / Callout)を新規に定義**して design-system.html の **§5-16** に見本を追加した(§2.3 手順 1「無ければ部品を足してから画面を作る」)。新規トークンは追加していない。

**条件 1': 強調色の一貫性** — ルール発動は Toast の warn(金 `--color-gold-400`)、手番強調も金、アクション系は赤 `--color-action-primary`、LOCAL は緑、地は青。役割固定に一致。

**条件 2: 逸脱がないことをレビューで確認済み**(逸脱チェック手順 1〜5)

| # | 手順 | 結果 |
|---|---|---|
| 1 | 機械検査(トークン準拠) | `pnpm lint:design` を CI に追加。`packages/web/src` の 62 ファイルに生の色ゼロ、box-shadow はトークンか none のみ、index.html の theme-color もトークン値と一致。**検査自体のテストが 11 本**(意図的な違反を入れて検出することを確認) |
| 2 | 部品カタログ整合 | 6 画面が使う要素はすべてカタログ部品(§5-1〜5-16)に対応。画面固有の独自スタイルは、画面骨格(`screen.module.css`)と 1b の注記一文のみで、いずれも部品の見た目ではなくレイアウト |
| 3 | 役割固定の遵守 | 上記「条件 1'」。破壊的操作に緑を使っている箇所なし |
| 4 | ブレークポイント目視 | 375 / 768 / 1280 の 3 幅で 6 画面すべてを描画。重要要素の見切れ・重なりなし。**全画面・全幅で横スクロールが発生しないことを `scrollWidth > clientWidth` で機械確認**。手札 HandTray は意図どおり横スクロールで収まる |
| 5 | 記録 | 本節 |

**暫定クローズ**: 仮定 4 のとおり、E1/E3 が実データを接続した時点で手順 1〜5 を再適用して最終クローズする。

### 目視で見つけて直したもの(ブラウザ実描画)

| 症状 | 原因 | 対応 |
|---|---|---|
| Web フォントが 1 バイトも読めていなかった(見えは macOS の Hiragino フォールバックで一致していたため気づきにくい) | プロセス1 レビュー指摘で `fs.allow` を絞った際に `node_modules` を落とした。フォント 118 件が 403 | `fs.allow` にワークスペースの `node_modules` を追加。ネットワークパネルで 200 と実バイト数を再確認 |
| 対局画面の「えらんだカードを出す」がピル内で 2 行に折り返して溢れる | 2 ボタンを等分していた | パスを文言なりの幅にし、主 CTA が残りを取るようにした |
| 下端の部品(主 CTA・注記)のベタ落ち影が切れる | 画面下の余白が影の分だけ足りない | 画面骨格の `padding-bottom` を `--space-5` に |
| セット評価のセグメントが未入力なのに「ふつう」が選択済みに見える | 未選択を既定値にフォールバックしていた | SegmentedControl が `value: T \| null` を受けるようにし、未選択を表現できるようにした |

### フォント同梱の実測(仮定 5 の条件)

セルフホスト(`@fontsource/m-plus-rounded-1c`)の 400 / 700 / 800 を、unicode-range で 126 分割されたサブセット css として読み込む。`font-display: swap` なので描画をブロックしない。

| 局面 | 実際にダウンロードされた woff2 |
|---|---|
| タイトル画面(初回描画) | 4 サブセット / **61KB** |
| フェーズ 1 の 6 画面を一巡した累計 | 41 サブセット / **531KB** |

日本語フォントを素朴に同梱すると 3 ウェイトで 2.7MB になるところ、unicode-range 分割により実際に描画された字の分だけに収まっている。

ただし **`@font-face` の宣言そのものが重い**(126 サブセット × 3 ウェイト = 378 宣言 = ビルド後 432KB / gzip 193KB)。当初これをアプリ本体の CSS に含めたところ、初回描画をブロックする CSS が **197KB(gzip)** に膨らんだ。`font-display: swap` によりフォントの適用は元々非同期なので、**宣言も初回描画の経路から外す**ことにした(`styles/fonts.ts` を `main.tsx` から動的 import)。

| | ブロックする CSS | フォント宣言 |
|---|---|---|
| 対処前 | 197KB (gzip) | 本体 CSS に同梱 |
| 対処後 | **4.35KB (gzip)** | 別チャンク 192KB (gzip)・非ブロッキング |

読み込み前は design-tokens.css のフォールバック(Hiragino Maru Gothic ProN 以降)で成立し、読み込み後に差し替わる。3 ウェイトを 2 ウェイトに削れば宣言も 1/3 減るが、`--font-weight-heavy: 800` はトークンの定義なので削るならデザインシステム側の変更になる(「置いた仮定」5 の裁定次第)。

### 手元での動作手順

```bash
pnpm --filter @daifugo/web dev
```

タイトル → メニュー → ルーム作成 → 待機 → 対局 → ゲーム間リザルト → セットリザルト、まで一本の導線でつながる。

## 置いた仮定(レビューで裁定してもらう)

プロセス1 で裁定済みの 1〜11 は「採用」で確定したため再掲しない(条件付きだった 4・5・6・10 の条件処理は上記のとおり)。以下はプロセス2 で新たに置いたもの。

| # | 仮定した内容 | なぜそう決めたか | 出典 | 覆ったときの影響範囲 |
|---|---|---|---|---|
| 12 | **トークン準拠の機械検査の対象を「色」と「box-shadow」に絞り、px の直値は検査しない** | E04 §2.3(3) は「レイアウト外の px 直値」も対象に挙げるが、トークン化されているのは余白・角丸・輪郭線幅で、部品の幅・高さは本来トークンの対象外。一律に禁止すると偽陽性ばかりになる(design-system.html の見本自身が `width: 56px` などを使っている)。E04 §4-1 自身が「トーン崩れの最大の原因は場当たりの色直書き」としており、そこを確実に止める方が実効性が高い。影を足したのは、ベタ落ち影が 2A の造形文法そのもので、手書きを許すとトーンが崩れるため | E04 §2.3(3)・§4-1、design-system.html の実装 | `scripts/check-design-tokens.mjs`。厳格化は後方互換に影響せず追加できる |
| 13 | **`c-input` のフォーカスリングの `rgba(43,111,194,0.3)` を `color-mix(in srgb, var(--color-focus-ring) 30%, transparent)` に置き換えた** | design-system.html の当該箇所はカタログ内で唯一の生の色関数で、デザインシステム.md §2.1 の「hex を書いてよいのは design-tokens.css / json の 2 ファイルだけ」と矛盾する。color-mix ならトークンから派生するので規約を守れて見えも同じ | デザインシステム.md §2.1、design-system.html §5-4 | `packages/web/src/components/Field.module.css` 1 行。**カタログ側(design-system.html)は変更していない**ので、見本と実装が 1 箇所だけ表現方法で食い違っている |
| 14 | **カタログの `font-size: 13px / 10px / 9px` はトークン化せずそのまま写した** | タイポグラフィのトークンは 11〜28px の 7 段で、これらは段の間の値。見た目の正は design-system.html(デザインシステム.md §2.2)なので、勝手に近い段へ丸めると見えが変わる。値を段に寄せるか新しい段を足すかはデザインシステム成果物側の決定 | デザインシステム.md §2.2 | 該当は Button.small / VoteButton / RuleCard の 3 箇所。トークン化するならデザインシステム側から |
| 15 | **インゲーム部品 7 個の造形を「KV 2A の手札の扇」に合わせて新規に決めた**(白面・紺の太輪郭・ベタ落ち影・角丸、卓の地は丘の緑 `--color-green-600`、手番強調は金) | デザインシステム成果物はアウトゲーム専用で、E04 §3.2 の対応表が要求する部品がカタログに無かった。§2.3 手順 1 に従い design-system.html §5-16 に見本を追加してから画面を組んだ。既存トークンだけで構成し、新規トークンは足していない | E04 §3.2・§2.3 手順 1、デザインシステム.md 冒頭 | 新規のデザイン判断なので **開発者の目視承認が要る**(「詰まっている点」8)。覆れば §5-16 と `components/` の 7 部品の見た目を作り直す |
| 16 | **カード選択は「持ち上がる + 金の縁 + 『選択中』の文字」で示した** | 色だけに頼らない(デザインシステム.md の規律)。金は「注意・強調」の役割に一致し、手番強調と同じ語彙になる | デザインシステム.md §3.2 | `Card.module.css` |
| 17 | **`og:image` を相対パス `/ogp.png` のままにした** | OGP のスクレイパは絶対 URL を要求するが、デプロイ先の URL が未定(E12 のデプロイ方式は改訂ノートのみ反映済み)。値を仮決めするより未確定であることを HTML のコメントに残す方が事故が少ない | E12 §4.6 改訂、E04 §2.1.2 | `packages/web/index.html` 1 行。デプロイ先確定時に絶対 URL へ差し替える |
| 18 | **画面骨格のコンテンツ幅上限を 480px にした** | スマホ縦がメインターゲット(企画書 §1)で、design-system.html の適用例も 375px フレーム。PC で 1280px 幅いっぱいに伸ばすと 1 行が長くなりすぎて可読性が落ちる。480px は 375 の見えを保ったまま余裕を持たせる値 | 企画書 §1、design-system.html §6 | `screens/screen.module.css` 1 行。PC 向けに専用レイアウトを起こす場合は要再設計 |

TS-02 の仮定 4 件は `decision-log.md` §G に裁定記録として移ったため、本書からは外した。

## 2 周目に回したもの

プロセス2 で消化済み(下記のとおり)。**未消化で残っているのは 1 件のみ**。

| 項目 | 状態 |
|---|---|
| Web フォントの同梱 | 済(実測付き) |
| favicon(4 サイズ)/ OGP 画像の事前生成 | 済(`scripts/generate-design-images.mjs`、生成物は `packages/web/public/`) |
| CI のトークン準拠検査 | 済(`pnpm lint:design`。CI に追加) |
| キービジュアル SVG の静的検証 CI | 済(同上。`xmllint --noout` + 外部参照検出 + viewBox。テスト 6 本) |
| design-system.html の 15 部品の React 化 | 済 |
| 6 フレームのトーン適用 | 済 |
| インゲーム部品の見本追加 | 済(§5-16) |
| **ロゴ「大富豪」のアウトライン化(E04 §5-1)** | 済(B-8 で「実施」と決定(2026-07-26)、`334fdc9` で KV 全テキストをアウトライン化) |

## 詰まっている点(人間の判断待ち)

プロセス1 から継続の 1〜5 は未解決のまま(レビュー側で decision-log への昇格をお願いしたい)。6 以降はプロセス2 で新たに出たもの。

1. **E04 設計書の状態が「提案(開発者の承認待ち)」のまま**で、`decision-log.md` A 節に E04 承認の記録がない。
2. **DS-01 受け入れ条件 3「開発者が承認済み」は実装担当には閉じられない。** 記録先が E04 付録「承認記録」= 設計書で、設計書は実装作業で変更しない契約(implementation-workorder §4-2)。承認日・対象(`key-visual-2a.svg` + トークンのコミットハッシュ)・承認者の記入をお願いしたい。
3. **E04 §5 の未決事項 6 件が `decision-log.md` に未登録。**
4. **インゲーム部品がデザインシステム成果物に無かった件** — プロセス2 で §5-16 として追加した(仮定 15)。**新規のデザイン判断なので開発者の目視承認を関門にしたい**(下記 8 と同じ)。
5. **キービジュアル 2A に JOKER カードが描かれているが、素の大富豪 v1(decision-log A-3、2026-07-25 決定)は「ジョーカーを初期から除外」としている。** 2A の決定は 2026-07-24 で A-3 より前。原資産は勝手に変更しない契約なので報告に留める。**OGP 画像も 2A から生成しているので同じ食い違いを含む**(共有先で最初に目に入る絵)。プロセス2 レビューの補足: 共有導線で最初に見える絵なので、**フェーズ 1 の公開前に整合の判断を付けるのが安全**。→ **解消**: decision-log **B-13(2026-07-26 決定)**で「当面このまま(絵としての賑やかさを優先して差し替えない)」と開発者が決定済み(2026-07-27 に再確認)。
6. **ロゴのアウトライン化(E04 §5-1)を実施していない。** 判断だけお願いしたい。

   当初「元フォントの入手とツールが障壁」と書いたが、これは**過大な見立てだった**(プロセス2 レビューで指摘)。M PLUS Rounded 1c は OFL でフル TTF が公式配布されており、fontTools + brotli で woff2 の伸長もできるので、**技術的な障壁は実質ない**。

   実際の関門は 2 つ: (a) 実施するかどうか自体が E04 §5-1 の未決事項、(b) パス化した字形が 2A の見えを保っているかの合否は人間の目視でしか下せない。承認ループの手前で投機的に作らず、**「実施の可否」だけ決めてもらえれば次のサイクルで機械的に進められる**状態にしてある。現状はライブテキスト版のままで、Android/Windows ではロゴの字形が変わる。→ **解消**: decision-log **B-8(2026-07-26 決定: 実施)**。コミット `334fdc9` で KV 全テキスト 23 件をパス化し、`lint:design` に正本との一致検査を追加済み。
7. **DS-02 受け入れ条件 2 の最終クローズを E1/E3 の受け入れに積む必要がある**(仮定 4 の条件)。decision-log E 節への登録をお願いしたい。
8. **開発者の目視承認をお願いしたい 2 件**: (a) インゲーム部品 7 個の造形(仮定 15。design-system.html §5-16 と実画面)、(b) favicon の意匠(赤・金・緑の 3 枚札。`packages/web/public/favicon.svg`)。どちらも差し替えは安い(favicon は生成スクリプトの再実行 1 回)。
9. **`og:image` の絶対 URL**(仮定 17)。デプロイ先が決まったら差し替えが要る。→ **解消**: E13 で本番 URL(`https://daifugo-together.fly.dev/`)の絶対 URL へ確定済み(本書 E13 節)。
10. **Git remote が無いため GitHub Actions 上での CI 実行は未確認**(TS-02 から継続)。ローカルの `pnpm verify` 相当までは確認済み。→ **解消**: リポジトリを GitHub(public、A-2)へ公開済みで、CI は GitHub Actions 上で実行されている(実行速度差の吸収 `a48448f`)。
11. **実機のノッチ/ホームインジケータでの見え** は未確認(E04 §3.1(d) のとおり持ち越し)。ブラウザでは `env(safe-area-inset-*)` が 0 になるため、セーフエリアの効きそのものは検証できていない。
12. **decision-log C-5 は E7 内包モデルで決定・反映済み。** `failed → implementing` は廃止し、`failed` 遷移時に `attempt_count=1` を記録して部分ユニーク索引から即時に外す。再試行は E7 の `pipeline_jobs.attempt` 内で扱う。

TS-02 から継続で未解決のもの:

- E12 §4.1 は Node.js LTS を指定しているが、ユーザー判断で趣味プロジェクトとして Node.js 26 Current への最新追随を優先した。実装・CI・決定ログは Node 26.5.0 に更新済みだが、作業指示に従い `docs/epics/E12-tech-stack.md` 自体は変更していない。

## 設計への提案・気づいたこと

- **E01 §「セット総合順位の算出」の順位点 4-3-2-1(一般式 人数−順位+1)が実装(5-3-2-1・4 人固定)と乖離した。** 2026-07-27 の開発者指示による変更で、E01 側の記述更新を提案する(実装は `packages/core/src/set/scoring.ts` の `POINTS_BY_STANDING`)。
- **E04 §2.1.1 の「`src/assets` へコピー」は、§2.2(3) の「正本を 1 つに保つ」と手段が食い違っている。** 実装では alias 直接参照を採った(仮定 1・プロセス1 で採用裁定済み)。設計書側の記述の更新を提案する。
- **E04 §1.3 は デザインシステム成果物を「並行作業で構築中」と書いているが、実際は 4 ファイルとも完成済み。** 状態記述の更新を提案する。
- **`design-system.html` §5-4 のフォーカスリングだけがカタログ内で規約違反(生の色関数)**(仮定 13)。実装は color-mix に置き換えたが、カタログ側は触っていない。デザインシステム成果物側での修正を提案する。

---

## 並行進行: E1 ゲームエンジン

- 状態: GE-02・GE-03・GE-05・GE-04 のプロセス2実装完了。11回目の独立 GPT-5.6 Sol 完了レビューで追加された公開 Effect port の入出力隔離も修正し、再レビュー待ち。
- プロセス1: `8c38c3d`（リベース前 `a3e98a1`）
- プロセス2: `841745a`
- 検証: Node 26.5.0 / pnpm 11.17.0 / TypeScript 6.0.3 で `pnpm verify` 成功。統合リポジトリ全体は 14 files / 105 tests。format・lint・design lint・typecheck・build 成功。ルールなし200セットは0.32秒、違反0・failsafe 0。

### 完了内容

| ストーリー | プロセス2で仕上げた内容 |
|---|---|
| GE-02 | 権威判定と合法手表示の一致、スキップ消化、リード手詰まり保護、1000手強制終局、秘匿走査 |
| GE-03 | `forceRank` の退場・非公開札隔離・競合時の近傍順位割当、全順位確定 |
| GE-05 | draining、`setEnded`、set履歴・set KVのゲーム間参照、受理済みアクション追記境界、リプレイ実行器 |
| GE-04 | 全Effect語彙、優先度・競合解決、resolutionログ、全フック、KVクォータ、4 fixtureの全16部分集合、シミュレーション |

プロセス1の独立 GPT-5.6 Sol レビューは `GO_WITH_FIXES`。指摘された権威状態の可変参照、ルール間で共有された RNG/KV、合法手フェイルセーフの不一致、未接続フック、B-4 のアクションログ境界をすべて反映した。

プロセス2の独立 GPT-5.6 Sol 完了レビューでは、(1) E2向け `SimulationApi` 未公開、(2) `moveCards` でactiveの手札が0枚になった後の順位未確定、(3) field→同一fieldの全札移動によるカード消失、(4) `onGameStart` だけで終局したゲームがSet側で進まない、(5) `afterFieldClear` でactiveが1人以下になった後に終局しない、の5件を再現。すべて修正し、最小再現を回帰テストへ追加した。

2回目の独立レビューでは、(1) hook固有引数の可変参照、(2) `announce.params` への非公開カードID混入、(3) `SimulationApi` がset KVを次手へ引き継がない、(4) fallbackが単騎だけを仮定、(5) `turnLimit` failsafeをシミュレーション違反にしない、の5件を再現。hook引数の複製・deep freezeと例外隔離、非公開カード参照announceの棄却、`SimulationPosition { state, setMemory }` の明示的な状態包絡、全合法手からのfallback、failsafe種別集計とforced-termination違反化で修正した。あわせてルールなし経路の不要なcontext構築と各手のJSON全量往復を除き、200セット実測を37.42秒（レビュー値）から0.53秒へ短縮した。

3回目の独立レビューでは、(1) 過去に公開されたカードを非公開手札へ戻すと、そのIDを`announce`に再掲できる、(2) `modifyLegality`返値の複製時にgetterが投げた例外がルール境界を抜ける、の2件を再現。現在hand/excludedにあるカードIDは公開履歴にかかわらず常に非公開参照として棄却し、フック返値の複製・形状検証・比較・採用を同じ例外境界内へ移した。getter例外と不正形状を含む最小再現を回帰テストへ追加した。

4回目の独立レビューでは、(1) 同一Effectバッチ内で公開領域から手札へ戻したカードIDを後続announceで公開できる、(2) `skipTurns.count=NaN`がスキップ解決を停止させる、(3) `PlayerSnapshot`のネスト参照から権威状態を変更できる、(4) `startSet`では初回`onGameStart`のEffect解決ログを取得できない、(5) E09所有の`PriorityKey`正準型と公開型が不一致、の5件を再現。announceは全状態Effect適用後の最終状態で検査し、Effect payloadを有限整数・JSON値等のruntime境界で棄却し、snapshot全体をdeep cloneした。初回イベントを返す`startSetTransition`を追加し、`startSet`は状態だけを得る便宜APIとして維持した。PriorityKeyはE09どおり`{ score, activatedAt: epochMs, ruleId }`へ統一した。各最小再現を回帰テストへ追加した。

5回目の独立レビューでは、(1) 欠落zone・不正scope・null params・非配列返値などEffect全体のruntime形状検証不足、(2) `onGameStart`の`skipTurns`を第1手番前に消化しない、(3) `ruleId`比較がE09のコード単位辞書順でなくlocale依存、を再現。Effect配列と判別可能ユニオンを`unknown`境界から例外安全に検証し、開始直後にも通常同等のskip/非active手番解決を通し、比較関数をE09掲載どおり`<`/`>`へ統一した。各最小再現を回帰テストへ追加した。

6回目の独立レビューでは、(1) Effect の余剰フィールドに `BigInt`・`Date`・`Map`・非有限数・`undefined` を含めても採用され、返却遷移が JSON 非安全になる、(2) 不正な `byRank.rank` が形状検証を通る、(3) 公開 `RuleChainPort` が非配列 `effects` を返すと例外が境界を抜ける、を再現。Effect・Zone・CardSelector の許可キーと CardRank 列挙を含む JSON-safe な exact-shape 検証へ強化し、不正 payload は JSON-safe な内部代替値で棄却ログへ記録するようにした。公開 port の返値も `unknown` として配列形状を検査し、例外・不正値をゲーム停止なしで隔離した。

7回目の独立レビューでは、(1) `clearField` → `afterFieldClear` 終局経路で `fieldCleared`・`playerRetired` が state の公開履歴へ二重追記される、(2) 公開 port が同じ `ruleId` を複数 entry に分けると1フック8 Effect上限を回避できる、(3) `onGameStart` だけで終わる初戦をシミュレーションの発動数・平均手数へ集計しない、を再現。終局分岐では未追記の終局イベントだけを履歴へ加え、Effect indexをruleId単位で通算し、simulationは`startSetTransition`の初期イベント・初期結果から集計を開始するように修正した。

8回目の独立レビューでは、`modifyStrength` が関数を要素に持つ不正な `ranking` を返すと一度採用され、次の context 複製で `DataCloneError` が境界外へ漏れることを再現。返値の複製と、`CARD_RANKS` 全要素を重複なく一度ずつ含む exact-shape 検証を同じ例外境界内で行い、不正返値は直前の有効な強さ順を維持して無作用に隔離するようにした。

9回目の独立レビューでは、独自実装の公開 `RuleChainPort.modifyStrength` から同じ不正返値を返すと in-process adapter の検証を迂回でき、候補列挙・snapshot・SimulationApi の3経路で例外になり得ることを再現。公開 port 呼び出しを共通safe adapterへ集約し、`modifyStrength`は完全なCardRank順列、`modifyLegality`は候補数と一致するexact-shapeの結果だけを採用するようにした。例外・不正値・未知のinfluenced ruleIdは基本判定と空influencedへ隔離する。

10回目の独立レビューでは、公開 port が `modifyStrength` 入力の基礎順序を反転して共有定数を恒久変更でき、`modifyLegality` 入力候補のCard参照を通じて権威handを変更できることを再現。portへ渡すentries・基礎順序・候補手・基礎合法性をdetached clone + deep freezeし、入力破壊を試みた呼出しも基本判定へ隔離するようにした。RuleContextは元から全共有データがdeep freeze済みのため維持した。

11回目の独立レビューでは、公開 port の `collectEffects` だけが `config.ruleChain` と `afterPlay` の権威Card参照を直接受け取り、返した `setMemory.value` もport側の保持参照とstateで共有されることを再現。共通 `safeCollectEffects` 境界でentries・フック固有引数をdetached clone + deep freezeし、返値も例外境界内で `structuredClone` してから形状検証・適用するようにした。入力破壊と返値の事後変更を同時に試みる最小再現を回帰テストへ追加した。

### E1で置いた仮定

| 仮定 | 根拠 | 影響範囲 |
|---|---|---|
| 契約 v1 は choice と `afterPass` を持たない | decision-log B-1 は未決だが E01 が暫定 B を明示 | RuleHooks、E7 の却下分類 |
| `turnCount > 1000`、KV は 32 keys / 1KB value / 16KB namespace | decision-log B-2 は仮値で着手可 | reducer、Effect適用、simulation |
| B-4 は core に保存先を持たせず、受理済みアクションの追記ポートとリプレイ型・実行器を提供 | 保存先・保持期間は未決だが、書込み開始点は確定可能 | `set/types.ts`、`replay/replay.ts`。永続実装は server / OP-03 |
| draining中は進行中ゲームを完走し、ゲーム間なら即時、ゲーム中なら終了直後に既存結果で `setResult` | E01改訂ノート、E12 §4.5 | `requestDrain`、`SetOutcome.completion` |
| 空のfieldを移動先にする `moveCards` は棄却 | `Zone.field` に `FieldState.current.by` を決める情報がない | `engine/effects.ts`。契約拡張時に見直し |
| 上書き直前の `field.current` は `discard` へ移す | 最新プレイ1件のFieldStateとカード保存を両立 | reducer、snapshot |

### E1で見つけた設計書の不整合

- E01の旧節に54枚・14/14/13/13が残るが、同文書の確定版と decision-log A-3 はジョーカーなし52枚・13枚ずつ。実装は確定版に従った。
- E01 §3.4の一部に次戦先手を前戦大貧民とする旧BR-11が残る。実装は確定版どおり毎ゲームのダイヤ3保持者。
- 空のfieldを移動先にする `moveCards` は、所有者 `by` の決定規則が契約にない。現在は例外を投げず棄却し、resolutionログへ理由を残す。
- E01 §2.12 の `createSimulationApi(chain, port)` だけでは、§2.2で分離された必須 `GameConfig`（gameSeed・seats・gameIndex）と `PlayerSnapshot` 用のセット文脈を復元できない。実装は `createSimulationApi({ config, snapshotContext, runtime })` とし、静的入力をfactoryで固定する形に読み替えた。E2はこの公開面を使用する。
- 同じくE01 §2.12の `GameState` 単体では、§2.8で別管理されるsetスコープKVを複数手シミュレーションへ引き継げない。実装は `SimulationPosition { state, setMemory }` を各APIの入出力にし、探索分岐ごとの純粋性を保った。E2はpositionをプレイアウトごとにスレッドする必要がある。

---

## 並行進行: E2 対戦AI

- 状態: AI-01 完了、main `25317dc` へ反映済み。独立 GPT-5.6 Sol 完了レビューで同期 throw の境界漏れを検出・修正し、別コンテキストの再レビュー `GO`。main 検証で発見した clean checkout の宣言生成順も修正し、さらに別の独立レビューで全 `dist` 欠落条件から `GO`。
- 検証: Node 26.5.0 / pnpm 11.17.0 / TypeScript 6.0.3。正規リポジトリは 17 files / 122 tests、format・lint・design lint・typecheck・build 成功。専用 `pnpm validate:ai` は500セット・1,500ゲーム完走、rejection 0、不正手0、fallback 0、random-legal 3席に対する平均報酬0.6847。lockfile再解決後の `pnpm outdated` は、ユーザー指定で固定したTypeScript（current/wanted 6.0.3、latest 7.0.2）以外0件。`@types/node` は26.1.1。main のローカル実行では ignored の `.claude/worktrees` 内テストも Vitest が拾ったため20 files / 153 testsとなったが、tracked test filesはレビューcloneと同じ17件。
- ユーザーストーリー確認: `packages/ai/src/ai-player.test.ts` の「1人+AI 3人で3ゲームのセットを拒否なく完走する」で、人間席1・AI席3の3ゲームセットを実際の E1 reducer に通し、全着手の rejection 0、結果3件、`completion=completed` を確認。

### プロセス1で実装した方向

- AI入力は `PlayerSnapshot` と権威側が列挙した `Play[]` のみ。他人の手札を型・実行時データのどちらでも渡さない。
- 観測済みカードを除く52枚を、相手の公開残枚数に従ってseed付きで一様再配布する決定化。
- 深さ1のルートUCB1、打ち切り付きロールアウト、順位報酬 `[1, 2/3, 1/3, 0]`、同一入力・seedの決定性。
- Node標準 `worker_threads` の起動時warm-up・FIFO・1本再利用プールで探索。反復途中の統計を親へ送り、hard timeout時はpartial-search、統計0件なら最弱合法手へフォールバック。終了した旧workerの通知は新世代のジョブへ影響しない。
- hard deadlineはキュー投入時から計測し、待機中に期限切れなら即座にfallbackする。workerが終了コード0を含め予期せず終了した場合もactiveを必ずsettleし、次世代workerで待機ジョブを続行する。
- プロセス1の既定8プレイアウトではルート候補を最大4件に絞り、少なくとも1回はUCB1の再訪選択が起こるようにした。TS-03較正後は既定16プレイアウト・候補上限8・進捗batch 4へ更新した。`playoutBatchSize`はworkerから親へ進捗統計を送る最大反復間隔、`sliceMs`は進捗送信の最大経過時間として使い、hard timeout時に新しいpartial結果を回収する。
- 外部AI API・HTTP・DB依存なし。合法手0件の強制パスはゲームループ側が即時処理する。

### E2で置いた仮定

| 仮定 | 根拠 | 影響範囲 |
|---|---|---|
| worker poolは1本、既定予算をsoft 50ms / hard 200msとする | Node 26のTS-03実測では1本でもイベントループを塞がず既定16プレイアウトをp95 40.8ms、最大80.2msで完了。shared-cpu-1xで2本はCPU総量を増やさない | `AiWorkerPool`、`ThinkBudget`。shared-cpu-2xへ移行する場合だけ再較正 |
| プロセス1は提案ルール0件なので、worker内の決定化状態は空のrule chainで復元する | AI-01はフェーズ1。ルール追従はAI-02（フェーズ2） | `worker-entry.js`。プロセス2ではE1 runtime/configをworker要求へ運ぶ境界を確定する |
| seed固定時の決定性を優先し、soft予算は壁時計打切りではなく `floor(softMs / 3)` を上限反復数へ変換する（既定50msで16本） | Node 26・cutoff 24のTS-03実測は約0.9 playout/ms。共有CPU・将来ルールのため約3倍の余裕を確保 | 探索反復数と強さ。500セットでもfallback 0、最大80.2ms |
| `legalPlays.length === 0` はAIを呼ばずサーバーゲームループがpassする | E02の `AiDecision.play: Play` はpassを表現できない一方、本文は「0=パス強制」と明記 | E3のAI手番駆動。戦略的passは初版方策の「出せるなら出す」に従い選ばない |
| 0.4〜1.2秒の演出遅延は探索ライブラリに入れず、着手を表示するserver/web側で入れる | CPU探索とUX待機を分離し、テストと再利用を決定的に保つ | E3/E4統合 |

### プロセス2で完了したもの

- `scripts/validate-ai.mjs` で500セット・1,500ゲームを実エンジンとworker AIへ通した。rejection 0、不正手0、fallback 0、全セット停止。random-legal 3席に対する平均報酬0.6847（基準0.60）、16,628着手の平均18.2ms・p95 40.8ms・最大80.2ms。
- worker crash、探索例外、全サンプル失敗の障害注入。hard timeoutのpartial/heuristic分岐、旧worker終了後の次ジョブ継続、12世代連続crash/recoveryを回帰化した。
- TS-03実測からpool 1本、約0.9 playout/ms、root cap 8、batch 4、cutoff 24、既定16プレイアウトへ較正した。hard 200msに対し正式検証の最大は80.2ms。
- 非LLM・非ネットワーク依存をCIで機械検査するルール。
- serverの `runAiTurn` に既定1秒watchdog、例外・不正手時のengine fallback、0.4〜1.2秒の演出遅延、`ai_playouts_per_move`・`ai_fallback_total`・`ai_move_wall_ms` と構造化ログを実装した。AIの探索とUX待機は分離している。

プロセス2着手として `scripts/check-ai-boundaries.mjs` を `pnpm lint` に接続し、`packages/ai` の LLM SDK・HTTP/ネットワーク組込み・直接ネットワークAPIを機械的に拒否するようにした。違反 fixture を拒否するメタテストも追加した。

障害注入は、worker が探索エラーを返した場合の合法 heuristic fallback と同一 worker の次着手再利用、および終了コード 0 の crash → 再生成 → 待機ジョブ継続を12世代連続で確認する stress テストまで追加した。

提案ルールを含むworker境界はAI-02（フェーズ2）へ維持する。`RuleRuntime.port` は関数を含みstructured clone不能なので直接渡さず、serializableなルールID・設定・setHistory・公開可能memoryを送り、worker側で同じbundleをimportしてruntimeを再構成する。決定化factoryもcore側へ寄せる。

### AI-02 プロセス1（新ルールへの追従）

- 方針はE02 §3.2どおり「AIはルールの意図を解釈せず、権威エンジンの合法手と同じルール適用後の世界で探索する」。ルールPRから`packages/ai`は変更しない
- `AiRuleContext`にセット開始時の固定`RuleChainEntry[]`、ローカル`file:` module URL・bundle hash・contract version、game/set memory、set historyを追加した。関数をpostMessageせず、workerが同じRuleModuleをimportして`createInProcessRuleChainPort`と`createSimulationApi`を再構成する
- workerはchainとbundle集合の1対1対応、重複、`file:`限定、bundle hash、contract version、module metaを検証する。不一致・import失敗は既存の合法heuristic fallbackへ落ちる
- 本番のAI合法手列挙も、従来の`NO_RULE_CHAIN_PORT`固定からセット専用の権威portへ接続した。AIが返すroot手は引き続き権威側が列挙した`legalPlays`の要素に限定され、serverが再検証する
- ユーザーストーリー確認: `packages/ai/src/ai-player.test.ts`の「worker内でも固定ルールbundleを読み、合法手だけで新ルール有効セットを完走する」で、毎playにEffectを返すfixtureルールを権威側とworker側の両方へ渡し、AI 4席・1ゲームをrejection 0で完走、worker統計のrule ID、set resultの発火rule IDを確認した
- focused検証: AI/server typecheck成功。`ai-player.test.ts / rules.test.ts / socket-gateway.test.ts`: **3 files / 29 tests成功**。format・lint・AIネットワーク境界も成功

#### 置いた仮定（方向性レビュー対象）

| # | 仮定した内容 | なぜそう決めたか | 出典 | 覆ったときの影響範囲 |
|---|---|---|---|---|
| AI02-P1-1 | workerへ渡すbundle参照は、serverが検証・ロード済みのローカル`file:` URLとし、URL自体を公開契約には含めない | RuleRuntimeの関数はstructured clone不能。workerが同一デプロイ成果物をimportすればルール再実装を避けられる | E02冒頭改訂ノート・§3.2(c)、AI-01引継ぎ | `AiRuleBundleRef`、CX-05の静的registry/loader |
| AI02-P1-2 | 初版は権威状態のgame/set memoryをworkerへ複製する | E02が初版方針として明記し、現契約にmemoryの公開/秘匿区分がないため | E02 §3.1(b)(f)-3・§6-3 | `AiRuleContext`。秘匿区分導入時はAI用projectionへ置換 |
| AI02-P1-3 | bundle欠落・不一致・import失敗時は、ルールなしで探索を続けず合法heuristic fallbackへ落とす | 誤った世界で高コスト探索するより、権威`legalPlays`から即答して合法性・時間・停止性を守るため | E02 §3.2(d)-3/4 | worker loader、fallback計測。CX-04 incidentとの接続はプロセス2 |

#### プロセス2に回したもの

- CX-03のsimulation jobをrandom-legalから**実worker AI 4席・小予算**へ置き換え、新規のみ/全ルールの両構成を各200ゲーム×5 seedで検査する
- AI込みハーネスの`illegalPlay / nonTermination / timeout / exception`とfallback率・playouts/moveを集計し、悪性fixtureが正しくfailするメタテストを追加する
- bundle欠落・meta/hash/contract不一致、hook例外、全sample失敗、hard timeout、worker crash、複数ルール・memory継続をAI-02境界で回帰化する
- CX-05の`packages/rules` loaderと`RuleRegistryService`へ実module URLを接続し、起動時同期・本番AI・対局権威が同じregistry snapshotを使う

#### 方向性レビューとプロセス2反映

- 独立 GPT-5.6 Sol の方向性判定は **GO_WITH_FIXES**。中心方針は採用し、Important 5件をprocess2冒頭で反映した
- 権威側とworker側の意味一致: `AiRuleContext`を権威runtime snapshotとして、対局の`gameSeed`・現在の`hookCalls`・game/set memory・セット内で障害隔離済みの実効rule chainを渡す。`setHistory`の二重入力は削除し、workerは`PlayerSnapshot.setResults`を単一の正として使う
- memoryは実効chainのrule ID名前空間だけをworkerへ投影する。初版のKV複製はレビュー裁定どおり暫定採用だが、秘匿区分がない現契約では「チートなし」の完全保証にならない点を維持する
- bundle同一性: `packages/rules`のビルド前generatorが全ruleを静的importするregistryを生成し、ロードしたcompiled JS bytesのSHA-256、module URL、moduleを同じregistrationに束ねる。workerは`file:`、64桁SHA-256、実bytes、chain/ref、contract/metaを検証してからhash付きURLでimport/cacheする
- 障害fallback: workerのnative hook例外・不正返値を`onIssue`で探索失敗へ昇格し、bundle/hash/import失敗と同じ合法heuristic fallbackへ落とす。server側bundle resolverも`runAiTurn`の失敗境界内へ移し、同期例外を`engine-fallback`として計測する
- 空registryの危険なrevert同期は一旦削除し、その後、生成済み静的registryのロード成功を完全性境界として再接続した。ハードコードした`[]`を「全コード削除」と解釈する経路はない
- 縦切りfixtureはannounceだけでなくgame memoryと決定的RNGを使って強さ順を反転する。authority viewとworker統計の実効強さが一致し、実ルール効果を観測する。bundle実体不一致、hook例外、次着手回復も回帰化した

#### AI込みCX-03 simulation

- E1の既存`simulate`を、同じset reducer・カード保存・終局・Effect不変条件検査を所有する`createSimulationRun` generatorへ分離した。従来random-legalはgeneratorの同期consumer、AI-02はasync consumerであり、対局ループと検査を二重実装しない
- `packages/sim`の実行CLIを`runAiRuleSimulations`へ切り替えた。new-only / all-rulesの2構成、指定games × 5 seed、worker AI 4席・小予算で実行し、不正手、非終局、Effect/hook障害、fallback、1手wall timeをCI違反へまとめる
- E02の「200 games」と既存coreの「3ゲームset数」の単位差を解消するため、CI runnerは`gamesPerSet=1`を明示する。CLIの`--games 200`は各構成・各seedで正確に200ゲームを表す
- `packages/sim` loaderもcompiled ruleの実bytes SHA-256とmodule URLを同時に返し、CI authority portとworkerが同じbundle集合を使う
- focused検証: AI/server/sim/core typecheck成功。AI fallback・rule registry・AI turn・simulation/loaderを含む対象テスト成功。最終の全体`pnpm verify`もformat/lint/design/typecheck、61 files / 417 tests、全package buildまで成功
- TypeScript buildが素のJavaScriptである`worker-entry.js`を`dist`へ出力しない問題を検出し、AI packageのbuildでruntimeファイルを明示コピーするよう修正した。source testだけでなく配布成果物でもworker実体が必ず揃う
- 独立完了レビューは初回`PARTIAL / CHANGES_REQUESTED`。Docker runtimeに新規依存`packages/rules/dist`が欠ける配布物不備、CIが500/600msを許す時間不変条件の緩和、公開`cardsMoved`後の既知カードzoneをworkerが復元しない権威差の3件を検出した
- Dockerfileへrules成果物を追加し、runtime workspace成果物の列挙テストを追加。CI workerは`hardMs=150`、1手wall上限200msへ締めた。レビュアーのNode 26実測はnew-only/all-rules × 5 seed × 200 games = 2,000 games、83,698 AI着手、201.01秒、最大59.51ms、fallback/違反0
- worker決定化は`played`・`fieldCleared`・公開`cardsMoved`を順に反映し、既知カードを現在のhand/field/discardへ固定する。非公開hand-to-hand移動では既知性を解除し、最終hand/discard数と52枚保存が合わなければ合法heuristic fallbackへ落とす。public→hand→publicの両方向を強さ順の観測差で回帰化した
- 修正コミット`02c15bd`の独立 GPT-5.6 Sol 再レビューは、要件 **PASS** / 品質 **APPROVED** / Critical・Important・Minorなし。focused 3 files / 18 tests、AI/simulation typecheck、lint/format、差分検査も再実行された

#### 残る外部・後続ゲート

- 実生成ルールを含む200ゲーム×5 seed×2構成のCI所要時間は最初のrule PRで実測し、workflowの10分timeout内でbudget/並列度を較正する
- CX-05のDB同期（コードにありDBにないruleの`pending_enable`登録）、提案`released`遷移、実デプロイ後の有効化は次ストーリーで接続する
- 実repositoryのruleset/required checks、実subscription Codex、実PR・CDリハーサルは従来どおり開発者権限を要する外部受入ゲート

### CX-05 プロセス1（ゲームへの反映）

- `packages/rules`の生成registryに、ルールmodule・実bundle hash・module URLに加えて、ディレクトリ由来のslugと初期versionを束ねた。サーバー起動時はこの完全なregistryとproposal / pipeline jobを照合し、コードにありDBにないルールを`disabled/pending_enable`で登録して`rule_versions`へPR番号・merge SHAを保存する
- 管理APIの初回enableは、`rules: disabled → active`、`proposals: implementing → released`、`pipeline_jobs: merged → done`を同じSQLite transactionで確定する。proposalの`status_changed_at`がRP-03の一覧内通知・未読表示の正であり、別通知基盤は作らない
- 結合テストでは、merged jobを持つコードruleの起動時同期 → pending確認 → enable → released/done確認 → 次セット開始 → `afterPlay`の`ruleFired`発生までを通した。同期とenableの再実行は重複行・重複通知を作らない

#### CX-05で置いた仮定・プロセス2送り

| ID | 仮定・残作業 | 根拠 | プロセス2での扱い |
|---|---|---|---|
| E7-CX05-P1-1 | 初期スコープは新規ルールのみなのでregistryのversionは1。slugは`r{番号}-{slug}`ディレクトリから生成する | E07 §5.1-3は既存ルール更新を初期スコープ外としている | 不正ディレクトリ・job/meta不一致・部分同期からの回復を追加検証 |
| E7-CX05-P1-2 | PR番号とmerge SHAはデプロイ先DBに既存の`pipeline_jobs`を正とする | 人間承認フローで`pr_open → merged`時に両値が記録され、proposalIdでコードmetaと結合できる | 欠落時fail-closed、再起動・旧DB migration、トランザクション障害注入を網羅 |
| E7-CX05-P1-3 | RP-03通知はE05確定案Aどおりproposalの状態変更時刻を用いる。release logは運営観測用で、別outboxは作らない | E05 §3.3は一覧内バッジ+メニューバッジを推奨・確定 | RP-03画面/APIとの結合はE5残作業で検証 |
| E7-CX05-P1-4 | 実CD・実ルールPR・「開発者操作3点」の実績はローカルFakeでは代替しない | CX-05受け入れ条件が実績を要求し、GitHub/Fly/開発者承認が必要 | DP-02完了後の外部受入リハーサルとして記録 |

#### CX-05 プロセス1レビュー

- 独立 GPT-5.6 Sol の方向性判定は **GO_WITH_FIXES**。Criticalなし、Important 3件をプロセス2の先頭へ採用した
- 初回公開前の`disabled/pending_enable`へ一般disableを許すと、後のenableがruleだけをactiveにしてproposal/jobを未完了に残す問題を再現。pendingへの一般disableを409相当で拒否し、初回公開か再enableかはproposal/jobの組状態で判定する方針へ変更した
- 恒久revert済みの同一versionを旧デプロイが再登録・再enableできる問題を再現。enableと対局ロードはcurrent・未revert・version・contract・PR・merge SHA・bundle hashの完全一致を必須にした
- `pipeline_jobs`だけをmerge provenanceの正とした仮定 E7-CX05-P1-2 は**変更**。PR作成時head SHAとGitHubの実merge commitを分離保存し、共有skillが同じレビュー・マージ操作内でGitHubを照合して`pr_open → merged`を記録する。デプロイ成果物の実bytes SHA-256は`rule_versions.bundle_hash`へ固定する
- Minor 2件も採用。同期結果はtransaction commit後にだけ成功配列へ追加し、release後の運用ログ失敗は既にcommit済みのHTTP成功を500へ変えない

#### CX-05 プロセス2実装

- `pipeline_jobs.merge_sha`を加算migrationで追加。`head_sha`はレビュー済みPR head、`merge_sha`はGitHubの`mergeCommit.oid`として分離した。`implement:merged`はPRの`MERGED`状態・`mergedAt`・head一致・merge commit形式を検証し、記録済み時もGitHubと再照合して冪等に終了する
- 実装skillはgreen確認後に開発者へレビュー・マージを依頼し、同じ対話内で`implement:merged`を実行するよう更新した。自動mergeはせず、開発者操作3点の数え方も維持する
- `rule_versions.bundle_hash`を加算migrationで追加。同一versionのupsertによるrevert解除を廃止し、既存版のprovenance変更を拒否する。旧DBのcurrent/未revert版だけは、既存PR・merge SHA・contractが完全一致するときに限ってbundle hashを1回補完する
- 起動時同期、enable、対局開始時ロードの3境界すべてで、コードmeta/slug、current未revert版、version/contract、PR/merge SHA、実bundle hashを照合する。不一致ruleだけを`load_failure`として外し、正常ruleの同期・対局は継続する
- pending同期→再起動→初回enable→再起動、pendingへのdisable拒否、恒久revert後の旧image、同一version bundle差替え、部分transaction失敗、ログcallback失敗、複数ruleの部分失敗をファイルSQLiteで回帰化した
- 実ruleディレクトリfixtureで静的registry generatorを実行するテストを追加し、そこでディレクトリからslugを落とす正規表現の既存escape誤りも検出・修正した。複数roomが同じ有効chainを固定することも検証した
- focused検証は6 files / 41 tests、server/pipeline typecheck、変更ファイルlint、`git diff --check`が成功。全体`CI=true pnpm verify`もformat/lint/design/typecheck、64 files / 431 tests、全package buildまで成功した。初回全体実行ではAI simulationが並列負荷下で41手中1回だけ150ms fallbackとなったが、単独5連続と全体再実行は成功しており、GitHub上の長時間性能ゲートで継続観測する

#### CX-05 プロセス2初回再レビューと追加修正

- 修正コミット`778b368`への独立 GPT-5.6 Sol 再レビューは **GO_WITH_FIXES**。プロセス1の主指摘5件はすべて解消確認済みで、Critical・Minorなし。追加Important 2件を独立SQLiteプローブで再現した
- 旧DBへ`pipeline_jobs.merge_sha`列を追加すると既存`merged/done`行がNULLになり、当初の`implement:merged`ではGitHub照合後も補完できなかった。GitHubのreview済みheadと実merge commitが一致した場合に限り、NULLの既存行を`merged→merged` / `done→done`の同phase CASで補完する。非NULL値の上書きは拒否する
- runtime照合がproposalとjobの許可状態を独立に見ていたため、強制的に作った`active + implementing/merged`不整合行をロードできた。同期で許す組を`implementing+merged` / `released+done`だけに限定し、active runtimeは後者だけを許すよう補強した
- 追加focused検証は3 files / 27 testsとserver/pipeline typecheckが成功。修正後は同じレビュー担当で指摘解消を再確認する
- 再レビューで実際の旧schemaはmerge時に`head_sha`をmerge commitで上書きしていたことを追加再現した。旧`head_sha`がGitHubのmerge commitと一致するときだけ、同じCASで`head_sha`を`headRefOid`へ正規化し、`merge_sha`を補完するよう修正した。2 files / 19 tests、pipeline typecheck、lint、差分検査が成功

#### CX-05 完了レビューと第三操作の追加

- 新規コンテキストの独立 GPT-5.6 Sol 完了レビューは、registry同期・provenance・初回公開transaction・re-enable・revert/旧image・部分障害・runtime fail-closed・冪等性・複数roomをPASSとした。一方、共有skill/CLIが`implement:merged`で止まり、デプロイ検知と開発者承認後の有効化を第三操作として実行できない点をImportant 1件とした
- 読み取り専用`implement:release-status`はデプロイ後のcurrent未revert版についてPR番号・merge SHA・bundle hash・`pending_enable`を照合し、`ready`になるまで一時API障害と未デプロイを最大15分pollする。`provenance_mismatch`は有効化せず、mergedから48時間経過したpendingには`reminder: true`を返す
- skillは`release-status`成功後に開発者へ明示承認を求め、承認後だけ`implement:release`を実行する。release側でも同じprovenanceを再照合してadmin enableを呼ぶ。応答消失後のactive再確認、done/手動disableの非再有効化、恒久HTTPエラー、再実行を回帰化した
- 修正後の全体`CI=true pnpm verify`はformat/lint/design/typecheck、64 files / 442 tests、全package buildまで成功。実GitHub/CD/本番での3操作実績はコード完了判定とは分け、外部受入ゲートに残す
- 指摘解消レビューは、永続`rule_versions`だけでは起動中registryが同期を拒否したデプロイを見抜けず、`release-status`が一度`ready`を返してからenableでfail-closedになる再現例をImportantとした。管理GETに起動中registration・release source・current versionの完全照合から算出する`releaseReady` attestationを追加し、CLIはこれが偽なら有効化しない
- 同レビューは48時間判定が対象jobのstatusコマンドを再実行した場合だけのpull通知だった点もImportantとした。`activeJobs`に`merged`を残し、通常の次job取得時にも48時間超の未有効化jobを`REMINDER`警告として必ず再提示するよう変更した。対象jobのstatus結果にも従来どおり`reminder: true`を残す
- 修正後の独立再レビューはコード要件 **PASS** / 品質 **APPROVED**、両Important **CLOSED**。実serviceでbundle不一致時に`releaseReady: false`、CLIが`pending/provenance_mismatch`となりenableを呼ばないことと、通常next APIでの48時間警告を再現確認した。Critical・Importantの新規指摘なし

#### CX-05の残る外部・後続ゲート

- 実GitHub PR・main CD・本番SQLiteを用いた「skill起動・レビューとマージ・有効化」の3操作リハーサルは、実PRを作る明示許可と本番受入時に行う
- RP-03の`proposals_seen_at`、mine/seen API、一覧・メニューバッジはE5側の残作業としてCX-05のrelease時刻へ接続する

### E5 RP-03 プロセス1（マイ提案・状態通知）

- `users.proposals_seen_at`をNULL許容の加算migrationで追加し、`GET /api/proposals/mine`はBearer tokenの本人提案だけを作成日時の新しい順で返す。各行と件数の未読は`status_changed_at > COALESCE(proposals_seen_at, 0)`で算出し、GET自体は既読化しない
- `POST /api/proposals/seen`は既読基準を単調増加で更新して204を返す。画面7は一覧取得後に明示seenを送り、状態5値、ローカル/オリジナル区分、却下・実装失敗理由、未読印、release日とrule ID導線を表示する。メニューはmineの`unreadCount`をバッジ表示する
- 縦結合テストで、複数利用者の分離、新しい順、未訪問時の全件未読、GET非既読、seen後の消灯、seen後の状態変化だけの再点灯をHTTP越しに確認した。Webは画面表示・seen呼出し・clientのGET/POSTを回帰化した

#### RP-03で置いた仮定・プロセス2送り

| ID | 仮定・残作業 | 根拠 | プロセス2での扱い |
|---|---|---|---|
| E5-RP03-P1-1 | 画面7は一覧取得成功後にseenを送り、取得した行の未読印はその表示中だけ残す。メニューへ戻った時点で件数を0にする | GET自体を既読化しないAPI契約と、「画面7を開いたら既読」の両立 | seen失敗・再読込・並行状態変更の境界を追加検証 |
| E5-RP03-P1-2 | E11未実装のためrelease導線はrule IDの表示までとし、画面遷移は後続E11で接続する | E05 §3.3(d)は`releasedRuleId`を前方参照とし、人気度・優先度もnull許容 | E11接続点を壊さない型/表示を確認 |
| E5-RP03-P1-3 | `reason_text`があればそれを優先し、無ければC-6のcode別固定文言へfallbackする | E05 §3.3(c)の表示仕様とC-6確定理由セット | 全理由code、長文、空文字の表示を網羅 |

### E5 RP-03 方向性レビューとプロセス2

- 新規コンテキストの独立 GPT-5.6 Sol 方向性レビューは **GO_WITH_FIXES**。Criticalなし。取得後からseen送信までに状態が変わると、サーバーの受信時刻で既読化する実装が未表示の変更まで消す点をImportant、`reason_text=NULL`を生の`reason_code`へ変換して固定文言fallbackを妨げる点をMinorとした
- P1-1は、画面が実際に取得した各行の最大`statusChangedAt`を`seenThrough`として送る方式へ変更した。状態更新時刻はSQLite transaction内でDB全体の最大値より必ず大きい論理時刻にし、同一ミリ秒の「GET → 状態変更 → seen」でも後発変更だけ未読に残す。任意の未来値は本人提案の現在最大値を超えるため400で拒否し、古いwatermarkの再送は`MAX`更新で既読を巻き戻さない
- E05 §3.3(d)の既存`POST /api/proposals/seen`無body契約は互換維持し、bodyなしではPOST時点の現在最大値を既読にする。Webクライアントだけが競合を避ける任意JSON body `{ seenThrough }`を使う
- P1-3はDBのNULL理由文を空文字として返し、画面側でC-6の却下6区分と`implementation_failed`へ変換する。`other`の個別詳細・長文はそのまま表示する
- seen更新だけ失敗した場合は取得済み一覧と未読件数を維持し、一覧取得失敗とは別の再試行案内を表示する。状態5値のステッパー、メニューの未読件数と`99+`境界も回帰化した
- 旧`users`表からの加算migrationを実SQLiteで開き、既存token・表示名を維持したまま`proposals_seen_at`を利用できることを確認した。HTTP結合では本人分離、新しい順、GET非既読、同時刻競合、等値境界、単調更新、未来値拒否を確認する
- P1-2のE11図鑑遷移は予定どおり後続へ残し、`releasedRuleId`の表示と型接続は維持する
- 新規コンテキストの独立 GPT-5.6 Sol 完了レビューは **GO**、Critical / Important / Minorすべてなし。方向性レビューのImportant（GET→状態変更→seen競合）とMinor（NULL理由文が生のreason codeになる問題）はともに **CLOSED**。本人分離、5状態ステッパー、C-6制約と全表示、旧SQLite migration、seen失敗時の一覧・未読維持、メニューバッジまで受け入れ確認済み
- 修正後の全体`CI=true pnpm verify`はformat/lint/design/typecheck、66 files / 452 tests、全package buildまで成功。AI simulationのfallback率テストが初回だけ揺れたが、単独4/4と全体再実行452/452の双方で通過した

### E7 CX-06 プロセス1（実ルール発動演出）

- エンジンは採用された`announce`に加え、`announce`を返さない採用Effectと、実際に合法性・強さを変えたtransformにも名前fallback用の`ruleFired`を出す。棄却・superseded・非公開情報を含むannounceは発火扱いにしない
- Roomの既存イベント列は固定ルールの`ruleId`を表示名へ解決し、全クライアントsnapshotへ同じ`seq`・`name`・`messageKey`を配る。実release済みルールを通すserver結合テストで、採用Effectから表示名付きイベントまで確認した
- Connected Appは`seq`で重複排除し、同一遷移の発火を1ボレーへまとめて既存DS-02 `RuleCutIn`へ接続する。演出中の後続ボレーはキューへ積み、スキップ/時間完了後は直近ルールを卓上chipに残す。初見ルールは同一Appセッション内で`NEW RULE`表示する
- `SetResultView.firedRules`を追加し、セット結果の`outcome.firedRuleIds`を固定ルール名と発火戦数へ変換する。E8の評価UIが無効でも「発動したルール」名一覧は表示する
- process1 focused検証はcore/server/webの5 files / 89 tests、および追加後の4 files / 79 testsとserver/web typecheckが成功

#### CX-06で置いた仮定・プロセス2送り

| ID | 仮定・残作業 | 根拠 | プロセス2での扱い |
|---|---|---|---|
| E7-CX06-P1-1 | `RoomGameEvent.messageKey=''`を「ルール名のみ」の既存契約内sentinelとする | E12/E03の共有契約は`messageKey: string`、E07は非announce時の名前fallbackを要求するため | registry moduleの`meta.messages`で安全に解決済み文言を渡す境界と、空keyの正式扱いをレビュー |
| E7-CX06-P1-2 | process1の`count`は「そのルールが発火した戦数」。同一戦の複数回発火は1件として一覧化する | 現`GameResult`の正規素材は`firedRuleIds`集合。ユーザーストーリーの一覧は成立する | Room/engineで実発火回数を集計し、`set_results.fired_rules`加算migrationと再起動永続化を実装 |
| E7-CX06-P1-3 | 既存RuleCutInの同時最大3枚・約0.75〜1.11秒・3件超combo表示を縦導線に再利用する | DS-02実装済み部品は段重ねをトーンとして確定している一方、E07本文は1件ずつ約1.5秒・3件超ログ縮退と記述 | 独立方向性レビューでDS設計との優先関係を裁定し、後続キュー・4件以上・reduced-motion・取り落としを仕上げる |
| E7-CX06-P1-4 | `NEW RULE`既見集合はAppプロセス内だけ保持する | 永続既見データ契約は設計にない。演出の成立に不要なDB/Storageを増やさない | 再接続・別room・同一rule再発火の境界を確認。永続化は要求がない限り追加しない |

### E7 CX-06 プロセス2（発動演出・集計の仕上げ）

- 新規コンテキストの独立 GPT-5.6 Sol 方向性レビューは **GO**。Criticalなし、Important 6件（最終手の演出持越し、戦数になっていたcount、変換/Effect混在時の全体優先順、failsafeで破棄した変換の誤発火、空`messageKey` sentinel、4件超の名前欠落）をプロセス2で解消した
- エンジンの発火は「1ルール×1権威バッチ」で正規化する。同じルールの変換と`afterPlay` Effectは1回にまとめ、採用announceの文言を優先し、全ルールをchain position順に並べる。後続の別hookは別の因果バッチとして再度countできる。`leadNoLegalMove` failsafeで基準値へ戻した変換は発火・集計の双方から除外する
- 名前だけの発火は`messageKey: null`とし、Room配信にはserverが信頼済みregistry `meta.messages`から解決した`message: string | null`を載せる。旧診断用`messageKey`はannounce時だけ残す。解決器が例外を投げても名前fallbackへ閉じ込め、権威ゲーム進行は成功する
- Roomはセット単位の`firedRuleCounts`を保持し、client再生回数と独立に権威`ruleFired`を計数する。`set_results.fired_rules`を加算migrationし、セット結果と同じSQLite transactionで`[{ruleId, ruleName, count}]`を保存する。旧行は正確な回数を復元できないため空配列とし、推測値を作らない
- Connected Appの演出はゲーム画面内から全phase共通overlayへ移した。Roomイベント列全体の`seq` watermarkで古いsnapshotを排除し、最終手直後にintermission/setResultへ進んでもその場で表示する。`NEW RULE`は実際に表示された時点でApp session既見にし、roomをまたいで維持、App再起動でリセットする
- DS-02の段重ね・短時間・chip方針を方向性レビューどおり採用し、4件超は3枚のリボンに加えて残りの全ルール名をコンパクト表示する。逐次1.5秒や実況ログへの巻き戻しは行わない
- process2重点検証はcore/server/webの6 files / 97 tests、およびcore/server/web typecheckが成功。旧DB migration、同一SQLite再起動、正確なcount、信頼済み名称、表示経路例外、混在優先順、failsafe、最終手、stale seq、後続queue、別room既見、5件同時を含む
- localhost許可付きの全体`CI=true pnpm verify`はformat/lint/design/typecheck、75 files / 525 tests、全package buildまで成功。sandbox内の初回だけHTTP/Socket系が`listen EPERM`になったため、同一コマンドを制限外で再実行して全件通過した
- 新規コンテキストの独立 GPT-5.6 Sol 完了レビューは **GO**、Critical / Important / Minorすべてなし。方向性レビューのImportant 6件はすべて **CLOSED**。Roomイベントの`trigger`/`gameIndex`はE07の例示的な単体イベントではなく、E03/E12の権威snapshot・単調`seq`・現在game状態で因果と順序を表す既存契約を正として追加しない裁定も承認された

### E10 OP-01・OP-02 プロセス1（運用可視化）

- E-18/C-2/C-6/G-8〜G-12をE10の旧本文と突き合わせ、従量課金API・サーバー常駐worker・レートgovernor・`ops_events`・codex上限`settings`を実装対象から外した。人間承認駆動では`pipeline_jobs`がキュー、試行、実行段階、内部`error_code`をすでに正規化して保持するため、重複台帳を作らない
- `pnpm ops status`でL3/CX-01/開発者確定の最新判定数、提案状態、実装phase、内部失敗内訳、screeningの現在段階と実装キューを古い順にJSON表示する。読み取り専用で、起動頻度や状態は変更しない
- `pnpm ops funnel --since <ISO date>`で全投稿の状態、却下理由、`pipeline_jobs.error_code`、最新判定シグナルを提案作成時コホートで集計する。E-18後は全送信が`proposals`行になるため旧二源遮断集計は廃止し、L3 blockシグナルと確定した`inappropriate`却下を分離して読める
- D-4は未決のため単一の採用率を決めず、`released / (released + rejected + failed)`を`terminalOutcomes`、`released / 全投稿`を`allSubmissions`として分母をAPI名に固定して併記する。0件期間はいずれも`null`
- プロセス1重点検証はoperations repositoryの3 testsとserver typecheckが成功。全状態の恒等式、3段階のscreeningキュー、FIFO表示、内部失敗、分母別率、0件・不正期間を確認し、空SQLiteへの実CLI `pnpm ops status`も成功した

#### E10で置いた仮定・プロセス2送り

| ID | 仮定・残作業 | 根拠 | プロセス2での扱い |
|---|---|---|---|
| E10-P1-1 | OP-01の「上限」は、人間がローカルskillを明示起動する現行モデルでは自動governorを意味しない | workorder #6、C-2、G-8。D-5も実質不要の見込み | 独立方向性レビューで受け入れ条件との整合を確認し、必要なら非強制の滞留/経過時間表示を足す |
| E10-P1-2 | D-4確定までは`adoptionRate`という単一値を公開しない | decision-log D-4が未決。どちらも正確な生データから導出可能 | 分母別の2値と生件数を維持し、決定後に正準aliasを追加できる形にする |
| E10-P1-3 | CLI出力は既存opsコマンドに合わせたJSON 1行を正とする | 個人開発者向けで機械処理もしやすく、専用UIを作らないE10方針に合う | `--detail`相当が常時含まれる情報量と秘匿境界をレビューする |

#### E10 独立方向性レビューとプロセス2

- 新規コンテキストの独立 GPT-5.6 Sol 方向性レビューは **GO**、Criticalなし。governor/`ops_events`/codex用`settings`を増やさず既存台帳を正準にする方向、全投稿一源、D-4を固定しない2率、C-6の内外分離、秘匿境界は妥当と裁定された
- Important 1「本番imageでbuild付きCLIを実行できない」は、`node packages/server/dist/ops.js`を本番入口、build付き`ops:dev`を開発入口へ分離して解消した。実build後に空SQLiteへroot開発CLIとdist直接CLIを通し、runbookへ両コマンドとDB path注意を記録した
- Important 2「日付だけの`--since`がUTCになる」は、日付だけをJST 00:00、日時を`Z`/明示offset必須として解消した。JST境界、offset/Z、timezone欠落、存在しない日付、既定30日をテストする
- Minorの20件固定は`--limit`（最大1000）/`--offset`、`total`/`truncated`を追加して解消した。21件同時刻をID順に2ページで取得し、`queued`/`implementing`/`pr_open`/`merged`とattempt 2を回帰化した
- E6確定却下/CX-01確定却下/SPEC承認をsource別に集計し、AI再判定は最新だけを数える。内部failure 6区分と台帳欠損`unclassified`の合計が`failed`総数に一致する回帰を追加した
- Important 3のうちD-5解消、OP-01受け入れ条件改訂、E-15をマージ/デプロイ時刻の人間選択として正式化する裁定は、実装者がdecision-logを変更せず**開発者判断待ち**として残す。コードは非強制の読み取り専用なので、裁定後にgovernor撤回等の破壊的手戻りは生じない
- process2重点検証はoperations/pipeline/persistenceの5 files / 32 testsとserver typecheckが成功。全体`CI=true pnpm verify`もformat/lint/design/typecheck、77 files / 535 tests、全package buildまで成功した
- 本番配布物の入口は通常build後に`node packages/server/dist/ops.js status/funnel`をbuildなしで実行して成功した。Docker runtime imageの実buildも試みたが、ローカルDocker daemonが停止中で接続できず未実施。Dockerfileはproduction dependenciesとserver/core/rules等の`dist`をruntimeへコピーする既存構成で、runbookは本番でpnpm/buildを要求しない
- 新規コンテキストの独立 GPT-5.6 Sol 完了レビューはコード実装スコープ **PASS / APPROVED / GO**、Critical / Important / Minorすべてなし、main統合可。初回の本番CLI・JST境界・20件固定と追加要求はすべて **CLOSED**。D-5解消・OP-01受け入れ条件改訂・E-15運用の正式裁定だけは、コード完了を妨げない**外部決定ゲート**としてOPENのまま残す

### E11 RV-01・RV-02 プロセス1（ルール閲覧）

- `PlayerRoomView.activeRules` を権威的な現在セットの並びとしてそのまま使い、待機画面と対局画面の既存「ルール N件」ボタンを同じ名称一覧へ接続した。一覧行は名称だけで、人気度・優先度・順位・都道府県を描画しない。0件の基本ルール対局も空状態で成立する
- メニューと対局ルール一覧から図鑑を開ける。図鑑は名称、区分、都道府県の出自記録、状態、短い説明を表示し、都道府県・状態・区分をANDフィルタとして再取得する。人気度・優先度は共有レスポンス上も`null`、DOMにも出さない
- 公開`GET /api/rules`を追加し、`active`/`removed`だけを新着順で取得する。`disabled`は未決のため公開対象・集計の双方から除外する。既定30件、最大100件、offset追加取得、全体summaryとフィルタ後totalを分離した
- `ruleOriginLabel`で県ありを「報告: 埼玉県」「埼玉県で遊ばれていた報告」、県なしローカルとオリジナルを断定しない表示に統一した。排除済みは物理削除せず打ち消し表示と理由を添える
- プロセス1重点検証はcore/server/web typecheck成功、catalog service・出自・名称限定一覧・図鑑の4 files / 8 tests成功。フィルタquery、未実装指標null、0件、非断定文言、AND再取得を確認した

#### E11で置いた仮定・プロセス2送り

| ID | 仮定・残作業 | 根拠 | プロセス2での扱い |
|---|---|---|---|
| E11-P1-1 | 対局中一覧は既存の全量snapshot内`activeRules`を使い、E11旧提案の別イベント化は行わない | E3/E12実装済み共有契約が各snapshotの権威表示を確定済み。固定後は内容不変で、契約変更を避ける | 独立レビューで契約優先関係と固定セット維持を確認する |
| E11-P1-2 | `disabled`は図鑑・summary・都道府県カバーから除外し、`active`と`removed`を実装済み資産とする | E11 §3.2(g)でdisabled表示は未決。受け入れ条件は有効/排除済みを要求 | リポジトリ実DBテストで集計を固定し、決定後に状態追加できる境界を維持する |
| E11-P1-3 | 既存schemaに`removed_at`がないため、removed行の`updated_at`を`removedAt`として返す | lifecycle transition時刻を表す既存の唯一の列で、契約追加なしに意味が一致する | transition回帰テストを追加。別更新がremoved後に入り得るかレビューする |
| E11-P1-4 | フェーズ2のsortは`recent`だけを受理し、priority/popularityはnull固定にする | workorder #7が人気度・優先度表示をフェーズ3へ明示延期 | API/UI双方で未知sortを400にし、将来の列追加位置だけ残す |
| E11-P1-5 | 詳細は初期一覧の短文までとし、行展開はプロセス2へ送る | E11は初期実装として展開を推奨するが、ユーザーストーリーの縦導線とフィルタを先に確認できる | 説明全文・実装日/排除日の展開、失敗再試行、競合fetch、API/DB統合、ページ境界、実画面確認を仕上げる |

#### E11 独立方向性レビューとプロセス2

- 新規コンテキストの独立 GPT-5.6 Sol 方向性レビューは **GO_WITH_FIXES**、Criticalなし
- Important 1「待機中にregistryが変わっても`activeRules`が更新されない」は、registryのdisable / enable / release / auto-disable成功後に待機中community卓だけへ`refreshRules`を適用し、固定後のplaying卓とbasic卓を変えない境界で解消した
- Important 2「図鑑の共有型が最終契約より狭い」は、`description: string | null`、`priority` / `popularity: number | null`、ISO 8601文字列の日付へ揃えた
- Minor「名称をReact keyにしている」は`ruleId`へ変更した
- E11-P1-1〜5はすべて採用。removed後を終端にして`updated_at`を排除日時として不変化し、disabledは公開・summaryから除外、priority / popularity / eliminationは既定OFFのfeature flag境界へ置いた

#### E11 プロセス2で仕上げたもの

- 公開`GET /api/rules`を未認証で利用可能に保ちつつ、既存のIP単位fixed-window limiterで既定120回/分に制限した。内部例外は本文を漏らさず500、上限超過は429にする
- 実SQLiteへ32件を入れるrepositoryテストで、disabled除外、summary、都道府県カバー、30+1件ページ境界、県なし・ANDフィルタ、active-only feature flag、removed終端時刻を固定した
- 図鑑は初回失敗の再試行、追加取得失敗時の既存一覧保持、古いfetch応答の破棄、名称折返し、一覧説明の1行省略、行展開での説明全文・出自・状態・JST日付を実装した
- メニュー、待機、対局の各導線から一覧/図鑑を開いて戻れること、room消失時にoverlayを消すこと、図鑑導線とelimination / priority / popularity表示をfeature flagで止められることを統合テストへ追加した
- 固定ルール一覧は名称だけのラフ表示を守り、件数と「すべての卓に適用（変更不可）」だけを補足する。人気度・優先度・順位・都道府県は表示しない

#### E11 検証

- プロセス2重点テスト: **10 files / 107 tests** 成功。catalog service / 実SQLite repository / room manager / registry service / app-server / origin / 固定一覧 / 図鑑 / App導線 / proposal clientを確認
- `CI=true pnpm verify`: 成功
  - Prettier / ESLint / AI boundary / TypeScript / 全package build: 成功
  - design lint: **110 files**、キービジュアル3ファイル、アウトライン23件が成功
  - Vitest: **83 files / 575 tests** 成功
- 実ブラウザ: 375×812で45件・初期30件の図鑑を表示。長い名称と説明の展開前後とも`clientWidth=scrollWidth=375`で横スクロールなし。`<script>alert(1)</script>`を含む説明は文字列として表示され、ダイアログ・実行なし。詳細の区分・状態・実装日も確認した

#### E11 初回完了レビュー

- 新規コンテキストの独立 GPT-5.6 Sol は **FAIL / CHANGES_REQUESTED / NO_GO**。初回方向性レビューのImportant 2件とMinorはすべてCLOSED、E11機能自体の重点9 files / 99 testsも成功した
- Important 1件: process2で`RoomManager`を共有化した際、実起動の`gateway.sessions: persistence.sessions`が脱落し、既定のメモリsessionへ戻っていた。発行tokenがSQLite usersへ保存されず、提案・マイ提案・黄カード等の認証と再起動後identityを壊す回帰だった
- SQLite session注入を復元。実buildしたserverへSocket.IO接続し、発行tokenとuser IDがSQLiteへ保存されること、同じDBで再起動後に同じtoken / userへ復帰し、usersが1行のままであることを確認した

#### E11 完了再レビュー

- 同じ独立 GPT-5.6 Sol に修正コミットと実SQLite再起動検証を渡して再レビューし、**PASS / APPROVED / GO**。Critical / Important / Minorはすべてなし
- 初回完了レビューのsession注入、方向性レビューのImportant 2件・Minor 1件はすべて**CLOSED**
- 後続ゲートは、E9/E8のデータ・server対応と同時にpriority / popularity / eliminationを本有効化すること、decision-log E-10の都道府県カバー正準集計を将来のE10 OP-03から共有利用すること。いずれもE11のmain統合を妨げない

#### E11 詰まっている点

- なし。priority / popularity / eliminationはフェーズ3または後続の仕様確定とserver対応を同時に有効化する

### E2で見つけた設計書の不整合

- 冒頭改訂ノートは探索を `worker_threads` 1〜2本で実行すると決定済みだが、§3.1(d)・§4.4・§6-5には「初期はホスト直列、兆候が出たらworkerへ移行」という旧記述が残る。実装は改訂ノートを正とした。
- `AiDecision.play: Play` はpassを表現できない一方、§3.1(b)は合法手0件をパス強制としてAIの即決対象に含める。プロセス1ではAI呼出前にゲームループが強制passすることで契約を変えずに成立させた。
- §4.4は`playoutBatchSize`をisolateへの一括送信単位、`sliceMs`をホスト側のyield間隔としている。改訂ノートに従い探索全体をworkerへ移したため、実装ではそれぞれ親へpartial統計を送る反復数・経過時間の上限に読み替えた。UCB1統計自体はworker内で毎反復更新するため、バッチ分古い統計にはならない。

---

## 並行進行: E3 マルチプレイ

- 状態: MP-01/MP-02 プロセス2完了。独立 GPT-5.6 Sol の最終再レビューは **GO（Critical / Important なし）**。ブラウザ UI → typed Socket.IO → Room → Core/E2 AI → 閲覧者別snapshotの実運用導線、同一origin SPA配信、SQLite永続化、SIGTERM drainingまで接続した。
- コミット: `9c4ff46`（Room authority/view）、`3c351f3`（切断・離脱時の席/controller維持）、`2762261`（RoomManagerと招待index）、`5a477a9`（set境界・continue・参照分離）、`4cbc612`（Socket.IO gateway）、`36121c4`（phase timer）、`7af9818`（AI手番）、`0db35e5`（lifecycle/protocol）、`85dbdfd`（受入不変条件）、`f37817a`（実運用縦導線・永続化・draining）、`6d99369`（初回完了レビュー指摘）、`391f7a3`（再レビュー指摘）。
- 検証: Node 26.5.0 / pnpm 11.17.0 / TypeScript 6.0.3。`pnpm verify` 成功（format / lint / design lint / typecheck / **28 files・191 tests** / 6 packages build）。純粋層3ゲーム完走、実HTTP/Socket.IO server/client、ブラウザclient state、1人+AI 3席のSocket→Room→Core→AI scheduler縦断完走を確認した。
- 依存: npm registry の `latest` を再確認し、`socket.io` / `socket.io-client` 4.8.3、`zod` 4.4.3、`better-sqlite3` 13.0.1、`drizzle-orm` 0.45.2、`@types/better-sqlite3` 7.6.13を導入した。`pnpm outdated --format json` は、ユーザー指定で固定したTypeScript 6.0.3（registry latest 7.0.2）以外0件。

### プロセス1で完了したもの

- `RoomState` の `waiting` / `playing` / `setResult` / `closed`、単調増加する `v` とゲーム・セットをまたいでリセットしない `turnSeq`。
- 人間1〜4人から不足分だけAIを補充し、席の所有と `controller: human | ai` を分離。開始時に切断中の人間も人間数へ含め、その席をAI代行にする。
- play/passを「現在手番の席 → `turnSeq`一致 → Core合法性」の順で同期検証し、受理時だけ`v`と`turnSeq`を1増加。拒否では同一state参照を返す。
- 対局中の切断では席を保持してAI代行、復帰でhumanへ戻す。明示離脱は`departed`として不可逆にし、セット終了までは席と手札を維持する。待機中のホスト離脱は参加順で移譲する。
- `viewFor` を単一allow-list境界にし、本人の手札と本人用の`legalMoves`だけを含める。他人は枚数のみ。`userId`・token・Core private/KV/RNG・Effect内部表現は配信型へ入れない。復帰snapshotは常に`events: []`。
- `RoomManager` の `Map<roomId, RoomState>`、invite→room、user→room index。招待コード正規化、1ユーザー1部屋、満員/対局中参加拒否、部屋破棄時の条件付きindex削除。
- setResult到達時に切断者・明示離脱者を除去して`byUser`を即時解放。全残留人間のcontinue、leaveとの競合、120秒期限での無応答除外、AI再補充、新しい`SetState`と最新ルール一覧の再固定。
- `viewFor`と公開Room eventをCore権威状態からdeep cloneし、gateway内処理からCard参照を変更できないようにした。
- Socket.IO server/client 4.8.3のtyped event/ack、匿名token、同一tokenの後勝ち接続、再接続時`events: []`の全量snapshot、受信者別state emit。
- `packages/core/src/protocol.ts`へ共有イベント型とzod schemaを置き、全client eventの受信時にstrict検証する。不正形は`BAD_PAYLOAD`、join過多は`RATE_LIMITED`、予期しない例外は`INTERNAL`でackする。zodは確認時latestの4.4.3をexact指定した。
- fingerprint付きtimerでintermission・setResult・turnを駆動。同じ状態の再syncで期限を延長せず、古いcallbackとAI決定中に進んだ`turnSeq`をno-opにする。AI演出間隔はE3仕様の0.8〜2.5秒をRoom側で持ち、`runAiTurn`内の遅延は0に上書きして二重待機を避ける。
- waiting切断60秒猶予、lobby TTL 30分、接続中人間0のabandon 5分を別のlifecycle timerで駆動。reconnectで予約を張り替え、部屋破棄時は全timerとindexを解除する。joinはIP単位10回/分のfixed-window制限を持つ。
- 漏洩回帰は16 seedで生成した多数局面と実Socketで受信した全snapshot/event列を走査する。二席play+timeoutの同一`turnSeq`三つ巴を全順序で確認し、切断中に数手進んだ後の再接続snapshot一致、破棄後timer/room/user/invite indexがゼロになることも固定した。

### プロセス2で完了したもの

- `packages/web` を共有プロトコルと `socket.io-client` へ接続。匿名tokenをlocalStorageへ保存し、再接続authを更新、古い`v`を破棄、`session:ready`の全量復帰snapshotを描画する。
- 待機・対局・ゲーム間・セット結果の各画面を`PlayerRoomView`から構成。非ホスト開始無効化、合法手だけのplay、リード時pass無効化、手番残り時間、AI/代行/切断表示、再接続・後勝ち接続overlay、離脱確認、joinエラー表示を接続した。
- Node HTTP serverからbuilt SPAをfallback付きで配信し、同一originにSocket.IOを接続。ping 10秒 / timeout 8秒 / 受信上限16KBを設定した。
- SQLite + Drizzleで匿名ユーザー/token/表示名、ReplayInit + 受理アクション、セット結果を同期transactionで永続化。進行中Room stateは設計どおりMapのみ。
- SIGTERM/SIGINTで新規create/join/start/continueを止め、Core `requestDrain`へ接続。進行中ゲームだけ完走し、途中セット結果へ移った時点でtransportとDBを閉じる。
- RoomManagerの1分sweepをgatewayへ接続し、lobby TTL、waiting切断猶予、無人playing、setResult無応答をtimer取りこぼし時にも回収する。
- E1契約どおり`legalMoves: Play[] | null`を本人snapshotへ載せ、ルールchainの合法性変更をUI操作可否まで反映した。

初回の独立 GPT-5.6 Sol 完了レビューは **NO-GO**。再接続時に`room:state`が`session:ready`より先着して復帰イベントを再生し得る点、本番setResultにE8未導入の評価デモを表示する点、補充AIの「考え中」表示条件が成立しない点を検出した。未初期化socketを通常broadcast対象から外し、`session:ready`を必ず最初のsnapshotにした。評価UIはE8導入まで本番だけ隠し、補充AIは現在手番を根拠に「考え中」を表示する。あわせてSQLiteのセット結果と長いreplay連番を実完走で回帰化した。

次の独立 GPT-5.6 Sol 再レビューも **NO-GO**。`continue`以外の`leave` / `expireSetResult`で次セットが始まるとReplayInitが欠ける点と、継続回答後に未回答者を表示しない点を検出した。ReplayInitの判定をaction名でなく`setId`変更へ統一し、`leave`による次セット開始をSQLite実DBで回帰化した。画面は本人の`wantsNextSet`回答後に未回答者名を表示し、二重回答を無効化する。

固定コミット`c7d1b39`に対する3回目の独立 GPT-5.6 Sol 再レビューは **GO（Critical / Important なし）**。上記5点の修正と回帰テスト、E03/E12への整合を確認した。

### E3で置いた仮定・次工程

| 仮定・残作業 | 根拠 | 次工程 |
|---|---|---|
| Room reducerとviewをSocket.IOより先に固定する | E03 §3.1(e)がSocket層を薄い変換に限定 | 完了。実Socket.IO in-process統合testを追加 |
| AI補充member IDと暫定表示名はserver生成 | E03 §3.2で機械名を暫定許容 | E4のトーン確定後に名前プールを差替え |
| E2の0.4〜1.2秒は探索adapter側の既定のまま維持し、E3の最終ペーシングは0.8〜2.5秒をRoom timer側で上書きする | E02の較正値とE03 §2.1/§3.2の値が不一致。Epic順では後段のE3 UX仕様を統合時の正とする | 完了。Room schedulerが0.8〜2.5秒、AI adapterへは遅延0を注入 |
| `setRespondBy`・人間手番deadline・intermissionは状態に予約済みだが、タイマー駆動は未接続 | timer callbackも予約時`turnSeq`を再検証する必要がある | 完了。fingerprintと`turnSeq`再検証をfake timerで確認 |
| waiting切断猶予、lobby TTL、無人対局abandon、join rate limit | E03 §2.1・§2.5・§3.1 | 完了。lifecycle timerとIP単位fixed-window limiterを追加 |
| 最新Drizzle 0.45.2の公開`.d.ts`とTypeScript 6.0.3の不整合は`skipLibCheck`で隔離し、自前コードのstrict/exactOptionalチェックは維持する | ユーザー要望の最新版とTS 6.0.3 exactを両立するため | `tsconfig.base.json`。Drizzle側の型定義がTS 6で解消されたら解除可能 |
| SPA配信とSQLiteは同一Nodeプロセス、DB既定パスは`data/daifugo.sqlite`、Web成果物は`packages/web/dist` | E12の単一常駐プロセス + 同一origin + SQLite方針 | 環境変数`DATABASE_PATH` / `WEB_DIST_DIR`でデプロイ時に変更可能 |

---

## 並行進行: E13 デプロイ・本番公開

- 状態: **DP-01完了、DP-02/DP-03のリポジトリ実装と本番検証は完了**。公開URLは `https://daifugo-together.fly.dev/`、GitHubはpublicの `https://github.com/qsona/daifugo-together`。Environment `production`作成と`FLY_API_TOKEN`登録、およびmain push起点の初回CD実行確認はリポジトリ公開後に行う。
- 構成: Fly.io `nrt`、Machine `48e0703f115398` 1台(shared CPU 1 / 512MB)、暗号化Volume `daifugo_data` 1GBを`/data`へマウント。`DATABASE_PATH=/data/daifugo.sqlite`、`auto_stop_machines=false`、`min_machines_running=1`、`kill_timeout=300s`。
- 実装: Node 26.5.0 / pnpm 11.17.0のmulti-stage `Dockerfile`、`fly.toml`、CI成功SHAだけをデプロイする`.github/workflows/deploy.yml`、DB疎通とdrain状態を返す`/health`、Flyで追跡できるJSONログ、実セット検証スクリプト、構築・監視・ロールバックrunbookを追加した。`og:image`は本番絶対URLへ確定。
- 自動検証: `pnpm verify`成功(format / lint / design lint / typecheck / **28 files・194 tests** / 6 packages build)。`/health`の通常200、drain中200、DB異常503を回帰化。`fly config validate`成功。Fly remote builderでNode ABIが一致する`better-sqlite3`を含む132MBの本番イメージをbuild済み。
- 本番セット: 1人役+AI 3席の3戦セットを実Socket.IO経路で完走。初回は`replay_records=243` / `set_results=1`。2回目の対局中にrolling deployを実行し、15:42:33 SIGTERM → `server_drain_started`、15:43:25 `server_drain_completed`、exit code 0を確認。進行中ゲームは完走し、セットは仕様どおり1戦で途中終了した。
- 永続性: 再デプロイ後も`users=2` / `replay_records=333` / `set_results=2`をreadonly接続で確認。ヘルスチェックpassing、OGP絶対URL、新バージョンでの部屋作成・退出も確認した。
- ロールバック: Fly CLI v0.4.69で`fly releases --image`から直前の`e13-initial`を特定し、`fly deploy --image`で実際に切り替えた。`/health` passingと`replay_records=333` / `set_results=2`の保持を確認後、同じ手順で`e13-final`へ復帰。Machine version 4、ヘルスチェックpassingを確認済み。

---

## 追加改善: 最終戦リザルトとセットリザルトの分離（2026-07-28）

- 最終戦（第3戦）の結果とセット総合が1画面に混ざっていたのを2画面に分けた。`setResult` フェーズに入ると、まず最終戦リザルト（10秒のカウントダウンで自動進行、または「セット結果へ」）を出し、そのあとセットリザルトへ渡す。サーバーのフェーズ・タイマー仕様は変えていない
- `SetResultView.finalGame`（既存の `GameResultView` 形）を追加。完走セット（`results.length === gamesPerSet`）でだけ入り、中断セット（drained）では `null` で、その場合クライアントは最終戦リザルトを飛ばす
- 最終戦リザルトを見たかどうかは `roomId:respondBy` をキーに端末内で保持し、`sync` や再接続で画面が巻き戻らないようにした。ページ再読み込み時はもう一度最終戦リザルトから始まる
- 順位行を用途で分割。`GameRankRows` は「順位 → 名前 → 称号 → この戦の加点 → セット累計点」を出し、加点が乗ってから合計点が数え上がる。`SetRankRows` は1位を花形カードにし、2〜4位は合計点だけの行にした（各戦の順位推移 `1→2→1` は最終戦リザルトが語るので削除）
- 自分が1位のときだけ紙吹雪（`Confetti`、トークン色のみのCSSアニメーション）、それ以外は自分の行がひと弾みする控えめな演出。`prefers-reduced-motion` では紙吹雪のDOMを作らず、カウントアップも最終値を即表示する（判定は `prefersReducedMotion()`）
- 設計と計画: `docs/superpowers/specs/2026-07-28-set-result-split-design.md` / `docs/superpowers/plans/2026-07-28-set-result-split.md`

---

## Phase 3 プロセス1（E8 / E9 / E10）

- EV-01 / EV-02: セット終了時に `game_sets`、人間だけの `set_participants`、開始時固定ルールと発火有無を持つ `set_rules` を同じ永続化境界で保存する。画面5bのセット評価・発火ルール評価は省略可能で、選択時に `POST /api/sets/:setId/evaluation` へ即時保存する。参加者外、期限切れ、未発火ルールは拒否し、未発火ルールを含む更新はセット評価も残さない
- PR-01: 既存 core の `PriorityKey = { score, activatedAt, ruleId }`、変換系の高優先度後勝ち、Effect競合の最高優先採用、コード単位の `ruleId` 比較を維持した。セット固定時の position / bundle hash / popularity snapshot と、採用・棄却を含む競合イベントをSQLiteへ保存し、管理APIで優先順位・セットsnapshot・競合を確認できる
- EV-03 / PR-02: ルール評価の保存トランザクション内で、ルールごとに各ユーザーの最新票だけを Beta(5,5) で平滑化して人気度へ反映する。保存commit後に生票の有効化ウィンドウを Wilson 下限で判定し、既定 `theta=0.70 / nMin=10 / z=1.96` を超えた active ルールを removed にして履歴を残す。設定変更後の全件再判定、人気度再計算、理由必須のCLI復活を追加した
- E11後続ゲート: priority / popularity / elimination のfeature flagを既定ONにし、図鑑の人気度・優先度・排除済み表示と優先順位sortを本有効化した。active rule chainも人気度、初回有効化時刻、ruleIdの順になる
- OP-03: `ops metrics` でルール数帯・JST日次の `fun/(fun+neutral+boring)` と boring率、平均有効ルール数、実装到達・現存active・排除・復活の件数と日次推移、releasedローカル提案の都道府県カバー、完走セットと3戦未満の打ち切りセットを分けて返す
- プロセス1重点検証: core人気度/優先順位、evaluation repository/service、operations metrics、catalog、persistence、App即時送信の **9 files / 103 tests** が成功。core / server / web typecheckも成功。HTTP listenを使うapp-serverテストはsandbox外で **8 tests** 成功

### Phase 3 で置いた仮定・プロセス2送り

| ID | 仮定・残作業 | 根拠 | プロセス2での扱い |
|---|---|---|---|
| P3-P1-1 | `games_played < 3` の打ち切りセットも通常の評価対象に含め、OP-03では評価率へ含めつつ `partialSets` として別掲する | workorder B-3は着手時決定が必要。打ち切りでも評価成立が明示され、除外すると悪い体験を観測から落とす | 独立レビューで採否を裁定し、runbookへ集計定義を明記する |
| P3-P1-2 | E8の `set_rules` とE9の `set_rule_snapshots` は別表にせず、position / bundle hash / popularity scoreを `set_rules` へ追加して統合する | E-7は統合可否が未決。同じ `(set_id, rule_id)` の開始時スナップショットであり二重管理を避ける | snapshotの完全性・過去再現性と管理読み取り口を重点確認する |
| P3-P1-3 | workorderの「押した時点で送信済み」をE08旧本文の一括送信/409より優先し、同じ評価をupsertし、ルール票は再選択・取り消し可能にする | phase3 workorderが旧確認ボタンを明示的に上書きしている。通信失敗時は楽観更新を巻き戻す | API冪等性、連打・順序逆転、再読込復元をプロセス2で仕上げる |
| P3-P1-4 | 人気度は全期間のユーザー別latest-wins、排除はセット別の生票と復活時刻後の有効化ウィンドウを別集計にする | E09 §3.2(c) と E08 §2.4 / §3.3 が用途を分離している | 集計SQLの同時更新、復活直後、票付け替えの境界を追加検証する |
| P3-P1-5 | D-1/D-2/D-3は設計初期値のまま実装し、D-6はCLI+SSHを採用する | workorderで仮値着手可、D-6は決定済み | `settings`変更の再起動不要反映、全件再判定、実CLI出力と運用runbookを完成させる |
| P3-P1-6 | 競合ログは権威イベントから競合グループだけを抽出し、セット・戦・play seq・hook・conflict key・採用rule・全entryを保存する | PR-01はEffect語彙/フックを変えず追跡可能にする必要がある | 実競合からDB/APIまでの縦断テストと重複保存防止を追加する |

### Phase 3 独立方向性レビューとプロセス2

- 新規コンテキストの独立 GPT-5.6 Sol 方向性レビューは **GO_WITH_FIXES**、Criticalなし。P3-P1-1〜6はすべて採用された。D-1 / D-2 / D-3は設計初期値のまま実装するが、正式値は開発者承認待ち
- Important 1「`game_sets`とルールsnapshotがセット終了時まで存在しない」は、セット開始時の`beginSet`と終了時の`completeSet`へ分離して解消した。開始時に人間参加者とposition / bundle hash / popularityを固定し、終了時に結果・戦数・`did_fire`を確定する。未完了セットは評価不可
- Important 2「E11図鑑とOP-03の都道府県カバーが別集計」は、`rules/coverage.ts`の正準関数をcatalogとmetricsから共有して解消した。active + removedを数えdisabledを除外し、同一fixtureで両出力が一致する回帰を追加した
- 同じ独立 GPT-5.6 Sol にImportant 2点の修正を再レビューしてもらい、両方 **CLOSED**、残存Critical / Importantなし。関連4 files / 24 tests、server TypeScript、`git diff --check`の成功も独立確認された
- 競合は実`onGameStart`のEffect衝突からreducer callback、SQLite、管理HTTP APIまで接続し、同一set / game / play / hook / conflict keyの重複保存を防ぐ。優先順位とセットsnapshotも専用Bearerの管理APIで確認できる
- 評価UIは楽観更新を直列送信し、初期GETと連打POSTの応答順が逆転しても新しい選択を上書きしない。失敗時は最後にサーバー確認済みの状態へ戻す。Bearer取得時にlocalStorageが利用不能でも同期例外を漏らさない
- OP-04 runbookを追加し、週次の`funRate` / `boringRate` / ルール数帯 / 排除・復活 / 都道府県カバーの読み方、一度に一つだけ設定を変える較正、即時disable、復活、再計算、戻し方を実CLI出力へ対応させた。常駐機構と自動削除は追加していない

### Phase 3 検証

- build済みCLIを空の一時SQLite `/private/tmp/daifugo-phase3.K1A46x/dryrun.sqlite` に対して実行し、`metrics`は空の日次・帯別配列と件数0、`settings set elimination_theta 0.70`と`popularity recompute`は成功JSONを返した。再起動は不要
- 実ブラウザを375×812に固定し、セット結果の3段階評価、発火ルールごとの高評価・低評価、次セット・ホーム導線を確認した。`clientWidth=scrollWidth=375`で横スクロールなし。評価説明文と確認/送信ボタンはDOMにも表示されない
- `CI=true pnpm verify`: 成功
  - Prettier / ESLint / AI boundary / design lint / TypeScript / 全package build: 成功
  - design lint: **121 files**、キービジュアル3ファイル、アウトライン20件が成功
  - Vitest: **93 files / 619 tests** 成功

### Phase 3 初回完了レビュー

- 新規コンテキストの独立 GPT-5.6 Sol は **PARTIAL / NEEDS_FIXES / NO_GO**。EV-01 / EV-02 / EV-03 / PR-01 / PR-02 / OP-03 / E11後続ゲートはPASS、Critical / Minorなし
- Important 1件: OP-04 runbookに、E09が要求する「α / β変更 → 全人気度再計算 → 文書更新」の具体的な操作経路がなく、優先度換算レバーだけ実運用できなかった
- α / β は設計どおりcoreのコード定数に保ち、変更判断、`POPULARITY_PRIOR`の変更、数値トレース更新、全verify、通常PR/デプロイ、build済みCLIでの全件再計算、管理API確認、効果比較、revertと再計算、runbook / decision-log / 運用記録更新までを手順化した。runtime settingsは増やさない
- 修正後リハーサルとして人気度純粋関数と評価・再計算の **2 files / 12 tests** を実行し、build済みCLIを一時SQLite `/private/tmp/daifugo-phase3.K1A46x/prior-rehearsal.sqlite` へ適用して `{"status":"recomputed"}` を確認した

### Phase 3 完了再レビュー

- 同じ独立 GPT-5.6 Sol がOP-04 Importantを **CLOSED** と確認し、最終判定は **PASS / APPROVED / GO**。Critical / Important / Minorはすべてなし
- D-1 / D-2 / D-3の正式値承認とB-4の保持期間決定は運用上の人間判断として残るが、設計初期値、変更経路、記録・復旧手順があるためPhase 3実装の完了を妨げない

---

## E15 引き継ぎ登録・ログイン

### AU-01 / AU-02 / AU-03

- 状態: **実装・全体検証・独立レビュー完了**
- AU-01: Google OAuthのbegin → callback → 一回限りのtoken引換を実装した。匿名行への紐付け、既存アカウントへの切替、本人再ログイン、state・nonce・期限・単回性を自動テストで固定した
- AU-02: 提案POSTは401 → 未登録403 `registration_required` → 停止403 → 入力検証の順で判定する。未登録時は提案フォームを隠し、Googleログイン導線を表示する
- AU-03: OAuth完了後はブラウザのtokenを差し替えてSocket.IOを再接続する。ログアウト時はtokenを破棄して新しい匿名sessionへ切り替える。メニューに常設導線、初回セットリザルトに控えめな登録導線を置いた

#### セキュリティと可用性

- begin時の暗号学的乱数nonceを`__Host-daifugo-auth-flow` Cookieとstateレコードへ保存し、callbackで単回消費して照合する。不一致ブラウザではGoogle codeを交換せず、Cookieは成功・失敗とも削除する
- Google認可は`response_mode=form_post`、callbackはフォームPOSTとし、認可コードをURLへ載せない。Cookieは`HttpOnly; Secure; SameSite=None; Path=/`
- callback後のブラウザURLにはGoogle codeや`user_token`を残さず、一回限り・60秒のottだけをhash経由でアプリへ渡す
- Google設定なし・discovery失敗では他機能を停止せず、認証APIだけ503へ閉じる
- `window.localStorage`のプロパティ取得と各操作が例外を投げても、Multiplayer/Auth/Proposalクライアントは利用を継続する

#### 設計判断とレビュー

- 初回セットリザルトの登録導線はブラウザごとに一度だけ表示し、以後は`daifugo.authResultPromptShown`で抑制する
- OAuth完了後はメニューへ戻し、結果を`role=status`で表示する
- 独立方向性レビューは **GO_WITH_FIXES**。開始ブラウザとの結び付け、認可コードのquery露出、提案画面の表示文言依存を修正した
- 初回の独立完了レビューはlocalStorage getter例外をImportantとして **NO-GO**。共通safe storageアダプターを追加後、再レビューは **GO（Critical / Importantなし）**

#### 検証

- `CI=true pnpm verify`: 成功（Prettier / ESLint / AI boundary / design lint / TypeScript / build / Vitest）
- 375×812でメニュー、未登録提案、basic対局中の導線と横スクロールなしを確認した
- 実Google通し、実セット完走後の登録導線、最終文言は本番デプロイ後の受け入れ確認で完了させる
- E15 §2.3はPOST `form_post`へ改訂し、`PUBLIC_ORIGIN`の本番設定と[E15 Google OAuth 受入 runbook](runbooks/E15-google-oauth.md)を追加した
