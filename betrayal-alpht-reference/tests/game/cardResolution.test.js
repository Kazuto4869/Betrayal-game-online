const assert = require('node:assert/strict');
const test = require('node:test');

const { EVENT_CARDS } = require('../../src/data/cards/event');
const { ITEM_CARDS } = require('../../src/data/cards/item');
const { OMEN_CARDS } = require('../../src/data/cards/omen');
const { createDeckState } = require('../../src/game/decks');
const { createGameState, cloneGameState } = require('../../src/game/gameState');
const { createPublicSnapshot } = require('../../src/game/publicSnapshot');
const { createPrivateSnapshot } = require('../../src/game/privateSnapshot');
const {
  getLegalCardActions,
  resolveDrawnCard,
} = require('../../src/game/cardResolution');

function makeState() {
  const state = createGameState({
    players: [
      {
        playerNumber: 1,
        connected: true,
        private: { traits: { might: 3, speed: 3, sanity: 3, knowledge: 3 } },
      },
      { playerNumber: 2, connected: true },
    ],
  });
  state.turn.order = [1, 2];
  state.turn.activePlayerNumber = 1;
  state.turn.phase = 'EXPLORATION';
  state.decks = {
    room: [],
    ...createDeckState({
      event: [EVENT_CARDS[0]],
      item: [ITEM_CARDS[0]],
      omen: [OMEN_CARDS[0]],
    }),
  };
  return state;
}

test('事件牌立即套用宣告效果並回收到棄牌區，且不改動原始狀態', () => {
  const state = makeState();
  const before = cloneGameState(state);

  const result = resolveDrawnCard(state, 1, 'event', () => 2);

  assert.equal(result.state.players[0].private.traits.sanity, 2);
  assert.deepEqual(result.state.decks.event.draw, []);
  assert.deepEqual(result.state.decks.event.discard, [EVENT_CARDS[0]]);
  assert.deepEqual(result.state.players[0].private.cards || [], []);
  assert.deepEqual(result.event, {
    type: 'card-drawn',
    cardType: 'event',
    title: EVENT_CARDS[0].name,
  });
  assert.deepEqual(result.state.latestPublicLog, {
    type: 'card-drawn',
    summary: `${EVENT_CARDS[0].type}: ${EVENT_CARDS[0].name}`,
  });
  assert.deepEqual(state, before);
});

test('物品牌與預兆牌僅歸持有人，預兆會建立 Haunt Roll 互動', () => {
  const itemResult = resolveDrawnCard(makeState(), 1, 'item', () => 2);
  const omenResult = resolveDrawnCard(makeState(), 1, 'omen', () => 2);

  assert.deepEqual(itemResult.state.players[0].private.cards, [ITEM_CARDS[0]]);
  assert.deepEqual(itemResult.state.decks.item.draw, []);
  assert.deepEqual(itemResult.state.decks.item.discard, []);
  assert.deepEqual(omenResult.state.players[0].private.cards, [OMEN_CARDS[0]]);
  assert.deepEqual(omenResult.state.turn.pendingInteraction, {
    type: 'haunt-roll',
    playerNumber: 1,
    cardId: OMEN_CARDS[0].id,
  });
});

test('物品牌抽取會套用確定特質效果，並只保留於持有人私有狀態', () => {
  const result = resolveDrawnCard(makeState(), 1, 'item', () => 2);
  const publicSnapshot = createPublicSnapshot(result.state);
  const ownerSnapshot = createPrivateSnapshot(result.state, { role: 'player', playerNumber: 1 });
  const otherSnapshot = createPrivateSnapshot(result.state, { role: 'player', playerNumber: 2 });

  assert.equal(result.state.players[0].private.traits.sanity, 4);
  assert.deepEqual(result.state.players[0].private.cards, [ITEM_CARDS[0]]);
  assert.deepEqual(result.state.decks.item.draw, []);
  assert.deepEqual(result.state.decks.item.discard, []);
  assert.deepEqual(ownerSnapshot.private.data.cards, [ITEM_CARDS[0]]);
  assert.equal(JSON.stringify(publicSnapshot).includes(ITEM_CARDS[0].id), false);
  assert.equal(JSON.stringify(otherSnapshot).includes(ITEM_CARDS[0].id), false);
});

test('合法卡牌動作只提供給目前玩家的伺服器待處理互動', () => {
  const state = makeState();
  state.turn.pendingInteraction = {
    type: 'card-draw',
    playerNumber: 1,
    cardType: 'omen',
  };

  assert.deepEqual(getLegalCardActions(state, 1), [
    { type: 'game:draw-card', cardType: 'omen' },
  ]);
  assert.deepEqual(getLegalCardActions(state, 2), []);

  state.turn.pendingInteraction = {
    type: 'haunt-roll',
    playerNumber: 1,
    cardId: OMEN_CARDS[0].id,
  };
  assert.deepEqual(getLegalCardActions(state, 1), [
    { type: 'game:resolve-haunt-roll' },
  ]);
});

test('empty card decks do not offer draw actions and reject without input mutation', () => {
  const state = makeState();
  state.decks.event.draw = [];
  state.turn.pendingInteraction = {
    type: 'card-draw',
    playerNumber: 1,
    cardType: 'event',
  };
  const before = cloneGameState(state);

  assert.deepEqual(getLegalCardActions(state, 1), []);
  assert.throws(
    () => resolveDrawnCard(state, 1, 'event'),
    (error) => error.code === 'empty-deck',
  );
  assert.deepEqual(state, before);
});
