# Phase 1–2 2E Content Audit and Migration Design

## Authority and scope

This design implements Phase 1 (audit existing 2E data) and Phase 2 (migrate
characters and rooms) from
`../Plan/BETRAYAL_2E_FIRST_3E_READY_MASTER_PLAN.md`.

Only `betrayal-web/` may be modified. These sibling repositories are read-only
inputs:

- `../betrayal-grapesalad-legacy/`
- `../betrayal-alpht-reference/`
- `../betrayal-pupriku-reference/`

The work does not implement cards, dice, damage, inventory, haunts, or new room
rule hooks. Existing gameplay behavior and the `.js` ESM import convention stay
unchanged.

## Repository content boundary

The public repository continues to ship invented placeholder fixtures. Real
2E names, printed values, text, and artwork are local operator content under
the gitignored `content/` directory. The migration tool may create
`content/characters.json` and `content/tiles.json`, but these generated files
must not be staged or committed.

No reference artwork is copied. The Phase 1 audit records available portrait
and room-image paths so a later, separately scoped local asset pipeline can use
them. This preserves the intellectual-property policy in `docs/01-overview.md`.

## Source findings that constrain Phase 2

The GrapeSalad JSON contains:

- 12 unique characters, each with full profile metadata, one portrait path,
  four 9-slot trait tracks, and valid start indices;
- 42 `rooms` records, of which Upper Landing and Basement Landing are starting
  tiles, leaving 40 structured drawable rooms;
- 3 `stationary-rooms` records for Entrance Hall, Foyer, and Grand Staircase;
- 25 Events, no structured Items, 8 Omens, and 1 Haunt;
- no structured token manifest.

It also contains 18 structured room records with non-null special-rule text.
Two staircase rules are faithfully representable by the current static-link
model; the remaining 16 structured rules are audit-only. Collapsed Room and
Mystic Elevator add two more image-only printed rules that are also audit-only,
for 20 reviewed special-room rules across structured and image evidence.

The room asset directory contains two base-game rooms missing from the JSON:
Collapsed Room and Mystic Elevator. It also contains Panic Room, which is not
part of the 2E base-set migration and must be excluded.

The official 2E component list says there are 44 ordinary room tiles plus one
combined Entrance Hall/Foyer/Grand Staircase tile. Two of the 44 ordinary
tiles are the Upper and Basement Landings. In this engine the combined tile is
represented as three graph nodes, so the correct runtime shape is:

- 42 drawable tiles;
- 5 pre-placed semantic tiles;
- 47 total semantic tile definitions.

This corrects the earlier repository wording that treated all 44 ordinary
tiles as drawable and then added both landings again.

## Phase 1 deliverable

Create `docs/audit/2e-content-audit.md`. It must show evidence and one of these
statuses for every requested category:

- `FOUND`
- `PARTIAL`
- `MISSING`
- `NEEDS_VERIFICATION`

The audit must include:

- exact counts and completeness for characters, rooms, cards, haunts, and
  tokens/assets;
- a field-coverage matrix for every master-plan audit requirement, explicitly
  separating structured fields, prose-only information, scan/PDF-only evidence,
  and missing information (for example IDs, executable effects, rolls,
  outcomes, discard/inventory restrictions, traitor selection, monsters,
  tokens, and win conditions);
- explicit 12/12 coverage for character name/profile/track/start/portrait fields
  and a per-room source-to-output mapping for floors, doors, symbols, rules,
  assets, and starting/deck status;
- the character colour-pair mapping observed on the six local character-card
  scans;
- the distinction between structured records and image-only evidence;
- known legacy-data defects, including Vault's `itemCard` flag representing
  its printed room reward rather than a second discovery symbol;
- unsupported special-room timing/rule hooks that Phase 2 must not encode as
  `onEnter` effects;
- the official 2E component counts used as acceptance evidence;
- a migration decision for every `PARTIAL` or `NEEDS_VERIFICATION` item.

## Phase 2 architecture

### Pure transform

Create `packages/content/src/migrate-grapesalad.ts`. It owns all source-format
validation and deterministic conversion. It must export:

```ts
export function migrateGrapeSalad(source: unknown): ContentFile;
```

The function must have no filesystem access. It validates the legacy structure,
normalizes it, creates the target house layout, validates the result with the
existing `ContentFileSchema`, and returns the raw serializable content file.

### CLI shell

Create `scripts/migrate-grapesalad-data.ts`. It owns only argument parsing,
JSON reading, directory creation, JSON writing, and a concise summary. The
supported invocation is:

```bash
npm run content:migrate:2e -- \
  --source ../betrayal-grapesalad-legacy/game-data.json \
  --output content
```

`--source` is required. `--output` defaults to `content`. The CLI writes
`characters.json` and `tiles.json` atomically enough for this local tool by
computing and validating both payloads before either write begins. It exits
non-zero with a clear message for unreadable JSON, invalid legacy structure,
or invalid migrated content.

### Character mapping

IDs use `char.<snake_case_name>`. The exact colour pairs are:

| Colour | Explorers |
| --- | --- |
| purple | Heather Granville, Jenny LeClerc |
| red | Ox Bellows, Darrin Flash Williams |
| blue | Vivian Lopez, Madame Zostra |
| yellow | Missy Dubourde, Zoe Ingstrom |
| green | Peter Akimoto, Brandon Jaspers |
| white | Professor Longfellow, Father Rhinehardt |

For each trait, the legacy `array[0]` value `0` becomes `null`; indices 1–8
remain unchanged. `initialIndex` becomes the corresponding target `start`
index. Phase 2 does not extend `CharacterSchema` with profile or portrait
fields because no current engine/client consumer uses them; availability is
preserved in the audit.

### Room mapping

IDs use `tile.<snake_case_name>`. Legacy directions map as follows:

```text
topDoor    -> n
rightDoor  -> e
bottomDoor -> s
leftDoor   -> w
```

The true floor booleans become the `floors` array in stable order:
`basement`, `ground`, `upper`.

Discovery symbols use `eventCard`, then `itemCard`, then `omenCard`. Vault is
explicitly normalized to `event`; its item icons are the reward for opening
the room, not another discovery symbol.

The two image-only rooms are explicit, reviewed constants:

```text
Collapsed Room:
  floors = [ground, upper]
  doors = n/e/s/w
  symbol = event

Mystic Elevator:
  floors = [basement, ground, upper]
  doors = n/e/s/w
  symbol = null
```

If a future source JSON supplies either room, duplicate-name validation must
fail rather than silently preferring one source.

Only currently representable permanent connections are migrated:

- Grand Staircase -> Upper Landing (`to_tile`, two-way)
- Stairs from Basement -> Foyer (`to_tile`, two-way)

Coal Chute is explicitly not encoded as `oneway_drop`: the existing graph edge
would charge an extra movement point, make the slide optional, and permit an
explorer to end in Coal Chute. Its mandatory immediate slide must wait for a
future forced-entry transition that treats entry plus landing as one space.
Mystic Elevator movement, Collapsed Room falling, crossing checks, end-turn
effects, and once-per-game room rewards likewise remain documented as
unimplemented. Encoding those rules as always-active links or `onEnter`
effects would be incorrect.

### Starting house

The house contains five pre-placed semantic nodes with Entrance Hall as the
start tile and the three declared floor landings. Coordinates/rotations must
form a connected ground-floor starting tile under the existing
`rotateDoors()` semantics and preserve the two special stair links.

## Tests and acceptance

Unit tests use small inline legacy fixtures, never the sibling reference repo,
so a clean clone remains testable. Tests must prove:

- track conversion preserves all eight playable values and the start index;
- all six colour pairs map correctly;
- direction, floor, and symbol conversion is correct;
- Vault has one `event` symbol;
- the two image-only base rooms are present and Panic Room is absent;
- the two supported staircase connections have the correct directionality and
  Coal Chute has no executable static link;
- malformed legacy records fail with useful paths/messages;
- repeated migration produces byte-equivalent data;
- the migrated target passes `ContentFileSchema` and `buildContent`.

The local full-source migration must produce exactly 12 characters, 47 total
semantic tiles, 42 drawable tiles, and 5 starting placements. Runtime
verification uses `CONTENT_DIR=content` and must show the server loading real
content rather than placeholders. Typecheck, lint, formatting check, all tests,
build, production startup, development startup, `/healthz`, and `/api/content`
must pass before either phase is reported complete.

A migrated-content engine smoke must also start a three-player game and prove
the real starting layout's ordinary adjacency plus both staircase directions
through `getConnections`. Endpoint counts alone do not prove that players can
explore the migrated board.

## Explicit non-goals

- No official content or artwork committed to Git.
- No card, inventory, haunt, dice, damage, or room-rule implementation.
- No edition API or `content/2e/` runtime restructure before its later phase.
- No UI redesign; existing lobby and board already visualize character and
  room names, colours, floors, doors, symbols, and movement.
- No modification of any reference repository.
