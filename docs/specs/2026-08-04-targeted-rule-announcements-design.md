# Targeted rule announcements

## Purpose

Some rules need to tell a subset of players that a hidden condition is active
without exposing hands, card ownership, or the condition itself to other
players. The existing `announce` Effect always becomes a public `ruleFired`
event, so it cannot express that boundary.

## Contract

`announce` accepts an optional `players: PlayerId[]` field.

- Omitted: preserve the existing public `ruleFired` behavior.
- Present: deliver the resolved rule message only to the listed players.
- The list contains one to four unique, existing players.
- Targeted announcements do not enter public game history, public room events,
  `firedRules`, or the set-result fired-rule tally.
- The engine stores targeted notices in private game state. Player snapshots
  filter them before message resolution, so reconnecting recipients can still
  receive the latest relevant notice without exposing it to another seat.
- Private game state retains at most the latest 32 notices and keeps monotonic
  notice IDs, preventing a chatty rule from growing snapshots without bound.
- `announce` keeps no conflict key. Existing suppression still applies when
  the associated action is rejected. A targeted announcement may accompany an
  adopted silent `setMemory`, because secret-condition initialization is
  bookkeeping rather than a public activation.

## Compatibility

Existing rules omit `players` and retain byte-for-byte public behavior. The
new private-state field is optional when reading older snapshots and defaults
to an empty list.
