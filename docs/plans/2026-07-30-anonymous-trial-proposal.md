# 匿名おためし提案枠 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 未登録(匿名)ユーザーにも「同時進行 1 件」のルール提案枠を与え、提案のログイン必須化(AU-D4)を緩和する。

**Architecture:** 投稿 API の「登録確認(403 `registration_required`)」ゲートを「匿名枠確認(403 `anonymous_inflight_limit`)」に置き換える。「進行中」の述語は既存の部分ユニークインデックス `idx_proposals_inflight_dedupe` と同一(`screening`/`implementing`/`failed かつ attempt_count=0`)。クライアントは未登録でもフォームを表示し、枠が埋まっているときは進行中提案の状態+ログイン導線を出す。枠占有の判定はサーバー側で計算した `ProposalListItem.occupiesSlot` を使う(クライアントは `attempt_count` を見られないため)。

**Tech Stack:** TypeScript strict / pnpm workspace / Vitest / better-sqlite3 / React + Testing Library

**Spec:** `docs/specs/2026-07-30-anonymous-trial-proposal-design.md`

## Global Constraints

- エラーコードは `anonymous_inflight_limit`(403)。`registration_required` は全箇所から消す
- `submit` のゲート順序: 認証(401)→ 停止確認(403)→ 検証(400)→ 重複確認(冪等返却)→ 枠拒否(403)→ 保存。枠拒否を重複確認の後ろに置くのは、進行中同一内容の再送(二重タップ)を 200 で返す冪等性を守るため(Task 2 Step 3)。`authorize`(入口プリチェック)は内容を持たないため「未登録かつ進行中あり」で即 403
- 「進行中」の述語: `status IN ('screening','implementing') OR (status = 'failed' AND attempt_count = 0)`(新しい定義を作らない)
- イエローカード・提案停止・読み取り系 API は一切変更しない
- UI 文言はすべて仮。トーンは既存に合わせる(子供向け・ひらがな多め。例:「ていあん」「とうろく」)
- テスト実行はリポジトリルートで `pnpm exec vitest run <path>`(初回はまず `pnpm --filter @daifugo/ai... build` を実行)。最終確認は `pnpm test`

---

### Task 1: `occupiesSlot` フィールドと `hasInflight` リポジトリメソッド

**Files:**
- Modify: `packages/core/src/proposal/proposal.ts:66-81`(`ProposalListItem` に `occupiesSlot` 追加)
- Modify: `packages/server/src/proposal/repository.ts`(`toListItem` に計算追加・`hasInflight` メソッド追加)
- Modify: `packages/web/src/App.tsx:94-120` ほか(`ProposalListItem` をリテラル構築している全箇所に `occupiesSlot` を追加。`grep -rn "unread:" packages/web/src` で洗い出す — 少なくとも `App.tsx`(DEMO_PROPOSAL_API)・`screens/MyProposalsScreen.test.tsx`・`screens/ProposalFormScreen.test.tsx`・`proposal/client.test.ts`・`fixtures/` 配下)
- Test: `packages/server/src/proposal/submission.test.ts`

**Interfaces:**
- Produces: `ProposalListItem.occupiesSlot: boolean`(必須フィールド。進行中述語をサーバーで評価した値)/ `ProposalRepository.hasInflight(authorId: string): boolean`
- Consumes: 既存の `ProposalRow`(snake_case 列: `status`, `attempt_count`)・`toListItem(row, seenAt)`

- [ ] **Step 1: 失敗するテストを書く**

`packages/server/src/proposal/submission.test.ts` の既存 `describe('ProposalSubmissionService')` 内に追加。テストハーネスは既存の `setup()`(`persistence.sessions.resolve(undefined)` で匿名セッション、`persistence.auth.complete(...)` で登録化、`persistence.proposals.transitionProposal(id, from, to, patch)` で状態遷移)をそのまま使う:

