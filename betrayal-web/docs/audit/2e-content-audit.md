# Betrayal 2E content audit (Phase 1)

Audit date: 2026-09-15. The structured-source counts below were reproduced
from `../betrayal-grapesalad-legacy/game-data.json`; reference repositories and
local scans are evidence only. Character and room names appear here solely as
source-to-output mapping keys; published descriptions, biographies, and
artwork remain local operator content and are not copied into this repository.

Evidence paths used: structured records are in
`../betrayal-grapesalad-legacy/game-data.json`; room images are in
`../betrayal-grapesalad-legacy/src/assets/img/rooms/`; character-card scans are
in `../betrayal-grapesalad-legacy/betrayal-clone-info/BAHOTH_character_cards_v3/`;
item and omen scans are in the same `betrayal-clone-info/` directory; and the
haunt chart and token sheet are
`Haunt_Chart_(Traitor_Tome__-_Betrayal_at_house_of_the_Hill_-_Second_Edition).pdf`
and `Betrayal_Token_Sheets (1).pdf` there. Official component totals are from
the Hasbro 2E instructions/product listing recorded in the approved design
brief.

## Status ledger

| Category                  | Evidence and count                                                                                                                          | Status             | Limitation                                                                                                       | Phase 2 decision                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Characters                | 12 records; 12 unique names; age, birthday, height, weight, hobbies, biographies, and portrait paths present in source                      | FOUND              | Current target schema has no profile or portrait consumer                                                        | Migrate names, colours, tracks, and starts only; retain profile/portrait availability in this audit   |
| Character trait tracks    | 48/48 tracks have 9 entries; all 48 start indices are integers 1–8                                                                          | FOUND              | Legacy index 0 is the skull slot                                                                                 | Convert index 0 to `null`, preserve indices 1–8 and starts                                            |
| Character colours         | Six local character-card scans show 12 explorer colours; colour is absent from JSON                                                         | NEEDS_VERIFICATION | Scan-derived pairing is not structured source data                                                               | Use the reviewed exact map below; no artwork is copied                                                |
| Structured rooms          | 42 `rooms` records: 40 drawable rooms plus Upper Landing and Basement Landing; 3 stationary records (Entrance Hall, Foyer, Grand Staircase) | FOUND              | Printed special-room effects are free text, not executable data                                                  | Migrate physical definitions and the five pre-placed semantic nodes                                   |
| Missing base room records | `collapsed-room.jpg` and `mystic-elevator.jpg` exist under the legacy room asset directory but have no JSON records                         | PARTIAL            | Image-only evidence has no doors/floors/symbol fields                                                            | Append reviewed constants for Collapsed Room and Mystic Elevator                                      |
| Panic Room                | `panic-room.jpg` exists but is not a base-set room record                                                                                   | PARTIAL            | Expansion/evidence asset is outside this migration scope                                                         | Exclude from output and document as expansion evidence                                                |
| Room asset paths          | Every JSON room `src` resolves under `../betrayal-grapesalad-legacy/src/`; 48 room image files are present                                  | FOUND              | Assets are copyrighted local evidence                                                                            | Record paths only; do not copy artwork                                                                |
| Discovery flags           | 18 `eventCard`, 5 `itemCard`, 13 `omenCard` booleans across structured rooms                                                                | PARTIAL            | Vault has both event and item flags; its scan shows one Event discovery symbol and two printed Item reward icons | Use one `event` symbol for Vault; treat the item flag as a reward note, not a second discovery symbol |
| Special room text         | 18 structured records contain non-null legacy `text`; 2 image-only rooms add printed rules                                                  | PARTIAL            | Target supports discovery `onEnter` and static links, not forced entry, cross/exit/end-turn/once-per-game hooks  | Migrate only the two staircase links; retain Coal Chute and all other rules as findings               |
| Events                    | 25 structured event cards / 45 official base-set cards                                                                                      | PARTIAL            | No Phase 2 card schema or runtime deck                                                                           | Defer card migration to a later master-plan phase                                                     |
| Items                     | 0 structured item cards / 22 official cards; local scans exist                                                                              | MISSING            | Scan evidence is not structured data                                                                             | Defer item data and assets; do not infer from room flags                                              |
| Omens                     | 8 structured omen cards / 13 official cards                                                                                                 | PARTIAL            | No Phase 2 card schema or runtime deck                                                                           | Defer omen migration                                                                                  |
| Haunts                    | 1 structured haunt / 50 official haunts                                                                                                     | PARTIAL            | No structured haunt matrix; chart PDF is local evidence                                                          | Defer haunt content and chart parsing                                                                 |
| Haunt chart               | `../betrayal-grapesalad-legacy/betrayal-clone-info/Haunt_Chart_(Traitor_Tome__-_Betrayal_at_house_of_the_Hill_-_Second_Edition).pdf` exists | PARTIAL            | No structured matrix                                                                                             | Inventory only                                                                                        |
| Tokens                    | Local token sheet PDF exists; no structured manifest                                                                                        | PARTIAL            | Counts cannot be validated from the target schema                                                                | Defer token manifest; official total is 149                                                           |

