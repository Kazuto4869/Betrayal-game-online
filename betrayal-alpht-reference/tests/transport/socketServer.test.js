const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { io: createClient } = require('socket.io-client');

const serverModule = require('../../server');
const { createGameState } = require('../../src/game/gameState');

function createStartedRuntime(options = {}) {
  const runtime = serverModule.composeServer(options);

  return serverModule.listenOnPort(runtime.server, 0)
    .then((port) => ({
      ...runtime,
      port,
      origin: `http://127.0.0.1:${port}`,
    }))
    .catch(async (error) => {
      await runtime.stop().catch(() => {});
      throw error;
    });
}

function request(pathname, port) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method: 'GET',
    }, (res) => {
      const chunks = [];

      res.on('data', (chunk) => {
        chunks.push(chunk);
      });

      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });

    req.once('error', reject);
    req.end();
  });
}

function connectClient(origin) {
  return createClient(origin, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
}

function waitForEnvelope(socket, predicate, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('Timed out waiting for message envelope.'));
    }, timeoutMs);

    const onMessage = (envelope) => {
      if (!predicate(envelope)) {
        return;
      }

      clearTimeout(timeoutId);
      socket.off('message', onMessage);
      resolve(envelope);
    };

    socket.on('message', onMessage);
  });
}

function waitForNoEnvelope(socket, predicate, durationMs = 200) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      socket.off('message', onMessage);
      resolve();
    }, durationMs);

    const onMessage = (envelope) => {
      if (!predicate(envelope)) {
        return;
      }

      clearTimeout(timeoutId);
      socket.off('message', onMessage);
      reject(new Error(`Unexpected envelope received: ${JSON.stringify(envelope)}`));
    };

    socket.on('message', onMessage);
  });
}

async function closeClient(socket) {
  if (!socket) {
    return;
  }

  socket.disconnect();
  await new Promise((resolve) => {
    if (!socket.connected) {
      resolve();
      return;
    }

    socket.once('disconnect', resolve);
  });
}

async function createStartedGame(runtime) {
  const host = connectClient(runtime.origin);
  const players = [
    connectClient(runtime.origin),
    connectClient(runtime.origin),
    connectClient(runtime.origin),
  ];
  const sockets = [host, ...players];

  await Promise.all(sockets.map(
    (socket) => waitForEnvelope(socket, (message) => message.type === 'room:state'),
  ));

  const created = Promise.all(sockets.map(
    (socket) => waitForEnvelope(
      socket,
      (message) => message.type === 'room:state' && message.requestId === 'create-game',
    ),
  ));
  host.emit('message', {
    type: 'room:create',
    requestId: 'create-game',
    payload: { targetPlayerCount: 3 },
  });
  await created;

  const identities = [];
  let initialPrivateSnapshots = [];
  let initialPublicSnapshots = [];
  for (let index = 0; index < players.length; index += 1) {
    const player = players[index];
    const initialPromises = index === players.length - 1
      ? players.map((entry) => waitForEnvelope(
        entry,
        (message) => message.type === 'game:state:private' && message.requestId === 'join-3',
      ))
      : null;
    const initialPublicPromises = index === players.length - 1
      ? sockets.map((entry) => waitForEnvelope(
        entry,
        (message) => message.type === 'game:state:public' && message.requestId === 'join-3',
      ))
      : null;
    const identityPromise = waitForEnvelope(
      player,
      (message) => message.type === 'player:identity' && message.requestId === `join-${index + 1}`,
    );
    player.emit('message', {
      type: 'room:join',
      requestId: `join-${index + 1}`,
      payload: {},
    });
    identities.push(await identityPromise);
    if (initialPromises) {
      initialPrivateSnapshots = await Promise.all(initialPromises);
      initialPublicSnapshots = await Promise.all(initialPublicPromises);
    }
  }

  return {
    host,
    identities,
    initialPrivateSnapshots,
    initialPublicSnapshots,
    players,
    sockets,
  };
}

