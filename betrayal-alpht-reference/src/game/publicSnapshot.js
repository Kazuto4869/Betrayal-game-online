const { cloneGameState } = require('./gameState');
const { getDeckSummary } = require('./decks');

function pick(source, keys) {
  return Object.fromEntries(keys
    .filter((key) => source && Object.prototype.hasOwnProperty.call(source, key))
    .map((key) => [key, source[key]]));
}

function publicTurn(turn) {
  const pending = turn && turn.pendingInteraction;
  return {
    order: Array.isArray(turn?.order) ? [...turn.order] : [],
    activePlayerNumber: turn?.activePlayerNumber ?? null,
    phase: turn?.phase ?? null,
    movementRemaining: turn?.movementRemaining ?? 0,
    pendingInteraction: pending && typeof pending === 'object'
      ? pick(pending, ['type', 'targetPlayerNumber'])
      : null,
  };
}

function publicMap(map) {
  return {
    tiles: Array.isArray(map?.tiles)
      ? map.tiles.map((tile) => pick(tile, [
        'id',
        'floor',
        'icons',
        'doors',
        'specialConnections',
        'rotation',
        'position',
      ]))
      : [],
    connections: Array.isArray(map?.connections)
      ? map.connections.map((connection) => pick(connection, ['from', 'to', 'type']))
      : [],
    explored: Array.isArray(map?.explored) ? [...map.explored] : [],
  };
}

function publicReveal(reveal) {
  return reveal && typeof reveal === 'object'
    ? pick(reveal, ['title', 'summary', 'text'])
    : null;
}

function publicLog(log) {
  return log && typeof log === 'object'
    ? pick(log, ['type', 'summary'])
    : null;
}

function publicCombat(combat) {
  const result = combat?.latestResult;
  return {
    latestResult: result && typeof result === 'object'
      ? pick(result, [
        'attackerPlayerNumber',
        'targetPlayerNumber',
        'attackerTotal',
        'defenderTotal',
        'damage',
      ])
      : null,
  };
}

function createDeckSummary(deck) {
  return { remaining: Array.isArray(deck) ? deck.length : 0 };
}

function createPublicSnapshot(state) {
  const source = cloneGameState(state);
  const snapshot = {
    room: pick(source.room, ['code', 'roomCode', 'targetPlayerCount', 'started', 'joinUrl']),
    players: source.players.map((player) => ({
      seat: player.seat,
      playerNumber: player.playerNumber,
      characterId: player.characterId,
      location: source.map.playerPositions?.[player.playerNumber] || null,
      connected: player.connected,
      controlState: player.controlState,
    })),
    turn: publicTurn(source.turn),
    map: publicMap(source.map),
    decks: {
      room: createDeckSummary(source.decks.room),
      ...getDeckSummary(source.decks),
    },
    haunt: {
      triggered: Boolean(source.haunt.triggered),
      scenarioId: source.haunt.scenarioId || null,
      traitorRevealed: Boolean(source.haunt.traitorRevealed),
      publicReveal: publicReveal(source.haunt.publicReveal),
      mummy: source.haunt.triggered ? {
        tileId: source.haunt.mummy?.tileId || null,
        movementRemaining: source.haunt.mummy?.movementRemaining || 0,
      } : null,
      outcome: source.haunt.outcome
        ? pick(source.haunt.outcome, ['winner', 'reason'])
        : null,
    },
    pause: pick(source.pause, ['active', 'reason', 'disconnectedPlayerNumbers']),
    combat: publicCombat(source.combat),
    latestPublicLog: publicLog(source.latestPublicLog),
    revision: source.revision,
  };

  if (source.haunt.traitorRevealed === true) {
    snapshot.haunt.traitorPlayerNumber = source.haunt.traitorPlayerNumber;
  }

  return snapshot;
}

module.exports = {
  createPublicSnapshot,
};
