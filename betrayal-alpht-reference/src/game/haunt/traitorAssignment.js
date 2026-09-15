const { cloneGameState } = require('../gameState');
const { MUMMY_WALKS } = require('../../data/haunts/haunt-1-mummy-walks');

function hauntError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function chooseIndex(length, randomInt) {
  if (!Number.isInteger(length) || length <= 0) {
    throw hauntError('invalid-player-count', '沒有可分配作祟陣營的玩家。');
  }
  const value = typeof randomInt === 'function' ? randomInt(length) : 0;
  if (!Number.isInteger(value) || value < 0) {
    throw hauntError('invalid-random-result', '伺服器隨機結果無效。');
  }
  return value % length;
}

function triggerMummyWalks(state, randomInt) {
  if (state.haunt?.triggered) {
    throw hauntError('haunt-already-triggered', '作祟已經觸發。');
  }

  const next = cloneGameState(state);
  const players = next.players.filter((player) => Number.isInteger(player.playerNumber));
  const traitor = players[chooseIndex(players.length, randomInt)];
  const privateByPlayerNumber = {};

  for (const player of players) {
    privateByPlayerNumber[player.playerNumber] = {
      role: player.playerNumber === traitor.playerNumber ? 'traitor' : 'survivor',
      objective: player.playerNumber === traitor.playerNumber
        ? MUMMY_WALKS.objectives.traitor
        : MUMMY_WALKS.objectives.survivor,
    };
  }

  next.haunt = {
    ...next.haunt,
    triggered: true,
    scenarioId: MUMMY_WALKS.id,
    traitorPlayerNumber: traitor.playerNumber,
    privateByPlayerNumber,
    mummy: {
      tileId: MUMMY_WALKS.mummy.startTileId,
      movementRemaining: MUMMY_WALKS.mummy.movement,
      custodyByPlayerNumber: {},
    },
    escapedByPlayerNumber: {},
    outcome: null,
  };
  next.turn.phase = 'HAUNT';
  next.turn.activePlayerNumber = traitor.playerNumber;
  next.turn.movementRemaining = 0;
  next.turn.pendingInteraction = null;
  next.turn.pendingMove = null;
  next.latestPublicLog = {
    type: 'haunt-triggered',
    summary: '作祟已觸發：The Mummy Walks。',
  };
  return next;
}

module.exports = {
  triggerMummyWalks,
};