test('host and player page routes return HTML', async () => {
  const runtime = await createStartedRuntime();

  try {
    const [hostResponse, playerResponse] = await Promise.all([
      request('/host', runtime.port),
      request('/player', runtime.port),
    ]);

    assert.equal(hostResponse.statusCode, 200);
    assert.match(hostResponse.headers['content-type'], /^text\/html/);
    assert.match(hostResponse.body, /<html/i);
    assert.match(hostResponse.body, /<html lang="zh-TW">/i);
    assert.match(hostResponse.body, /主機控制台/);
    assert.match(hostResponse.body, /玩家加入網址/);

    assert.equal(playerResponse.statusCode, 200);
    assert.match(playerResponse.headers['content-type'], /^text\/html/);
    assert.match(playerResponse.body, /<html/i);
    assert.match(playerResponse.body, /<html lang="zh-TW">/i);
    assert.match(playerResponse.body, /玩家大廳/);
  } finally {
    await runtime.stop();
  }
});

test('public lobby state builds joinUrl from LAN IPv4 and the actual bound port', async () => {
  const runtime = await createStartedRuntime({
    transport: { lanAddress: '192.168.50.24' },
  });
  let host;

  try {
    host = connectClient(runtime.origin);
    await waitForEnvelope(host, (message) => message.type === 'room:state');

    const createdPromise = waitForEnvelope(
      host,
      (message) => message.type === 'room:state' && message.requestId === 'create-with-url',
    );
    host.emit('message', {
      type: 'room:create',
      requestId: 'create-with-url',
      payload: { targetPlayerCount: 3 },
    });

    const created = await createdPromise;
    assert.equal(
      created.payload.joinUrl,
      `http://192.168.50.24:${runtime.port}/player`,
    );
  } finally {
    await closeClient(host);
    await runtime.stop();
  }
});

test('socket client receives initial room state envelope on connect', async () => {
  const runtime = await createStartedRuntime();
  let socket;

  try {
    socket = connectClient(runtime.origin);
    const envelope = await waitForEnvelope(socket, (message) => message.type === 'room:state');

    assert.equal(envelope.requestId, null);
    assert.deepEqual(envelope.payload, {
      roomCode: null,
      players: [],
      started: false,
    });
  } finally {
    await closeClient(socket);
    await runtime.stop();
  }
});

test('unknown commands receive a targeted rejection envelope', async () => {
  const runtime = await createStartedRuntime();
  let alpha;
  let beta;

  try {
    alpha = connectClient(runtime.origin);
    beta = connectClient(runtime.origin);

    await Promise.all([
      waitForEnvelope(alpha, (message) => message.type === 'room:state'),
      waitForEnvelope(beta, (message) => message.type === 'room:state'),
    ]);

    const rejectionPromise = waitForEnvelope(alpha, (message) => message.type === 'error:rejected');
    const otherClientPromise = waitForNoEnvelope(beta, (message) => message.type === 'error:rejected');

    alpha.emit('message', {
      type: 'room:unknown',
      requestId: 'req-123',
      payload: { any: true },
    });

    const rejection = await rejectionPromise;
    await otherClientPromise;

    assert.equal(rejection.requestId, 'req-123');
    assert.deepEqual(rejection.payload, {
      code: 'unknown-command',
      rejectedType: 'room:unknown',
    });
  } finally {
    await Promise.all([
      closeClient(alpha),
      closeClient(beta),
    ]);
    await runtime.stop();
  }
});

test('host can create one room and invalid room commands are rejected', async () => {
  const runtime = await createStartedRuntime();
  let host;

  try {
    host = connectClient(runtime.origin);
    await waitForEnvelope(host, (message) => message.type === 'room:state');

    const invalidCountPromise = waitForEnvelope(host, (message) => message.type === 'error:rejected');
    host.emit('message', {
      type: 'room:create',
      requestId: 'create-invalid',
      payload: { targetPlayerCount: 2 },
    });
    const invalidCount = await invalidCountPromise;
    assert.equal(invalidCount.requestId, 'create-invalid');
    assert.deepEqual(invalidCount.payload, {
      code: 'invalid-player-count',
      message: '遊玩人數必須是 3 至 6 人。',
    });

    const createdPromise = waitForEnvelope(host, (message) => message.type === 'room:state');
    host.emit('message', {
      type: 'room:create',
      requestId: 'create-valid',
      payload: { targetPlayerCount: 3 },
    });
    const created = await createdPromise;
    assert.equal(created.requestId, 'create-valid');
    assert.equal(created.payload.roomCode, 'LAN');
    assert.equal(created.payload.targetPlayerCount, 3);
    assert.equal(created.payload.started, false);
    assert.deepEqual(created.payload.players, []);
    assert.match(created.payload.joinUrl, /^http:\/\/[^:]+:\d+\/player$/);

    const duplicatePromise = waitForEnvelope(host, (message) => message.type === 'error:rejected');
    host.emit('message', {
      type: 'room:create',
      requestId: 'create-duplicate',
      payload: { targetPlayerCount: 3 },
    });
    const duplicate = await duplicatePromise;
    assert.equal(duplicate.requestId, 'create-duplicate');
    assert.deepEqual(duplicate.payload, {
      code: 'room-already-created',
      message: '房間已建立。',
    });
  } finally {
    await closeClient(host);
    await runtime.stop();
  }
});