```ts
it('hasInflightは進行中述語(screening/implementing/failed+attempt_count=0)で判定する', async () => {
  // Task 2 完了までは匿名の submit が 403 になるため、登録済みの主セッションで検証する
  // (述語は登録状態と無関係)。
  const { persistence, session, service } = setup();
  const repository = persistence.proposals;
  expect(repository.hasInflight(session.userId)).toBe(false);

  const submitted = await service.submit({
    token: session.userToken,
    ip: 'ip',
    body: validBody,
  });
  if (submitted.status !== 200 || submitted.body.outcome !== 'accepted') {
    throw new Error('expected accepted');
  }
  const proposalId = submitted.body.proposal.id;
  expect(submitted.body.proposal.occupiesSlot).toBe(true);
  expect(repository.hasInflight(session.userId)).toBe(true);

  // implementing でも占有
  repository.transitionProposal(proposalId, 'screening', 'implementing');
  expect(repository.hasInflight(session.userId)).toBe(true);

  // failed + attempt_count=0(リトライ待ち)でも占有
  repository.transitionProposal(proposalId, 'implementing', 'failed', {
    reasonCode: 'implementation_failed',
    reasonText: 'x',
  });
  expect(repository.hasInflight(session.userId)).toBe(true);

  // リトライ(attempt_count=1 になる)→ 再失敗で枠切れ → 占有しない
  repository.transitionProposal(proposalId, 'failed', 'implementing');
  repository.transitionProposal(proposalId, 'implementing', 'failed', {
    reasonCode: 'implementation_failed',
    reasonText: 'x',
  });
  expect(repository.hasInflight(session.userId)).toBe(false);

  const mine = repository.mine(session.userId);
  expect(mine.items[0]?.occupiesSlot).toBe(false);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @daifugo/ai... build && pnpm exec vitest run packages/server/src/proposal/submission.test.ts`
Expected: FAIL(`hasInflight is not a function` / `occupiesSlot` が undefined)

- [ ] **Step 3: core 型に `occupiesSlot` を追加**

`packages/core/src/proposal/proposal.ts` の `ProposalListItem` に 1 行追加:

```ts
export interface ProposalListItem {
  // ...既存フィールド...
  unread: boolean;
  /** 匿名おためし枠を占有中か(進行中述語をサーバーで評価した値) */
  occupiesSlot: boolean;
  createdAt: number;
  statusChangedAt: number;
}
```

- [ ] **Step 4: サーバー実装**

`packages/server/src/proposal/repository.ts` の `toListItem`(110 行付近)の返り値に追加:

```ts
occupiesSlot:
  row.status === 'screening' ||
  row.status === 'implementing' ||
  (row.status === 'failed' && row.attempt_count === 0),
```

(フィールド名は同ファイルの `ProposalRow` 型に合わせる)

`ProposalRepository` クラスに `findInflight` の隣へメソッド追加:

```ts
hasInflight(authorId: string): boolean {
  const row = this.#sqlite
    .prepare(
      `SELECT 1 FROM proposals
       WHERE author_id = ?
         AND (
           status IN ('screening', 'implementing')
           OR (status = 'failed' AND attempt_count = 0)
         )
       LIMIT 1`,
    )
    .get(authorId);
  return row !== undefined;
}
```

- [ ] **Step 5: `ProposalListItem` リテラル構築箇所を修復**

`grep -rn "unread:" packages/web/src packages/server/src` で `ProposalListItem` をリテラル構築している箇所を全部見つけ、`occupiesSlot` を追加する。値の方針: `status` が `screening`/`implementing` なら `true`、終端(`released`/`rejected`)なら `false`、`failed` はそのフィクスチャの意図に合わせる(不明なら `false`)。`App.tsx` の `DEMO_PROPOSAL_API.submit` は `status: 'screening'` を返すので `occupiesSlot: true`。

- [ ] **Step 6: 型チェックとテストが通ることを確認**

