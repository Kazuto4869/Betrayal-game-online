/**
 * The shared `Effect` interpreter. See docs/08-haunt-system.md#83-effects and
 * docs/09-roadmap.md's M3 note: "The Effect interpreter, with prompt
 * suspension. This is the piece the haunt system is built on — do not rush
 * it." `@bahoth/content`'s `effects.ts` owns the `Effect`/`Condition` shape
 * and records the scope this interpreter covers (which kinds exist, which
 * are deferred, and the two deliberate deviations from the doc); this file
 * only walks it.
 *
 * Suspension is flat and explicit per docs/05-engine.md#56 ("keep that
 * resume state small and explicit; do not attempt generators or
 * coroutines"). `if` never suspends on its own — its branch is spliced into
 * the effect queue being processed, so a `prompt` inside an `if` is just a
 * prompt at the current nesting level. `for_each` supports exactly one level
 * of mid-loop suspension; a `prompt` inside a `for_each` nested in another
 * `for_each` throws rather than silently losing the outer loop's state.
 */

import {
  type EffectPromptPayload,
  type EffectResume,
  type GameEvent,
  type GameState,
  type PlacedId,
  type PlayerState,
  type PromptKind,
  type SeatId,
  type TargetRef,
} from '@bahoth/shared';
import type {
  Condition,
  Content,
  Effect,
  PromptSpec,
  RoomRef,
  SeatRef,
} from '@bahoth/content';
import { raisePrompt } from './prompts.js';
import { getReachable } from './movement.js';
import { nextInt } from './rng.js';

export class EffectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EffectError';
  }
}

export interface EffectContext {
  actor: SeatId;
  /** The answer to the innermost enclosing `prompt` (`{ ref: 'chosen' }`). */
  chosen?: TargetRef | PlacedId | undefined;
  /** The seat the innermost enclosing `for_each` is on (`{ ref: 'each' }`). */
  each?: SeatId | undefined;
}

export interface EffectOutcome {
  state: GameState;
  events: GameEvent[];
}

interface RunResult extends EffectOutcome {
  suspended: boolean;
}

/**
 * Run an effect list from the top. Mirrors `ReduceResult`'s `{state, events}`
 * shape so callers (`finishDiscovery` today; cards and haunt rules later)
 * can splice it in directly. May return with `state.pending` set instead of
 * having finished the list — the caller does not need to know which.
 */
export function runEffects(
  state: GameState,
  effects: readonly Effect[],
  ctx: EffectContext,
  content: Content,
): EffectOutcome {
  const { state: nextState, events } = runList(state, effects, ctx, content);
  return { state: nextState, events };
}

/**
 * Resume an effect list a `choose_target`/`choose_room` prompt suspended.
 * The other half of `runEffects` — reached from `reduce.ts`'s `resumePrompt`,
 * the same way `finishDiscovery` is reached for `rotate_tile`.
 */
export function resumeEffects(
  state: GameState,
  resume: EffectResume,
  answer: TargetRef | PlacedId,
  content: Content,
): EffectOutcome {
  const events: GameEvent[] = [];
  let working = state;

  if (resume.forEach) {
    const seatCtx: EffectContext = {
      actor: resume.actor,
      chosen: answer,
      each: resume.forEach.currentSeat,
    };
    const first = runList(
      working,
      resume.forEach.currentRemaining as Effect[],
      seatCtx,
      content,
    );
    working = first.state;
    events.push(...first.events);
    if (first.suspended) {
      working = suspendForEach(
        working,
        resume.actor,
        resume.forEach.remainingSeats,
        resume.forEach.body,
        resume.forEach.currentSeat,
      );
      working = prependRemaining(working, resume.remaining);
      return { state: working, events };
    }

    for (const seat of resume.forEach.remainingSeats) {
      const iter = runList(
        working,
        resume.forEach.body as Effect[],
        { actor: resume.actor, each: seat },
        content,
      );
      working = iter.state;
      events.push(...iter.events);
      if (iter.suspended) {
        const idx = resume.forEach.remainingSeats.indexOf(seat);
        working = suspendForEach(
          working,
          resume.actor,
          resume.forEach.remainingSeats.slice(idx + 1),
          resume.forEach.body,
          seat,
        );
        working = prependRemaining(working, resume.remaining);
        return { state: working, events };
      }
    }

    const rest = runList(
      working,
      resume.remaining as Effect[],
      { actor: resume.actor },
      content,
    );
    working = rest.state;
    events.push(...rest.events);
    return { state: working, events };
  }

  const rest = runList(
    working,
    resume.remaining as Effect[],
    { actor: resume.actor, chosen: answer },
    content,
  );
  return { state: rest.state, events: [...events, ...rest.events] };
}

