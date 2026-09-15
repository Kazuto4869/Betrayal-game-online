const { CHARACTERS } = require('../data/characters');

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 6;

function createRoomState(targetPlayerCount, options = {}) {
  if (!Number.isInteger(targetPlayerCount) || targetPlayerCount < MIN_PLAYERS || targetPlayerCount > MAX_PLAYERS) {
    throw new RangeError('遊玩人數必須是 3 至 6 人。');
  }

  return {
    roomCode: 'LAN',
    targetPlayerCount,
    started: false,
    characterQueue: null,
    players: [],
    createdAt: options.now ? options.now() : Date.now(),
  };
}

function createCharacterQueue(count, randomInt) {
  const shuffled = [...CHARACTERS];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.slice(0, count).map((character) => character.id);
}

function publicRoomState(state) {
  return {
    roomCode: state.roomCode,
    targetPlayerCount: state.targetPlayerCount,
    started: state.started,
    players: state.players.map((player) => ({
      characterId: player.characterId,
      connected: player.connected,
      playerNumber: player.playerNumber,
      seat: player.seat,
    })),
  };
}

function allSeatsConnected(state) {
  return state.players.length === state.targetPlayerCount
    && state.players.every((player) => player.connected);
}

module.exports = {
  MAX_PLAYERS,
  MIN_PLAYERS,
  allSeatsConnected,
  createCharacterQueue,
  createRoomState,
  publicRoomState,
};
