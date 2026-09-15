# Player-experience audit: Omen and room effects

Date: 2026-09-15  
Scope: pre-Haunt exploration, Omen resolution, Haunt-roll timing, and room-tile feedback  
Temporary development rule: `MIN_PLAYERS = 1`

## Verdict

**Contradicted.** The intended loop is readable only if the player sees the room,
reveals and resolves its card, understands every required decision or roll, and
then sees the Haunt roll. The current player report says that this causal order is
not visible: the Haunt roll can appear before the Omen reveal, Omen mechanics are
unclear or absent, and special rooms often produce no visible response.

This document does not claim balance or fun. It identifies the cheapest behavior
and feedback checks needed before more content is added.

## Player promise

For a player exploring the house:

1. entering a new room changes the board visibly;
2. a room symbol reveals the matching card before later consequences;
3. the card explains and resolves its immediate effect;
4. an Omen is placed in the explorer inventory when appropriate;
5. only after the Omen reveal/effect pipeline completes does the Haunt roll begin;
6. special room rules either resolve automatically or clearly tell the player what
   manual action remains.

The player should never need the debug panel or event-log internals to understand
why a roll, trait change, movement restriction, or Haunt occurred.

## Evidence ledger

| Finding | Evidence | Label | Release implication |
| --- | --- | --- | --- |
| Haunt-roll presentation can precede the Omen reveal | Direct player report | Observed | Blocking; ordering must be reproduced and fixed |
| Some Omen actions require rolls, choices, conditions, or persistent ownership | Existing card/effect model and player report | Derived + Observed | Each Omen needs a mechanic coverage matrix |
| Special rooms can appear inert | Direct player report | Observed | Blocking for rooms marked automated |
| A single reducer result may emit card and roll events together | Current architecture | Derived | UI event order alone may not represent rule-resolution order |
| Actual behavior across all Omen cards and special rooms has not been playtested | No complete session record supplied | Unknown | Require scripted and manual coverage before release |

## Player-facing failure modes

### P0 — Omen and Haunt ordering

Required visible sequence:

```text
discover room
  -> show room and symbol
  -> draw/reveal Omen
  -> acknowledge card
  -> resolve immediate Omen effects and prompts
  -> place kept Omen in inventory
  -> perform Haunt roll
  -> show total, threshold, and triggered/not-triggered result
  -> resume or change phase
```

A local animation delay is not sufficient if the server has already advanced past
an unresolved Omen prompt. The authoritative state machine and the UI presentation
queue must agree on this order.

### P0 — Silent special rooms

Every room marked as having a rule needs one of these outcomes:

- automatic resolution with visible log/modal feedback;
- an explicit room-action button with eligibility and result feedback;
- a manual-rule panel saying exactly that automation is not implemented yet.

Silence is a failure. A room must not look broken merely because its complete rule
belongs to a later milestone.

### P1 — Omen mechanic coverage

Create a ledger for every Omen containing:

- card id and display name;
- keep/discard behavior;
- immediate effect;
- optional use effect;
- required trait or dice roll;
- target/choice prompt;
- persistent modifier or companion behavior;
- implemented, manual, or blocked status;
- automated tests covering its actual state transition;
- confirmation that Haunt roll occurs after its immediate pipeline.

Do not treat authored card text or a modal as implemented gameplay.

### P1 — Feedback collisions

Card, dice, trait, room, and Haunt feedback must be serialized. If multiple events
arrive in one server batch, the client should queue them in rule order instead of
letting the last event replace or cover the first modal.

### P2 — Solo development mode

Keep `MIN_PLAYERS = 1` for the current development cycle. Tests must label solo
start as a development rule so it cannot be mistaken for official 2E validation.
Production restoration to 3 players is a separate explicit decision.

## GMT map

| Goal | Means | Tool | Expected player behavior | Failure signal |
| --- | --- | --- | --- | --- |
| Understand exploration consequences | Causal feedback | Ordered reveal/effect queue | Player predicts why the next roll occurs | Dice appears before the card |
| Make Omen acquisition meaningful | Risk and persistent state | Card resolution, inventory, prompts | Player reads, resolves, then anticipates Haunt risk | Card is cosmetic or effect is skipped |
| Treat rooms as game state, not background art | Spatial rules | Entry/exit/end-turn hooks and room actions | Player changes route or decision around a room | Special room has no visible behavior |
| Preserve tension without confusion | Pacing and information | One blocking presentation at a time | Player can explain the last consequence | Overlapping modals or unexplained changes |

## Cheapest decisive playtest

Use one solo development session with a deterministic seed and a debug-only setup
helper to force representative draws. Do not balance or polish during this test.

Required cases:

1. discover a normal Event room;
2. discover an Omen with no immediate choice;
3. discover an Omen with an immediate roll;
4. discover an Omen with a target or choice prompt;
5. trigger and fail/succeed a Haunt roll;
6. enter a room with an on-enter effect;
7. attempt to leave/cross a room with a restriction;
8. end a turn in a room with an end-turn effect;
9. use a once-per-game room action twice;
10. encounter a not-yet-automated room.

For each case record the ordered server events, visible UI sequence, resulting
state, and whether the player can explain the outcome without opening debug state.

Support signal: all ten cases have deterministic state transitions and visible,
non-overlapping feedback in rule order.  
Revise signal: rules resolve correctly but UI order or explanation is unclear.  
Stop signal: a card/room effect is silently skipped, duplicated after reconnect,
or the Haunt roll advances while an Omen decision remains unresolved.

