const assert = require('node:assert/strict');
const test = require('node:test');
const { createGameState } = require('../../src/game/gameState');
const { GAME_PHASES } = require('../../src/game/gamePhase');
const {
  canResumeAfterReconnect,
  pauseForDisconnect,
  pauseForHost,
  resumeGame,
} = require('../../src/game/pauseState');

function makeState() {
  const state = createGameState({
    players: [{ playerNumber: 1, connected: true }, { playerNumber: 2, connected: true }],
  });
  state.turn.phase = GAME_PHASES.HAUNT;
  state.turn.pendingInteraction = { type: 'haunt-roll', playerNumber: 1 };
  state.turn.pendingMove = { playerNumber: 1, currentTileId: 'hallway' };
  state.haunt.triggered = true;
  state.haunt.privateByPlayerNumber = { 1: { objective: 'secret' } };
  return state;
}

test('host pause preserves phase, pending state, and secrets', () => {
  const state = makeState();
  const before = JSON.parse(JSON.stringify(state));
  const paused = pauseForHost(state);

  assert.equal(state.turn.phase, GAME_PHASES.HAUNT);
  assert.equal(paused.turn.phase, GAME_PHASES.PAUSED);
  assert.equal(paused.turn.previousPhase, GAME_PHASES.HAUNT);
  assert.deepEqual(paused.turn.pendingInteraction, before.turn.pendingInteraction);
  assert.deepEqual(paused.turn.pendingMove, before.turn.pendingMove);
  assert.deepEqual(paused.haunt.privateByPlayerNumber, before.haunt.privateByPlayerNumber);
  assert.deepEqual(paused.pause, {
    active: true,
    reason: 'host',
    disconnectedPlayerNumbers: [],
    resumeRequested: false,
  });
});

test('disconnect pause blocks resume until every player reconnects', () => {
  const state = makeState();
  state.players[1].connected = false;
  const paused = pauseForDisconnect(state, 2);

  assert.equal(paused.pause.reason, 'player-disconnected');
  assert.deepEqual(paused.pause.disconnectedPlayerNumbers, [2]);
  assert.equal(canResumeAfterReconnect(paused), false);

  paused.players[1].connected = true;
  assert.equal(canResumeAfterReconnect(paused), true);
  const resumed = resumeGame(paused);
  assert.equal(resumed.turn.phase, GAME_PHASES.HAUNT);
  assert.equal(resumed.pause.active, false);
  assert.deepEqual(resumed.pause.disconnectedPlayerNumbers, []);
});

test('pause helpers reject duplicate host pause and preserve input on rejection', () => {
  const paused = pauseForHost(makeState());
  const before = JSON.parse(JSON.stringify(paused));

  assert.throws(() => pauseForHost(paused), (error) => error.code === 'invalid-phase');
  assert.deepEqual(paused, before);
});