Run: `pnpm exec vitest run packages/server/src/proposal/submission.test.ts && pnpm --filter @daifugo/core typecheck && pnpm --filter @daifugo/server typecheck && pnpm --filter @daifugo/web typecheck`
Expected: PASS(typecheck スクリプトが無ければ `pnpm exec tsc --noEmit -p packages/<pkg>/tsconfig.json` で代替)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/proposal/proposal.ts packages/server/src/proposal/repository.ts packages/server/src/proposal/submission.test.ts packages/web/src
git commit -m "feat: add occupiesSlot to proposal list items and hasInflight lookup"
```

---

### Task 2: 投稿ゲートを「登録確認」から「匿名枠確認」へ置き換え

**Files:**
- Modify: `packages/server/src/proposal/submission.ts`(`authorize` 95-97 行・`submit` 116-117 行・結果型 29 行/38 行)
- Modify: `packages/server/src/proposal/submission.test.ts`(既存の `registration_required` 期待を書き換え+新テスト)
- Modify: `packages/server/src/app-server.test.ts:137,178`(モックの `registration_required` を `anonymous_inflight_limit` へ)

**Interfaces:**
- Consumes: Task 1 の `ProposalRepository.hasInflight(authorId): boolean`・既存 `isRegistered(authorId): boolean`
- Produces: `ProposalSubmissionResult` / `ProposalAuthorizationResult` の 403 バリアント `{ error: 'anonymous_inflight_limit' }`(`registration_required` は削除)

- [ ] **Step 1: 失敗するテストを書く**

`submission.test.ts` に追加:

```ts
it('匿名は進行中1件まで提案でき、2件目はanonymous_inflight_limitで拒否される', async () => {
  const { persistence, service } = setup();
  const anonymous = persistence.sessions.resolve(undefined);

  const first = await service.submit({
    token: anonymous.userToken,
    ip: 'ip',
    body: validBody,
  });
  expect(first).toMatchObject({ status: 200, body: { outcome: 'accepted' } });

  const second = await service.submit({
    token: anonymous.userToken,
    ip: 'ip',
    body: { ...validBody, name: '11バック', body: 'Jで強さが逆になる。' },
  });
  expect(second).toEqual({
    status: 403,
    body: { error: 'anonymous_inflight_limit' },
  });

  // 進行中の同一内容の再送は重複確認(枠拒否より前)で既存を返す(下の別テスト)。

  // 終端確定で枠が空く
  if (first.status !== 200 || first.body.outcome !== 'accepted') {
    throw new Error('expected accepted');
  }
  persistence.proposals.transitionProposal(
    first.body.proposal.id,
    'screening',
    'rejected',
    { reasonCode: 'out_of_scope', reasonText: 'x' },
  );
  const third = await service.submit({
    token: anonymous.userToken,
    ip: 'ip',
    body: { ...validBody, name: '11バック', body: 'Jで強さが逆になる。' },
  });
  expect(third).toMatchObject({ status: 200, body: { outcome: 'accepted' } });
});

it('登録済みは進行中が複数あっても提案できる', async () => {
  const { session, service } = setup(); // setup() の主セッションは登録済み
  const first = await service.submit({
    token: session.userToken,
    ip: 'ip',
    body: validBody,
  });
  expect(first).toMatchObject({ status: 200 });
  const second = await service.submit({
    token: session.userToken,
    ip: 'ip',
    body: { ...validBody, name: '11バック', body: 'Jで強さが逆になる。' },
  });
  expect(second).toMatchObject({ status: 200, body: { outcome: 'accepted' } });
});

it('匿名で枠が空いていても停止中ならproposal_suspendedで拒否される', async () => {
  // 停止列の書き込みは既存テスト「停止期限列がある場合は…」(255行付近)と同じ
  // パターン: ファイル DB で SqlitePersistence を作り、別の Database 接続で
  // proposal_suspended_until を UPDATE する。describe('proposal persistence
  // constraints') 内に置く。
  const directory = mkdtempSync(join(tmpdir(), 'proposal-anon-suspended-'));
  directories.push(directory);
  const path = join(directory, 'db.sqlite');
  const persistence = new SqlitePersistence(path, {
    createUserId: () => 'anon-suspended-author',
    createToken: () => 'proposal-token-anon-suspd',
  });
  instances.push(persistence);
  const session = persistence.sessions.resolve(undefined); // 登録化しない=匿名
  const sqlite = new Database(path);
  sqlite
    .prepare('UPDATE users SET proposal_suspended_until = ? WHERE user_id = ?')
    .run(20_000, session.userId);
  sqlite.close();
  const service = new ProposalSubmissionService(persistence.proposals, {
    now: () => 10_000,
    signals: NOOP_SIGNALS,
  });
  await expect(
    service.submit({ token: session.userToken, ip: 'ip', body: validBody }),
  ).resolves.toEqual({
    status: 403,
    body: { error: 'proposal_suspended', suspendedUntil: 20_000 },
  });
});

