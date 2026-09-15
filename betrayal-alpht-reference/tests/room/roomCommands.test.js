const assert = require('node:assert/strict');
const test = require('node:test');

const { CHARACTER_IDS } = require('../../src/data/characters');
const {
  createRoomCommands,
  RoomCommandError,
} = require('../../src/room/roomCommands');

function deterministicRandomInt(maximum) {
  return maximum - 1;
}

test('只允許建立一個 3 到 6 人的房間', () => {
  const commands = createRoomCommands({ randomInt: deterministicRandomInt });

  assert.throws(() => commands.createRoom(2), (error) => {
    assert.equal(error instanceof RoomCommandError, true);
    assert.equal(error.code, 'invalid-player-count');
    return true;
  });

  commands.createRoom(3);
  assert.throws(() => commands.createRoom(4), (error) => {
    assert.equal(error.code, 'room-already-created');
    return true;
  });
});

test('角色只洗牌一次，並依玩家加入順序分配且不重複', () => {
  const commands = createRoomCommands({ randomInt: deterministicRandomInt });
  commands.createRoom(3);

  const first = commands.join('連線甲');
  const second = commands.join('連線乙');
  const third = commands.join('連線丙');

  assert.deepEqual(
    [first.player.characterId, second.player.characterId, third.player.characterId],
    [CHARACTER_IDS[0], CHARACTER_IDS[1], CHARACTER_IDS[2]],
  );
  assert.deepEqual(
    [first.player.seat, second.player.seat, third.player.seat],
    [1, 2, 3],
  );
  assert.equal(commands.getState().characterQueue.length, 3);
  assert.equal(commands.getState().characterQueue[0], CHARACTER_IDS[0]);
});

test('大廳斷線保留五分鐘，逾時後新玩家可接替原座位與角色', () => {
  let now = 1000;
  const commands = createRoomCommands({ now: () => now, randomInt: deterministicRandomInt });
  commands.createRoom(4);
  const original = commands.join('連線甲');
  commands.join('連線乙');
  commands.join('連線丙');
  commands.disconnect('連線甲');

  assert.throws(() => commands.join('連線新玩家'), (error) => {
    assert.equal(error.code, 'no-available-seat');
    return true;
  });

  now += 5 * 60 * 1000;
  const replacement = commands.join('連線新玩家');
  assert.equal(replacement.player.seat, original.player.seat);
  assert.equal(replacement.player.characterId, original.player.characterId);
  assert.notEqual(replacement.token, original.token);
  assert.equal(commands.reconnect(original.token, '舊連線'), null);
});

test('same connection cannot join twice', () => {
  const commands = createRoomCommands({ randomInt: deterministicRandomInt });
  commands.createRoom(3);
  commands.join('same-connection');

  assert.throws(() => commands.join('same-connection'), (error) => {
    assert.equal(error.code, 'already-joined');
    return true;
  });

  assert.equal(commands.getState().players.length, 1);
});

test('大廳座位替代後撤銷舊 token，遊戲開始後仍不可冒用', () => {
  let now = 1000;
  const commands = createRoomCommands({ now: () => now, randomInt: deterministicRandomInt });
  commands.createRoom(3);
  const original = commands.join('原玩家');
  commands.join('第二位玩家');
  commands.disconnect('原玩家');
  now += 5 * 60 * 1000;

  commands.join('替代玩家');
  commands.join('第三位玩家');
  assert.equal(commands.getState().started, true);

  commands.disconnect('替代玩家');
  assert.equal(commands.reconnect(original.token, '冒用舊 token'), null);
});

test('達到目標人數且所有座位連線時自動開始，開始後只接受原 token 重連', () => {
  const commands = createRoomCommands({ randomInt: deterministicRandomInt });
  commands.createRoom(3);
  const players = [commands.join('甲'), commands.join('乙'), commands.join('丙')];

  assert.equal(commands.getState().started, true);
  commands.disconnect('乙');

  assert.throws(() => commands.join('替補'), (error) => {
    assert.equal(error.code, 'game-already-started');
    return true;
  });

  const reconnected = commands.reconnect(players[1].token, '乙-新連線');
  assert.equal(reconnected.player.seat, players[1].player.seat);
  assert.equal(reconnected.player.characterId, players[1].player.characterId);
  assert.equal(commands.getState().players[1].connected, true);
});

test('公開大廳資料不包含重連 token', () => {
  const commands = createRoomCommands({ randomInt: deterministicRandomInt });
  commands.createRoom(3);
  commands.join('甲');

  const publicState = commands.getPublicState();
  assert.equal(JSON.stringify(publicState).includes('token'), false);
  assert.deepEqual(Object.keys(publicState.players[0]).sort(), [
    'characterId',
    'connected',
    'playerNumber',
    'seat',
  ]);
});