test('joining returns private identity and broadcasts token-free lobby state', async () => {
  const runtime = await createStartedRuntime();
  let first;
  let second;

  try {
    first = connectClient(runtime.origin);
    second = connectClient(runtime.origin);
    await Promise.all([
      waitForEnvelope(first, (message) => message.type === 'room:state'),
      waitForEnvelope(second, (message) => message.type === 'room:state'),
    ]);

    first.emit('message', {
      type: 'room:create',
      requestId: 'create',
      payload: { targetPlayerCount: 3 },
    });
    await Promise.all([
      waitForEnvelope(first, (message) => message.type === 'room:state' && message.requestId === 'create'),
      waitForEnvelope(second, (message) => message.type === 'room:state' && message.requestId === 'create'),
    ]);

    const firstPrivatePromise = waitForEnvelope(first, (message) => message.type === 'player:identity');
    const firstPublicPromise = waitForEnvelope(second, (message) => message.type === 'room:state' && message.payload.players.length === 1);
    first.emit('message', {
      type: 'room:join',
      requestId: 'join-first',
      payload: {},
    });
    const firstPrivate = await firstPrivatePromise;
    const firstPublic = await firstPublicPromise;
    assert.equal(firstPrivate.requestId, 'join-first');
    assert.equal(typeof firstPrivate.payload.token, 'string');
    assert.equal(firstPrivate.payload.player.playerNumber, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(firstPublic.payload.players[0], 'token'), false);
    assert.equal(JSON.stringify(firstPublic.payload).includes(firstPrivate.payload.token), false);

    const secondPrivatePromise = waitForEnvelope(second, (message) => message.type === 'player:identity');
    const publicStatePromises = [
      waitForEnvelope(first, (message) => message.type === 'room:state' && message.payload.players.length === 2),
      waitForEnvelope(second, (message) => message.type === 'room:state' && message.payload.players.length === 2),
    ];
    second.emit('message', {
      type: 'room:join',
      requestId: 'join-second',
      payload: {},
    });
    const secondPrivate = await secondPrivatePromise;
    await Promise.all(publicStatePromises);
    assert.equal(secondPrivate.requestId, 'join-second');
    assert.notEqual(secondPrivate.payload.token, firstPrivate.payload.token);
    await waitForNoEnvelope(first, (message) => message.type === 'player:identity' && message.requestId === 'join-second');
  } finally {
    await Promise.all([closeClient(first), closeClient(second)]);
    await runtime.stop();
  }
});

test('disconnect marks the player and reconnect returns private identity to the new socket', async () => {
  const runtime = await createStartedRuntime();
  let player;
  let replacement;

  try {
    player = connectClient(runtime.origin);
    await waitForEnvelope(player, (message) => message.type === 'room:state');
    player.emit('message', {
      type: 'room:create',
      requestId: 'create',
      payload: { targetPlayerCount: 3 },
    });
    await waitForEnvelope(player, (message) => message.type === 'room:state' && message.requestId === 'create');

    const identityPromise = waitForEnvelope(player, (message) => message.type === 'player:identity');
    player.emit('message', { type: 'room:join', requestId: 'join', payload: {} });
    const identity = await identityPromise;
    const token = identity.payload.token;
    await closeClient(player);

    replacement = connectClient(runtime.origin);
    await waitForEnvelope(replacement, (message) => message.type === 'room:state');
    const reconnectedPromise = waitForEnvelope(replacement, (message) => message.type === 'player:identity');
    const publicStatePromise = waitForEnvelope(replacement, (message) => message.type === 'room:state' && message.payload.players[0]?.connected === true);
    replacement.emit('message', {
      type: 'room:reconnect',
      requestId: 'reconnect',
      payload: { token },
    });
    const reconnected = await reconnectedPromise;
    await publicStatePromise;
    assert.equal(reconnected.requestId, 'reconnect');
    assert.equal(reconnected.payload.player.playerNumber, 1);
    assert.equal(reconnected.payload.token, undefined);
    assert.equal(reconnected.payload.player.characterId, identity.payload.player.characterId);
  } finally {
    await closeClient(player);
    await closeClient(replacement);
    await runtime.stop();
  }
});

