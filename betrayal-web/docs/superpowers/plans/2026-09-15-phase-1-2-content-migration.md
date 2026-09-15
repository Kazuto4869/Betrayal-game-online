# Phase 1–2 2E Content Audit and Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the master plan's Phase 1 content audit and Phase 2 deterministic character/room migration while preserving the repository's local-content boundary.

**Architecture:** A pure, tested converter in `@bahoth/content` validates and maps the legacy JSON into the existing `ContentFile` shape. A tiny root CLI performs filesystem I/O and writes gitignored local content; committed placeholder fixtures remain unchanged.

**Tech Stack:** TypeScript 5.7, Node 22 standard library, `tsx`, Zod 4, Vitest 4, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-15-phase-1-2-content-migration-design.md`

## Global Constraints

- Modify only `betrayal-web/`; all three sibling reference repositories are read-only.
- Preserve the existing `.js` ESM import convention and production TypeScript build.
- Preserve the existing uncommitted `tsx` development-server startup fix.
- Do not commit real 2E text, data files, scans, or artwork; generated output stays under gitignored `content/`.
- Do not modify gameplay logic or implement cards, dice, damage, inventory, room-rule hooks, haunts, or the edition API.
- Keep committed placeholder fixtures usable in a clean clone and in CI.
- Use existing schemas, `buildContent`, static-link types, and npm dependencies; add no dependency.
- Write behavioral tests first and observe the expected failure before implementation.
- Correct full-source result: 12 characters, 42 drawable tiles, 5 pre-placed semantic tiles, 47 total semantic tile definitions.
- Run all verification gates; never weaken or delete a test.

---

### Task 1: Record the Phase 1 source audit

**Files:**
- Create: `docs/audit/2e-content-audit.md`

**Interfaces:**
- Consumes: `../betrayal-grapesalad-legacy/game-data.json`, its `src/assets/img/` and `betrayal-clone-info/` files, the two other read-only reference repositories, the official Hasbro 2E component list, and the design spec.
- Produces: the evidence/status ledger that constrains Tasks 2–4.

- [ ] **Step 1: Reproduce the structured-source counts**

Run from `betrayal-web/`:

```bash
node --input-type=module -e "import fs from 'node:fs'; const d=JSON.parse(fs.readFileSync('../betrayal-grapesalad-legacy/game-data.json','utf8')); console.log({characters:d.characters.length,rooms:d.rooms.length,stationaryRooms:d['stationary-rooms'].length,events:d['event-cards'].length,items:d['item-cards']?.length??0,omens:d['omen-cards'].length,haunts:d.haunts.length})"
```

Expected literal result:

```text
characters: 12
rooms: 42
stationaryRooms: 3
events: 25
items: 0
omens: 8
haunts: 1
```

- [ ] **Step 2: Reproduce room-asset coverage**

Run:

```bash
find ../betrayal-grapesalad-legacy/src/assets/img/rooms -maxdepth 1 -type f -printf '%f\n' | sort
```

Record that all JSON room `src` values resolve and that these image files are not referenced by JSON:

```text
collapsed-room.jpg
mystic-elevator.jpg
panic-room.jpg
```

Classify Collapsed Room and Mystic Elevator as `PARTIAL` because the image is present but the structured record is missing. Classify Panic Room as excluded expansion evidence, not base-set content.

- [ ] **Step 3: Record character evidence**

Document:

- 12/12 unique names: `FOUND`.
- 12/12 age, birthday, height, weight, hobbies, biographies: `FOUND` in the source, not migrated because the current target schema has no consumer.
- 12/12 portrait paths: `FOUND`, local-only and not copied.
- 48/48 trait tracks have 9 entries and all 48 starts are integer indices 1–8: `FOUND`.
- Colour is absent from JSON but visible on six local character-card scans: `NEEDS_VERIFICATION` at source level, resolved by this exact map:

```text
purple: Heather Granville, Jenny LeClerc
red: Ox Bellows, Darrin Flash Williams
blue: Vivian Lopez, Madame Zostra
yellow: Missy Dubourde, Zoe Ingstrom
green: Peter Akimoto, Brandon Jaspers
white: Professor Longfellow, Father Rhinehardt
```

- [ ] **Step 4: Record room evidence and rule limitations**

Document:

- 40 structured drawable room records plus 2 structured landings and 3 stationary semantic rooms.
- Collapsed Room and Mystic Elevator make the drawable base set 42.
- 18 legacy `eventCard`, 5 `itemCard`, and 13 `omenCard` booleans; Vault has both `eventCard` and `itemCard`, but its scan shows one Event discovery symbol and two printed Item reward icons.
- 18 structured rooms have non-null special text: 2 faithfully representable
  staircase connections and 16 deferred structured rules. Collapsed Room and Mystic
  Elevator add 2 image-only printed rules. Current content supports
  discovery-time `onEnter` plus static links, not arbitrary
  cross/exit/end-turn/once-per-game rules.
- Grand Staircase and Stairs from Basement can be represented now.
- Coal Chute must remain unencoded: the current `oneway_drop` graph edge makes
  the slide optional, costs a second movement point, and permits ending in the
  room, while 2E requires an immediate slide with entry plus landing counting
  as one space.
- Mystic Elevator, Collapsed Room, Tower, Gallery, Catacombs, Chasm, Junk Room, Chapel, Gymnasium, Pentagram Chamber, Library, Attic, Furnace Room, Graveyard, Larder, Crypt, and Vault require later rule hooks/effects and must remain `PARTIAL` rather than falsely marked implemented.

- [ ] **Step 5: Record cards, haunts, tokens, and official counts**

Use these literal base-set totals from the official Hasbro 2E instructions/product listing:

```text
44 ordinary room tiles + 1 combined Entrance Hall/Foyer/Grand Staircase tile
13 Omen cards
22 Item cards
45 Event cards
50 Haunts
149 tokens
```

Audit decisions:

```text
Events: PARTIAL (25 structured / 45 official)
Items: MISSING structured data (0 / 22); scans exist, so assets are PARTIAL
Omens: PARTIAL (8 / 13)
Haunts: PARTIAL (1 / 50)
Haunt Chart: PARTIAL (local PDF exists, no structured matrix)
Tokens: PARTIAL (local sheet PDF exists, no structured manifest)
```

Add a field-coverage matrix for the Phase 1 checklist, not only aggregate
counts. It must record:

- Characters: 12/12 coverage for name, age, birthday, height, weight, hobbies,
  both biography fields, portrait path, all four tracks, and all starts; colour
  is scan-derived.
- Events: `event`, `flavor`, and prose `description` exist for 25/25; optional
  boolean trait hints exist but IDs, parsed effects, roll thresholds/outcomes,
  discard rules, once-per-turn rules, attack modifiers, and inventory/trade/drop
  rules are not structured.
- Items: no structured records; scans alone do not establish executable fields.
- Omens: `omen`, `flavor`, `description`, `companion`, and `weapon` exist for
  8/8; IDs and executable rule fields are not structured.
- Haunts: one record has `haunt`, `flavor`, `whatYouKnow`, `youWinWhen`, `how`,
  and `ifYouWin`; it has no structured chart key, traitor selector, hero/traitor
  rule split, monster/token definitions, or executable victory condition.
- Tokens/assets: identify available PDFs/scans and explicitly mark the absence
  of a structured token/asset manifest or per-token mapping.

Add a per-room mapping table (or an equivalently complete generated ledger)
covering every 45 structured room record plus Collapsed Room and Mystic
Elevator. For each room record its source asset, floors, doors, discovery
symbol, starting-versus-deck status, and special-rule disposition. This is the
evidence that "all rooms" were audited rather than only counted.

- [ ] **Step 6: Write the audit conclusion and Phase 2 decisions**

State explicitly:

- Phase 2 migrates only characters and physical room definitions.
- Real generated data remains local in `content/`.
- The converter adds two reviewed image-only base rooms.
- Panic Room is excluded.
- Unsupported printed room rules are inventory findings, not executable effects.
- The correct engine model is 42 drawable + 5 pre-placed = 47 semantic tiles.
- Cards, haunt content, tokens, and special room behavior remain for later master-plan phases.

- [ ] **Step 7: Review the document for evidence quality**

Check every requested audit category and field has a count/status, source path,
limitation, and migration decision. Re-run the source query and confirm the
special-text count is 18. Human prose needs no automated test.

---

### Task 2: Implement and test the pure legacy converter

**Files:**
- Create: `packages/content/src/migrate-grapesalad.ts`
- Create: `packages/content/src/migrate-grapesalad.test.ts`

**Interfaces:**
- Consumes: unknown parsed JSON matching GrapeSalad's `characters`, `rooms`, and `stationary-rooms` structures.
- Produces: `migrateGrapeSalad(source: unknown): ContentFile`.

- [ ] **Step 1: Write the first failing character-conversion test**

Create a minimal legacy fixture factory in the test file. Its Heather record must include these literal values:

```ts
const heather = {
  name: 'Heather Granville',
  speed: [{ initialIndex: 3, array: [0, 3, 3, 4, 5, 6, 6, 7, 8] }],
  might: [{ initialIndex: 3, array: [0, 3, 3, 3, 4, 5, 6, 7, 8] }],
  sanity: [{ initialIndex: 3, array: [0, 3, 3, 3, 4, 5, 6, 6, 6] }],
  knowledge: [{ initialIndex: 5, array: [0, 2, 3, 3, 4, 5, 6, 7, 8] }],
};
```

Import `migrateGrapeSalad` and assert the first output character equals:

```ts
{
  id: 'char.heather_granville',
  name: 'Heather Granville',
  colour: 'purple',
  tracks: {
    speed: [null, 3, 3, 4, 5, 6, 6, 7, 8],
    might: [null, 3, 3, 3, 4, 5, 6, 7, 8],
    sanity: [null, 3, 3, 3, 4, 5, 6, 6, 6],
    knowledge: [null, 2, 3, 3, 4, 5, 6, 7, 8],
  },
  start: { speed: 3, might: 3, sanity: 3, knowledge: 5 },
}
```

- [ ] **Step 2: Run the focused test and observe RED**

Run:

```bash
npx vitest run packages/content/src/migrate-grapesalad.test.ts
```

Expected: fail because `migrate-grapesalad.ts`/`migrateGrapeSalad` does not exist.

- [ ] **Step 3: Add the minimal legacy schemas and character converter**

In `migrate-grapesalad.ts`, use Zod already depended on by `@bahoth/content` to validate:

```ts
type TraitName = 'speed' | 'might' | 'sanity' | 'knowledge';

