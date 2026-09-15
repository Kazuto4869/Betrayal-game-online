# BETRAYAL AT HOUSE ON THE HILL — 2E FIRST, 3E READY
# Master Build Plan

## 0. Project direction

### Main goal

Build a fully playable browser-based multiplayer version of **Betrayal at House on the Hill 2nd Edition** first, using existing open-source fan projects as building blocks instead of starting from scratch.

After the 2E version is stable and playable, add **3rd Edition as a second selectable edition** without rewriting the core engine.

### Final product

```text
Create Game
├── 2nd Edition
└── 3rd Edition
```

The shared engine handles:

- multiplayer
- board state
- movement
- dice
- traits
- damage
- cards
- inventory
- combat
- monsters
- tokens
- private information
- reconnect
- action log
- persistence

Edition packs provide:

```text
2E
├── characters
├── rooms
├── cards
├── haunt matrix
├── 50 haunts
└── edition-specific rules

3E
├── characters
├── rooms
├── cards
├── scenarios
├── 50 haunts
└── edition-specific rules
```

---

# 1. Repositories to use

## 1.1 Main repository: `thai-nm/bahoth2nd`

This becomes the **main codebase**.

Why:

- modern TypeScript monorepo
- React + Vite client
- Node server
- WebSocket multiplayer
- 3–6 player structure
- player identity
- private/redacted state
- board renderer
- room placement
- movement graph
- discovery
- reconnect-related architecture
- prompt system
- action/event log
- test suite
- effect interpreter already started

Keep its architecture:

```text
packages/
├── shared
├── content
├── engine
├── server
└── client
```

Do NOT rebuild these systems from GrapeSalad.

---

## 1.2 Data / asset source: `GrapeSalad/Betrayal-Clone`

Use as a source for:

- 2E character data
- trait tracks
- room data
- starting rooms
- character images
- room images
- Omen assets/data
- Event assets/data
- Item/card scans where available
- token sheets
- Haunt Chart/reference files
- old Event/Omen resolution logic for comparison

Do NOT continue developing its Angular 4 app.

Treat it as:

```text
legacy-reference/
```

---

## 1.3 Gameplay implementation reference: `ALpht/betrayal-at-house-on-the-hill`

Use directly as reference / source for porting:

- dice
- decks
- card resolution
- command validation
- combat
- victory checks
- movement rules
- room placement
- traitor assignment
- public/private snapshots
- reconnect tokens
- Haunt state
- The Mummy Walks implementation
- LAN multiplayer ideas
- tests

Important rule:

> Port behavior into the `bahoth2nd` architecture instead of replacing the `bahoth2nd` engine architecture with ALpht's architecture.

---

## 1.4 Mechanics reference: `PupRiku/BetrayalGame`

Use to cross-check:

- Item inventory
- use/drop/pickup/trade
- status effects
- player death
- combat
- damage allocation
- room/pathfinding behavior
- Omen/Event/Item behavior
- monster system
- Haunt reveal
- The Mummy Walks

This is an Unreal Engine implementation, so logic must be translated rather than copied structurally.

---

# 2. Target repository structure

Keep `bahoth2nd` monorepo and extend it into:

```text
betrayal-web/
│
├── packages/
│   ├── shared/
│   │   ├── protocol
│   │   ├── ids
│   │   ├── game-types
│   │   └── edition-types
│   │
│   ├── content/
│   │   ├── schemas
│   │   ├── loaders
│   │   ├── validators
│   │   └── editions
│   │
│   ├── engine/
│   │   ├── dice
│   │   ├── traits
│   │   ├── damage
│   │   ├── board
│   │   ├── movement
│   │   ├── discovery
│   │   ├── effects
│   │   ├── decks
│   │   ├── cards
│   │   ├── inventory
│   │   ├── combat
│   │   ├── monsters
│   │   ├── tokens
│   │   ├── haunt
│   │   ├── victory
│   │   └── reducer
│   │
│   ├── server/
│   │   ├── rooms
│   │   ├── sessions
│   │   ├── websocket
│   │   ├── persistence
│   │   ├── snapshots
│   │   └── authorization
│   │
│   └── client/
│       ├── lobby
│       ├── character-select
│       ├── board
│       ├── cards
│       ├── inventory
│       ├── haunt
│       ├── log
│       └── game-over
│
├── content/
│   ├── 2e/
│   │   ├── characters.json
│   │   ├── rooms.json
│   │   ├── events.json
│   │   ├── items.json
│   │   ├── omens.json
│   │   ├── haunt-chart.json
│   │   ├── tokens.json
│   │   ├── monsters.json
│   │   └── haunts/
│   │
│   └── 3e/
│       └── future/
│
├── assets/
│   └── 2e/
│
├── scripts/
│   ├── migrate-grapesalad-data.ts
│   ├── validate-2e-content.ts
│   └── build-content-manifest.ts
│
└── tests/
```

