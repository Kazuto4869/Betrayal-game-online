const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const HOST_APP_PATH = path.join(__dirname, '../../public/host/app.js');

function loadHostApp() {
  const elements = {
    '[data-join-url]': { textContent: '' },
    '[data-map]': { textContent: '', innerHTML: '' },
    '[data-decks]': { textContent: '' },
    '[data-pending]': { textContent: '' },
    '[data-combat]': { textContent: '' },
    '[data-haunt]': { textContent: '' },
    '[data-host-current-action]': { textContent: '', innerHTML: '' },
    '[data-host-actions]': { textContent: '', innerHTML: '', addEventListener(event, handler) { listeners[event] = handler; } },
    '[data-public-log]': { textContent: '' },
    '[data-state]': { textContent: '' },
    '[data-status]': { textContent: '', dataset: {} },
    '[data-room-target-count]': { value: '3' },
    '[data-create-room]': { textContent: '建立房間', dataset: {}, addEventListener(event, handler) { listeners[`create-${event}`] = handler; } },
    '[data-room-code]': { textContent: '' },
    '[data-room-status]': { textContent: '', dataset: {} },
    '[data-room-progress]': { textContent: '' },
    '[data-lobby-status]': { textContent: '' },
    '[data-seats]': { textContent: '', innerHTML: '' },
    '[data-copy-join]': { disabled: true, addEventListener() {} },
  };
  const handlers = {};
  const listeners = {};
  const emitted = [];
  const socket = {
    nsp: '/',
    on(event, handler) {
      handlers[event] = handler;
    },
    emit(...args) {
      emitted.push(args);
    },
  };

  vm.runInNewContext(fs.readFileSync(HOST_APP_PATH, 'utf8'), {
    document: {
      body: { dataset: { role: 'host' } },
      querySelector(selector) {
        return elements[selector];
      },
    },
    io() {
      return socket;
    },
  });

  return { elements, handlers, listeners, emitted };
}

test('Host UI exposes a visible create-room action and sends the selected player count', () => {
  const { elements, listeners, emitted } = loadHostApp();

  listeners['create-click']({ target: elements['[data-create-room]'] });

  assert.deepEqual(JSON.parse(JSON.stringify(emitted[0])), ['message', {
    type: 'room:create',
    requestId: 'create-room',
    payload: { targetPlayerCount: 3 },
  }]);
});

test('Host UI 以 zh-TW 顯示公開 lobby state 的 joinUrl', () => {
  const { elements, handlers } = loadHostApp();

  handlers.message({
    type: 'room:state',
    payload: { joinUrl: 'http://192.168.50.24:3002/player' },
  });

  assert.equal(
    elements['[data-join-url]'].textContent,
    '玩家加入網址：http://192.168.50.24:3002/player',
  );
});

test('Host UI renders room code, progress, and connected lobby seats from room state', () => {
  const { elements, handlers } = loadHostApp();

  handlers.message({
    type: 'room:state',
    payload: {
      roomCode: 'LAN',
      targetPlayerCount: 3,
      started: false,
      joinUrl: 'http://192.168.50.24:3002/player',
      players: [
        { seat: 1, playerNumber: 1, characterId: 'professor-longfellow', connected: true },
        { seat: 2, playerNumber: 2, characterId: 'brandon-jasperson', connected: false },
      ],
    },
  });

  assert.equal(elements['[data-room-code]'].textContent, 'LAN');
  assert.equal(elements['[data-room-progress]'].textContent, '1 / 3 位玩家已連線');
  assert.match(elements['[data-seats]'].innerHTML, /玩家 1/);
  assert.match(elements['[data-seats]'].innerHTML, /可重連/);
  assert.match(elements['[data-seats]'].innerHTML, /等待加入/);
});

test('Host UI preserves the current lobby and explains rejected commands', () => {
  const { elements, handlers } = loadHostApp();

  handlers.message({
    type: 'error:rejected',
    payload: { code: 'room-already-created', message: '房間已建立。' },
  });

  assert.equal(elements['[data-status]'].textContent, '房間已建立。（room-already-created）');
  assert.equal(elements['[data-status]'].dataset.statusKind, 'error');
});

test('Host UI renders the public explored map from a game snapshot', () => {
  const { elements, handlers } = loadHostApp();

  handlers.message({
    type: 'game:state:public',
    payload: {
      map: {
        tiles: [{ id: 'entrance', floor: 'ground', position: { x: 0, y: 0 } }],
        connections: [],
      },
      players: [{ playerNumber: 1, location: 'entrance' }],
    },
  });

  assert.match(elements['[data-map]'].innerHTML, /entrance/);
  assert.match(elements['[data-map]'].innerHTML, /玩家 1/);
});

