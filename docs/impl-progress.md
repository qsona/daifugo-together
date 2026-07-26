# 実装進捗

## 現在

- Epic: E4 / 周: プロセス2 完了・レビュー反映済み / ストーリー: DS-01・DS-02 / 次にやること: 開発者の判断待ち 6 件(下記)。それが片付けば main へチェックイン

### プロセス2 レビューの結果と反映

判定は **要件適合 PARTIAL / 品質 APPROVED**。PARTIAL の理由は実装の未達ではなく、**開発者にしか閉じられない項目が残っているため**(E04 の承認・DS-01 条件 3 の承認記録・§5-16 と favicon の目視承認)。指摘は Minor 4 件で、仮定 12〜18 はすべて採用。

| 指摘 | 対応 |
|---|---|
| Minor 1: `check-key-visual.mjs` に実在しない `ogp.svg` が残り、かつ対象の不在を無言でスキップしていた(改名で検査が空洞化する) | 死んだエントリを削除し、**対象の不在を fail に**した。TARGETS を export して「対象が全部実在すること」自体をテストで担保 |
| Minor 2: 検査が CSS 名前色・新しい色関数(oklch 等)・`border-radius` の px 直値を素通りする | 3 つとも検出するようにした。`border-radius` は影と同じくトークン参照(または `50%` / `0`)を強制。これに伴い唯一の非トークン値だった警告スロットの `4px` を `var(--radius-s)` に変更し、**design-system.html §5-14 側も同じ値に揃えた**(実装とカタログの食い違いを作らないため) |
| Minor 3: `public/favicon.svg` が正本と drift しても検知できない | 正本とのバイト一致検査を `lint:design` に追加(PNG は再生成に sharp が要るので SVG の一致を代理にする) |
| Minor 4: カタログ側の `rgba()` 直書きが残る(仮定 13) | 実装側は正しいとの裁定。**カタログの修正は開発者に起票済み**(下記「設計への提案」) |

検査のテストは 17 本 → **27 本**に増えた(全体 30 → 40 tests)。

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
| **ロゴ「大富豪」のアウトライン化(E04 §5-1)** | **未消化**。理由は下記「詰まっている点」6 |

## 詰まっている点(人間の判断待ち)

プロセス1 から継続の 1〜5 は未解決のまま(レビュー側で decision-log への昇格をお願いしたい)。6 以降はプロセス2 で新たに出たもの。

1. **E04 設計書の状態が「提案(開発者の承認待ち)」のまま**で、`decision-log.md` A 節に E04 承認の記録がない。
2. **DS-01 受け入れ条件 3「開発者が承認済み」は実装担当には閉じられない。** 記録先が E04 付録「承認記録」= 設計書で、設計書は実装作業で変更しない契約(implementation-workorder §4-2)。承認日・対象(`key-visual-2a.svg` + トークンのコミットハッシュ)・承認者の記入をお願いしたい。
3. **E04 §5 の未決事項 6 件が `decision-log.md` に未登録。**
4. **インゲーム部品がデザインシステム成果物に無かった件** — プロセス2 で §5-16 として追加した(仮定 15)。**新規のデザイン判断なので開発者の目視承認を関門にしたい**(下記 8 と同じ)。
5. **キービジュアル 2A に JOKER カードが描かれているが、素の大富豪 v1(decision-log A-3、2026-07-25 決定)は「ジョーカーを初期から除外」としている。** 2A の決定は 2026-07-24 で A-3 より前。原資産は勝手に変更しない契約なので報告に留める。**OGP 画像も 2A から生成しているので同じ食い違いを含む**(共有先で最初に目に入る絵)。プロセス2 レビューの補足: 共有導線で最初に見える絵なので、**フェーズ 1 の公開前に整合の判断を付けるのが安全**。
6. **ロゴのアウトライン化(E04 §5-1)を実施していない。** 判断だけお願いしたい。

   当初「元フォントの入手とツールが障壁」と書いたが、これは**過大な見立てだった**(プロセス2 レビューで指摘)。M PLUS Rounded 1c は OFL でフル TTF が公式配布されており、fontTools + brotli で woff2 の伸長もできるので、**技術的な障壁は実質ない**。

   実際の関門は 2 つ: (a) 実施するかどうか自体が E04 §5-1 の未決事項、(b) パス化した字形が 2A の見えを保っているかの合否は人間の目視でしか下せない。承認ループの手前で投機的に作らず、**「実施の可否」だけ決めてもらえれば次のサイクルで機械的に進められる**状態にしてある。現状はライブテキスト版のままで、Android/Windows ではロゴの字形が変わる。
