const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createPublicLogEntry,
  setLatestPublicLog,
  appendPublicLog,
} = require('../../src/game/publicLog');

test('createPublicLogEntry keeps only public three-line summary', () => {
  const entry = createPublicLogEntry({
    type: 'event-resolved',
    summary: '第一行\n第二行\n第三行\n第四行',
    private: 'do-not-publish',
  });

  assert.deepEqual(entry, {
    type: 'event-resolved',
    summary: '第一行\n第二行\n第三行',
  });
  assert.equal(JSON.stringify(entry).includes('do-not-publish'), false);
});

test('setLatestPublicLog and appendPublicLog retain only the newest entry', () => {
  const first = createPublicLogEntry({ type: 'first', summary: '第一則' });
  const second = createPublicLogEntry({ type: 'second', summary: '第二則' });
  const state = { latestPublicLog: null };

  const afterFirst = setLatestPublicLog(state, first);
  const afterSecond = appendPublicLog(afterFirst, second);

  assert.deepEqual(state, { latestPublicLog: null });
  assert.deepEqual(afterFirst.latestPublicLog, first);
  assert.deepEqual(afterSecond.latestPublicLog, second);
});
