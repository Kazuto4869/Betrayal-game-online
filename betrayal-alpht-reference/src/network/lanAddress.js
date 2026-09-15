const os = require('node:os');
const net = require('node:net');

const PORT_CANDIDATES = Object.freeze([3000, 3001, 3002, 3003]);

function findLanIPv4(networkInterfaces = os.networkInterfaces()) {
  for (const addresses of Object.values(networkInterfaces || {})) {
    for (const entry of addresses || []) {
      const family = entry && entry.family;
      const isIPv4 = family === 'IPv4' || family === 4;

      if (isIPv4 && entry.internal !== true && net.isIPv4(entry.address) && !isLoopbackIPv4(entry.address)) {
        return entry.address;
      }
    }
  }

  return null;
}

function isLoopbackIPv4(address) {
  return address.split('.')[0] === '127';
}

module.exports = {
  PORT_CANDIDATES,
  findLanIPv4,
};
