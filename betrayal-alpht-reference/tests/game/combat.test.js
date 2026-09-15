const assert = require('node:assert/strict');
const test = require('node:test');

const { cloneGameState, createGameState } = require('../../src/game/gameState');
const {
  getLegalCombatTargets,
  resolveCombat,
} = require('../../src/game/combat');

function randomValues(values) {
  let index = 0;
  return () => values[index++];
}

function makeCombatState() {
  const state = createGameState({
    players: [
      {
        playerNumber: 1,
        characterId: 'brandon-jaspers',
        connected: true,
        private: { traits: { might: 4, speed: 3, sanity: 3, knowledge: 1 } },
      },
      {
        playerNumber: 2,
        characterId: 'ox-bellows',
        connected: true,
        private: { traits: { might: 3, speed: 2, sanity: 2, knowledge: 2 } },
      },
      {
        playerNumber: 3,
        connected: true,
        private: { traits: { might: 0, speed: 2, sanity: 2, knowledge: 2 } },
      },
      {
        playerNumber: 4,
        characterId: 'father-rhinehardt',
        connected: true,
      },
      {
        playerNumber: 2,
        characterId: 'ox-bellows',
        connected: true,
        private: { traits: { might: 3, speed: 2, sanity: 2, knowledge: 2 } },
      },
    ],
  });
  state.map.playerPositions = {
    1: 'gallery',
    2: 'gallery',
    3: 'gallery',
    4: 'entrance',
  };
  state.turn.order = [1, 2, 3, 4];
  state.turn.activePlayerNumber = 1;
  state.turn.phase = 'COMBAT';
  return state;
}

test('合法戰鬥目標只包含攻擊者所在房間內可戰鬥的不重複玩家', () => {
  const state = makeCombatState();

  assert.deepEqual(getLegalCombatTargets(state, 1), [2]);
  assert.deepEqual(getLegalCombatTargets(state, 4), []);
  assert.deepEqual(getLegalCombatTargets(state, 99), []);
});

test('戰鬥使用伺服器特質與骰子計算總值，並對目標力量套用差額傷害', () => {
  const state = makeCombatState();
  const before = cloneGameState(state);

  const resolved = resolveCombat(state, 1, 2, randomValues([2, 1, 0, 1]));

  assert.deepEqual(resolved.result, {
    attackerPlayerNumber: 1,
    targetPlayerNumber: 2,
    attackerTotal: 7,
    defenderTotal: 4,
    damage: 3,
  });
  assert.equal(resolved.state.players[1].private.traits.might, 0);
  assert.deepEqual(resolved.state.combat.latestResult, resolved.result);
  assert.deepEqual(resolved.state.latestPublicLog, {
    type: 'combat-resolved',
    summary: '玩家 1 對玩家 2 造成 3 點傷害',
  });
  assert.deepEqual(state, before);
});

test('私人 Item 戰鬥加成會改變伺服器計算的總值與傷害', () => {
  const withoutItem = makeCombatState();
  const withItem = makeCombatState();
  withItem.players[0].private.cards = [{
    id: 'item-secret-weapon',
    type: 'item',
    name: '祕密武器',
    description: '戰鬥時增加力量。',
    effect: { kind: 'combat-bonus', trait: 'might', amount: 2 },
  }];

  const unboosted = resolveCombat(withoutItem, 1, 2, randomValues([0, 0, 0, 0]));
  const boosted = resolveCombat(withItem, 1, 2, randomValues([0, 0, 0, 0]));

  assert.deepEqual(unboosted.result, {
    attackerPlayerNumber: 1,
    targetPlayerNumber: 2,
    attackerTotal: 4,
    defenderTotal: 3,
    damage: 1,
  });
  assert.deepEqual(boosted.result, {
    attackerPlayerNumber: 1,
    targetPlayerNumber: 2,
    attackerTotal: 6,
    defenderTotal: 3,
    damage: 3,
  });
  assert.equal(boosted.state.players[1].private.traits.might, 0);
});

test('戰鬥拒絕不合法目標且不改動輸入狀態', () => {
  const state = makeCombatState();
  const before = cloneGameState(state);

  assert.throws(
    () => resolveCombat(state, 1, 4, randomValues([2, 2, 0, 0])),
    (error) => error.code === 'invalid-target',
  );
  assert.deepEqual(state, before);
});
