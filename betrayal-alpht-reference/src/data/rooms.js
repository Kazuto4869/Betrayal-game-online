const CARDINAL_SIDES = Object.freeze(['north', 'east', 'south', 'west']);

function freezeRoom(room) {
  return Object.freeze({
    ...room,
    icons: Object.freeze([...room.icons]),
    doors: Object.freeze(room.doors.map((door) => Object.freeze({ ...door }))),
    specialConnections: Object.freeze(room.specialConnections.map((connection) => Object.freeze({ ...connection }))),
  });
}

const ROOM_DEFINITIONS = Object.freeze([
  freezeRoom({
    id: 'entrance',
    floor: 'ground',
    icons: ['entrance'],
    doors: [
      { side: 'north', type: 'normal' },
      { side: 'east', type: 'normal' },
      { side: 'south', type: 'normal' },
      { side: 'west', type: 'normal' },
    ],
    specialConnections: [],
  }),
  freezeRoom({
    id: 'hallway',
    floor: 'ground',
    icons: [],
    doors: [
      { side: 'north', type: 'normal' },
      { side: 'south', type: 'normal' },
    ],
    specialConnections: [],
  }),
  freezeRoom({
    id: 'staircase',
    floor: 'ground',
    icons: ['stairs'],
    doors: [
      { side: 'east', type: 'normal' },
      { side: 'west', type: 'normal' },
    ],
    specialConnections: [{ type: 'stairs-up', targetFloor: 'upper' }],
  }),
  freezeRoom({
    id: 'gallery',
    floor: 'upper',
    icons: ['omen'],
    doors: [
      { side: 'east', type: 'normal' },
      { side: 'south', type: 'normal' },
    ],
    specialConnections: [{ type: 'stairs-down', targetFloor: 'ground' }],
  }),
  freezeRoom({
    id: 'basement',
    floor: 'basement',
    icons: ['event', 'stop'],
    doors: [
      { side: 'north', type: 'normal' },
    ],
    specialConnections: [{ type: 'stairs-down', targetFloor: 'basement' }],
  }),
]);

const ROOM_BY_ID = new Map(ROOM_DEFINITIONS.map((room) => [room.id, room]));

function createRoomDeck(roomIds = ROOM_DEFINITIONS.map((room) => room.id)) {
  return roomIds.map((roomId) => {
    if (!ROOM_BY_ID.has(roomId)) {
      throw new Error(`Unknown room definition: ${roomId}`);
    }
    return roomId;
  });
}

module.exports = {
  CARDINAL_SIDES,
  ROOM_DEFINITIONS,
  createRoomDeck,
};
