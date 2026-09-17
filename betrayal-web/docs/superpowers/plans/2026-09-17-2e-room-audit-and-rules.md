# 2E Room Audit and Rule Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use systematic debugging and test-driven development. Work through every checkbox in order; do not infer that authored text or a visual log means a rule is implemented.

**Goal:** Restore a faithful, playable 2E baseline for rooms, floor discovery, Haunt books, companion control, and traitor-controlled monster turns, with visible rules and deterministic server authority.

**Architecture:** Keep the server-authoritative reducer, deterministic RNG, effect interpreter, legal-action selector, and presentation queue as the single gameplay path. Extend existing tile content and reducer hooks only where the verified rule cannot be expressed today. Never implement an exit, crossing, or end-turn rule by putting it in `onEnter`.

**Tech Stack:** TypeScript, Zod content schemas, deterministic reducer/effect interpreter, Vitest, React/Vite client.

**Spec:** Primary rules are the user-supplied PDFs in `../2E book/`: the 2E Rulebook, Secrets of Survival, and Traitor's Handbook. Local room/card images and `../betrayal-grapesalad-legacy/game-data.json` are secondary structured evidence. When legacy data conflicts with the supplied 2E Rulebook, the PDF wins. User-confirmed house rules (global room rewards and discovery-time resolution described below) override the PDF only where explicitly stated.

## Global Constraints

