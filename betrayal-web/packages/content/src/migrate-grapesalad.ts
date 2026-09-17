import { z } from 'zod';
import {
  ContentFileSchema,
  type Character,
  type ContentFile,
  type Tile,
} from './schemas.js';

type TraitName = 'speed' | 'might' | 'sanity' | 'knowledge';
const TRAITS: readonly TraitName[] = ['speed', 'might', 'sanity', 'knowledge'];
const FLOORS = ['basement', 'ground', 'upper'] as const;

const LegacyTrackSchema = z
  .array(
    z.object({
      initialIndex: z.number().int().min(1).max(8),
      array: z.array(z.number()).length(9),
    }),
  )
  .length(1);

const LegacyCharacterSchema = z.object({
  name: z.string().min(1),
  speed: LegacyTrackSchema,
  might: LegacyTrackSchema,
  sanity: LegacyTrackSchema,
  knowledge: LegacyTrackSchema,
});

const LegacyRoomSchema = z.object({
  name: z.string().min(1),
  basement: z.boolean(),
  ground: z.boolean(),
  upper: z.boolean(),
  eventCard: z.boolean(),
  itemCard: z.boolean(),
  omenCard: z.boolean(),
  topDoor: z.boolean(),
  rightDoor: z.boolean(),
  bottomDoor: z.boolean(),
  leftDoor: z.boolean(),
  text: z.string().nullable(),
  src: z.string(),
});

const LegacySourceSchema = z.object({
  characters: z.array(LegacyCharacterSchema).min(1),
  rooms: z.array(LegacyRoomSchema),
  'stationary-rooms': z.array(LegacyRoomSchema),
});

const COLOUR_BY_CHARACTER: Record<string, Character['colour']> = {
  'Heather Granville': 'purple',
  'Jenny LeClerc': 'purple',
  'Ox Bellows': 'red',
  'Darrin Flash Williams': 'red',
  'Vivian Lopez': 'blue',
  'Madame Zostra': 'blue',
  'Missy Dubourde': 'yellow',
  'Zoe Ingstrom': 'yellow',
  'Peter Akimoto': 'green',
  'Brandon Jaspers': 'green',
  'Professor Longfellow': 'white',
  'Father Rhinehardt': 'white',
};

function sourceValidationError(error: z.ZodError): Error {
  const issues = error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('\n');
  return new Error(`Legacy GrapeSalad source failed validation:\n${issues}`);
}

function parseSource(source: unknown): z.infer<typeof LegacySourceSchema> {
  const parsed = LegacySourceSchema.safeParse(source);
  if (!parsed.success) throw sourceValidationError(parsed.error);
  return parsed.data;
}