---

# 3. Architecture rule: edition-independent core

The core engine must never assume 2E-specific Haunt logic.

Bad:

```ts
getHaunt(room, omen) {
  return hauntMatrix[room][omen];
}
```

Good:

```ts
edition.resolveHaunt(state);
```

Interface:

```ts
interface EditionDefinition {
  id: "2e" | "3e";

  content: {
    characters: CharacterDefinition[];
    rooms: RoomDefinition[];
    events: CardDefinition[];
    items: CardDefinition[];
    omens: CardDefinition[];
  };

  rules: EditionRules;

  hauntResolver: HauntResolver;

  haunts: HauntDefinition[];
}
```

2E:

```text
Room + Omen
→ Haunt Matrix
→ Haunt
```

3E later:

```text
Scenario + Omen
→ Haunt
```

The core engine must not care which method is used.

---

# 4. Phase 0 — Fork and baseline

## Goal

Create a stable starting point.

## Tasks

- [ ] Fork `thai-nm/bahoth2nd`.
- [ ] Rename repo to something such as `betrayal-web`.
- [ ] Add original repos under `docs/references.md`.
- [ ] Clone GrapeSalad locally as legacy reference.
- [ ] Clone ALpht locally as implementation reference.
- [ ] Keep all upstream code untouched in separate folders/repos.
- [ ] Run:
  - `npm install`
  - `npm run typecheck`
  - `npm test`
  - `npm run dev`
- [ ] Record current passing test count.
- [ ] Confirm 3–6 players can join.
- [ ] Confirm board works.
- [ ] Confirm movement/discovery works.

## Acceptance gate

The original `bahoth2nd` baseline works before any 2E content is inserted.

---

# 5. Phase 1 — Audit existing 2E data

## Goal

Know exactly what data can be migrated from GrapeSalad and what is missing.

## Audit categories

### Characters

Need:

- all 12 characters
- name
- age
- birthday
- color
- Speed track
- Might track
- Sanity track
- Knowledge track
- starting indices
- portrait

### Rooms

Need:

- all drawable room tiles
- starting layout tiles
- allowed floor
- doors
- room symbol
- special text/rules
- asset mapping

### Cards

Need:

- Events
- Items
- Omens

For each:

- id
- name
- text
- effect
- roll
- outcome
- discard behavior
- inventory behavior
- once-per-turn behavior
- attack modifiers
- trade/drop restrictions

### Haunt content

Need:

- 2E Haunt Chart
- 50 Haunt IDs
- Traitor selection
- Hero rules
- Traitor rules
- monsters
- tokens
- win conditions

### Tokens/assets

Need:

- monster tokens
- item markers
- numbered tokens
- trait markers
- special Haunt tokens

## Output

Create:

```text
docs/audit/2e-content-audit.md
```

Status:

```text
FOUND
PARTIAL
MISSING
NEEDS_VERIFICATION
```

---

# 6. Phase 2 — Migrate characters and rooms

## Goal

Replace placeholder `bahoth2nd` content with official 2E-compatible data.

## Tasks

Create:

```text
scripts/migrate-grapesalad-data.ts
```

Convert:

```text
GrapeSalad game-data.json
        ↓
bahoth2nd content schemas
```

