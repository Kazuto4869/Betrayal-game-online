# Phase 3–4 dice, traits, death, and deck design audit

Date: 2026-09-15

## Executive judgment

The GMT chain is **partially coherent but not implementation-ready without a
small rules/design correction pass**. The architecture already has the right
means—pure reduction, in-state seeded RNG, index-based traits, public
discard/in-play zones, and subtractive redaction—but several current tools do
not yet support the master-plan goals faithfully.

The critical defect is concrete: the existing generic `trait` effect kills an
explorer during `explore`, while official 2E rules say that before the haunt a
trait stops at its lowest numbered slot and nobody can die. Phase 4 is mostly
state scaffolding; the six requested deck verbs have no agreed contracts, card
decks remain empty, and `DeckState` has no `removed` zone.

## Evidence and authority

Priority used in this review:

1. Master plan Phase 3 and 4
   (`../Plan/BETRAYAL_2E_FIRST_3E_READY_MASTER_PLAN.md:531-624`), with full card
   content explicitly assigned to Phase 7 (`:720-739`).
2. Official Hasbro 2E rulebook: [publisher PDF](https://www.hasbro.com/common/documents/60D52426B94D40B98A9E78EE4DD8BF94/38E7C8028AA2455CBE6D25E68FF9C18E.pdf),
   especially rules pages 5, 10–13, 15, and 19.
3. Current repository documentation and executable semantics.
4. Read-only references. ALpht supplies useful examples but is incomplete and
   not rules-authoritative: its dice helper arbitrarily accepts only 0–2 dice,
   stores trait values rather than track indices, and its `returnCard` actually
   discards. PupRiku corroborates separate pre-/post-haunt phases, lethal
   checks during the haunt, `ChangeStat`, `RestoreStatToStart`, and shuffled
   depleting decks, but its implementation is in opaque Unreal `.uasset`
   files; only its README and file/commit inventory are reviewable.

## GMT map

| Goal | Means | Concrete tools | Current support |
| --- | --- | --- | --- |
| Stable authoritative numerical rules | Deterministic server-side random stream | `RngState`, `nextInt`, `rollDice`, replay/log architecture | Medium: core exists; `rollDie`, validation, and reducer/effect integration do not |
| Faithful explorer progression and vulnerability | Track-index movement with phase-aware floor/death | 9-slot content tracks, `PlayerState.traits`, selector, trait effect, death state/events | Weak: storage is right; pre-haunt death and cleanup are wrong/incomplete |
| Generic reusable card piles before full content | Pure zone transitions over IDs | `DeckState`, `DECK_KINDS`, invariant, redaction | Weak: empty scaffolding only; six operations and `removed` are absent |
| Preserve hidden deck order and replay | Server owns RNG and full piles; clients receive redacted snapshots | `redactFor`, `drawCount`, server broadcast, JSON state | Medium: draw piles/RNG are hidden; future private events/prompts need an explicit policy |
| Keep Phase 3–4 small and 3E-ready | Define mechanics now, defer published card data/effects | Placeholder fixtures and content hash | Strong direction, but current roadmap still incorrectly bundles full cards into M3 |

## Existing implementation and exact gaps

| Area | Already present | Exact gap |
| --- | --- | --- |
| Dice | Pure seeded RNG and Fisher–Yates; `rollDice` returns faces, total, and next RNG; faces are uniformly 0/1/2 (`packages/engine/src/rng.ts:14-64`) | No `rollDie`; no integer/range validation; `-1` silently rolls zero dice, `1.5` rolls two, and 9 is accepted; no rule-facing effect/action updates state RNG and emits `rolled` |
| Trait representation | Actual schemas use nine slots, skull `null` at index 0, starts 1–8; generated 2E data has 12 characters/48 tracks, all length 9; all 48 tracks contain duplicate displayed values | `docs/02` still says clamp `[0,7]`; `docs/04` and the `PlayerState` comment still describe eight slots/max 7 |
| Trait reads/UI | `traitValue` correctly resolves an index to its displayed value; current dirty UI uses it | `trait_at_least` compares the index directly to `value`, not the displayed value (`effects.ts:631-696`); its contract is ambiguous and unsafe with duplicate values |
| Trait mutation | Generic `{ e: 'trait', delta }` moves indices and caps at the track top; events carry before/after indices | It conflates gain/lose/set/heal; any negative delta may reach 0 in every phase; no input semantics for SET or HEAL |
| Death | `isDead`, `died`, dead-player legality filtering, turn-order skipping, and pawn hiding exist | Trait death leaves location, turn order, active turn, items, and omens untouched; no atomic death transition or room drop representation |
| Deck state | Three `DeckState`s exist with `draw`, `discard`, `inPlay`; initial state and redaction are wired | All are empty even after start; no card identity manifest/schema; no `removed`; no deck operator module |
| Deck invariant | Detects duplicate IDs within one deck across the three current zones | Does not include `removed`, prove membership/completeness against a card universe, reject wrong-deck IDs, or detect cross-deck duplicate IDs |
| Redaction | RNG and draw IDs are removed; accurate draw counts, discards, in-play cards, traits, and inventory are public | `removed` policy is undefined; all `GameEvent`s and prompt payloads are broadcast identically to every seat |
| Content boundary | Placeholder content and hashed/loading pipeline exist; real full cards are assigned to master Phase 7 | `ContentFileSchema` and `CONTENT_PARTS` contain only characters/tiles; the card schema in `docs/04` is aspirational, not implemented |

Fresh direct reproduction against current code yielded:

```text
rollDice(-1)  -> [], total 0, RNG unchanged
rollDice(1.5) -> 2 faces, RNG advanced twice
rollDice(9)   -> 9 faces
explore + trait delta -99 -> index 0, isDead true,
                              location retained, seat retained in turnOrder
started game card decks -> all draw/discard/inPlay arrays empty
```

## Faithful Phase 3 rules

### Dice contract

Official dice are six-sided with faces `0,0,1,1,2,2`; a uniform result in
`{0,1,2}` is therefore correct. The physical game contains eight dice.

Recommended minimal API:

```ts
type DieFace = 0 | 1 | 2;

rollDie(rng: RngState): [face: DieFace, rng: RngState];
rollDice(
  rng: RngState,
  count: number,
): [faces: DieFace[], total: number, rng: RngState];
```

- `rollDice` must delegate to `rollDie` exactly `count` times.
- Accept integer counts `0..8`; reject negatives, fractions, NaN, and values
  above the physical eight-die supply without consuming RNG. If a later haunt
  explicitly needs more, its rule must define batching or a scoped exception.
- Zero dice returns `[]`, total `0`, and the identical RNG value.
- Only the engine/reducer owns the authoritative RNG. Player/client intents
  never contain faces, totals, seeds, or counters.
- A rule-facing wrapper commits the returned RNG and emits one `rolled` event
  containing faces, total, actor, and a structured/public reason. The pure
  primitive itself should not emit events.

ALpht's injectable randomness is a useful testing pattern, but its 0–2 count
limit and `Math.random` default must not be ported.

### Trait operations

All operands below are **track indices or track steps, never displayed trait
values**. This is required because every migrated 2E track contains duplicate
displayed values.

| Operation | Minimal meaning |
| --- | --- |
| `GAIN_TRAIT(trait, steps)` | Move up `steps` indices; cap at `track.length - 1`; never revive a dead explorer |
| `LOSE_TRAIT(trait, steps)` | Move down `steps`; in `explore` cap at index 1; in `haunt_reveal`/`haunt` cap at 0 and invoke death exactly once on reaching 0 |
| `SET_TRAIT(trait, index)` | Set an absolute **index**, validate it against that character's track, then apply the same pre-/post-haunt minimum/death policy; never search for a displayed value |
| `HEAL_TRAIT(trait)` | Restore that trait toward its printed starting position: set it to `max(currentIndex, startIndex)`; do not lower a trait already above start and do not revive the dead |

`HEAL_TRAIT` is a project API convention, not a general term defined by the
2E rulebook. The proposed meaning is deliberately narrow and matches the
reference's `RestoreStatToStart`; later cards needing “gain N” use GAIN, while
a resurrection must be a distinct explicit rule.

`trait_at_least` should compare the **displayed current value** via
`traitValue`, or be renamed to `trait_index_at_least`. Content authors normally
reason in printed values, so the first choice is recommended.

### Pre-haunt and post-haunt death

Official 2E is unambiguous:

- Before the haunt, nobody can die and no trait can go below its lowest
  numbered slot. In this model, `explore` has minimum index 1.
- Once the haunt begins, reaching the skull kills the explorer. Treat
  `haunt_reveal` and `haunt` as post-haunt; setup effects during reveal must not
  regain pre-haunt immunity.
- Gains stop at the track maximum in every phase.
- On death, remove the figure, leave companions in the death room for later
  custody, and drop other carried items there.

The engine needs one atomic `killExplorer` path used by trait loss, damage,
explicit kill, and concede only where concede is intentionally death-like. It
must emit `died` once, set `isDead`, set `location = null`, set movement to 0,
resolve/clear an owned prompt, remove/skip the seat in turn sequencing, and
advance the active turn safely.

The current state cannot faithfully locate dropped cards: `inPlay` says only
that a card is out of its deck, while player arrays say who holds it, and no
room-card pile exists. Therefore Phase 3 must either add a minimal public
`cardsAt: Record<PlacedId, CardId[]>`/equivalent ownership model, or explicitly
amend its acceptance scope to test death with empty inventory and defer drop
placement to Phase 7. Silently clearing inventory or leaving cards ownerless
would fail 2E fidelity.

## Recommended minimal Phase 4 deck design

The master names BURY and RETURN but does not define them. The following is a
**recommended project contract**, not a claimed official glossary. Record it
in the design before implementation.

Preserve current names to avoid a pointless migration, but add `removed`:

```ts
interface DeckState {
  draw: CardId[];     // index 0 is top; secret
  discard: CardId[];  // public; append in discard chronology
  inPlay: CardId[];   // public drawn/held/ongoing cards
  removed: CardId[];  // public cards set aside from play
  drawCount?: number; // redacted snapshots only
}
```

Pure operations on one deck:

| Operation | Exact proposed transition |
| --- | --- |
| `SHUFFLE` | Fisher–Yates only `draw`, consuming the in-state RNG; leave all other zones untouched |
| `DRAW` | Remove `draw[0]`, append it to `inPlay`, and return its ID; an empty draw is a typed failure with byte-identical state/RNG |
| `DISCARD` | Move a named card from `inPlay` to the end of `discard` |
| `BURY` | Move a named card from `inPlay` to the bottom/end of `draw` |
| `REMOVE` | Move a named card from `inPlay` to `removed` |
| `RETURN` | Move a named card from an explicit non-draw source (`discard`, `inPlay`, or `removed`) to the top/start of `draw`; BURY is the distinct bottom placement |

Every named transition must verify that the card occurs exactly once, belongs
to that deck, is in the required source, preserves unrelated order, returns a
new object/arrays, and leaves input unchanged on error. If future rules need
blind top-card removal/burial, compose internal DRAW plus the destination move
without emitting a public draw event; do not overload player-visible DRAW.

Do **not** automatically recycle discard on empty draw in Phase 4. The official
core rules reviewed specify setup shuffling and event discard but do not state
a generic card-discard refill rule; ALpht also fails an empty draw. The current
`docs/02:117-118` auto-reshuffle statement is therefore an unsupported project
ruling. If retained, label it `[RULING]` and implement it explicitly as
RETURN-all plus SHUFFLE, with deterministic tests.

To defer full content to Phase 7 while making all three decks real, add only a
placeholder **card identity manifest** sufficient to build
`Record<DeckKind, CardId[]>` at `START_GAME`: globally unique ID and deck kind,
with no published name, prose, effects, inventory flags, or artwork. Include
it in content hashing/loading and server content delivery. Full `CardSchema`,
resolution, and real Event/Item/Omen data remain Phase 7.

### Visibility contract

- Only `draw` identity/order and RNG are secret; clients receive `draw: []`
  and the exact `drawCount`.
- Base-2E actual draws are read aloud, Items/Omens are face up, and Event
  discards are public. Thus `discard`, `inPlay`, and the proposed Phase-4
  `removed` zone may be public under the restricted public-source operations
  above.
- A future “peek”, secret choice, or hidden removal is a different operation
  and requires viewer-specific pending/event redaction. It must not reuse
  public DRAW/REMOVE.
- The server currently sends the same unredacted `GameEvent[]` to every seat
  (`gateway.ts:309-316`). This is acceptable only for Phase-4 public draws.
  Phase 7 must add event/prompt redaction before any private card identity is
  introduced. Omitting a card ID only in narration is not a transport guard.

## Required tests

### Phase 3

- `rollDie`: only 0/1/2, deterministic seed, one counter step, no mutation.
- `rollDice`: counts 0, 1, and 8; total equals face sum; exactly N counter
  steps; reject `-1`, fractions, NaN, and 9 without consuming RNG.
- Reducer/effect integration: client supplies no result; committed RNG and
  `rolled` event replay byte-identically; redacted snapshots contain no RNG.
- All character tracks are nine slots and starts are valid; initialization
  uses the content index.
- GAIN/LOSE cap correctly; a one-step change across duplicate printed values
  changes the index even when the displayed number is unchanged.
- SET targets index, rejects invalid index, and cannot bypass phase minimum.
- HEAL restores below-start to start, is a no-op above start, and never
  revives death.
- Pre-haunt loss/damage stops at 1 and emits no death; `haunt_reveal` and
  `haunt` reach 0 and emit one death.
- Death is atomic: location/pawn, movement, prompt, active turn, turn order,
  inventory ownership/drop representation, invariants, and replay.
- `trait_at_least` tests a character where index order and duplicate displayed
  values would expose an index/value mix-up.

### Phase 4

- Each of the six operators' exact source/destination/order contract,
  immutability, wrong-source/unknown/wrong-deck/duplicate rejection.
- SHUFFLE is a permutation, deterministic, consumes the expected RNG stream,
  and touches only draw.
- Empty DRAW fails without state/RNG change; no implicit discard recycling.
- Random/property sequence across all operations preserves the original card
  multiset and exactly-one-zone invariant including `removed`.
- Three independent Event/Item/Omen decks initialize and shuffle at game
  start from placeholder manifests; seed/replay/recovery reproduce them.
- Content rejects duplicate IDs and deck-kind mismatches; server/client hashes
  include the manifest.
- Redaction hides every draw ID and RNG for every viewer, preserves counts,
  exposes only approved public zones, and does not mutate server state.
- Public DRAW events may reveal their ID; a planted private-event/prompt test
  must fail until Phase 7 adds viewer-specific transport redaction.

## Dirty-worktree warning

`packages/shared/src/protocol.ts:20` is currently changed from
`MIN_PLAYERS = 3` to `1`, and `reduce.test.ts` was changed to assert a solo
start. Lobby copy now derives from that constant. This directly conflicts with
the approved 3–6-player architecture, the master-plan baseline, official 2E
player count, and `docs/09-roadmap.md:195-196`, which explicitly rejects even
two-player support because haunts break.

The trait/movement rail UI changes are directionally compatible with Phase 3,
but they are unrelated dirty work and have no bearing on the engine rules
audit. Do not silently absorb, revert, or use them to justify Phase 3
completion. Before Phase 3–4 is accepted, restore the shared minimum and the
three-player rejection test, or move solo startup behind an explicit
non-production debug/test harness that cannot alter normal protocol legality.

## Risks and priority

1. **Critical — contradictory death tool:** current pre-haunt trait loss can
   kill, breaking the central Phase-3 goal and player survival loop.
2. **Major — incomplete death transition:** an explorer can be marked dead
   while still located, active, in turn order, and holding cards.
3. **Major — undefined deck verbs:** different plausible RETURN/BURY meanings
   would make tests and later card content disagree. Approve the contract
   first.
4. **Major — baseline drift:** `MIN_PLAYERS = 1` invalidates the approved
   social/player GMT and future haunt assumptions.
5. **Major — documentation drift:** `[0,7]`/eight-slot text contradicts the
   actual nine-slot schema; M3 roadmap scope conflicts with master Phase 7.
6. **Medium — hidden information:** snapshot redaction is sound for public
   base draws, but unredacted events/prompts are a known Phase-7 trap.
7. **Medium — movement budget coupling:** decide before card integration
   whether a mid-turn Speed change adjusts remaining movement. Current state
   stores only `movesLeft`, not spaces already spent; most discovery draws end
   movement, but later item effects can expose the ambiguity.

## PASS criteria

Phase 3 passes only when the dice contracts are validated and reducer-owned,
all four trait operations have the index semantics above, official pre-/post-
haunt death behavior is tested, death cleanup has an honest inventory scope,
index/value documentation is synchronized, and the 3–6-player baseline is
restored or isolated from debug mode.

Phase 4 passes only when all six pure operations use an approved exact
contract, `removed` and the exactly-one-zone invariant exist, three placeholder
identity decks initialize deterministically, empty-draw behavior is explicit,
redaction tests cover every zone and viewer, replay/recovery are stable, and
no full published card content or premature Phase-7 rule interpreter work is
introduced.

Under GMT, this is the smallest coherent path: Phase 3 supplies trustworthy
numerical and mortality tools; Phase 4 supplies deterministic, privacy-safe
card containers; Phase 7 later supplies the content and complex effects that
give those tools meaning.