7. **DS-02 受け入れ条件 2 の最終クローズを E1/E3 の受け入れに積む必要がある**(仮定 4 の条件)。decision-log E 節への登録をお願いしたい。
8. **開発者の目視承認をお願いしたい 2 件**: (a) インゲーム部品 7 個の造形(仮定 15。design-system.html §5-16 と実画面)、(b) favicon の意匠(赤・金・緑の 3 枚札。`packages/web/public/favicon.svg`)。どちらも差し替えは安い(favicon は生成スクリプトの再実行 1 回)。
9. **`og:image` の絶対 URL**(仮定 17)。デプロイ先が決まったら差し替えが要る。
10. **Git remote が無いため GitHub Actions 上での CI 実行は未確認**(TS-02 から継続)。ローカルの `pnpm verify` 相当までは確認済み。
11. **実機のノッチ/ホームインジケータでの見え** は未確認(E04 §3.1(d) のとおり持ち越し)。ブラウザでは `env(safe-area-inset-*)` が 0 になるため、セーフエリアの効きそのものは検証できていない。

TS-02 から継続で未解決のもの:

- E12 §4.1 は Node.js LTS を指定しているが、ユーザー判断で趣味プロジェクトとして Node.js 26 Current への最新追随を優先した。実装・CI・決定ログは Node 26.5.0 に更新済みだが、作業指示に従い `docs/epics/E12-tech-stack.md` 自体は変更していない。

## 設計への提案・気づいたこと

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

### E2で見つけた設計書の不整合

- 冒頭改訂ノートは探索を `worker_threads` 1〜2本で実行すると決定済みだが、§3.1(d)・§4.4・§6-5には「初期はホスト直列、兆候が出たらworkerへ移行」という旧記述が残る。実装は改訂ノートを正とした。
- `AiDecision.play: Play` はpassを表現できない一方、§3.1(b)は合法手0件をパス強制としてAIの即決対象に含める。プロセス1ではAI呼出前にゲームループが強制passすることで契約を変えずに成立させた。
- §4.4は`playoutBatchSize`をisolateへの一括送信単位、`sliceMs`をホスト側のyield間隔としている。改訂ノートに従い探索全体をworkerへ移したため、実装ではそれぞれ親へpartial統計を送る反復数・経過時間の上限に読み替えた。UCB1統計自体はworker内で毎反復更新するため、バッチ分古い統計にはならない。

---

## 並行進行: E3 マルチプレイ

- 状態: MP-01/MP-02 の縦断実装中。純粋Room reducer・閲覧者別snapshot・RoomManager indexに加え、typed Socket.IO gateway、匿名session、phase/turn timer、E2 AI adapterまで接続した。ブランチ `codex/e3-multiplayer-process1`、main `25317dc` へrebase済み。
- コミット: `9c4ff46`（Room authority/view）、`3c351f3`（切断・離脱時の席/controller維持）、`2762261`（RoomManagerと招待index）、`5a477a9`（set境界・continue・参照分離）、`4cbc612`（Socket.IO gateway）、`36121c4`（phase timer）。
- 検証: Node 26.5.0 / pnpm 11.17.0 / TypeScript 6.0.3。純粋層で3ゲーム完走、実Socket.IO server/clientでcreate→join→start・再接続・後勝ちsession・closed通知、および1人+AI 3席のSocket→Room→Core→AI scheduler縦断完走を確認した。
- 依存: npm registry の `latest` を確認して `socket.io` / `socket.io-client` 4.8.3 を導入した。導入後の `pnpm outdated --format json` は、ユーザー指定で固定したTypeScript 6.0.3（registry latest 7.0.2）以外0件。

### プロセス1で完了したもの

