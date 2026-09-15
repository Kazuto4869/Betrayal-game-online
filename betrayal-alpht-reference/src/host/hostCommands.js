const { createGameState } = require('../game/gameState');
const { GAME_PHASES } = require('../game/gamePhase');
const { ROOM_DEFINITIONS } = require('../data/rooms');
const { createMapState } = require('../game/mapState');
const { placeRoom } = require('../game/roomPlacement');

function hostCommandError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function restartGameState(state, gameStateFactory = createGameState) {
  const players = state.players.map((player) => ({
    seat: player.seat,
    playerNumber: player.playerNumber,
    characterId: player.characterId,
    connected: player.connected,
    controlState: player.controlState,
  }));
  const next = gameStateFactory({ room: state.room, players });
  const entrance = ROOM_DEFINITIONS.find((definition) => definition.id === 'entrance');
  next.map = placeRoom(
    createMapState(['gallery', 'hallway', 'staircase', 'basement']),
    entrance,
    { position: { x: 0, y: 0 }, rotation: 0 },
  );
  next.map.playerPositions = Object.fromEntries(
    players.map((player) => [player.playerNumber, 'entrance']),
  );
  next.turn.order = players.map((player) => player.playerNumber);
  next.turn.activePlayerNumber = next.turn.order[0] || null;
  next.turn.phase = GAME_PHASES.EXPLORATION;
  next.turn.movementRemaining = 3;
  return next;
}

function validateRestartPayload(payload) {
  if (!payload || payload.confirm !== true) {
    throw hostCommandError('restart-confirmation-required', '重啟需要明確確認。');
  }
}

module.exports = {
  hostCommandError,
  restartGameState,
  validateRestartPayload,
};
