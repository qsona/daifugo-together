# CX-01 Structured Output Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CX-01's model-facing schema compatible with Structured Outputs while preserving the existing judgement and scaffold contracts.

**Architecture:** The model returns a strict, fixed-shape transport object using only supported JSON Schema keywords. CX-01 normalizes transport-only message entries into the existing message record, then delegates all domain validation to `parseAiJudgement()` as before.

**Tech Stack:** TypeScript, Codex app-server RPC, OpenAI Structured Outputs, Vitest

---

### Task 1: Add failing schema and transport regression tests

**Files:**
- Modify: `packages/pipeline/src/app-server-judge.test.ts`
- Inspect: `packages/pipeline/src/app-server-judge.ts`

- [ ] **Step 1: Add a recursive schema compatibility assertion**

Add this helper to `packages/pipeline/src/app-server-judge.test.ts`:

```ts
const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  'type',
  'enum',
  'anyOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'pattern',
  'minimum',
  'maximum',
]);

function expectSupportedSchema(value: unknown, path = 'root'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      expectSupportedSchema(item, `${path}[${String(index)}]`),
    );
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const schema = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(schema)) {
    if (key === 'properties') {
      for (const [name, property] of Object.entries(
        child as Record<string, unknown>,
      )) {
        expectSupportedSchema(property, `${path}.properties.${name}`);
      }
      continue;
    }
    expect(SUPPORTED_SCHEMA_KEYWORDS, `${path}.${key}`).toContain(key);
    expectSupportedSchema(child, `${path}.${key}`);
  }
  if (schema.type === 'object') {
    expect(schema.additionalProperties, path).toBe(false);
    expect(new Set(schema.required as string[]), path).toEqual(
      new Set(Object.keys(schema.properties as Record<string, unknown>)),
    );
  }
}
```

After the existing `judge()` call, obtain
`rpc.calls[1]!.params.outputSchema` and call `expectSupportedSchema(schema)`.

- [ ] **Step 2: Change the fake model transport to message entries**

Extract the fake response into a function returning the transport shape:

```ts
function approveOutput(messages = [{ key: 'fired', value: '八切り！' }]) {
  return {
    verdict: 'approve',
    rejectCategory: null,
    rejectSubtype: null,
    reasonForUser: null,
    reasonInternal: '契約v1で実装できる。',
    spec: {
      specVersion: 1,
      name: '八切り',
      summary: '8を含むプレイで場を流す。',
      hooks: ['afterPlay'],
      effects: ['clearField'],
      testPoints: ['8で発動する', '8以外では発動しない'],
      notes: '',
    },
    scaffoldMeta: { slug: 'yagiri', messages },
    confidence: 0.95,
  };
}
```

Give `FakeRpc` a constructor that stores an output value, serialize that value
in `waitForTurn()`, and assert the public result contains:

```ts
scaffoldMeta: {
  slug: 'yagiri',
  messages: { fired: '八切り！' },
},
```

- [ ] **Step 3: Add the duplicate-key rejection test**

```ts
it('message keyの重複を不正な構造化出力として拒否する', async () => {
  const rpc = new FakeRpc(
    approveOutput([
      { key: 'fired', value: '八切り！' },
      { key: 'fired', value: '重複' },
    ]),
  );
  await expect(
    new CodexCxJudge({ rpc, model: 'gpt-5.6-sol' }).judge(pending()),
  ).rejects.toThrow('invalid structured output');
});
```

- [ ] **Step 4: Run the focused test and verify RED**

Run:

```sh
pnpm exec vitest run packages/pipeline/src/app-server-judge.test.ts
```

Expected: FAIL because the schema still contains `uniqueItems` and the
production parser still expects `messages` to be an object.

### Task 2: Implement the compatible transport boundary

**Files:**
- Modify: `packages/pipeline/src/app-server-judge.ts`
- Modify: `packages/pipeline/src/judge-prompt.ts`
- Test: `packages/pipeline/src/app-server-judge.test.ts`

- [ ] **Step 1: Restrict the model-facing schema**

In `CX01_OUTPUT_SCHEMA`:

- remove `uniqueItems`, every `minLength`/`maxLength`, `maxProperties`, and
  `propertyNames`;
