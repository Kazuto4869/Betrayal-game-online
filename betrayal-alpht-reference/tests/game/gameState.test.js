const assert = require('node:assert/strict');
const test = require('node:test');

const { GAME_PHASES } = require('../../src/game/gamePhase');
const { getDeckSummary } = require('../../src/game/decks');
const {
  cloneGameState,
  createGameState,
} = require('../../src/game/gameState');

test('createGameState returns a serializable server-authoritative initial shape', () => {
  const state = createGameState({
    room: { code: 'LAN', targetPlayerCount: 3, reconnectToken: 'room-secret' },
    players: [{ seat: 0, playerNumber: 1, characterId: 'madeline' }],
  });

  assert.deepEqual(Object.keys(state).sort(), [
    'combat',
    'decks',
    'haunt',
    'latestPublicLog',
    'map',
    'pause',
    'players',
    'revision',
    'room',
    'turn',
  ]);
  assert.deepEqual(state.room, { code: 'LAN', targetPlayerCount: 3 });
  assert.equal(state.revision, 0);
  assert.equal(state.turn.phase, GAME_PHASES.LOBBY);
  assert.deepEqual(state.turn, {
    order: [],
    activePlayerNumber: null,
    phase: GAME_PHASES.LOBBY,
    movementRemaining: 0,
    pendingInteraction: null,
    pendingMove: null,
  });
  assert.deepEqual(state.map, {
    tiles: [],
    connections: [],
    explored: [],
    playerPositions: {},
  });
  assert.deepEqual(state.decks.room, []);
  assert.deepEqual(getDeckSummary(state.decks), {
    event: { draw: 2, discard: 0 },
    item: { draw: 1, discard: 0 },
    omen: { draw: 1, discard: 0 },
  });
  assert.deepEqual(state.haunt, {
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
  });
  assert.deepEqual(state.pause, {
    active: false,
    reason: null,
    disconnectedPlayerNumbers: [],
    resumeRequested: false,
  });
  assert.deepEqual(state.combat, { latestResult: null });
  assert.equal(state.latestPublicLog, null);
  assert.equal(state.players[0].connected, false);
  assert.equal(state.players[0].controlState, 'uncontrolled');
  assert.deepEqual(state.players[0].private, {});
});

test('createGameState preserves player private data while removing tokens', () => {
  const state = createGameState({
    players: [{
      playerNumber: 1,
      private: {
        cards: [{ id: 'revolver' }],
        reconnectToken: 'private-token',
      },
    }],
  });

  assert.deepEqual(state.players[0].private, {
    cards: [{ id: 'revolver' }],
  });
  assert.equal(JSON.stringify(state).includes('private-token'), false);
});

test('game state never stores reconnect tokens and clone is mutation-safe', () => {
  const state = createGameState({
    room: { code: 'LAN', targetPlayerCount: 3 },
    players: [{ seat: 0, playerNumber: 1, characterId: 'madeline', token: 'secret-token' }],
  });
  const clone = cloneGameState(state);

  assert.equal(JSON.stringify(state).includes('secret-token'), false);
  assert.equal(JSON.stringify(state).includes('room-secret'), false);
  clone.players[0].private.note = '只在玩家端顯示';
  clone.map.tiles.push({ id: 'entrance' });
  assert.deepEqual(state.players[0].private, {});
  assert.deepEqual(state.map.tiles, []);
  assert.equal(JSON.stringify(clone), JSON.stringify(JSON.parse(JSON.stringify(clone))));
});
