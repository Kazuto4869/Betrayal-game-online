# Omen ordering and room-effect remediation plan

> Worker: AGY CLI, Gemini 3.8 Flash High. Follow TDD and systematic debugging.

## Scope and constraints

- Work only inside `betrayal-web/`.
- Keep `MIN_PLAYERS = 1` as a temporary solo-development rule.
- Do not modify the three reference repositories.
- Do not run `npm audit fix`.
- Do not add unrelated features or continue other roadmap phases.
- Preserve deterministic, server-authoritative state and replay compatibility.
- Use existing effects/prompts/event-log architecture before adding abstractions.
- Never mark text/UI-only card or room data as mechanically implemented.
- Make the smallest fix that closes each reproduced failure.

## Task 1 — Stabilize the working tree

1. Inspect `git status`, current AGY edits, and running processes.
2. Do not discard concurrent/user changes.
3. Restore only the abandoned instruction that changed `MIN_PLAYERS` to 3; final
   value for this task is 1.
4. Run the focused existing tests once and record the baseline failures.

Exit: one known owner for each dirty file and no concurrent writer.

## Task 2 — Reproduce the Omen-before-Haunt presentation bug

Trace one deterministic Omen discovery end to end:

```text
MOVE_THROUGH / ROTATE_TILE
  -> finishDiscovery
  -> deck draw
  -> runEffects
  -> emitted GameEvents
  -> client store
  -> CardModal / DiceRollTray / HauntBanner
```

Write a failing integration test that proves the observed defect. Capture:

- event order;
- pending prompt/effect continuation;
- Omen inventory state;
- UI presentation order when `drew_card`, `rolled`, `haunt_roll`, and
  `haunt_begun` arrive together.

Form one root-cause hypothesis before editing. Do not fix only with animation
timing if authoritative resolution is also early.

Exit: the regression test fails for the same reason the player sees the bug.

## Task 3 — Implement an authoritative Omen pipeline

Required sequence:

1. remove the Omen from draw pile;
2. emit draw/reveal information;
3. place a kept Omen in the player's inventory/in-play zone;
4. run its immediate effects;
5. if an effect suspends, preserve an explicit continuation that resumes the Omen
   pipeline after the answer/default/reconnect path;
6. require card acknowledgement if the existing UI lifecycle needs it to guarantee
   reveal-before-roll;
7. only after immediate effects finish, roll six Haunt dice;
8. emit `rolled`, then `haunt_roll`, then `haunt_begun` only when triggered;
9. resume movement/turn or transition phase exactly once.

Reconnect/replay and prompt timeout must not duplicate the card effect or Haunt
roll. Keep RNG consumption deterministic.

Exit: focused engine + client tests prove both state order and visible order.

## Task 4 — Serialize player feedback

1. Inspect whether client store keeps only one active card/roll/Haunt overlay.
2. Introduce the smallest ordered presentation queue if multiple feedback events
   can collide.
3. Preserve server event order.
4. Card reveal must close/acknowledge before its dependent dice presentation.
5. Respect reduced motion; animation must never determine game state.
6. Add accessible labels explaining roll reason, total, threshold, and outcome.

Exit: component/store tests demonstrate card -> effect roll -> Haunt roll order
without modal replacement.

## Task 5 — Audit and complete Omen mechanics

Create `docs/audit/2e-omen-mechanics.md` with one row per Omen and the fields from
the player-experience audit. Compare content JSON, schemas, reducer/effects, tests,
and read-only references. Do not infer a mechanic from flavor text.

For each Omen:

- add the smallest supported effect/prompt implementation;
- add a focused deterministic test;
- verify keep/discard/inventory behavior;
- verify any dice/trait condition uses printed trait values where required;
- verify an unresolved Omen cannot reach the Haunt roll;
- label unsupported mechanics `MANUAL` with visible player guidance rather than
  silently pretending they work.

Exit: every Omen is `AUTOMATED`, `MANUAL`, or `BLOCKED`, with no unlabelled card.

## Task 6 — Audit and complete special room feedback

Create `docs/audit/2e-room-effects.md`. Include every tile and classify applicable
hooks:

- on reveal;
- on enter;
- on leave;
- crossing restriction;
- end turn;
- once per game;
- optional room action;
- forced movement/floor transfer;
- automatic, manual, or blocked.

Implement only mechanisms supported by the current engine without speculative
systems. Required infrastructure behavior:

- room rules execute at the correct hook exactly once;
- a failed condition explains why movement/action is blocked;
- an eligible optional action is visible;
- once-per-game state is persisted and replay-safe;
- an unsupported room displays a manual-rule indicator;
- every triggered room emits player-readable feedback.

Prioritize the rooms directly reported as inert, then cover all special-room rows.
Do not copy copyrighted prose; use concise mechanical summaries/keys.

Exit: deterministic tests cover at least one room per hook category, and the ledger
contains no silent unknown.

## Task 7 — Player-journey test

Add the cheapest deterministic scenario/helper that covers the ten cases in the
player-experience audit. Verify:

- state transition;
- exact event ordering;
- visible presentation ordering;
- blocked input while a prompt/reveal is unresolved;
- reconnect does not repeat effects;
- event log gives a comprehensible reason.

Keep the helper test-only. Do not add production cheat controls.

## Task 8 — Clean verification and Render smoke

Run, without hiding an earlier exit code:

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

Then start production using a temporary data directory and a non-default port:

```bash
NODE_ENV=production PORT=18082 CONTENT_DIR=content DATA_DIR=<temp> npm start
```

Verify HTTP 200 for `/`, `/healthz`, `/api/content`; verify `/ws` opens; stop the
server. Repeat build/start from a clean tracked-file checkout to simulate Render.

## Final worker report

Return only:

1. root causes;
2. files changed;
3. Omen coverage counts by automated/manual/blocked;
4. room coverage counts by automated/manual/blocked;
5. new regression tests;
6. exact verification results;
7. unresolved blockers requiring a design decision.

Do not commit or push. Leave the diff for controller review.