## Field-coverage matrix

The evidence class is deliberately separate from the implementation status:
`STRUCTURED` means a JSON field exists, `PROSE_ONLY` means the value is text
that has not been parsed into executable fields, `SCAN_OR_PDF_ONLY` means the
evidence is local artwork or a document, and `MISSING` means no source record
was found.

| Domain        | Field/evidence                                                                    |                                Count | Evidence class           | Status             | Migration decision                                               |
| ------------- | --------------------------------------------------------------------------------- | -----------------------------------: | ------------------------ | ------------------ | ---------------------------------------------------------------- |
| Characters    | name                                                                              |                                12/12 | STRUCTURED               | FOUND              | Migrate as `char.<snake_case>`                                   |
| Characters    | age, birthday, height, weight, hobbies                                            |                           12/12 each | STRUCTURED               | FOUND              | Preserve in audit; current schema has no consumer                |
| Characters    | `bio`, `bio2`                                                                     |                           12/12 each | STRUCTURED / PROSE_ONLY  | FOUND              | Preserve in audit; do not copy prose into runtime content        |
| Characters    | portrait `src`                                                                    |                                12/12 | STRUCTURED → local asset | FOUND              | Record path only; do not copy artwork                            |
| Characters    | speed, might, sanity, knowledge tracks                                            |                                48/48 | STRUCTURED               | FOUND              | Migrate all nine slots; index 0 becomes `null`                   |
| Characters    | four `initialIndex` starts                                                        |                                48/48 | STRUCTURED               | FOUND              | Migrate to `start`; all are 1–8                                  |
| Characters    | colour                                                                            |        12/12 inferred from six scans | SCAN_OR_PDF_ONLY         | NEEDS_VERIFICATION | Use the reviewed pair map below; retain source-level uncertainty |
| Events        | `event`, `flavor`, `description`                                                  |                           25/25 each | STRUCTURED / PROSE_ONLY  | FOUND              | Defer card migration; no Phase 2 runtime deck                    |
| Events        | optional trait hints: speed/might/sanity/knowledge                                |      3/25, 1/25, 10/25, 6/25 present | STRUCTURED               | PARTIAL            | Inventory only; booleans are not roll thresholds or effects      |
| Events        | stable IDs, parsed effects, rolls, outcomes                                       |                                 0/25 | MISSING                  | MISSING            | Later card schema must define these before migration             |
| Events        | discard, once-per-turn, attack, inventory/trade/drop restrictions                 | 0 structured; descriptions available | PROSE_ONLY               | PARTIAL            | Keep as later prose/rules extraction work                        |
| Items         | structured records and IDs                                                        |                        0/22 official | MISSING                  | MISSING            | Do not infer items from room flags                               |
| Items         | card scans, fronts, backs                                                         |        two front sets plus back scan | SCAN_OR_PDF_ONLY         | PARTIAL            | Local evidence only; later transcription pipeline                |
| Omens         | `omen`, `flavor`, `description`                                                   |                             8/8 each | STRUCTURED / PROSE_ONLY  | FOUND              | Defer card migration; no Phase 2 runtime deck                    |
| Omens         | `companion`, `weapon` hints                                                       |      8/8 fields; true on 3/8 and 1/8 | STRUCTURED               | PARTIAL            | Inventory only; not executable inventory/use rules               |
| Omens         | stable IDs, effects, use/discard/trade/drop rules                                 |                       0/8 structured | PROSE_ONLY / MISSING     | PARTIAL            | Later card schema and rules extraction                           |
| Haunts        | `haunt`, `flavor`, `whatYouKnow`, `youWinWhen`, `how`, `ifYouWin`                 |                             1/1 each | STRUCTURED / PROSE_ONLY  | FOUND              | Preserve as audit evidence; defer runtime haunt content          |
| Haunts        | chart key, traitor selection, hero/traitor split, monsters, tokens, win condition |                       0/1 structured | MISSING                  | PARTIAL            | Parse only in a later haunt phase                                |
| Haunt chart   | local Traitor Tome chart PDF                                                      |                                1 PDF | SCAN_OR_PDF_ONLY         | PARTIAL            | Inventory only; no structured matrix                             |
| Tokens        | official total                                                                    |                                  149 | SCAN_OR_PDF_ONLY         | PARTIAL            | Acceptance count only                                            |
| Tokens        | token-sheet PDF and counter index                                                 |                        1 PDF + 1 XLS | SCAN_OR_PDF_ONLY         | PARTIAL            | Build a later structured manifest; do not copy scans             |
| Tokens/assets | per-token IDs/categories/effects and asset manifest                               |                                    0 | MISSING                  | MISSING            | Defer token and asset pipeline                                   |

