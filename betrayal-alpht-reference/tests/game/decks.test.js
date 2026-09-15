const assert = require('node:assert/strict');
const test = require('node:test');

const { createGameState } = require('../../src/game/gameState');

function getModule(path) {
  try {
    return require(path);
  } catch {
    return null;
  }
}

function getCardModules() {
  return {
    event: getModule('../../src/data/cards/event'),
    item: getModule('../../src/data/cards/item'),
    omen: getModule('../../src/data/cards/omen'),
  };
}

function getDecksModule() {
  return getModule('../../src/game/decks');
}

test('卡牌定義提供不可變的版本化資料契約', () => {
  const cards = getCardModules();
  const expected = [
    ['event', 'EVENT_CARDS'],
    ['item', 'ITEM_CARDS'],
    ['omen', 'OMEN_CARDS'],
  ];

  for (const [type, exportName] of expected) {
    const module = cards[type];
    assert.notEqual(module, null);
    assert.equal(module.CARD_DATA_VERSION, 'phase-5-v1');
    assert.equal(Array.isArray(module[exportName]), true);
    assert.equal(module[exportName].length > 0, true);
    assert.equal(Object.isFrozen(module[exportName]), true);

    for (const card of module[exportName]) {
      assert.deepEqual(Object.keys(card).sort(), ['description', 'effect', 'id', 'name', 'type']);
      assert.equal(card.type, type);
      assert.match(card.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.equal(typeof card.name, 'string');
      assert.equal(typeof card.description, 'string');
      assert.equal(typeof card.effect.kind, 'string');
      assert.equal(Object.isFrozen(card), true);
      assert.equal(Object.isFrozen(card.effect), true);
    }
  }
});

test('牌堆依 supplied 順序抽牌並且不改動原始狀態', () => {
  const decksModule = getDecksModule();
  const cards = getCardModules();
  assert.notEqual(decksModule, null);
  assert.notEqual(cards.event, null);
  assert.notEqual(cards.item, null);
  assert.notEqual(cards.omen, null);

  const supplied = {
    event: [cards.event.EVENT_CARDS[1], cards.event.EVENT_CARDS[0]],
    item: [cards.item.ITEM_CARDS[0]],
    omen: [cards.omen.OMEN_CARDS[0]],
  };
  const decks = decksModule.createDeckState(supplied);
  const result = decksModule.drawCard(decks, 'event');

  assert.equal(result.card.id, cards.event.EVENT_CARDS[1].id);
  assert.deepEqual(decks.event.draw.map((card) => card.id), [
    cards.event.EVENT_CARDS[1].id,
    cards.event.EVENT_CARDS[0].id,
  ]);
  assert.deepEqual(result.decks.event.draw.map((card) => card.id), [cards.event.EVENT_CARDS[0].id]);
  assert.deepEqual(result.decks.event.discard, []);
  assert.notEqual(decks.event.draw, supplied.event);
  assert.notEqual(result.decks, decks);
  assert.notEqual(result.decks.event, decks.event);
});

test('空牌堆與未知牌堆類型會以 code 拒絕抽牌', () => {
  const decksModule = getDecksModule();
  assert.notEqual(decksModule, null);
  const decks = decksModule.createDeckState();

  assert.throws(
    () => decksModule.drawCard(decks, 'event'),
    (error) => error.code === 'empty-deck',
  );
  assert.throws(
    () => decksModule.drawCard(decks, 'room'),
    (error) => error.code === 'unknown-deck-type',
  );
});

test('抽出的卡牌可依 ID 回收到相同牌堆的棄牌區', () => {
  const decksModule = getDecksModule();
  const cards = getCardModules();
  assert.notEqual(decksModule, null);
  assert.notEqual(cards.event, null);

  const initial = decksModule.createDeckState({ event: [cards.event.EVENT_CARDS[0]] });
  const drawn = decksModule.drawCard(initial, 'event');
  const returned = decksModule.returnCard(drawn.decks, 'event', drawn.card.id);

  assert.deepEqual(returned.event.draw, []);
  assert.deepEqual(returned.event.discard, [cards.event.EVENT_CARDS[0]]);
  assert.deepEqual(drawn.decks.event.discard, []);
  assert.notEqual(returned, drawn.decks);
});

test('未知卡牌與錯誤牌堆會以 code 拒絕回收', () => {
  const decksModule = getDecksModule();
  const cards = getCardModules();
  assert.notEqual(decksModule, null);
  assert.notEqual(cards.event, null);

  const decks = decksModule.createDeckState();

  assert.throws(
    () => decksModule.returnCard(decks, 'event', 'missing-card'),
    (error) => error.code === 'unknown-card',
  );
  assert.throws(
    () => decksModule.returnCard(decks, 'item', cards.event.EVENT_CARDS[0].id),
    (error) => error.code === 'wrong-card-pile',
  );
});

test('牌堆摘要只公開抽牌與棄牌數量', () => {
  const decksModule = getDecksModule();
  const cards = getCardModules();
  assert.notEqual(decksModule, null);
  assert.notEqual(cards.event, null);
  assert.notEqual(cards.item, null);
  assert.notEqual(cards.omen, null);

  const decks = decksModule.createDeckState({
    event: [cards.event.EVENT_CARDS[0]],
    item: [cards.item.ITEM_CARDS[0]],
    omen: [cards.omen.OMEN_CARDS[0]],
  });
  const drawn = decksModule.drawCard(decks, 'event');
  const returned = decksModule.returnCard(drawn.decks, 'event', drawn.card.id);
  const summary = decksModule.getDeckSummary(returned);

  assert.deepEqual(summary, {
    event: { draw: 0, discard: 1 },
    item: { draw: 1, discard: 0 },
    omen: { draw: 1, discard: 0 },
  });
  const serialized = JSON.stringify(summary);
  for (const card of [cards.event.EVENT_CARDS[0], cards.item.ITEM_CARDS[0], cards.omen.OMEN_CARDS[0]]) {
    assert.equal(serialized.includes(card.id), false);
    assert.equal(serialized.includes(card.description), false);
  }
});

test('初始遊戲狀態接入全新的預設卡牌堆', () => {
  const decksModule = getDecksModule();
  assert.notEqual(decksModule, null);

  const first = createGameState();
  const second = createGameState();

  assert.deepEqual(decksModule.getDeckSummary(first.decks), {
    event: { draw: 2, discard: 0 },
    item: { draw: 1, discard: 0 },
    omen: { draw: 1, discard: 0 },
  });
  assert.notEqual(first.decks.event.draw, second.decks.event.draw);
  assert.notEqual(first.decks.item.draw, second.decks.item.draw);
  assert.notEqual(first.decks.omen.draw, second.decks.omen.draw);
});
