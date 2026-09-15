const assert = require('node:assert/strict');
const test = require('node:test');

const { GAME_PHASES } = require('../../src/game/gamePhase');
const { createGameState } = require('../../src/game/gameState');
const { createCommandRouter } = require('../../src/game/commandRouter');
const { ROOM_DEFINITIONS } = require('../../src/data/rooms');
const { createMapState } = require('../../src/game/mapState');
const { placeRoom } = require('../../src/game/roomPlacement');
const { triggerMummyWalks } = require('../../src/game/haunt/traitorAssignment');

function makeState() {
  const state = createGameState({
    players: [
      { playerNumber: 1, characterId: 'brandon-jaspers', connected: true },
      { playerNumber: 2, characterId: 'ox-bellows', connected: true },
    ],
  });
  state.turn.order = [1, 2];
  state.turn.activePlayerNumber = 1;
  state.turn.phase = GAME_PHASES.EXPLORATION;
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

function createHarnessWithRandom(state, randomInt) {
  const events = [];
  let committedState = state;
  const router = createCommandRouter({
    getState: () => committedState,
    commit: (nextState) => {
      committedState = nextState;
    },
    emit: (event) => events.push(event),
    randomInt,
  });
  return { events, getState: () => committedState, dispatch: router.dispatch };
}

test('dispatch commits and emits a successful turn pass after revision increment', () => {
  const harness = createHarness();
  const result = harness.dispatch(command('turn:pass'), { playerNumber: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.state.revision, 1);
  assert.equal(result.state.turn.activePlayerNumber, 2);
  assert.equal(harness.getState().revision, 1);
  assert.equal(harness.events.length, 1);
  assert.equal(harness.events[0].type, 'turn:passed');
  assert.equal(harness.events[0].requestId, 'turn:pass-request');
});

test('dispatch stores a server-validated combat target confirmation', () => {
  const state = makeState();
  state.turn.phase = GAME_PHASES.COMBAT;
  state.map.playerPositions = { 1: 'gallery', 2: 'gallery' };
  const harness = createHarness(state);
  const result = harness.dispatch(
    command('game:combat:select-target', { targetPlayerNumber: 2 }),
    { playerNumber: 1 },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.state.turn.pendingInteraction, {
    type: 'combat-target',
    playerNumber: 1,
    targetPlayerNumber: 2,
  });
  assert.equal(result.state.turn.phase, GAME_PHASES.COMBAT);
  assert.equal(result.event.type, 'combat-target-selected');
  assert.equal(Object.hasOwn(result.state, 'dice'), false);
  assert.equal(Object.hasOwn(result.state, 'victory'), false);
});

test('dispatch enters combat from exploration and resolves with server-owned totals and damage', () => {
  const state = makeState();
  state.map = {
    tiles: [
      { id: 'gallery', icons: [] },
      { id: 'hallway', icons: [] },
    ],
    connections: [{ from: 'gallery', to: 'hallway' }],
    explored: ['gallery', 'hallway'],
    playerPositions: { 1: 'gallery', 2: 'gallery' },
  };
  state.turn.movementRemaining = 2;
  state.players[0].private.traits = { might: 4, speed: 3, sanity: 3, knowledge: 1 };
  state.players[1].private.traits = { might: 3, speed: 2, sanity: 2, knowledge: 2 };
  const harness = createHarnessWithRandom(state, (() => {
    const values = [2, 1, 0, 1];
    let index = 0;
    return () => values[index++];
  })());

  const selected = harness.dispatch(
    command('game:combat:select-target', { targetPlayerNumber: 2 }),
    { playerNumber: 1 },
  );
  const resolved = harness.dispatch(
    command('game:combat:resolve', {}, 1),
    { playerNumber: 1 },
  );

  assert.equal(selected.ok, true);
  assert.equal(selected.state.turn.phase, GAME_PHASES.COMBAT);
  assert.deepEqual(selected.state.turn.pendingInteraction, {
    type: 'combat-target',
    playerNumber: 1,
    targetPlayerNumber: 2,
  });
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.event, {
    type: 'combat-resolved',
    requestId: 'game:combat:resolve-request',
    result: {
      attackerPlayerNumber: 1,
      targetPlayerNumber: 2,
      attackerTotal: 7,
      defenderTotal: 4,
      damage: 3,
    },
  });
  assert.equal(resolved.state.players[1].private.traits.might, 0);
  assert.equal(resolved.state.turn.pendingInteraction, null);
  assert.equal(resolved.state.turn.phase, GAME_PHASES.EXPLORATION);
  assert.equal(resolved.state.turn.movementRemaining, 0);
  assert.equal(resolved.state.revision, 2);

  const passed = harness.dispatch(command('turn:pass', {}, 2), { playerNumber: 1 });
  const nextPlayerMoved = harness.dispatch(
    command('move:step', { tileId: 'hallway' }, 3),
    { playerNumber: 2 },
  );

  assert.equal(passed.ok, true);
  assert.equal(passed.state.turn.activePlayerNumber, 2);
  assert.equal(passed.state.turn.phase, GAME_PHASES.EXPLORATION);
  assert.equal(passed.state.turn.movementRemaining, 2);
  assert.equal(nextPlayerMoved.ok, true);
  assert.equal(nextPlayerMoved.state.turn.pendingMove.currentTileId, 'hallway');
});

test('combat selection cannot replace a required card draw and card flow remains completable', () => {
  const state = makeState();
  state.map.playerPositions = { 1: 'gallery', 2: 'gallery' };
  state.turn.pendingInteraction = {
    type: 'card-draw',
    playerNumber: 1,
    cardType: 'event',
  };
  const before = JSON.parse(JSON.stringify(state));
  const harness = createHarness(state);

  const rejected = harness.dispatch(
    command('game:combat:select-target', { targetPlayerNumber: 2 }),
    { playerNumber: 1 },
  );

  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'pending-interaction');
  assert.deepEqual(harness.getState(), before);
  assert.equal(harness.getState().revision, before.revision);
  assert.deepEqual(harness.events, []);

  const drawn = harness.dispatch(
    command('game:draw-card', { cardType: 'event' }),
    { playerNumber: 1 },
  );

  assert.equal(drawn.ok, true);
  assert.equal(drawn.state.turn.pendingInteraction, null);
  assert.equal(drawn.state.revision, 1);
  assert.deepEqual(harness.events.map((event) => event.type), ['card-drawn']);
});

