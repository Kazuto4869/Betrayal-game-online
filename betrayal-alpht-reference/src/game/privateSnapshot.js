const { cloneGameState } = require('./gameState');
const { createPublicSnapshot } = require('./publicSnapshot');
const { getPlayerPosition, getReachableMoves } = require('./movement');
const { ROOM_DEFINITIONS } = require('../data/rooms');
const { getFirstLegalRoomPlacements } = require('./roomPlacement');
const { getLegalCardActions } = require('./cardResolution');
const { getLegalCombatTargets } = require('./combat');
const { isTraitor } = require('./haunt/hauntState');
const { getLegalMummyMoves } = require('./haunt/mummyActions');

function stripSecrets(value) {
  if (Array.isArray(value)) {
    return value.map(stripSecrets);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'token' && key !== 'reconnectToken')
      .map(([key, entry]) => [key, stripSecrets(entry)]),
  );
}

function getLegalCombatActions(state, playerNumber) {
  const pendingInteraction = state.turn?.pendingInteraction;
  if ((state.turn?.phase !== 'EXPLORATION' && state.turn?.phase !== 'COMBAT')
    || state.turn.activePlayerNumber !== playerNumber
    || state.turn.pendingMove?.playerNumber === playerNumber
    || (pendingInteraction?.playerNumber === playerNumber
      && pendingInteraction.type !== 'combat-target')) {
    return [];
  }

  const targets = getLegalCombatTargets(state, playerNumber);
  const actions = targets.map((targetPlayerNumber) => ({
    type: 'game:combat:select-target',
    targetPlayerNumber,
  }));
  const pending = pendingInteraction;
  if (pending?.type === 'combat-target'
    && pending.playerNumber === playerNumber
    && targets.includes(pending.targetPlayerNumber)) {
    actions.push({ type: 'game:combat:resolve' });
  }
  return actions;
}

function getLegalHauntActions(state, playerNumber) {
  if (state.turn?.phase !== 'HAUNT' || state.turn.activePlayerNumber !== playerNumber) {
    return [];
  }
  if (isTraitor(state, playerNumber)) {
    return [
      ...getLegalMummyMoves(state).map((move) => ({
        type: 'haunt:mummy:move',
        tileId: move.tileId,
      })),
      ...state.players
        .filter((player) => player.playerNumber !== playerNumber
          && state.map.playerPositions[player.playerNumber] === state.haunt.mummy.tileId)
        .map((player) => ({
          type: 'haunt:mummy:attack',
          targetPlayerNumber: player.playerNumber,
        })),
    ];
  }
  if (state.map.playerPositions[playerNumber] === 'entrance'
    && !state.haunt.mummy.custodyByPlayerNumber[playerNumber]) {
    return [{ type: 'haunt:survivor:escape' }];
  }
  return [];
}

function createPrivateSnapshot(state, viewer = {}) {
  const source = cloneGameState(state);

  if (viewer.role !== 'host' && viewer.role !== 'player') {
    throw new Error('無效的檢視者');
  }

  const snapshot = createPublicSnapshot(source);
  if (viewer.role === 'host') {
    return snapshot;
  }

  const player = source.players.find(
    (entry) => entry.playerNumber === viewer.playerNumber,
  );
  if (!player) {
    throw new Error('不存在的玩家');
  }

  snapshot.private = {
    playerNumber: player.playerNumber,
    data: stripSecrets(player.private || {}),
    haunt: stripSecrets(source.haunt.privateByPlayerNumber?.[player.playerNumber] || null),
    legalActions: [
      ...getLegalCardActions(source, player.playerNumber),
      ...getLegalCombatActions(source, player.playerNumber),
      ...getLegalHauntActions(source, player.playerNumber),
    ],
    movement: {
      location: source.turn.pendingMove?.playerNumber === player.playerNumber
        ? source.turn.pendingMove.currentTileId
        : getPlayerPosition(source, player.playerNumber),
      reachableMoves: getReachableMoves(source, player.playerNumber),
      canConfirm: source.turn.pendingMove?.playerNumber === player.playerNumber,
      canRegret: source.turn.pendingMove?.playerNumber === player.playerNumber
        && source.turn.pendingMove.immediateStop !== true,
      explorationPlacements: source.turn.activePlayerNumber !== player.playerNumber
        || source.turn.pendingMove?.playerNumber === player.playerNumber
        || source.turn.pendingInteraction?.playerNumber === player.playerNumber
        || source.turn.movementRemaining <= 0
        ? []
        : getFirstLegalRoomPlacements(source.map, ROOM_DEFINITIONS),
    },
  };
  return snapshot;
}

module.exports = {
  createPrivateSnapshot,
};
