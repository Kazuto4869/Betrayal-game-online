/**
 * The redaction test. See docs/10-testing-and-ops.md#the-redaction-test.
 *
 * "This is the one security property worth automating; write it in M1 and
 * never delete it." Written in M0 instead, because the deck plumbing exists
 * and there is no reason to ship a snapshot path without it.
 */

import { describe, expect, it } from 'vitest';
import { redactFor, isRedacted } from './redact.js';
import { startedGame } from './testing.js';
import { DECK_KINDS, type GameState } from '@bahoth/shared';

/** Plant known card ids in the draw piles so the leak test has something to find. */
function withStockedDecks(state: GameState): GameState {
  const decks = { ...state.decks };
  for (const kind of DECK_KINDS) {
    decks[kind] = {
      draw: [`${kind}.secret_1`, `${kind}.secret_2`, `${kind}.secret_3`],
      discard: [`${kind}.public_discard`],
      inPlay: [`${kind}.public_inplay`],
    };
  }
  return { ...state, decks };
}

describe('redactFor', () => {
  it('removes the RNG seed', () => {
    const state = startedGame().state;
    expect(state.rng).toBeDefined();
    const redacted = redactFor(state, 'seat_0');
    expect(redacted.rng).toBeUndefined();
    expect('rng' in redacted).toBe(false);
    expect(isRedacted(redacted)).toBe(true);
  });

  it('leaks no draw-pile card id, for any seat', () => {
    const state = withStockedDecks(startedGame().state);
    const viewers = [...state.turnOrder, null];

    for (const viewer of viewers) {
      const json = JSON.stringify(redactFor(state, viewer));
      for (const kind of DECK_KINDS) {
        for (const cardId of state.decks[kind].draw) {
          expect(json, `viewer ${viewer} saw ${cardId}`).not.toContain(cardId);
        }
      }
      expect(json).not.toContain('"seed"');
    }
  });

  it('keeps draw counts, discards, and in-play cards visible', () => {
    const state = withStockedDecks(startedGame().state);
    const redacted = redactFor(state, 'seat_0');
    for (const kind of DECK_KINDS) {
      expect(redacted.decks[kind].drawCount).toBe(3);
      expect(redacted.decks[kind].draw).toEqual([]);
      expect(redacted.decks[kind].discard).toContain(`${kind}.public_discard`);
      expect(redacted.decks[kind].inPlay).toContain(`${kind}.public_inplay`);
    }
  });

  it('keeps public information public', () => {
    // Items, traits, board, and omen count are open at the physical table.
    const state = startedGame().state;
    const redacted = redactFor(state, 'seat_1');
    expect(Object.keys(redacted.players)).toEqual(Object.keys(state.players));
    for (const seat of Object.keys(state.players)) {
      expect(redacted.players[seat]?.traits).toEqual(state.players[seat]?.traits);
      expect(redacted.players[seat]?.items).toEqual(state.players[seat]?.items);
    }
    expect(redacted.omensDrawn).toBe(state.omensDrawn);
    expect(redacted.turnOrder).toEqual(state.turnOrder);
  });

  it('hides the haunt id until the reveal completes', () => {
    const base = startedGame().state;
    const hidden: GameState = {
      ...base,
      haunt: { hauntId: 37, traitorSeat: 'seat_1', revealed: false, acknowledged: [] },
    };
    const redacted = redactFor(hidden, 'seat_0');
    expect(redacted.haunt?.hauntId).toBe(0);
    expect(redacted.haunt?.traitorSeat).toBeNull();
    expect(JSON.stringify(redacted)).not.toContain('37');

    const revealed: GameState = {
      ...hidden,
      haunt: { ...hidden.haunt!, revealed: true },
    };
    expect(redactFor(revealed, 'seat_0').haunt?.hauntId).toBe(37);
  });

  it('is subtractive: the result is still a valid GameState shape', () => {
    const state = withStockedDecks(startedGame().state);
    const redacted = redactFor(state, 'seat_0');
    expect(redacted.phase).toBe(state.phase);
    expect(redacted.version).toBe(state.version);
    expect(redacted.board).toEqual(state.board);
    expect(redacted.contentHash).toBe(state.contentHash);
  });

  it('leaks no tile deck id and keeps an accurate count', () => {
    // Same treatment as the card draw piles (docs/06-networking.md#64).
    const state = startedGame().state;
    expect(state.tileDeck.length).toBeGreaterThan(0);
    const onBoard = new Set(Object.values(state.board.placed).map((t) => t.tileId));

    for (const viewer of [...state.turnOrder, null]) {
      const redacted = redactFor(state, viewer);
      expect(redacted.tileDeck).toEqual([]);
      expect(redacted.tileDeckCount).toBe(state.tileDeck.length);

      const json = JSON.stringify(redacted);
      for (const tileId of state.tileDeck) {
        // A tile id that also happens to be pre-placed on the board is
        // legitimately visible (it is public there) — only ids that are
        // NOT on the board would be a leak of hidden deck order/contents.
        if (onBoard.has(tileId)) continue;
        expect(json, `viewer ${viewer} saw deck tile ${tileId}`).not.toContain(
          `"${tileId}"`,
        );
      }
    }
  });

  it('does not mutate the input state', () => {
    const state = withStockedDecks(startedGame().state);
    const before = JSON.stringify(state);
    redactFor(state, 'seat_0');
    expect(JSON.stringify(state)).toBe(before);
  });

  describe('Task 11: Haunt Briefing Privacy', () => {
    it('provides heroes only hero briefing and zero traitor tome text', () => {
      const base = startedGame({ playerCount: 3 }).state;
      const hauntState: GameState = {
        ...base,
        phase: 'haunt',
        haunt: {
          hauntId: 1,
          traitorSeat: 'seat_0',
          revealed: true,
          acknowledged: [],
          hauntTitle: 'The Mummy Walks',
          heroSide: {
            goal: 'Banish the Mummy to eternal sleep.',
            rules: ['Search the Catacombs for the amulet.'],
            win: [],
            intro: 'The sarcophagus creaks open in front of you.',
            rightNow: ['Place the Sarcophagus token in the room.'],
          },
          traitorSide: {
            goal: 'Awaken the ancient Pharaoh to consume the heroes.',
            rules: ['The Mummy cannot be harmed by mortal weapons.'],
            win: [],
            intro: 'You pledge your loyalty to the eternal king.',
            rightNow: ['Take control of the Mummy pawn.'],
          },
        },
      };

      // seat_1 and seat_2 are heroes
      const hero0View = redactFor(hauntState, 'seat_1');
      const hero1View = redactFor(hauntState, 'seat_2');

      expect(hero0View.haunt?.briefing?.role).toBe('hero');
      expect(hero0View.haunt?.briefing?.side.goal).toBe(
        'Banish the Mummy to eternal sleep.',
      );
      expect(hero0View.haunt?.heroSide).toBeUndefined();
      expect(hero0View.haunt?.traitorSide).toBeUndefined();

      // Zero traitor tome text in hero serialized snapshot
      const hero0Json = JSON.stringify(hero0View);
      expect(hero0Json).not.toContain('Awaken the ancient Pharaoh');
      expect(hero0Json).not.toContain('Take control of the Mummy pawn');
      expect(hero0Json).not.toContain('cannot be harmed by mortal weapons');

      const hero1Json = JSON.stringify(hero1View);
      expect(hero1Json).not.toContain('Awaken the ancient Pharaoh');
      expect(hero1Json).not.toContain('Take control of the Mummy pawn');
    });

    it('provides traitor only traitor tome and zero hero survival text', () => {
      const base = startedGame({ playerCount: 3 }).state;
      const hauntState: GameState = {
        ...base,
        phase: 'haunt',
        haunt: {
          hauntId: 1,
          traitorSeat: 'seat_0',
          revealed: true,
          acknowledged: [],
          hauntTitle: 'The Mummy Walks',
          heroSide: {
            goal: 'Banish the Mummy to eternal sleep.',
            rules: ['Search the Catacombs for the amulet.'],
            win: [],
            intro: 'The sarcophagus creaks open in front of you.',
            rightNow: ['Place the Sarcophagus token in the room.'],
          },
          traitorSide: {
            goal: 'Awaken the ancient Pharaoh to consume the heroes.',
            rules: ['The Mummy cannot be harmed by mortal weapons.'],
            win: [],
            intro: 'You pledge your loyalty to the eternal king.',
            rightNow: ['Take control of the Mummy pawn.'],
          },
        },
      };

      // seat_0 is traitor
      const traitorView = redactFor(hauntState, 'seat_0');
      expect(traitorView.haunt?.briefing?.role).toBe('traitor');
      expect(traitorView.haunt?.briefing?.side.goal).toBe(
        'Awaken the ancient Pharaoh to consume the heroes.',
      );
      expect(traitorView.haunt?.heroSide).toBeUndefined();
      expect(traitorView.haunt?.traitorSide).toBeUndefined();

      // Zero hero survival text in traitor serialized snapshot
      const traitorJson = JSON.stringify(traitorView);
      expect(traitorJson).not.toContain('Banish the Mummy to eternal sleep');
      expect(traitorJson).not.toContain('Search the Catacombs for the amulet');
      expect(traitorJson).not.toContain('The sarcophagus creaks open');
    });

    it('spectators and unseated viewers receive neither private book body', () => {
      const base = startedGame({ playerCount: 3 }).state;
      const hauntState: GameState = {
        ...base,
        phase: 'haunt',
        haunt: {
          hauntId: 1,
          traitorSeat: 'seat_0',
          revealed: true,
          acknowledged: [],
          hauntTitle: 'The Mummy Walks',
          heroSide: {
            goal: 'Banish the Mummy to eternal sleep.',
            rules: ['Search the Catacombs for the amulet.'],
            win: [],
          },
          traitorSide: {
            goal: 'Awaken the ancient Pharaoh to consume the heroes.',
            rules: ['The Mummy cannot be harmed by mortal weapons.'],
            win: [],
          },
        },
      };

      const spectatorView = redactFor(hauntState, null);
      expect(spectatorView.haunt?.briefing).toBeUndefined();
      expect(spectatorView.haunt?.heroSide).toBeUndefined();
      expect(spectatorView.haunt?.traitorSide).toBeUndefined();

      const spectatorJson = JSON.stringify(spectatorView);
      expect(spectatorJson).not.toContain('Banish the Mummy to eternal sleep');
      expect(spectatorJson).not.toContain('Awaken the ancient Pharaoh');
    });
  });
});
