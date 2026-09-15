const { cloneGameState } = require('./gameState');
const { GAME_PHASES } = require('./gamePhase');

function pauseError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function pauseGame(state, reason, playerNumbers = []) {
  if (state.turn.phase === GAME_PHASES.ENDED || state.pause.active) {
    throw pauseError('invalid-phase', '目前階段不可暫停。');
  }
  const next = cloneGameState(state);
  next.turn.previousPhase = next.turn.phase;
  next.turn.phase = GAME_PHASES.PAUSED;
  next.pause = {
    ...next.pause,
    active: true,
    reason,
    disconnectedPlayerNumbers: [...new Set(playerNumbers.filter(Number.isInteger))],
    resumeRequested: false,
  };
  return next;
}

function pauseForHost(state) {
  return pauseGame(state, 'host');
}

function pauseForDisconnect(state, playerNumber) {
  const disconnected = [
    ...(state.pause?.disconnectedPlayerNumbers || []),
    playerNumber,
  ];
  return state.pause.active
    ? (() => {
      const next = cloneGameState(state);
      next.pause.disconnectedPlayerNumbers = [...new Set(disconnected)];
      next.pause.reason = 'player-disconnected';
      return next;
    })()
    : pauseGame(state, 'player-disconnected', disconnected);
}

function canResumeAfterReconnect(state) {
  return state.turn.phase === GAME_PHASES.PAUSED
    && state.pause.active
    && state.players.every((player) => player.connected);
}

function markPlayerReconnected(state, playerNumber) {
  const next = cloneGameState(state);
  const player = next.players.find((entry) => entry.playerNumber === playerNumber);
  if (!player) {
    throw pauseError('invalid-player', '找不到重連玩家。');
  }
  player.connected = true;
  player.controlState = 'controlled';
  next.pause.disconnectedPlayerNumbers = (next.pause.disconnectedPlayerNumbers || [])
    .filter((number) => number !== playerNumber);
  return next;
}

function resumeGame(state) {
  if (!canResumeAfterReconnect(state)) {
    throw pauseError('players-disconnected', '仍有玩家尚未重連。');
  }
  const next = cloneGameState(state);
  next.pause = {
    ...next.pause,
    active: false,
    reason: null,
    disconnectedPlayerNumbers: [],
    resumeRequested: true,
  };
  next.turn.phase = next.turn.previousPhase || GAME_PHASES.EXPLORATION;
  delete next.turn.previousPhase;
  return next;
}

module.exports = {
  canResumeAfterReconnect,
  markPlayerReconnected,
  pauseForDisconnect,
  pauseForHost,
  resumeGame,
};
