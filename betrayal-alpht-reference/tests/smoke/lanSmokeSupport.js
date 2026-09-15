const { io: createClient } = require('socket.io-client');

const serverModule = require('../../server');

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

    function onMessage(envelope) {
      if (!predicate(envelope)) {
        return;
      }

      clearTimeout(timeoutId);
      socket.off('message', onMessage);
      resolve(envelope);
    }

    socket.on('message', onMessage);
  });
}

async function closeClient(socket) {
  if (!socket) {
    return;
  }

  socket.disconnect();
  if (socket.connected) {
    await new Promise((resolve) => socket.once('disconnect', resolve));
  }
}

async function createLanSmokeHarness() {
  const runtime = serverModule.composeServer({
    transport: { lanAddress: '192.168.50.24' },
  });
  const port = await serverModule.listenOnPort(runtime.server, 0, '127.0.0.1');
  const origin = `http://127.0.0.1:${port}`;
  const host = connectClient(origin);
  const players = [];
  const latestPrivateSnapshots = new Map();
  let latestRoomState;
  let latestPublicSnapshot;

  host.on('message', (envelope) => {
    if (envelope.type === 'room:state') {
      latestRoomState = envelope;
    }
    if (envelope.type === 'game:state:public') {
      latestPublicSnapshot = envelope;
    }
  });
  await waitForEnvelope(host, (message) => message.type === 'room:state');

  function trackPlayer(socket) {
    socket.on('message', (envelope) => {
      if (envelope.type === 'room:state') {
        latestRoomState = envelope;
      }
      if (envelope.type === 'game:state:public') {
        latestPublicSnapshot = envelope;
      }
      if (envelope.type === 'game:state:private' && envelope.payload?.private?.playerNumber) {
        latestPrivateSnapshots.set(envelope.payload.private.playerNumber, envelope);
      }
    });
  }

  return {
    host,
    players,
    latestPrivateSnapshots,
    get latestRoomState() {
      return latestRoomState;
    },
    get latestPublicSnapshot() {
      return latestPublicSnapshot;
    },
    async createRoom(targetPlayerCount) {
      const response = waitForEnvelope(
        host,
        (message) => message.type === 'room:state' && message.requestId === 'smoke-create',
      );
      host.emit('message', {
        type: 'room:create',
        requestId: 'smoke-create',
        payload: { targetPlayerCount },
      });
      return response;
    },
    async joinPlayers(count) {
      const identities = [];
      for (let index = 0; index < count; index += 1) {
        const socket = connectClient(origin);
        players.push(socket);
        trackPlayer(socket);
        await waitForEnvelope(socket, (message) => message.type === 'room:state');
        const identityPromise = waitForEnvelope(
          socket,
          (message) => message.type === 'player:identity' && message.requestId === `smoke-join-${index + 1}`,
        );
        const initialGamePromise = index === count - 1
          ? waitForEnvelope(
            host,
            (message) => message.type === 'game:state:public' && message.payload?.turn?.phase === 'EXPLORATION',
          )
          : null;
        socket.emit('message', {
          type: 'room:join',
          requestId: `smoke-join-${index + 1}`,
          payload: {},
        });
        identities.push(await identityPromise);
        if (initialGamePromise) {
          await initialGamePromise;
        }
      }
      return identities;
    },
    async disconnectPlayer(index) {
      const socket = players[index];
      const paused = waitForEnvelope(
        host,
        (message) => message.type === 'game:state:public' && message.payload?.pause?.active === true,
      );
      await closeClient(socket);
      await paused;
    },
    async reconnectPlayer(index, token) {
      const socket = connectClient(origin);
      players[index] = socket;
      trackPlayer(socket);
      await waitForEnvelope(socket, (message) => message.type === 'room:state');
      const identityPromise = waitForEnvelope(
        socket,
        (message) => message.type === 'player:identity' && message.requestId === `smoke-reconnect-${index + 1}`,
      );
      const privatePromise = waitForEnvelope(
        socket,
        (message) => message.type === 'game:state:private' && message.requestId === `smoke-reconnect-${index + 1}`,
      );
      socket.emit('message', {
        type: 'room:reconnect',
        requestId: `smoke-reconnect-${index + 1}`,
        payload: { token },
      });
      await privatePromise;
      return identityPromise;
    },
    async sendHostCommand(type, payload, baseRevision) {
      const requestId = `smoke-${type}`;
      const response = waitForEnvelope(
        host,
        (message) => message.type === 'game:state:public' && message.requestId === requestId,
      );
      host.emit('message', {
        type: 'game:command',
        requestId,
        payload: { type, baseRevision, payload },
      });
      return response;
    },
    async close() {
      await Promise.all([closeClient(host), ...players.map(closeClient)]);
      await runtime.stop();
    },
  };
}

module.exports = {
  createLanSmokeHarness,
};
