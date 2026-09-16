# Player-experience audit: items, rolls, and repeated actions

Date: 2026-09-16  
Scope: currently playable Item/Omen actions, dice presentation, inventory, combat
modifiers, room actions, and recovery after dropping cards.  
Development override: keep `MIN_PLAYERS = 1`.

## Verdict

**Contradicted for a release baseline.** Cards exist and many effects execute, but
the player cannot reliably tell which cards are passive, consumable, repeatable, or
limited per turn. Several encoded effects do not match their own displayed rule,
and multiple rolls emitted together can overwrite one another in the client.

The cheapest correct direction is not another feature layer. It is one explicit
card-use contract, one roll presentation queue, and a coverage ledger that prevents
authored text from being mistaken for implemented mechanics.

## Confirmed findings

| Severity | Finding                                                                   | Evidence                                                     | Player consequence                                                                    |
| -------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| P0       | `USE_ITEM` has no per-turn usage guard                                    | Reducer has no card-use state/check                          | Bell, Crystal Ball, Spirit Board and other retained powers can be spammed in one turn |
| P0       | Client stores only one `activeRoll`                                       | Event loop overwrites the previous roll                      | Omen effect roll can disappear when a Haunt roll follows in the same batch            |
| P0       | Some displayed rules and encoded effects disagree                         | Content/effect comparison                                    | Player receives a different result from the card they read                            |
| P0       | Passive weapons are not connected to attack calculation                   | Attack uses trait value; `isWeapon` is presentation metadata | Axe/Dynamite/other weapons appear owned but do not perform their advertised action    |
| P1       | Adrenaline Shot is permanent `+2` index steps                             | `onUse` changes Speed without cleanup                        | “Until end of turn” becomes a permanent buff                                          |
| P1       | Healing Salve has no trait choice                                         | Hard-coded Might and Speed gain                              | “Any trait” cannot be chosen                                                          |
| P1       | Smelling Salts has no target/stun handling                                | Self Sanity gain only                                        | Advertised explorer recovery cannot be performed                                      |
| P1       | Dynamite has no `onUse`                                                   | Empty effect list                                            | Use button is absent and card is inert                                                |
| P1       | Persistent carry bonuses mutate base traits on draw                       | `onDraw` trait changes                                       | Dropping/trading the card cannot remove its bonus                                     |
| P1       | Dropped cards have no pickup path                                         | IDs are written into a tile string flag                      | Dropping can permanently strand a card                                                |
| P1       | Cards with no `onUse` can still be accepted by reducer if called directly | No explicit `onUse.length` rejection                         | Protocol and UI legality can disagree                                                 |
| P2       | UI does not explain passive/consumable/cooldown/target requirements       | One generic Use button                                       | Legal actions are hard to predict and errors feel arbitrary                           |

## Current content surface

- 22 Items: 10 have `onUse`; 6 contain a roll effect.
- 13 Omens: 4 have `onUse`; 5 contain a roll effect.
- 25 Events: all have `onDraw`; 24 contain a roll effect.
- Explicit “once per turn” retained powers currently include Bell, Crystal Ball,
  and Spirit Board.

These counts describe authored data, not verified gameplay coverage.

## Required player-facing contract

Every held card must expose exactly one primary classification:

1. **Passive while held** — modifier is derived from ownership and disappears on
   drop/trade/loss; no Use button.
2. **Consumable** — usable once, resolves any choice/roll, then moves to discard or
   removed as specified.
3. **Once per turn** — retained after use; unavailable until the owner's next turn.
4. **Repeatable with rule restriction** — retained and gated by its exact timing,
   target, room, phase, or cost rule.
5. **Manual/unsupported** — visibly labelled; never shown as automated.

Displayed text, server legality, available-actions selectors, and client controls
must derive from the same classification.

## Player-flow requirements

```text
choose card
  -> show legal targets/traits if required
  -> confirm action
  -> server validates phase, owner, timing, cooldown, target, and cost
  -> server determines dice and effect
  -> client queues every roll/result in order
  -> inventory/cooldown/passive state updates visibly
  -> player regains control only when all blocking prompts are complete
```

No animation decides the outcome. No result may be skipped because another modal
arrived later in the same event batch.

## Additional experience risks to include in the worker audit

- action succeeds but gives no readable reason/result;
- button is hidden where a disabled button with an explanation would teach better;
- target or trait is silently defaulted;
- permanent modifier survives losing the source card;
- reconnection repeats a consumable or clears a cooldown;
- replay uses a different RNG sequence;
- a dead/stunned/removed actor can still use a card;
- card ownership is duplicated across draw, discard, in-play, inventory, and room;
- pending prompt allows End Turn or another item use;
- solo development mode deadlocks actions expecting another explorer;
- unavailable actions look implemented because full card prose is displayed.

## Cheapest decisive playtest

Use deterministic solo setup plus a second synthetic seat only for target actions.
Test one example from every contract:

1. passive weapon affects only the relevant attack;
2. passive carry bonus disappears after drop and returns after pickup;
3. Bottle is consumed after its roll;
4. Bell works once, is blocked in the same turn, and works next turn;
5. Crystal Ball/Spirit Board show their roll and then cooldown;
6. Healing Salve asks for one trait and changes only that trait;
7. Smelling Salts asks for a legal explorer/choice;
8. Dynamite asks for a room/target and resolves once;
9. an Omen effect roll and Haunt roll are both shown in order;
10. reconnect/replay does not duplicate use or reroll.

Support signal: the player can predict every legal card action, sees every roll and
result in order, and inventory/card zones conserve identity.  
Stop signal: any card can be spammed, a roll is skipped, an effect contradicts its
displayed rule, or a card is duplicated/lost across zones.