test('combat selection cannot replace pending movement and movement flow remains completable', () => {
  const state = makeState();
  state.map.playerPositions = { 1: 'gallery', 2: 'gallery' };
  state.turn.pendingMove = {
    playerNumber: 1,
    startTileId: 'gallery',
    currentTileId: 'gallery',
    path: ['gallery'],
    movementSpent: 0,
    immediateStop: false,
  };
  const before = JSON.parse(JSON.stringify(state));
  const harness = createHarness(state);

  const rejected = harness.dispatch(
    command('game:combat:select-target', { targetPlayerNumber: 2 }),
    { playerNumber: 1 },
  );

  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'pending-move');
  assert.deepEqual(harness.getState(), before);
  assert.equal(harness.getState().revision, before.revision);
  assert.deepEqual(harness.events, []);

  const confirmed = harness.dispatch(command('move:confirm'), { playerNumber: 1 });

  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.state.turn.pendingMove, null);
  assert.equal(confirmed.state.revision, 1);
  assert.deepEqual(harness.events.map((event) => event.type), ['move:confirmed']);
});

test('combat commands reject invalid authority and tampering without mutation or events', () => {
  const cases = [
    {
      prepare: (state) => {
        state.map.playerPositions = { 1: 'gallery', 2: 'gallery' };
      },
      input: command('game:combat:select-target', { targetPlayerNumber: 9 }),
      actor: { playerNumber: 1 },
      code: 'invalid-target',
    },
    {
      prepare: (state) => {
        state.turn.phase = GAME_PHASES.COMBAT;
        state.map.playerPositions = { 1: 'gallery', 2: 'gallery' };
      },
      input: command('game:combat:select-target', { targetPlayerNumber: 1 }),
      actor: { playerNumber: 2 },
      code: 'not-active-player',
    },
    {
      prepare: (state) => {
        state.turn.phase = GAME_PHASES.HAUNT;
        state.map.playerPositions = { 1: 'gallery', 2: 'gallery' };
      },
      input: command('game:combat:select-target', { targetPlayerNumber: 2 }),
      actor: { playerNumber: 1 },
      code: 'invalid-phase',
    },
    {
      prepare: (state) => {
        state.turn.phase = GAME_PHASES.COMBAT;
        state.map.playerPositions = { 1: 'gallery', 2: 'gallery' };
      },
      input: command('game:combat:resolve'),
      actor: { playerNumber: 1 },
      code: 'no-combat-target',
    },
    {
      prepare: (state) => {
        state.turn.phase = GAME_PHASES.COMBAT;
        state.map.playerPositions = { 1: 'gallery', 2: 'gallery' };
        state.turn.pendingInteraction = {
          type: 'combat-target',
          playerNumber: 1,
          targetPlayerNumber: 2,
        };
      },
      input: command('game:combat:resolve', {
        targetPlayerNumber: 2,
        trait: 'might',
        diceCount: 2,
        total: 99,
        damage: 99,
      }),
      actor: { playerNumber: 1 },
      code: 'tampered-combat-result',
    },
    {
      prepare: (state) => {
        state.turn.phase = GAME_PHASES.COMBAT;
        state.map.playerPositions = { 1: 'gallery', 2: 'gallery' };
      },
      input: command('game:combat:select-target', { targetPlayerNumber: 2 }, 9),
      actor: { playerNumber: 1 },
      code: 'stale-revision',
    },
  ];

  for (const entry of cases) {
    const state = makeState();
    entry.prepare(state);
    const before = JSON.parse(JSON.stringify(state));
    const harness = createHarness(state);
    const result = harness.dispatch(entry.input, entry.actor);

    assert.equal(result.ok, false);
    assert.equal(result.error.code, entry.code);
    assert.deepEqual(harness.getState(), before);
    assert.equal(harness.getState().revision, before.revision);
    assert.deepEqual(harness.events, []);
  }
});

