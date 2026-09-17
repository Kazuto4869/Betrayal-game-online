/**
 * Hidden-information redaction. See docs/06-networking.md#64-redaction.
 *
 * Two rules hold the line here:
 *
 *   1. Redaction is SUBTRACTIVE ONLY. It never invents or reorders data, so a
 *      redacted state is still a valid GameState with fields cleared, and the
 *      client's rendering code is unaware redaction exists.
 *   2. A test asserts no redacted snapshot contains a card id still in a draw
 *      pile. See redact.test.ts — do not delete it.
 *
 * Deliberately NOT redacted, because the physical game is open information:
 * players' items and omens, all trait values, board layout, discard piles,
 * and omensDrawn.
 */

import {
  DECK_KINDS,
  type DeckState,
  type GameState,
  type SeatId,
  type HauntBriefing,
} from '@bahoth/shared';

/**
 * @param seat the viewer, or null for a spectator with no seat.
 */
export function redactFor(state: GameState, seat: SeatId | null): GameState {
  const decks = {} as GameState['decks'];
  for (const kind of DECK_KINDS) {
    const deck = state.decks[kind];
    const redacted: DeckState = {
      // Card identities in the draw pile are hidden; the count is not, since
      // "18 rooms left" is public information at the table anyway.
      draw: [],
      drawCount: deck.draw.length,
      discard: [...deck.discard],
      inPlay: [...deck.inPlay],
    };
    decks[kind] = redacted;
  }

  // Omit `rng` by destructuring rather than assigning undefined: knowing the
  // seed predicts every future roll, and exactOptionalPropertyTypes means an
  // explicit `undefined` is not the same as an absent key.
  const { rng: _rng, ...rest } = state;
  return {
    ...rest,
    decks,
    // Same treatment as the card draw piles (docs/06-networking.md#64: "Tile
    // deck order — same treatment"): identities hidden, count public.
    tileDeck: [],
    tileDeckCount: state.tileDeck.length + (state.tileDiscard?.length ?? 0),
    tileDiscard: [],
    haunt: redactHaunt(state, seat),
  };
}

function redactHaunt(state: GameState, seat: SeatId | null): GameState['haunt'] {
  const haunt = state.haunt;
  if (!haunt) return null;

  // Destructure unredacted internal fields
  const { heroSide, traitorSide, hauntTitle, briefing: _b, ...publicHaunt } = haunt;

  // Until the reveal completes, the haunt's identity is hidden from everyone.
  if (!haunt.revealed) {
    return { ...publicHaunt, hauntId: 0, traitorSeat: null, acknowledged: [] };
  }

  // Spectator receives public haunt info only; NO private book briefing
  if (!seat) {
    return publicHaunt;
  }

  const isTraitor = haunt.traitorSeat === seat;
  const isHero =
    haunt.traitorSeat !== seat &&
    !!state.players[seat] &&
    !state.players[seat]?.isDead &&
    !state.players[seat]?.removed;

  let briefing: HauntBriefing | undefined;
  if (isTraitor && traitorSide) {
    briefing = {
      hauntId: haunt.hauntId,
      title: hauntTitle ?? `Haunt #${haunt.hauntId}`,
      role: 'traitor',
      side: traitorSide,
    };
  } else if (isHero && heroSide) {
    briefing = {
      hauntId: haunt.hauntId,
      title: hauntTitle ?? `Haunt #${haunt.hauntId}`,
      role: 'hero',
      side: heroSide,
    };
  }

  return {
    ...publicHaunt,
    briefing,
  };
}

/** True if `state` looks like it has already been redacted. */
export function isRedacted(state: GameState): boolean {
  return state.rng === undefined;
}