/**
 * Turn a plain suspension (`state.pending` already set by a `prompt` inside
 * the current seat's `for_each` body) into one that also remembers the
 * loop's own state — `remainingSeats` and `body` come from the caller,
 * `currentRemaining` from the sub-suspension's own resume, which is exactly
 * "what's left of this seat's body." Throws if that sub-suspension already
 * carries a `forEach` of its own — that would mean the prompt was inside a
 * `for_each` nested in another one, which this interpreter does not support.
 */
function suspendForEach(
  state: GameState,
  actor: SeatId,
  remainingSeats: SeatId[],
  body: readonly unknown[],
  currentSeat: SeatId,
): GameState {
  const payload = state.pending!.payload as EffectPromptPayload;
  if (payload.resume.forEach) {
    throw new EffectError(
      'a prompt inside a for_each nested in another for_each is not supported',
    );
  }
  const resume: EffectResume = {
    actor,
    remaining: [],
    forEach: {
      remainingSeats,
      body: [...body],
      currentSeat,
      currentRemaining: payload.resume.remaining,
    },
  };
  return { ...state, pending: { ...state.pending!, payload: { ...payload, resume } } };
}

/** Prepend effects that must run after everything currently queued in `state.pending`'s resume — used when a for_each (which owns its own resume) suspends partway through a flat list that has more effects after it. */
function prependRemaining(state: GameState, extra: readonly unknown[]): GameState {
  if (extra.length === 0 || !state.pending) return state;
  const payload = state.pending.payload as EffectPromptPayload;
  const resume: EffectResume = {
    ...payload.resume,
    remaining: [...extra, ...payload.resume.remaining],
  };
  return { ...state, pending: { ...state.pending, payload: { ...payload, resume } } };
}

/**
 * The core loop. `effects` is processed as a queue rather than by recursion:
 * `if` splices its chosen branch onto the front of the queue and continues,
 * so a prompt inside an `if` is indistinguishable from one at this level —
 * no separate suspension bookkeeping for `if` at all.
 */
