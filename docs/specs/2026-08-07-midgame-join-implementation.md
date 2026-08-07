# 途中参加(AI席テイクオーバー)実装指示書

## 0. 前提

- **設計書(正)**: [`docs/specs/2026-08-07-midgame-join-design.md`](./2026-08-07-midgame-join-design.md)。実装レビューで確定した補足も同設計書を正とする。
- 実装前に必ず読む節: **§2**(エンジン無改修が成立する根拠)、**§3**(プロトコル契約の全文)、**§4**(フェーズ別の挙動表)、**§8**(エッジケースの確定挙動)。§5〜§7 は該当ステップの着手前でよい。
- 本書の file:line は 2026-08-07 時点の実物。行がずれても、併記した関数名でアンカーを取り直せる。
- 「room 層」= `packages/server/src/room/*`、「エンジン」= `packages/core`。本仕様は**エンジンのゲームロジックを変更しない**(`protocol.ts` の契約追加のみ)。

---

## Step 1: `packages/core/src/protocol.ts` — 契約の追加

設計書 §3.1 / §3.2 / §3.3 / §3.4。

**1-1. エラーコード。** `RoomErrorCode`(`protocol.ts:11-24`、末尾 `| 'INVALID_NAME';`)に `'SEAT_TAKEN'`。`ErrorCode`(`:26-34`)に `'SEAT_CHOICE_REQUIRED'`。`SEAT_TAKEN` は `ErrorCode = RoomErrorCode | ...` 経由で自動的に入るので二重に書かない。

**1-2. `SeatOption` 型。** `MemberView`(`:45-57`)の近くに置く(設計書 §3.3 からの転記):

```ts
export interface SeatOption {
  memberId: string;
  displayName: string;
  /** 現セット内の直前のゲームの順位。セット 1 戦目は null。 */
  previousRank: Standing | null;
  /** 現在の手札枚数。ゲーム間インターミッション中は null。 */
  handCount: number | null;
}
```

`Standing` は `protocol.ts:6` で既に import 済み(定義は `packages/core/src/game/types.ts:15`)。追加 import は不要。

**1-3. zod スキーマ。** `clientPayloadSchemas`(`:262-324`)を編集。`'room:join'`(`:266-268`)は `.strict()` を維持したまま optional を足し、その直後に新エントリを置く:

```ts
  'room:join': z
    .object({
      inviteCode: z.string().regex(/^[0-9]{5}$/),
      takeoverMemberId: z.string().min(1).max(200).optional(),
    })
    .strict(),
  'room:seatOptions': z
    .object({ inviteCode: z.string().regex(/^[0-9]{5}$/) })
    .strict(),
```

**1-4. `ClientToServerEvents`(`:331-380`)。** `'room:join'` の定義(`:336-339`)に続けて追加する。`room:join` の ack 型 `Ack<{ roomId: string }>` は**変えない**:

```ts
  'room:seatOptions': (
    payload: ClientPayload<'room:seatOptions'>,
    ack: (result: Ack<{ roomId: string; seats: SeatOption[] }>) => void,
  ) => void;
```

**1-5. `RoomGameEvent`(`:64-95`)。** 既存の「memberId だけを持つ枝」(`:65-76`)とは別枝として、`| { t: 'ruleFired'; ... }` の手前に足す(設計書 §3.4 からの転記):

```ts
  | {
      t: 'seatTakeover';
      memberId: string;
      displayName: string;
      previousName: string;
    }
```

**1-6. server 側の再エクスポート。** `packages/server/src/room/protocol.ts`(型再エクスポート 9 行)に、server から使うなら `SeatOption,` を足す。`RoomErrorCode` / `RoomGameEvent` は `packages/server/src/room/types.ts:14-27` 側で再エクスポート済みで変更不要。`RoomGameEventPayload`(`types.ts:48-52`、`seq` を剥がす条件型)は自動追随する。

---

## Step 2: `packages/server/src/room/reducer.ts` — `joinTakeover` と join の緩和

設計書 §3.5 / §4.2 / §8。

**2-1. `RoomAction` に枝を足す。** `packages/server/src/room/types.ts:78-181` の union、`| { type: 'join'; ... }`(`:82-92`)の直後に(設計書 §3.5 からの転記):

```ts
  | {
      type: 'joinTakeover';
      takeoverMemberId: string;
      user: { userId: string; displayName: string };
      now: number;
    }
```

