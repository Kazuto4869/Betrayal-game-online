/**
 * Content validation tests (docs/10-testing-and-ops.md#content-validation-tests).
 *
 * Two jobs. The first half is a tripwire for transcription errors: counts and
 * cross-references over the fixture, which will be re-run against real content
 * the moment it exists. The second half asserts that every coherence check
 * actually rejects the mistake it claims to catch — a validator nobody has
 * seen fail is not a validator.
 */

import { describe, expect, it } from 'vitest';
import charactersJson from '../fixtures/characters.json' with { type: 'json' };
import tilesJson from '../fixtures/tiles.json' with { type: 'json' };
import canonicalTilesJson from '../../../content/tiles.json' with { type: 'json' };
import { COLOURS } from '@bahoth/shared';
import { buildContent, ContentError } from './load.js';
import { fixtureContent } from './fixtures.js';
import { ColourSchema, FloorSchema, TraitSchema } from './schemas.js';
import { EffectSchema, RoomRefSchema } from './effects.js';

export const OFFICIAL_47_LOGICAL_IDS = [
  'tile.entrance_hall',
  'tile.foyer',
  'tile.grand_staircase',
  'tile.upper_landing',
  'tile.basement_landing',
  'tile.servants_quarters',
  'tile.storeroom',
  'tile.operating_laboratory',
  'tile.research_laboratory',
  'tile.stairs_from_basement',
  'tile.underground_lake',
  'tile.wine_cellar',
  'tile.balcony',
  'tile.master_bedroom',
  'tile.bedroom',
  'tile.coal_chute',
  'tile.gardens',
  'tile.ballroom',
  'tile.dining_room',
  'tile.patio',
  'tile.kitchen',
  'tile.abandoned_room',
  'tile.conservatory',
  'tile.charred_room',
  'tile.bloody_room',
  'tile.organ_room',
  'tile.statuary_corridor',
  'tile.creaky_hallway',
  'tile.dusty_hallway',
  'tile.game_room',
  'tile.tower',
  'tile.gallery',
  'tile.catacombs',
  'tile.chasm',
  'tile.junk_room',
  'tile.chapel',
  'tile.gymnasium',
  'tile.the_pentagram_chamber',
  'tile.library',
  'tile.attic',
  'tile.furnace_room',
  'tile.graveyard',
  'tile.larder',
  'tile.crypt',
  'tile.the_vault',
  'tile.collapsed_room',
  'tile.mystic_elevator',
] as const;

export const OFFICIAL_PREPLACED_IDS = [
  'tile.entrance_hall',
  'tile.foyer',
  'tile.grand_staircase',
  'tile.upper_landing',
  'tile.basement_landing',
] as const;

export const NEUTRAL_ROOM_IDS = [
  'tile.servants_quarters',
  'tile.storeroom',
  'tile.operating_laboratory',
  'tile.research_laboratory',
  'tile.underground_lake',
  'tile.wine_cellar',
  'tile.balcony',
  'tile.master_bedroom',
  'tile.bedroom',
  'tile.gardens',
  'tile.ballroom',
  'tile.dining_room',
  'tile.patio',
  'tile.kitchen',
  'tile.abandoned_room',
  'tile.conservatory',
  'tile.charred_room',
  'tile.bloody_room',
  'tile.organ_room',
  'tile.statuary_corridor',
  'tile.creaky_hallway',
  'tile.dusty_hallway',
  'tile.game_room',
] as const;

/** Content before validation is exactly as untyped as the JSON it came from. */
type Raw = Record<string, any>;

/** A fresh mutable copy of the fixture, as it arrives before validation. */
function raw(): Raw {
  return structuredClone({ ...charactersJson, ...tilesJson }) as Raw;
}

function tileIn(file: Raw, id: string): Raw {
  const tile = file.tiles.find((t: Raw) => t.id === id);
  if (!tile) throw new Error(`fixture has no ${id}; this test needs updating`);
  return tile;
}

function expectRejected(file: Raw, match: RegExp): void {
  expect(() => buildContent(file, 'test')).toThrow(ContentError);
  expect(() => buildContent(file, 'test')).toThrow(match);
}

