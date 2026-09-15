const assert = require('node:assert/strict');
const test = require('node:test');

const { createLanSmokeHarness } = require('./lanSmokeSupport');

test('LAN lifecycle supports join, disconnect recovery, resume, and restart', async () => {
  const harness = await createLanSmokeHarness();

  try {
    const created = await harness.createRoom(3);
    assert.equal(created.payload.targetPlayerCount, 3);

    const identities = await harness.joinPlayers(3);
    assert.equal(identities.length, 3);
    assert.deepEqual(
      identities.map((identity) => identity.payload.player.playerNumber),
      [1, 2, 3],
    );
    assert.equal(harness.latestRoomState.payload.players.length, 3);
    assert.equal(harness.latestRoomState.payload.players.every((player) => player.connected), true);
    assert.equal(harness.latestPublicSnapshot.payload.turn.phase, 'EXPLORATION');

    await harness.disconnectPlayer(0);
    assert.equal(harness.latestPublicSnapshot.payload.pause.active, true);
    assert.deepEqual(harness.latestPublicSnapshot.payload.pause.disconnectedPlayerNumbers, [1]);

    const reconnected = await harness.reconnectPlayer(0, identities[0].payload.token);
    assert.equal(reconnected.payload.player.playerNumber, 1);
    assert.equal(harness.latestPrivateSnapshots.get(1).payload.private.playerNumber, 1);
    assert.equal(JSON.stringify(harness.latestPublicSnapshot.payload).includes(identities[0].payload.token), false);
    assert.equal(harness.latestPublicSnapshot.payload.pause.active, true);

    const resumed = await harness.sendHostCommand('host:resume', {}, harness.latestPublicSnapshot.payload.revision);
    assert.equal(resumed.payload.pause.active, false);
    assert.equal(resumed.payload.turn.phase, 'EXPLORATION');

    const restarted = await harness.sendHostCommand(
      'host:restart',
      { confirm: true },
      resumed.payload.revision,
    );
    assert.equal(restarted.payload.map.tiles[0].id, 'entrance');
    assert.equal(restarted.payload.haunt.triggered, false);
    assert.equal(restarted.payload.revision, resumed.payload.revision + 1);
    assert.deepEqual(
      restarted.payload.players.map((player) => player.playerNumber),
      [1, 2, 3],
    );
  } finally {
    await harness.close();
  }
});
