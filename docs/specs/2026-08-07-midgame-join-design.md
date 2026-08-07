# 途中参加(AI席テイクオーバー)

## 1. 目的と背景

friend 部屋(`mode: 'community'`)は 4 席固定で開始し、開始後の入室口がない。誘われた人が
数分遅れただけで、次のセット(3 戦、数分〜十数分)が終わるまで合流できず、招待コードを
受け取ってから遊べるまでの摩擦が大きい。本仕様は、**進行中の部屋にいる AI 席を選んで
その瞬間に引き継ぐ**ことで途中参加を可能にする。新しい席を作らないので、エンジンが持つ
「1 セット = 4 人固定」の前提も、3 戦セットの採点・都落ちスコープ・セット境界の席シャッフルも
現行のまま維持できる。メンタルモデルは麻雀の途中入場、すなわち「AIプレイヤーB の席を
引き継いで参加する」である。

対象は community 部屋のみ。basic(ひとり練習)部屋は従来どおり `ROOM_SOLO_ONLY` で拒否する。
観戦は本仕様のスコープ外(9 節)。

## 2. 中核メカニズム: room 層での身元差し替え

エンジン(`packages/core`)の `SetState.members`(`packages/core/src/set/types.ts:23-35`)は
セット開始時に焼き込まれ 4 人固定だが、**memberId を変えなければエンジンは席の主が
入れ替わったことを知る必要がない**。

- AI メンバーの memberId(既定形 `${roomId}:ai:${setNo+1}:${index+1}`、生成は
  `packages/server/src/room/reducer.ts:241-266` の `aiMembers`)はそのまま維持する。
- room 層のメンバーレコード(`packages/server/src/room/types.ts:31-46` の `RoomMember`)だけを
  書き換える:

  - `userId` ← 参加者の userId、`displayName` ← 参加者の表示名
  - `isAI: false`、`controller: 'human'`、`connected: true`、`aiActing: false`、
    `departed: false`、`isHost: false`、`wantsNextSet: false`
  - `joinedAt: now`、`disconnectedAt: null`、`waitingDisconnectExpiresAt: null`
  - `memberId` はエンジンとの結び目なので変更しない。`seatId` は席が持つ値なので変更しない。

### エンジン無改修が成立する根拠

1. **表示名は room 層から取られる。** `memberViews` は `member.displayName` を読む
   (`packages/server/src/room/view.ts:157-189`、名前は 172 行)。ゲーム中の改名
   (`rename`、`packages/server/src/room/reducer.ts:981-1019`)が既にエンジン無改修で
   成立しており、テイクオーバーはその一般化にすぎない。
2. **「席を人間が打つか AI が打つか」は room 層の概念である。** ターン自動化の判定は
   room メンバーの `isAI` / `departed` / `connected` / `controller` を見る
   (`packages/server/src/room/timers.ts:236`、`:343`)。ミニゲームの bot 操作対象も
   毎 tick で room メンバーから算出する(`packages/server/src/room/reducer.ts:1177-1182`)。
   エンジン側スナップショットの `isAI` は使っていない。
3. **切断者の復帰と機械的に同型である。** `connectionChanged`
   (`packages/server/src/room/reducer.ts:909-979`)は同じレコードの
   `connected` / `controller` / `aiActing` を書き換え、`deadlineAtForTurn`
   (`:543-585`)で持ち時間を引き直し、`humanReturned` を発行する。テイクオーバーは
   「最初から存在しなかった人間の再接続」であり、通る配管は同じ。
4. **クライアント同期は毎回フルスナップショットである。** `viewFor`
   (`packages/server/src/room/view.ts:425-474`)が部屋の全量を作るので、参加直後の
   初期同期は既存の再接続経路をそのまま使える。
5. **保留中の AI 手番が漏れない。** タイマーの fingerprint は memberId・controller・
   connected・departed・`turnDeadlineAt` を含む(`timers.ts:238-248`)。テイクオーバーで
   fingerprint が変わり、`sync` が古い AI 遅延タイマーを張り替える(`timers.ts:144-159`)。
   さらに `#fireTurn` は AI 決定の待ち合わせ後に fingerprint を再検証してから `autoAct` を
   適用する(`timers.ts:332`)ので、テイクオーバー直前に走り始めた AI の着手は破棄される。

## 3. プロトコル契約

### 3.1 新しいエラーコード

`packages/core/src/protocol.ts:11-34` の 2 つの union に足す。