describe('official 2E room set and neutral rooms', () => {
  it('contains exactly the expected 47 logical tile IDs in canonical content', () => {
    const ids = canonicalTilesJson.tiles.map((t: Raw) => t.id).sort();
    const expected = [...OFFICIAL_47_LOGICAL_IDS].sort();
    expect(ids).toEqual(expected);

    const layoutIds = canonicalTilesJson.house.layout.map((p: Raw) => p.tileId).sort();
    const expectedPreplaced = [...OFFICIAL_PREPLACED_IDS].sort();
    expect(layoutIds).toEqual(expectedPreplaced);

    const drawable = canonicalTilesJson.tiles.filter(
      (t: Raw) => !layoutIds.includes(t.id),
    );
    expect(drawable).toHaveLength(42);
    expect(canonicalTilesJson.house.layout).toHaveLength(5);
    expect(canonicalTilesJson.tiles).toHaveLength(47);

    // Retains official image-only 2E base rooms
    expect(ids).toContain('tile.collapsed_room');
    expect(ids).toContain('tile.mystic_elevator');

    // Excludes expansion-only rooms
    expect(ids).not.toContain('tile.panic_room');
  });

  it('ensures Operating Laboratory, Research Laboratory, Gardens, and all neutral rooms have empty mechanical hook arrays', () => {
    for (const neutralId of NEUTRAL_ROOM_IDS) {
      const tile = canonicalTilesJson.tiles.find((t: Raw) => t.id === neutralId);
      expect(tile, `canonical neutral room ${neutralId} must exist`).toBeDefined();
      expect(tile.onEnter ?? [], `${neutralId} must have empty onEnter hook`).toEqual([]);
    }
  });

  it('verifies exact floor eligibility for all 47 official logical room tiles against 2E rulebook / legacy table', () => {
    const expectedFloorTable: Record<string, ('basement' | 'ground' | 'upper')[]> = {
      'tile.entrance_hall': ['ground'],
      'tile.foyer': ['ground'],
      'tile.grand_staircase': ['ground'],
      'tile.upper_landing': ['upper'],
      'tile.basement_landing': ['basement'],
      'tile.stairs_from_basement': ['basement'],
      'tile.underground_lake': ['basement'],
      'tile.wine_cellar': ['basement'],
      'tile.catacombs': ['basement'],
      'tile.chasm': ['basement'],
      'tile.the_pentagram_chamber': ['basement'],
      'tile.furnace_room': ['basement'],
      'tile.larder': ['basement'],
      'tile.crypt': ['basement'],
      'tile.balcony': ['upper'],
      'tile.master_bedroom': ['upper'],
      'tile.bedroom': ['upper'],
      'tile.tower': ['upper'],
      'tile.gallery': ['upper'],
      'tile.attic': ['upper'],
      'tile.coal_chute': ['ground'],
      'tile.gardens': ['ground'],
      'tile.ballroom': ['ground'],
      'tile.dining_room': ['ground'],
      'tile.patio': ['ground'],
      'tile.graveyard': ['ground'],
      'tile.servants_quarters': ['basement', 'upper'],
      'tile.storeroom': ['basement', 'upper'],
      'tile.operating_laboratory': ['basement', 'upper'],
      'tile.research_laboratory': ['basement', 'upper'],
      'tile.gymnasium': ['basement', 'upper'],
      'tile.the_vault': ['basement', 'upper'],
      'tile.kitchen': ['basement', 'ground'],
      'tile.abandoned_room': ['basement', 'ground'],
      'tile.conservatory': ['ground', 'upper'],
      'tile.charred_room': ['ground', 'upper'],
      'tile.bloody_room': ['ground', 'upper'],
      'tile.chapel': ['ground', 'upper'],
      'tile.library': ['ground', 'upper'],
      'tile.collapsed_room': ['ground', 'upper'],
      'tile.organ_room': ['basement', 'ground', 'upper'],
      'tile.statuary_corridor': ['basement', 'ground', 'upper'],
      'tile.creaky_hallway': ['basement', 'ground', 'upper'],
      'tile.dusty_hallway': ['basement', 'ground', 'upper'],
      'tile.game_room': ['basement', 'ground', 'upper'],
      'tile.junk_room': ['basement', 'ground', 'upper'],
      'tile.mystic_elevator': ['basement', 'ground', 'upper'],
    };

    expect(Object.keys(expectedFloorTable)).toHaveLength(47);

    for (const [tileId, expectedFloors] of Object.entries(expectedFloorTable)) {
      const tile = canonicalTilesJson.tiles.find((t: Raw) => t.id === tileId);
      expect(tile, `Tile ${tileId} must exist in canonical tiles`).toBeDefined();
      expect(
        [...(tile.floors as string[])].sort(),
        `Tile ${tileId} must have exact floors ${expectedFloors.join(', ')}`,
      ).toEqual([...expectedFloors].sort());
    }
  });

  it('verifies exact symbol coverage: 13 omen, 4 item, 18 event, 7 drawable none', () => {
    const layoutIds = canonicalTilesJson.house.layout.map((p: Raw) => p.tileId);
    const drawable = canonicalTilesJson.tiles.filter(
      (t: Raw) => !layoutIds.includes(t.id),
    );

    const symbolCounts = { omen: 0, item: 0, event: 0, none: 0 };
    for (const t of drawable) {
      const sym = (t.symbol as 'omen' | 'item' | 'event' | null) ?? 'none';
      symbolCounts[sym]++;
    }

    expect(symbolCounts).toEqual({
      omen: 13,
      item: 4,
      event: 18,
      none: 7,
    });
  });

  it('keeps canonical content and fixture copies synchronized', () => {
    expect(tilesJson).toEqual(canonicalTilesJson);
  });
});

