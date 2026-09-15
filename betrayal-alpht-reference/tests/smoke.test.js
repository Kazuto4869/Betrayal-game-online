const assert = require('node:assert/strict');
const net = require('node:net');
const test = require('node:test');

const serverModule = require('../server');

async function listenOnFreePort() {
  const probe = net.createServer();

  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '0.0.0.0', resolve);
  });

  const { port } = probe.address();

  await new Promise((resolve, reject) => {
    probe.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  return port;
}

async function canListenOnPort(port) {
  const probe = net.createServer();

  try {
    await new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(port, '0.0.0.0', resolve);
    });

    return true;
  } catch (error) {
    if (error && error.code === 'EADDRINUSE') {
      return false;
    }

    throw error;
  } finally {
    if (probe.listening) {
      await new Promise((resolve, reject) => {
        probe.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  }
}

async function occupyPort(port) {
  const server = net.createServer();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolve);
  });

  return server;
}

async function closeNetServer(server) {
  if (!server) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function findAdjacentFreeCandidatePair() {
  for (let index = 0; index < serverModule.PORT_CANDIDATES.length - 1; index += 1) {
    const firstCandidate = serverModule.PORT_CANDIDATES[index];
    const secondCandidate = serverModule.PORT_CANDIDATES[index + 1];

    if (await canListenOnPort(firstCandidate) && await canListenOnPort(secondCandidate)) {
      return [firstCandidate, secondCandidate];
    }
  }

  throw new Error('No adjacent free fixed port candidates were available for the fallback test.');
}

test('exports bootstrap helpers', () => {
  assert.equal(typeof serverModule.createServer, 'function');
  assert.equal(typeof serverModule.startServer, 'function');
});

test('startServer binds to 0.0.0.0 and stop closes the server', async () => {
  const port = await listenOnFreePort();
  const started = await serverModule.startServer({ portCandidates: [port] });

  try {
    assert.equal(started.port, port);
    assert.equal(started.server.listening, true);
    assert.equal(started.server.address().address, '0.0.0.0');
  } finally {
    await started.stop();
  }

  assert.equal(started.server.listening, false);
});

test('startServer falls back from an occupied first candidate to the next fixed candidate', async () => {
  const [firstCandidate, secondCandidate] = await findAdjacentFreeCandidatePair();
  const occupied = await occupyPort(firstCandidate);
  let started;

  try {
    started = await serverModule.startServer({
      portCandidates: [firstCandidate, secondCandidate],
    });

    assert.equal(started.port, secondCandidate);
    assert.equal(started.server.address().address, '0.0.0.0');
  } finally {
    if (started) {
      await started.stop();
    }

    await closeNetServer(occupied);
  }
});