function runList(
  state: GameState,
  effects: readonly Effect[],
  ctx: EffectContext,
  content: Content,
): RunResult {
  const events: GameEvent[] = [];
  const queue = [...effects];
  let working = state;
  let activeCtx = ctx;

  while (queue.length > 0) {
    const effect = queue.shift()!;

    if (effect.e === 'if') {
      const branch = evalCondition(working, effect.c, activeCtx, content)
        ? effect.then
        : (effect.else ?? []);
      queue.unshift(...branch);
      continue;
    }

    if (effect.e === 'for_each') {
      const result = runForEach(working, effect, activeCtx, content);
      working = result.state;
      events.push(...result.events);
      if (result.suspended) {
        working = prependRemaining(working, queue);
        return { state: working, events, suspended: true };
      }
      continue;
    }

    if (effect.e === 'prompt') {
      const resolved = resolvePromptCandidates(
        working,
        effect.prompt,
        activeCtx,
        content,
      );
      if (resolved.candidates.length === 0) {
        events.push({ t: 'log', text: 'Nothing to choose from — skipped.' });
        continue;
      }
      if (resolved.candidates.length === 1) {
        // A prompt with one legal answer decides nothing (docs/09-roadmap.md
        // open question 7's auto-apply, same reasoning as rotate_tile).
        activeCtx = { ...activeCtx, chosen: resolved.candidates[0]! };
        queue.unshift(...effect.then);
        continue;
      }
      const seat = resolveSingleSeat(working, effect.who, activeCtx);
      const resume: EffectResume = {
        actor: activeCtx.actor,
        remaining: [...effect.then, ...queue],
      };
      const payload: EffectPromptPayload =
        resolved.kind === 'choose_room'
          ? { kind: 'choose_room', candidates: resolved.candidates as PlacedId[], resume }
          : {
              kind: 'choose_target',
              candidates: resolved.candidates as TargetRef[],
              resume,
            };
      const kind: PromptKind = resolved.kind;
      const pending = raisePrompt(working, {
        seatId: seat,
        kind,
        payload,
        defaultAnswer: resolved.candidates[0],
      });
      return { state: { ...working, pending }, events, suspended: true };
    }

    const leaf = applyLeaf(working, effect, activeCtx, content);
    working = leaf.state;
    events.push(...leaf.events);
  }

  return { state: working, events, suspended: false };
}

function runForEach(
  state: GameState,
  effect: Extract<Effect, { e: 'for_each' }>,
  ctx: EffectContext,
  content: Content,
): RunResult {
  const seats = resolveSeatSet(state, effect.who, ctx);
  const events: GameEvent[] = [];
  let working = state;

  for (let i = 0; i < seats.length; i++) {
    const seat = seats[i]!;
    const sub = runList(working, effect.do, { actor: ctx.actor, each: seat }, content);
    working = sub.state;
    events.push(...sub.events);
    if (sub.suspended) {
      working = suspendForEach(working, ctx.actor, seats.slice(i + 1), effect.do, seat);
      return { state: working, events, suspended: true };
    }
  }

  return { state: working, events, suspended: false };
}

// ---------------------------------------------------------------------------
// Leaf effects — none of these can suspend.

function applyLeaf(
  state: GameState,
  effect: Exclude<Effect, { e: 'if' } | { e: 'for_each' } | { e: 'prompt' }>,
  ctx: EffectContext,
  content: Content,
): EffectOutcome {
  switch (effect.e) {
    case 'trait':
      return applyTrait(state, effect, ctx, content);
    case 'move':
      return applyMove(state, effect, ctx, content);
    case 'set_flag':
      return applySetFlag(state, effect, ctx, content);
    case 'place_token':
      return applyPlaceToken(state, effect, ctx, content);
    case 'end_turn':
      return applyEndTurn(state, effect, ctx);
    case 'log':
      return { state, events: [{ t: 'log', text: effect.text }] };
  }
}

function applyTrait(
  state: GameState,
  effect: Extract<Effect, { e: 'trait' }>,
  ctx: EffectContext,
  content: Content,
): EffectOutcome {
  const seat = resolveSingleSeat(state, effect.who, ctx);
  const player = state.players[seat];
  if (!player || player.isDead || !player.charId) return { state, events: [] };
  const character = content.charactersById[player.charId];
  const track = character?.tracks[effect.trait];
  if (!track) return { state, events: [] };

  const from = player.traits[effect.trait];
  const to = Math.max(0, Math.min(track.length - 1, from + effect.delta));
  if (to === from) return { state, events: [] };

  const becameDead = to === 0 && !player.isDead;
  const nextPlayer: PlayerState = {
    ...player,
    traits: { ...player.traits, [effect.trait]: to },
    isDead: player.isDead || becameDead,
  };
  const events: GameEvent[] = [
    { t: 'trait_changed', seat, trait: effect.trait, from, to },
  ];
  if (becameDead) events.push({ t: 'died', seat });

  return {
    state: { ...state, players: { ...state.players, [seat]: nextPlayer } },
    events,
  };
}