test('game command uses socket identity and splits public and private snapshots', async () => {
  const runtime = await createStartedRuntime();
  let game;
  let spectator;

  try {
    game = await createStartedGame(runtime);
    assert.equal(game.initialPrivateSnapshots.length, 3);
    assert.ok(game.initialPrivateSnapshots[0].payload.private.movement.explorationPlacements.length > 0);
    spectator = connectClient(runtime.origin);
    await waitForEnvelope(spectator, (message) => message.type === 'room:state');

    const publicPromises = game.sockets.map((socket) => waitForEnvelope(
      socket,
      (message) => message.type === 'game:state:public' && message.requestId === 'pass-1',
    ));
    const privatePromises = game.players.map((socket) => waitForEnvelope(
      socket,
      (message) => message.type === 'game:state:private' && message.requestId === 'pass-1',
    ));
    const spectatorGetsNothing = waitForNoEnvelope(
      spectator,
      (message) => message.type.startsWith('game:state:'),
    );

    game.players[0].emit('message', {
      type: 'game:command',
      requestId: 'pass-1',
      payload: {
        type: 'turn:pass',
        baseRevision: 0,
        payload: { actor: { role: 'host', playerNumber: 2 } },
      },
    });

    const publicSnapshots = await Promise.all(publicPromises);
    const privateSnapshots = await Promise.all(privatePromises);
    await spectatorGetsNothing;

    for (const envelope of publicSnapshots) {
      assert.equal(envelope.payload.revision, 1);
      assert.equal(envelope.payload.turn.activePlayerNumber, 2);
      assert.equal(envelope.payload.private, undefined);
    }
    assert.deepEqual(
      privateSnapshots.map((envelope) => envelope.payload.private.playerNumber),
      [1, 2, 3],
    );
    await waitForNoEnvelope(
      game.host,
      (message) => message.type === 'game:state:private' && message.requestId === 'pass-1',
    );
  } finally {
    await Promise.all([
      ...(game ? game.sockets.map(closeClient) : []),
      closeClient(spectator),
    ]);
    await runtime.stop();
  }
});

test('started game initializes the entrance map and player movement snapshot', async () => {
  const runtime = await createStartedRuntime();
  let game;

  try {
    game = await createStartedGame(runtime);
    const publicPromise = waitForEnvelope(
      game.host,
      (message) => message.type === 'game:state:public' && message.requestId === 'initial-map',
    );
    const privatePromise = waitForEnvelope(
      game.players[0],
      (message) => message.type === 'game:state:private' && message.requestId === 'initial-map',
    );
    game.players[0].emit('message', {
      type: 'game:command',
      requestId: 'initial-map',
      payload: { type: 'turn:pass', baseRevision: 0, payload: {} },
    });

    const publicSnapshot = await publicPromise;
    const privateSnapshot = await privatePromise;
    assert.equal(publicSnapshot.payload.map.tiles[0].id, 'entrance');
    assert.equal(publicSnapshot.payload.players[0].location, 'entrance');
    assert.equal(privateSnapshot.payload.private.movement.location, 'entrance');
  } finally {
    await Promise.all(game ? game.sockets.map(closeClient) : []);
    await runtime.stop();
  }
});