- Modify only `betrayal-web/`; all sibling repositories are read-only evidence.
- Do not run `npm audit fix`.
- Do not alter unrelated gameplay. Card, Haunt, companion, monster, combat, discovery, and UI changes are allowed only where this plan explicitly requires them.
- Preserve deterministic server-authoritative state, replay/reconnect behavior, ESM build, production start, and `MIN_PLAYERS = 1` development setting.
- Use TDD: add the smallest behavior test, run it and record the expected failure, then implement and rerun it.
- Do not silently substitute a different trait loss, automatically choose physical/mental damage, or change a timing hook for implementation convenience.
- Every special rule must produce visible, understandable feedback; no overlapping presentation or hidden state-only result.
- Every tile with a mechanical rule must carry concise player-facing `ruleText` (or the repository's equivalent single source of truth) and render it in the room UI. A log line alone does not satisfy this requirement.
- User-approved discovery shortcut: revealing a new room with a card ends movement and may resolve that room's end-turn hook immediately after the blocking card/effect pipeline. Mark the hook resolved for the current turn so a later `END_TURN` action cannot apply it twice. Entering an already-revealed room does not trigger an end-turn hook unless the explorer actually ends the turn there.
- User-confirmed cadence: wording `once per game` is global to that placed room for the whole game, not once per explorer. After any player claims Chapel, Gymnasium, Library, or Larder, no player can claim that room again. Persist this on the placed tile (or equivalent game-scoped key tied to the unique tile), never in `PlayerState.flags`.
- Do not commit or push until the full verification gate passes and the controller explicitly reviews the diff.

## Authoritative room-set decision

The supplied official Rulebook lists **44 room tiles plus one physical Entrance Hall/Foyer/Grand Staircase starting tile**. The engine models the three connected sections of that physical starting tile as three logical records. Therefore the current 2E logical set is **47 records total**:

- 42 drawable room records;
- Upper Landing and Basement Landing as two separately placed starting records from the 44-room set;
- Entrance Hall, Foyer, and Grand Staircase as three logical records representing one physical starting tile.

These three logical starting records are required:

- `tile.entrance_hall`
- `tile.foyer`
- `tile.grand_staircase`

These two official base-2E rooms are image-only omissions from legacy JSON and **must remain**:

- `tile.collapsed_room`
- `tile.mystic_elevator`

Panic Room remains excluded as expansion content. Final expected count is **47 logical tile records**, **5 pre-placed logical records**, and **42 drawable room tiles**. Add exact-set/count tests so neither legacy omissions nor expansion assets silently change the deck.

## Verified legacy timing matrix

Use this matrix as acceptance criteria. A rule listed as `none` must have no fabricated mechanical effects.

| Room | Hook | Required behavior |
| --- | --- | --- |
| Stairs from Basement | static connection | Two-way link with Foyer. |
| Coal Chute | forced entry movement | Immediately move to Basement Landing when entered; the full slide counts as 1 movement space and a turn cannot end on Coal Chute. |
| Collapsed Room | first-discovery roll / later optional fall | First discoverer follows the printed Speed roll and basement placement/damage procedure. Later entrants may ignore it or intentionally fall. Preserve the Below Collapsed Room destination/token behavior. |
| Mystic Elevator | entry movement | On entry, roll/move the tile to a legal floor/door according to its printed table and once-per-turn cadence; traitor beneficial-room exception applies after the Haunt. |
| Tower | crossing | Might 3+ crosses; failure leaves explorer in Tower and ends remaining movement. |
| Gallery | optional room action | If Ballroom is placed, player may fall there and roll 1 die of physical damage. Do not offer action when Ballroom is absent. |
| Catacombs | crossing | Sanity 6+ crosses; failure leaves explorer in Catacombs and ends remaining movement. |
| Chasm | crossing | Speed 3+ crosses; failure leaves explorer in Chasm and ends remaining movement. Do not lose Speed: the legacy rule says stop moving. |
| Junk Room | exit | Might 3+ succeeds; on failure lose 1 Speed, but the requested exit still completes and movement may continue if budget remains. |
| Chapel | discovery/end turn, once globally per game | The first player to trigger it gains 1 Sanity; the placed room is then spent for everyone. |
| Gymnasium | discovery/end turn, once globally per game | The first player to trigger it gains 1 Speed; the placed room is then spent for everyone. |
| The Pentagram Chamber | exit | Knowledge 4+ succeeds; failure loses 1 Sanity, then exit completes. |
| Library | discovery/end turn, once globally per game | The first player to trigger it gains 1 Knowledge; the placed room is then spent for everyone. Ordinary entry into an already-revealed Library does not grant it. |
| Attic | exit | Speed 3+ succeeds; failure loses 1 Might, then exit completes. |
| Furnace Room | discovery/end turn, every turn spent there | Take exactly 1 physical damage after its first-discovery card pipeline or at end turn; player chooses Speed or Might. Never apply twice in one turn. |
| Graveyard | exit | Sanity 4+ succeeds; failure loses 1 Knowledge, not Sanity, then exit completes. |
| Larder | discovery/end turn, once globally per game | The first player to trigger it gains 1 Might; the placed room is then spent for everyone. |
| Crypt | discovery/end turn, every turn spent there | Take exactly 1 mental damage after its first-discovery card pipeline or at end turn; player chooses Sanity or Knowledge. Never apply twice in one turn. |
| The Vault | optional once-per-game room action | While in the unopened Vault, allow Knowledge 6+ attempt. On success mark that placed Vault opened/emptied and award the printed Item draw result verified from the local tile image; never grant fabricated Knowledge. Failed attempts follow the printed eligibility/retry wording. Do not offer the action once emptied. |
| All other verified neutral rooms | none | Card symbol and ordinary discovery only; remove fabricated `onEnter` rules from Operating Laboratory, Research Laboratory, and Gardens unless the supplied tile image proves printed mechanics. |

The crossing rule applies only when moving through the two-sided obstacle from the entry side to the other side. Returning through the doorway the explorer used to enter does not require a crossing roll. Use `PlayerState.cameFrom` plus actual board adjacency; do not infer direction from tile rotation alone.

---

### Task 1: Produce an exact room audit before editing gameplay

**Files:**
- Create: `docs/audit/2e-room-effects.md`
- Read only: `../betrayal-grapesalad-legacy/game-data.json`
- Read only: `../betrayal-grapesalad-legacy/src/assets/img/rooms/*.jpg`
- Inspect: `content/tiles.json`
- Inspect: `packages/content/fixtures/tiles.json`

- [x] Extract all 42 legacy room records, add the two official image-only rooms, and compare the resulting 44-room physical set against both current JSON copies and the supplied Rulebook's component count.
- [x] Record all current-only IDs, legacy-only names, floor/door/symbol mismatches, and every current effect not supported by the legacy source.
- [x] Inspect the local Vault image at original resolution to record only its mechanical reward/retry wording. Do the same only when the JSON wording is ambiguous; do not use Internet recollection.
- [x] Write a ledger row for every final tile with: source name, ID, deck/start status, floors, doors, symbol, hook, cadence, condition/roll, success, failure, persistence scope, implementation status, and test name.
- [x] For every special room, author a concise mechanical description that states trigger, roll/threshold, success, failure, cadence, and optionality. It must be understandable without opening the event log and must not claim unsupported behavior.
- [x] Explicitly mark Collapsed Room and Mystic Elevator as official base-2E legacy omissions, Panic Room as expansion-excluded, and the three logical sections of the physical starting tile.
- [x] Run a script/check showing the exact expected 47 logical IDs, 5 pre-placed IDs, and 42 drawable IDs.

Exit criterion: the audit contains no `unknown`, no fabricated effect, and enough evidence to write behavior tests without guessing.

### Task 2: Lock the official room set and neutral rooms with failing content tests

**Files:**
- Modify: `packages/content/src/content.test.ts`
- Modify: `content/tiles.json`
- Modify: `packages/content/fixtures/tiles.json`

- [x] Add a test that constructs the exact expected 47 logical tile IDs, asserts 5 pre-placed/42 drawable, retains `tile.collapsed_room` and `tile.mystic_elevator`, and excludes Panic Room.
- [x] Run the focused content test and record RED only for actual set/count/source discrepancies; do not manufacture a RED by asserting an incorrect set.
- [x] Add assertions that Operating Laboratory, Research Laboratory, Gardens, and every other `none` room have empty mechanical hook arrays.
- [x] Run and record RED because the three fabricated effects exist.
- [x] Preserve the two official image-only deck records, while removing all unsupported fabricated effects in both canonical content and fixture copy.
- [x] Ensure `house.layout`, `house.landings`, static-link targets, tests, and docs consistently represent the five starting logical records.
- [x] Run the content tests to GREEN and ensure content hashes/fixture equality tests pass.

Exit criterion: data contains exactly the allowed set and neutral rooms cannot silently regain made-up rules.

### Task 3: Add explicit tile rule hooks, descriptions, and validate authored data

**Files:**
- Modify: `packages/content/src/schemas.ts`
- Modify: `packages/content/src/load.ts` only if coherence checks belong there
- Modify: `packages/content/src/content.test.ts`
- Modify: both tile JSON files

- [x] Before schema edits, write failing parsing/coherence tests for the minimum required hook vocabulary: `ruleText`, `onExit`, `onEndTurn`, crossing restriction metadata, and room actions/cadence. Reuse `EffectSchema`, `UsePolicySchema`, and existing flags where they express the semantics exactly.
- [x] Reject duplicate room action IDs, crossing metadata on a tile without two appropriate exits, empty executable actions, and once-per-game declarations lacking a persistent flag key/scope.
- [x] Keep `onEnter` only for genuine entry/reveal behavior; migrate no rule into it merely because the field already exists.
- [x] Author Library/Chapel/Gymnasium/Larder end-turn effects with a tile-scoped globally spent flag; author Furnace/Crypt end-turn damage prompts; author the four exit rolls with correct failure traits; author crossing metadata for Tower/Catacombs/Chasm; author Gallery/Vault actions; represent Coal Chute as mandatory entry movement to Basement Landing rather than an optional graph edge.
- [x] Add concise `ruleText` for every special room from the timing matrix, including Stairs from Basement and Coal Chute. Add no rule text to neutral rooms. Validate that any executable room hook/action/crossing has non-empty rule text.
- [x] Ensure canonical and fixture JSON remain byte-equivalent after formatting or are generated through the repository's existing fixture sync approach.
- [x] Run focused schema/content tests to GREEN.

Exit criterion: content describes timing and cadence explicitly; the engine does not need to guess a rule from tile ID except where a narrowly documented crossing algorithm consumes authored metadata.

### Task 4: Execute discovery/end-turn hooks once before advancing the active seat

**Files:**
- Modify: `packages/engine/src/reduce.ts`
- Modify: `packages/shared/src/state.ts` only if a serializable continuation is required
- Modify: `packages/engine/src/reduce.test.ts` or create `packages/engine/src/room-effects.test.ts`
- Modify client prompt rendering only if `choose_trait` is not already fully visible/actionable

- [x] Add RED tests proving first discovery of Library resolves its Event card first, then grants exactly +1 Knowledge in the ordered presentation pipeline. A later `END_TURN` in the same turn must not grant it again.
- [x] Add RED tests proving ordinary entry into an already-revealed unused Library does not change Knowledge; ending the turn there grants exactly +1 Knowledge and marks that placed Library spent.
- [x] Add RED tests proving neither the same explorer nor a different explorer can gain from Library after it is spent. Add equivalent two-player contention tests for Chapel, Gymnasium, and Larder.
- [x] Add equivalent table-driven tests for Chapel, Gymnasium, and Larder.
- [x] Add RED tests that Furnace and Crypt resolve once after their first-discovery card pipeline, raise a restricted `choose_trait` prompt, and do not repeat on the same turn's `END_TURN`. Also test ordinary entry into an already-revealed room does nothing until `END_TURN`, then applies one point and only afterward advances the active seat.
- [x] Test prompt default/timeout, reconnect, replay, and duplicate action behavior so damage and turn advancement occur exactly once.
- [x] Implement the shared room-end hook so discovery can call it after the room's blocking card/effect pipeline and `END_TURN` can call it before cleanup/seat advancement. Persist globally spent once-per-game rewards on the placed tile. Separately persist a current-turn resolved marker for repeatable Furnace/Crypt so discovery damage cannot repeat on that turn's manual `END_TURN`. If effects suspend, persist a small explicit continuation; never advance first and patch state afterward.
- [x] Ensure once-per-game flag is written only when the reward actually resolves and remains stable across later rounds.
- [x] Run focused tests to GREEN.

Exit criterion: Library has the user-approved discovery shortcut without double application, all six end-turn rooms behave correctly on discovery and later visits, and no pending prompt belongs to a player whose turn has already advanced.

### Task 5: Execute exit rules and preserve movement continuation

**Files:**
- Modify: `packages/engine/src/reduce.ts`
- Modify: `packages/shared/src/state.ts` if a movement continuation payload is required
- Modify: `packages/engine/src/selectors.ts`
- Test: `packages/engine/src/room-effects.test.ts`

- [x] Add one table-driven RED test per exit room: Junk Room, Pentagram Chamber, Attic, Graveyard.
- [x] Assert each roll uses the current printed trait value and deterministic RNG, emits a visible `rolled` reason naming the room, and applies only the specified failure loss.
- [x] Assert successful and failed exits both reach the requested adjacent destination; failed exit does not consume extra movement beyond the ordinary move and does not end movement unless death or another existing rule does.
- [x] Assert Graveyard failure loses Knowledge and Junk failure loses Speed; these catch the two current incorrect implementations.
- [x] Implement the pre-exit hook through one serializable movement continuation. While it resolves, reject unrelated move/end-turn actions and never allow duplicate movement on reconnect/retry.
- [x] Ensure `getLegalActions` still agrees with `reduce`: a legal destination remains offered, and the resulting roll/continuation is an expected part of that legal move.
- [x] Run focused and movement property tests to GREEN.

Exit criterion: exit effects occur exactly once at the correct time without converting them into entry effects.

### Task 6: Implement crossing barriers correctly

**Files:**
- Modify: `packages/engine/src/reduce.ts`
- Modify: `packages/engine/src/movement.ts` if a shared crossing predicate belongs there
- Modify: `packages/engine/src/selectors.ts`
- Test: `packages/engine/src/room-effects.test.ts`

- [x] Add RED tests for Tower Might 3+, Catacombs Sanity 6+, and Chasm Speed 3+.
- [x] For each room, test: return through entry doorway requires no roll; attempt through opposite doorway rolls; success moves out; failure keeps location in the barrier room and sets `movesLeft = 0`.
- [x] Assert Chasm failure does not reduce Speed or any trait.
- [x] Test rotated placements and both travel directions so crossing detection uses board connections and `cameFrom`, not hard-coded north/east assumptions.
- [x] Test direct/static movement cannot bypass the restriction if it represents crossing the barrier, while unrelated links continue to work.
- [x] Implement one shared crossing predicate and deterministic roll path; emit player-readable success/failure log plus `rolled` event.
- [x] Run focused, movement, selector, invariant, and property tests to GREEN.

Exit criterion: all three barrier rooms influence route choice according to the legacy text and cannot damage traits by accident.

### Task 7: Implement Coal Chute, Gallery, and Vault room actions

**Files:**
- Modify: `packages/engine/src/reduce.ts`
- Modify: `packages/engine/src/selectors.ts`
- Modify: `packages/client/src/components/InventoryTray.tsx` or the existing action UI that displays legal room actions
- Modify: `packages/client/src/styles.css` only if existing button styling cannot be reused
- Test: engine selector/reducer tests and focused client component/store tests

- [x] Add RED tests that entering Coal Chute immediately moves the explorer to Basement Landing, the whole entry/slide costs exactly 1 movement space, card/tile feedback stays ordered, and no turn can end on Coal Chute.
- [x] Add RED tests that Gallery action is absent until Ballroom is placed, then rolls exactly 1 Betrayal die for physical damage, lets the player distribute the resulting 0-2 points across Speed/Might through the shared damage flow, and moves the actor to that placed Ballroom exactly once.
- [x] Add RED tests for Vault eligibility, Knowledge 6+ roll, drawing exactly 2 Item cards on success, tile-scoped opened/empty flag, no repeat after opening, and at most one opening attempt per turn even after failure.
- [x] Extend `getLegalActions` to emit exact `ROOM_ACTION` IDs only when eligible. Stop using the client hard-coded `interact_token` as the only room action display path; render the legal action's understandable label without inventing client authority.
- [x] Make `roomAction` dispatch by validated action ID and current tile definition, rejecting spoofed/stale IDs.
- [x] Serialize Gallery/Vault roll/damage/card feedback through the existing presentation queue.
- [x] Run focused engine and client tests to GREEN.

Exit criterion: optional rules are discoverable buttons, mandatory rules are automatic, and the UI never asks the player to infer a hidden room ability.

### Task 8: Player-visible regression journey

**Files:**
- Test: existing client/store/component suites
- Test: `packages/engine/src/room-effects.test.ts`
- Update: `docs/audit/2e-room-effects.md`

- [x] Add a deterministic journey that discovers Library, dismisses/resolves its Event card, then sees the Library effect description/feedback and observes +1 Knowledge before manual `END_TURN`.
- [x] End that same turn to prove no duplicate gain, then have both the same player and another player revisit/end there to prove the globally spent tile never grants a second reward.
- [x] Cover one exit roll, one barrier crossing failure, one end-turn damage prompt, and one optional room action in browser-level or component/store integration tests.
- [x] Add a UI test proving every special tile's concise `ruleText` is rendered when that room is current/selected, including trigger, threshold/cadence where applicable, and optional-action wording.
- [x] Assert `#root` remains mounted, card/dice/room feedback is ordered, and no hook-order/runtime exception occurs.
- [x] Update every audit row to `AUTOMATED`, `MANUAL`, or `BLOCKED`; this task is complete only when every rule in the timing matrix is `AUTOMATED` or has a concrete blocker reported to the controller before proceeding.

Exit criterion: a player can understand what triggered, why it triggered, and what changed without inspecting debug state.

### Task 9: Enforce floor eligibility, finite floor supply, card symbols, and Basement access

**Files:**
- Modify: `packages/content/src/content.test.ts`
- Modify: `packages/engine/src/discovery.ts`
- Modify: `packages/engine/src/reduce.ts`
- Modify: `packages/engine/src/movement.ts`
- Modify: `packages/engine/src/discovery.test.ts` and/or `packages/engine/src/room-effects.test.ts`
- Modify client room/deck feedback components as required
- Update: `docs/audit/2e-room-effects.md`

- [x] Build an exact floor-eligibility table for all 44 official room tiles from legacy structured backs plus local tile-image evidence. Assert every `Tile.floors` equals that table; do not broaden a room to make discovery easier.
- [x] Add a coverage report/count for rooms with `item`, `event`, `omen`, and no symbol. Explain legitimate no-card rooms in the audit so a player can distinguish an intentionally empty room from a draw bug.
- [x] Add RED tests proving first discovery of every symbol category draws exactly one matching card and ends movement, while discovery of a no-symbol room draws none and may continue movement.
- [x] Add RED tests proving a room with both a symbol and printed rule resolves in this order: place/reveal room -> reveal and fully resolve matching card -> resolve user-approved discovery-time room hook -> resume control. Never let a room effect cover or replace the card modal.
- [x] Test the official shared-stack algorithm: inspect from the top; set floor-incompatible tiles aside face down; place the first compatible tile; once the live stack is exhausted, deterministically shuffle the set-aside pile back into a new stack; preserve RNG/replay determinism.
- [x] Test floor exhaustion: if no remaining tile is eligible for the current floor, `MOVE_THROUGH` must not place an illegal tile, consume/lose a valid tile, or create a broken prompt. Return a clear player-visible `NO_ROOMS_FOR_FLOOR` result and remove/disable only that discovery doorway action.
- [x] Test that a tile placement may not seal the last discoverable doorway of a floor. Use the smallest existing placement check; if every remaining eligible tile would seal it, return actionable manual/rearrangement guidance rather than corrupting the board.
- [x] Add deterministic Basement-access tests for all official paths: entering Coal Chute forces movement to Basement Landing; Collapsed Room can create/use the Below Collapsed Room destination; Mystic Elevator can reach Basement; discovered Stairs from Basement links two-way with Foyer. Grand Staircase remains Upper Landing only.
- [x] Add a player-facing indication on unexplored Basement Landing/path state so users understand that Basement is reached through a discovered special route, not through Grand Staircase.
- [x] Run discovery, movement, property, content, and presentation tests to GREEN.

Exit criterion: no tile can be placed on an illegal floor, finite floor supply behaves exactly and visibly, every symbol draws once, and at least one deterministic test reaches Basement through each legal route.

### Task 10: Ingest all 50 role-specific Haunt book entries safely

**Files:**
- Read only: `../2E book/Betrayal 2010 - Secrets of Survival.pdf`
- Read only: `../2E book/Betrayal 2010 - Traitor's Handbook.pdf`
- Read only: `../2E book/Betrayal at House on the Hill 2nd edition Rulebook.pdf`
- Modify: `packages/content/src/schemas.ts`
- Modify: `content/haunts.json`
- Modify: `packages/content/fixtures/haunts.json`
- Modify: `packages/content/src/content.test.ts`
- Create/update: `docs/audit/2e-haunt-books.md`

- [x] Extract all 50 numbered hero entries and all applicable traitor entries from the supplied PDFs. Preserve headings and ordered/bulleted structure in a schema such as `intro`, `rightNow`, `whatYouKnow`, `winWhen`, `rules`, `specialAttackRules`, and `ifYouWin`; retain additional named sections without flattening them into one unreadable blob.
- [x] Reconcile the PDF haunt chart with current `(omen, room) -> hauntId` data and traitor selection rules. Add exact coverage tests for IDs 1 through 50, unique IDs, matching titles, and required side content. Handle no-traitor and hidden-traitor haunts explicitly instead of inventing a public traitor page.
- [x] Keep prose/manual instructions separate from `implemented` mechanical automation. Showing complete book text makes a manual Haunt playable; it must not falsely mark unimplemented win/setup logic automated.
- [x] Treat the PDFs as build-time authoring sources only. Do not add a runtime PDF parser or dependency. Generated/curated JSON must be deterministic, reviewable, schema-validated, and mirrored to fixtures.
- [x] Add an audit row per Haunt: hero page present, traitor page present/not applicable, traitor selection verified, setup automation status, monsters required, script/manual status, and tests.
- [x] Run content/schema tests to GREEN.

Exit criterion: every Haunt has the correct role-specific readable book entry and honest automation status, with no missing or swapped ID.

### Task 11: Add private Haunt briefing, readiness gate, and persistent reopen controls

**Files:**
- Modify: `packages/shared/src/actions.ts`, `packages/shared/src/protocol.ts`, and `packages/shared/src/state.ts`
- Modify: server/client redaction and WebSocket projection paths
- Modify: `packages/engine/src/reduce.ts`, `packages/engine/src/selectors.ts`, and focused tests
- Create/modify: a dedicated client Haunt briefing/book component and styles
- Modify client store/presentation tests

- [x] Write RED privacy tests before UI work: heroes receive only Secrets of Survival for the active Haunt; the traitor receives only Traitor's Tome; spectators/public `/api/content` receive neither private book body; hidden-traitor identity/content follows its Haunt rule. Never ship both books to every browser and merely hide one with CSS.
- [x] Add a server-authoritative `ACK_HAUNT_BRIEFING` action (or equivalently explicit existing action) recorded in `haunt.acknowledged`. Reject acknowledgements from nonexistent/removed seats and make duplicate acknowledgements idempotent.
- [x] On `haunt_begun`, display a full-page readable briefing for each player's role. Include Haunt number/title, role, structured sections, scrolling, keyboard/focus handling, and a clear `Ready / Close` control.
- [x] Gate ordinary gameplay until every active living participant has acknowledged their own briefing, including reconnect/default handling for removed/disconnected seats. Do not leak whether another player's private page contains a special instruction.
- [x] After close, keep a persistent side button (`Survival Book` for heroes, `Traitor Tome` for the traitor) that reopens the same page at any time without changing game state or acknowledgement.
- [x] Preserve the briefing across refresh/reconnect and ensure it does not collide with card, dice, damage, or room presentations.
- [x] Add component/store/browser tests for hero view, traitor view, close/reopen, two-player readiness, reconnect, focus trap/Escape behavior, mobile layout, and zero opposing-book text in serialized state/network frames.
- [x] Run engine/shared/server/client tests to GREEN.

Exit criterion: the Haunt starts with the correct private book experience, all players explicitly finish reading, and either side can safely reopen only its own rules.

### Task 12: Implement Dog companion control and complete monster turns

**Files:**
- Modify: card/content schemas and Dog content only where capability metadata is required
- Modify: `packages/shared/src/actions.ts`, `packages/shared/src/protocol.ts`, and `packages/shared/src/state.ts`
- Modify: `packages/engine/src/reduce.ts`, `packages/engine/src/selectors.ts`, `packages/engine/src/movement.ts`, and tests
- Modify client board/action controls and tests
- Update: `docs/audit/2e-card-actions.md` and `docs/audit/2e-haunt-books.md`

- [x] First audit companions separately: Dog is actively commanded; Girl and Madman are custody/passive companions unless their supplied card/rule explicitly grants movement. Do not make all `isCompanion` cards autonomous just because Dog is.
- [x] Add RED Dog tests for a once-per-turn command: choose an already explored reachable room up to 6 spaces away, traverse only legal Dog paths, never discover a room, never use a one-way/special passage or a room crossing that requires a roll, optionally pick up/carry/drop one eligible item, and return to its owner. Reject stale/spoofed destinations/items and prevent custody/passive bonuses from duplicating.
- [x] Model the Dog command as a server-authoritative serializable prompt/action chain with visible pawn/path/result feedback. Reconnect or repeated frames must not duplicate item transfer or consume the use twice.
- [x] Add explicit monster-phase state after the traitor explorer's turn. Post-Haunt round order must be heroes clockwise from the traitor's left -> traitor explorer turn -> traitor-controlled monster phase -> next hero round. If the traitor is dead but living controlled monsters remain, the monster phase still occurs unless the active Haunt says otherwise.
- [x] Add protocol/legal actions for selecting/starting a monster, rolling its movement once, moving it through already explored legal connections, attacking once when allowed, finishing that monster, and ending the monster phase. Only the controlling traitor connection may issue them.
- [x] Roll movement from that monster definition's Speed and guarantee at least 1 movement space even on total 0. Apply opponent leave cost, doors/stairs, Haunt-specific movement overrides, and the official rule that monsters ignore room barriers; monsters may not discover rooms.
- [x] Present living monsters as an ordered queue with current monster, rolled allowance, spent movement, attack state, and `Done with this monster`. A monster cannot act twice or be silently skipped by reconnect.
- [x] Implement normal monster attacks through the shared combat/damage flow. Do not use generic placeholder stats when the active Haunt defines exact stats. Haunt-specific attacks remain manual unless represented and audited.
- [x] Implement stun lifecycle: a newly stunned monster cannot act normally; its appropriate later monster turn clears stun according to the Rulebook/Haunt, with visible feedback. Never treat a first defeat as death when the monster can only be stunned.
- [x] Add RED/GREEN tests for authorization, turn order, movement 0 => 1, opponent slowing, barrier ignore, cannot discover, attack/damage, stun recovery, multiple-monster queue, dead traitor with living monsters, reconnect, redaction, and UI controls.
- [x] Run engine property/invariant tests plus client browser flow to GREEN.

Exit criterion: Dog is a real usable companion action, and a human traitor can visibly move/attack with every monster in a deterministic dedicated phase.

### Task 13: Full clean verification and controller handoff

**Files:** no additional feature edits unless verification exposes a reproduced defect.

- [ ] Run `node -v` and `npm -v`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`; report exact file/test counts.
- [ ] Run `npm run lint`.
- [ ] Run `npm run format:check`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check`.
- [ ] Start production on a temporary port/data directory; verify `/`, `/healthz`, `/api/content`, and WebSocket; stop it and verify the port is released.
- [ ] Start root `npm run dev`; verify client 5173, backend 8080, Vite proxy `/api/content`, WebSocket, and headless journeys for Library, floor exhaustion/Basement access, hero/traitor briefing privacy/reopen, Dog action, and a complete monster phase; stop all processes and verify both ports are released.
- [ ] Inspect `git status` and `git diff --stat`; confirm no sibling repo changed and no unrelated file is included.
- [ ] Return: root causes, exact source-vs-current discrepancies, files changed, room/Haunt/companion/monster coverage tables, RED/GREEN tests, complete command results, and any unresolved rule ambiguity. Do not commit or push.

## Self-review checklist

- Every non-empty legacy room rule appears in exactly one timing category.
- Library explicitly tests first discovery = one reward after card resolution, same-turn End Turn = no duplicate, ordinary later entry = no immediate reward, and once-per-game persistence.
- Current fabricated Operating Lab, Research Lab, and Gardens rules are removed.
- Chasm no longer loses Speed; Graveyard failure loses Knowledge; Vault no longer grants fabricated Knowledge.
- End-turn damage allows the correct trait family choice before turn advance.
- Crossing failure leaves the explorer in the barrier room and ends movement.
- `getLegalActions` and reducer acceptance remain consistent.
- Canonical and fixture tile data stay synchronized.
- Collapsed Room and Mystic Elevator remain in the official base set; Panic Room remains excluded.
- Floor eligibility and shared-stack discard/reshuffle behavior never create an illegal room.
- Hero and traitor book bodies never cross the network privacy boundary.
- Dog and monster actions are controlled by the authorized player and cannot discover rooms.
- No gameplay effect is represented only by prose or a log entry.
