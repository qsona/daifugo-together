# Integer choice and after-pass rule extension

- Date: 2026-08-31 / Status: implemented
- Proposal: `01M079JQC6AC0JMCXNY9Y1BYZ0` "Guillotine Clock"
- Related: [Game-start rule choice](2026-08-03-game-start-choice-design.md),
  [CX-01 extension flow](2026-08-11-judge-extension-flow-design.md),
  [E01 game engine](../epics/E01-game-engine.md)

## 1. Background and purpose [immutable]

The proposal makes the player who performs the Nth pass in a game finish as
the lowest-ranked player. The previous game's lowest-ranked player chooses N;
the first game has no effect.

The current contract can force a standing and can ask for cards or a player at
game start, but it cannot ask for a bounded integer and does not invoke rules
after an accepted pass. Add these as reusable contract vocabulary, then return
the proposal to CX-01 for re-judgement.

## 2. User experience [immutable]

- The first game does not ask for N and does not count passes.
- At the start of later games, the previous game's lowest-ranked player chooses
  an integer from 4 through 12.
- The chooser uses a discrete horizontal slider. It snaps to every integer,
  shows the selected number prominently, provides minus and plus controls, and
  requires an explicit confirmation.
- The initial and automated value is 8.
- Other players see that the previous lowest-ranked player is choosing.
- After confirmation, every player is told which pass number will trigger the
  rule.
- Only voluntary, accepted pass actions count. Pass events produced by
  `skipTurns` do not count.
- The count is global across all players and resets for each game.
- When the count reaches N, the passer is forced to the lowest standing and the
  activation is announced.

## 3. Acceptance criteria [immutable]

1. A contract-v2 rule can request and receive a bounded integer at game start.
2. Integer choices are validated authoritatively and survive snapshots,
   multiplayer transport, reconnect, AI/disconnect automation, replay, and
   simulation.
3. `afterPass` runs after a voluntary pass is recorded and before field-clear,
   next-turn, or game-end processing.
4. Synthetic skip pass events do not invoke `afterPass`.
5. The Guillotine Clock semantics above are expressible without adding
   proposal-specific engine state.
6. The 375x812 game UI provides an accessible discrete slider with touch
   targets of at least 44 CSS pixels.
7. Contract vocabulary, server SPEC validation, CX-01 prompt/schema parity,
   prompt versioning, and diff-guard vocabulary stay synchronized.
8. `pnpm verify` succeeds.

## 4. Out of scope [immutable]

- General free-form numeric or text input.
- Invoking pass hooks for `skipTurns` or other synthetic events.
- A generic public countdown-status presentation contract.
- Changing `forceRank` conflict and nearest-standing semantics.

## 5. Detailed specification [changeable, record required]

### 5.1 Integer choice

Add an `IntegerChoiceRequest` with `kind: 'integer'`, `min`, `max`, and
`defaultValue`. Bounds and values are finite safe integers. `min <= max`, the
range contains at most 100 values, and `defaultValue` lies within the range.

The corresponding `RuleInput` is `{ kind: 'integer', choiceId, value }`.
Clients submit the value through the existing `game:ruleInput` transport. The
server remains authoritative: values outside the stored pending range are
rejected with `INVALID_RULE_CHOICE`.

AI, disconnect, timeout, replay, and simulation choose `defaultValue`; they do
not infer a value from UI state.

### 5.2 `afterPass`

Add `afterPass(context, pass)` where `pass` is `{ player: PlayerId }`. It is an
effect hook, but it does not support `requestChoice`, `clearField`, or
`clearSuitBinding`. It supports the same non-choice state effects as
`afterFieldClear`.

The hook runs only for a successfully accepted `GameAction { type: 'pass' }`,
after `passedSinceLastPlay`, `turnCount`, and the public `passed` event are
visible in context. Its effects are applied before the engine determines an
all-pass clear, advances the turn, or finishes the game. This ensures a
`forceRank` result participates in those decisions immediately.

### 5.3 Guillotine Clock rule shape

The rule uses game-scope memory keys for the chosen target, current count, and
resolved flag. Counter writes are silent. No shared `GameState.passCount` is
added: this is rule-specific state and existing memory is sufficient.

The selected N and the activation are explicit announcements. Existing
`forceRank` priority and nearest-free-standing behavior resolves conflicts with
other rules.

## 6. Technical design notes [reference]

The extension crosses core contract and safe ports, reducer continuation,
snapshots and protocol schemas, room views and automation, web client/UI,
simulation, server SPEC allowlists, CX-01 prompt/schema/version, and diff guard.

The integer choice reuses the existing game-start continuation. `afterPass`
does not support choices, so pass processing needs no pending-choice
continuation state.

## 7. Decisions made during design

| Decision | Reason | Impact if overturned |
| --- | --- | --- |
| N is 4 through 12 | Values 1-3 let one unbeatable play deterministically eliminate one of the next three seats; very high values can disable the rule in practice. | Rule constants, messages, tests, and slider labels change. |
| Automated/default N is 8 | Neutral midpoint and stable replay behavior. | Automation and UI initial-value tests change. |
| Only voluntary passes count | A rule-generated skip should not unexpectedly execute another player. | Hook timing must be extended into turn advancement and expose a pass cause. |
| The counter is global per game | This follows “the player who passes on the Nth time,” rather than each player's Nth pass. | Memory would become per-player and activation odds change materially. |

## 8. Implementation record

- Starting commit: `26b5299709cf3ffbf751a841286e0698641d2f8d`

### Assumptions

| Assumption | Reason | Impact if overturned |
| --- | --- | --- |
| The first game performs no selection, counting, or announcement. | The proposal explicitly says the first game does not activate. | `onGameStart` and first-game tests change. |
| A conflicting occupied lowest standing follows existing `forceRank` semantics. | Preserves the established cross-rule priority contract. | Requires a new standing-conflict mechanism. |

### Detailed-spec changes

None yet.

### Verification

- `pnpm verify`
- 183 test files / 1,419 tests passed.
- The first sandboxed run could not bind HTTP test servers to `127.0.0.1`
  (`EPERM`); the same full command passed with local-listen permission.

### Remaining work and proposals

- Re-judge proposal `01M079JQC6AC0JMCXNY9Y1BYZ0` against CX-01 v21 after
  this common extension reaches the deployed server, then implement the rule
  in its generated rule workspace.
