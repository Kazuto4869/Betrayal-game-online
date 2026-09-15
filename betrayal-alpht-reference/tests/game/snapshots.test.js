const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createGameState,
  cloneGameState,
} = require('../../src/game/gameState');
const { createPublicSnapshot } = require('../../src/game/publicSnapshot');
const { createPrivateSnapshot } = require('../../src/game/privateSnapshot');
const { ROOM_DEFINITIONS } = require('../../src/data/rooms');
const { createMapState } = require('../../src/game/mapState');
const { placeRoom } = require('../../src/game/roomPlacement');
const { ITEM_CARDS } = require('../../src/data/cards/item');
const { triggerMummyWalks } = require('../../src/game/haunt/traitorAssignment');

function createFixture() {
  const state = createGameState({
    room: { code: 'LAN', targetPlayerCount: 3, reconnectToken: 'room-secret' },
    players: [
      { seat: 0, playerNumber: 1, characterId: 'madeline', connected: true },
      { seat: 1, playerNumber: 2, characterId: 'ox', connected: true },
    ],
  });
  state.players[0].private = {
    cards: [{ id: 'revolver', secret: 'card-secret' }],
    hauntSecret: { objective: 'secret-objective' },
  };
  state.players[1].private = {
    cards: [{ id: 'knife', secret: 'other-card-secret' }],
  };
  state.turn = {
    order: [1, 2],
    activePlayerNumber: 1,
    phase: 'EXPLORATION',
    movementRemaining: 3,
    pendingInteraction: null,
    pendingMove: null,
  };
  state.map = {
    tiles: [{ id: 'entrance', floor: 'ground', icons: ['entrance'], doors: [] }],
    connections: [{ from: 'entrance', to: 'hall' }],
    explored: ['entrance'],
    playerPositions: { 1: 'entrance', 2: 'entrance' },
  };
  state.decks = {
    room: ['room-1', 'room-2'],
    event: { draw: ['event-1'], discard: ['event-discarded'] },
    item: { draw: [], discard: [] },
    omen: { draw: ['omen-1', 'omen-2', 'omen-3'], discard: [] },
  };
  state.haunt = {
    triggered: false,
    traitorRevealed: false,
    traitorPlayerNumber: 1,
    scenarioId: 'scenario-1',
    publicReveal: { title: '公開徵兆' },
    privateByPlayerNumber: {
      1: { role: 'traitor', objective: 'secret-objective' },
      2: { role: 'survivor', rule: 'secret-rule' },
    },
  };
  state.pause = { active: true, reason: 'host' };
  state.latestPublicLog = {
    type: 'room-explored',
    summary: '玩家探索了入口大廳',
  };
  state.revision = 7;
  return state;
}

test('haunt snapshots expose public mummy state but isolate objectives and traitor actions', () => {
  const state = triggerMummyWalks(createFixture(), () => 0);
  state.turn.activePlayerNumber = 1;
  state.map.playerPositions[1] = 'entrance';
  state.map.playerPositions[2] = 'entrance';

  const publicSnapshot = createPublicSnapshot(state);
  const traitorSnapshot = createPrivateSnapshot(state, { role: 'player', playerNumber: 1 });
  state.turn.activePlayerNumber = 2;
  const survivorSnapshot = createPrivateSnapshot(state, { role: 'player', playerNumber: 2 });
  const hostSnapshot = createPrivateSnapshot(state, { role: 'host' });

  assert.equal(publicSnapshot.haunt.mummy.tileId, 'entrance');
  assert.equal(publicSnapshot.haunt.privateByPlayerNumber, undefined);
  assert.equal(JSON.stringify(publicSnapshot).includes('mummy-custody'), false);
  assert.equal(traitorSnapshot.private.haunt.role, 'traitor');
  assert.ok(traitorSnapshot.private.legalActions.some((action) => action.type === 'haunt:mummy:move'));
  assert.equal(survivorSnapshot.private.haunt.role, 'survivor');
  assert.ok(survivorSnapshot.private.legalActions.some((action) => action.type === 'haunt:survivor:escape'));
  assert.equal(hostSnapshot.private, undefined);
});