`reduceRoom` の switch(`reducer.ts:1411-1459`)の `case 'join':`(`:1425-1426`)の隣に `case 'joinTakeover':` を足す。

**2-2. `joinTakeover` 関数。** `join`(`reducer.ts:587-632`)の直後に置く。拒否は既存の `rejected()`(`:153-164`)、成立は `committed()`(`:177-204`)を使う。検証はこの順(設計書 §3.5 の表):

| 条件 | `RoomErrorCode` |
| --- | --- |
| `state.phase === 'closed'` | `ROOM_CLOSED` |
| `state.phase !== 'playing'` | `SEAT_TAKEN` |
| 対象 memberId が無い / `isAI !== true` | `SEAT_TAKEN` |
| `state.members.some((m) => m.userId === action.user.userId)` | `ALREADY_IN_ROOM` |

成立時のメンバーレコード書き換え(設計書 §2 の一覧が正)。**`memberId` と `seatId` は変えない**:

```
userId ← action.user.userId, displayName ← action.user.displayName,
isAI: false, controller: 'human', connected: true, aiActing: false,
departed: false, isHost: false, wantsNextSet: false,
joinedAt: action.now, disconnectedAt: null, waitingDisconnectExpiresAt: null
```

`committed()` に渡す patch:

- `members`: 上記で差し替えた配列。
- `turnDeadlineAt`: `deadlineAtForTurn(state.engine, members, state.mode, action.now, options)`(`reducer.ts:543-585`)。`connectionChanged` の呼び出し(`reducer.ts:956-964`)と同じ形。`state.engine` が null のときの `null` ガードも同じに書く。
- `abandonAt`: `connectionChanged` の規則(`reducer.ts:947-951`)を写す。参加者は接続中の人間なので結果は `null` になる。**書き忘れると設計書 §8「全人間が切断中の部屋への参加」の空回りが起きる。**

イベントは `{ t: 'seatTakeover', memberId, displayName: 新しい表示名, previousName: 旧 AI 名 }` を 1 件。`previousName` は書き換え**前**の `member.displayName`(例「AIプレイヤーB」)。

**2-3. `setResult` 中の通常 join を許可する。** `join` の phase ガード `if (state.phase !== 'waiting') return rejected(state, 'NOT_WAITING');`(`reducer.ts:595-597`)を `state.phase !== 'waiting' && state.phase !== 'setResult'` に緩める。あわせて生成メンバーの `wantsNextSet`(現在は固定 `false`、`:621`)を `state.phase === 'setResult' ? true : false` にする(設計書 §4.2)。他フィールドは変えない。重複判定(`:598-606`)と定員判定(`:607-609`、`!isAI` の人間 4 人以上で `ROOM_FULL`)はそのまま使う。`wantsNextSet: true` が `continueSet` の全員同意判定(`:685-690`)と `expireSetResult` の継続者抽出(`:812-818`)の両方に効く。

**2-4. `seatOptions` 用セレクタ。** `export function seatOptionsFor(state: RoomState): SeatOption[]`。置き場所は **`view.ts`** を推奨(`memberViews`(`view.ts:157-189`)と同じ「room state → クライアント向け DTO」の変換)。

- `state.phase !== 'playing'` なら**必ず `[]`**(設計書 §3.3)。`settleMembersAtSetResult`(`reducer.ts:381-397`)は AI を除去しないので、このガードが無いと setResult 中に引き継げない席を出す。
- 対象は `member.isAI === true` のみ。切断中・離脱済み人間の `aiActing` 席は**含めない**。
- `previousRank`: `state.engine.results.at(-1)?.standings.find((s) => s.player === memberId)?.standing ?? null`。`GameResult` は `packages/core/src/game/types.ts:273-281`。
- `handCount`: `state.engine.phase.name === 'interimResult'` なら `null`、それ以外は `state.engine.currentGame?.players[memberId]?.hand.length ?? null`。`memberViews` の同名フィールド(`view.ts:178-179`)と意味をそろえる。
- ラベル変換(1=大富豪 …)はサーバーではやらない。クライアントの責務(設計書 §3.3)。

---

## Step 3: `packages/server/src/room/manager.ts` — エントリポイント

設計書 §3.1(確定事項)/ §4 / §6。

**3-1.** `RoomManagerErrorCode`(`manager.ts:41-47`)に `'SEAT_CHOICE_REQUIRED'` と `'SEAT_TAKEN'` を足す。