test('dispatch pauses and resumes through authorized host commands', () => {
  const harness = createHarness();
  const pause = harness.dispatch(
    command('host:pause', { reason: '主持人暫停' }),
    { role: 'host' },
  );
  const resume = harness.dispatch(
    command('host:resume', {}, 1),
    { role: 'host' },
  );

  assert.equal(pause.ok, true);
  assert.equal(pause.state.turn.phase, GAME_PHASES.PAUSED);
  assert.equal(resume.ok, true);
  assert.equal(resume.state.turn.phase, GAME_PHASES.EXPLORATION);
  assert.equal(resume.state.revision, 2);
});

test('host pause preserves the current phase and accepts a missing payload', () => {
  const state = makeState();
  state.turn.phase = GAME_PHASES.HAUNT;
  const harness = createHarness(state);

  const pause = harness.dispatch({
    type: 'host:pause',
    requestId: 'pause-without-payload',
    baseRevision: 0,
  }, { role: 'host' });
  const resume = harness.dispatch(
    command('host:resume', {}, 1),
    { role: 'host' },
  );

  assert.equal(pause.ok, true);
  assert.equal(pause.state.pause.reason, 'host');
  assert.equal(pause.state.turn.previousPhase, GAME_PHASES.HAUNT);
  assert.equal(resume.ok, true);
  assert.equal(resume.state.turn.phase, GAME_PHASES.HAUNT);
});

test('host cannot pause an already paused game', () => {
  const state = makeState();
  state.turn.phase = GAME_PHASES.HAUNT;
  const harness = createHarness(state);
  const first = harness.dispatch({
    type: 'host:pause',
    requestId: 'pause-once',
    baseRevision: 0,
  }, { role: 'host' });

  const second = harness.dispatch({
    type: 'host:pause',
    requestId: 'pause-twice',
    baseRevision: 1,
  }, { role: 'host' });

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.error.code, 'invalid-phase');
  assert.equal(harness.getState().turn.previousPhase, GAME_PHASES.HAUNT);
});

test('dispatch rejects stale requests without committing or emitting', () => {
  const harness = createHarness();
  const before = JSON.parse(JSON.stringify(harness.getState()));
  const result = harness.dispatch(command('turn:pass', {}, 4), { playerNumber: 1 });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'stale-revision');
  assert.deepEqual(harness.getState(), before);
  assert.equal(harness.events.length, 0);
});

