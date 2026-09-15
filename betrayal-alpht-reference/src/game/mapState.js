const { createRoomDeck } = require('../data/rooms');

function cloneMapState(map) {
  return JSON.parse(JSON.stringify(map));
}

function createMapState(roomIds) {
  return {
    tiles: [],
    connections: [],
    explored: [],
    roomDeck: createRoomDeck(roomIds),
    playerPositions: {},
  };
}

module.exports = {
  cloneMapState,
  createMapState,
};