Known source defect: Peter Akimoto's source height is the literal typo
`4f11n`; it is flagged here rather than silently corrected. Known room defect:
Vault has both `eventCard` and `itemCard`, but the local scan shows one Event
discovery symbol and two printed Item reward icons. The converter therefore
normalizes Vault to one `event` symbol and leaves the reward/opening rule
deferred.

## Per-room evidence ledger

All 45 structured records below resolve their `src` under
`../betrayal-grapesalad-legacy/src/`; the two image-only records use the local
room-image paths named below. Doors use the target direction names `n/e/s/w`.
`start` means a pre-placed semantic node; `deck` means a drawable definition.
`FOUND` means physical fields are represented; `PARTIAL` means a printed rule
or source gap remains deferred. No printed descriptions or artwork are copied.

| Room                  | Source/asset identity              | Floors                  | Doors   | Symbol | Placement | Special-rule disposition                                                                                                          | Output ID                    | Status  |
| --------------------- | ---------------------------------- | ----------------------- | ------- | ------ | --------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------- |
| Entrance Hall         | `static-entrance-hall.jpg`         | ground                  | n,s,w   | —      | start     | none                                                                                                                              | `tile.entrance_hall`         | FOUND   |
| Foyer                 | `static-foyer.jpg`                 | ground                  | n,e,s,w | —      | start     | none                                                                                                                              | `tile.foyer`                 | FOUND   |
| Grand Staircase       | `static-grand-staircase.jpg`       | ground                  | w       | —      | start     | supported two-way link to Upper Landing                                                                                           | `tile.grand_staircase`       | FOUND   |
| Servant's Quarters    | `servants-quarters.jpg`            | basement, upper         | n,e,s,w | omen   | deck      | none                                                                                                                              | `tile.servants_quarters`     | FOUND   |
| Storeroom             | `storeroom.jpg`                    | basement, upper         | n       | item   | deck      | none                                                                                                                              | `tile.storeroom`             | FOUND   |
| Operating Laboratory  | `operating-laboratory.jpg`         | basement, upper         | e,s     | event  | deck      | none                                                                                                                              | `tile.operating_laboratory`  | FOUND   |
| Research Laboratory   | `research-laboratory.jpg`          | basement, upper         | n,s     | event  | deck      | none                                                                                                                              | `tile.research_laboratory`   | FOUND   |
| Stairs from Basement  | `basement-stairs.jpg`              | basement                | n,s     | —      | deck      | supported two-way link to Foyer                                                                                                   | `tile.stairs_from_basement`  | FOUND   |
| Underground Lake      | `underground-lake.jpg`             | basement                | n,e     | event  | deck      | none                                                                                                                              | `tile.underground_lake`      | FOUND   |
| Wine Cellar           | `wine-cellar.jpg`                  | basement                | n,s     | item   | deck      | none                                                                                                                              | `tile.wine_cellar`           | FOUND   |
| Balcony               | `balcony.jpg`                      | upper                   | n,s     | omen   | deck      | none                                                                                                                              | `tile.balcony`               | FOUND   |
| Master Bedroom        | `master-bedroom.jpg`               | upper                   | n,w     | omen   | deck      | none                                                                                                                              | `tile.master_bedroom`        | FOUND   |
| Bedroom               | `bedroom.jpg`                      | upper                   | e,w     | event  | deck      | none                                                                                                                              | `tile.bedroom`               | FOUND   |
| Coal Chute            | `coal-chute.jpg`                   | ground                  | n       | —      | deck      | deferred mandatory immediate slide; current `oneway_drop` would be optional, cost an extra space, and allow resting in Coal Chute | `tile.coal_chute`            | PARTIAL |
| Gardens               | `gardens.jpg`                      | ground                  | n,s     | event  | deck      | none                                                                                                                              | `tile.gardens`               | FOUND   |
| Ballroom              | `ballroom.jpg`                     | ground                  | n,e,s,w | event  | deck      | none                                                                                                                              | `tile.ballroom`              | FOUND   |
| Dining Room           | `dining-room.jpg`                  | ground                  | n,e     | omen   | deck      | none                                                                                                                              | `tile.dining_room`           | FOUND   |
| Patio                 | `patio.jpg`                        | ground                  | n,s,w   | event  | deck      | none                                                                                                                              | `tile.patio`                 | FOUND   |
| Kitchen               | `kitchen.jpg`                      | basement, ground        | n,e     | omen   | deck      | none                                                                                                                              | `tile.kitchen`               | FOUND   |
| Abandoned Room        | `abandoned-room.jpg`               | basement, ground        | n,e,s,w | omen   | deck      | none                                                                                                                              | `tile.abandoned_room`        | FOUND   |
| Conservatory          | `conservatory.jpg`                 | ground, upper           | n       | event  | deck      | none                                                                                                                              | `tile.conservatory`          | FOUND   |
| Charred Room          | `charred-room.jpg`                 | ground, upper           | n,e,s,w | omen   | deck      | none                                                                                                                              | `tile.charred_room`          | FOUND   |
| Bloody Room           | `bloody-room.jpg`                  | ground, upper           | n,e,s,w | item   | deck      | none                                                                                                                              | `tile.bloody_room`           | FOUND   |
| Organ Room            | `organ-room.jpg`                   | basement, ground, upper | s,w     | event  | deck      | none                                                                                                                              | `tile.organ_room`            | FOUND   |
| Statuary Corridor     | `statuary-corridor.jpg`            | basement, ground, upper | n,s     | event  | deck      | none                                                                                                                              | `tile.statuary_corridor`     | FOUND   |
| Creaky Hallway        | `creaky-hallway.jpg`               | basement, ground, upper | n,e,s,w | —      | deck      | none                                                                                                                              | `tile.creaky_hallway`        | FOUND   |
| Dusty Hallway         | `dusty-hallway.jpg`                | basement, ground, upper | n,e,s,w | —      | deck      | none                                                                                                                              | `tile.dusty_hallway`         | FOUND   |
| Game Room             | `game-room.jpg`                    | basement, ground, upper | n,s,w   | event  | deck      | none                                                                                                                              | `tile.game_room`             | FOUND   |
| Tower                 | `tower.jpg`                        | upper                   | e,w     | event  | deck      | deferred crossing Might 3+ rule                                                                                                   | `tile.tower`                 | PARTIAL |
| Gallery               | `gallery.jpg`                      | upper                   | n,s     | omen   | deck      | deferred optional fall and physical damage rule                                                                                   | `tile.gallery`               | PARTIAL |
| Catacombs             | `catacombs.jpg`                    | basement                | n,s     | omen   | deck      | deferred crossing Sanity 6+ rule                                                                                                  | `tile.catacombs`             | PARTIAL |
| Chasm                 | `chasm.jpg`                        | basement                | e,w     | —      | deck      | deferred crossing Speed 3+ rule                                                                                                   | `tile.chasm`                 | PARTIAL |
| Junk Room             | `junk-room.jpg`                    | basement, ground, upper | n,e,s,w | omen   | deck      | deferred exit Might 3+ / Speed loss rule                                                                                          | `tile.junk_room`             | PARTIAL |
| Chapel                | `chapel.jpg`                       | ground, upper           | n       | event  | deck      | deferred once-per-game end-turn Sanity reward                                                                                     | `tile.chapel`                | PARTIAL |
| Gymnasium             | `gymnasium.jpg`                    | basement, upper         | e,s     | omen   | deck      | deferred once-per-game end-turn Speed reward                                                                                      | `tile.gymnasium`             | PARTIAL |
| The Pentagram Chamber | `pentagram-chamber.jpg`            | basement                | e       | omen   | deck      | deferred exit Knowledge 4+ / Sanity loss rule                                                                                     | `tile.the_pentagram_chamber` | PARTIAL |
| Library               | `library.jpg`                      | ground, upper           | s,w     | event  | deck      | deferred once-per-game end-turn Knowledge reward                                                                                  | `tile.library`               | PARTIAL |
| Attic                 | `attic.jpg`                        | upper                   | s       | event  | deck      | deferred exit Speed 3+ / Might loss rule                                                                                          | `tile.attic`                 | PARTIAL |
| Furnace Room          | `furnace-room.jpg`                 | basement                | n,s,w   | omen   | deck      | deferred end-turn physical damage rule                                                                                            | `tile.furnace_room`          | PARTIAL |
| Graveyard             | `graveyard.jpg`                    | ground                  | s       | event  | deck      | deferred exit Sanity 4+ / Knowledge loss rule                                                                                     | `tile.graveyard`             | PARTIAL |
| Larder                | `larder.jpg`                       | basement                | n,s     | item   | deck      | deferred once-per-game end-turn Might reward                                                                                      | `tile.larder`                | PARTIAL |
| Crypt                 | `crypt.jpg`                        | basement                | n       | event  | deck      | deferred end-turn mental damage rule                                                                                              | `tile.crypt`                 | PARTIAL |
| The Vault             | `vault.jpg`                        | basement, upper         | n       | event  | deck      | deferred Knowledge 6+ opening and printed Item rewards                                                                            | `tile.the_vault`             | PARTIAL |
| Upper Landing         | `upper-landing.jpg`                | upper                   | n,e,s,w | —      | start     | none                                                                                                                              | `tile.upper_landing`         | FOUND   |
| Basement Landing      | `basement-landing.jpg`             | basement                | n,e,s,w | —      | start     | none                                                                                                                              | `tile.basement_landing`      | FOUND   |
| Collapsed Room        | `collapsed-room.jpg` (image-only)  | ground, upper           | n,e,s,w | event  | deck      | deferred collapse/falling rule                                                                                                    | `tile.collapsed_room`        | PARTIAL |
| Mystic Elevator       | `mystic-elevator.jpg` (image-only) | basement, ground, upper | n,e,s,w | —      | deck      | deferred elevator movement rule                                                                                                   | `tile.mystic_elevator`       | PARTIAL |

