const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ROOM_DEFINITIONS,
  createRoomDeck,
} = require('../../src/data/rooms');
const {
  createMapState,
} = require('../../src/game/mapState');
const {
  drawFirstLegalRoom,
  getFirstLegalRoomPlacements,
  getLegalPlacements,
  placeRoom,
  rotateSide,
} = require('../../src/game/roomPlacement');

test('room definitions expose the required versioned room data contract', () => {
  assert.ok(Array.isArray(ROOM_DEFINITIONS));
  assert.ok(ROOM_DEFINITIONS.length >= 5);

  for (const room of ROOM_DEFINITIONS) {
    assert.equal(typeof room.id, 'string');
    assert.equal(typeof room.floor, 'string');
    assert.ok(Array.isArray(room.doors));
    assert.ok(Array.isArray(room.icons));
    assert.ok(Array.isArray(room.specialConnections));
  }
});

test('createRoomDeck returns a fresh deterministic deck from requested room IDs', () => {
  const deck = createRoomDeck(['entrance', 'hallway']);

  assert.deepEqual(deck, ['entrance', 'hallway']);
  assert.notEqual(deck, createRoomDeck(['entrance', 'hallway']));
});

test('createMapState starts with empty map collections and a fresh room deck', () => {
  const map = createMapState(['entrance', 'hallway']);

  assert.deepEqual(map, {
    tiles: [],
    connections: [],
    explored: [],
    roomDeck: ['entrance', 'hallway'],
    playerPositions: {},
  });
  assert.notEqual(map.roomDeck, createMapState(['entrance', 'hallway']).roomDeck);
});

test('rotateSide supports all four quarter-turn rotations', () => {
  assert.equal(rotateSide('north', 0), 'north');
  assert.equal(rotateSide('north', 90), 'east');
  assert.equal(rotateSide('north', 180), 'south');
  assert.equal(rotateSide('north', 270), 'west');
});

test('getLegalPlacements matches doors and offers every legal rotation', () => {
  const map = createMapState(['hallway']);
  const entrance = ROOM_DEFINITIONS.find((room) => room.id === 'entrance');
  const hallway = ROOM_DEFINITIONS.find((room) => room.id === 'hallway');
  const seeded = placeRoom(map, entrance, { position: { x: 0, y: 0 }, rotation: 0 });
  const placements = getLegalPlacements(seeded, hallway);

  assert.equal(placements.length, 8);
  assert.deepEqual(
    [...new Set(placements.map((placement) => `${placement.position.x},${placement.position.y}`))],
    ['0,-1', '1,0', '0,1', '-1,0'],
  );
  assert.deepEqual(
    [...new Set(placements.map((placement) => placement.rotation))].sort((a, b) => a - b),
    [0, 90, 180, 270],
  );
});

test('placeRoom rejects an illegal client-selected rotation', () => {
  const map = createMapState(['hallway']);
  const entrance = ROOM_DEFINITIONS.find((room) => room.id === 'entrance');
  const hallway = ROOM_DEFINITIONS.find((room) => room.id === 'hallway');
  const seeded = placeRoom(map, entrance, { position: { x: 0, y: 0 }, rotation: 0 });

  assert.throws(
    () => placeRoom(seeded, hallway, { position: { x: 1, y: 0 }, rotation: 0 }),
    (error) => error.code === 'illegal-placement',
  );
});

test('drawFirstLegalRoom skips invalid deck entries and exposes only the selected legal tile', () => {
  const entrance = ROOM_DEFINITIONS.find((room) => room.id === 'entrance');
  const map = placeRoom(
    createMapState(['gallery', 'hallway']),
    entrance,
    { position: { x: 0, y: 0 }, rotation: 0 },
  );
  const result = drawFirstLegalRoom(map, ROOM_DEFINITIONS);

  assert.equal(result.roomId, 'hallway');
  assert.equal(result.placement.position.x, 0);
  assert.equal(result.placement.position.y, -1);
  assert.deepEqual(result.map.roomDeck, []);
  assert.equal(result.map.tiles.at(-1).id, 'hallway');
  assert.equal(JSON.stringify(result.map).includes('gallery'), false);
});

test('special stair connections create cross-floor movement links', () => {
  const entrance = ROOM_DEFINITIONS.find((room) => room.id === 'entrance');
  const staircase = ROOM_DEFINITIONS.find((room) => room.id === 'staircase');
  const gallery = ROOM_DEFINITIONS.find((room) => room.id === 'gallery');
  const withEntrance = placeRoom(
    createMapState(['staircase', 'gallery']),
    entrance,
    { position: { x: 0, y: 0 }, rotation: 0 },
  );
  const withStairs = placeRoom(
    withEntrance,
    staircase,
    { position: { x: 1, y: 0 }, rotation: 0 },
  );
  const galleryPlacement = getLegalPlacements(withStairs, gallery)
    .find((placement) => placement.position.x === 1 && placement.position.y === -1);

  assert.ok(galleryPlacement);
  const withGallery = placeRoom(withStairs, gallery, galleryPlacement);
  assert.ok(withGallery.connections.some((connection) => connection.type === 'stairs'));
});

test('first legal room options omit the room ID while preserving placement intent', () => {
  const entrance = ROOM_DEFINITIONS.find((room) => room.id === 'entrance');
  const map = placeRoom(
    createMapState(['gallery', 'hallway']),
    entrance,
    { position: { x: 0, y: 0 }, rotation: 0 },
  );
  const options = getFirstLegalRoomPlacements(map, ROOM_DEFINITIONS);

  assert.ok(options.length > 0);
  assert.deepEqual(Object.keys(options[0]).sort(), ['position', 'rotation']);
  assert.equal(JSON.stringify(options).includes('hallway'), false);
});
