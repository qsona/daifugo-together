---
name: implement-rule
description: Implement the next approved Daifugo rule proposal through the local E7 pipeline. Use when a developer asks to process, resume, or fail a CX-02 implementation job with their Codex subscription, create the deterministic rule branch and scaffold, inspect generated files, and open the rule PR.
---

# Implement an approved rule

Run the repository-owned pipeline from a developer-controlled Codex session. It
uses the locally authenticated `codex` and `gh` CLIs; never substitute an LLM
SDK, API key, hosted worker, browser login, or force-push.

## Before starting

1. Read `docs/epics/E07-codex-pipeline.md` §2.2–2.5 and the approved
   `packages/pipeline/prompts/implement.md`.
2. Verify `codex` is authenticated for the developer subscription and `gh` is
   authenticated for this repository. If either integration is unavailable,
   stop and ask the developer to authenticate it; do not use a GUI workaround.
3. Require these environment variables:
   `ADMIN_PIPELINE_URL`, `ADMIN_PIPELINE_TOKEN`, and `RULE_REPOSITORY_URL`.
   `IMPLEMENT_WORK_ROOT` is optional.

## Run the next job

Run:

```sh
pnpm --filter @daifugo/pipeline implement
```

The command obtains one E6-passed, developer-SPEC-approved job; warns about any
existing `implementing` or `pr_open` jobs; shallow-clones `main`; installs the
lockfile; creates and pushes the immutable scaffold; invokes `codex exec` with
`workspace-write` and a 20-minute timeout; checks the repository-wide diff and
scaffold history; commits the two generated files; and opens or recovers one
PR. Report the returned workspace, job ID, rule ID, PR number, and result.

Never alter `meta.json`, `SPEC.json`, the deterministic branch, or the recorded
scaffold SHA. Never force-push. Do not continue past an inspection violation.

## Handle interruption and failure

- After an interrupted scaffold push, resume the warned `implementing` job with
  `pnpm --filter @daifugo/pipeline implement:resume -- JOB_ID`. It must recover
  the matching remote branch and must reject a mismatched scaffold.
- For `codex_timeout`, `codex_empty`, or an inspection violation, show the exact
  internal error to the developer and offer one re-run (`-a2` support is not
  yet automated) or final failure. Do not decide final failure silently.
- Only after the developer chooses final failure, run:

```sh
pnpm --filter @daifugo/pipeline implement:fail -- JOB_ID implementing ERROR_CODE "brief internal note"
```

This stores the detailed internal code in `pipeline_jobs` and exposes only
`implementation_failed` to the proposal author.

After a PR is opened, leave the job in `pr_open`. The developer reviews and
merges it; CX-03 owns CI monitoring and later phase transitions.
