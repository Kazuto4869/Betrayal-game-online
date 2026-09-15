const test = require('node:test');
const assert = require('node:assert/strict');
const { createGameState } = require('../../../src/game/gameState');
const { GAME_PHASES } = require('../../../src/game/gamePhase');
const { HAUNT_DATA_VERSION, MUMMY_WALKS } = require('../../../src/data/haunts/haunt-1-mummy-walks');
const { triggerMummyWalks } = require('../../../src/game/haunt/traitorAssignment');
const {
  attackMummy,
  escapeSurvivor,
  getLegalMummyMoves,
  moveMummy,
} = require('../../../src/game/haunt/mummyActions');
const { evaluateVictory } = require('../../../src/game/victory');

test('The Mummy Walks data is versioned and defines the minimal server rules', () => {
  assert.equal(HAUNT_DATA_VERSION, 'phase-6-v1');
  assert.equal(MUMMY_WALKS.id, 'the-mummy-walks');
  assert.equal(MUMMY_WALKS.mummy.startTileId, 'entrance');
  assert.equal(MUMMY_WALKS.mummy.movement, 2);
  assert.equal(Object.isFrozen(MUMMY_WALKS), true);
});

test('initial game state contains an empty, private-safe haunt boundary', () => {
  const state = createGameState();

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
  assert.equal(state.turn.phase, GAME_PHASES.LOBBY);
});

test('triggerMummyWalks assigns one traitor and private objectives without mutating input', () => {
  const state = createGameState({
    players: [
      { playerNumber: 1, characterId: 'madam-zostra' },
      { playerNumber: 2, characterId: 'professor-longfellow' },
      { playerNumber: 3, characterId: 'ox-bellows' },
    ],
  });
  const before = JSON.parse(JSON.stringify(state));

  const next = triggerMummyWalks(state, () => 1);

  assert.deepEqual(state, before);
  assert.equal(next.haunt.triggered, true);
  assert.equal(next.haunt.scenarioId, MUMMY_WALKS.id);
  assert.equal(next.haunt.traitorPlayerNumber, 2);
  assert.equal(next.haunt.mummy.tileId, 'entrance');
  assert.equal(next.turn.phase, GAME_PHASES.HAUNT);
  assert.equal(next.turn.activePlayerNumber, 2);
  assert.equal(next.haunt.privateByPlayerNumber[2].role, 'traitor');
  assert.equal(next.haunt.privateByPlayerNumber[1].role, 'survivor');
});

test('triggerMummyWalks rejects a second trigger without mutation', () => {
  const state = createGameState({
    players: [{ playerNumber: 1 }, { playerNumber: 2 }],
  });
  const triggered = triggerMummyWalks(state, () => 0);
  const before = JSON.parse(JSON.stringify(triggered));

  assert.throws(
    () => triggerMummyWalks(triggered, () => 0),
    (error) => error.code === 'haunt-already-triggered',
  );
  assert.deepEqual(triggered, before);
});

function makeHauntState() {
  const state = createGameState({
    players: [
      { playerNumber: 1, characterId: 'madam-zostra', private: { traits: { might: 4 } } },
      { playerNumber: 2, characterId: 'professor-longfellow', private: { traits: { might: 1 } } },
      { playerNumber: 3, characterId: 'ox-bellows', private: { traits: { might: 1 } } },
    ],
  });
  state.map = {
    tiles: [
      { id: 'entrance', position: { x: 0, y: 0 }, icons: [] },
      { id: 'hallway', position: { x: 1, y: 0 }, icons: [] },
    ],
    connections: [{ from: 'entrance', to: 'hallway' }],
    explored: ['entrance', 'hallway'],
    playerPositions: { 1: 'entrance', 2: 'hallway', 3: 'entrance' },
  };
  return triggerMummyWalks(state, () => 0);
}

test('mummy movement is server-authoritative and bounded by its movement points', () => {
  const state = makeHauntState();
  const before = JSON.parse(JSON.stringify(state));

  assert.deepEqual(getLegalMummyMoves(state), [{ tileId: 'hallway', cost: 1 }]);
  const moved = moveMummy(state, 1, 'hallway');
  assert.deepEqual(state, before);
  assert.equal(moved.haunt.mummy.tileId, 'hallway');
  assert.equal(moved.haunt.mummy.movementRemaining, 1);
  assert.throws(
    () => moveMummy(moved, 1, 'unknown'),
    (error) => error.code === 'illegal-mummy-move',
  );
});

test('mummy attack can place a survivor in custody and immediately gives traitor victory', () => {
  const state = makeHauntState();
  state.haunt.mummy.tileId = 'hallway';
  const result = attackMummy(state, 1, 2, () => 2);

  assert.equal(result.haunt.mummy.custodyByPlayerNumber[2], true);
  assert.equal(result.haunt.outcome.winner, 'traitor');
  assert.equal(result.turn.phase, GAME_PHASES.ENDED);
  assert.equal(evaluateVictory(result), null);
});

test('all survivors escaping at the entrance gives survivor victory', () => {
  const state = makeHauntState();
  const oneEscaped = escapeSurvivor(state, 3);
  assert.equal(oneEscaped.haunt.outcome, null);
  oneEscaped.map.playerPositions[2] = 'entrance';
  const final = escapeSurvivor(oneEscaped, 2);

  assert.equal(final.haunt.outcome.winner, 'survivors');
  assert.equal(final.turn.phase, GAME_PHASES.ENDED);
});