```ts
// RoomErrorCode(reducer の拒否理由)に追加
| 'SEAT_TAKEN'

// ErrorCode(manager / gateway 由来)に追加
| 'SEAT_CHOICE_REQUIRED'
```

`RoomManagerErrorCode`(`packages/server/src/room/manager.ts:41-47`)には
`SEAT_CHOICE_REQUIRED`(manager 層が `phase === 'playing'` を見て返す)と
`SEAT_TAKEN`(reducer の拒否理由を manager が素通しする)の両方を足す。

現在の `manager.join` は reducer の拒否理由を `ALREADY_IN_ROOM` / `ROOM_FULL` /
`ROOM_IN_GAME` の 3 つに畳む(`manager.ts:305-315`)。テイクオーバー経路では畳まず、
`SEAT_TAKEN` / `ROOM_FULL` / `ALREADY_IN_ROOM` をそのまま呼び出し元へ返す。

**manager 層のエントリポイント(確定)**: テイクオーバーは `manager.join` の拡張ではなく、
`manager.apply` と同じパイプライン、すなわち **`persistence.commit` の遷移オブザーバを
通る経路で dispatch する**(理由は 6 節)。`manager.join` は `reduceRoom` を直接呼び
commit を経由しない(`manager.ts:296-321` に対し `apply` は `manager.ts:341`)ため、
join 側の配管をそのまま使うと `set_participants` 登録のフックが動かない。テイクオーバー用の
エントリポイントは `#byUser` への userId → roomId 登録(`manager.ts:75`)も自分で行う。

### 3.2 `room:join` の payload 拡張

```ts
'room:join': z
  .object({
    inviteCode: z.string().regex(/^[0-9]{5}$/),
    takeoverMemberId: z.string().min(1).max(200).optional(),
  })
  .strict(),
```

`.strict()` のままなので、`takeoverMemberId` を知らない既存クライアントの payload は
そのまま通る(10 節)。ack の型 `Ack<{ roomId: string }>` は変えない。

### 3.3 `room:seatOptions`(新規・読み取り専用)

```ts
'room:seatOptions': z
  .object({ inviteCode: z.string().regex(/^[0-9]{5}$/) })
  .strict(),
```

```ts
export interface SeatOption {
  memberId: string;
  displayName: string;
  /** 現セット内の直前のゲームの順位。セット 1 戦目は null。 */
  previousRank: Standing | null;
  /** 現在の手札枚数。ゲーム間インターミッション中は null。 */
  handCount: number | null;
}

'room:seatOptions': (
  payload: ClientPayload<'room:seatOptions'>,
  ack: (result: Ack<{ roomId: string; seats: SeatOption[] }>) => void,
) => void;
```

- `previousRank` は `engine.results.at(-1)?.standings` から当該 memberId の `standing` を引く
  (`GameResult`: `packages/core/src/game/types.ts:273-281`)。ラベル変換(1=大富豪、2=富豪、
  3=貧民、4=大貧民)はクライアント側の責務。
- `handCount` は `engine.currentGame.players[memberId].hand.length`。`memberViews` の
  `handCount`(`view.ts:178-179`)と同じ意味・同じ名前にそろえる。`engine.phase.name` が
  `'interimResult'` のときは `null`。
- 列挙するのは `phase === 'playing'` のときだけ。それ以外のフェーズは常に `seats: []` を返す。
  セット終了後の AI メンバーは `setResult` 中も `state.members` に残る
  (`settleMembersAtSetResult` は AI を除去しない:`packages/server/src/room/reducer.ts:381-397`)
  ので、この明示的なフェーズ判定がないと引き継げない席を提示してしまう。
- 対象は `isAI === true` の席のみ。最大 3 件。切断中・離脱済み人間の `aiActing` 席は
  **含めない**(その人が戻る余地を残す。身元の再割り当ては将来課題)。
- 全席が人間なら `ok` で `seats: []` を返す。エラーにはしない。
- `room:join` と同じ `joinRateLimiter`(IP ごと 10 回 / 60 秒、
  `packages/server/src/room/socket-gateway.ts:194-196`)で数える。draining 中は
  `room:join` と同じく `INTERNAL` を返す(`socket-gateway.ts:488-491`)。
- 部屋に入らない読み取り専用エンドポイントなので、`#byUser` は触らない。既にどこかの部屋に
  いるユーザーからの呼び出しも拒否しない(実際の入室は `room:join` が `ALREADY_IN_ROOM` で
  止める)。

