const { GAME_PHASES } = require('./gamePhase');
const { cloneGameState } = require('./gameState');
const { validateCommand } = require('./commandValidation');
const { applyMoveIntent } = require('./movement');
const { confirmPendingMove, regretPendingMove } = require('./pendingMove');
const { ROOM_DEFINITIONS } = require('../data/rooms');
const { drawFirstLegalRoom } = require('./roomPlacement');
const {
  getCardTypeForTile,
  hasDrawableCard,
  resolveDrawnCard,
  resolveHauntRoll,
} = require('./cardResolution');
const { resolveCombat } = require('./combat');
const { getInitialTraits } = require('./traits');
const { moveMummy, attackMummy, escapeSurvivor } = require('./haunt/mummyActions');
const { pauseForHost, resumeGame } = require('./pauseState');
const { restartGameState, validateRestartPayload } = require('../host/hostCommands');

function nextPlayerNumber(state) {
  const order = state.turn.order;
  const index = order.indexOf(state.turn.activePlayerNumber);
  return order[(index + 1) % order.length] ?? null;
}

function getMovementAllowance(state, playerNumber) {
  const player = state.players.find((entry) => entry.playerNumber === playerNumber);
  const currentSpeed = player?.private?.traits?.speed;
  if (Number.isFinite(currentSpeed)) {
    return Math.max(0, currentSpeed);
  }

  const initialSpeed = getInitialTraits(player?.characterId)?.speed;
  return Number.isFinite(initialSpeed) ? Math.max(0, initialSpeed) : 0;
}

function resolveCommand(state, command, randomInt) {
  if (command.type === 'game:draw-card') {
    const resolved = resolveDrawnCard(
      state,
      command.actorPlayerNumber,
      state.turn.pendingInteraction.cardType,
      randomInt,
    );
    return {
      state: resolved.state,
      event: { ...resolved.event, requestId: command.requestId },
    };
  }

  if (command.type === 'game:resolve-haunt-roll') {
    const resolved = resolveHauntRoll(state, command.actorPlayerNumber, randomInt);
    return {
      state: resolved.state,
      event: { ...resolved.event, requestId: command.requestId },
    };
  }

  if (command.type === 'game:combat:resolve') {
    const resolved = resolveCombat(
      state,
      command.actorPlayerNumber,
      state.turn.pendingInteraction.targetPlayerNumber,
      randomInt,
    );
    resolved.state.turn.pendingInteraction = null;
    resolved.state.turn.phase = GAME_PHASES.EXPLORATION;
    resolved.state.turn.movementRemaining = 0;
    return {
      state: resolved.state,
      event: {
        type: 'combat-resolved',
        requestId: command.requestId,
        result: resolved.result,
      },
    };
  }

  if (command.type === 'haunt:mummy:move') {
    return {
      state: moveMummy(state, command.actorPlayerNumber, command.payload.tileId),
      event: { type: 'mummy-moved', requestId: command.requestId },
    };
  }

  if (command.type === 'haunt:mummy:attack') {
    const next = attackMummy(
      state,
      command.actorPlayerNumber,
      command.payload.targetPlayerNumber,
      randomInt,
    );
    return {
      state: next,
      event: {
        type: next.turn.phase === GAME_PHASES.ENDED ? 'game-ended' : 'mummy-attacked',
        requestId: command.requestId,
      },
    };
  }

  if (command.type === 'haunt:survivor:escape') {
    const next = escapeSurvivor(state, command.actorPlayerNumber);
    return {
      state: next,
      event: {
        type: next.turn.phase === GAME_PHASES.ENDED ? 'game-ended' : 'survivor-escaped',
        requestId: command.requestId,
      },
    };
  }

  const next = cloneGameState(state);
  let event;

  if (command.type === 'move:explore') {
    const explored = drawFirstLegalRoom(next.map, ROOM_DEFINITIONS, command.payload);
    next.map = explored.map;
    const moved = applyMoveIntent(next, command.actorPlayerNumber, explored.roomId);
    Object.assign(next, moved);
    event = { type: 'move:explored', requestId: command.requestId };
  } else if (command.type === 'move:step') {
    const moved = applyMoveIntent(next, command.actorPlayerNumber, command.payload.tileId);
    Object.assign(next, moved);
    event = { type: 'move:stepped', requestId: command.requestId };
  } else if (command.type === 'move:confirm') {
    const confirmed = confirmPendingMove(next, command.actorPlayerNumber);
    Object.assign(next, confirmed);
    const enteredTileId = next.map.playerPositions[command.actorPlayerNumber];
    const enteredTile = next.map.tiles.find((tile) => tile.id === enteredTileId);
    const cardType = getCardTypeForTile(enteredTile);
    if (cardType && hasDrawableCard(next, cardType)) {
      next.turn.pendingInteraction = {
        type: 'card-draw',
        playerNumber: command.actorPlayerNumber,
        cardType,
      };
    }
    event = { type: 'move:confirmed', requestId: command.requestId };
  } else if (command.type === 'move:regret') {
    const regretted = regretPendingMove(next, command.actorPlayerNumber);
    Object.assign(next, regretted);
    event = { type: 'move:regretted', requestId: command.requestId };
  } else if (command.type === 'turn:pass') {
    const pending = next.turn.pendingInteraction;
    if (pending?.type === 'card-draw' && !hasDrawableCard(next, pending.cardType)) {
      next.turn.pendingInteraction = null;
    }
    next.turn.activePlayerNumber = nextPlayerNumber(next);
    next.turn.movementRemaining = next.turn.phase === GAME_PHASES.HAUNT
      ? (next.turn.activePlayerNumber === next.haunt.traitorPlayerNumber ? 2 : 0)
      : getMovementAllowance(next, next.turn.activePlayerNumber);
    event = { type: 'turn:passed', requestId: command.requestId };
  } else if (command.type === 'game:combat:select-target') {
    next.turn.phase = GAME_PHASES.COMBAT;
    next.turn.pendingInteraction = {
      type: 'combat-target',
      playerNumber: command.actorPlayerNumber,
      targetPlayerNumber: command.payload.targetPlayerNumber,
    };
    event = { type: 'combat-target-selected', requestId: command.requestId };
  } else if (command.type === 'host:pause') {
    return {
      state: pauseForHost(state),
      event: { type: 'game:paused', requestId: command.requestId },
    };
  } else if (command.type === 'host:resume') {
    return {
      state: resumeGame(state),
      event: { type: 'game:resumed', requestId: command.requestId },
    };
  } else if (command.type === 'host:restart') {
    validateRestartPayload(command.payload);
    return {
      state: restartGameState(state),
      event: { type: 'game:restarted', requestId: command.requestId },
    };
  }

  return { state: next, event };
}

function createCommandRouter({ getState, commit, emit, randomInt }) {
  if (typeof getState !== 'function' || typeof commit !== 'function' || typeof emit !== 'function') {
    throw new TypeError('命令路由器需要 getState、commit 與 emit。');
  }

  function dispatch(command, actor) {
    const current = getState();
    const validation = validateCommand(current, command, actor);
    if (!validation.valid) {
      return { ok: false, error: validation.error };
    }

    const resolved = resolveCommand(current, {
      ...validation.command,
      actorPlayerNumber: actor.playerNumber,
    }, randomInt);
    resolved.state.revision = current.revision + 1;
    commit(resolved.state);
    emit(resolved.event);
    return { ok: true, state: resolved.state, event: resolved.event };
  }

  return { dispatch };
}

module.exports = {
  createCommandRouter,
};