test('createPublicSnapshot hides private data and unrevealed traitor', () => {
  const state = createFixture();
  const snapshot = createPublicSnapshot(state);

  assert.deepEqual(snapshot.room, { code: 'LAN', targetPlayerCount: 3 });
  assert.deepEqual(snapshot.players[0], {
    seat: 0,
    playerNumber: 1,
    characterId: 'madeline',
    location: 'entrance',
    connected: true,
    controlState: 'uncontrolled',
  });
  assert.equal(snapshot.players[0].private, undefined);
  assert.equal(snapshot.players[0].location, 'entrance');
  assert.equal(snapshot.haunt.traitorPlayerNumber, undefined);
  assert.equal(snapshot.haunt.privateByPlayerNumber, undefined);
  assert.deepEqual(snapshot.decks, {
    room: { remaining: 2 },
    event: { draw: 1, discard: 1 },
    item: { draw: 0, discard: 0 },
    omen: { draw: 3, discard: 0 },
  });
  assert.deepEqual(snapshot.map.tiles[0], {
    id: 'entrance',
    floor: 'ground',
    icons: ['entrance'],
    doors: [],
  });
  assert.equal(snapshot.revision, 7);
  assert.deepEqual(snapshot.latestPublicLog, state.latestPublicLog);
  assert.equal(JSON.stringify(snapshot).includes('room-secret'), false);
  assert.equal(JSON.stringify(snapshot).includes('secret-objective'), false);
});

