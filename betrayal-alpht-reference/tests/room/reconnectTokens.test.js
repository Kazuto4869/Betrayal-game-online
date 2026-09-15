const assert = require('node:assert/strict');
const test = require('node:test');

const { createReconnectTokenStore } = require('../../src/room/reconnectTokens');

test('重連 token 在五分鐘內有效，到五分鐘邊界即失效', () => {
  let now = 1000;
  const tokens = createReconnectTokenStore({ now: () => now, tokenFactory: () => '固定 token' });
  tokens.issue({ seat: 2, characterId: 'jenny-leclerc' });

  assert.deepEqual(tokens.resolve('固定 token'), { seat: 2, characterId: 'jenny-leclerc' });
  now += 5 * 60 * 1000;
  assert.equal(tokens.resolve('固定 token'), null);
});

test('撤銷 token 後不可再次使用', () => {
  const tokens = createReconnectTokenStore({ tokenFactory: () => '待撤銷 token' });
  tokens.issue({ seat: 1 });
  tokens.revoke('待撤銷 token');

  assert.equal(tokens.resolve('待撤銷 token'), null);
});

test('遊戲開始後 token 可持續有效且不洩漏內部 token 表', () => {
  const tokens = createReconnectTokenStore({ now: () => 1000, tokenFactory: () => '遊戲 token' });
  tokens.issue({ seat: 3 });
  tokens.setPersistent(true);

  assert.equal(tokens.resolve('遊戲 token').seat, 3);
  assert.equal(Object.prototype.hasOwnProperty.call(tokens.publicState(), '遊戲 token'), false);
});
