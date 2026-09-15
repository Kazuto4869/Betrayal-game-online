const assert = require('node:assert/strict');
const test = require('node:test');

function getDiceModule() {
  try {
    return require('../../src/game/dice');
  } catch {
    return null;
  }
}

function randomValues(values) {
  let index = 0;
  return () => values[index++];
}

test('擲骰只接受零到兩顆，並使用伺服器提供的隨機值', () => {
  const dice = getDiceModule();
  assert.notEqual(dice, null);

  assert.deepEqual(dice.rollDice(0, randomValues([])), { dice: [], total: 0 });
  assert.deepEqual(dice.rollDice(1, randomValues([2])), { dice: [2], total: 2 });
  assert.deepEqual(dice.rollDice(2, randomValues([0, 2])), { dice: [0, 2], total: 2 });
});

test('擲骰拒絕零到兩顆以外的數量', () => {
  const dice = getDiceModule();
  assert.notEqual(dice, null);

  for (const count of [-1, 3, 1.5, '1', null]) {
    assert.throws(() => dice.rollDice(count), RangeError);
  }
});

test('擲骰不會回傳範圍外的骰面', () => {
  const dice = getDiceModule();
  assert.notEqual(dice, null);

  assert.throws(() => dice.rollDice(1, randomValues([3])), RangeError);
});

test('擲骰不接受用戶端提供的結果', () => {
  const dice = getDiceModule();
  assert.notEqual(dice, null);

  assert.deepEqual(dice.rollDice(1, randomValues([2]), 99), {
    dice: [2],
    total: 2,
  });
});

test('特質檢定加總提供的特質與伺服器擲骰結果', () => {
  const dice = getDiceModule();
  assert.notEqual(dice, null);

  assert.deepEqual(dice.rollTraitCheck({ might: 2, sanity: 3 }, 2, randomValues([1, 2])), {
    base: 5,
    dice: { dice: [1, 2], total: 3 },
    total: 8,
  });
});

test('特質檢定不接受用戶端提供的結果', () => {
  const dice = getDiceModule();
  assert.notEqual(dice, null);

  assert.deepEqual(dice.rollTraitCheck({ speed: 4 }, 1, randomValues([1]), 99), {
    base: 4,
    dice: { dice: [1], total: 1 },
    total: 5,
  });
});