describe('the fixture house', () => {
  const content = fixtureContent();

  it('has the expected component counts', () => {
    // The tripwire. 44 room tiles (2 preplaced landings + 42 drawable), plus the
    // three starting rooms representing the single physical starting tile.
    expect(content.house.layout).toHaveLength(5);
    expect(content.deckTiles).toHaveLength(42);
    expect(content.tiles).toHaveLength(47);
    expect(content.characters).toHaveLength(12);
  });

  it('gives every explorer somewhere to start', () => {
    const start = content.house.layout.find((p) => p.tileId === content.house.startTile);
    expect(start).toBeDefined();
    expect(start?.floor).toBe('ground');
  });

  it('can discover a room on every floor', () => {
    for (const floor of FloorSchema.options) {
      const legal = content.deckTiles.filter((id) =>
        content.tilesById[id]?.floors.includes(floor),
      );
      expect(legal.length, `no drawable tile for the ${floor}`).toBeGreaterThan(0);
    }
  });

  it('resolves every static link', () => {
    const links = content.tiles.flatMap((t) => t.staticLinks.map((l) => [t, l] as const));
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const [tile, link] of links) {
      if (link.kind === 'to_tile') {
        expect(
          content.tilesById[link.target],
          `${tile.id} -> ${link.target}`,
        ).toBeDefined();
      } else if (link.kind === 'to_floor') {
        expect(link.landing).toBe(content.house.landings[link.floor]);
      } else {
        expect(tile.floors).not.toContain(link.floor);
      }
    }
  });

  it('gives every tile a door and a legal floor to sit on', () => {
    for (const tile of content.tiles) {
      expect(Object.values(tile.doors).some(Boolean), `${tile.id} has no door`).toBe(
        true,
      );
      expect(tile.floors.length).toBeGreaterThan(0);
    }
    for (const placed of content.house.layout) {
      expect(content.tilesById[placed.tileId]?.floors).toContain(placed.floor);
    }
  });

  it('leaves the deck unshuffled and one entry per copy', () => {
    const file = raw();
    tileIn(file, 'tile.dining_room').copies = 3;
    const built = buildContent(file, 'test');

    expect(built.deckTiles).toHaveLength(44);
    expect(built.deckTiles.filter((id) => id === 'tile.dining_room')).toHaveLength(3);
    // File order, so a given content bundle always deals the same deck before
    // the engine's seeded shuffle touches it.
    const again = raw();
    tileIn(again, 'tile.dining_room').copies = 3;
    expect(built.deckTiles).toEqual(buildContent(again, 'test').deckTiles);
  });

  it('keeps no pre-placed tile in the deck', () => {
    for (const placed of content.house.layout) {
      expect(content.deckTiles).not.toContain(placed.tileId);
    }
  });
});

describe('the content hash', () => {
  it('is stable for identical input and moves when a tile changes', () => {
    const a = buildContent(raw(), 'test');
    const b = buildContent(raw(), 'test');
    expect(a.hash).toBe(b.hash);

    const changed = raw();
    tileIn(changed, 'tile.creaky_hallway').doors.e = false;
    expect(buildContent(changed, 'test').hash).not.toBe(a.hash);
  });
});

describe('the Colour enum', () => {
  it('matches @bahoth/shared COLOURS exactly', () => {
    // Colour is a domain enum, not a content or rendering concern, so it is
    // hand-written once in packages/shared/src/ids.ts (docs/03-architecture.md
    // #dependency-rules) rather than derived from this schema. This is the
    // tripwire: add a colour here without updating shared (or vice versa) and
    // this fails loudly instead of the client silently disagreeing.
    expect(ColourSchema.options).toEqual(COLOURS);
  });
});