test('createPublicSnapshot 公開預設卡牌堆的抽牌與棄牌數量，不公開卡牌內容', () => {
  const state = createGameState();
  state.decks.event.discard.push({ id: 'private-event-card', description: '事件私密文字' });
  state.decks.item.discard.push({ id: 'private-item-card', description: '物品牌私密文字' });
  state.decks.omen.discard.push({ id: 'private-omen-card', description: '預兆私密文字' });

  const snapshot = createPublicSnapshot(state);

  assert.deepEqual(snapshot.decks, {
    room: { remaining: 0 },
    event: { draw: 2, discard: 1 },
    item: { draw: 1, discard: 1 },
    omen: { draw: 1, discard: 1 },
  });
  const serialized = JSON.stringify(snapshot.decks);
  for (const privateValue of [
    'private-event-card',
    '事件私密文字',
    'private-item-card',
    '物品牌私密文字',
    'private-omen-card',
    '預兆私密文字',
  ]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test('createPublicSnapshot reveals traitor only after public reveal', () => {
  const state = createFixture();
  state.haunt.traitorRevealed = true;

  assert.equal(createPublicSnapshot(state).haunt.traitorPlayerNumber, 1);
});

test('createPrivateSnapshot isolates player secrets and host receives none', () => {
  const state = createFixture();
  const playerSnapshot = createPrivateSnapshot(state, { role: 'player', playerNumber: 1 });
  const hostSnapshot = createPrivateSnapshot(state, { role: 'host' });

  assert.deepEqual(playerSnapshot.private, {
    playerNumber: 1,
    data: state.players[0].private,
    haunt: state.haunt.privateByPlayerNumber[1],
    legalActions: [],
    movement: {
      location: 'entrance',
      reachableMoves: [{ tileId: 'hall', cost: 1, stopReason: null }],
      canConfirm: false,
      canRegret: false,
      explorationPlacements: [],
    },
  });
  assert.equal(JSON.stringify(playerSnapshot).includes('other-card-secret'), false);
  assert.equal(hostSnapshot.private, undefined);
  assert.equal(JSON.stringify(hostSnapshot).includes('secret-objective'), false);
});

test('卡牌標題與牌堆數量可公開，卡牌 ID 和文字僅提供給持有人', () => {
  const state = createFixture();
  state.players[0].private.cards = [ITEM_CARDS[0]];
  state.latestPublicLog = {
    type: 'card-drawn',
    summary: `${ITEM_CARDS[0].type}: ${ITEM_CARDS[0].name}`,
  };

  const publicSnapshot = createPublicSnapshot(state);
  const ownerSnapshot = createPrivateSnapshot(state, { role: 'player', playerNumber: 1 });
  const otherSnapshot = createPrivateSnapshot(state, { role: 'player', playerNumber: 2 });
  const hostSnapshot = createPrivateSnapshot(state, { role: 'host' });

  assert.equal(publicSnapshot.latestPublicLog.summary.includes(ITEM_CARDS[0].name), true);
  assert.equal(JSON.stringify(publicSnapshot).includes(ITEM_CARDS[0].id), false);
  assert.equal(JSON.stringify(publicSnapshot).includes(ITEM_CARDS[0].description), false);
  assert.deepEqual(ownerSnapshot.private.data.cards, [ITEM_CARDS[0]]);
  assert.equal(JSON.stringify(otherSnapshot).includes(ITEM_CARDS[0].id), false);
  assert.equal(JSON.stringify(otherSnapshot).includes(ITEM_CARDS[0].description), false);
  assert.equal(JSON.stringify(hostSnapshot).includes(ITEM_CARDS[0].id), false);
  assert.equal(JSON.stringify(hostSnapshot).includes(ITEM_CARDS[0].description), false);
});

test('card legal actions are private to the active player', () => {
  const state = createFixture();
  state.turn.pendingInteraction = {
    type: 'card-draw',
    playerNumber: 1,
    cardType: 'omen',
  };

  const publicSnapshot = createPublicSnapshot(state);
  const ownerSnapshot = createPrivateSnapshot(state, { role: 'player', playerNumber: 1 });
  const otherSnapshot = createPrivateSnapshot(state, { role: 'player', playerNumber: 2 });

  assert.equal(Object.hasOwn(publicSnapshot, 'legalActions'), false);
  assert.deepEqual(ownerSnapshot.private.legalActions, [
    { type: 'game:draw-card', cardType: 'omen' },
  ]);
  assert.deepEqual(otherSnapshot.private.legalActions, []);
  assert.deepEqual(ownerSnapshot.private.movement.reachableMoves, []);
  assert.deepEqual(ownerSnapshot.private.movement.explorationPlacements, []);
});

test('戰鬥結果公開安全摘要，合法戰鬥動作只提供給目前玩家', () => {
  const state = createFixture();
  state.players[0].private.traits = { might: 4, speed: 3, sanity: 3, knowledge: 2 };
  state.players[1].private.traits = { might: 3, speed: 2, sanity: 2, knowledge: 2 };
  state.players[0].private.cards = [{
    id: 'item-secret-weapon',
    type: 'item',
    name: '秘密武器',
    description: '私密效果文字',
    effect: { kind: 'combat-bonus', trait: 'might', amount: 2 },
  }];
  state.combat.latestResult = {
    attackerPlayerNumber: 1,
    targetPlayerNumber: 2,
    attackerTotal: 9,
    defenderTotal: 4,
    damage: 5,
    privateEffect: '不得公開',
  };

  assert.deepEqual(
    createPrivateSnapshot(state, { role: 'player', playerNumber: 1 }).private.legalActions,
    [{ type: 'game:combat:select-target', targetPlayerNumber: 2 }],
  );

  state.turn.phase = 'COMBAT';

  const publicSnapshot = createPublicSnapshot(state);
  const attackerSnapshot = createPrivateSnapshot(state, { role: 'player', playerNumber: 1 });
  const defenderSnapshot = createPrivateSnapshot(state, { role: 'player', playerNumber: 2 });
  const hostSnapshot = createPrivateSnapshot(state, { role: 'host' });

  assert.deepEqual(publicSnapshot.combat.latestResult, {
    attackerPlayerNumber: 1,
    targetPlayerNumber: 2,
    attackerTotal: 9,
    defenderTotal: 4,
    damage: 5,
  });
  assert.deepEqual(attackerSnapshot.private.legalActions, [
    { type: 'game:combat:select-target', targetPlayerNumber: 2 },
  ]);
  assert.deepEqual(defenderSnapshot.private.legalActions, []);
  assert.equal(JSON.stringify(publicSnapshot).includes('item-secret-weapon'), false);
  assert.equal(JSON.stringify(publicSnapshot).includes('不得公開'), false);
  assert.equal(JSON.stringify(defenderSnapshot).includes('私密效果文字'), false);
  assert.equal(JSON.stringify(hostSnapshot).includes('私密效果文字'), false);

  state.turn.pendingInteraction = {
    type: 'combat-target',
    playerNumber: 1,
    targetPlayerNumber: 2,
  };
  assert.deepEqual(
    createPrivateSnapshot(state, { role: 'player', playerNumber: 1 }).private.legalActions,
    [
      { type: 'game:combat:select-target', targetPlayerNumber: 2 },
      { type: 'game:combat:resolve' },
    ],
  );
});

test('待處理卡牌或移動期間不提供戰鬥選擇，且必要操作仍可用', () => {
  const state = createFixture();
  state.players[0].private.traits = { might: 4, speed: 3, sanity: 3, knowledge: 2 };
  state.players[1].private.traits = { might: 3, speed: 2, sanity: 2, knowledge: 2 };
  state.turn.pendingInteraction = {
    type: 'card-draw',
    playerNumber: 1,
    cardType: 'event',
  };

  const cardSnapshot = createPrivateSnapshot(
    state,
    { role: 'player', playerNumber: 1 },
  );

  assert.deepEqual(cardSnapshot.private.legalActions, [
    { type: 'game:draw-card', cardType: 'event' },
  ]);

  state.turn.pendingInteraction = null;
  state.turn.pendingMove = {
    playerNumber: 1,
    startTileId: 'entrance',
    currentTileId: 'entrance',
    path: ['entrance'],
    movementSpent: 0,
    immediateStop: false,
  };

  const movementSnapshot = createPrivateSnapshot(
    state,
    { role: 'player', playerNumber: 1 },
  );

  assert.deepEqual(movementSnapshot.private.legalActions, []);
  assert.equal(movementSnapshot.private.movement.canConfirm, true);
  assert.equal(movementSnapshot.private.movement.canRegret, true);
});

test('private movement snapshot exposes pending choices only to the requesting player', () => {
  const state = createFixture();
  state.turn.pendingMove = {
    playerNumber: 1,
    startTileId: 'entrance',
    currentTileId: 'entrance',
    path: ['entrance'],
    movementSpent: 0,
    immediateStop: false,
  };

  const snapshot = createPrivateSnapshot(state, { role: 'player', playerNumber: 1 });

  assert.equal(snapshot.private.movement.location, 'entrance');
  assert.equal(snapshot.private.movement.canConfirm, true);
  assert.equal(snapshot.private.movement.canRegret, true);
  assert.equal(JSON.stringify(createPrivateSnapshot(state, { role: 'player', playerNumber: 2 })).includes('canRegret'), true);
});

test('private movement snapshot exposes anonymous legal room placements without deck IDs', () => {
  const state = createFixture();
  const entrance = ROOM_DEFINITIONS.find((room) => room.id === 'entrance');
  state.map = placeRoom(
    createMapState(['hallway']),
    entrance,
    { position: { x: 0, y: 0 }, rotation: 0 },
  );
  state.map.playerPositions = { 1: 'entrance', 2: 'entrance' };
  const snapshot = createPrivateSnapshot(state, { role: 'player', playerNumber: 1 });

  assert.ok(snapshot.private.movement.explorationPlacements.length > 0);
  assert.equal(JSON.stringify(snapshot.private.movement.explorationPlacements).includes('hallway'), false);
  assert.equal(JSON.stringify(snapshot).includes('roomDeck'), false);
});

test('only the active player receives exploration placement options', () => {
  const state = createFixture();
  const entrance = ROOM_DEFINITIONS.find((room) => room.id === 'entrance');
  state.map = placeRoom(
    createMapState(['hallway']),
    entrance,
    { position: { x: 0, y: 0 }, rotation: 0 },
  );
  state.map.playerPositions = { 1: 'entrance', 2: 'entrance' };

  const inactive = createPrivateSnapshot(state, { role: 'player', playerNumber: 2 });
  assert.deepEqual(inactive.private.movement.explorationPlacements, []);
});

test('createPrivateSnapshot rejects unknown players and redacts tokens', () => {
  const state = createFixture();
  state.players[0].private.reconnectToken = 'player-token';

  assert.throws(
    () => createPrivateSnapshot(state, { role: 'player', playerNumber: 99 }),
    /不存在的玩家/,
  );
  assert.equal(JSON.stringify(createPrivateSnapshot(state, { role: 'player', playerNumber: 1 })).includes('player-token'), false);
});

test('snapshot creation does not mutate input state', () => {
  const state = createFixture();
  const before = cloneGameState(state);

  createPublicSnapshot(state);
  createPrivateSnapshot(state, { role: 'player', playerNumber: 1 });

  assert.deepEqual(state, before);
});

test('createPublicSnapshot allow-lists nested public fields', () => {
  const state = createFixture();
  state.room.objective = 'room-secret';
  state.turn.secretInstruction = 'turn-secret';
  state.map.secretDeck = ['map-secret'];
  state.map.tiles[0].secret = 'tile-secret';
  state.map.connections[0].secret = 'connection-secret';
  state.pause.secretReason = 'pause-secret';
  state.haunt.publicReveal.objective = 'reveal-secret';
  state.latestPublicLog.private = 'log-secret';

  const serialized = JSON.stringify(createPublicSnapshot(state));

  for (const secret of [
    'room-secret',
    'turn-secret',
    'map-secret',
    'tile-secret',
    'connection-secret',
    'pause-secret',
    'reveal-secret',
    'log-secret',
  ]) {
    assert.equal(serialized.includes(secret), false, `${secret} must not be public`);
  }
});
