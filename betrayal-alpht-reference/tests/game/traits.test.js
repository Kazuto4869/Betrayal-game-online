const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CHARACTER_DEFINITIONS,
  CHARACTER_IDS,
  getCharacterDefinition,
} = require('../../src/data/characters');

function getTraitsModule() {
  try {
    return require('../../src/game/traits');
  } catch {
    return null;
  }
}

test('角色定義提供版本化的四項數值軌道', () => {
  assert.equal(Array.isArray(CHARACTER_DEFINITIONS), true);
  assert.equal(CHARACTER_DEFINITIONS.length, CHARACTER_IDS.length);

  for (const definition of CHARACTER_DEFINITIONS) {
    assert.equal(definition.version, 'phase-5-v1');
    assert.equal(typeof definition.id, 'string');
    assert.equal(typeof definition.name, 'string');
    assert.deepEqual(Object.keys(definition.traits).sort(), [
      'knowledge',
      'might',
      'sanity',
      'speed',
    ]);

    for (const track of Object.values(definition.traits)) {
      assert.equal(Array.isArray(track), true);
      assert.equal(track.length > 0, true);
      assert.equal(track.every(Number.isFinite), true);
    }
  }
});

test('找不到的角色不會產生特質資料', () => {
  const traits = getTraitsModule();
  assert.equal(typeof getCharacterDefinition, 'function');
  assert.notEqual(traits, null);
  assert.equal(typeof traits.getInitialTraits, 'function');
  assert.equal(getCharacterDefinition('missing-character'), null);
  assert.equal(traits.getInitialTraits('missing-character'), null);
});

test('取得的角色定義是深層複製', () => {
  assert.equal(typeof getCharacterDefinition, 'function');
  const character = getCharacterDefinition('brandon-jaspers');
  character.name = '已變更';
  character.traits.might[0] = 99;

  assert.deepEqual(getCharacterDefinition('brandon-jaspers'), {
    version: 'phase-5-v1',
    id: 'brandon-jaspers',
    name: 'Brandon Jaspers',
    traits: {
      might: [2, 3, 3, 4, 5, 6],
      speed: [3, 4, 5, 6, 7, 8],
      sanity: [3, 3, 3, 4, 5, 6],
      knowledge: [1, 3, 3, 4, 5, 6],
    },
  });
});

test('初始特質使用每條軌道的第一個數值', () => {
  const traits = getTraitsModule();
  assert.notEqual(traits, null);
  assert.equal(typeof traits.getInitialTraits, 'function');
  assert.deepEqual(traits.getInitialTraits('brandon-jaspers'), {
    might: 2,
    speed: 3,
    sanity: 3,
    knowledge: 1,
  });
});
