# Rule choice serialization design

## Context

Contract v2 originally adopted at most one `requestChoice` for an entire
`afterPlay` batch. That suppresses a valid composition such as `7渡し` and
`ラッキー7`: the same two-card play can require two cards to be passed and
another two cards to be discarded.

## Decision

Independent `requestChoice` Effects from different rules are serialized in
the existing rule-priority order. A single rule is still limited to one choice
in its preflight and cannot request another choice while handling its response.
No public protocol or Effect payload changes.

The state machine is:

1. Preview all `afterPlay` rules without advancing invocation counters.
2. If one rule requests input, retain the existing single-choice path.
3. If multiple rules request input, expose only the highest-priority request.
4. Apply that rule's response Effects authoritatively and exactly once.
5. Preview the remaining, not-yet-invoked rules against the updated state.
6. Expose the next request, or apply the remaining ordinary Effects as one
   batch and complete the turn when no request remains.

The pending private state records only the remaining rule IDs and whether an
earlier response requested a field clear. Public snapshots continue to expose
only the active request. Each `ruleInput` remains a normal replay action, so
replay and deterministic AI/timeout handling need no side channel.

## Semantics and compatibility

- Priority decides request order, not suppression. `requestChoice` therefore
  uses `choice:{ruleId}` as its conflict key.
- A later rule recomputes its request from the hand after earlier `moveCards`
  Effects. Required counts can safely shrink to the then-current hand size.
- Ordinary after-play rules are deferred until all serialized choices finish.
- Existing rooms, replays, and rules with zero or one request use the original
  path and retain their prior batching and conflict behavior.
- The UI, multiplayer protocol, AI, disconnect takeover, timeout, and
  simulation layers already respond to the single active pending request and
  need no contract change.

## Verification

Core regression tests cover the unchanged single-choice flow and a two-rule
flow that pauses twice, applies each response once, recalculates the second
count from the reduced hand, preserves snapshot privacy, and advances the turn
only after the final response.
