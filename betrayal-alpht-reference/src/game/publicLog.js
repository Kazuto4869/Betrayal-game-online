const { cloneGameState } = require('./gameState');

function createPublicLogEntry({ type, summary } = {}) {
  const lines = String(summary || '').split('\n').slice(0, 3);
  return {
    type: String(type || 'system'),
    summary: lines.join('\n'),
  };
}

function setLatestPublicLog(state, entry) {
  const next = cloneGameState(state);
  next.latestPublicLog = createPublicLogEntry(entry);
  return next;
}

function appendPublicLog(state, entry) {
  return setLatestPublicLog(state, entry);
}

module.exports = {
  appendPublicLog,
  createPublicLogEntry,
  setLatestPublicLog,
};