function applyMove(
  state: GameState,
  effect: Extract<Effect, { e: 'move' }>,
  ctx: EffectContext,
  content: Content,
): EffectOutcome {
  const seat = resolveSingleSeat(state, effect.who, ctx);
  const player = state.players[seat];
  if (!player) return { state, events: [] };

  const { id, state: resolvedState } = resolveRoomRef(state, effect.to, ctx, content);
  if (!id || !resolvedState.board.placed[id]) {
    return {
      state: resolvedState,
      events: [{ t: 'log', text: `${player.name} could not be moved there.` }],
    };
  }
  if (id === player.location) return { state: resolvedState, events: [] };

  const from = player.location;
  const nextPlayer: PlayerState = { ...player, location: id, cameFrom: from };
  return {
    state: {
      ...resolvedState,
      players: { ...resolvedState.players, [seat]: nextPlayer },
    },
    events: [{ t: 'moved', seat, from, to: id }],
  };
}

function applySetFlag(
  state: GameState,
  effect: Extract<Effect, { e: 'set_flag' }>,
  ctx: EffectContext,
  content: Content,
): EffectOutcome {
  if (effect.scope === 'game') {
    return {
      state: { ...state, flags: { ...state.flags, [effect.key]: effect.value } },
      events: [],
    };
  }

  if (effect.scope === 'seat') {
    const seat = effect.ref
      ? resolveSingleSeat(state, effect.ref as SeatRef, ctx)
      : ctx.actor;
    const player = state.players[seat];
    if (!player) return { state, events: [] };
    const flags = { ...player.flags, [effect.key]: effect.value };
    return {
      state: { ...state, players: { ...state.players, [seat]: { ...player, flags } } },
      events: [],
    };
  }

  // scope: 'tile'
  const ref = (effect.ref as RoomRef | undefined) ?? 'actor_room';
  const { id } = resolveRoomRef(state, ref, ctx, content);
  const placed = id ? state.board.placed[id] : undefined;
  if (!placed) return { state, events: [] };
  const flags = { ...placed.flags, [effect.key]: effect.value };
  return {
    state: {
      ...state,
      board: {
        ...state.board,
        placed: { ...state.board.placed, [id!]: { ...placed, flags } },
      },
    },
    events: [],
  };
}

function applyPlaceToken(
  state: GameState,
  effect: Extract<Effect, { e: 'place_token' }>,
  ctx: EffectContext,
  content: Content,
): EffectOutcome {
  const { id } = resolveRoomRef(state, effect.at, ctx, content);
  if (!id)
    return {
      state,
      events: [{ t: 'log', text: `Nowhere to place the ${effect.token}.` }],
    };
  const ordinal = state.tokens.filter((t) => t.token === effect.token).length;
  const token = {
    id: `${effect.token}_${ordinal}`,
    token: effect.token,
    location: id,
    flags: {},
  };
  return { state: { ...state, tokens: [...state.tokens, token] }, events: [] };
}

/**
 * Ends the actor's movement, not their turn — the mechanism
 * docs/05-engine.md#56 step 7 already describes for a card draw
 * (`movesLeft = 0`). Actually advancing `activeSeat` is `reduce.ts`'s
 * `endTurn`, which this file cannot call without a circular import
 * (`reduce.ts` is the one that will call into `runEffects`). A caller that
 * needs the full turn-advancing behaviour still issues `END_TURN` itself.
 */
function applyEndTurn(
  state: GameState,
  effect: Extract<Effect, { e: 'end_turn' }>,
  ctx: EffectContext,
): EffectOutcome {
  const seat = resolveSingleSeat(state, effect.who, ctx);
  const player = state.players[seat];
  if (!player || player.movesLeft === 0) return { state, events: [] };
  return {
    state: {
      ...state,
      players: { ...state.players, [seat]: { ...player, movesLeft: 0 } },
    },
    events: [],
  };
}

// ---------------------------------------------------------------------------
// References