Do not manually rewrite everything.

## Characters

Map old structure:

```json
{
  "speed": [{
    "initialIndex": 3,
    "array": [...]
  }]
}
```

to:

```json
{
  "speed": {
    "track": [...],
    "startIndex": 3
  }
}
```

Do the same for:

- Might
- Sanity
- Knowledge

## Rooms

Convert:

```text
basement
ground
upper

topDoor
bottomDoor
leftDoor
rightDoor
```

into:

```text
floors[]
doors[]
```

## Acceptance gate

- 12/12 characters validate.
- all rooms validate.
- board starts with 2E data.
- players can explore using real 2E room definitions.

---

# 7. Phase 3 — Finish dice and traits

## Goal

Make core numerical rules stable before cards.

## Dice

Implement authoritative Betrayal dice:

```text
0 / 1 / 2
```

Support:

```ts
rollDie()
rollDice(count)
```

All random results generated by server/engine, never independently by clients.

## Traits

Store:

```text
track index
```

not only the displayed value.

Operations:

```text
GAIN_TRAIT
LOSE_TRAIT
SET_TRAIT
HEAL_TRAIT
```

## Death

Support pre-/post-Haunt behavior according to 2E rules.

## Tests

- die range
- dice total
- trait up/down
- max track
- skull/death behavior
- initial index
- duplicate trait values

---

# 8. Phase 4 — Deck engine

## Goal

Complete generic deck support.

Implement:

```text
Event Deck
Item Deck
Omen Deck
```

Required operations:

```text
SHUFFLE
DRAW
DISCARD
BURY
REMOVE
RETURN
```

State:

```ts
DeckState {
  drawPile
  discardPile
  removed
}
```

All players see only information they are allowed to see.

---

# 9. Phase 5 — Generic effect interpreter

## Goal

Most cards should be data, not custom code.

Extend `bahoth2nd` existing effect interpreter.

Minimum effects:

```text
ROLL_DICE
ROLL_TRAIT

GAIN_TRAIT
LOSE_TRAIT

PHYSICAL_DAMAGE
MENTAL_DAMAGE
GENERAL_DAMAGE

DRAW_CARD
GAIN_CARD
DISCARD_CARD

MOVE
TELEPORT
FORCED_MOVE

GAIN_ITEM
LOSE_ITEM

SPAWN_TOKEN
REMOVE_TOKEN

SET_FLAG
CLEAR_FLAG

PROMPT
CHOOSE_PLAYER
CHOOSE_ROOM
CHOOSE_CARD

START_HAUNT
END_TURN
```

Complex cards may use a custom script handler, but only when generic effects cannot represent them.

---

# 10. Phase 6 — Damage engine

## Goal

Fix one of the biggest weaknesses of GrapeSalad.

Damage types:

```text
PHYSICAL
→ Might / Speed

MENTAL
→ Sanity / Knowledge

GENERAL
→ any trait
```

If damage allocation has multiple valid choices:

```text
engine
→ PendingPrompt
→ player chooses allocation
→ server validates
→ apply
```

Never automatically dump all Physical damage into Might or Speed.

Tests must cover:

- mixed distribution
- lethal allocation
- pre-Haunt minimum
- post-Haunt death
- General damage

---

# 11. Phase 7 — Full Event / Item / Omen content

## Goal

Reach full pre-Haunt content coverage.

### Events

Import all 2E Events.

Each must have:

```text
draw
display
roll/choice
resolution
trait/damage effects
discard/bury
persistent flags if necessary
```

### Items

Build Item model:

```ts
ItemDefinition {
  id
  name
  passiveEffects
  actions
  weapon
  droppable
  tradable
  discardRules
}
```

### Omens

Omens behave as inventory objects plus Haunt trigger.

Need:

- passive effect
- actions
- companions
- weapons
- trade/drop restrictions

## Acceptance gate

All card decks have complete data and no placeholder cards.

---

# 12. Phase 8 — Inventory system

## Goal

Implement all Item/Omen ownership interactions.

Player state:

```ts
inventory: {
  items: CardId[];
  omens: CardId[];
}
```

