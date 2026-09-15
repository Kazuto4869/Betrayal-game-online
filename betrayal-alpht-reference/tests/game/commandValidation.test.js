const assert = require('node:assert/strict');
const test = require('node:test');

const { GAME_PHASES } = require('../../src/game/gamePhase');
const { createGameState } = require('../../src/game/gameState');
const { validateCommand } = require('../../src/game/commandValidation');
const { triggerMummyWalks } = require('../../src/game/haunt/traitorAssignment');

function makeState(overrides = {}) {
  const state = createGameState({
    players: [
      { playerNumber: 1, characterId: 'brandon-jaspers', connected: true },
      { playerNumber: 2, characterId: 'ox-bellows', connected: true },
    ],
  });
  state.turn = {
    ...state.turn,
    order: [1, 2],
    activePlayerNumber: 1,
    phase: GAME_PHASES.EXPLORATION,
  };
  return {
    ...state,
    ...overrides,
    turn: { ...state.turn, ...(overrides.turn || {}) },
  };
}

function command(type, payload = {}, baseRevision = 0) {
  return { type, requestId: `${type}-request`, baseRevision, payload };
}

test('validateCommand accepts a turn pass from the active player', () => {
  const result = validateCommand(
    makeState(),
    command('turn:pass'),
    { playerNumber: 1 },
  );

  assert.deepEqual(result, {
    valid: true,
    command: command('turn:pass'),
  });
});

test('validateCommand accepts intent-only haunt actions and rejects client results', () => {
  const state = triggerMummyWalks(makeState(), () => 0);
  state.map.connections = [{ from: 'entrance', to: 'hallway' }];
  state.haunt.mummy.tileId = 'entrance';

  const valid = validateCommand(
    state,
    command('haunt:mummy:move', { tileId: 'hallway' }),
    { playerNumber: 1 },
  );
  const tampered = validateCommand(
    state,
    command('haunt:mummy:attack', { targetPlayerNumber: 2, damage: 99 }),
    { playerNumber: 1 },
  );

  assert.equal(valid.valid, true);
  assert.equal(tampered.valid, false);
  assert.equal(tampered.error.code, 'tampered-haunt-result');
});

test('validateCommand rejects a command from the wrong active player', () => {
  const result = validateCommand(makeState(), command('turn:pass'), { playerNumber: 2 });

  assert.equal(result.valid, false);
  assert.equal(result.error.code, 'not-active-player');
});

test('validateCommand rejects turn commands in an invalid phase', () => {
  const state = makeState({ turn: { phase: GAME_PHASES.LOBBY } });
  const result = validateCommand(state, command('turn:pass'), { playerNumber: 1 });

  assert.equal(result.valid, false);
  assert.equal(result.error.code, 'invalid-phase');
});

test('validateCommand rejects a stale request revision', () => {
  const state = makeState({ revision: 3 });
  const result = validateCommand(state, command('turn:pass', {}, 2), { playerNumber: 1 });

  assert.equal(result.valid, false);
  assert.equal(result.error.code, 'stale-revision');
});

test('validateCommand rejects an invalid or self target', () => {
  const state = makeState({ turn: { phase: GAME_PHASES.COMBAT } });
  state.map.playerPositions = { 1: 'gallery', 2: 'gallery' };
  const missing = validateCommand(
    state,
    command('game:combat:select-target', { targetPlayerNumber: 9 }),
    { playerNumber: 1 },
  );
  const self = validateCommand(
    state,
    command('game:combat:select-target', { targetPlayerNumber: 1 }),
    { playerNumber: 1 },
  );

  assert.equal(missing.error.code, 'invalid-target');
  assert.equal(self.error.code, 'invalid-target');
});

test('validateCommand accepts a legal combat target selection during exploration', () => {
  const state = makeState();
  state.map.playerPositions = { 1: 'gallery', 2: 'gallery' };

  const result = validateCommand(
    state,
    command('game:combat:select-target', { targetPlayerNumber: 2 }),
    { playerNumber: 1 },
  );

  assert.equal(result.valid, true);
});