test('Host UI renders public deck, interaction, combat, and latest public event summaries', () => {
  const { elements, handlers } = loadHostApp();

  handlers.message({
    type: 'game:state:public',
    payload: {
      decks: {
        room: { remaining: 3 },
        event: { draw: 2, discard: 1 },
        item: { draw: 1, discard: 0 },
        omen: { draw: 1, discard: 2 },
      },
      turn: { pendingInteraction: { type: 'combat-target', targetPlayerNumber: 2 } },
      combat: {
        latestResult: {
          attackerPlayerNumber: 1,
          targetPlayerNumber: 2,
          attackerTotal: 7,
          defenderTotal: 4,
          damage: 3,
        },
      },
      latestPublicLog: {
        type: 'card-drawn',
        summary: '玩家 1 抽到預兆牌〈符文石〉。',
      },
      map: { tiles: [], connections: [] },
      players: [],
    },
  });

  assert.match(elements['[data-decks]'].textContent, /房間牌堆：3/);
  assert.match(elements['[data-decks]'].textContent, /事件牌：抽牌 2、棄牌 1/);
  assert.match(elements['[data-pending]'].textContent, /選擇玩家 2/);
  assert.match(elements['[data-combat]'].textContent, /玩家 1/);
  assert.match(elements['[data-combat]'].textContent, /傷害 3/);
  assert.equal(elements['[data-public-log]'].textContent, '玩家 1 抽到預兆牌〈符文石〉。');
});

test('Host UI renders public mummy state and outcome without private objectives', () => {
  const { elements, handlers } = loadHostApp();
  handlers.message({
    type: 'game:state:public',
    payload: {
      haunt: {
        triggered: true,
        scenarioId: 'the-mummy-walks',
        mummy: { tileId: 'hallway', movementRemaining: 1 },
        outcome: { winner: 'survivors', reason: 'all-survivors-escape' },
      },
      map: { tiles: [], connections: [] },
      players: [],
    },
  });

  assert.match(elements['[data-haunt]'].textContent, /hallway/);
  assert.match(elements['[data-haunt]'].textContent, /survivors/);
  assert.equal(elements['[data-haunt]'].textContent.includes('objective'), false);
});

test('Host UI renders pause controls and sends confirmed restart intent', () => {
  const { elements, handlers, listeners, emitted } = loadHostApp();
  handlers.message({
    type: 'game:state:public',
    payload: {
      revision: 4,
      pause: { active: true, reason: 'host', disconnectedPlayerNumbers: [] },
      hostControls: { canPause: false, canResume: true, canRestart: true },
      map: { tiles: [], connections: [] },
      players: [],
    },
  });

  assert.match(elements['[data-host-actions]'].innerHTML, /恢復遊戲/);
  assert.match(elements['[data-host-actions]'].innerHTML, /確認重新開始/);
  listeners.click({ target: { dataset: { command: 'host:restart' } } });
  assert.deepEqual(JSON.parse(JSON.stringify(emitted[0])), ['message', {
    type: 'game:command',
    requestId: 'host-restart',
    payload: {
      type: 'host:restart',
      baseRevision: 4,
      payload: { confirm: true },
    },
  }]);
});

test('Host UI explains whose exploration turn is active from public state', () => {
  const { elements, handlers } = loadHostApp();

  handlers.message({
    type: 'game:state:public',
    payload: {
      turn: { phase: 'EXPLORATION', activePlayerNumber: 2, movementRemaining: 3 },
      players: [{ playerNumber: 2, location: 'hallway' }],
      map: { tiles: [], connections: [] },
    },
  });

  assert.match(elements['[data-host-current-action]'].innerHTML, /data-host-step="turn"/);
  assert.match(elements['[data-host-current-action]'].innerHTML, /探索階段/);
  assert.match(elements['[data-host-current-action]'].innerHTML, /玩家 2/);
  assert.match(elements['[data-host-current-action]'].innerHTML, /3 點移動力/);
});

test('Host UI elevates a public pending haunt roll as the next table action', () => {
  const { elements, handlers } = loadHostApp();

  handlers.message({
    type: 'game:state:public',
    payload: {
      turn: {
        phase: 'EXPLORATION',
        activePlayerNumber: 1,
        pendingInteraction: { type: 'haunt-roll', playerNumber: 1 },
      },
      players: [],
      map: { tiles: [], connections: [] },
    },
  });

  assert.match(elements['[data-host-current-action]'].innerHTML, /data-host-step="attention"/);
  assert.match(elements['[data-host-current-action]'].innerHTML, /等待玩家 1 完成作祟檢定/);
});

test('Host UI explains pause and final outcome without private information', () => {
  const { elements, handlers } = loadHostApp();

  handlers.message({
    type: 'game:state:public',
    payload: {
      turn: { phase: 'ENDED' },
      pause: { active: false },
      haunt: { outcome: { winner: 'survivors', reason: 'all-survivors-escape' } },
      players: [],
      map: { tiles: [], connections: [] },
    },
  });

  assert.match(elements['[data-host-current-action]'].innerHTML, /data-host-step="ended"/);
  assert.match(elements['[data-host-current-action]'].innerHTML, /倖存者勝利/);
  assert.equal(elements['[data-host-current-action]'].innerHTML.includes('objective'), false);
});
