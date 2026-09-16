# Items, dice actions, and gameplay-friction remediation plan

> Worker: AGY CLI, Gemini 3.8 Flash High. Use TDD, systematic debugging, and the
> smallest existing architecture that satisfies each rule.

## Constraints

- Modify only `betrayal-web/`.
- Keep `MIN_PLAYERS = 1` for development.
- Do not modify reference repositories, run `npm audit fix`, commit, or push.
- Do not implement new roadmap phases or rewrite the engine.
- Preserve authoritative server state, deterministic RNG, redaction, replay, and
  reconnect behavior.
- Verify a card against repository rule references before changing mechanics.
- Do not claim that authored prose equals implemented behavior.

## Task 1 — Establish a complete card-action ledger

Create `docs/audit/2e-card-actions.md` with one row for every Item and Omen:

- id/name/deck;
- passive, consumable, once-per-turn, repeatable restriction, or manual;
- timing window;
- legal target and player choice;
- fixed dice or trait roll;
- success/failure branches;
- ownership destination after use;
- implemented status and test name;
- mismatch between displayed rule and executable effect.

Also inventory every roll-producing Event and room action. Mark each row
`AUTOMATED`, `PARTIAL`, `MANUAL`, or `BLOCKED`. Resolve the high-impact mismatches
listed in the accompanying player-experience audit first.

Exit: no Item/Omen/roll action is unclassified.

## Task 2 — Add one minimal use-policy contract

Extend card content with the minimum validated fields needed to express existing
rules. Prefer a small discriminated `use` policy over unrelated booleans. It must be
able to distinguish:

- passive while held;
- consumable;
- once per turn;
- repeatable with explicit timing/target restriction;
- manual/unsupported.

Do not duplicate `keepInPlay` semantics unnecessarily; migrate or derive it if safe.
Content validation must reject contradictory policies such as passive + `onUse`, a
consumable with no effect, or a target requirement the engine cannot resolve.

Exit: loader/schema tests cover valid and invalid combinations.

## Task 3 — Server-authoritative action legality and cooldown

Implement a replay-safe usage marker keyed by owning seat and card identity. The
server must validate before RNG consumption:

- phase and active turn;
- living/non-removed actor;
- actual ownership;
- executable `onUse`;
- timing window;
- same-turn cooldown;
- target/trait/room eligibility;
- pending prompt lock.

Reset once-per-turn availability exactly when that seat begins its next turn, not
on arbitrary UI dismissal. Reconnect and replay must preserve the marker. Invalid
use must not consume RNG or mutate state.

Add focused red-green tests for Bell, Crystal Ball, Spirit Board, a consumable, and
an invalid direct protocol call.

## Task 4 — Support choices without card-specific reducer branches

Reuse the existing prompt/effect continuation system for:

- choose trait;
- choose explorer/target;
- choose room when needed;
- assign physical/mental effect where applicable.

Only add a new prompt kind if the existing prompt vocabulary cannot represent the
choice. Do not hard-code each card id in `reduce.ts`.

Required corrections:

- Healing Salve changes the selected legal trait only;
- Smelling Salts resolves a legal target/recovery choice;
- Dynamite has an executable target and damage pipeline;
- no card silently picks a target or trait for the player.

Exit: prompt timeout/default, reconnect, and replay tests do not double-apply use.

## Task 5 — Derive passive equipment effects from ownership

Stop representing “while you carry this” and weapon-only modifiers as permanent
base-trait changes. Add the smallest selectors used by rolls/combat to derive:

- held passive trait modifier;
- weapon attack dice modifier;
- companion modifier where currently supported.

Dropping, trading, losing, or picking up the card must immediately change the
derived modifier without reverse-mutating trait history. Correct Adrenaline Shot so
its temporary Speed benefit expires at end of turn instead of becoming permanent.

Do not invent stacking rules. Use reference rules and add explicit tests for two
potentially stacking sources.

Exit: base trait index remains stable while ownership changes; relevant roll value
changes exactly once.

## Task 6 — Card-zone conservation and pickup

Replace comma-separated dropped-card storage only if necessary to safely support
pickup; prefer an existing typed state collection. Implement the minimal complete
cycle:

```text
deck -> inPlay/inventory -> room drop -> pickup/inventory -> discard/removed
```

At every state, a card id must exist in exactly one legal zone, except where the
model intentionally mirrors public ownership and the invariant documents it. Add
invariants and tests for drop, pickup, trade/loss if currently exposed, consumable
use, death handling, and reconnect/replay.

Exit: no card can be duplicated, lost, or picked up remotely.

## Task 7 — Queue all gameplay presentations

Replace the single last-write-wins `activeRoll` behavior with the smallest ordered
presentation queue covering:

- card reveal;
- card effect roll;
- effect result/trait change;
- Haunt roll;
- Haunt reveal.

Preserve server event order. A card-effect roll and Haunt roll from the same action
must both appear. Dismissing a presentation advances only the queue; it does not
change authoritative results. Respect reduced motion and accessibility.

Add store/component tests for two rolls in one event batch and card -> effect roll
-> Haunt roll ordering.

## Task 8 — Make legal actions understandable

Inventory UI must visibly distinguish passive, consumable, ready, used-this-turn,
manual, and unavailable cards. Show why an action is unavailable. For a usable
card, display roll type/count, target requirement, and consumption/cooldown before
confirmation. Keep controls compact; no new dashboard.

Review current playable flow for additional friction:

- hidden or misleading room actions;
- input allowed during pending presentation/prompt;
- unclear End Turn availability;
- unexplained trait changes/damage;
- modal collisions;
- solo-mode deadlocks;
- mobile/tablet overflow and keyboard access.

Record additional confirmed issues in
`docs/audit/2026-09-16-player-experience-items-actions.md` and fix only reproducible
P0/P1 issues in the current playable scope.

## Task 9 — Full verification

Run fresh, stopping on each failure and fixing by one hypothesis:

```bash
node -v
npm -v
npm run typecheck
npm test
npm run lint
npm run format:check
npm run build
git diff --check
```

Run production and development smoke tests with temporary data directories. Verify
`/`, `/healthz`, `/api/content`, `/ws`, a solo start, one consumable, one once-per-
turn item across two turns, an Omen effect roll followed by Haunt roll, drop/pickup,
and reconnect without duplicate effects. Stop all spawned servers.

## Worker report

Return only:

1. root causes;
2. ledger counts by status;
3. files changed;
4. mechanics corrected;
5. tests added;
6. exact verification results;
7. remaining manual/blocked mechanics and the decision needed.