const LegacyTrackSchema = z.array(
  z.object({
    initialIndex: z.number().int().min(1).max(8),
    array: z.array(z.number()).length(9),
  }),
).length(1);
```

Build a `LegacyCharacterSchema` with `name` plus all four traits. Unknown profile fields remain accepted/stripped by Zod. Use one constant `COLOUR_BY_CHARACTER` containing exactly the 12 mappings in the spec. Reject an unknown character name with a message naming it.

Normalize each track with:

```ts
const [skull, ...playable] = legacy.array;
if (skull !== 0) throw new Error(`${name} ${trait} index 0 must be 0`);
return [null, ...playable];
```

- [ ] **Step 4: Run the focused test and observe GREEN**

Run the same Vitest command. Expected: the character test passes; room-related tests do not exist yet.

- [ ] **Step 5: Write failing tests for all colour pairs and source validation**

Use one table test with all 12 names and literal expected colours. Add tests proving these mutations fail:

```text
unknown character name
trait array length 8
trait array index 0 is not 0
start index 0
```

Each assertion must match the character/trait or Zod path in the thrown message.

- [ ] **Step 6: Run and observe RED, then implement the smallest validation needed**

Run the focused test after writing it and confirm the new cases fail for missing checks. Add only the source checks required by those cases and rerun until green.

- [ ] **Step 7: Write failing room-conversion tests**

The inline fixture must include Entrance Hall, Foyer, Grand Staircase, Upper Landing, Basement Landing, Stairs from Basement, Coal Chute, Vault, and one ordinary room. Assert literal outputs:

```ts
expect(vault.symbol).toBe('event');
expect(vault.doors).toEqual({ n: true, e: false, s: false, w: false });

