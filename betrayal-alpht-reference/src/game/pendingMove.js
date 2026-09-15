const { cloneGameState } = require('./gameState');

function pendingMoveError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getPendingMove(state, playerNumber) {
  const pending = state.turn.pendingMove;
  if (!pending || pending.playerNumber !== playerNumber) {
    throw pendingMoveError('no-pending-move', 'No pending move belongs to this player');
  }
  return pending;
}

function confirmPendingMove(state, playerNumber) {
  const pending = getPendingMove(state, playerNumber);
  const next = cloneGameState(state);
  next.map.playerPositions[playerNumber] = pending.currentTileId;
  next.turn.pendingMove = null;
  return next;
}

function regretPendingMove(state, playerNumber) {
  const pending = getPendingMove(state, playerNumber);
  if (pending.immediateStop) {
    throw pendingMoveError('move-must-confirm', 'Immediate-stop movement must be confirmed');
  }
  const next = cloneGameState(state);
  next.map.playerPositions[playerNumber] = pending.startTileId;
  next.turn.movementRemaining += pending.movementSpent;
  next.turn.pendingMove = null;
  return next;
}

module.exports = {
  confirmPendingMove,
  regretPendingMove,
};
