const { cloneGameState } = require('./gameState');
const { MUMMY_WALKS } = require('../data/haunts/haunt-1-mummy-walks');

function getSurvivorNumbers(state) {
  return state.players
    .map((player) => player.playerNumber)
    .filter((playerNumber) => playerNumber !== state.haunt.traitorPlayerNumber);
}

function evaluateVictory(state) {
  if (!state.haunt?.triggered || state.haunt.outcome) {
    return null;
  }

  const custody = Object.keys(state.haunt.mummy?.custodyByPlayerNumber || {});
  if (custody.length > 0) {
    return {
      winner: 'traitor',
      reason: MUMMY_WALKS.victory.traitor,
      traitorRevealed: true,
    };
  }

  const survivors = getSurvivorNumbers(state);
  const escaped = state.haunt.escapedByPlayerNumber || {};
  if (survivors.length > 0 && survivors.every((playerNumber) => escaped[playerNumber] === true)) {
    return {
      winner: 'survivors',
      reason: MUMMY_WALKS.victory.survivor,
      traitorRevealed: true,
    };
  }

  return null;
}

function applyVictory(state) {
  const outcome = evaluateVictory(state);
  if (!outcome) {
    return state;
  }
  const next = cloneGameState(state);
  next.haunt.outcome = outcome;
  next.haunt.traitorRevealed = Boolean(outcome.traitorRevealed);
  next.haunt.publicReveal = {
    title: outcome.winner === 'traitor' ? '作祟者勝利' : '倖存者勝利',
    summary: outcome.reason,
  };
  next.turn.phase = 'ENDED';
  next.latestPublicLog = {
    type: 'game-ended',
    summary: next.haunt.publicReveal.title,
  };
  return next;
}

module.exports = {
  applyVictory,
  evaluateVictory,
  getSurvivorNumbers,
};
