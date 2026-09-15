const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createServer, closeServer } = require('../../server');

function request(pathname, port) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method: 'GET',
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        contentType: response.headers['content-type'],
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });

    request.once('error', reject);
    request.end();
  });
}

test('serves the shared tabletop stylesheet to both browser pages', async () => {
  const server = createServer();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const response = await request('/styles/game-ui.css', port);

    assert.equal(response.statusCode, 200);
    assert.match(response.contentType, /^text\/css/);
    assert.match(response.body, /--haunted-purple/);
  } finally {
    await closeServer(server);
  }
});
