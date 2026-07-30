# Rule choice contract v2 design

Date: 2026-07-31

## Decision

Adopt the deferred E01/E12 option A and add player card choices as rule
contract v2. Existing contract v1 rules remain supported without behavior
changes.

The first consumer is `10捨て`. The shared mechanism must also be sufficient
for later rules such as `7渡し`; no `10捨て`-specific state belongs in the
engine.

## `10捨て` semantics

1. The rule fires after an accepted play containing one or more **natural**
   rank-10 cards. A joker used as a wildcard is not itself a 10.
2. Let `N` be the number of natural 10s in the play. After the played cards
   leave the hand, the player must choose exactly `min(N, remaining hand
   size)` cards from their remaining hand.
3. The chosen cards move directly from that hand to the discard pile. They do
   not join or alter the current field play and cannot affect its shape or
   strength.
4. The player cannot skip the choice. The game does not advance the turn or
   apply the `afterPlay` Effect batch until a valid response is accepted.
5. If the play emptied the hand, there is no possible discard and no choice is
   requested. If discarding empties the hand, the ordinary engine standing
   logic finishes that player.
6. AI-controlled, disconnected, and timed-out players answer immediately with
   a deterministic legal choice. Human players receive the ordinary turn
   timeout while choosing.

## Contract vocabulary

Contract v2 adds:

- `requestChoice`, allowed only from `afterPlay`;
- `GamePhase = 'awaitingChoice'`;
- `GameAction = { type: 'ruleInput', player, choiceId, cardIds }`;
- an optional third `input` argument to `afterPlay`.

A card request declares:

- the target player;
- a stable rule-local `choiceId`;
- the source hand and a selector defining the selectable cards;
- one exact required count;
- a trusted `messageKey` from rule metadata.

Only the target player's own hand may be a v2 card-choice source. The engine
resolves the selector against the authoritative post-play state, stores only
card IDs in private pending state, and exposes card faces only to the target
player's snapshot.

The first hook call is a non-authoritative preflight. If the adopted Effect is
`requestChoice`, the engine commits the play in `awaitingChoice` without
applying any `afterPlay` Effects. A valid `ruleInput` then invokes the same
`afterPlay` batch authoritatively at the same deterministic invocation index,
passing the response only to the requesting rule. The requesting rule returns
ordinary Effects such as `moveCards` and `announce`.

`requestChoice` must be the requesting rule's only Effect in preflight. At most
one choice is adopted for an `afterPlay` batch; competing requests use the
normal priority order. A rule may not request another choice while handling
the response. These limits keep one transition serializable and deterministic
without introducing nested continuations.

## State, replay, and compatibility

- `ENGINE_CONTRACT_VERSION` becomes 2, while supported rule and replay
  versions are `{1, 2}`.
- Rule context reports the individual rule's contract version.
- The pending request is private engine state; the public phase and target
  player remain visible.
- `ruleInput` is recorded as a normal `SetAction`, so deterministic replay
  needs no side channel.
- Contract v1 rules receive no input and cannot emit `requestChoice`.
- Existing rules, rooms, and version-1 replay records retain their behavior.

## Integration behavior

- Multiplayer snapshots include the pending choice summary for everyone and
  selectable cards only for the target.
- The web client reuses hand-card selection, requires the exact count, disables
  pass, and labels the primary action as discarding the selected cards.
- AI, disconnect takeover, timeout handling, and simulations choose a
  deterministic valid subset and submit `ruleInput` before normal play
  resumes.
- CX-01 exposes `requestChoice` as approved vocabulary, emits contract version
  2 for specifications that use it, and no longer treats card choice alone as
  A1.