test('player can explore the first legal room through the Socket.IO command flow', async () => {
  const runtime = await createStartedRuntime();
  let game;

  try {
    game = await createStartedGame(runtime);
    const publicPromise = waitForEnvelope(
      game.host,
      (message) => message.type === 'game:state:public' && message.requestId === 'explore-room',
    );
    const privatePromise = waitForEnvelope(
      game.players[0],
      (message) => message.type === 'game:state:private' && message.requestId === 'explore-room',
    );
    game.players[0].emit('message', {
      type: 'game:command',
      requestId: 'explore-room',
      payload: {
        type: 'move:explore',
        baseRevision: 0,
        payload: { position: { x: 0, y: -1 }, rotation: 0 },
      },
    });

    const publicSnapshot = await publicPromise;
    const privateSnapshot = await privatePromise;
    assert.equal(publicSnapshot.payload.map.tiles.at(-1).id, 'hallway');
    assert.equal(privateSnapshot.payload.private.movement.location, 'hallway');
    assert.equal(JSON.stringify(publicSnapshot.payload).includes('roomDeck'), false);
  } finally {
    await Promise.all(game ? game.sockets.map(closeClient) : []);
    await runtime.stop();
  }
});

test('reconnecting player receives the current private game snapshot', async () => {
  const runtime = await createStartedRuntime();
  let game;
  let replacement;

  try {
    game = await createStartedGame(runtime);
    const token = game.identities[0].payload.token;
    await closeClient(game.players[0]);

    replacement = connectClient(runtime.origin);
    await waitForEnvelope(replacement, (message) => message.type === 'room:state');
    const identityPromise = waitForEnvelope(
      replacement,
      (message) => message.type === 'player:identity' && message.requestId === 'reconnect-game',
    );
    const privateSnapshotPromise = waitForEnvelope(
      replacement,
      (message) => message.type === 'game:state:private' && message.requestId === 'reconnect-game',
    );
    replacement.emit('message', {
      type: 'room:reconnect',
      requestId: 'reconnect-game',
      payload: { token },
    });

    const identity = await identityPromise;
    const privateSnapshot = await privateSnapshotPromise;
    assert.equal(identity.payload.player.playerNumber, 1);
    assert.equal(privateSnapshot.payload.private.playerNumber, 1);
    assert.equal(privateSnapshot.payload.private.movement.location, 'entrance');
  } finally {
    await Promise.all([
      ...(game ? game.sockets.map(closeClient) : []),
      closeClient(replacement),
    ]);
    await runtime.stop();
  }
});

test('wrong player socket cannot impersonate the active player and rejection does not mutate game state', async () => {
  const runtime = await createStartedRuntime();
  let game;

  try {
    game = await createStartedGame(runtime);
    const rejectionPromise = waitForEnvelope(
      game.players[1],
      (message) => message.type === 'error:rejected' && message.requestId === 'forged-pass',
    );

    game.players[1].emit('message', {
      type: 'game:command',
      requestId: 'forged-pass',
      payload: {
        type: 'turn:pass',
        baseRevision: 0,
        actor: { role: 'player', playerNumber: 1 },
      },
    });

    const rejection = await rejectionPromise;
    assert.equal(rejection.payload.code, 'not-active-player');
    await Promise.all(game.sockets.filter((socket) => socket !== game.players[1]).map(
      (socket) => waitForNoEnvelope(
        socket,
        (message) => message.requestId === 'forged-pass',
      ),
    ));

    const successPromise = waitForEnvelope(
      game.host,
      (message) => message.type === 'game:state:public' && message.requestId === 'valid-after-rejection',
    );
    game.players[0].emit('message', {
      type: 'game:command',
      requestId: 'valid-after-rejection',
      payload: { type: 'turn:pass', baseRevision: 0, payload: {} },
    });
    const success = await successPromise;
    assert.equal(success.payload.revision, 1);
  } finally {
    await Promise.all(game ? game.sockets.map(closeClient) : []);
    await runtime.stop();
  }
});

test('player payload cannot claim Host authority', async () => {
  const runtime = await createStartedRuntime();
  let game;

  try {
    game = await createStartedGame(runtime);
    const rejectionPromise = waitForEnvelope(
      game.players[0],
      (message) => message.type === 'error:rejected' && message.requestId === 'forged-host',
    );

    game.players[0].emit('message', {
      type: 'game:command',
      requestId: 'forged-host',
      payload: {
        type: 'host:pause',
        baseRevision: 0,
        payload: { reason: 'forged', role: 'host' },
        actor: { role: 'host' },
      },
    });

    const rejection = await rejectionPromise;
    assert.equal(rejection.payload.code, 'unauthorized-host-command');
  } finally {
    await Promise.all(game ? game.sockets.map(closeClient) : []);
    await runtime.stop();
  }
});

