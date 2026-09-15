const assert = require('node:assert/strict');
const test = require('node:test');
const { createGameState } = require('../../src/game/gameState');
const { GAME_PHASES } = require('../../src/game/gamePhase');
const { restartGameState, validateRestartPayload } = require('../../src/host/hostCommands');
const { createPublicSnapshot } = require('../../src/game/publicSnapshot');

function makeState() {
  const state = createGameState({
    room: { roomCode: 'LAN', targetPlayerCount: 2 },
    players: [
      { seat: 1, playerNumber: 1, characterId: 'madeline', connected: true, private: { cards: [{ id: 'old' }] } },
      { seat: 2, playerNumber: 2, characterId: 'ox', connected: true, private: { cards: [{ id: 'old-2' }] } },
    ],
  });
  state.turn.phase = GAME_PHASES.ENDED;
  state.haunt.triggered = true;
  state.haunt.privateByPlayerNumber = { 1: { objective: 'old-secret' } };
  state.map.tiles = [{ id: 'old-room' }];
  state.decks.event.draw = [];
  state.combat.latestResult = { damage: 5 };
  state.latestPublicLog = { type: 'old', summary: 'old game' };
  return state;
}

test('restartGameState preserves room identity and seats but clears old game data', () => {
  const oldState = makeState();
  const next = restartGameState(oldState);

  assert.deepEqual(next.room, oldState.room);
  assert.deepEqual(next.players.map((player) => ({
    seat: player.seat,
    playerNumber: player.playerNumber,
    characterId: player.characterId,
    connected: player.connected,
  })), [
    { seat: 1, playerNumber: 1, characterId: 'madeline', connected: true },
    { seat: 2, playerNumber: 2, characterId: 'ox', connected: true },
  ]);
  assert.equal(next.turn.phase, GAME_PHASES.EXPLORATION);
  assert.equal(next.map.tiles[0].id, 'entrance');
  assert.equal(next.haunt.triggered, false);
  assert.deepEqual(next.haunt.privateByPlayerNumber, {});
  assert.equal(next.combat.latestResult, null);
  assert.equal(next.latestPublicLog, null);
  assert.equal(JSON.stringify(next).includes('old-secret'), false);
  assert.equal(JSON.stringify(createPublicSnapshot(next)).includes('old-room'), false);
});

test('restart requires explicit confirmation', () => {
  assert.throws(
    () => validateRestartPayload({}),
    (error) => error.code === 'restart-confirmation-required',
  );
  assert.throws(
    () => validateRestartPayload({ confirm: false }),
    (error) => error.code === 'restart-confirmation-required',
  );
  assert.doesNotThrow(() => validateRestartPayload({ confirm: true }));
});