Panic Room (`panic-room.jpg`) is intentionally excluded as expansion evidence;
it has no output ID and is not part of the 2E base-set ledger.

## Character colour evidence

The JSON has no colour field. The six local character-card scans are the
source-level evidence for this reviewed mapping:

```text
purple: Heather Granville, Jenny LeClerc
red: Ox Bellows, Darrin Flash Williams
blue: Vivian Lopez, Madame Zostra
yellow: Missy Dubourde, Zoe Ingstrom
green: Peter Akimoto, Brandon Jaspers
white: Professor Longfellow, Father Rhinehardt
```

Every source character has one local portrait path. Phase 2 intentionally does
not copy portraits or extend `CharacterSchema`, because no current client or
engine consumer uses profile fields.

## Room rule findings

The source contains 18 structured non-null room texts: two faithfully
representable staircase links and 16 deferred rules. Collapsed Room and Mystic
Elevator add two image-only printed rules, for 20 reviewed special-room rules.
Current content can represent discovery-time `onEnter` effects and permanent
static links, but does not have safe hooks for crossing checks, exit checks,
end-turn effects, once-per-game rewards, or context-sensitive movement. Coal
Chute is deferred with the same honesty: its mandatory immediate slide cannot
be represented by the current optional `oneway_drop` graph edge. The remaining
deferred rules are therefore not falsely executable.