function snakeCase(value: string): string {
  return value
    .normalize('NFKD')
    .replaceAll(/[^\w\s-']/g, '')
    .replaceAll("'", '')
    .trim()
    .toLowerCase()
    .replaceAll(/[\s-]+/g, '_');
}

function convertTrack(
  name: string,
  trait: TraitName,
  legacy: z.infer<typeof LegacyTrackSchema>[number],
): { values: [null, ...number[]]; start: number } {
  const [skull, ...playable] = legacy.array;
  if (skull !== 0) throw new Error(`${name} ${trait} index 0 must be 0`);
  return { values: [null, ...playable], start: legacy.initialIndex };
}

function convertCharacter(legacy: z.infer<typeof LegacyCharacterSchema>): Character {
  const colour = COLOUR_BY_CHARACTER[legacy.name];
  if (!colour) throw new Error(`Unknown character name: ${legacy.name}`);

  const tracks = {} as Character['tracks'];
  const start = {} as Character['start'];
  for (const trait of TRAITS) {
    const converted = convertTrack(legacy.name, trait, legacy[trait][0]!);
    tracks[trait] = converted.values;
    start[trait] = converted.start;
  }

  return {
    id: `char.${snakeCase(legacy.name)}`,
    name: legacy.name,
    colour,
    tracks,
    start,
  };
}

function symbolForRoom(room: z.infer<typeof LegacyRoomSchema>): Tile['symbol'] {
  const isVault = room.name === 'Vault' || room.name === 'The Vault';
  const symbols = [
    room.eventCard ? 'event' : null,
    room.itemCard ? 'item' : null,
    room.omenCard ? 'omen' : null,
  ].filter((symbol): symbol is NonNullable<Tile['symbol']> => symbol !== null);

  if (isVault) return 'event';
  if (symbols.length > 1) {
    throw new Error(`${room.name} has multiple discovery symbols`);
  }
  return symbols[0] ?? null;
}

function staticLinksForRoom(room: z.infer<typeof LegacyRoomSchema>): Tile['staticLinks'] {
  switch (room.name) {
    case 'Grand Staircase':
      return [{ kind: 'to_tile', target: 'tile.upper_landing', twoWay: true }];
    case 'Stairs from Basement':
      return [{ kind: 'to_tile', target: 'tile.foyer', twoWay: true }];
    default:
      return [];
  }
}

function convertRoom(room: z.infer<typeof LegacyRoomSchema>): Tile {
  const floors = FLOORS.filter((floor) => room[floor]);
  if (floors.length === 0) throw new Error(`${room.name} has no true floor`);

  const doors = {
    n: room.topDoor,
    e: room.rightDoor,
    s: room.bottomDoor,
    w: room.leftDoor,
  };
  if (!Object.values(doors).some(Boolean))
    throw new Error(`${room.name} has no true door`);

  return {
    id: `tile.${snakeCase(room.name)}`,
    name: room.name,
    doors,
    floors,
    symbol: symbolForRoom(room),
    copies: 1,
    staticLinks: staticLinksForRoom(room),
    onEnter: [],
    onExit: [],
    onEndTurn: [],
    actions: [],
  };
}

const IMAGE_ONLY_TILES: Tile[] = [
  {
    id: 'tile.collapsed_room',
    name: 'Collapsed Room',
    floors: ['ground', 'upper'],
    doors: { n: true, e: true, s: true, w: true },
    symbol: 'event',
    copies: 1,
    staticLinks: [],
    onEnter: [],
    onExit: [],
    onEndTurn: [],
    actions: [],
  },
  {
    id: 'tile.mystic_elevator',
    name: 'Mystic Elevator',
    floors: ['basement', 'ground', 'upper'],
    doors: { n: true, e: true, s: true, w: true },
    symbol: null,
    copies: 1,
    staticLinks: [],
    onEnter: [],
    onExit: [],
    onEndTurn: [],
    actions: [],
  },
];

function convertRooms(source: z.infer<typeof LegacySourceSchema>): Tile[] {
  const records = [...source['stationary-rooms'], ...source.rooms];
  const names = new Set<string>();
  for (const room of records) {
    if (names.has(room.name)) throw new Error(`Duplicate room name: ${room.name}`);
    names.add(room.name);
  }

  for (const imageOnly of IMAGE_ONLY_TILES) {
    if (names.has(imageOnly.name)) {
      throw new Error(`Duplicate room name: ${imageOnly.name}`);
    }
  }

  return [...records.map(convertRoom), ...IMAGE_ONLY_TILES.map((tile) => ({ ...tile }))];
}

function house() {
  return {
    layout: [
      {
        tileId: 'tile.entrance_hall',
        floor: 'ground' as const,
        x: 0,
        y: 2,
        rotation: 0 as const,
      },
      {
        tileId: 'tile.foyer',
        floor: 'ground' as const,
        x: 0,
        y: 1,
        rotation: 0 as const,
      },
      {
        tileId: 'tile.grand_staircase',
        floor: 'ground' as const,
        x: 0,
        y: 0,
        rotation: 270 as const,
      },
      {
        tileId: 'tile.upper_landing',
        floor: 'upper' as const,
        x: 0,
        y: 0,
        rotation: 0 as const,
      },
      {
        tileId: 'tile.basement_landing',
        floor: 'basement' as const,
        x: 0,
        y: 0,
        rotation: 0 as const,
      },
    ],
    startTile: 'tile.entrance_hall',
    landings: {
      basement: 'tile.basement_landing',
      ground: 'tile.entrance_hall',
      upper: 'tile.upper_landing',
    },
  };
}

export function migrateGrapeSalad(source: unknown): ContentFile {
  const parsed = parseSource(source);
  const characters = parsed.characters.map(convertCharacter);
  const ids = new Set<string>();
  for (const character of characters) {
    if (ids.has(character.id))
      throw new Error(`Duplicate character name: ${character.name}`);
    ids.add(character.id);
  }

  const file = { characters, tiles: convertRooms(parsed), house: house() };
  return ContentFileSchema.parse(file);
}