function resolveSingleSeat(state: GameState, ref: SeatRef, ctx: EffectContext): SeatId {
  if (ref === 'actor') return ctx.actor;
  if (ref === 'traitor') {
    const traitor = state.haunt?.traitorSeat;
    if (!traitor) throw new EffectError('SeatRef "traitor" has no traitor yet');
    return traitor;
  }
  if (ref === 'any_hero' || ref === 'all_heroes') {
    throw new EffectError(
      `SeatRef "${ref}" resolves to a set — use for_each, not a single-seat effect`,
    );
  }
  if ('seat' in ref) return ref.seat;
  if (ref.ref === 'chosen') {
    if (
      typeof ctx.chosen !== 'object' ||
      ctx.chosen === null ||
      !('kind' in ctx.chosen) ||
      ctx.chosen.kind !== 'seat'
    ) {
      throw new EffectError('SeatRef "chosen" is not a seat in this context');
    }
    return ctx.chosen.seatId;
  }
  // ref.ref === 'each'
  if (!ctx.each) throw new EffectError('SeatRef "each" used outside a for_each');
  return ctx.each;
}

/** For `for_each`'s `who` (and only there): the set to iterate. `'any_hero'` is existential, not a set — evalCondition handles its quantifier separately; iterating it makes no sense. */
function resolveSeatSet(state: GameState, ref: SeatRef, ctx: EffectContext): SeatId[] {
  if (ref === 'all_heroes') return heroSeats(state);
  if (ref === 'any_hero') {
    throw new EffectError(
      'SeatRef "any_hero" is existential — use "all_heroes" to iterate everyone',
    );
  }
  return [resolveSingleSeat(state, ref, ctx)];
}

function heroSeats(state: GameState): SeatId[] {
  return Object.values(state.players)
    .filter((p) => !p.isTraitor && !p.isDead && !p.removed)
    .map((p) => p.seatId);
}

function resolveRoomRef(
  state: GameState,
  ref: RoomRef,
  ctx: EffectContext,
  content: Content,
): { id: PlacedId | null; state: GameState } {
  if (ref === 'actor_room') {
    return { id: state.players[ctx.actor]?.location ?? null, state };
  }
  if (ref === 'entrance_hall') {
    const found = Object.values(state.board.placed).find(
      (t) => t.tileId === content.house.startTile,
    );
    return { id: found?.id ?? null, state };
  }
  if ('tile' in ref) {
    const found = Object.values(state.board.placed)
      .sort((a, b) => a.id.localeCompare(b.id))
      .find((t) => t.tileId === ref.tile);
    return { id: found?.id ?? null, state };
  }
  if ('landing' in ref) {
    const landingTileId = content.house.landings[ref.landing];
    const found = landingTileId
      ? Object.values(state.board.placed).find((t) => t.tileId === landingTileId)
      : undefined;
    return { id: found?.id ?? null, state };
  }
  if ('random' in ref) {
    const onFloor = Object.values(state.board.placed)
      .filter((t) => t.floor === ref.random)
      .map((t) => t.id)
      .sort();
    if (onFloor.length === 0 || !state.rng) return { id: null, state };
    const [idx, rng] = nextInt(state.rng, onFloor.length);
    return { id: onFloor[idx]!, state: { ...state, rng } };
  }
  // ref.ref === 'chosen'
  if (typeof ctx.chosen === 'string') return { id: ctx.chosen, state };
  return { id: null, state };
}