**3-2. `join` の分岐(`manager.ts:278-322`)。** `if (room.phase !== 'waiting') return { ok: false, code: 'ROOM_IN_GAME' };`(`:292-294`)を設計書 §4 の表に置き換える。`room.mode === 'basic'` の `ROOM_SOLO_ONLY`(`:289-291`)は**この判定より前**のまま維持する。

- `playing` → `SEAT_CHOICE_REQUIRED`
- `setResult` → そのまま下の `reduceRoom(... type: 'join' ...)` へ進む
- `waiting` → 従来どおり
- `closed` は到達しない。`#removeClosed`(`:394-404`)が `#byInvite` から外すので、手前の `!room` 判定(`:284-286`)で `ROOM_NOT_FOUND` になる

reducer 拒否理由の畳み込み(`:305-315`)は通常 join 経路では現状維持でよい。

**3-3. テイクオーバー用の新メソッド。** `join` は `reduceRoom` を直接呼び `persistence.commit` を経由しない(`:296-304` に対し commit を通すのは `apply` の `:341`)。設計書 §3.1 / §6 の確定事項により、**テイクオーバーは `apply` 経由で dispatch する**。`#byInvite`(`:74`)も `#byUser`(`:75`)も private なので、エントリポイントは `RoomManager` のメソッドにする。

```ts
joinTakeover(
  inviteCode: string,
  user: RoomUser,
  takeoverMemberId: string,
): RoomManagerResult<RoomMembership & { previous: RoomState; transition: RoomTransition }>
```

戻り値に適用前の `RoomState` と `RoomTransition` を含めるのは、gateway が `publishTransition` へ渡すため(Step 4-2)。

処理順(既存 `join` の並びを写す):