The only links migrated now are the representable permanent connections:

- Grand Staircase → Upper Landing (`to_tile`, two-way).
- Stairs from Basement → Foyer (`to_tile`, two-way).

## Official component counts used as acceptance evidence

The official Hasbro 2E instructions/product listing give these base-set totals:

- [Hasbro 2E instructions and product page](https://instructions.hasbro.com/en-ca/instruction/avalon-hill-betrayal-at-house-on-the-hill-second-edition-cooperative-board-game-for-ages-12-and-up-for-3-6-players)
- [Hasbro 2E rulebook PDF](https://www.hasbro.com/common/documents/60D52426B94D40B98A9E78EE4DD8BF94/38E7C8028AA2455CBE6D25E68FF9C18E.pdf)
- [Hasbro Widow's Walk product page used to classify Panic Room as expansion evidence](https://instructions.hasbro.com/en-us/instruction/betrayal-at-house-on-the-hill-widows-walk-board-game)

```text
44 ordinary room tiles + 1 combined Entrance Hall/Foyer/Grand Staircase tile
13 Omen cards
22 Item cards
45 Event cards
50 Haunts
149 tokens
```

The source has 42 room records plus three stationary records. The two ordinary
landings are semantic starting nodes, and the combined stationary tile is
represented as three semantic nodes. The correct engine shape is therefore:

```text
42 drawable tiles + 5 pre-placed semantic tiles = 47 semantic tile definitions
```

## Phase 2 migration decisions

Phase 2 migrates only characters and physical room definitions. The pure
converter appends the two reviewed image-only base rooms in stable order,
rejects a future duplicate source record, and excludes Panic Room. Generated
real content is written only under gitignored `content/`. Cards, haunt content,
tokens, and unsupported special-room behaviour remain for later master-plan
phases; the audit is an evidence ledger, not an implementation of those rules.
