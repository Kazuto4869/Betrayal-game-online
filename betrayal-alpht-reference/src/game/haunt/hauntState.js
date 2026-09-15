const { GAME_PHASES } = require('../gamePhase');

function isHauntActive(state) {
  return state.haunt?.triggered === true && state.turn?.phase === GAME_PHASES.HAUNT;
}

function isTraitor(state, playerNumber) {
  return Number.isInteger(playerNumber)
    && state.haunt?.traitorPlayerNumber === playerNumber;
}

module.exports = {
  isHauntActive,
  isTraitor,
};