### 3.4 新しい `RoomGameEvent`

`packages/core/src/protocol.ts:64-95` の union に、識別子 `t` を持つ枝として追加する。

```ts
| {
    t: 'seatTakeover';
    memberId: string;
    displayName: string;
    previousName: string;
  }
```

既存の `memberId` だけを持つ枝群とは別に、名前 2 つを載せた枝にする。全クライアントの
トースト「◯◯さんが参加しました(AIプレイヤーBの席)」用。

### 3.5 新しい reducer アクション

```ts
| {
    type: 'joinTakeover';
    takeoverMemberId: string;
    user: { userId: string; displayName: string };
    now: number;
  }
```

検証:

| 条件 | 拒否コード |
| --- | --- |
| `phase === 'closed'` | `ROOM_CLOSED` |
| `phase !== 'playing'` | `SEAT_TAKEN` |
| 対象 memberId が存在しない / `isAI !== true` | `SEAT_TAKEN` |
| 同一 userId が既に部屋にいる | `ALREADY_IN_ROOM` |

合格したときの成立時処理:

1. 2 節のメンバーレコード書き換えを行う。
2. `turnDeadlineAt` を `deadlineAtForTurn`(`reducer.ts:543-585`)で引き直す。
3. `abandonAt` を `connectionChanged` と同じ規則で再計算する(`reducer.ts:947-951`)。参加者は
   接続中の人間なので、進行中だった見捨て判定は `null` に戻る。
4. `seatTakeover` イベントを発行する。
5. gateway は成功後に `emitState` で**部屋の全メンバーへフルスナップショットを配信**する
   (`socket-gateway.ts:218-237`)。参加者の初期同期と、既存メンバーの席表示・トースト更新を
   1 回の配信でまかなう。あわせてタイマーコーディネータを `sync` する。

## 4. 状態遷移とフェーズ別挙動

`room:join` の挙動を部屋の状態ごとに確定する。

| 部屋の状態 | `takeoverMemberId` なし | `takeoverMemberId` あり |
| --- | --- | --- |
| basic 部屋(全フェーズ) | `ROOM_SOLO_ONLY` | `ROOM_SOLO_ONLY` |
| `waiting` | 従来どおり成功(変更なし) | `SEAT_TAKEN` |
| `playing` | `SEAT_CHOICE_REQUIRED`(従来は `ROOM_IN_GAME`) | テイクオーバー実行 |
| `setResult` | 席なしメンバーとして入室(4.2) | `SEAT_TAKEN` |
| `closed` / 該当なし | `ROOM_NOT_FOUND`(部屋は閉室時に索引から消える) | 同左 |
| draining 中 | `INTERNAL` | `INTERNAL` |

`room:seatOptions` はどの状態でも `ok` を返し、テイクオーバー可能な席がなければ `seats: []` と
する(`waiting` / `setResult` / basic 部屋はすべて空配列)。部屋が見つからなければ
`ROOM_NOT_FOUND`。クライアントは「空配列 = 席選択では入れない」として扱う。

### 4.1 `playing` 中(テイクオーバー本体)

`interimResult`(ゲーム間インターミッション)は room の `phase` としては `playing` なので、
この行に含まれる。テイクオーバーは可能で、`handCount` だけが `null` になる。

### 4.2 `setResult` 中(最大 120 秒)の join を許可する

拒否するとセットの切れ目に 2 分間の「入れない穴」ができ、招待した側から見て挙動が読めない。
そこで setResult 中は**テイクオーバーではなく通常入室**を許す。

- `seatId: null`、`wantsNextSet: true` で入室する。通常 join が `wantsNextSet: false` を
  入れる(`reducer.ts:621`)のに対し、ここだけ `true` にする。次セットを待っている人の
  合意を新参者が引き延ばさないため。
- この参加者は終了済みセットの参加者ではない。クライアントはセット結果・評価UIではなく
  「次のセットを待っています」を表示し、`set_participants` にも追加しない。
- 次セット開始(`continueSet` → `startSet`、または `expireSetResult` → `startSet`)で
  通常の席割り当てにより着席する。
- `continueSet` の「接続中の全人間が同意」判定(`reducer.ts:685-690`)では
  `wantsNextSet: true` により即座に同意済みとして数えられる。`expireSetResult` の
  「続けたい人間」抽出(`reducer.ts:812-818`)にも入るので、既存メンバーが誰も
  続けなくても参加者ひとりで次セットが始まる。
