const { createPublicSnapshot } = require('../game/publicSnapshot');

function createHostSnapshot(state) {
  const snapshot = createPublicSnapshot(state);
  return {
    ...snapshot,
    hostControls: {
      canPause: !state.pause.active && state.turn.phase !== 'ENDED',
      canResume: state.pause.active && state.players.every((player) => player.connected),
      canRestart: true,
    },
  };
}

module.exports = {
  createHostSnapshot,
};
