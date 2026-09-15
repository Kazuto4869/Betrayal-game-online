const { GAME_PHASES } = require('./gamePhase');
const { EVENT_CARDS } = require('../data/cards/event');
const { ITEM_CARDS } = require('../data/cards/item');
const { OMEN_CARDS } = require('../data/cards/omen');
const { createDeckState } = require('./decks');

function cloneGameState(state) {
  return JSON.parse(JSON.stringify(state));
}

function copyWithoutReconnectTokens(value) {
  if (Array.isArray(value)) {
    return value.map(copyWithoutReconnectTokens);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'token' && key !== 'reconnectToken')
      .map(([key, entry]) => [key, copyWithoutReconnectTokens(entry)]),
  );
}

function createPlayer(player = {}, index) {
  return {
    seat: Number.isInteger(player.seat) ? player.seat : index,
    playerNumber: Number.isInteger(player.playerNumber) ? player.playerNumber : index + 1,
    characterId: player.characterId || null,
    connected: Boolean(player.connected),
    controlState: player.controlState || 'uncontrolled',
    private: copyWithoutReconnectTokens(player.private || {}),
  };
}

function createGameState(options = {}) {
  const inputPlayers = Array.isArray(options.players) ? options.players : [];

  return {
    room: {
      ...copyWithoutReconnectTokens(options.room || {}),
    },
    players: inputPlayers.map(createPlayer),
    turn: {
      order: [],
      activePlayerNumber: null,
      phase: GAME_PHASES.LOBBY,
      movementRemaining: 0,
      pendingInteraction: null,
      pendingMove: null,
    },
    map: {
      tiles: [],
      connections: [],
      explored: [],
      playerPositions: {},
    },
    decks: {
      room: [],
      ...createDeckState({
        event: EVENT_CARDS,
        item: ITEM_CARDS,
        omen: OMEN_CARDS,
      }),
    },
    haunt: {
      triggered: false,
      traitorPlayerNumber: null,
      scenarioId: null,
      privateByPlayerNumber: {},
      mummy: {
        tileId: null,
        movementRemaining: 0,
        custodyByPlayerNumber: {},
      },
      escapedByPlayerNumber: {},
      outcome: null,
    },
    pause: {
      active: false,
      reason: null,
      disconnectedPlayerNumbers: [],
      resumeRequested: false,
    },
    combat: {
      latestResult: null,
    },
    latestPublicLog: null,
    revision: 0,
  };
}

module.exports = {
  cloneGameState,
  createGameState,
};