1. `this.findByUser(user.userId)`(`:110-126`)が真なら `ALREADY_IN_ROOM`。
2. `#byInvite.get(normalizeInviteCode(inviteCode))` → `#rooms.get(roomId)`。無ければ `ROOM_NOT_FOUND`。
3. `room.mode === 'basic'` なら `ROOM_SOLO_ONLY`。
4. `this.apply(room.roomId, { type: 'joinTakeover', takeoverMemberId, user, now: this.#options.now() })`。
5. `undefined` / `!accepted` なら reducer の拒否理由を**畳まずそのまま返す**(設計書 §3.1)。
6. 成立したら `this.#byUser.set(user.userId, room.roomId)` を**自分で**行う(`apply` は #byUser の削除しかしない: `:350-372`)。
7. `transition.state.members.find((m) => m.memberId === takeoverMemberId)!` を member として返す。

**3-4. 招待コードで部屋を引く読み取り口。** `room:seatOptions` は入室しないので `findByUser` を通らない。`findByInvite(inviteCode: string): RoomState | undefined` を足す。`normalizeInviteCode`(`:68-70`)を通してから `#byInvite` → `#rooms` を引くだけ。

---

## Step 4: `packages/server/src/room/socket-gateway.ts` — ハンドラ

設計書 §3.3 / §3.5-5 / §4。

**4-1. `room:seatOptions` ハンドラ。** `room:join` ハンドラ(`socket-gateway.ts:486-515`)の直後に、同じ骨格で足す。全体を `try { ... } catch (error) { handleUnexpected(error, ack); }`(`:406-412`)で囲む。

1. `draining` なら `failure('INTERNAL', 'server is draining')`(`:488-491` と同じ文言)。
2. `joinRateLimiter.allow(clientIp(socket), now())`(`:492-495`。limiter は `:194-196`、既定 10 回 / 60 秒)。落ちたら `RATE_LIMITED`。
3. `clientPayloadSchemas['room:seatOptions'].safeParse(payload)` 失敗で `BAD_PAYLOAD`。
4. `rooms.findByInvite(...)` が無ければ `ROOM_NOT_FOUND`。
5. `safeAck(ack, { ok: true, value: { roomId: room.roomId, seats: seatOptionsFor(room) } })`。basic 部屋・`waiting` / `setResult` はセレクタが `[]` を返すので、ここでエラーにしない(設計書 §4 末尾)。

**4-2. `room:join` の分岐。** `:501` の `rooms.join(parsed.data.inviteCode, session)` を分岐させる。`takeoverMemberId` 未指定なら既存どおり(成功時は `emitState` + `lifecycleTimers.sync`、`:506-507`)。指定ありなら `rooms.joinTakeover(...)`。

テイクオーバー成功時は `publishTransition(previous, transition)`(`:382-390`)を使う。これ 1 本で設計書 §3.5-5 の要求(`emitState` による全メンバーへのフルスナップショット + `phaseTimers.sync` + `lifecycleTimers.sync`)を満たす。そのため `joinTakeover` は適用前の `RoomState` と `RoomTransition` も呼び出し元へ渡す必要がある(戻り型に `previous` / `transition` を含める)。ack は `{ ok: true, value: { roomId } }` のまま。

タイマー同期が要る理由: 参加席が手番中だったとき、`RoomTimerCoordinator` の fingerprint(`timers.ts:238-248`。memberId・connected・controller・departed・`turnDeadlineAt` を含む)が変わり、`sync`(`timers.ts:136-160`)が古い AI 遅延タイマーを張り替える。走行中の AI 決定は `#fireTurn` の再検証(`timers.ts:332`)で破棄される。`abandonAt` を `null` に戻した効果は `RoomLifecycleTimerCoordinator`(`timers.ts:471-481`)の sync で反映される。

---

## Step 5: `packages/server/src/persistence.ts` — `set_participants`

設計書 §6。`SqlitePersistence.commit`(`persistence.ts:476-576`)のトランザクション内、`beginSet` を呼ぶブロック(`:510-526`)の**直後**に足す:

表示用の `seatTakeover` イベントには依存しない。`action.type === 'joinTakeover'` を判定し、
`action.user.userId` と `next.engine.setId` を使う。

`EvaluationRepository`(`packages/server/src/evaluation/repository.ts`)に 1 メソッド足す。`beginSet` 内の参加者 INSERT(`repository.ts:213-219`)をそのまま写す:

```sql
INSERT OR IGNORE INTO set_participants(set_id, user_id)
SELECT ?, user_id FROM users WHERE user_id = ?
```

`set_participants` の DDL は `repository.ts:125-129`、これを読むアクセス制御は `#access`(`repository.ts:522-541`)。`users` との JOIN 形にすることで、存在しない userId が外部キー違反にならない点も既存と同じ。

**リプレイは変更不要**: `replayAction`(`persistence.ts:175-247`)は着手系アクションだけを記録し、それ以外は `undefined` を返すので、`joinTakeover` は自然にリプレイへ残らない。

---

## Step 6: `packages/web` — 席選択 UI

設計書 §7。

**6-1. `MultiplayerClient`(`packages/web/src/multiplayer/client.ts`)。**

- `joinRoom`(`:135-139`)に optional 第 2 引数 `takeoverMemberId?: string` を足す。`undefined` のときは従来どおり `{ inviteCode }` だけを emit する(サーバーの zod が `.strict()` なので `undefined` を明示的に載せない)。
- `seatOptions(inviteCode: string): Promise<{ roomId: string; seats: SeatOption[] }>` を足す。`#request`(`:260-282`)をそのまま使う。
- **エラーコードの受け取り方**: `#request` は失敗時に `state.error = result.message ?? result.code` を立て `reject(new Error(message))` する(`:276-279`)。呼び出し側は `error.message === 'SEAT_CHOICE_REQUIRED'` / `'SEAT_TAKEN'` で分岐する。

**6-2. `App.tsx` の join フロー。**

- `onJoin`(`:2165-2177`)の `invoke(...)`(`invoke` は `:1352-1354`、`catch` を握り潰すだけ)を、`SEAT_CHOICE_REQUIRED` を拾う `catch` に置き換える。拾ったら `client.seatOptions(inviteCode)` を呼び、結果を state に載せて PlaySheet を席選択ステップへ移す。
- `friendlyError`(`:2202-2214`)のマップに追加: `SEAT_TAKEN: 'その席は埋まりました'` / `SEAT_CHOICE_REQUIRED: 'この部屋は対戦中です。空いている席をえらんでください'`(通常は席選択ビューへの遷移で消費されるフォールバック。設計書 §7 末尾)。
- `PlaySheet` は step が変わるとエラー表示を落とす(`PlaySheet.tsx:60-71` の `errorAt` / `visibleError`)ので、席選択ステップへ移れば `SEAT_CHOICE_REQUIRED` の文言は自然に消える。

**6-3. `PlaySheet.tsx` の席選択ステップ。** `type Step = 'root' | 'community' | 'join';`(`:24`)に `'seatChoice'` を足し、`isJoining` ブロック(`:91-140`)と並ぶ分岐を追加する。表示仕様(設計書 §7-2):

- カードは**最大 3 枚**。1 枚あたり: AI 名(`displayName`。例「AIプレイヤーA」)/ 前回の成績ラベル(`previousRank` を `1=大富豪 / 2=富豪 / 3=貧民 / 4=大貧民` に変換。`null` なら**空欄**)/「残り N枚」(`handCount` が `null` なら**空欄**)/ タップ領域の文言「**この席に入る**」。
- **合計得点は表示しない**(設計書 §5 / §7-2。ユーザー明示指定)。
- `seats` が空 → 「満席のため参加できません」。
- タップ → `client.joinRoom(inviteCode, memberId)`。
- `SEAT_TAKEN` → まず席指定なしの `joinRoom(inviteCode)` を再試行する。setResult なら
  次セット待ちとして成功する。まだ playing で `SEAT_CHOICE_REQUIRED` なら
  「その席は埋まりました」を出し、`client.seatOptions(inviteCode)` を取り直す。
- 成功 → `setIsChoosingRoom(false)`。以降は既存のゲーム画面遷移に乗る。
- 複数箇所で使う文言は `packages/web/src/messages.ts` へ寄せる(同ファイル冒頭に集約方針あり)。

**6-4. `seatTakeover` トースト。** **現状、メンバー系イベント(`memberJoined` / `aiTakeover` など)をトーストに出す配管は存在しない。**新規に作る。

- seq カーソルの型は `ruleFired` を拾う `useEffect`(`App.tsx:1159-1196`。`room.events` を `lastRuleEventSeq.current` より新しいものだけ取る処理が `:1167-1173`)をまねる。`seatTakeover` 用に**別のカーソル ref** を持つこと(既存カーソルを共有すると取りこぼす)。
- 表示は既存の `Toast`(`packages/web/src/components/Toast.tsx`)。メニュー側の `rootToast`(state `App.tsx:809`、描画 `:1527-1532`、`duration={3_000}`)か対局画面側の `Toast`(`screens/GameScreen.tsx:236-247`)に合わせる。
- 文言: 「◯◯さんが参加しました(AIプレイヤーBの席)」。`displayName` と `previousName` はイベントが両方持っている。

---

## Step 7: テスト

実行コマンド(ルート `package.json` の `scripts` に一致):

```sh
pnpm test                                             # 全体(@daifugo/ai... を先にビルドする)
pnpm test packages/server/src/room/room.test.ts       # 単一ファイル
pnpm typecheck
pnpm verify   # format:check → lint → lint:design → typecheck → test → build
```

**reducer 専用のテストファイルは無い。reducer のテストは `room.test.ts` に書く。**

### 7-1. reducer(`packages/server/src/room/room.test.ts`)

ヘルパー: `room()`(`:12-24`)、`join(state, index)`(`:26-37`)、`fourHumanRoom()`(`:39-41`)、`start(state)`(`:43-55`、`random: () => 0.999_999` 固定)、`finishSet(initial)`(`:93-145`)、`expectNoOtherHands(state)`(`:75-91`)。AI 席が要るケースは `join()` の回数を減らして `start()` する(`startSet` が `4 - 人間数` 体の AI を作る: `reducer.ts:449-454`)。`pendingChoice` を仕込むケースは `room.test.ts:148-193` の「engine を手で組み替えて `awaitingChoice` を作る」パターンを写す。

| # | ケース | 期待 | 設計書 |
| --- | --- | --- | --- |
| R1 | playing 中の AI 席をテイクオーバー | 成立。memberId / seatId 不変、userId・displayName が参加者に、`isAI:false` / `controller:'human'` / `connected:true` / `aiActing:false` / `wantsNextSet:false` / `isHost:false` | §2, §3.5 |
| R2 | `seatTakeover` イベント | `memberId` / `displayName` / `previousName`(旧 AI 名)が載る | §3.4 |
| R3 | `waiting` / `setResult` でテイクオーバー | `SEAT_TAKEN` | §4 |
| R4 | 人間席を `takeoverMemberId` に指定 | `SEAT_TAKEN` | §3.5 |
| R5 | 存在しない memberId(セット境界で消えた古い ID) | `SEAT_TAKEN` | §8 |
| R6 | 同じ席を 2 人が連続で取る | 1 人目成立、2 人目 `SEAT_TAKEN` | §8 |
| R7 | 既に部屋にいる userId | `ALREADY_IN_ROOM` | §3.5 |
| R8 | 離脱済み(`departed: true`)の人が同じ userId で再入室 | `ALREADY_IN_ROOM`(v1 の意図した挙動) | §8 |
| R9 | 対象席が手番中 | `turnDeadlineAt` が `now + 60_000`(既定 `turnLimitMs`)に引き直る | §8 |
| R10 | 全人間切断で `abandonAt` が立っている部屋へ参加 | 成立後 `abandonAt === null` | §8 |
| R11 | 対象席に `pendingChoice` が保留中 | 成立。`deadlineAtForTurn` の `awaitingChoice` 分岐(`reducer.ts:561-568`)で持ち時間が引き直る | §8 |
| R12 | ミニゲーム(`bomb_throw_15`)進行中 | 成立し `turnDeadlineAt` は `null` のまま(`reducer.ts:558-560`)。次 tick の `automatedPlayerIds`(`:1177-1182`)から参加者が外れる | §8 |
| R13 | setResult 中の通常 join | 成立。`seatId: null` / `wantsNextSet: true` | §4.2 |
| R14 | R13 の後 `continue` | 既存メンバー全員の同意時点で `startSet`。参加者は同意済みとして数えられる | §4.2 |
| R15 | R13 の後 `expireSetResult` | 既存メンバーが誰も続けなくても参加者ひとりで次セットが始まる | §4.2 |
| R16 | setResult で人間が 4 人いる状態の join | `ROOM_FULL` | §4.2 |
| R17 | テイクオーバー直後の `disconnect` → `reconnect` | 既存の `aiTakeover` / `humanReturned` 経路に乗る(`reducer.ts:909-979`) | §8 |
| R18 | テイクオーバー後の `viewFor` | 参加者に新しい名前と自席の手札が見え、他人の手札は漏れない(`expectNoOtherHands`) | §2 |
| R19 | `seatOptionsFor` | playing 中は AI 席のみ最大 3 件。`previousRank` は 1 戦目 `null`、2 戦目以降は直前ゲームの順位。`handCount` は `interimResult` で `null`。`waiting` / `setResult` / basic 部屋は `[]` | §3.3 |

### 7-2. manager(`packages/server/src/room/manager.test.ts`)

ヘルパー: `manager()`(`:10-19`)、`modeManager(availableRules)`(`:44-56`)、`finishManagedSet(rooms, roomId)`(`:59-`、セットを setResult まで進める)。

| # | ケース | 期待 |
| --- | --- | --- |
| M1 | playing 中の community 部屋へ `join(inviteCode)` | `SEAT_CHOICE_REQUIRED` |
| M2 | `joinTakeover` 成功 | ok。`findByUser(userId)` がその部屋を返す(`#byUser` 登録の確認) |
| M3 | basic 部屋へ `joinTakeover` | `ROOM_SOLO_ONLY` |
| M4 | 未知の招待コード | `joinTakeover` は `ROOM_NOT_FOUND`、`findByInvite` は `undefined` |
| M5 | reducer 拒否の素通し | `SEAT_TAKEN` が `ROOM_IN_GAME` に畳まれていない |
| M6 | setResult 中の通常 join | ok(`ROOM_IN_GAME` にならない) |

### 7-3. gateway(`packages/server/src/room/socket-gateway.test.ts`)

ヘルパー: `createHarness(gatewayOptions)`(`:85-142`)、`connect(harness, userToken?, flyClientIp?)`(`:144-187`)、`emitAck<Event, Result>(client, event, payload)`(`:190-201`)。`createHarness` の `gatewayOptions` の Pick リスト(`:87-97`)に必要なキーが無ければ足す。

| # | ケース | 期待 |
| --- | --- | --- |
| G1 | playing 中の部屋へ `room:join { inviteCode }` | `{ ok: false, code: 'SEAT_CHOICE_REQUIRED' }` |
| G2 | `room:seatOptions` | `{ ok: true, value: { roomId, seats } }`。seats は AI 席のみ |
| G3 | `room:seatOptions` の未知コード | `ROOM_NOT_FOUND` |
| G4 | `room:join { inviteCode, takeoverMemberId }` | ok。参加者に `room:state` が届き `you.memberId` が対象席 |
| G5 | G4 の既存メンバー側 | `room:state` が届き、`events` に `seatTakeover` が入る |
| G6 | レート制限 | `joinRateLimit: { maxAttempts: 2, windowMs: 60_000 }` で `room:join` と `room:seatOptions` を混ぜて 3 回 → 3 回目が `RATE_LIMITED`(既存テスト `:766-788` のパターン) |
| G7 | draining 中 | `beginDrain()` 後の `room:seatOptions` が `{ ok: false, code: 'INTERNAL', message: 'server is draining' }`(既存テスト `:719-762` のパターン) |
| G8 | 不正 payload | `takeoverMemberId` が空文字 / 未知キー付き → `BAD_PAYLOAD` |
| G9 | 手番中の席をテイクオーバー | `phaseTimers` が張り替わり、AI の `autoAct` が参加者の席で発火しない(`decideTurn` をスタブして未呼び出しを確認) |

### 7-4. persistence(`packages/server/src/persistence.test.ts`)

ヘルパー: `databasePath()`(`:27-31`、tmpdir に SQLite を作り afterEach で消す)。既存テストは `new SqlitePersistence(path)` + `new RoomManager({ persistence })` で部屋を回す(import は `:14-17`)。

| # | ケース | 期待 |
| --- | --- | --- |
| P1 | セット開始後にテイクオーバー | `SELECT user_id FROM set_participants WHERE set_id = ?` に参加者の userId が入る |
| P2 | 同じ userId で 2 回 | `INSERT OR IGNORE` により行が重複しない |
| P3 | リプレイ | `persistence.replay(setId)` に `joinTakeover` 由来のレコードが増えていない |

### 7-5. web(`packages/web/src/App.test.tsx`)

既存パターン(`joinRoom` を `vi.fn()` にしたフェイククライアントを渡す。`:452-482`)を使う。

| # | ケース | 期待 |
| --- | --- | --- |
| W1 | `joinRoom` が `SEAT_CHOICE_REQUIRED` で reject | `seatOptions` が呼ばれ、席カードが出る |
| W2 | 席カードの表示 | AI 名 / 成績ラベル /「残り N枚」が出て、**合計得点は出ない** |
| W3 | `previousRank: null` / `handCount: null` | それぞれ空欄 |
| W4 | `seats: []` | 「満席のため参加できません」 |
| W5 | カードタップ | `joinRoom(inviteCode, memberId)` が呼ばれる |
| W6 | `SEAT_TAKEN` | 「その席は埋まりました」+ `seatOptions` の再取得 |
| W7 | `seatTakeover` イベント受信 | トーストが 1 回だけ出る(同じ seq で二重に出ない) |

---

## Step 8: `docs/epics/E03-multiplayer.md` の改訂

`docs/epics/E03-multiplayer.md:38`(§1.3 スコープ外)の
`- **観戦・対局中の途中参加**: 4 席固定で開始後の入室はない。`
を、次の 2 点が読み取れる形へ書き換える。

- **対局中の途中参加は実装済み**。community 部屋の AI 席をテイクオーバーする方式で、席は 4 つのまま増えない。詳細は `docs/specs/2026-08-07-midgame-join-design.md`。
- **観戦は引き続きスコープ外**(設計書 §9)。

---

## 動作確認(手動)

自動テストで届かないのは「実際に 2 人以上の人間が同じ部屋にいる状態」。リポジトリ内に専用の手順書は無いので、以下で再現する。

1. `pnpm --filter @daifugo/server build && pnpm --filter @daifugo/web build` の後 `pnpm start` でサーバーを起動する。既定ポートは 3000(`packages/server/src/bin.ts:53`、`PORT` で上書き可)、`packages/web/dist` も同じサーバーが配信する(`bin.ts:276`、`WEB_DIST_DIR`)。**`vite dev` には Socket.IO のプロキシ設定が無い**(`packages/web/vite.config.ts` の `server` は `fs.allow` のみ)ので、接続込みの確認は必ずサーバー側のポートで行う。
2. プレイヤーの同一性は localStorage の `daifugo.userToken`。同一オリジンの複数タブは同じユーザーになり、後の接続が先の接続を `session:superseded` で切る。別人格にするには **`http://localhost:3000` と `http://127.0.0.1:3000` のように別オリジンでタブを開く**か、**複数ブラウザプロファイルで別ユーザーとして接続する**。
3. バックグラウンドタブはタイマー抑制で手番制限に間に合わない。人間席を複数同時に回すなら、Node の `socket.io-client` でボットを立てる(`room:join` して `room:state.game.legalMoves` から着手を選ぶだけ)のが実用的。
4. 手番が時間切れになるとサーバーが AI にその席の手を選ばせる(`timers.ts` の `#decideTurn`)。画面に通知は出ないので、「選んだカードと違う札が出た」ように見えても誤診しないこと。

確認する導線: community 部屋を作る → 開始 → 別オリジンのタブから招待コードで入る → 席選択カードが 3 枚出る → 1 枚選んで参加 → 既存メンバー側にトーストが出て、参加者に手札と過去の戦績が見える。

---

## 実装時チェックボックス

設計書 §8 のエッジケース + 補助メモの確認項目。

- [ ] 対象席に `pendingChoice` が保留中でもテイクオーバーが通り、選択機会が参加者に残る(同時選択では `nextRoomChoiceRequest`(`packages/server/src/room/pending-choice.ts:8-21`)が AI・離脱者の要求を先に解決してから参加者の要求が表に出る)
- [ ] ミニゲーム(`bomb_throw_15`)進行中のテイクオーバー。**次の 200ms tick から**人間操作に切り替わり、それ以前の tick の bot 操作はそのまま有効
- [ ] 参加者からの `game:miniGameInput` が即座に通る(`reducer.ts:1168-1176` の `isAI === false && aiActing === false && connected`)
- [ ] AI 宛に届いていた `privateRuleNotices` が、テイクオーバー後の最初のフルスナップショットで参加者に表示される(`packages/core/src/snapshot/snapshot.ts:121-122` → `view.ts:285-294`)
- [ ] 過去ゲームのログ・セットリザルトが参加者名義で表示される。ログは `SeatId` で記録され名前はクライアントが `members` から解決するので、**参加前の戦の行も参加者名になる**。これを正とする(設計書 §5)
- [ ] AI入力用の `PlayerSnapshot` では「AIプレイヤーB」「isAI: true」のまま残りうる(`snapshot.ts:93-94`)。現行AIは意思決定に使わないためv1では許容
- [ ] その席の手番中だったときの `turnDeadlineAt` 再計算とタイマー sync。走行中の AI 決定が `#fireTurn` の再検証(`timers.ts:332`)で破棄される
- [ ] 全人間が切断中の部屋への参加で `abandonAt` が `null` に戻る(戻さないと期限超過後の再スケジュールが遅延 0ms になり空回りする)
- [ ] 同時に 2 人が同じ席を選んだとき、後着が `SEAT_TAKEN`
- [ ] 一覧取得と選択の間に `playing` → `setResult` へ移ったら `SEAT_TAKEN`。クライアントは席なし join を自動再試行し、setResult の次セット待ちとして成功する
- [ ] `playing` → `closed` の場合は `ROOM_NOT_FOUND`
- [ ] セット境界をまたいだ古い `takeoverMemberId` は `SEAT_TAKEN`(`startSet` が AI を毎セット作り直す。memberId に setNo が入る: `reducer.ts:449-454`)
- [ ] テイクオーバー直後の切断・再接続が既存の `aiTakeover` / `humanReturned` 経路に乗る
- [ ] draining 中は `room:join`・`room:seatOptions` とも `INTERNAL`(`server is draining`)
- [ ] 1 ユーザー 1 部屋(`#byUser`)が維持され、テイクオーバー成功時に登録される
- [ ] 同じ部屋から離脱した人の再入室は `ALREADY_IN_ROOM`(v1 の意図した挙動)
- [ ] 参加者は `isHost: false`。ホスト移譲は起きない
- [ ] 席カードに**合計得点を出していない**
- [ ] 旧クライアント(`takeoverMemberId` を知らない)の `{ inviteCode }` がそのまま通る
- [ ] `RoomState` に新しいフィールドを足していない(稼働中の部屋がそのまま対象になる)

---

## やらないこと(スコープ外)

設計書 §9 の再掲。今回の変更に含めない。

- **観戦**。次フェーズ。席が埋まっていても部屋の中身を見られるようにする方向。
- **切断中・離脱済み人間の席の引き継ぎ**。本人が戻る可能性があるため v1 では対象外。身元の再割り当ての設計が別途必要。
- **basic(ソロ)部屋への途中参加**。将来の乱入マッチングで本仕様の機構を再利用する想定。
- **満席時の入室待ち**。行わない。エラー文言のみ。
- **3 戦セット構造の変更**。相続方式にしたことで不要になった。
- **エンジン(`packages/core`)のゲームロジック変更**。`SetState.members` も `PlayerSnapshot` も触らない。