- 定員判定は `!isAI && !departed` の人間が 4 人以上なら `ROOM_FULL` とする。setResult では
  `settleMembersAtSetResult`(`reducer.ts:381-407`)が離脱者・切断者を結果表示用に保持するため、
  `departed` を除外しないと空きがある次セットへ参加できなくなる。切断中の人間も
  setResult 到達時に `departed: true` へ確定する。これにより、表示用の過去メンバーを
  残しても `startSet`(`reducer.ts:459-470`、席は 4 つしかない)に 5 人以上が渡らない。
- reducer 側 join の `phase !== 'waiting'` ガード(`reducer.ts:595-597`)と manager 側の
  `phase !== 'waiting'` → `ROOM_IN_GAME`(`manager.ts:292-294`)を、このケースについて緩める。

## 5. 得点・状態の相続セマンティクス

参加者は席が積み上げた状態を**すべて相続する**。

- セット内の順位点(過去の戦の `points`)
- ゲームごとの成績履歴(`previousResults`)
- 都落ちなど、ルールが持つ継続状態
- 進行中の手札と、その席宛の保留中選択

これにより「途中参加者が 0 点から始まる」問題が起きず、セット単位で完結する採点・
都落ちスコープ・セット境界のシャッフルを一切変えずに済む。セットリザルトでは席の合計
(AI が打った分を含む)が参加者名義で並ぶが、friend 対戦では許容する(v1 確定)。

UX 上のメンタルモデルは「AIプレイヤーB の席を引き継いで参加」である。席選択カードに
「残り N枚」と「前回の成績」を出し、**合計得点は出さない**(7 節)ことで、参加者が
「自分の得点」と誤解しない導線にする。

過去ゲームのログは席(`SeatId`)で記録され、名前はクライアントが `members` から解決する
(`GameResultView.standings` は `seat` のみを持つ:`packages/core/src/protocol.ts:140-145`)。
したがって参加前の戦の行も参加者名義で表示される。相続のメンタルモデルと一致しており、
これを正とする。

テイクオーバーの事実はセット終了まで表示する。`MemberView.joinedMidSet` は、room メンバーが
人間である一方、同じ memberId の `engine.members` が AI のままであることから導出する。
卓では「途中参加(AI分を含む)」、セットリザルトでは「AI分を含む」と表示する。次セットでは
エンジンメンバーが人間として作り直されるため、この表示は自然に消える。

### 相続しないもの(既知の割り切り)

AI 入力に使う `PlayerSnapshot` の `displayName` / `isAI` はセット開始時のエンジン側メンバーから
作られる(`packages/core/src/snapshot/snapshot.ts:93-94`)。したがって他の AI からはテイクオーバー後も
「AIプレイヤーB」「isAI: true」のまま見える。現行 AI はこの違いを意思決定に使わないため、v1 では
許容する。ルールモジュールが受け取るのは `PlayerSnapshot` ではなく `RuleContext` であり、そこに
`displayName` / `isAI` は含まれない。

## 6. 永続化・評価への影響

- `set_participants`(`packages/server/src/evaluation/repository.ts:125-129`)はセット後の
  評価(セット評価・ルール投票)のアクセス制御に使われる(`repository.ts:522-541` の `#access`)。
  現在はセット開始時に一括登録される(`beginSet`、`repository.ts:204-219`、呼び出しは
  `packages/server/src/persistence.ts:510-526`)ため、途中参加者は評価に参加できない。
- テイクオーバー成立時に `INSERT OR IGNORE` で当該 userId を `set_participants` に足す。
  `persistence.commit` は表示イベントではなく `action.type === 'joinTakeover'` を根拠にし、
  `action.user.userId` を登録する。
- **契約**: そのためにテイクオーバーの適用は `persistence.commit` の遷移オブザーバを通る経路、
  すなわち `manager.apply` と同じパイプライン(`manager.ts:341`)で dispatch する。
  `manager.join` は `reduceRoom` を直接呼び commit を経由しない(`manager.ts:296-321`)ので、
  join 側の配管には載せない(3.1 節の確定事項)。
- リプレイ記録は影響を受けない。`replayAction`(`persistence.ts:175-247`)は着手系アクションのみを
  記録し、それ以外は `undefined` を返すため、テイクオーバーはリプレイに残らない。
- `setResults` の JSON(エンジンの outcome、memberId キー)は変更不要。`SetResultView` は
  room メンバーから名前を解決するので、参加者名義で表示される。

## 7. クライアント UX 仕様

