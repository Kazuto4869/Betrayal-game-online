/**
 * The `Effect`/`Condition` vocabulary. See docs/08-haunt-system.md#83-effects
 * and docs/09-roadmap.md's M3 note: "The Effect interpreter, with prompt
 * suspension. This is the piece the haunt system is built on — do not rush
 * it." The interpreter that walks these lives in `@bahoth/engine`
 * (`effects.ts`); this file only owns the shape.
 *
 * Scoped to what current `GameState` can actually execute. `docs/
 * 08-haunt-system.md`'s union also has `roll` (needs the dice system),
 * `give_card`/`take_card` (needs deck content — `CardSchema` doesn't exist),
 * `spawn_monster`/`kill` (needs monster defs, M4), and `script` (needs the
 * M4/M6 script registry). None of those subsystems exist yet, so those kinds
 * are deliberately absent here rather than accepted and silently
 * unexecutable — authoring one today is a content-validation error, the same
 * posture `EffectSchema = z.unknown()` held before this file existed. The
 * `count` condition is absent too: its `CountableRef` is referenced in the
 * doc but never defined anywhere in `docs/`, and inventing it blind is worse
 * than deferring it to whichever concrete card or haunt needs it first.
 *
 * Two deliberate deviations from the doc, both recorded in
 * docs/08-haunt-system.md next to 8.3:
 *
 * - `{ e: 'prompt'; then: Branch[] }` — `Branch` is never defined anywhere
 *   in `docs/`. `then` here is `Effect[]`, run unconditionally after any
 *   valid answer, with the answer available to those effects via
 *   `{ ref: 'chosen' }` on `SeatRef`/`RoomRef`.
 * - `for_each`'s `do: Effect[]` has no doc-given way to target "the seat
 *   this iteration is on" — `who` picks the set, but nothing in `SeatRef`
 *   lets the body refer to one member of it. `{ ref: 'each' }` fills that
 *   gap, same shape as `'chosen'`.
 */

import { z } from 'zod';

// Local copies of schemas.ts's FloorSchema/TraitSchema rather than an import
// from there: schemas.ts needs EffectSchema for TileSchema.onEnter and
// StaticLinkSchema's oneway_drop, so importing the other way would make the
// two files circular. Content test asserts these never drift from schemas.ts.
const FloorSchema = z.enum(['basement', 'ground', 'upper']);
const TraitSchema = z.enum(['speed', 'might', 'sanity', 'knowledge']);
type Trait = z.infer<typeof TraitSchema>;

// ---------------------------------------------------------------------------
// References

/** Mirrors @bahoth/shared's TargetRef; duplicated rather than imported so
 * this file's runtime validators don't reach into the protocol module's
 * internals for a two-variant schema. */
export const TargetRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('seat'), seatId: z.string().min(1) }),
  z.object({ kind: z.literal('monster'), monsterId: z.string().min(1) }),
]);

/**
 * `'any_hero'`/`'all_heroes'` resolve to a SET and are only meaningful where
 * a set is expected — `for_each`'s `who`, and conditions. A single-target
 * effect's `who` (e.g. `trait`) rejects them at resolve time: use `for_each`
 * to apply something to everyone, per docs/08-haunt-system.md#82.
 */
export const SeatRefSchema = z.union([
  z.literal('actor'),
  z.literal('traitor'),
  z.literal('any_hero'),
  z.literal('all_heroes'),
  z.object({ seat: z.string().min(1) }),
  /**
   * `'chosen'`: the answer to the innermost enclosing `prompt` effect.
   * `'each'`: the seat the innermost enclosing `for_each` is currently on —
   * `for_each`'s own `who` picks the set to iterate, `do`'s effects need
   * their own way to say "that one, this iteration," which neither the doc
   * nor `SeatRef` otherwise provides.
   */
  z.object({ ref: z.enum(['chosen', 'each']) }),
  z.object({ in_room: z.lazy(() => RoomRefSchema) }),
]);

export const RoomRefSchema = z.union([
  z.literal('actor_room'),
  /** Sugar for `content.house.startTile`'s placed instance. */
  z.literal('entrance_hall'),
  z.object({ tile: z.string().min(1) }),
  z.object({ random: FloorSchema }),
  z.object({ landing: FloorSchema }),
  /** The answer to the innermost enclosing `prompt` effect. */
  z.object({ ref: z.literal('chosen') }),
]);

export const TraitRefSchema = z.union([
  TraitSchema,
  z.object({ ref: z.literal('chosen') }),
]);
export type TraitRef = z.infer<typeof TraitRefSchema>;

const FlagValueSchema = z.union([z.number(), z.boolean(), z.string()]);
const FlagScopeSchema = z.enum(['game', 'seat', 'tile']);

export type SeatRef = z.infer<typeof SeatRefSchema>;
export type RoomRef = z.infer<typeof RoomRefSchema>;
export type TargetRef = z.infer<typeof TargetRefSchema>;

// ---------------------------------------------------------------------------
// Condition