- `RoomState` の `waiting` / `playing` / `setResult` / `closed`、単調増加する `v` とゲーム・セットをまたいでリセットしない `turnSeq`。
- 人間1〜4人から不足分だけAIを補充し、席の所有と `controller: human | ai` を分離。開始時に切断中の人間も人間数へ含め、その席をAI代行にする。
- play/passを「現在手番の席 → `turnSeq`一致 → Core合法性」の順で同期検証し、受理時だけ`v`と`turnSeq`を1増加。拒否では同一state参照を返す。
- 対局中の切断では席を保持してAI代行、復帰でhumanへ戻す。明示離脱は`departed`として不可逆にし、セット終了までは席と手札を維持する。待機中のホスト離脱は参加順で移譲する。
- `viewFor` を単一allow-list境界にし、本人の手札だけを含める。他人は枚数のみ。`userId`・token・Core private/KV/RNG・Effect内部表現・合法手一覧は配信型へ入れない。復帰snapshotは常に`events: []`。
- `RoomManager` の `Map<roomId, RoomState>`、invite→room、user→room index。招待コード正規化、1ユーザー1部屋、満員/対局中参加拒否、部屋破棄時の条件付きindex削除。
- setResult到達時に切断者・明示離脱者を除去して`byUser`を即時解放。全残留人間のcontinue、leaveとの競合、120秒期限での無応答除外、AI再補充、新しい`SetState`と最新ルール一覧の再固定。
- `viewFor`と公開Room eventをCore権威状態からdeep cloneし、gateway内処理からCard参照を変更できないようにした。
- Socket.IO server/client 4.8.3のtyped event/ack、匿名token、同一tokenの後勝ち接続、再接続時`events: []`の全量snapshot、受信者別state emit。
- `packages/core/src/protocol.ts`へ共有イベント型とzod schemaを置き、全client eventの受信時にstrict検証する。不正形は`BAD_PAYLOAD`、join過多は`RATE_LIMITED`、予期しない例外は`INTERNAL`でackする。zodは確認時latestの4.4.3をexact指定した。
- fingerprint付きtimerでintermission・setResult・turnを駆動。同じ状態の再syncで期限を延長せず、古いcallbackとAI決定中に進んだ`turnSeq`をno-opにする。AI演出間隔はE3仕様の0.8〜2.5秒をRoom側で持ち、`runAiTurn`内の遅延は0に上書きして二重待機を避ける。
- waiting切断60秒猶予、lobby TTL 30分、接続中人間0のabandon 5分を別のlifecycle timerで駆動。reconnectで予約を張り替え、部屋破棄時は全timerとindexを解除する。joinはIP単位10回/分のfixed-window制限を持つ。
- 漏洩回帰は16 seedで生成した多数局面と実Socketで受信した全snapshot/event列を走査する。二席play+timeoutの同一`turnSeq`三つ巴を全順序で確認し、切断中に数手進んだ後の再接続snapshot一致、破棄後timer/room/user/invite indexがゼロになることも固定した。

### E3で置いた仮定・次工程

| 仮定・残作業 | 根拠 | 次工程 |
|---|---|---|
| Room reducerとviewをSocket.IOより先に固定する | E03 §3.1(e)がSocket層を薄い変換に限定 | 完了。実Socket.IO in-process統合testを追加 |
| AI補充member IDと暫定表示名はserver生成 | E03 §3.2で機械名を暫定許容 | E4のトーン確定後に名前プールを差替え |
| E2の0.4〜1.2秒は探索adapter側の既定のまま維持し、E3の最終ペーシングは0.8〜2.5秒をRoom timer側で上書きする | E02の較正値とE03 §2.1/§3.2の値が不一致。Epic順では後段のE3 UX仕様を統合時の正とする | 完了。Room schedulerが0.8〜2.5秒、AI adapterへは遅延0を注入 |
| `setRespondBy`・人間手番deadline・intermissionは状態に予約済みだが、タイマー駆動は未接続 | timer callbackも予約時`turnSeq`を再検証する必要がある | 完了。fingerprintと`turnSeq`再検証をfake timerで確認 |
| waiting切断猶予、lobby TTL、無人対局abandon、join rate limit | E03 §2.1・§2.5・§3.1 | 完了。lifecycle timerとIP単位fixed-window limiterを追加 |
