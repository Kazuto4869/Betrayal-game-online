const { cloneGameState } = require('./gameState');
const { getCardTypeForTile } = require('./cardResolution');

function movementError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getPlayerPosition(state, playerNumber) {
  return state.map.playerPositions?.[playerNumber] || null;
}

function isPositionAdjacentToPlayer(state, playerNumber, position) {
  const currentTileId = getPlayerPosition(state, playerNumber);
  const currentTile = findTile(state, currentTileId);
  if (!currentTile || !position) {
    return false;
  }
  return Math.abs(currentTile.position.x - position.x) + Math.abs(currentTile.position.y - position.y) === 1;
}

function findTile(state, tileId) {
  return state.map.tiles.find((tile) => tile.id === tileId) || null;
}

function getNeighborIds(state, tileId) {
  return state.map.connections.flatMap((connection) => {
    if (connection.from === tileId) {
      return [connection.to];
    }
    if (connection.to === tileId) {
      return [connection.from];
    }
    return [];
  });
}

function shouldStopAfterEntering(tile) {
  const tileStop = Array.isArray(tile?.icons) && tile.icons.includes('stop');
  const cardType = getCardTypeForTile(tile);
  return {
    stop: tileStop || Boolean(cardType),
    reason: tileStop ? 'tile-stop' : (cardType ? 'card-draw' : null),
  };
}

function getReachableMoves(state, playerNumber) {
  if (state.turn.pendingInteraction?.playerNumber === playerNumber) {
    return [];
  }
  if (state.turn.pendingMove?.playerNumber === playerNumber
    && state.turn.pendingMove.immediateStop) {
    return [];
  }
  if (state.turn.movementRemaining <= 0) {
    return [];
  }

  const currentTileId = state.turn.pendingMove?.playerNumber === playerNumber
    ? state.turn.pendingMove.currentTileId
    : getPlayerPosition(state, playerNumber);
  if (!currentTileId) {
    return [];
  }

  return getNeighborIds(state, currentTileId).map((tileId) => {
    const stop = shouldStopAfterEntering(findTile(state, tileId));
    return {
      tileId,
      cost: 1,
      stopReason: stop.reason,
    };
  });
}

function applyMoveIntent(state, playerNumber, tileId) {
  if (state.turn.pendingMove?.playerNumber === playerNumber
    && state.turn.pendingMove.immediateStop) {
    throw movementError('move-must-confirm', 'Immediate-stop movement must be confirmed');
  }
  const reachable = getReachableMoves(state, playerNumber);
  const move = reachable.find((candidate) => candidate.tileId === tileId);
  if (!move) {
    if (state.turn.movementRemaining <= 0) {
      throw movementError('movement-exhausted', 'No movement remains');
    }
    throw movementError('illegal-move', 'Target tile is not reachable');
  }

  const currentTileId = state.turn.pendingMove?.playerNumber === playerNumber
    ? state.turn.pendingMove.currentTileId
    : getPlayerPosition(state, playerNumber);
  const previousPending = state.turn.pendingMove?.playerNumber === playerNumber
    ? state.turn.pendingMove
    : null;
  const next = cloneGameState(state);
  const stop = shouldStopAfterEntering(findTile(state, tileId));
  next.turn.movementRemaining -= move.cost;
  next.turn.pendingMove = {
    playerNumber,
    startTileId: previousPending?.startTileId || currentTileId,
    currentTileId: tileId,
    path: [...(previousPending?.path || [currentTileId]), tileId],
    movementSpent: (previousPending?.movementSpent || 0) + move.cost,
    immediateStop: Boolean(previousPending?.immediateStop || stop.stop),
  };
  return next;
}

module.exports = {
  applyMoveIntent,
  getPlayerPosition,
  getReachableMoves,
  isPositionAdjacentToPlayer,
  shouldStopAfterEntering,
};