- replace `specVersion: { type: 'integer', const: 1 }` with
  `specVersion: { type: 'integer', enum: [1] }`;
- replace `scaffoldMeta.messages` with:

```ts
messages: {
  type: 'array',
  maxItems: 20,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['key', 'value'],
    properties: {
      key: {
        type: 'string',
        pattern: '^[a-z][a-z0-9_]{0,63}$',
      },
      value: { type: 'string' },
    },
  },
},
```

- [ ] **Step 2: Normalize transport messages before domain validation**

Add these helpers above `parseOutput()`:

```ts
type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function messageRecord(value: unknown): Record<string, string> | null {
  if (!Array.isArray(value)) return null;
  const result: Record<string, string> = {};
  for (const entry of value) {
    const parsed = object(entry);
    if (
      !parsed ||
      typeof parsed.key !== 'string' ||
      typeof parsed.value !== 'string' ||
      Object.hasOwn(result, parsed.key)
    ) {
      return null;
    }
    result[parsed.key] = parsed.value;
  }
  return result;
}

function normalizeTransportOutput(value: unknown): JsonObject | null {
  const input = object(value);
  if (!input) return null;
  if (input.scaffoldMeta === null) return input;
  const scaffoldMeta = object(input.scaffoldMeta);
  const messages = messageRecord(scaffoldMeta?.messages);
  if (!scaffoldMeta || !messages) return null;
  return {
    ...input,
    scaffoldMeta: { ...scaffoldMeta, messages },
  };
}
```

In `parseOutput()`, pass `normalizeTransportOutput(value)` to
`parseAiJudgement()` instead of spreading the raw JSON value.

- [ ] **Step 3: Update the prompt contract version and wording**

In `packages/pipeline/src/judge-prompt.ts`, change:

```ts
export const CX01_PROMPT_VERSION = 'cx01-v2';
```

Replace the messages output rule with:

```text
- scaffoldMeta.messages は announce の messageKey と日本語表示文言を
  { "key": messageKey, "value": 表示文言 } の配列にする（不要なら空配列）
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```sh
pnpm exec vitest run packages/pipeline/src/app-server-judge.test.ts
```

Expected: both tests pass.

- [ ] **Step 5: Run package verification**

Run:

```sh
pnpm exec vitest run packages/pipeline/src
pnpm --filter @daifugo/pipeline typecheck
pnpm exec prettier --check packages/pipeline/src/app-server-judge.ts packages/pipeline/src/app-server-judge.test.ts packages/pipeline/src/judge-prompt.ts
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```sh
git add packages/pipeline/src/app-server-judge.ts packages/pipeline/src/app-server-judge.test.ts packages/pipeline/src/judge-prompt.ts docs/superpowers/plans/2026-07-28-cx01-structured-output-compatibility.md
git commit -m "fix: make CX-01 output schema compatible"
```

### Task 3: Publish, merge, and reprocess the proposal

**Files:**
- No additional tracked files

- [ ] **Step 1: Push and open a PR**

Push `codex/cx01-schema-compatibility`, open a PR targeting `main`, and include
the observed `invalid_json_schema` error and verification commands.

- [ ] **Step 2: Wait for required checks**

Inspect all PR checks. Do not merge unless every required check passes.

- [ ] **Step 3: Merge and update local main**

Merge the PR through GitHub, fast-forward the normal local `main`, and rerun:

```sh
pnpm exec vitest run packages/pipeline/src
pnpm --filter @daifugo/pipeline typecheck
```

- [ ] **Step 4: Confirm the target proposal is the next CX-01 item**

Read `/admin/pipeline/screening` with the local administration token. Confirm
proposal `01KYJGEX6BQAJ6V2M8P7Q3GEW5` is present at stage `cx01`. If processing
one item would select a different proposal, stop rather than mutating another
proposal.

- [ ] **Step 5: Re-run CX-01**

Run:

```sh
pnpm --filter @daifugo/pipeline judge -- --limit 1
```

Expected: the target proposal records a CX-01 judgement and appears as
`stage=confirmation`. Present the verdict, reasons, SPEC, and scaffold metadata
to the developer; do not confirm approval or rejection automatically.