it('authorizeも匿名枠で判定する', async () => {
  const { persistence, service } = setup();
  const anonymous = persistence.sessions.resolve(undefined);
  expect(service.authorize(anonymous.userToken)).toEqual({ status: 204 });
  await service.submit({ token: anonymous.userToken, ip: 'ip', body: validBody });
  expect(service.authorize(anonymous.userToken)).toEqual({
    status: 403,
    body: { error: 'anonymous_inflight_limit' },
  });
});
```

重要な設計判断 — **枠確認と重複冪等性の両立**: 匿名ユーザーが進行中の同一内容を再送(二重タップ)した場合、枠確認(`hasInflight` = true)で 403 にしてしまうと E05 §2.3 の冪等送信(既存を返す 200)が壊れる。これを防ぐため、`submit` の枠確認は「進行中があり、**かつ**それが今回の内容と別物(`findInflight(authorId, contentHash)` が null)」のときだけ 403 にする。次のテストも追加:

```ts
it('匿名の進行中同一内容の再送は枠拒否ではなく既存を返す(冪等)', async () => {
  const { persistence, service } = setup();
  const anonymous = persistence.sessions.resolve(undefined);
  const first = await service.submit({
    token: anonymous.userToken,
    ip: 'ip',
    body: validBody,
  });
  const retry = await service.submit({
    token: anonymous.userToken,
    ip: 'ip',
    body: validBody,
  });
  expect(retry.status).toBe(200);
  if (first.status !== 200 || retry.status !== 200) throw new Error('expected 200');
  if (first.body.outcome !== 'accepted' || retry.body.outcome !== 'accepted') {
    throw new Error('expected accepted');
  }
  expect(retry.body.proposal.id).toBe(first.body.proposal.id);
});
```

既存テスト(80 行付近の `registration_required` 期待)は「匿名でも枠が空いていれば受理される」へ書き換える。既存のゲート順テスト(認証→停止→…)は、匿名ではなく登録済みセッションで停止を検証している場合そのまま通るはず — 匿名+停止の組み合わせテストがあれば「枠あり匿名でも停止中は 403 proposal_suspended」に読み替えて維持する。

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm exec vitest run packages/server/src/proposal/submission.test.ts`
Expected: FAIL(matcher 不一致: 実際は `registration_required` が返る)

- [ ] **Step 3: `submission.ts` を実装**

結果型(29 行・38 行)を置き換え:

```ts
| { status: 403; body: { error: 'anonymous_inflight_limit' } }
```

`authorize()`(95-97 行)を置き換え:

```ts
if (
  !this.#repository.isRegistered(authorId) &&
  this.#repository.hasInflight(authorId)
) {
  return { status: 403, body: { error: 'anonymous_inflight_limit' } };
}
```

`submit()` は検証より前に content hash を知れないため、ゲートを 2 段にする。(1) 認証直後の枠確認は `authorize` と同じ条件で行うが、**冪等再送を通すため検証・ハッシュ計算後に既存進行中(`findInflight`)と一致すれば既存を返す**。実装は「枠確認を検証+重複確認の後ろに置く」のではなく(ゲート順が spec と変わるため)、次の形にする:

```ts
// 認証(401)のあと:
const isAnonymous = !this.#repository.isRegistered(authorId);
const slotOccupied = isAnonymous && this.#repository.hasInflight(authorId);
// 停止確認(403 proposal_suspended)・検証(400)は既存のまま。
// 検証後、重複確認の位置で:
const contentHash = proposalContentHash(validated.value);
const duplicate = this.#repository.findInflight(authorId, contentHash);
if (duplicate) {
  return { status: 200, body: { outcome: 'accepted', proposal: duplicate } };
}
if (slotOccupied) {
  return { status: 403, body: { error: 'anonymous_inflight_limit' } };
}
```