expect(collapsed).toMatchObject({
  id: 'tile.collapsed_room',
  floors: ['ground', 'upper'],
  doors: { n: true, e: true, s: true, w: true },
  symbol: 'event',
});

expect(elevator).toMatchObject({
  id: 'tile.mystic_elevator',
  floors: ['basement', 'ground', 'upper'],
  doors: { n: true, e: true, s: true, w: true },
  symbol: null,
});
```

Also assert no tile has id `tile.panic_room`.

- [ ] **Step 8: Run and observe RED, then implement deterministic room conversion**

Implement stable floor and door mapping, `symbol`, `copies: 1`, empty `onEnter`, and the two reviewed room constants. Keep source order, then append Collapsed Room and Mystic Elevator in that order.

Before appending, reject a source record already named Collapsed Room or Mystic Elevator so a future source change is visible rather than duplicated.

- [ ] **Step 9: Write failing static-link and house-layout tests**

Assert:

```ts
expect(grandStaircase.staticLinks).toEqual([
  { kind: 'to_tile', target: 'tile.upper_landing', twoWay: true },
]);
expect(stairsFromBasement.staticLinks).toEqual([
  { kind: 'to_tile', target: 'tile.foyer', twoWay: true },
]);
expect(coalChute.staticLinks).toEqual([]);
expect(mysticElevator.staticLinks).toEqual([]);
expect(result.house.startTile).toBe('tile.entrance_hall');
expect(result.house.layout).toHaveLength(5);
expect(result.house.landings).toEqual({
  basement: 'tile.basement_landing',
  ground: 'tile.entrance_hall',
  upper: 'tile.upper_landing',
});
```

Use `buildContent(result, 'migration-test')` here for schema/coherence. Do not
import the engine into the content package or duplicate rotation math; the
real-content engine smoke in Task 4 proves traversability at the correct layer.

- [ ] **Step 10: Run and observe RED, then implement the house and links**

Use the existing five-node coordinate pattern from committed fixture content.
Choose the Grand Staircase rotation using `rotateDoors` behavior so Foyer and
Grand Staircase share a door. Do not modify movement code.

Do not emit any Coal Chute static link. Its immediate, mandatory, no-extra-cost
slide is outside the current engine vocabulary and gameplay scope.

- [ ] **Step 11: Add malformed/duplicate/determinism tests**

Write tests first for:

```text
duplicate legacy room name
room with no true floor
room with no true door
room with two discovery flags other than the explicit Vault normalization
same source migrated twice produces deeply equal output
ContentFileSchema.parse(result) succeeds
buildContent(result) succeeds and leaves pre-placed tiles out of deckTiles
```

Run to observe the new failures, add the minimal checks, then rerun the focused file until all cases pass.

- [ ] **Step 12: Run package and repository checks for Task 2**

Run:

```bash
npx vitest run packages/content/src/migrate-grapesalad.test.ts
npm run typecheck
npm run lint
```

Expected: all exit 0.

---

### Task 3: Add the local migration CLI and operator documentation

**Files:**
- Create: `scripts/migrate-grapesalad-data.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: `migrateGrapeSalad(source)` from Task 2 and CLI arguments `--source <file>` / `--output <directory>`.
- Produces: local `content/characters.json`, local `content/tiles.json`, and one concise count summary.

