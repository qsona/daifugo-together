# Pipeline local environment design

## Goal

Keep the E6/E7 pipeline administration settings available to local pipeline
commands without exporting them in every shell, while keeping the shared
secret out of Git and synchronizing it with the production Fly.io app.

## Design

- Store local values in the repository-root `.env.local`.
- Add `.env.local` to `.gitignore` before creating the file.
- Start each executable in `packages/pipeline` with Node's
  `--env-file-if-exists=../../.env.local` option. Existing process environment
  values retain precedence, so an explicit shell override remains possible.
- Store these local values:
  - `ADMIN_PIPELINE_TOKEN`: a newly generated 32-byte random value encoded as
    64 hexadecimal characters.
  - `DAIFUGO_ADMIN_URL=https://daifugo-together.fly.dev`
- Restrict `.env.local` to the current user with filesystem mode `0600`.
- Set the same `ADMIN_PIPELINE_TOKEN` as a Fly.io secret on the
  `daifugo-together` application. The value must never be printed, committed,
  or placed in command arguments that expose the expanded secret.

## Scope

Only pipeline CLI commands load `.env.local` automatically. Application
development commands and unrelated packages do not receive this production
administration credential.

## Verification

1. A test verifies that every pipeline runtime script uses the optional root
   environment file.
2. Repository checks confirm `.env.local` is ignored and untracked.
3. Local checks confirm the file exists, has mode `0600`, and contains both
   required variable names without printing their values.
4. Fly.io reports the `ADMIN_PIPELINE_TOKEN` secret name as configured.
5. A read-only request to the production screening endpoint returns an
   authenticated HTTP response. Response content and the secret are discarded.

## Failure handling

- If Fly.io authentication is unavailable, stop and ask the developer to run
  `fly auth login`; do not use a browser workaround.
- If setting the Fly.io secret fails, do not report completion. Retain the
  local secret so the same value can be retried without rotating again.
- If production authentication verification fails, compare only secret
  digests or repeat the same secret-setting operation; never reveal the value.