function resolvePromptCandidates(
  state: GameState,
  spec: PromptSpec,
  ctx: EffectContext,
  content: Content,
):
  | { kind: 'choose_room'; candidates: PlacedId[] }
  | { kind: 'choose_target'; candidates: TargetRef[] } {
  if (spec.kind === 'choose_room') {
    if (spec.among === 'placed') {
      return { kind: 'choose_room', candidates: Object.keys(state.board.placed) };
    }
    return { kind: 'choose_room', candidates: getReachable(state, ctx.actor, content) };
  }

  if (spec.among === 'other_seats_in_room') {
    const location = state.players[ctx.actor]?.location ?? null;
    const candidates: TargetRef[] = Object.values(state.players)
      .filter(
        (p) =>
          p.seatId !== ctx.actor && p.location === location && !p.isDead && !p.removed,
      )
      .map((p) => ({ kind: 'seat', seatId: p.seatId }));
    return { kind: 'choose_target', candidates };
  }

  // among: 'all_heroes'
  const candidates: TargetRef[] = heroSeats(state).map((seatId) => ({
    kind: 'seat',
    seatId,
  }));
  return { kind: 'choose_target', candidates };
}

// ---------------------------------------------------------------------------
// Condition

export function evalCondition(
  state: GameState,
  c: Condition,
  ctx: EffectContext,
  content: Content,
): boolean {
  switch (c.k) {
    case 'all_dead': {
      const pool = poolFor(state, c.side);
      return pool.length > 0 && pool.every((dead) => dead);
    }
    case 'not':
      return !evalCondition(state, c.c, ctx, content);
    case 'and':
      return c.cs.every((sub) => evalCondition(state, sub, ctx, content));
    case 'or':
      return c.cs.some((sub) => evalCondition(state, sub, ctx, content));
    case 'turns_elapsed':
      return state.round >= c.value;
    case 'flag':
      return evalFlag(state, c, ctx);
    case 'seat_dead':
    case 'in_room':
    case 'holds':
    case 'trait_at_least': {
      if (c.who === 'any_hero' || c.who === 'all_heroes') {
        const results = heroSeats(state).map((seat) => evalSeatCondition(state, c, seat));
        return c.who === 'any_hero' ? results.some(Boolean) : results.every(Boolean);
      }
      const seat = resolveSingleSeat(state, c.who, ctx);
      return evalSeatCondition(state, c, seat);
    }
  }
}

function poolFor(state: GameState, side: 'heroes' | 'traitor' | 'monsters'): boolean[] {
  if (side === 'monsters') return Object.values(state.monsters).map((m) => m.isDead);
  if (side === 'traitor') {
    const traitor = state.haunt?.traitorSeat
      ? state.players[state.haunt.traitorSeat]
      : undefined;
    return traitor ? [traitor.isDead] : [];
  }
  return Object.values(state.players)
    .filter((p) => !p.isTraitor)
    .map((p) => p.isDead);
}

function evalSeatCondition(
  state: GameState,
  c: Extract<Condition, { k: 'seat_dead' | 'in_room' | 'holds' | 'trait_at_least' }>,
  seat: SeatId,
): boolean {
  const player = state.players[seat];
  if (!player) return false;
  switch (c.k) {
    case 'seat_dead':
      return player.isDead;
    case 'in_room': {
      const placed = player.location ? state.board.placed[player.location] : undefined;
      return placed?.tileId === c.tile;
    }
    case 'holds':
      return player.items.includes(c.cardId) || player.omens.includes(c.cardId);
    case 'trait_at_least':
      return player.traits[c.trait] >= c.value;
  }
}

function evalFlag(
  state: GameState,
  c: Extract<Condition, { k: 'flag' }>,
  ctx: EffectContext,
): boolean {
  const bag =
    c.scope === 'game'
      ? state.flags
      : c.scope === 'seat'
        ? state.players[c.ref ?? ctx.actor]?.flags
        : c.ref
          ? state.board.placed[c.ref]?.flags
          : undefined;
  if (!bag) return false;
  const actual = bag[c.key];
  if (actual === undefined) return false;
  switch (c.op) {
    case '=':
      return actual === c.value;
    case '>=':
      return (
        typeof actual === 'number' && typeof c.value === 'number' && actual >= c.value
      );
    case '<=':
      return (
        typeof actual === 'number' && typeof c.value === 'number' && actual <= c.value
      );
  }
}
