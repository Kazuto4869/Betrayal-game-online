const { cloneGameState } = require('../gameState');
const { rollTraitCheck } = require('../dice');
const { getInitialTraits } = require('../traits');
const { MUMMY_WALKS } = require('../../data/haunts/haunt-1-mummy-walks');
const { isHauntActive, isTraitor } = require('./hauntState');
const { applyVictory } = require('../victory');

function mummyError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function neighbors(state, tileId) {
  return state.map.connections.flatMap((connection) => {
    if (connection.from === tileId) return [connection.to];
    if (connection.to === tileId) return [connection.from];
    return [];
  });
}

function assertTraitorTurn(state, playerNumber) {
  if (!isHauntActive(state)) throw mummyError('invalid-phase', '目前不是作祟階段。');
  if (!isTraitor(state, playerNumber)) throw mummyError('unauthorized-haunt-action', '只有作祟者可以控制木乃伊。');
  if (state.turn.activePlayerNumber !== playerNumber) throw mummyError('not-active-player', '目前不是你的作祟回合。');
  if (state.haunt.outcome) throw mummyError('game-ended', '遊戲已經結束。');
}

function getLegalMummyMoves(state) {
  if (!isHauntActive(state) || state.haunt.mummy.movementRemaining <= 0) return [];
  return neighbors(state, state.haunt.mummy.tileId).map((tileId) => ({ tileId, cost: 1 }));
}

function moveMummy(state, playerNumber, tileId) {
  assertTraitorTurn(state, playerNumber);
  const move = getLegalMummyMoves(state).find((candidate) => candidate.tileId === tileId);
  if (!move) throw mummyError('illegal-mummy-move', '木乃伊無法移動到該房間。');
  const next = cloneGameState(state);
  next.haunt.mummy.tileId = tileId;
  next.haunt.mummy.movementRemaining -= move.cost;
  next.latestPublicLog = { type: 'mummy-moved', summary: `木乃伊移動到 ${tileId}。` };
  return next;
}

function attackMummy(state, playerNumber, targetPlayerNumber, randomInt) {
  assertTraitorTurn(state, playerNumber);
  const target = state.players.find((player) => player.playerNumber === targetPlayerNumber);
  if (!target || targetPlayerNumber === state.haunt.traitorPlayerNumber) {
    throw mummyError('invalid-target', '木乃伊攻擊目標無效。');
  }
  if (state.map.playerPositions[targetPlayerNumber] !== state.haunt.mummy.tileId) {
    throw mummyError('invalid-target', '目標不在木乃伊所在房間。');
  }
  const targetTraits = target.private?.traits || getInitialTraits(target.characterId);
  const mummyRoll = rollTraitCheck({ might: 4 }, 2, randomInt);
  const targetRoll = rollTraitCheck({ might: targetTraits.might }, 2, randomInt);
  const damage = Math.max(0, mummyRoll.total - targetRoll.total);
  const next = cloneGameState(state);
  if (damage > 0) next.haunt.mummy.custodyByPlayerNumber[targetPlayerNumber] = true;
  next.latestPublicLog = {
    type: 'mummy-attacked',
    summary: damage > 0 ? `木乃伊俘虜了玩家 ${targetPlayerNumber}。` : `木乃伊攻擊玩家 ${targetPlayerNumber} 未造成俘虜。`,
  };
  return applyVictory(next);
}

function escapeSurvivor(state, playerNumber) {
  if (!isHauntActive(state)) throw mummyError('invalid-phase', '目前不是作祟階段。');
  if (isTraitor(state, playerNumber)) throw mummyError('unauthorized-haunt-action', '作祟者不能使用倖存者逃脫。');
  if (state.map.playerPositions[playerNumber] !== 'entrance') {
    throw mummyError('invalid-escape-location', '只有在入口才能逃脫。');
  }
  if (state.haunt.mummy.custodyByPlayerNumber[playerNumber]) {
    throw mummyError('player-in-custody', '被木乃伊俘虜的玩家不能逃脫。');
  }
  const next = cloneGameState(state);
  next.haunt.escapedByPlayerNumber[playerNumber] = true;
  next.latestPublicLog = { type: 'survivor-escaped', summary: `玩家 ${playerNumber} 已逃脫。` };
  return applyVictory(next);
}

module.exports = {
  attackMummy,
  escapeSurvivor,
  getLegalMummyMoves,
  moveMummy,
};
