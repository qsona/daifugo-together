# Pipeline Local Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every local E6/E7 pipeline command automatically load an ignored repository-root `.env.local`, then configure one new shared administration secret locally and on the production Fly.io app.

**Architecture:** Node's built-in `--env-file-if-exists` option loads the private root file when each pipeline runtime command starts. A Vitest contract test locks down the script list and Git exclusion, while the secret itself remains an untracked mode-`0600` file and is synchronized to Fly.io through its CLI.

**Tech Stack:** Node.js 26, pnpm, Vitest, Fly.io CLI, POSIX file permissions

---

### Task 1: Add the failing local-environment contract test

**Files:**
- Create: `packages/pipeline/src/package-scripts.test.ts`
- Inspect: `packages/pipeline/package.json`
- Inspect: `.gitignore`

- [ ] **Step 1: Write the failing test**

Create `packages/pipeline/src/package-scripts.test.ts`:

```ts
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const runtimeScripts = [
  'confirm',
  'judge',
  'judge:eval',
  'implement',
  'implement:resume',
  'implement:retry',
  'implement:fail',
  'implement:checks',
  'implement:merged',
  'implement:release-status',
  'implement:release',
] as const;

describe('pipeline local environment', () => {
  it('loads the ignored root .env.local for every runtime command', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { scripts: Record<string, string> };
    const gitignore = await readFile(
      new URL('../../../.gitignore', import.meta.url),
      'utf8',
    );

    for (const script of runtimeScripts) {
      expect(packageJson.scripts[script]).toContain(
        'node --env-file-if-exists=../../.env.local ',
      );
    }
    expect(gitignore.split(/\r?\n/u)).toContain('.env.local');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```sh
pnpm exec vitest run packages/pipeline/src/package-scripts.test.ts
```

Expected: FAIL because the runtime scripts lack `--env-file-if-exists` and `.gitignore` lacks `.env.local`.

### Task 2: Implement automatic loading and document it

**Files:**
- Modify: `.gitignore`
- Modify: `packages/pipeline/package.json`
- Modify: `docs/runbooks/e6-local-screening.md`
- Test: `packages/pipeline/src/package-scripts.test.ts`

- [ ] **Step 1: Ignore the private file**

Append this section to `.gitignore`:

```gitignore

# ローカル管理用の秘密値
.env.local
```

- [ ] **Step 2: Add the Node environment-file option**

In every runtime script listed by the test, replace `node dist/...` with:

```text
node --env-file-if-exists=../../.env.local dist/...
```

Keep `build`, `prebuild`, `pretypecheck`, and `typecheck` unchanged because they do not contact administration APIs.

- [ ] **Step 3: Update the runbook**

Replace the repeated-export setup in `docs/runbooks/e6-local-screening.md` with instructions to create a repository-root `.env.local` containing:

```dotenv
ADMIN_PIPELINE_TOKEN=<サーバーと共有する32文字以上のランダム値>
DAIFUGO_ADMIN_URL=https://daifugo-together.fly.dev
ADMIN_PIPELINE_URL=https://daifugo-together.fly.dev
RULE_REPOSITORY_URL=git@github.com:qsona/daifugo-together.git
```

State that pipeline commands load it automatically, explicit process environment values take precedence, and the file must remain untracked with mode `0600`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```sh
pnpm exec vitest run packages/pipeline/src/package-scripts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run package verification**

Run:

```sh
pnpm exec vitest run packages/pipeline/src
pnpm --filter @daifugo/pipeline typecheck
git diff --check
```

Expected: all tests pass, typecheck exits 0, and `git diff --check` prints nothing.

- [ ] **Step 6: Commit the tracked implementation**

```sh
git add .gitignore packages/pipeline/package.json packages/pipeline/src/package-scripts.test.ts docs/runbooks/e6-local-screening.md docs/superpowers/plans/2026-07-28-pipeline-local-env.md
git commit -m "chore: load persistent pipeline environment"
```

### Task 3: Generate and synchronize the private secret

**Files:**
- Create, untracked: `.env.local`

- [ ] **Step 1: Generate the file without printing the secret**

Use a temporary mode-`0600` file, write a 32-byte random hexadecimal token and the production URL, then atomically rename it to `.env.local`. Do not echo the resulting file:

```sh
umask 077
pipeline_env_tmp="$(mktemp ./.env.local.tmp.XXXXXX)"
printf 'ADMIN_PIPELINE_TOKEN=%s\nDAIFUGO_ADMIN_URL=https://daifugo-together.fly.dev\nADMIN_PIPELINE_URL=https://daifugo-together.fly.dev\nRULE_REPOSITORY_URL=git@github.com:qsona/daifugo-together.git\n' "$(openssl rand -hex 32)" > "$pipeline_env_tmp"
mv "$pipeline_env_tmp" .env.local
chmod 600 .env.local
```

- [ ] **Step 2: Confirm local safety without showing values**

Run:

```sh
git check-ignore -q .env.local
test "$(stat -f '%Lp' .env.local)" = 600
test "$(sed -n 's/^ADMIN_PIPELINE_TOKEN=//p' .env.local | awk 'length == 64 && /^[0-9a-f]+$/ { print "valid" }')" = valid
test "$(sed -n 's/^DAIFUGO_ADMIN_URL=//p' .env.local)" = https://daifugo-together.fly.dev
test "$(sed -n 's/^ADMIN_PIPELINE_URL=//p' .env.local)" = https://daifugo-together.fly.dev
test "$(sed -n 's/^RULE_REPOSITORY_URL=//p' .env.local)" = git@github.com:qsona/daifugo-together.git
```

Expected: every command exits 0 and prints no secret.

- [ ] **Step 3: Set the same value on Fly.io**

Load the ignored file only for the command process and set the production secret:

```sh
set -a
. ./.env.local
set +a
fly secrets set ADMIN_PIPELINE_TOKEN="$ADMIN_PIPELINE_TOKEN" -a daifugo-together
unset ADMIN_PIPELINE_TOKEN DAIFUGO_ADMIN_URL
```

Expected: Fly.io reports a successful secret update and deployment.

### Task 4: Verify production without exposing the secret

**Files:**
- Read, untracked: `.env.local`

- [ ] **Step 1: Confirm Fly.io records the secret name**

Run:

```sh
fly secrets list -a daifugo-together
```

Expected: output includes `ADMIN_PIPELINE_TOKEN`; it does not reveal the secret value.

- [ ] **Step 2: Verify authenticated administration access**

Load the file, make a read-only request, discard its body, and retain only the HTTP status:

```sh
set -a
. ./.env.local
set +a
pipeline_http_status="$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $ADMIN_PIPELINE_TOKEN" "$DAIFUGO_ADMIN_URL/admin/pipeline/screening")"
unset ADMIN_PIPELINE_TOKEN DAIFUGO_ADMIN_URL
test "$pipeline_http_status" = 200
```

Expected: exit 0. Do not run `judge`, because it would mutate pending proposal state.

- [ ] **Step 3: Confirm repository state**

Run:

```sh
git status --short
git ls-files --error-unmatch .env.local
```

Expected: tracked implementation is clean; `git ls-files` fails, proving `.env.local` is not tracked.