入口は既存の招待コード入力(`PlaySheet` の `'join'` ステップ、
`packages/web/src/screens/PlaySheet.tsx:24`)。ゲーム中でもコード入力から先へ進める。

1. `room:join` が `SEAT_CHOICE_REQUIRED` を返したら、`room:seatOptions` を呼んで席選択ビューへ
   遷移する。
2. 席カード(最大 3 枚)の表示項目:
   - AI 名(例「AIプレイヤーA」)
   - 前回の成績ラベル: 大富豪 / 富豪 / 貧民 / 大貧民。`previousRank` が `null`(セット 1 戦目)
     なら空欄。
   - 「残り N枚」。`handCount` が `null`(インターミッション中)なら空欄。
   - タップ領域の文言「この席に入る」
   - **合計得点は表示しない。**
3. `seats` が空 → 「満席のため参加できません」。
4. カードをタップ → `room:join { inviteCode, takeoverMemberId }`。
5. `SEAT_TAKEN` → まず `takeoverMemberId` なしの `room:join` を再試行する。セット終了後の
   `setResult` ならこれが成功し、次セット待ちとして入室できる。まだ playing 中なら
   `SEAT_CHOICE_REQUIRED` になるため、「その席は埋まりました」を出して `room:seatOptions` を
   取り直す。再取得結果が空なら 3 の文言に切り替える。
6. 成功 → そのままゲーム画面へ。全員に `seatTakeover` トースト
   「◯◯さんが参加しました(AIプレイヤーBの席)」。

エラー文言は既存の `friendlyError`(`packages/web/src/App.tsx:2202-2214`)に追加する。
`SEAT_CHOICE_REQUIRED` は席選択ビューへの遷移で消費するため、文言としては露出しない
(フォールバックとして「この部屋は対戦中です。空いている席をえらんでください」を持つ)。

## 8. エッジケースと確定挙動

- **対象席に保留中の選択(`pendingChoice`)がある。** 選択要求は memberId で指定されるので
  そのまま参加者に引き継がれる。`deadlineAtForTurn` は `awaitingChoice` のとき
  `nextRoomChoiceRequest` が返す player を見る(`reducer.ts:561-568`)ため、接続中人間の
  持ち時間(60 秒)が引き直される。同時選択では `nextRoomChoiceRequest`
  (`packages/server/src/room/pending-choice.ts:8-21`)が AI・離脱者の要求を優先するので、
  テイクオーバー後は残り AI の要求が先に自動解決され、その後に参加者の要求が表に出る。
  参加者の選択機会が消えることはない。
- **ミニゲーム(`bomb_throw_15`)進行中。** bot 操作対象は tick ごとに room メンバーから
  再計算される(`reducer.ts:1177-1182`)ので、テイクオーバーは**次の 200ms tick から**
  人間操作に切り替わる。それ以前の tick は bot が動かしたまま有効。参加者からの
  `game:miniGameInput` は `isAI === false && aiActing === false && connected` を満たすので
  即座に受け付けられる(`reducer.ts:1168-1176`)。ミニゲーム中は `turnDeadlineAt` が
  `null` になる(`reducer.ts:558-560`)ので、持ち時間の引き直しは発生しない。
- **AI 宛に届いていた `privateRuleNotices`。** 個別通知は playerId(= memberId)で宛先が
  決まり、スナップショット生成時に受け手ごとに絞られる
  (`packages/core/src/snapshot/snapshot.ts:121-122`、描画は `view.ts:285`)。memberId を
  変えないので、テイクオーバー後の最初のフルスナップショットで参加者に届く。これを正とする。
- **その席の手番中だった場合。** `turnDeadlineAt` を接続中人間の持ち時間で再計算し
  (`deadlineAtForTurn`、`reducer.ts:579-584`)、タイマーコーディネータを `sync` する。
  保留中の AI 遅延タイマーは fingerprint 差し替えで捨てられ、走行中の AI 決定は
  `#fireTurn` の再検証(`timers.ts:332`)で破棄される。
- **全人間が切断中の部屋への参加。** 接続中の人間が 0 になると `abandonAt` が立ち
  (`reducer.ts:947-951`)、見捨てタイマーが `expireRoom` を予約する(`timers.ts:471-481`)。
  この部屋への途中参加は典型場面なので、テイクオーバー成立時に `abandonAt` を `null` に
  戻す(3.5 節の成立時処理 3)。`expireRoom` は発火時に「接続中の人間がいないこと」を
  再検証する(`reducer.ts:880-886`)ので誤って閉室することはないが、stale な `abandonAt` を
  残すと期限超過後の再スケジュールが遅延 0ms になり(`timers.ts:416`)、拒否と再スケジュールを
  繰り返す。再計算はこの空回りを防ぐためにも必要。
