const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PORT_CANDIDATES,
  findLanIPv4,
} = require('../../src/network/lanAddress');

test('findLanIPv4 selects the first non-internal IPv4 interface', () => {
  const networkInterfaces = {
    loopback: [
      { address: '127.0.0.1', family: 'IPv4', internal: true },
    ],
    ethernet: [
      { address: 'fe80::1', family: 'IPv6', internal: false },
      { address: '192.168.1.42', family: 'IPv4', internal: false },
    ],
    wifi: [
      { address: '192.168.1.43', family: 'IPv4', internal: false },
    ],
  };

  assert.equal(findLanIPv4(networkInterfaces), '192.168.1.42');
});

test('findLanIPv4 returns null when no non-internal IPv4 exists', () => {
  const networkInterfaces = {
    loopback: [
      { address: '127.0.0.1', family: 'IPv4', internal: true },
    ],
    ipv6: [
      { address: 'fe80::1', family: 'IPv6', internal: false },
    ],
  };

  assert.equal(findLanIPv4(networkInterfaces), null);
});

test('PORT_CANDIDATES contains only the fixed LAN ports in order', () => {
  assert.deepEqual(PORT_CANDIDATES, [3000, 3001, 3002, 3003]);
});