test('dispatch rejects invalid commands without mutating the original state', () => {
  const state = makeState();
  state.turn.phase = GAME_PHASES.COMBAT;
  const before = JSON.parse(JSON.stringify(state));
  const harness = createHarness(state);
  const result = harness.dispatch(
    command('game:combat:select-target', { targetPlayerNumber: 1 }),
    { playerNumber: 1 },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid-target');
  assert.deepEqual(state, before);
  assert.equal(harness.events.length, 0);
});

test('dispatch rejects unknown actors and unauthorized host commands', () => {
  const harness = createHarness();
  const invalidActor = harness.dispatch(command('turn:pass'), { playerNumber: 9 });
  const unauthorizedHost = harness.dispatch(command('host:pause'), { playerNumber: 1 });

  assert.equal(invalidActor.error.code, 'invalid-actor');
  assert.equal(unauthorizedHost.error.code, 'unauthorized-host-command');
  assert.equal(harness.getState().revision, 0);
});

test('turn pass is rejected while the active player has an unconfirmed move', () => {
  const state = makeState();
  state.turn.pendingMove = {
    playerNumber: 1,
    startTileId: 'entrance',
    currentTileId: 'hallway',
    path: ['entrance', 'hallway'],
    movementSpent: 1,
    immediateStop: false,
  };
  const before = JSON.parse(JSON.stringify(state));
  const harness = createHarness(state);
  const result = harness.dispatch(command('turn:pass'), { playerNumber: 1 });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'pending-move');
  assert.deepEqual(harness.getState(), before);
  assert.equal(harness.events.length, 0);
});

test('entering a card room creates a server-computed draw interaction that stops movement', () => {
  const state = makeState();
  state.map = {
    tiles: [
      { id: 'entrance', icons: [], position: { x: 0, y: 0 } },
      { id: 'gallery', icons: ['omen'], position: { x: 1, y: 0 } },
    ],
    connections: [{ from: 'entrance', to: 'gallery' }],
    explored: ['entrance', 'gallery'],
    playerPositions: { 1: 'entrance', 2: 'entrance' },
  };
  state.turn.movementRemaining = 2;
  const harness = createHarness(state);

  const stepped = harness.dispatch(command('move:step', { tileId: 'gallery' }), { playerNumber: 1 });
  const confirmed = harness.dispatch(command('move:confirm', {}, 1), { playerNumber: 1 });
  const before = JSON.parse(JSON.stringify(harness.getState()));
  const blocked = harness.dispatch(command('move:step', { tileId: 'entrance' }, 2), { playerNumber: 1 });

  assert.equal(stepped.ok, true);
  assert.equal(confirmed.ok, true);
  assert.deepEqual(confirmed.state.turn.pendingInteraction, {
    type: 'card-draw',
    playerNumber: 1,
    cardType: 'omen',
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'pending-interaction');
  assert.deepEqual(harness.getState(), before);
});

test('entering a card room during a multi-step path forces confirmation before another destination', () => {
  const state = makeState();
  state.map = {
    tiles: [
      { id: 'entrance', icons: [], position: { x: 0, y: 0 } },
      { id: 'gallery', icons: ['omen'], position: { x: 1, y: 0 } },
      { id: 'hallway', icons: [], position: { x: 2, y: 0 } },
    ],
    connections: [
      { from: 'entrance', to: 'gallery' },
      { from: 'gallery', to: 'hallway' },
    ],
    explored: ['entrance', 'gallery', 'hallway'],
    playerPositions: { 1: 'entrance', 2: 'entrance' },
  };
  state.turn.movementRemaining = 3;
  const harness = createHarness(state);

  const enteredCardRoom = harness.dispatch(command('move:step', { tileId: 'gallery' }), { playerNumber: 1 });
  const passedThrough = harness.dispatch(command('move:step', { tileId: 'hallway' }, 1), { playerNumber: 1 });
  const confirmed = harness.dispatch(command('move:confirm', {}, 1), { playerNumber: 1 });

  assert.equal(enteredCardRoom.ok, true);
  assert.equal(enteredCardRoom.state.turn.pendingMove.currentTileId, 'gallery');
  assert.equal(enteredCardRoom.state.turn.pendingMove.immediateStop, true);
  assert.equal(passedThrough.ok, false);
  assert.equal(passedThrough.error.code, 'pending-move');
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.state.map.playerPositions[1], 'gallery');
  assert.deepEqual(confirmed.state.turn.pendingInteraction, {
    type: 'card-draw',
    playerNumber: 1,
    cardType: 'omen',
  });
});

test('entering a card room with an empty deck does not block the turn', () => {
  const state = makeState();
  state.map = {
    tiles: [
      { id: 'entrance', icons: [], position: { x: 0, y: 0 } },
      { id: 'gallery', icons: ['event'], position: { x: 1, y: 0 } },
    ],
    connections: [{ from: 'entrance', to: 'gallery' }],
    explored: ['entrance', 'gallery'],
    playerPositions: { 1: 'entrance', 2: 'entrance' },
  };
  state.decks.event.draw = [];
  state.turn.movementRemaining = 1;
  const harness = createHarness(state);

  const stepped = harness.dispatch(command('move:step', { tileId: 'gallery' }), { playerNumber: 1 });
  const confirmed = harness.dispatch(command('move:confirm', {}, 1), { playerNumber: 1 });
  const passed = harness.dispatch(command('turn:pass', {}, 2), { playerNumber: 1 });

  assert.equal(stepped.ok, true);
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.state.turn.pendingInteraction, null);
  assert.equal(passed.ok, true);
  assert.equal(passed.state.turn.activePlayerNumber, 2);
});

