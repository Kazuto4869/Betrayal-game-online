const assert = require('node:assert/strict');
const test = require('node:test');

const { createPlayerJoinUrl } = require('../../src/network/qrJoinUrl');

test('createPlayerJoinUrl uses the detected LAN IPv4 and bound port', () => {
  assert.equal(
    createPlayerJoinUrl({ address: '192.168.1.42', port: 3002 }),
    'http://192.168.1.42:3002/player',
  );
});

test('createPlayerJoinUrl preserves a configured player path', () => {
  assert.equal(
    createPlayerJoinUrl({ address: '10.0.0.8', port: 3000, path: '/player/' }),
    'http://10.0.0.8:3000/player/',
  );
});

test('createPlayerJoinUrl rejects localhost and loopback addresses', () => {
  assert.throws(
    () => createPlayerJoinUrl({ address: 'localhost', port: 3000 }),
    /LAN IPv4/,
  );
  assert.throws(
    () => createPlayerJoinUrl({ address: '127.0.0.1', port: 3000 }),
    /LAN IPv4/,
  );
});

test('createPlayerJoinUrl rejects invalid ports and addresses', () => {
  assert.throws(
    () => createPlayerJoinUrl({ address: '192.168.1.42', port: 0 }),
    /port/,
  );
  assert.throws(
    () => createPlayerJoinUrl({ address: 'fe80::1', port: 3000 }),
    /LAN IPv4/,
  );
});
