const assert = require('node:assert/strict');
const test = require('node:test');

const { GAME_PHASES } = require('../../src/game/gamePhase');
const { createGameState } = require('../../src/game/gameState');
const {
  confirmPendingMove,
  regretPendingMove,
} = require('../../src/game/pendingMove');
const { createCommandRouter } = require('../../src/game/commandRouter');

function makeState() {
  const state = createGameState({
    players: [{ playerNumber: 1, connected: true }],
  });
  state.turn.phase = GAME_PHASES.EXPLORATION;
  state.turn.activePlayerNumber = 1;
  state.turn.movementRemaining = 1;
  state.map = {
    tiles: [
      { id: 'entrance', floor: 'ground', icons: [], position: { x: 0, y: 0 } },
      { id: 'hallway', floor: 'ground', icons: [], position: { x: 0, y: -1 } },
    ],
    connections: [{ from: 'entrance', to: 'hallway', type: 'normal' }],
    explored: ['entrance', 'hallway'],
    roomDeck: [],
    playerPositions: { 1: 'entrance' },
  };
  return state;
}

function command(type, payload = {}, baseRevision = 0) {
  return { type, requestId: `${type}-request`, baseRevision, payload };
}

function createHarness(state = makeState()) {
  const events = [];
  let committedState = state;
  const router = createCommandRouter({
    getState: () => committedState,
    commit: (nextState) => {
      committedState = nextState;
    },
    emit: (event) => events.push(event),
  });
  return { events, getState: () => committedState, dispatch: router.dispatch };
}

test('confirmPendingMove commits the current tile and clears pending state', () => {
  const state = makeState();
  state.turn.pendingMove = {
    playerNumber: 1,
    startTileId: 'entrance',
    currentTileId: 'hallway',
    path: ['entrance', 'hallway'],
    movementSpent: 1,
    immediateStop: false,
  };
  const next = confirmPendingMove(state, 1);

  assert.equal(next.map.playerPositions[1], 'hallway');
  assert.equal(next.turn.pendingMove, null);
  assert.equal(next.turn.movementRemaining, 1);
  assert.equal(state.map.playerPositions[1], 'entrance');
});

test('regretPendingMove restores the start tile and refunds movement', () => {
  const state = makeState();
  state.turn.movementRemaining = 0;
  state.turn.pendingMove = {
    playerNumber: 1,
    startTileId: 'entrance',
    currentTileId: 'hallway',
    path: ['entrance', 'hallway'],
    movementSpent: 1,
    immediateStop: false,
  };
  const next = regretPendingMove(state, 1);

  assert.equal(next.map.playerPositions[1], 'entrance');
  assert.equal(next.turn.pendingMove, null);
  assert.equal(next.turn.movementRemaining, 1);
});

test('movement commands step, confirm, and emit authoritative events', () => {
  const harness = createHarness();
  const step = harness.dispatch(command('move:step', { tileId: 'hallway' }), { playerNumber: 1 });
  const confirm = harness.dispatch(command('move:confirm', {}, 1), { playerNumber: 1 });

  assert.equal(step.ok, true);
  assert.equal(step.state.turn.pendingMove.currentTileId, 'hallway');
  assert.equal(confirm.ok, true);
  assert.equal(confirm.state.map.playerPositions[1], 'hallway');
  assert.deepEqual(harness.events.map((event) => event.type), ['move:stepped', 'move:confirmed']);
});

test('regret is rejected for an immediate-stop pending move without mutation or emission', () => {
  const state = makeState();
  state.turn.pendingMove = {
    playerNumber: 1,
    startTileId: 'entrance',
    currentTileId: 'hallway',
    path: ['entrance', 'hallway'],
    movementSpent: 1,
    immediateStop: true,
  };
  state.turn.movementRemaining = 0;
  const before = JSON.parse(JSON.stringify(state));
  const harness = createHarness(state);
  const result = harness.dispatch(command('move:regret'), { playerNumber: 1 });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'move-must-confirm');
  assert.deepEqual(harness.getState(), before);
  assert.equal(harness.events.length, 0);
});

test('movement commands reject wrong actor, stale revision, and invalid target without mutation', () => {
  const harness = createHarness();
  const before = JSON.parse(JSON.stringify(harness.getState()));
  const wrongActor = harness.dispatch(command('move:step', { tileId: 'hallway' }), { playerNumber: 2 });
  const invalidTarget = harness.dispatch(command('move:step', { tileId: 'missing' }), { playerNumber: 1 });
  const stale = harness.dispatch(command('move:step', { tileId: 'hallway' }, 4), { playerNumber: 1 });

  assert.equal(wrongActor.error.code, 'invalid-actor');
  assert.equal(invalidTarget.error.code, 'illegal-move');
  assert.equal(stale.error.code, 'stale-revision');
  assert.deepEqual(harness.getState(), before);
  assert.equal(harness.events.length, 0);
});