test('an empty pending card draw rejects safely and is cleared when the turn passes', () => {
  const state = makeState();
  state.decks.event.draw = [];
  state.turn.pendingInteraction = {
    type: 'card-draw',
    playerNumber: 1,
    cardType: 'event',
  };
  const harness = createHarness(state);
  const before = JSON.parse(JSON.stringify(state));

  const rejected = harness.dispatch(command('game:draw-card', { cardType: 'event' }), { playerNumber: 1 });

  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'empty-deck');
  assert.deepEqual(harness.getState(), before);

  const passed = harness.dispatch(command('turn:pass'), { playerNumber: 1 });

  assert.equal(passed.ok, true);
  assert.equal(passed.state.turn.pendingInteraction, null);
  assert.equal(passed.state.turn.activePlayerNumber, 2);
});

test('card commands reject wrong actors, phases, and client-supplied outcomes without mutation', () => {
  const state = makeState();
  state.turn.pendingInteraction = { type: 'card-draw', playerNumber: 1, cardType: 'event' };
  const harness = createHarness(state);
  const before = JSON.parse(JSON.stringify(harness.getState()));

  const wrongPlayer = harness.dispatch(command('game:draw-card', { cardType: 'event' }), { playerNumber: 2 });
  const tampered = harness.dispatch(command('game:draw-card', {
    cardType: 'event',
    cardId: 'event-cold-hall',
    dice: [2],
    total: 2,
    damage: 99,
    effects: [{ kind: 'gain-trait' }],
  }), { playerNumber: 1 });
  const invalidPhaseState = JSON.parse(JSON.stringify(state));
  invalidPhaseState.turn.phase = GAME_PHASES.LOBBY;
  const invalidPhaseBefore = JSON.parse(JSON.stringify(invalidPhaseState));
  const invalidPhaseHarness = createHarness(invalidPhaseState);
  const invalidPhase = invalidPhaseHarness.dispatch(
    command('game:draw-card', { cardType: 'event' }),
    { playerNumber: 1 },
  );

  assert.equal(wrongPlayer.error.code, 'not-active-player');
  assert.equal(tampered.error.code, 'tampered-card-result');
  assert.equal(invalidPhase.error.code, 'invalid-phase');
  assert.deepEqual(invalidPhaseHarness.getState(), invalidPhaseBefore);
  assert.equal(invalidPhaseHarness.getState().revision, invalidPhaseBefore.revision);
  assert.equal(invalidPhaseHarness.events.length, 0);
  assert.deepEqual(harness.getState(), before);
  assert.equal(harness.getState().revision, 0);
});

test('card commands resolve server-owned draws and Haunt Rolls', () => {
  const state = makeState();
  state.turn.pendingInteraction = { type: 'card-draw', playerNumber: 1, cardType: 'omen' };
  const harness = createHarnessWithRandom(state, () => 2);

  const drawn = harness.dispatch(command('game:draw-card', { cardType: 'omen' }), { playerNumber: 1 });
  const rolled = harness.dispatch(command('game:resolve-haunt-roll', {}, 1), { playerNumber: 1 });

  assert.equal(drawn.ok, true);
  assert.equal(drawn.event.type, 'card-drawn');
  assert.equal(drawn.state.players[0].private.cards[0].type, 'omen');
  assert.deepEqual(drawn.state.turn.pendingInteraction, {
    type: 'haunt-roll',
    playerNumber: 1,
    cardId: drawn.state.players[0].private.cards[0].id,
  });
  assert.equal(rolled.ok, true);
  assert.deepEqual(rolled.state.haunt.lastRoll, { dice: [2], total: 2 });
  assert.equal(rolled.state.turn.pendingInteraction, null);
  assert.deepEqual(harness.events.map((event) => event.type), ['card-drawn', 'haunt-triggered']);
});

