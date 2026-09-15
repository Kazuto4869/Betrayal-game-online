const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { closeSocketServer, createSocketServer } = require('./src/transport/socketServer');

const PORT_CANDIDATES = [3000, 3001, 3002, 3003];
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const BOOTSTRAP_MESSAGE = 'Betrayal LAN MVP bootstrap is running.\n';

const STATIC_ROUTES = new Map([
  ['/styles/game-ui.css', 'styles/game-ui.css'],
  ['/host', 'host/index.html'],
  ['/host/', 'host/index.html'],
  ['/host/app.js', 'host/app.js'],
  ['/host/styles.css', 'host/styles.css'],
  ['/player', 'player/index.html'],
  ['/player/', 'player/index.html'],
  ['/player/app.js', 'player/app.js'],
  ['/player/styles.css', 'player/styles.css'],
]);

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

function createRequestListener(options = {}) {
  const { publicDir = PUBLIC_DIR } = options;

  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Method Not Allowed\n');
      return;
    }

    const pathname = new URL(req.url, 'http://localhost').pathname;

    if (pathname === '/') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(req.method === 'HEAD' ? undefined : BOOTSTRAP_MESSAGE);
      return;
    }

    const relativePath = STATIC_ROUTES.get(pathname);

    if (!relativePath) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(req.method === 'HEAD' ? undefined : 'Not Found\n');
      return;
    }

    const filePath = path.join(publicDir, relativePath);
    const contentType = CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream';

    fs.readFile(filePath, (error, contents) => {
      if (error) {
        res.statusCode = error.code === 'ENOENT' ? 404 : 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(req.method === 'HEAD' ? undefined : 'Unable to load asset\n');
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', contentType);
      res.end(req.method === 'HEAD' ? undefined : contents);
    });
  };
}

function createServer(options = {}) {
  return http.createServer(createRequestListener(options));
}

function composeServer(options = {}) {
  const server = createServer(options);
  const io = createSocketServer(server, options.transport);

  return {
    server,
    io,
    stop: () => stopComposedServer({ server, io }),
  };
}

function listenOnPort(server, port, host = HOST) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };

    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server.address().port);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function startServer(options = {}) {
  const {
    compose = composeServer,
    host = HOST,
    portCandidates = PORT_CANDIDATES,
  } = options;

  for (const port of portCandidates) {
    const runtime = compose(options);

    try {
      const address = await listenOnPort(runtime.server, port, host);

      return {
        ...runtime,
        port: address,
      };
    } catch (error) {
      await runtime.stop().catch(() => {});

      if (!isAddressInUseError(error)) {
        throw error;
      }
    }
  }

  throw new Error(`Unable to bind to any fixed port: ${portCandidates.join(', ')}`);
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server || !server.listening) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function stopComposedServer(runtime) {
  await closeSocketServer(runtime.io);
  await closeServer(runtime.server);
}

function isAddressInUseError(error) {
  return Boolean(error && (error.code === 'EADDRINUSE' || error.code === 'EACCES'));
}

async function main() {
  const started = await startServer();
  console.log(`Listening on http://${HOST}:${started.port}`);

  const shutdown = async (signal) => {
    try {
      await started.stop();
      console.log(`Stopped on ${signal}`);
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  BOOTSTRAP_MESSAGE,
  PORT_CANDIDATES,
  closeServer,
  composeServer,
  createRequestListener,
  createServer,
  listenOnPort,
  startServer,
  stopComposedServer,
};