test('validateCommand rejects combat selection while required card or movement state is pending', () => {
  const cases = [
    {
      pendingInteraction: {
        type: 'card-draw',
        playerNumber: 1,
        cardType: 'event',
      },
      pendingMove: null,
      code: 'pending-interaction',
    },
    {
      pendingInteraction: null,
      pendingMove: {
        playerNumber: 1,
        startTileId: 'gallery',
        currentTileId: 'gallery',
        path: ['gallery'],
        movementSpent: 0,
        immediateStop: false,
      },
      code: 'pending-move',
    },
  ];

  for (const entry of cases) {
    const state = makeState();
    state.map.playerPositions = { 1: 'gallery', 2: 'gallery' };
    state.turn.pendingInteraction = entry.pendingInteraction;
    state.turn.pendingMove = entry.pendingMove;
    const before = JSON.parse(JSON.stringify(state));

    const result = validateCommand(
      state,
      command('game:combat:select-target', { targetPlayerNumber: 2 }),
      { playerNumber: 1 },
    );

    assert.equal(result.valid, false);
    assert.equal(result.error.code, entry.code);
    assert.deepEqual(state, before);
  }
});

test('validateCommand accepts only an empty combat resolve intent after confirmation', () => {
  const state = makeState({ turn: { phase: GAME_PHASES.COMBAT } });
  state.map.playerPositions = { 1: 'gallery', 2: 'gallery' };
  state.turn.pendingInteraction = {
    type: 'combat-target',
    playerNumber: 1,
    targetPlayerNumber: 2,
  };

  const valid = validateCommand(
    state,
    command('game:combat:resolve'),
    { playerNumber: 1 },
  );
  const reselected = validateCommand(
    state,
    command('game:combat:select-target', { targetPlayerNumber: 2 }),
    { playerNumber: 1 },
  );
  const tampered = validateCommand(
    state,
    command('game:combat:resolve', { total: 99, damage: 99 }),
    { playerNumber: 1 },
  );

  assert.equal(valid.valid, true);
  assert.equal(reselected.valid, true);
  assert.equal(tampered.valid, false);
  assert.equal(tampered.error.code, 'tampered-combat-result');
});

test('validateCommand rejects player commands while paused', () => {
  const state = makeState({
    pause: { active: true, reason: 'host' },
    turn: { phase: GAME_PHASES.PAUSED },
  });
  const result = validateCommand(state, command('turn:pass'), { playerNumber: 1 });

  assert.equal(result.valid, false);
  assert.equal(result.error.code, 'paused-game');
});

test('validateCommand rejects unauthorized host commands and ended pause', () => {
  const playerResult = validateCommand(makeState(), command('host:pause'), { playerNumber: 1 });
  const endedResult = validateCommand(
    makeState({ turn: { phase: GAME_PHASES.ENDED } }),
    command('host:pause'),
    { role: 'host' },
  );

  assert.equal(playerResult.error.code, 'unauthorized-host-command');
  assert.equal(endedResult.error.code, 'invalid-phase');
});

test('validateCommand accepts host resume only while paused', () => {
  const result = validateCommand(
    makeState({ turn: { phase: GAME_PHASES.PAUSED }, pause: { active: true } }),
    command('host:resume'),
    { role: 'host' },
  );

  assert.equal(result.valid, true);
});

test('validateCommand rejects an empty pending card deck without mutation', () => {
  const state = makeState();
  state.turn.pendingInteraction = {
    type: 'card-draw',
    playerNumber: 1,
    cardType: 'event',
  };
  state.decks.event.draw = [];
  const before = JSON.parse(JSON.stringify(state));

  const result = validateCommand(
    state,
    command('game:draw-card', { cardType: 'event' }),
    { playerNumber: 1 },
  );

  assert.equal(result.valid, false);
  assert.equal(result.error.code, 'empty-deck');
  assert.deepEqual(state, before);
});
