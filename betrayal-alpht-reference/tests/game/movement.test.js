const assert = require('node:assert/strict');
const test = require('node:test');

const { GAME_PHASES } = require('../../src/game/gamePhase');
const { createGameState } = require('../../src/game/gameState');
const {
  applyMoveIntent,
  getPlayerPosition,
  getReachableMoves,
  shouldStopAfterEntering,
} = require('../../src/game/movement');

function makeState() {
  const state = createGameState({
    players: [{ playerNumber: 1, connected: true }],
  });
  state.turn.phase = GAME_PHASES.EXPLORATION;
  state.turn.activePlayerNumber = 1;
  state.turn.movementRemaining = 2;
  state.map = {
    tiles: [
      { id: 'entrance', floor: 'ground', icons: [], position: { x: 0, y: 0 } },
      { id: 'hallway', floor: 'ground', icons: [], position: { x: 0, y: -1 } },
      { id: 'basement', floor: 'ground', icons: ['stop'], position: { x: 1, y: -1 } },
    ],
    connections: [
      { from: 'entrance', to: 'hallway', type: 'normal' },
      { from: 'hallway', to: 'basement', type: 'normal' },
    ],
    explored: ['entrance', 'hallway', 'basement'],
    roomDeck: [],
    playerPositions: { 1: 'entrance' },
  };
  return state;
}

test('getPlayerPosition and getReachableMoves use server map connections', () => {
  const state = makeState();

  assert.equal(getPlayerPosition(state, 1), 'entrance');
  assert.deepEqual(getReachableMoves(state, 1), [{
    tileId: 'hallway',
    cost: 1,
    stopReason: null,
  }]);
});

test('applyMoveIntent records pending position and decrements movement', () => {
  const state = makeState();
  const next = applyMoveIntent(state, 1, 'hallway');

  assert.equal(next.map.playerPositions[1], 'entrance');
  assert.deepEqual(next.turn.pendingMove, {
    playerNumber: 1,
    startTileId: 'entrance',
    currentTileId: 'hallway',
    path: ['entrance', 'hallway'],
    movementSpent: 1,
    immediateStop: false,
  });
  assert.equal(next.turn.movementRemaining, 1);
});

test('entering a stop tile marks the pending move as immediate stop', () => {
  const state = makeState();
  state.turn.pendingMove = {
    playerNumber: 1,
    startTileId: 'entrance',
    currentTileId: 'hallway',
    path: ['entrance', 'hallway'],
    movementSpent: 1,
    immediateStop: false,
  };
  state.turn.movementRemaining = 1;

  const next = applyMoveIntent(state, 1, 'basement');

  assert.equal(shouldStopAfterEntering(next.map.tiles[2]).stop, true);
  assert.equal(next.turn.pendingMove.currentTileId, 'basement');
  assert.equal(next.turn.pendingMove.immediateStop, true);
  assert.equal(next.turn.movementRemaining, 0);
  assert.deepEqual(getReachableMoves(next, 1), []);
  assert.throws(
    () => applyMoveIntent(next, 1, 'entrance'),
    (error) => error.code === 'move-must-confirm',
  );
});

test('entering any card tile marks the pending move as immediate stop', async (t) => {
  for (const cardType of ['event', 'item', 'omen']) {
    await t.test(cardType, () => {
      const state = makeState();
      state.map.tiles[1].icons = [cardType];

      const next = applyMoveIntent(state, 1, 'hallway');

      assert.deepEqual(shouldStopAfterEntering(next.map.tiles[1]), {
        stop: true,
        reason: 'card-draw',
      });
      assert.equal(next.turn.pendingMove.currentTileId, 'hallway');
      assert.equal(next.turn.pendingMove.immediateStop, true);
      assert.deepEqual(getReachableMoves(next, 1), []);
    });
  }
});

test('applyMoveIntent rejects unreachable and over-budget targets without mutation', () => {
  const state = makeState();
  const before = JSON.parse(JSON.stringify(state));

  assert.throws(
    () => applyMoveIntent(state, 1, 'basement'),
    (error) => error.code === 'illegal-move',
  );
  assert.deepEqual(state, before);

  state.turn.movementRemaining = 0;
  assert.throws(
    () => applyMoveIntent(state, 1, 'hallway'),
    (error) => error.code === 'movement-exhausted',
  );
});
