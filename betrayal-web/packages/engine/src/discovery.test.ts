/**
 * Discovery mechanics tested in isolation from the reducer: `legalRotations`
 * and `drawTile` are pure and have no `pending`/event plumbing to fake, so
 * they get their own file rather than living entirely inside reduce.test.ts.
 * See docs/02-rules-model.md#24 step 3 and its [RULING] on the draw.
 */

import { describe, expect, it } from 'vitest';
import { buildContent, fixtureContent, type Content, type Tile } from '@bahoth/content';
import { DIRS, rotateDoors, type Doors, type Rotation } from '@bahoth/shared';
import { makeRng } from './rng.js';
import { drawTile, legalRotations, wouldSealFloor } from './discovery.js';

function tile(id: string, doors: Partial<Doors>, opts: Partial<Tile> = {}): Tile {
  return {
    id,
    name: id,
    doors: { n: false, e: false, s: false, w: false, ...doors },
    floors: ['ground'],
    symbol: null,
    copies: 1,
    staticLinks: [],
    onEnter: [],
    onExit: [],
    onEndTurn: [],
    actions: [],
    ...opts,
  };
}

const content = fixtureContent();

describe('legalRotations', () => {
  it('gives exactly one rotation for a one-door tile, entered from any side', () => {
    const t = tile('tile.one_door', { n: true });
    for (const entry of DIRS) {
      const rots = legalRotations(t, entry);
      expect(rots).toHaveLength(1);
      // Not hardcoding which rotation — assert the actual property: after
      // that rotation, the tile really has a door on `entry`.
      expect(rotateDoors(t.doors, rots[0]!)[entry]).toBe(true);
    }
  });

  it('dedupes a four-door tile down to exactly one rotation', () => {
    const t = tile('tile.four_door', { n: true, e: true, s: true, w: true });
    for (const entry of DIRS) {
      const rots = legalRotations(t, entry);
      expect(rots).toHaveLength(1);
    }
  });

  it('collapses an opposite-door tile to one rotation (180-degree symmetric)', () => {
    const t = tile('tile.through_hall', { n: true, s: true });
    for (const entry of DIRS) {
      expect(legalRotations(t, entry)).toHaveLength(1);
    }
  });

  it('gives two distinct rotations for an adjacent two-door tile on either door', () => {
    const t = tile('tile.corner', { n: true, e: true });
    const rots = legalRotations(t, 'n');
    expect(rots).toHaveLength(2);
    expect(new Set(rots).size).toBe(2);
    for (const r of rots) {
      expect(rotateDoors(t.doors, r).n).toBe(true);
    }
  });

  it('is never empty for any fixture tile at any entry direction', () => {
    for (const t of content.tiles) {
      for (const entry of DIRS) {
        expect(
          legalRotations(t, entry).length,
          `${t.id} entered from ${entry}`,
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe('drawTile (Official 2E Shared-Stack Algorithm)', () => {
  const landG = tile('tile.land_ground', { n: true }, { floors: ['ground'] });
  const landB = tile('tile.land_basement', { n: true }, { floors: ['basement'] });
  const landU = tile('tile.land_upper', { n: true }, { floors: ['upper'] });
  const bDeck = tile('tile.basement_only', { n: true }, { floors: ['basement'] });
  const uDeck = tile('tile.upper_only', { n: true }, { floors: ['upper'] });
  const b = tile('tile.ground_1', { n: true }, { floors: ['ground'] });
  const c = tile('tile.ground_2', { n: true }, { floors: ['ground'] });
  const d = tile('tile.ground_3', { n: true }, { floors: ['ground'] });
  const groundContent: Content = buildContent(
    {
      characters: fixtureContent().characters,
      tiles: [landG, landB, landU, bDeck, uDeck, b, c, d],
      house: {
        layout: [
          { tileId: landG.id, floor: 'ground', x: 0, y: 0, rotation: 0 as Rotation },
          { tileId: landB.id, floor: 'basement', x: 0, y: 0, rotation: 0 as Rotation },
          { tileId: landU.id, floor: 'upper', x: 0, y: 0, rotation: 0 as Rotation },
        ],
        startTile: landG.id,
        landings: { basement: landB.id, ground: landG.id, upper: landU.id },
      },
    },
    'discovery.test.ts',
  );

  it('skips a tile illegal on the floor, sets it aside in discard, and returns first legal one without burning RNG', () => {
    const rng = makeRng(1);
    const draw = drawTile([bDeck.id, b.id, c.id], [], 'ground', groundContent, rng);
    expect(draw).not.toBeNull();
    expect(draw!.tileId).toBe(b.id);
    expect(draw!.deck).toEqual([c.id]);
    expect(draw!.discard).toEqual([bDeck.id]);
    // Does not burn RNG while drawing from current live stack
    expect(draw!.rng).toEqual(rng);
  });

  it('preserves order of remaining deck and accumulates set-aside tiles in discard', () => {
    const rng = makeRng(1);
    const deck = [bDeck.id, uDeck.id, b.id, c.id, d.id];
    const draw = drawTile(deck, ['tile.existing_discard'], 'ground', groundContent, rng);
    expect(draw).not.toBeNull();
    expect(draw!.tileId).toBe(b.id);
    expect(draw!.deck).toEqual([c.id, d.id]);
    expect(draw!.discard).toEqual(['tile.existing_discard', bDeck.id, uDeck.id]);
    expect(draw!.rng).toEqual(rng);
  });

  it('does not burn a random number on a plain top-of-deck draw', () => {
    const rng = makeRng(1);
    const draw = drawTile([b.id, c.id, d.id], [], 'ground', groundContent, rng);
    expect(draw).not.toBeNull();
    expect(draw!.rng).toEqual(rng);
    expect(draw!.deck).toEqual([c.id, d.id]);
    expect(draw!.discard).toEqual([]);
  });

  it('burns randomness only when live deck is exhausted and discard must be reshuffled', () => {
    const rng = makeRng(1);
    // Live deck has only basement tiles, discard has ground tile `b`
    const draw = drawTile([bDeck.id], [b.id], 'ground', groundContent, rng);
    expect(draw).not.toBeNull();
    expect(draw!.tileId).toBe(b.id);
    // RNG was burned to reshuffle discard into the new live deck
    expect(draw!.rng).not.toEqual(rng);
  });

  it('returns null when neither deck nor discard contains a tile for the floor', () => {
    const rng = makeRng(1);
    const draw = drawTile([bDeck.id], [], 'upper', groundContent, rng);
    expect(draw).toBeNull();
  });
});

describe('wouldSealFloor (2E Rulebook Floor Sealing Invariant)', () => {
  const deadEndTile = tile('tile.dead_end', { s: true }); // Only 1 door at south
  const crossTile = tile('tile.cross', { n: true, e: true, s: true, w: true });

  it('returns false when other open doorways exist on the floor', () => {
    const startTile = tile('tile.start', { n: true, e: true }); // Two doors: n and e
    const board = {
      placed: {
        'placed.start': {
          id: 'placed.start',
          tileId: startTile.id,
          floor: 'ground' as const,
          x: 0,
          y: 0,
          rotation: 0 as const,
          doors: startTile.doors,
          discoveredBy: '0' as const,
          flags: {},
        },
      },
      index: {
        basement: {},
        ground: { '0,0': 'placed.start' },
        upper: {},
      },
    };

    // Placing deadEnd at (0, -1) [north of start]. South door connects to start (0, 0).
    // East doorway of start at (1, 0) remains open!
    const seals = wouldSealFloor(board, deadEndTile, 0, 'ground', 0, -1);
    expect(seals).toBe(false);
  });

  it('returns true when this is the only open doorway on the floor and placing the tile leaves no open doors', () => {
    const startTile = tile('tile.start', { n: true }); // ONLY one door at north
    const board = {
      placed: {
        'placed.start': {
          id: 'placed.start',
          tileId: startTile.id,
          floor: 'ground' as const,
          x: 0,
          y: 0,
          rotation: 0 as const,
          doors: startTile.doors,
          discoveredBy: '0' as const,
          flags: {},
        },
      },
      index: {
        basement: {},
        ground: { '0,0': 'placed.start' },
        upper: {},
      },
    };

    // Placing deadEnd at (0, -1) [north of start]. Its south door connects to start.
    // Zero other doors exist, so floor would have 0 open doorways!
    const seals = wouldSealFloor(board, deadEndTile, 0, 'ground', 0, -1);
    expect(seals).toBe(true);

    // If placing a 4-door room instead, it provides north, east, west doors to empty space!
    const sealsCross = wouldSealFloor(board, crossTile, 0, 'ground', 0, -1);
    expect(sealsCross).toBe(false);
  });
});