test('registered Host socket can pause through the game command envelope', async () => {
  const runtime = await createStartedRuntime();
  let game;

  try {
    game = await createStartedGame(runtime);
    const publicPromise = waitForEnvelope(
      game.players[0],
      (message) => message.type === 'game:state:public' && message.requestId === 'host-pause',
    );
    game.host.emit('message', {
      type: 'game:command',
      requestId: 'host-pause',
      payload: { type: 'host:pause', baseRevision: 0 },
    });

    const snapshot = await publicPromise;
    assert.equal(snapshot.payload.pause.active, true);
    assert.equal(snapshot.payload.turn.phase, 'PAUSED');
  } finally {
    await Promise.all(game ? game.sockets.map(closeClient) : []);
    await runtime.stop();
  }
});

test('game disconnect pauses publicly and reconnect restores the same private game state', async () => {
  const runtime = await createStartedRuntime();
  let game;
  let replacement;

  try {
    game = await createStartedGame(runtime);
    const token = game.identities[0].payload.token;
    const pausePromise = waitForEnvelope(
      game.host,
      (message) => message.type === 'game:state:public' && message.payload.pause?.active === true,
    );
    await closeClient(game.players[0]);
    const paused = await pausePromise;
    assert.deepEqual(paused.payload.pause.disconnectedPlayerNumbers, [1]);
    assert.equal(paused.payload.turn.phase, 'PAUSED');

    replacement = createClient(runtime.origin, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      autoConnect: false,
    });
    const roomPromise = waitForEnvelope(replacement, (message) => message.type === 'room:state');
    replacement.connect();
    await roomPromise;
    const identityPromise = waitForEnvelope(
      replacement,
      (message) => message.type === 'player:identity' && message.requestId === 'phase7-reconnect',
    );
    const privatePromise = waitForEnvelope(
      replacement,
      (message) => message.type === 'game:state:private' && message.requestId === 'phase7-reconnect',
    );
    replacement.emit('message', {
      type: 'room:reconnect',
      requestId: 'phase7-reconnect',
      payload: { token },
    });
    const [identity, privateSnapshot] = await Promise.all([identityPromise, privatePromise]);
    assert.equal(identity.payload.player.playerNumber, 1);
    assert.equal(privateSnapshot.payload.turn.phase, 'PAUSED');
    assert.equal(privateSnapshot.payload.private.playerNumber, 1);

    const resumedPromise = waitForEnvelope(
      game.host,
      (message) => message.type === 'game:state:public' && message.requestId === 'phase7-resume',
    );
    game.host.emit('message', {
      type: 'game:command',
      requestId: 'phase7-resume',
      payload: { type: 'host:resume', baseRevision: privateSnapshot.payload.revision },
    });
    const resumed = await resumedPromise;
    assert.equal(resumed.payload.pause.active, false);
    assert.equal(resumed.payload.turn.phase, 'EXPLORATION');
  } finally {
    await Promise.all([
      ...(game ? game.sockets.map(closeClient) : []),
      closeClient(replacement),
    ]);
    await runtime.stop();
  }
});

test('Host restart clears the old game and starts a fresh server-owned map', async () => {
  const runtime = await createStartedRuntime();
  let game;

  try {
    game = await createStartedGame(runtime);
    const snapshots = Promise.all(game.sockets.map((socket) => waitForEnvelope(
      socket,
      (message) => message.type === 'game:state:public' && message.requestId === 'phase7-restart',
    )));
    game.host.emit('message', {
      type: 'game:command',
      requestId: 'phase7-restart',
      payload: { type: 'host:restart', baseRevision: 0, payload: { confirm: true } },
    });
    const restarted = await snapshots;
    assert.equal(restarted[0].payload.turn.phase, 'EXPLORATION');
    assert.equal(restarted[0].payload.map.tiles[0].id, 'entrance');
    assert.equal(restarted[0].payload.haunt.triggered, false);
    assert.equal(restarted[0].payload.revision, 1);
  } finally {
    await Promise.all(game ? game.sockets.map(closeClient) : []);
    await runtime.stop();
  }
});