describe("effects.ts's Floor/Trait copies", () => {
  // effects.ts duplicates FloorSchema/TraitSchema rather than import them
  // (importing would make schemas.ts and effects.ts circular — see the
  // comment there). This is the tripwire for the two drifting.
  it('accept every floor and trait schemas.ts declares', () => {
    for (const floor of FloorSchema.options) {
      expect(RoomRefSchema.safeParse({ random: floor }).success).toBe(true);
    }
    for (const trait of TraitSchema.options) {
      expect(
        EffectSchema.safeParse({ e: 'trait', who: 'actor', trait, delta: 1 }).success,
      ).toBe(true);
    }
  });

  it('reject a floor/trait that does not exist', () => {
    expect(RoomRefSchema.safeParse({ random: 'attic' }).success).toBe(false);
    expect(
      EffectSchema.safeParse({ e: 'trait', who: 'actor', trait: 'luck', delta: 1 })
        .success,
    ).toBe(false);
  });
});

describe('coherence checks reject', () => {
  it('a duplicate tile id', () => {
    const file = raw();
    file.tiles.push(structuredClone(tileIn(file, 'tile.dining_room')));
    expectRejected(file, /Duplicate tile id/);
  });

  it('a tile with no doors', () => {
    const file = raw();
    tileIn(file, 'tile.dining_room').doors = { n: false, e: false, s: false, w: false };
    expectRejected(file, /has no doors/);
  });

  it('a tile that lists a floor twice', () => {
    const file = raw();
    tileIn(file, 'tile.dining_room').floors = ['ground', 'ground'];
    expectRejected(file, /lists a floor twice/);
  });

  it('a link to a tile that does not exist', () => {
    const file = raw();
    tileIn(file, 'tile.stairs_from_basement').staticLinks = [
      { kind: 'to_tile', target: 'tile.nowhere', twoWay: true },
    ];
    expectRejected(file, /links to unknown tile/);
  });

  it('a link from a tile to itself', () => {
    const file = raw();
    tileIn(file, 'tile.stairs_from_basement').staticLinks = [
      { kind: 'to_tile', target: 'tile.stairs_from_basement', twoWay: true },
    ];
    expectRejected(file, /links to itself/);
  });

  it('a floor link that disagrees with the house about the landing', () => {
    const file = raw();
    tileIn(file, 'tile.stairs_from_basement').staticLinks = [
      { kind: 'to_floor', floor: 'upper', landing: 'tile.foyer', twoWay: true },
    ];
    expectRejected(file, /the house declares/);
  });

  it('a drop onto a floor the tile may itself be placed on', () => {
    const file = raw();
    tileIn(file, 'tile.stairs_from_basement').staticLinks = [
      { kind: 'oneway_drop', floor: 'basement' },
    ];
    expectRejected(file, /which it may also be placed on/);
  });

  it('a floor with nothing drawable on it', () => {
    const file = raw();
    for (const tile of file.tiles as Raw[]) {
      if (tile.floors.includes('upper')) {
        tile.floors = tile.floors.filter((f: string) => f !== 'upper');
      }
      if (tile.floors.length === 0) tile.floors = ['ground'];
    }
    // The upper landing has to stay upstairs or the layout fails first.
    tileIn(file, 'tile.upper_landing').floors = ['upper'];
    expectRejected(file, /No drawable tile may be placed on the upper/);
  });

  it('an empty deck', () => {
    const file = raw();
    file.tiles = file.tiles.filter((t: Raw) =>
      file.house.layout.some((p: Raw) => p.tileId === t.id),
    );
    expectRejected(file, /tile deck is empty/);
  });

  it('a starting layout that places a tile it has never heard of', () => {
    const file = raw();
    file.house.layout[0].tileId = 'tile.nowhere';
    expectRejected(file, /places unknown tile/);
  });

  it('a starting layout that places one tile twice', () => {
    const file = raw();
    file.house.layout.push({ ...file.house.layout[0], x: 9, y: 9 });
    expectRejected(file, /more than once/);
  });

  it('a starting tile on a floor it does not allow', () => {
    const file = raw();
    file.house.layout[0].floor = 'upper';
    expectRejected(file, /which it does not allow/);
  });

  it('two starting tiles in one cell', () => {
    const file = raw();
    file.house.layout[1].x = file.house.layout[0].x;
    file.house.layout[1].y = file.house.layout[0].y;
    expectRejected(file, /share the cell/);
  });

  it('a pre-placed tile that declares extra copies', () => {
    const file = raw();
    tileIn(file, 'tile.foyer').copies = 2;
    expectRejected(file, /declares 2 copies/);
  });

  it('a start tile that is not on the board', () => {
    const file = raw();
    file.house.startTile = 'tile.dining_room';
    expectRejected(file, /the starting layout does not place/);
  });

  it('a landing that is not pre-placed on its own floor', () => {
    const file = raw();
    file.house.landings.upper = 'tile.foyer';
    tileIn(file, 'tile.grand_staircase').staticLinks = [];
    expectRejected(file, /is not pre-placed on the upper/);
  });

  it('a character who starts on the skull', () => {
    const file = raw();
    file.characters[0].start.might = 0;
    expectRejected(file, /failed validation/);
  });

  describe('card use policy validation', () => {
    it('rejects a passive card that has onUse effects', () => {
      const file = raw();
      file.cards = [
        {
          id: 'test.passive_with_use',
          deck: 'item',
          name: 'Bad Passive',
          text: 'Should not have onUse',
          use: { kind: 'passive' },
          onUse: [{ e: 'log', text: 'illegal' }],
        },
      ];
      expectRejected(file, /passive use policy but specifies onUse/);
    });

    it('rejects a consumable card without onUse effects', () => {
      const file = raw();
      file.cards = [
        {
          id: 'test.empty_consumable',
          deck: 'item',
          name: 'Bad Consumable',
          text: 'Empty consumable',
          use: { kind: 'consumable' },
          onUse: [],
        },
      ];
      expectRejected(file, /consumable use policy but specifies no onUse/);
    });

    it('rejects a once_per_turn card without onUse effects', () => {
      const file = raw();
      file.cards = [
        {
          id: 'test.empty_once_per_turn',
          deck: 'item',
          name: 'Bad Once Per Turn',
          text: 'Empty once per turn',
          use: { kind: 'once_per_turn' },
          onUse: [],
        },
      ];
      expectRejected(file, /once_per_turn use policy but specifies no onUse/);
    });

    it('rejects a manual card with onUse effects', () => {
      const file = raw();
      file.cards = [
        {
          id: 'test.manual_with_use',
          deck: 'item',
          name: 'Bad Manual',
          text: 'Manual with code',
          use: { kind: 'manual' },
          onUse: [{ e: 'log', text: 'illegal' }],
        },
      ];
      expectRejected(file, /manual use policy but specifies onUse/);
    });

    it('accepts valid passive, consumable, and once_per_turn cards', () => {
      const file = raw();
      file.cards = [
        {
          id: 'test.good_passive',
          deck: 'item',
          name: 'Good Passive',
          text: 'Passive item',
          use: { kind: 'passive' },
          onUse: [],
        },
        {
          id: 'test.good_consumable',
          deck: 'item',
          name: 'Good Consumable',
          text: 'Consumable item',
          use: { kind: 'consumable' },
          onUse: [{ e: 'log', text: 'used' }],
        },
        {
          id: 'test.good_once_per_turn',
          deck: 'item',
          name: 'Good Once Per Turn',
          text: 'Once per turn item',
          use: { kind: 'once_per_turn' },
          onUse: [{ e: 'log', text: 'used once' }],
        },
      ];
      const parsed = buildContent(file, 'test');
      expect(parsed.cardsById['test.good_passive']).toBeDefined();
      expect(parsed.cardsById['test.good_consumable']).toBeDefined();
      expect(parsed.cardsById['test.good_once_per_turn']).toBeDefined();
    });
  });

  describe('tile rule hooks and metadata schema & coherence', () => {
    it('rejects duplicate room action IDs on a tile', () => {
      const file = raw();
      const vault = tileIn(file, 'tile.the_vault');
      vault.ruleText = 'Vault rule';
      vault.actions = [
        {
          id: 'action.the_vault.open',
          name: 'Open Vault',
          cadence: { kind: 'once_per_game', key: 'vault_empty', scope: 'tile' },
          effects: [{ e: 'log', text: 'Opened' }],
        },
        {
          id: 'action.the_vault.open',
          name: 'Open Vault Duplicate',
          cadence: { kind: 'once_per_game', key: 'vault_empty', scope: 'tile' },
          effects: [{ e: 'log', text: 'Opened again' }],
        },
      ];
      expectRejected(file, /duplicate room action id/i);
    });

    it('rejects crossing metadata on a tile without two appropriate exits', () => {
      const file = raw();
      const room = tileIn(file, 'tile.dining_room');
      room.ruleText = 'Crossing rule';
      room.doors = { n: true, e: false, s: false, w: false };
      room.crossing = { trait: 'speed', threshold: 3 };
      expectRejected(file, /crossing.*two.*exits/i);
    });

    it('rejects empty executable room actions', () => {
      const file = raw();
      const vault = tileIn(file, 'tile.the_vault');
      vault.ruleText = 'Vault rule';
      vault.actions = [
        {
          id: 'action.the_vault.open',
          name: 'Open Vault',
          cadence: { kind: 'once_per_game', key: 'vault_empty', scope: 'tile' },
          effects: [],
        },
      ];
      expectRejected(file, /empty.*action|at least one executable effect/i);
    });

    it('rejects once-per-game declarations lacking a persistent flag key or scope', () => {
      const file = raw();
      const vault = tileIn(file, 'tile.the_vault');
      vault.ruleText = 'Vault rule';
      vault.actions = [
        {
          id: 'action.the_vault.open',
          name: 'Open Vault',
          cadence: { kind: 'once_per_game' } as any,
          effects: [{ e: 'log', text: 'Opened' }],
        },
      ];
      expectRejected(file, /once-per-game.*flag.*key|failed validation/i);
    });

    it('rejects executable room hooks without ruleText', () => {
      const file = raw();
      const junk = tileIn(file, 'tile.junk_room');
      delete junk.ruleText;
      junk.onExit = [{ e: 'log', text: 'exited' }];
      expectRejected(file, /missing ruleText|executable room hook/i);
    });

    it('rejects ruleText on neutral rooms', () => {
      const file = raw();
      const neutral = tileIn(file, 'tile.servants_quarters');
      neutral.ruleText = 'Neutral room should not have rule text';
      expectRejected(file, /neutral room.*ruleText/i);
    });
  });

  describe('Task 10: 2E Haunt books and official Haunt Chart', () => {
    const content = fixtureContent();

    it('contains exactly 50 haunts with unique IDs from 1 to 50', () => {
      expect(content.haunts).toHaveLength(50);
      const ids = content.haunts.map((h) => h.id).sort((a, b) => a - b);
      expect(ids).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    });

    it('every haunt has a non-empty name and structured hero and traitor entries', () => {
      for (const h of content.haunts) {
        expect(h.name.length).toBeGreaterThan(0);
        expect(h.heroes).toBeDefined();
        expect(h.heroes.goal.length).toBeGreaterThan(0);
        expect(h.heroes.rules.length).toBeGreaterThan(0);

        expect(h.traitor).toBeDefined();
        expect(h.traitor.goal.length).toBeGreaterThan(0);
        expect(h.traitor.rules.length).toBeGreaterThan(0);

        if (!h.hasTraitor) {
          expect([12, 31, 50]).toContain(h.id);
          expect(h.traitorRule.kind).toBe('none');
        }
        if (h.hasHiddenTraitor) {
          expect([9, 34, 43]).toContain(h.id);
        }
      }
    });

    it('has official 2E Haunt Chart with exactly 169 combinations (13 rooms x 13 omens)', () => {
      expect(content.hauntChart).toHaveLength(169);
      for (const entry of content.hauntChart) {
        expect(entry.hauntId).toBeGreaterThanOrEqual(1);
        expect(entry.hauntId).toBeLessThanOrEqual(50);
        expect(entry.roomTileId.startsWith('tile.')).toBe(true);
        expect(entry.omenCardId.startsWith('omen.')).toBe(true);
      }

      // Spot-check classic known mappings:
      // Abandoned Room + Girl -> Haunt 1 (The Mummy Walks)
      expect(content.hauntByOmenAndRoom['omen.girl:tile.abandoned_room']).toBe(1);
      // Catacombs + Bite -> Haunt 4 (The Web of Destiny)
      expect(content.hauntByOmenAndRoom['omen.bite:tile.catacombs']).toBe(4);
      // Balcony + Crystal Ball -> Haunt 32 (Lost)
      expect(content.hauntByOmenAndRoom['omen.crystal_ball:tile.balcony']).toBe(32);
      // Pentagram Chamber + Book -> Haunt 50 (Treasure Hunt)
      expect(content.hauntByOmenAndRoom['omen.book:tile.the_pentagram_chamber']).toBe(50);
    });
  });
});