export type Condition =
  | { k: 'all_dead'; side: 'heroes' | 'traitor' | 'monsters' }
  | { k: 'seat_dead'; who: SeatRef }
  | { k: 'in_room'; who: SeatRef; tile: string }
  | { k: 'holds'; who: SeatRef; cardId: string }
  | { k: 'trait_at_least'; who: SeatRef; trait: Trait; value: number }
  | {
      k: 'flag';
      scope: 'game' | 'seat' | 'tile';
      key: string;
      op: '=' | '>=' | '<=';
      value: number | boolean | string;
      ref?: string | undefined;
    }
  | { k: 'turns_elapsed'; op: '>='; value: number }
  | { k: 'not'; c: Condition }
  | { k: 'and'; cs: Condition[] }
  | { k: 'or'; cs: Condition[] };

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion('k', [
    z.object({
      k: z.literal('all_dead'),
      side: z.enum(['heroes', 'traitor', 'monsters']),
    }),
    z.object({ k: z.literal('seat_dead'), who: SeatRefSchema }),
    z.object({ k: z.literal('in_room'), who: SeatRefSchema, tile: z.string().min(1) }),
    z.object({ k: z.literal('holds'), who: SeatRefSchema, cardId: z.string().min(1) }),
    z.object({
      k: z.literal('trait_at_least'),
      who: SeatRefSchema,
      trait: TraitSchema,
      value: z.number(),
    }),
    z.object({
      k: z.literal('flag'),
      scope: FlagScopeSchema,
      key: z.string().min(1),
      op: z.enum(['=', '>=', '<=']),
      value: FlagValueSchema,
      ref: z.string().optional(),
    }),
    z.object({ k: z.literal('turns_elapsed'), op: z.literal('>='), value: z.number() }),
    z.object({ k: z.literal('not'), c: ConditionSchema }),
    z.object({ k: z.literal('and'), cs: z.array(ConditionSchema) }),
    z.object({ k: z.literal('or'), cs: z.array(ConditionSchema) }),
  ]),
);

// ---------------------------------------------------------------------------
// Prompt spec — see the file-level comment on the Branch deviation.
//
// Content authors a SELECTOR, not a literal candidate list — a tile's
// onEnter can't know which PlacedIds will exist on an unpredictable board.
// The interpreter resolves `among` against live state when it raises the
// prompt; the resolved candidates live in the runtime PendingPrompt payload
// (@bahoth/shared), not here.
export type PromptSpec =
  | {
      kind: 'choose_room';
      among: 'placed' | 'reachable_from_actor' | 'adjacent_or_same_room';
    }
  | {
      kind: 'choose_target';
      among: 'other_seats_in_room' | 'all_heroes' | 'seats_in_room';
    }
  | { kind: 'choose_trait'; traits?: Trait[] | undefined };

export const PromptSpecSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('choose_room'),
    among: z.enum(['placed', 'reachable_from_actor', 'adjacent_or_same_room']),
  }),
  z.object({
    kind: z.literal('choose_target'),
    among: z.enum(['other_seats_in_room', 'all_heroes', 'seats_in_room']),
  }),
  z.object({
    kind: z.literal('choose_trait'),
    traits: z.array(TraitSchema).optional(),
  }),
]);

// ---------------------------------------------------------------------------
// Effect

export type Effect =
  | { e: 'trait'; who: SeatRef; trait: TraitRef; delta: number }
  | { e: 'move'; who: SeatRef; to: RoomRef }
  | {
      e: 'set_flag';
      scope: 'game' | 'seat' | 'tile';
      key: string;
      value: number | boolean | string;
      ref?: SeatRef | RoomRef | undefined;
    }
  | { e: 'place_token'; token: string; at: RoomRef }
  | { e: 'prompt'; who: SeatRef; prompt: PromptSpec; then: Effect[] }
  | { e: 'end_turn'; who: SeatRef }
  | { e: 'log'; text: string }
  | { e: 'if'; c: Condition; then: Effect[]; else?: Effect[] | undefined }
  | { e: 'for_each'; who: SeatRef; do: Effect[] }
  | {
      e: 'roll';
      who: SeatRef;
      trait?: Trait | undefined;
      dice?: number | undefined;
      reason?: string | undefined;
      branches: Array<{ min: number; effects: Effect[] }>;
    };

export const EffectSchema: z.ZodType<Effect> = z.lazy(() =>
  z.discriminatedUnion('e', [
    z.object({
      e: z.literal('trait'),
      who: SeatRefSchema,
      trait: TraitRefSchema,
      delta: z.number().int(),
    }),
    z.object({ e: z.literal('move'), who: SeatRefSchema, to: RoomRefSchema }),
    z.object({
      e: z.literal('set_flag'),
      scope: FlagScopeSchema,
      key: z.string().min(1),
      value: FlagValueSchema,
      ref: z.union([SeatRefSchema, RoomRefSchema]).optional(),
    }),
    z.object({
      e: z.literal('place_token'),
      token: z.string().min(1),
      at: RoomRefSchema,
    }),
    z.object({
      e: z.literal('prompt'),
      who: SeatRefSchema,
      prompt: PromptSpecSchema,
      then: z.array(EffectSchema),
    }),
    z.object({ e: z.literal('end_turn'), who: SeatRefSchema }),
    z.object({ e: z.literal('log'), text: z.string() }),
    z.object({
      e: z.literal('if'),
      c: ConditionSchema,
      then: z.array(EffectSchema),
      else: z.array(EffectSchema).optional(),
    }),
    z.object({ e: z.literal('for_each'), who: SeatRefSchema, do: z.array(EffectSchema) }),
    z.object({
      e: z.literal('roll'),
      who: SeatRefSchema,
      trait: TraitSchema.optional(),
      dice: z.number().int().min(1).max(8).optional(),
      reason: z.string().optional(),
      branches: z.array(
        z.object({
          min: z.number().int(),
          effects: z.lazy(() => z.array(EffectSchema)),
        }),
      ),
    }),
  ]),
);