test('Socket.IO gives each player only its own private cards and keeps card IDs out of public snapshots', async () => {
  const runtime = await createStartedRuntime({
    transport: {
      gameStateFactory(options) {
        const state = createGameState(options);
        state.players[0].private.cards = [{
          id: 'item-player-one',
          name: '玩家一的私密卡牌',
          description: '玩家一的私密文字',
        }];
        state.players[1].private.cards = [{
          id: 'omen-player-two',
          name: '玩家二的私密卡牌',
          description: '玩家二的私密文字',
        }];
        return state;
      },
    },
  });
  let game;

  try {
    game = await createStartedGame(runtime);
    const publicSnapshot = game.initialPublicSnapshots[0].payload;
    const firstPrivate = game.initialPrivateSnapshots[0].payload;
    const secondPrivate = game.initialPrivateSnapshots[1].payload;

    assert.deepEqual(firstPrivate.private.data.cards, [{
      id: 'item-player-one',
      name: '玩家一的私密卡牌',
      description: '玩家一的私密文字',
    }]);
    assert.deepEqual(secondPrivate.private.data.cards, [{
      id: 'omen-player-two',
      name: '玩家二的私密卡牌',
      description: '玩家二的私密文字',
    }]);
    assert.notDeepEqual(firstPrivate.private.data.cards, secondPrivate.private.data.cards);
    assert.equal(JSON.stringify(publicSnapshot).includes('item-player-one'), false);
    assert.equal(JSON.stringify(publicSnapshot).includes('omen-player-two'), false);
    assert.equal(JSON.stringify(publicSnapshot).includes('玩家一的私密文字'), false);
    assert.equal(JSON.stringify(publicSnapshot).includes('玩家二的私密文字'), false);
  } finally {
    await Promise.all(game ? game.sockets.map(closeClient) : []);
    await runtime.stop();
  }
});

test('rejected card and combat commands do not broadcast a state revision', async () => {
  const runtime = await createStartedRuntime();
  let game;

  try {
    game = await createStartedGame(runtime);
    const cardRejection = waitForEnvelope(
      game.players[0],
      (message) => message.type === 'error:rejected' && message.requestId === 'reject-card',
    );
    const cardSenderNoState = waitForNoEnvelope(
      game.players[0],
      (message) => message.requestId === 'reject-card'
        && (message.type === 'game:state:public' || message.type === 'game:state:private'),
    );
    const cardNoBroadcast = Promise.all(game.sockets.filter((socket) => socket !== game.players[0]).map(
      (socket) => waitForNoEnvelope(socket, (message) => message.requestId === 'reject-card'),
    ));
    game.players[0].emit('message', {
      type: 'game:command',
      requestId: 'reject-card',
      payload: {
        type: 'game:draw-card',
        baseRevision: 0,
        payload: { cardId: 'forged-card', total: 99 },
      },
    });
    const cardError = await cardRejection;
    await Promise.all([cardSenderNoState, cardNoBroadcast]);
    assert.equal(cardError.payload.code, 'no-pending-interaction');

    const combatRejection = waitForEnvelope(
      game.players[0],
      (message) => message.type === 'error:rejected' && message.requestId === 'reject-combat',
    );
    const combatSenderNoState = waitForNoEnvelope(
      game.players[0],
      (message) => message.requestId === 'reject-combat'
        && (message.type === 'game:state:public' || message.type === 'game:state:private'),
    );
    const combatNoBroadcast = Promise.all(game.sockets.filter((socket) => socket !== game.players[0]).map(
      (socket) => waitForNoEnvelope(socket, (message) => message.requestId === 'reject-combat'),
    ));
    game.players[0].emit('message', {
      type: 'game:command',
      requestId: 'reject-combat',
      payload: {
        type: 'game:combat:resolve',
        baseRevision: 0,
        payload: { dice: [2, 2], damage: 99 },
      },
    });
    const combatError = await combatRejection;
    await Promise.all([combatSenderNoState, combatNoBroadcast]);
    assert.equal(combatError.payload.code, 'invalid-phase');

    const successfulState = waitForEnvelope(
      game.host,
      (message) => message.type === 'game:state:public' && message.requestId === 'valid-after-rejections',
    );
    game.players[0].emit('message', {
      type: 'game:command',
      requestId: 'valid-after-rejections',
      payload: { type: 'turn:pass', baseRevision: 0, payload: {} },
    });
    const state = await successfulState;
    assert.equal(state.payload.revision, 1);
  } finally {
    await Promise.all(game ? game.sockets.map(closeClient) : []);
    await runtime.stop();
  }
});