つまり: 認証 → 枠状態の評価 → 停止 → 検証 → 重複(冪等返却)→ 枠拒否 → 保存。外形的なゲート順(401 → 停止 403 → 400 → 枠 403)は spec §2 の「枠 403 が停止 403 より先」と入れ替わるが、これは冪等性(進行中同一内容の再送を 200 で返す)を守るための意図的な変更である。**spec §2 のゲート順の記述を本 Task の docs 差分(Task 4)で「認証 → 停止 → 検証 → 重複 → 枠 → 保存」に訂正する。** `authorize()`(入口プリチェック)は内容を持たないため従来どおり「進行中があれば 403」でよい。

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm exec vitest run packages/server/src/proposal/submission.test.ts`
Expected: PASS

- [ ] **Step 5: `app-server.test.ts` のモックを更新して全サーバーテスト実行**

`app-server.test.ts` 137 行・178 行の `registration_required` を `anonymous_inflight_limit` に置き換え。

Run: `pnpm exec vitest run packages/server/src`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/proposal/submission.ts packages/server/src/proposal/submission.test.ts packages/server/src/app-server.test.ts
git commit -m "feat: replace registration gate with anonymous in-flight slot limit"
```

---

### Task 3: 提案画面 — 未登録フォーム表示・枠埋まりパネル・403 フォールバック

**Files:**
- Create: `packages/web/src/proposal/status-labels.ts`(状態表示文言の共有モジュール)
- Modify: `packages/web/src/screens/MyProposalsScreen.tsx:18-24`(ローカル `STATUS_LABELS` を共有モジュールの import に置換)
- Modify: `packages/web/src/screens/ProposalFormScreen.tsx`(`registrationRequired` 分岐の撤回・枠埋まりパネル・未登録注記)
- Modify: `packages/web/src/proposal/client.ts:85-90`(エラーメッセージのマッピング)
- Test: `packages/web/src/screens/ProposalFormScreen.test.tsx`

**Interfaces:**
- Consumes: Task 1 の `ProposalListItem.occupiesSlot` / Task 2 のエラーコード `anonymous_inflight_limit` / 既存 `ProposalApi.mine?()`
- Produces: `STATUS_LABELS: Record<ProposalStatus, string>`(`packages/web/src/proposal/status-labels.ts` から export。値は MyProposalsScreen の既存定義そのまま: screening=確認中 / implementing=開発中 / released=あそべる / rejected=見送り / failed=開発できず)

- [ ] **Step 1: 失敗するテストを書く**

`ProposalFormScreen.test.tsx` の既存 2 テスト(「未登録ならフォームを隠して…」「送信時の registration_required でも…」)を削除し、以下に置き換える:

```tsx
const slotHolder = {
  id: 'p-1',
  kind: 'local' as const,
  prefectureCode: null,
  prefectureName: null,
  name: '8切り',
  body: '8を出すと場が流れる。',
  status: 'screening' as const,
  reason: null,
  releasedRuleId: null,
  popularity: null,
  priorityRank: null,
  unread: false,
  occupiesSlot: true,
  createdAt: 1,
  statusChangedAt: 1,
};

it('未登録でも枠が空いていればフォームと注記を表示する', async () => {
  const mine = vi.fn().mockResolvedValue({ items: [], unreadCount: 0 });
  render(
    <ProposalFormScreen
      api={{ submit: vi.fn(), mine }}
      onBack={() => undefined}
      registered={false}
      onLogin={() => undefined}
    />,
  );
  expect(await screen.findByLabelText('ルール名')).toBeTruthy();
  expect(
    screen.getByText(/とうろくしなくても 1 つずつ ていあんできるよ/),
  ).toBeTruthy();
});

it('未登録で枠が埋まっていればフォームの代わりに進行中の提案とログイン導線を出す', async () => {
  const onLogin = vi.fn();
  const user = userEvent.setup();
  const mine = vi
    .fn()
    .mockResolvedValue({ items: [slotHolder], unreadCount: 0 });
  render(
    <ProposalFormScreen
      api={{ submit: vi.fn(), mine }}
      onBack={() => undefined}
      registered={false}
      onLogin={onLogin}
    />,
  );
  expect(await screen.findByText('8切り')).toBeTruthy();
  expect(screen.getByText('確認中')).toBeTruthy();
  expect(
    screen.getByText(/けっかが出たら、つぎの ていあんが できるよ/),
  ).toBeTruthy();
  expect(screen.queryByLabelText('ルール名')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Googleでログイン' }));
  expect(onLogin).toHaveBeenCalledOnce();
});

it('送信時のanonymous_inflight_limitで枠埋まり表示へ切り替える', async () => {
  const user = userEvent.setup();
  const submit = vi
    .fn<ProposalApi['submit']>()
    .mockRejectedValue(
      new ProposalApiError(403, '表示文言', [], 'anonymous_inflight_limit'),
    );
  const mine = vi
    .fn()
    .mockResolvedValueOnce({ items: [], unreadCount: 0 })
    .mockResolvedValue({ items: [slotHolder], unreadCount: 0 });
  render(
    <ProposalFormScreen
      api={{ submit, mine }}
      onBack={() => undefined}
      registered={false}
      onLogin={() => undefined}
    />,
  );
  await user.type(await screen.findByLabelText('ルール名'), '11バック');
  await user.type(screen.getByLabelText('ルールの内容'), 'Jで強さが逆になる。');
  await user.click(screen.getByRole('button', { name: '提案を送信する' }));
  expect(
    await screen.findByText(/けっかが出たら、つぎの ていあんが できるよ/),
  ).toBeTruthy();
  expect(screen.queryByLabelText('ルール名')).toBeNull();
});

it('登録済みならmineを呼ばずフォームを表示する', () => {
  const mine = vi.fn();
  render(
    <ProposalFormScreen
      api={{ submit: vi.fn(), mine }}
      onBack={() => undefined}
      registered
    />,
  );
  expect(screen.getByLabelText('ルール名')).toBeTruthy();
  expect(mine).not.toHaveBeenCalled();
  expect(
    screen.queryByText(/とうろくしなくても 1 つずつ/),
  ).toBeNull();
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm exec vitest run packages/web/src/screens/ProposalFormScreen.test.tsx`
Expected: FAIL(未登録だと旧「提案するには引き継ぎ登録が必要です」パネルが出る)

- [ ] **Step 3: 共有 `STATUS_LABELS` を作る**

`packages/web/src/proposal/status-labels.ts` を新規作成:

```ts
import type { ProposalStatus } from '@daifugo/core';

export const STATUS_LABELS: Record<ProposalStatus, string> = {
  screening: '確認中',
  implementing: '開発中',
  released: 'あそべる',
  rejected: '見送り',
  failed: '開発できず',
};
```

`MyProposalsScreen.tsx` のローカル定義(18-24 行)を削除し、`import { STATUS_LABELS } from '../proposal/status-labels';` に置き換える。

- [ ] **Step 4: `ProposalFormScreen.tsx` を実装**

変更点:

1. `registrationRequired` state と 176-195 行の分岐を削除。`registration_required` の catch 分岐(163-165 行)も削除。
2. 新 state: `const [slotHolder, setSlotHolder] = useState<ProposalListItem | null>(null);` と `const [slotChecked, setSlotChecked] = useState(registered);`
3. マウント時の枠確認(未登録のみ):

```tsx
useEffect(() => {
  if (registered || !api.mine) {
    setSlotChecked(true);
    return;
  }
  let active = true;
  void api
    .mine()
    .then((response) => {
      if (!active) return;
      setSlotHolder(
        response.items.find((item) => item.occupiesSlot) ?? null,
      );
    })
    .catch(() => {
      // 枠確認に失敗してもフォームは塞がない。送信時の403で拾う。
    })
    .finally(() => {
      if (active) setSlotChecked(true);
    });
  return () => {
    active = false;
  };
}, [api, registered]);
```

4. submit の catch に追加:

```tsx
if (error.status === 403 && error.code === 'anonymous_inflight_limit') {
  if (api.mine) {
    try {
      const response = await api.mine();
      setSlotHolder(
        response.items.find((item) => item.occupiesSlot) ?? null,
      );
    } catch {
      // 取得できなくても汎用の枠埋まり表示に落とす
    }
  }
  setSlotLimited(true);
  return;
}
```

`const [slotLimited, setSlotLimited] = useState(false);` を追加。

5. 枠埋まりパネル(旧 `registrationRequired` 分岐の位置に。`!registered && (slotLimited || slotHolder !== null)` のとき):

```tsx
if (!registered && (slotLimited || slotHolder !== null)) {
  return (
    <div className={screen.screen}>
      <AppBar title="ルールをていあんする" onBack={onBack} />
      <main className={screen.body}>
        {slotHolder && (
          <div className={styles.accepted} role="status">
            <span className={styles.acceptedName}>{slotHolder.name}</span>
            <span className={styles.status}>
              {STATUS_LABELS[slotHolder.status]}
            </span>
          </div>
        )}
        <Callout
          action={
            onLogin ? (
              <Button size="small" onClick={onLogin}>
                Googleでログイン
              </Button>
            ) : undefined
          }
        >
          ていあんは 1 つずつ。けっかが出たら、つぎの ていあんが
          できるよ。Google とうろくすると いくつでも ていあんできるよ。
        </Callout>
      </main>
    </div>
  );
}
```

6. 未登録・枠なしのとき、フォーム末尾の既存 Callout の直前に注記を追加:

```tsx
{!registered && (
  <Callout>
    とうろくしなくても 1 つずつ ていあんできるよ。Google
    とうろくすると いくつでも ていあんできるよ。
  </Callout>
)}
```

7. 未登録で `slotChecked` が false の間は送信ボタンを `disabled` にする(mine 取得中の送信で 403 を踏む頻度を下げる。フォーム自体は表示してよい)。

8. import に `STATUS_LABELS`(`../proposal/status-labels`)と `useEffect`(既存)を追加。`ProposalListItem` は既に import 済み。

- [ ] **Step 5: `client.ts` のメッセージマッピングを更新**

`packages/web/src/proposal/client.ts` 85-90 行の `registration_required: 'Googleでログインしてください',` を削除し、次を追加:

```ts
anonymous_inflight_limit:
  'ていあんは 1 つずつ。けっかが出たら つぎを ていあんできるよ',
```

- [ ] **Step 6: テストが通ることを確認**

Run: `pnpm exec vitest run packages/web/src/screens/ProposalFormScreen.test.tsx packages/web/src/proposal packages/web/src/screens/MyProposalsScreen.test.tsx packages/web/src/App.test.tsx`
Expected: PASS(`App.test.tsx` に旧文言「提案するには引き継ぎ登録が必要です」への参照が残っていれば新挙動へ書き換える)

- [ ] **Step 7: Commit**

```bash
git add packages/web/src
git commit -m "feat: show proposal form to anonymous users with single-slot limit UI"
```

---

### Task 4: ドキュメント差分と全体検証

**Files:**
- Modify: `docs/decision-log.md`(G 節に裁定 1 行)
- Modify: `docs/epics/E15-auth-account.md`(冒頭に改訂ノート)
- Modify: `docs/epics/E05-rule-proposal.md`(冒頭ノートに 1 行)
- Modify: `docs/epics/E06-injection-yellowcard.md`(冒頭ノートに 1 行)
- Modify: `docs/specs/2026-07-30-anonymous-trial-proposal-design.md`(§2 のゲート順の訂正 — Task 2 Step 3 の判断を反映)

**Interfaces:**
- Consumes: Task 2 で確定したゲート順(認証 → 停止 → 検証 → 重複 → 枠 → 保存)

- [ ] **Step 1: decision-log に裁定を追記**

`docs/decision-log.md` の G 節を読み、既存の採番に続く次の番号(G-15 まで存在するなら G-16)で 1 行追加。内容:

> G-1x: 匿名おためし提案枠(2026-07-30)。AU-D4(提案の全面ログイン必須)を緩和し、匿名は進行中 1 件まで提案可能とする(403 `anonymous_inflight_limit`)。進行中の述語は `idx_proposals_inflight_dedupe` と同一。停止回避目的の匿名作り直しが常態化(目安: 週 3 件)したら AU-D4 へ巻き戻す。設計: `docs/specs/2026-07-30-anonymous-trial-proposal-design.md`

書式(表形式か箇条書きか)は G 節の既存行に合わせる。

- [ ] **Step 2: E15 冒頭に改訂ノートを追記**

`docs/epics/E15-auth-account.md` の冒頭ノート群(9 行付近)に追加:

> **2026-07-30 改訂(匿名おためし提案枠)**: AU-D4 を緩和した。未登録ユーザーも進行中 1 件まで提案できる(`docs/specs/2026-07-30-anonymous-trial-proposal-design.md` が正)。§2.6 の「登録確認(403 `registration_required`)」は「匿名枠確認(403 `anonymous_inflight_limit`)」に、§2.7 の提案画面「未登録はフォーム非表示+ログイン誘導」は「未登録でもフォーム表示。枠が埋まっているときのみ進行中の状態+ログイン導線」に読み替える。AU-02 の受け入れ条件も同様に読み替える。

- [ ] **Step 3: E05・E06 冒頭ノートに 1 行ずつ追記**

E05 冒頭の改訂反映ノートに:

> - **匿名おためし提案枠(2026-07-30)**: 投稿ゲートの「登録確認」は「匿名枠確認(進行中 1 件まで、403 `anonymous_inflight_limit`)」に置き換わる。順序は認証 → 停止 → 検証 → 重複(冪等返却)→ 枠 → 保存。詳細は `docs/specs/2026-07-30-anonymous-trial-proposal-design.md`。

E06 冒頭ノートに:

> - **匿名おためし提案枠(2026-07-30)**: 「最初からログイン必須(AU-D4)」を緩和。匿名は進行中 1 件まで提案可。§3.3(b) の移行トリガー(回避常態化・週 3 件目安)が「AU-D4 への巻き戻しトリガー」として復活する。詳細は `docs/specs/2026-07-30-anonymous-trial-proposal-design.md`。

- [ ] **Step 4: spec §2 のゲート順を訂正**

`docs/specs/2026-07-30-anonymous-trial-proposal-design.md` §2 の番号付きリストを実装(Task 2 Step 3)に合わせて更新: 枠確認は「認証直後に評価し、重複(冪等返却)の後・保存の前に拒否を確定する」。理由(進行中同一内容の再送を 200 で返す冪等性の維持)を 1 文添える。

- [ ] **Step 5: 全体検証**

Run: `pnpm test`
Expected: PASS(全パッケージ)

Run: `grep -rn "registration_required" packages docs/specs docs/plans`
Expected: ヒットなし(歴史的経緯として言及する epics/decision-log は除く — packages にヒットが残っていたら消し忘れ)

- [ ] **Step 6: Commit**

```bash
git add docs/decision-log.md docs/epics/E15-auth-account.md docs/epics/E05-rule-proposal.md docs/epics/E06-injection-yellowcard.md docs/specs/2026-07-30-anonymous-trial-proposal-design.md
git commit -m "docs: record anonymous trial proposal slot decision and epic notes"
```

注意: `docs/decision-log.md`・`docs/epics/E05-rule-proposal.md` には本計画と無関係の未コミット変更が既にある。`git add` はファイル単位でなく `git add -p` で本計画の追記ハンクだけをステージすること。

---

## 実装後の受け入れ確認(手動)

1. ブラウザで匿名(未ログイン)状態のまま提案画面を開く → フォームが表示され、注記「とうろくしなくても 1 つずつ…」が見える
2. 提案を 1 件送信 → 受理される。提案画面を開き直す → 枠埋まりパネル(提案名+状態+ログイン導線)
3. 登録済みアカウントでは従来どおり複数提案できる
4. 375×812 で枠埋まりパネル・注記のレイアウトを目視確認(既存 Epic と同じ検証水準)
