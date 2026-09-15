const net = require('node:net');

const DEFAULT_PLAYER_PATH = '/player';

function createPlayerJoinUrl({ address, port, path = DEFAULT_PLAYER_PATH }) {
  if (!net.isIPv4(address) || isLoopbackIPv4(address)) {
    throw new TypeError('QR join URL requires a LAN IPv4 address.');
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError('QR join URL requires a valid port.');
  }

  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new TypeError('QR join URL requires an absolute player path.');
  }

  return `http://${address}:${port}${path}`;
}

function isLoopbackIPv4(address) {
  return address.split('.')[0] === '127';
}

module.exports = {
  DEFAULT_PLAYER_PATH,
  createPlayerJoinUrl,
};