- **同時に 2 人が同じ席を選んだ。** 先着が成立し、後着は reducer の `isAI !== true` 検証で
  `SEAT_TAKEN`。
- **一覧取得と選択の間にフェーズが変わった。** `playing` → `setResult` に移った後に
  `takeoverMemberId` 付き join が届いたら `SEAT_TAKEN` を返す。クライアントは 7-5 の
  席なし `room:join` 再試行により、setResult の次セット待ちとして入室する。
  `playing` → `closed` の場合は `ROOM_NOT_FOUND`。
- **セット境界をまたいだ席の消滅。** `startSet` は AI メンバーを毎セット作り直す
  (`reducer.ts:449-454`、memberId に setNo を含む)ので、古い `takeoverMemberId` は
  存在せず `SEAT_TAKEN` になる。
- **テイクオーバー直後の切断・再接続。** 参加者は通常の人間メンバーなので、以後の
  `disconnect` / `reconnect` は既存の `aiTakeover` / `humanReturned` 経路にそのまま乗る
  (`reducer.ts:909-979`)。
- **draining 中。** `room:join`・`room:seatOptions` とも `INTERNAL`(`server is draining`)。
  既存の `room:join` と同じ扱い(`socket-gateway.ts:488-491`)。
- **1 ユーザー 1 部屋。** `#byUser`(`manager.ts:75`)による `ALREADY_IN_ROOM` は維持する。
  テイクオーバー成功時に `#byUser` へ userId → roomId を登録する。
- **同じ部屋から離脱した人の再入室。** `playing` 中に離脱したメンバーは `departed: true` で
  残る(`reducer.ts:708-719`)。join の重複判定は userId を `departed` で絞らずに見る
  (`reducer.ts:598-606`)ため、同じユーザーはセット境界でレコードが消えるまで
  `ALREADY_IN_ROOM` で弾かれる。v1 の意図した挙動とする(離脱人間席の引き継ぎはスコープ外)。
- **途中離脱後のセット結果。** AI 代行でセットを完走した場合、エンジンの結果には離脱席も
  4 席の一員として残る。`setResult` の表示中は `departed: true` のメンバーを席・表示名の
  解決用に保持し、再アタッチと次セット参加からは除外する。次セット開始または部屋終了で
  除去する。
- **ホスト。** 参加者は `isHost: false`。ホスト移譲は起きない。

## 9. スコープ外 / 将来

- **観戦。** 次フェーズで実装する。席が埋まっていても部屋の中身を見られるようにする方向。
- **切断中・離脱済み人間の席の引き継ぎ。** 本人が戻る可能性があるため v1 では対象外。
  身元の再割り当ての設計が必要。
- **basic(ソロ)部屋への途中参加。** 将来の乱入マッチングで、本仕様の席テイクオーバー機構を
  再利用する想定。
- **満席時の入室待ち。** 行わない。エラー文言のみ。
- **3 戦セット構造の変更。** 相続方式にしたことで不要になった。

## 10. 互換性

- **既存クライアント。** `room:join` の payload は `takeoverMemberId` が optional なので、
  従来の `{ inviteCode }` はそのまま通る。ただし進行中の community 部屋への join で返る
  コードが `ROOM_IN_GAME` → `SEAT_CHOICE_REQUIRED` に変わるため、旧クライアントは
  `friendlyError` のフォールバック文言(「操作に失敗しました。もう一度ためしてください」)を
  表示する。文言が劣化するだけで、入れないという結果は従来と同じ。
- **既存の部屋。** 進行中の部屋も含め、状態の移行や再作成は不要。`RoomState` に新しい
  フィールドを足さないため、稼働中の部屋がそのままテイクオーバーの対象になる。
- **`RoomGameEvent`。** 旧クライアントは未知の `t` を持つイベントを受け取る。イベントは
  表示用の追記情報であり、未知の枝を無視できることが前提の設計になっている。
- **永続データ。** スキーマ変更なし。`set_participants` への追加 INSERT のみ。
- **`docs/epics/E03-multiplayer.md`** の「観戦・対局中の途中参加: 4席固定で開始後の入室は
  ない」の記述は、本 spec を参照する形へ改訂する。