- [ ] **Step 1: Add a failing CLI integration check**

Before adding the script, run:

```bash
npx tsx scripts/migrate-grapesalad-data.ts --source ../betrayal-grapesalad-legacy/game-data.json --output content
```

Expected: fail because the CLI file does not exist. Record this RED evidence in the implementation report.

- [ ] **Step 2: Implement the CLI shell with Node standard library only**

Use:

```ts
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { migrateGrapeSalad } from '../packages/content/src/migrate-grapesalad.js';
```

Requirements:

- `--source` has type string and is required by an explicit check.
- `--output` has type string and defaults to `content`.
- Resolve both paths from `process.cwd()`.
- Parse source JSON once.
- Call the pure converter once.
- Create the output directory recursively only after conversion succeeds.
- Write pretty JSON with two spaces and a trailing newline.
- `characters.json` contains `{ characters: migrated.characters }`.
- `tiles.json` contains `{ tiles: migrated.tiles, house: migrated.house }`.
- On success print exactly one human-readable summary containing character,
  total-tile, drawable-tile, and starting-placement counts.
- On failure print the error message to stderr and set `process.exitCode = 1`.

- [ ] **Step 3: Add the npm script**

Add this root script without changing any existing script:

```json
"content:migrate:2e": "tsx scripts/migrate-grapesalad-data.ts"
```

- [ ] **Step 4: Document the operator flow**

Add a short README subsection under Content explaining:

```bash
npm run content:migrate:2e -- \
  --source ../betrayal-grapesalad-legacy/game-data.json \
  --output content
npm run dev
```

State that `content/` is gitignored, source references remain read-only, the
generated set covers characters/physical room definitions only, and printed
special-room behavior is not yet implemented.

- [ ] **Step 5: Run the real local migration and verify counts**

Run the documented command. Expected summary:

```text
12 characters
47 tiles
42 drawable
5 starting
```

Then run:

```bash
node --input-type=module -e "import fs from 'node:fs'; const c=JSON.parse(fs.readFileSync('content/characters.json')); const t=JSON.parse(fs.readFileSync('content/tiles.json')); console.log(c.characters.length,t.tiles.length,t.tiles.length-t.house.layout.length,t.house.layout.length)"
```

Expected:

```text
12 47 42 5
```

- [ ] **Step 6: Prove generated content stays untracked**

Run:

```bash
git status --short --ignored content
```

Expected: `content/` entries have `!!`, never `??` or staged status.

- [ ] **Step 7: Run Task 3 checks**

Run:

```bash
npm run lint
npm run format:check
npm test
```

Expected: all exit 0 and all existing tests plus the new migration tests pass.

---

### Task 4: Verify Phase 2 through the real server and client

**Files:**
- Modify only files implicated by a reproduced failure and only after adding a regression test. If no failure occurs, modify nothing.

**Interfaces:**
- Consumes: generated `content/characters.json` and `content/tiles.json` from Task 3.
- Produces: fresh command/output evidence for both phase acceptance gates.

- [ ] **Step 1: Run static verification**

Run from `betrayal-web/`:

```bash
node -v
npm -v
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

Expected: Node `v22.23.2`, npm `10.9.8`, and every command exits 0.

- [ ] **Step 2: Smoke the migrated starting board through the real engine**

After the build, load `content/characters.json` and `content/tiles.json` with
`buildContent`, then call `startedGame({ content })`. Assert all of the
following in a one-off Node ESM script using the built workspace exports:

- the scripted game has zero errors and reaches `explore`;
- all five layout entries are placed;
- Entrance Hall and Foyer are mutual `getConnections` neighbours;
- Foyer and Grand Staircase are mutual neighbours under the migrated rotation;
- Grand Staircase and Upper Landing are mutual neighbours through the migrated
  two-way `to_tile` declaration;
- after adding a valid placed Stairs from Basement node to a cloned smoke-test
  board, it and Foyer are mutual neighbours through the real migrated
  `to_tile` declaration;
- Coal Chute has no static link and is not presented as executable until a
  future forced-entry rule exists.

Use `placedIdFor`/`cellKey` from `@bahoth/shared` and `getConnections` from
`@bahoth/engine`; do not recreate direction or link logic inside the smoke.
Print the phase, placement count, and four bidirectional checks. Any false
assertion must make the command exit non-zero.

- [ ] **Step 3: Verify production startup with migrated content**

Run:

```bash
CONTENT_DIR=content npm start
```

Confirm the server binds to port 8080 and does not log `using placeholder content`.

In another shell run:

```bash
curl -i --fail http://localhost:8080/healthz
curl -i --fail http://localhost:8080/api/content
```

Acceptance:

- `/healthz` is HTTP 200 with `ok: true`.
- `/api/content` is HTTP 200 with 12 characters, 47 tiles, and the same hash reported by `/healthz`.
- Returned character names include Heather Granville and Father Rhinehardt.
- Returned tile names include Collapsed Room and Mystic Elevator and exclude Panic Room.

Stop the production process cleanly.

- [ ] **Step 4: Verify combined development mode**

Run:

```bash
CONTENT_DIR=content npm run dev
```

Confirm:

- the `tsx watch` backend remains running on port 8080;
- Vite remains running on port 5173;
- `http://localhost:5173/` returns HTTP 200;
- `http://localhost:8080/api/content` returns migrated content;
- `http://localhost:5173/api/content` proxies the identical content hash;
- no module-resolution, content-validation, WebSocket startup, or proxy error appears.

Stop both processes cleanly.

- [ ] **Step 5: Apply the systematic-debugging loop only if verification fails**

For one failure at a time:

1. Capture the full command, output, and exit code.
2. Identify the failing boundary: legacy parse, pure transform, target schema,
   content loader, engine setup, server, Vite, or proxy.
3. State one root-cause hypothesis supported by the evidence.
4. Add the smallest failing regression test.
5. Make one minimal fix.
6. Re-run the focused test, then repeat all Task 4 checks.
7. After three failed fix hypotheses, stop and report evidence rather than
   stacking a fourth speculative change.

- [ ] **Step 6: Final scope audit**

Run:

```bash
git status --short
git diff --check
git diff --stat
```

Confirm:

- no reference repository changed;
- no generated `content/` file is tracked;
- no gameplay logic changed;
- the earlier `tsx` startup fix remains present;
- all committed-source changes map directly to Phase 1 or Phase 2.
