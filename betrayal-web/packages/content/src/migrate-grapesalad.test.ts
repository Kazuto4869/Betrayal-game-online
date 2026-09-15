import { describe, expect, it } from 'vitest';
import { buildContent } from './load.js';
import { ContentFileSchema } from './schemas.js';
import { migrateGrapeSalad } from './migrate-grapesalad.js';

type LegacyRoom = {
  name: string;
  basement: boolean;
  ground: boolean;
  upper: boolean;
  eventCard: boolean;
  itemCard: boolean;
  omenCard: boolean;
  topDoor: boolean;
  rightDoor: boolean;
  bottomDoor: boolean;
  leftDoor: boolean;
  text: string | null;
  src: string;
};

const trait = (start = 3) => [
  { initialIndex: start, array: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
];

const character = (name: string) => ({
  name,
  speed: trait(),
  might: trait(),
  sanity: trait(),
  knowledge: trait(),
});

function room(name: string, overrides: Partial<LegacyRoom> = {}): LegacyRoom {
  return {
    name,
    basement: false,
    ground: true,
    upper: false,
    eventCard: false,
    itemCard: false,
    omenCard: false,
    topDoor: true,
    rightDoor: false,
    bottomDoor: false,
    leftDoor: false,
    text: null,
    src: `././assets/img/rooms/${name.toLowerCase().replaceAll(' ', '-')}.jpg`,
    ...overrides,
  };
}

const names = [
  'Heather Granville',
  'Jenny LeClerc',
  'Ox Bellows',
  'Darrin Flash Williams',
  'Vivian Lopez',
  'Madame Zostra',
  'Missy Dubourde',
  'Zoe Ingstrom',
  'Peter Akimoto',
  'Brandon Jaspers',
  'Professor Longfellow',
  'Father Rhinehardt',
];

function source(): {
  characters: ReturnType<typeof character>[];
  rooms: LegacyRoom[];
  'stationary-rooms': LegacyRoom[];
} {
  return {
    characters: names.map(character),
    rooms: [
      room('Upper Landing', {
        ground: false,
        upper: true,
        rightDoor: true,
        leftDoor: true,
      }),
      room('Basement Landing', {
        basement: true,
        ground: false,
        rightDoor: true,
        leftDoor: true,
      }),
      room('Stairs from Basement', {
        basement: true,
        ground: false,
        topDoor: true,
        bottomDoor: true,
      }),
      room('Coal Chute', { topDoor: true, text: 'One-way slide to Basement Landing.' }),
      room('The Vault', {
        basement: true,
        ground: false,
        upper: true,
        eventCard: true,
        itemCard: true,
        topDoor: true,
      }),
      room('Bare Room'),
    ],
    'stationary-rooms': [
      room('Entrance Hall', {
        topDoor: true,
        bottomDoor: true,
        leftDoor: true,
        rightDoor: false,
      }),
      room('Foyer', {
        topDoor: true,
        bottomDoor: true,
        leftDoor: true,
        rightDoor: true,
      }),
      room('Grand Staircase', {
        topDoor: false,
        bottomDoor: false,
        leftDoor: true,
        rightDoor: false,
        text: 'Leads to Upper Landing',
      }),
    ],
  };
}

describe('migrateGrapeSalad', () => {
  it('converts Heather Granville tracks and starts', () => {
    const heather = {
      name: 'Heather Granville',
      speed: [{ initialIndex: 3, array: [0, 3, 3, 4, 5, 6, 6, 7, 8] }],
      might: [{ initialIndex: 3, array: [0, 3, 3, 3, 4, 5, 6, 7, 8] }],
      sanity: [{ initialIndex: 3, array: [0, 3, 3, 3, 4, 5, 6, 6, 6] }],
      knowledge: [{ initialIndex: 5, array: [0, 2, 3, 3, 4, 5, 6, 7, 8] }],
    };
    const result = migrateGrapeSalad({ ...source(), characters: [heather] });

    expect(result.characters[0]).toEqual({
      id: 'char.heather_granville',
      name: 'Heather Granville',
      colour: 'purple',
      tracks: {
        speed: [null, 3, 3, 4, 5, 6, 6, 7, 8],
        might: [null, 3, 3, 3, 4, 5, 6, 7, 8],
        sanity: [null, 3, 3, 3, 4, 5, 6, 6, 6],
        knowledge: [null, 2, 3, 3, 4, 5, 6, 7, 8],
      },
      start: { speed: 3, might: 3, sanity: 3, knowledge: 5 },
    });
  });

  it.each([
    ['Heather Granville', 'purple'],
    ['Jenny LeClerc', 'purple'],
    ['Ox Bellows', 'red'],
    ['Darrin Flash Williams', 'red'],
    ['Vivian Lopez', 'blue'],
    ['Madame Zostra', 'blue'],
    ['Missy Dubourde', 'yellow'],
    ['Zoe Ingstrom', 'yellow'],
    ['Peter Akimoto', 'green'],
    ['Brandon Jaspers', 'green'],
    ['Professor Longfellow', 'white'],
    ['Father Rhinehardt', 'white'],
  ] as const)('maps %s to %s', (name, colour) => {
    const result = migrateGrapeSalad({ ...source(), characters: [character(name)] });
    expect(result.characters[0]?.colour).toBe(colour);
  });

  it('rejects an unknown character name', () => {
    expect(() =>
      migrateGrapeSalad({ ...source(), characters: [character('Unknown')] }),
    ).toThrow(/Unknown/);
  });

  it('rejects malformed trait tracks and starts', () => {
    const shortTrack = source();
    shortTrack.characters[0]!.speed[0]!.array = [0, 1, 2, 3, 4, 5, 6, 7];
    expect(() => migrateGrapeSalad(shortTrack)).toThrow(/speed.*array|array.*9/);

    const nonSkull = source();
    nonSkull.characters[0]!.might[0]!.array[0] = 1;
    expect(() => migrateGrapeSalad(nonSkull)).toThrow(/might.*index 0 must be 0/);

    const badStart = source();
    badStart.characters[0]!.sanity[0]!.initialIndex = 0;
    expect(() => migrateGrapeSalad(badStart)).toThrow(/sanity|initialIndex/);
  });

  it('maps rooms, normalizes Vault, and appends the reviewed image-only rooms', () => {
    const result = migrateGrapeSalad(source());
    const vault = result.tiles.find((tile) => tile.name === 'The Vault');
    const collapsed = result.tiles.find((tile) => tile.id === 'tile.collapsed_room');
    const elevator = result.tiles.find((tile) => tile.id === 'tile.mystic_elevator');

    expect(vault?.symbol).toBe('event');
    expect(vault?.doors).toEqual({ n: true, e: false, s: false, w: false });
    expect(collapsed).toMatchObject({
      id: 'tile.collapsed_room',
      floors: ['ground', 'upper'],
      doors: { n: true, e: true, s: true, w: true },
      symbol: 'event',
    });
    expect(elevator).toMatchObject({
      id: 'tile.mystic_elevator',
      floors: ['basement', 'ground', 'upper'],
      doors: { n: true, e: true, s: true, w: true },
      symbol: null,
    });
    expect(result.tiles.some((tile) => tile.id === 'tile.panic_room')).toBe(false);
  });

  it('adds only the supported static links and five-node starting house', () => {
    const result = migrateGrapeSalad(source());
    expect(
      result.tiles.find((tile) => tile.name === 'Grand Staircase')?.staticLinks,
    ).toEqual([{ kind: 'to_tile', target: 'tile.upper_landing', twoWay: true }]);
    expect(
      result.tiles.find((tile) => tile.name === 'Stairs from Basement')?.staticLinks,
    ).toEqual([{ kind: 'to_tile', target: 'tile.foyer', twoWay: true }]);
    expect(result.tiles.find((tile) => tile.name === 'Coal Chute')?.staticLinks).toEqual(
      [],
    );
    expect(
      result.tiles.find((tile) => tile.id === 'tile.mystic_elevator')?.staticLinks,
    ).toEqual([]);
    expect(result.house.startTile).toBe('tile.entrance_hall');
    expect(result.house.layout).toHaveLength(5);
    expect(result.house.landings).toEqual({
      basement: 'tile.basement_landing',
      ground: 'tile.entrance_hall',
      upper: 'tile.upper_landing',
    });
  });

  it('rejects malformed rooms and duplicate names', () => {
    const noFloor = source();
    noFloor.rooms[0]!.basement = false;
    noFloor.rooms[0]!.ground = false;
    noFloor.rooms[0]!.upper = false;
    expect(() => migrateGrapeSalad(noFloor)).toThrow(/Upper Landing.*floor/);

    const noDoor = source();
    noDoor.rooms[0]!.topDoor = false;
    noDoor.rooms[0]!.rightDoor = false;
    noDoor.rooms[0]!.bottomDoor = false;
    noDoor.rooms[0]!.leftDoor = false;
    expect(() => migrateGrapeSalad(noDoor)).toThrow(/Upper Landing.*door/);

    const duplicate = source();
    duplicate.rooms.push({ ...duplicate.rooms[0]! });
    expect(() => migrateGrapeSalad(duplicate)).toThrow(
      /Duplicate room name.*Upper Landing/,
    );

    const twoSymbols = source();
    twoSymbols.rooms[5]!.eventCard = true;
    twoSymbols.rooms[5]!.itemCard = true;
    expect(() => migrateGrapeSalad(twoSymbols)).toThrow(/Bare Room.*discovery/);
  });

  it('is deterministic and produces buildable content', () => {
    const first = migrateGrapeSalad(source());
    const second = migrateGrapeSalad(source());
    expect(second).toEqual(first);
    expect(() => ContentFileSchema.parse(first)).not.toThrow();
    const built = buildContent(first, 'migration-test');
    expect(built.deckTiles).not.toContain('tile.entrance_hall');
    expect(built.deckTiles).not.toContain('tile.upper_landing');
    expect(built.deckTiles).toContain('tile.collapsed_room');
    expect(built.deckTiles).toHaveLength(first.tiles.length - first.house.layout.length);
  });
});