Commands:

```text
USE_CARD
DROP_CARD
PICK_UP_CARD
TRADE_CARD
GIVE_CARD
STEAL_CARD
DISCARD_CARD
```

Track:

```text
owner
usedThisTurn
acquiredThisTurn
charges
droppedLocation
```

Client UI:

```text
Inventory
├── Items
└── Omens
```

---

# 13. Phase 9 — 2E Haunt roll and Haunt Chart

## Goal

Implement 2E Haunt start correctly.

Pipeline:

```text
Omen drawn
↓
Haunt roll
↓
success/failure
↓
if Haunt begins:
  current room
  +
  current Omen
  ↓
  Haunt Chart
  ↓
  Haunt #
```

Create:

```text
content/2e/haunt-chart.json
```

Example schema:

```json
{
  "omen-id": {
    "room-id": 1
  }
}
```

Actual orientation can be different, but it must be data-driven.

---

# 14. Phase 10 — Game phase state machine

## Goal

Stop using scattered booleans.

Use:

```text
LOBBY
SETUP
EXPLORATION
HAUNT_SETUP
HERO_TURN
TRAITOR_TURN
MONSTER_TURN
GAME_OVER
```

State:

```ts
phase
round
activeSeat
turnOrder
hauntId
traitorSeat
```

Only legal actions for the current phase may execute.

---

# 15. Phase 11 — Combat engine

## Goal

Implement generic combat before adding many Haunts.

Support:

```text
explorer vs explorer
explorer vs monster
monster vs explorer
```

Default:

```text
Might attack
```

Allow:

```text
alternative trait attack
weapon bonus
attack modifiers
defense modifiers
damage type override
stun
kill
steal
forced movement
```

Create:

```text
packages/engine/src/combat.ts
```

Port useful ALpht combat logic into this engine.

---

# 16. Phase 12 — Monster engine

## Generic monster state

```ts
MonsterState {
  id
  definitionId
  position
  stunned
  alive
  ownerTeam
}
```

Monster definition:

```ts
MonsterDefinition {
  name
  speed
  might
  sanity
  knowledge
  movement
  attacks
  abilities
}
```

Support:

```text
ROLL_MOVEMENT
MOVE_MONSTER
ATTACK
STUN
UNSTUN
KILL
```

Haunts may override generic behavior.

---

# 17. Phase 13 — Token system

## Goal

Avoid Haunt-specific DOM markers.

Generic:

```ts
TokenState {
  id
  tokenType
  position
  owner
  side
  value
  visibleTo
}
```

Support:

```text
SPAWN_TOKEN
MOVE_TOKEN
FLIP_TOKEN
REMOVE_TOKEN
ASSIGN_TOKEN
```

This system will later also work for 3E.

---

# 18. Phase 14 — Hero / Traitor privacy

## Goal

Reproduce real Betrayal hidden information.

Server contains full state.

Clients receive projected states.

```text
Hero:
public
+ hero private
+ own player private

Traitor:
public
+ traitor private
+ own player private
```

Never send private Traitor data to Hero clients.

Extend existing `bahoth2nd` redaction system.

---

# 19. Phase 15 — Implement Haunt #1: The Mummy Walks

## Goal

First complete vertical-slice Haunt.

Use ALpht implementation as primary coding reference.

Import/port:

- Haunt state
- Traitor assignment
- Mummy actions
- victory logic
- monster rules
- setup
- Hero/Traitor private info

Pipeline:

```text
Haunt begins
↓
Haunt Chart resolves #1
↓
assign Traitor
↓
Hero setup
↓
Traitor setup
↓
spawn Mummy
↓
Hero turn
↓
Traitor turn
↓
Monster turn
↓
combat
↓
victory check
↓
game over
```

## Acceptance gate

3–6 browser clients can play from game creation through completion of The Mummy Walks with no manual database changes.

---

# 20. Phase 16 — Multiplayer hardening

Existing `bahoth2nd` multiplayer is the foundation.

Complete:

```text
Create Game
Join by Code
Choose Character
Ready
Start
Reconnect
Disconnect
Host migration / recovery
```

Every command contains:

```text
roomId
seatId
revision
action
payload
```

Reject:

```text
wrong turn
stale revision
illegal action
invalid target
unauthorized private access
```

---

# 21. Phase 17 — Persistence

## Goal

Do not lose a 2-hour Betrayal game after server restart.

Persist:

```text
game state
event log
player identity
room metadata
content version
```

Recommended:

```text
Postgres / Supabase
```

or another durable store.

Redis can optionally hold active-room state/cache.

Save after every accepted game action.

Reconnect:

```text
player token
↓
room
↓
seat
↓
authorized snapshot
```

---

# 22. Phase 18 — UI usable for real play

## Game screen

```text
┌────────────────────────────────────────────┐
│ Room code | Round | Turn | Phase | Omen   │
├────────────┬─────────────────┬─────────────┤
│ Character  │                 │ Inventory   │
│ Traits     │      MAP        │ Cards       │
│ Actions    │                 │ Haunt info  │
├────────────┴─────────────────┴─────────────┤
│ Action Log / Pending Choice               │
└────────────────────────────────────────────┘
```

Features:

- floor tabs
- pan / zoom
- legal movement highlighting
- room rotation modal
- card modal
- dice result
- trait panel
- inventory
- combat target selection
- Hero/Traitor info
- monster/token overlays
- action log
- reconnect UI

---

# 23. Phase 19 — Deploy an early playable build

Do NOT wait for 50 Haunts.

Deploy after:

```text
✓ 3–6 multiplayer
✓ full exploration
✓ full cards
✓ inventory
✓ combat
✓ Haunt Chart
✓ Hero/Traitor privacy
✓ monsters/tokens
✓ The Mummy Walks
```

This becomes:

```text
2E Alpha
```

Have friends playtest it.

Collect:

```text
state bugs
rules mistakes
sync problems
UI confusion
reconnect bugs
```

Fix architecture before adding 49 more Haunts.

---

# 24. Phase 20 — Generic Haunt framework

Before Haunts 2–50, define one common format.

```ts
HauntDefinition {
  id
  title

  trigger

  traitorSelector

  setup

  heroPrivate
  traitorPrivate

  tokens
  monsters

  actions

  hooks

  ruleOverrides

  heroVictory
  traitorVictory
}
```

Timing hooks:

```text
HAUNT_START

TURN_START
TURN_END

BEFORE_MOVE
AFTER_MOVE

BEFORE_ATTACK
AFTER_ATTACK

ON_DAMAGE
ON_DEATH

MONSTER_TURN_START
MONSTER_TURN_END

TOKEN_ADDED
TOKEN_REMOVED

VICTORY_CHECK
```

---

# 25. Phase 21 — Remaining 49 Haunts

Do not build strictly 2 → 50.

Group by reusable mechanic.

Suggested waves:

### Wave A

Simple:

```text
trait rolls
token collection
room objectives
basic monsters
```

### Wave B

Combat-heavy:

```text
special attacks
multiple monsters
alternate traits
weapons
```

### Wave C

Movement-heavy:

```text
forced movement
teleport
secret passages
room manipulation
```

### Wave D

State-heavy:

```text
transformation
possession
body swap
hidden role
timed objectives
```

### Wave E

Highly custom Haunts

Use custom handlers only when generic actions/hooks are insufficient.

---

# 26. Haunt tests

Every Haunt must test relevant cases:

```text
correct Haunt selection
correct Traitor
correct setup
correct tokens
correct monsters
special action legal
special action illegal
Hero victory
Traitor victory
death interaction
reconnect mid-Haunt
privacy
```

Status:

```text
NOT_STARTED
DATA_READY
IMPLEMENTED
VERIFIED
TESTED
```

Do not call 2E complete until:

```text
50 / 50 TESTED
```

---

# 27. 2E v1.0 Definition of Done

2E is complete when:

- [ ] 3–6 players can create/join.
- [ ] all 12 characters work.
- [ ] full 2E room set works.
- [ ] full Event deck works.
- [ ] full Item deck works.
- [ ] full Omen deck works.
- [ ] inventory works.
- [ ] trading/drop/use works.
- [ ] traits/damage/death work.
- [ ] Haunt roll works.
- [ ] Haunt Chart works.
- [ ] combat works.
- [ ] monsters work.
- [ ] tokens work.
- [ ] Hero/Traitor privacy works.
- [ ] reconnect works.
- [ ] persistence works.
- [ ] action log works.
- [ ] 50/50 Haunts implemented.
- [ ] 50/50 Haunts tested.
- [ ] full remote playtest completed.
- [ ] production deployment works.

---

# 28. Phase 22 — Refactor final Edition API

Once 2E is stable, formalize:

```text
Core Engine
    ↑
 Edition API
   /     \
 2E       3E
```

Move all 2E-specific rules under:

```text
content/2e/
packages/content/src/editions/2e/
```

Core must no longer import a 2E module directly.

Instead:

```ts
getEdition(game.editionId)
```

---

# 29. Phase 23 — Add 3E mode later

Reuse:

```text
multiplayer
dice
traits
board
movement
cards
inventory
damage
combat
monsters
tokens
privacy
persistence
UI
```

New 3E content:

```text
characters
rooms
Events
Items
Omens
Scenario Cards
50 Haunts
3E-specific rule overrides
```

Key switch:

```text
2E:
Room + Omen → Haunt Chart

3E:
Scenario + Omen → Haunt
```

The 3 official PDFs already collected become the canonical 3E rules/Haunt source.

---

# 30. Immediate execution order for Codex

Do NOT give Codex the entire project at once.

Use this sequence:

```text
01 baseline bahoth2nd
02 audit GrapeSalad data
03 migrate characters
04 migrate rooms
05 finish dice
06 finish traits
07 implement damage
08 implement decks
09 extend effect interpreter
10 import Events
11 implement Items
12 implement Omens
13 inventory
14 2E Haunt Chart
15 phase state machine
16 combat
17 monsters
18 tokens
19 Hero/Traitor privacy
20 port The Mummy Walks
21 multiplayer hardening
22 persistence
23 deploy alpha
24 Haunt framework
25 remaining Haunts
26 2E v1.0
27 Edition API cleanup
28 3E content pack
```

Each Codex task must state:

```text
Goal
Files allowed to modify
Existing code to reuse
Tests to write first
Acceptance criteria
Things explicitly not to modify
```

---

# 31. First milestone

## Milestone: `2E PRE-HAUNT PLAYABLE`

Required:

```text
3–6 players join
↓
choose characters
↓
start game
↓
explore house
↓
draw/place rooms
↓
Event works
↓
Item works
↓
Omen works
↓
inventory works
↓
trait/damage works
↓
Haunt roll works
↓
Haunt Chart returns correct Haunt
```

At this point the project has a complete first half of Betrayal.

---

# 32. Second milestone

## Milestone: `FIRST FULL GAME`

Add:

```text
The Mummy Walks
Hero/Traitor split
combat
monster
tokens
victory
```

Then:

```text
CREATE ROOM
→ PLAY
→ HAUNT
→ WIN/LOSE
```

must work completely online.

This is the first version worth playtesting with friends.

---

# 33. Final strategy summary

```text
MAIN BASE
thai-nm/bahoth2nd
│
├── use its multiplayer architecture
├── use its board/movement/discovery
├── use its prompts/redaction/log
│
├── import 2E content/assets
│       from GrapeSalad
│
├── port gameplay systems
│       from ALpht
│
├── cross-check mechanics
│       with PupRiku
│
└── finish 2E
        ↓
    playable online
        ↓
    50 Haunts
        ↓
    Edition API
        ↓
    add 3E
```

The priority is **not** “complete every card and every Haunt before the game can run.”

The priority is:

```text
stable shared engine
→ full pre-Haunt
→ one complete Haunt
→ real multiplayer playtest
→ scale content to 50 Haunts
→ add 3E later
```

This is the lowest-risk path and reuses the maximum amount of existing work.
