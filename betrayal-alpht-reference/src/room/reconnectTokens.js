const crypto = require('node:crypto');

const DEFAULT_TTL_MS = 5 * 60 * 1000;

function createReconnectTokenStore(options = {}) {
  const {
    now = () => Date.now(),
    tokenFactory = () => crypto.randomBytes(32).toString('hex'),
    ttlMs = DEFAULT_TTL_MS,
  } = options;
  const entries = new Map();
  let persistent = false;

  function issue(data) {
    const token = tokenFactory();
    entries.set(token, {
      data: { ...data },
      expiresAt: now() + ttlMs,
    });
    return token;
  }

  function resolve(token) {
    if (!token || !entries.has(token)) {
      return null;
    }

    const entry = entries.get(token);
    if (!persistent && now() >= entry.expiresAt) {
      entries.delete(token);
      return null;
    }

    return { ...entry.data };
  }

  function revoke(token) {
    entries.delete(token);
  }

  function setPersistent(value) {
    persistent = Boolean(value);
  }

  function publicState() {
    return {
      activeCount: entries.size,
      persistent,
    };
  }

  return {
    issue,
    publicState,
    resolve,
    revoke,
    setPersistent,
  };
}

module.exports = {
  DEFAULT_TTL_MS,
  createReconnectTokenStore,
};
