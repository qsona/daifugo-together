# Game-start rule choice

## Context

Contract v2 originally allowed `requestChoice` only from `afterPlay`. Rank-based
card exchange needs a player to choose from the newly dealt hand before the
opening turn begins.

## Semantics

- `onGameStart(context, input?)` may return one `requestChoice` effect for a
  contract v2 rule.
- The engine resolves the options from the post-deal, pre-opening state and
  changes the game phase to `awaitingChoice`.
- A valid response resumes the same rule's `onGameStart` hook. Its normal
  effects are applied before remaining start hooks are evaluated.
- Additional, dynamic, and cross-rule choices remain serialized. The opening
  turn, including opening skips, starts only after every start choice and start
  effect completes.
- Existing `afterPlay` choices and contract v1 rules retain their behavior.

The pending choice records its source hook so snapshots and action routing can
reuse the existing rule-input protocol without adding a new client action.