test('haunt commands resolve mummy actions and reject survivor tampering without mutation', () => {
  const state = triggerMummyWalks(makeState(), () => 0);
  state.map = {
    tiles: [
      { id: 'entrance', position: { x: 0, y: 0 }, icons: [] },
      { id: 'hallway', position: { x: 1, y: 0 }, icons: [] },
    ],
    connections: [{ from: 'entrance', to: 'hallway' }],
    explored: ['entrance', 'hallway'],
    playerPositions: { 1: 'entrance', 2: 'hallway' },
  };
  const harness = createHarnessWithRandom(state, () => 2);
  const moved = harness.dispatch(command('haunt:mummy:move', { tileId: 'hallway' }), { playerNumber: 1 });
  assert.equal(moved.ok, true);
  assert.equal(moved.state.haunt.mummy.tileId, 'hallway');

  const before = JSON.parse(JSON.stringify(harness.getState()));
  const rejected = harness.dispatch(command('haunt:mummy:attack', {
    targetPlayerNumber: 2,
    damage: 99,
  }, 1), { playerNumber: 2 });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'not-active-player');
  assert.deepEqual(harness.getState(), before);
  assert.equal(harness.events.length, 1);
});

test('haunt escape command can end the game and ended commands are locked', () => {
  const state = triggerMummyWalks(makeState(), () => 0);
  state.map.playerPositions = { 1: 'hallway', 2: 'entrance' };
  state.turn.activePlayerNumber = 2;
  const harness = createHarness(state);

  const escaped = harness.dispatch(command('haunt:survivor:escape'), { playerNumber: 2 });
  assert.equal(escaped.ok, true);
  assert.equal(escaped.state.turn.phase, GAME_PHASES.ENDED);
  const rejected = harness.dispatch(command('haunt:survivor:escape', {}, 1), { playerNumber: 2 });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'game-ended');
});

test('restart confirmation and resume reconnect gate reject without mutation', () => {
  const state = makeState();
  state.players[1].connected = false;
  const harness = createHarness(state);
  const before = JSON.parse(JSON.stringify(state));

  const rejectedRestart = harness.dispatch(command('host:restart', { confirm: false }), { role: 'host' });
  assert.equal(rejectedRestart.ok, false);
  assert.equal(rejectedRestart.error.code, 'restart-confirmation-required');
  assert.deepEqual(harness.getState(), before);
  assert.deepEqual(harness.events, []);

  const paused = harness.dispatch(command('host:pause'), { role: 'host' });
  const blockedResume = harness.dispatch(command('host:resume', {}, 1), { role: 'host' });
  assert.equal(paused.ok, true);
  assert.equal(blockedResume.ok, false);
  assert.equal(blockedResume.error.code, 'players-disconnected');
  assert.equal(harness.getState().revision, 1);
  assert.equal(harness.events.length, 1);
});

test('move explore draws the first legal room and creates a pending move', () => {
  const state = makeState();
  const entrance = ROOM_DEFINITIONS.find((room) => room.id === 'entrance');
  const map = createMapState(['gallery', 'hallway']);
  state.map = placeRoom(map, entrance, { position: { x: 0, y: 0 }, rotation: 0 });
  state.map.playerPositions = { 1: 'entrance' };
  state.turn.movementRemaining = 2;
  const harness = createHarness(state);
  const result = harness.dispatch({
    type: 'move:explore',
    requestId: 'explore-request',
    baseRevision: 0,
    payload: { position: { x: 0, y: -1 }, rotation: 0 },
  }, { playerNumber: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.state.map.tiles.at(-1).id, 'hallway');
  assert.equal(result.state.map.roomDeck.length, 0);
  assert.equal(result.state.turn.pendingMove.currentTileId, 'hallway');
  assert.equal(result.event.type, 'move:explored');
});

test('move explore rejects a placement that is not adjacent to the active player', () => {
  const state = makeState();
  const entrance = ROOM_DEFINITIONS.find((room) => room.id === 'entrance');
  state.map = placeRoom(
    createMapState(['hallway']),
    entrance,
    { position: { x: 0, y: 0 }, rotation: 0 },
  );
  state.map.playerPositions = { 1: 'entrance' };
  state.turn.movementRemaining = 2;
  const before = JSON.parse(JSON.stringify(state));
  const harness = createHarness(state);
  const result = harness.dispatch({
    type: 'move:explore',
    requestId: 'explore-far-request',
    baseRevision: 0,
    payload: { position: { x: 5, y: 5 }, rotation: 0 },
  }, { playerNumber: 1 });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'illegal-placement');
  assert.deepEqual(harness.getState(), before);
  assert.equal(harness.events.length, 0);
});
