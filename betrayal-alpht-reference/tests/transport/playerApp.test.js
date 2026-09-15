const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const PLAYER_APP_PATH = path.join(__dirname, '../../public/player/app.js');

function loadPlayerApp() {
  const listeners = {};
  const elements = {
    '[data-actions]': {
      textContent: '',
      innerHTML: '',
      addEventListener(event, handler) {
        listeners[event] = handler;
      },
    },
    '[data-location]': { textContent: '' },
    '[data-movement]': { textContent: '' },
    '[data-cards]': { textContent: '', innerHTML: '' },
    '[data-interaction]': { textContent: '', innerHTML: '' },
    '[data-combat]': { textContent: '', innerHTML: '' },
    '[data-haunt]': { textContent: '', innerHTML: '' },
    '[data-state]': { textContent: '' },
    '[data-status]': { textContent: '', dataset: {} },
    '[data-turn-summary]': { textContent: '' },
    '[data-current-action]': { textContent: '', innerHTML: '' },
    '[data-current-action-card]': { textContent: '', innerHTML: '' },
    '[data-character]': { textContent: '', innerHTML: '' },
    '[data-map]': { textContent: '', innerHTML: '' },
    '[data-join-room]': { textContent: '加入房間', dataset: {}, addEventListener(event, handler) { listeners[`join-${event}`] = handler; } },
    '[data-reconnect-token]': { value: 'player-token' },
    '[data-reconnect-room]': { textContent: '使用重連資訊', dataset: {}, addEventListener(event, handler) { listeners[`reconnect-${event}`] = handler; } },
    '[data-connection-badge]': { textContent: '', dataset: {} },
    '[data-player-identity]': { textContent: '' },
    '[data-player-revision]': { textContent: '' },
  };
  const handlers = {};
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

  vm.runInNewContext(fs.readFileSync(PLAYER_APP_PATH, 'utf8'), {
    document: {
      body: { dataset: { role: 'player' } },
      querySelector(selector) {
        return elements[selector];
      },
    },
    io() {
      return socket;
    },
  });

  return { elements, emitted, handlers, listeners };
}

test('Player UI exposes visible join and reconnect actions', () => {
  const { listeners, emitted } = loadPlayerApp();

  listeners['join-click']({ target: {} });
  listeners['reconnect-click']({ target: {} });

  assert.deepEqual(JSON.parse(JSON.stringify(emitted.slice(0, 2))), [
    ['message', { type: 'room:join', requestId: 'join-room', payload: {} }],
    ['message', { type: 'room:reconnect', requestId: 'reconnect-room', payload: { token: 'player-token' } }],
  ]);
});

test('Player UI keeps room controls outside the live action card', () => {
  const { elements, handlers } = loadPlayerApp();

  handlers.message({
    type: 'game:state:private',
    payload: {
      turn: { phase: 'EXPLORATION', activePlayerNumber: 1, movementRemaining: 3 },
      private: {
        playerNumber: 1,
        movement: { reachableMoves: [], explorationPlacements: [] },
        legalActions: [],
      },
    },
  });

  assert.notEqual(elements['[data-current-action-card]'].innerHTML, '');
  assert.equal(elements['[data-current-action]'].innerHTML, '');
});

test('Player UI renders identity and revision from its private snapshot', () => {
  const { elements, handlers } = loadPlayerApp();

  handlers.message({
    type: 'game:state:private',
    payload: {
      revision: 12,
      players: [{ playerNumber: 2, characterId: 'brandon-jasperson' }],
      private: {
        playerNumber: 2,
        legalActions: [],
        movement: { location: 'entrance', reachableMoves: [] },
      },
    },
  });

  assert.equal(elements['[data-player-identity]'].textContent, '玩家 2 · brandon-jasperson');
  assert.equal(elements['[data-player-revision]'].textContent, 'REV 12');
});

test('Player UI keeps the game view and explains rejected commands', () => {
  const { elements, handlers } = loadPlayerApp();

  handlers.message({
    type: 'error:rejected',
    payload: { code: 'stale-revision', message: '遊戲狀態已更新，請重新查看。' },
  });

  assert.equal(elements['[data-status]'].textContent, '遊戲狀態已更新，請重新查看。（stale-revision）');
  assert.equal(elements['[data-status]'].dataset.statusKind, 'error');
});

test('Player UI re-enables a rejected game action for a legal retry', () => {
  const { elements, handlers, listeners } = loadPlayerApp();
  const target = {
    textContent: '結束回合',
    dataset: { command: 'turn:pass' },
    disabled: false,
  };

  listeners.click({ target });
  assert.equal(target.disabled, true);
  handlers.message({
    type: 'error:rejected',
    payload: { code: 'stale-revision', message: '遊戲狀態已更新，請重新查看。' },
  });

  assert.equal(target.disabled, false);
  assert.equal(target.textContent, '結束回合');
  assert.equal(elements['[data-status]'].dataset.statusKind, 'error');
});

test('Player UI exposes an intent-only end-turn action for the active player', () => {
  const { elements, handlers, emitted, listeners } = loadPlayerApp();

  handlers.message({
    type: 'game:state:private',
    payload: {
      revision: 5,
      turn: { phase: 'EXPLORATION', activePlayerNumber: 1, pendingInteraction: null },
      private: {
        playerNumber: 1,
        legalActions: [],
        movement: { reachableMoves: [], canConfirm: false, canRegret: false, explorationPlacements: [] },
      },
    },
  });

  assert.match(elements['[data-actions]'].innerHTML, /data-command="turn:pass"/);
  listeners.click({ target: { dataset: { command: 'turn:pass' } } });
  assert.deepEqual(JSON.parse(JSON.stringify(emitted.at(-1))), ['message', {
    type: 'game:command',
    requestId: 'turn-pass',
    payload: { type: 'turn:pass', baseRevision: 5, payload: {} },
  }]);
});

test('Player UI renders its location and movement actions from private snapshot', () => {
  const { elements, emitted, handlers, listeners } = loadPlayerApp();

  handlers.message({
    type: 'game:state:private',
    payload: {
      revision: 4,
      private: {
        playerNumber: 1,
        movement: {
          location: 'entrance',
          reachableMoves: [{ tileId: 'hallway', cost: 1, stopReason: null }],
          canConfirm: true,
          canRegret: true,
          explorationPlacements: [{ position: { x: 0, y: -1 }, rotation: 0 }],
        },
      },
    },
  });

  assert.equal(elements['[data-location]'].textContent, '目前位置：entrance');
  assert.match(elements['[data-movement]'].textContent, /hallway/);
  assert.match(elements['[data-actions]'].innerHTML, /確認移動/);
  assert.match(elements['[data-actions]'].innerHTML, /退回起點/);
  assert.match(elements['[data-actions]'].innerHTML, /探索/);

  listeners.click({ target: { dataset: { command: 'move:step', tileId: 'hallway' } } });
  assert.deepEqual(JSON.parse(JSON.stringify(emitted[0])), ['message', {
    type: 'game:command',
    requestId: 'move-step-hallway',
    payload: {
      type: 'move:step',
      baseRevision: 4,
      payload: { tileId: 'hallway' },
    },
  }]);
  listeners.click({ target: {
    dataset: { command: 'move:explore', x: '0', y: '-1', rotation: '0' },
  } });
  assert.deepEqual(JSON.parse(JSON.stringify(emitted[1])), ['message', {
    type: 'game:command',
    requestId: 'move-explore-0--1-0',
    payload: {
      type: 'move:explore',
      baseRevision: 4,
      payload: { position: { x: 0, y: -1 }, rotation: 0 },
    },
  }]);
});

test('Player UI renders private cards and combat controls, then sends intent-only commands', () => {
  const { elements, emitted, handlers, listeners } = loadPlayerApp();

  handlers.message({
    type: 'game:state:private',
    payload: {
      revision: 8,
      turn: { pendingInteraction: { type: 'haunt-roll' } },
      combat: {
        latestResult: {
          attackerPlayerNumber: 1,
          targetPlayerNumber: 2,
          attackerTotal: 7,
          defenderTotal: 4,
          damage: 3,
        },
      },
      private: {
        data: {
          cards: [{
            id: 'item-secret-weapon',
            type: 'item',
            name: '祕密武器',
            description: '只有持有人能讀取的效果文字',
          }],
        },
        legalActions: [
          { type: 'game:draw-card', cardType: 'omen' },
          { type: 'game:resolve-haunt-roll' },
          { type: 'game:combat:select-target', targetPlayerNumber: 2 },
          { type: 'game:combat:resolve' },
        ],
        movement: {
          location: 'gallery',
          reachableMoves: [],
          canConfirm: false,
          canRegret: false,
          explorationPlacements: [],
        },
      },
    },
  });

  assert.match(elements['[data-cards]'].innerHTML, /祕密武器/);
  assert.match(elements['[data-cards]'].innerHTML, /只有持有人能讀取的效果文字/);
  assert.equal(
    elements['[data-interaction]'].textContent,
    '待處理互動：請進行作祟檢定（Haunt Roll）。',
  );
  assert.match(elements['[data-combat]'].textContent, /玩家 1/);
  assert.match(elements['[data-combat]'].textContent, /傷害 3/);
  assert.match(elements['[data-actions]'].innerHTML, /抽取預兆牌/);
  assert.match(elements['[data-actions]'].innerHTML, />進行作祟檢定<\/button>/);
  assert.match(elements['[data-actions]'].innerHTML, /選擇玩家 2/);
  assert.match(elements['[data-actions]'].innerHTML, /結算戰鬥/);

  listeners.click({ target: { dataset: { command: 'game:draw-card' } } });
  listeners.click({ target: { dataset: { command: 'game:resolve-haunt-roll' } } });
  listeners.click({ target: {
    dataset: { command: 'game:combat:select-target', targetPlayerNumber: '2' },
  } });
  listeners.click({ target: { dataset: { command: 'game:combat:resolve' } } });

  assert.deepEqual(JSON.parse(JSON.stringify(emitted.slice(0, 4))), [
    ['message', {
      type: 'game:command',
      requestId: 'draw-card',
      payload: { type: 'game:draw-card', baseRevision: 8, payload: {} },
    }],
    ['message', {
      type: 'game:command',
      requestId: 'resolve-haunt-roll',
      payload: { type: 'game:resolve-haunt-roll', baseRevision: 8, payload: {} },
    }],
    ['message', {
      type: 'game:command',
      requestId: 'combat-select-target-2',
      payload: {
        type: 'game:combat:select-target',
        baseRevision: 8,
        payload: { targetPlayerNumber: 2 },
      },
    }],
    ['message', {
      type: 'game:command',
      requestId: 'combat-resolve',
      payload: { type: 'game:combat:resolve', baseRevision: 8, payload: {} },
    }],
  ]);
  assert.equal(JSON.stringify(emitted).includes('item-secret-weapon'), false);
  assert.equal(JSON.stringify(emitted).includes('只有持有人能讀取的效果文字'), false);
});

test('Player UI shows a non-actionable Haunt waiting message without the private legal action', () => {
  const { elements, handlers } = loadPlayerApp();

  handlers.message({
    type: 'game:state:private',
    payload: {
      revision: 8,
      turn: { pendingInteraction: { type: 'haunt-roll' } },
      private: {
        legalActions: [],
        movement: {
          reachableMoves: [],
          canConfirm: false,
          canRegret: false,
          explorationPlacements: [],
        },
      },
    },
  });

  assert.equal(
    elements['[data-interaction]'].textContent,
    '其他玩家正在進行作祟檢定（Haunt Roll），請稍候。',
  );
  assert.equal(
    elements['[data-actions]'].innerHTML.includes('data-command="game:resolve-haunt-roll"'),
    false,
  );
});

test('Player UI shows a reconnect wait message while the game is paused for a disconnect', () => {
  const { elements, handlers } = loadPlayerApp();
  handlers.message({
    type: 'game:state:private',
    payload: {
      pause: { active: true, reason: 'player-disconnected' },
      private: { legalActions: [], movement: { reachableMoves: [], canConfirm: false, canRegret: false, explorationPlacements: [] } },
    },
  });
  assert.equal(elements['[data-interaction]'].textContent, '遊戲已暫停，正在等待玩家重連。');
});

test('Player UI shows traitor and survivor haunt actions without client-side results', () => {
  const { elements, emitted, handlers, listeners } = loadPlayerApp();
  handlers.message({
    type: 'game:state:private',
    payload: {
      revision: 9,
      haunt: { triggered: true, mummy: { tileId: 'hallway' }, outcome: null },
      private: {
        haunt: { role: 'traitor', objective: 'mummy-custody' },
        legalActions: [
          { type: 'haunt:mummy:move', tileId: 'entrance' },
          { type: 'haunt:mummy:attack', targetPlayerNumber: 2 },
        ],
        movement: { reachableMoves: [], canConfirm: false, canRegret: false, explorationPlacements: [] },
      },
    },
  });

  assert.match(elements['[data-haunt]'].textContent, /作祟者/);
  assert.match(elements['[data-haunt]'].textContent, /mummy-custody/);
  assert.match(elements['[data-actions]'].innerHTML, /木乃伊移動到 entrance/);
  assert.match(elements['[data-actions]'].innerHTML, /木乃伊攻擊玩家 2/);
  listeners.click({ target: { dataset: { command: 'haunt:mummy:attack', targetPlayerNumber: '2' } } });
  assert.deepEqual(JSON.parse(JSON.stringify(emitted[0])), ['message', {
    type: 'game:command',
    requestId: 'mummy-attack-2',
    payload: {
      type: 'haunt:mummy:attack',
      baseRevision: 9,
      payload: { targetPlayerNumber: 2 },
    },
  }]);
  assert.equal(JSON.stringify(emitted).includes('damage'), false);
});

test('Player UI makes the current turn and character identity prominent', () => {
  const { elements, handlers } = loadPlayerApp();

  handlers.message({
    type: 'game:state:private',
    payload: {
      revision: 3,
      turn: { phase: 'EXPLORATION', activePlayerNumber: 1, movementRemaining: 2 },
      players: [{ playerNumber: 1, characterId: 'professor-longfellow' }],
      private: {
        playerNumber: 1,
        movement: { location: 'entrance', reachableMoves: [], canConfirm: false, canRegret: false, explorationPlacements: [] },
        legalActions: [],
      },
    },
  });

  assert.match(elements['[data-turn-summary]'].textContent, /你的回合/);
  assert.match(elements['[data-turn-summary]'].textContent, /探索階段/);
  assert.match(elements['[data-character]'].textContent, /professor-longfellow/);
});

test('Player UI renders the public room-card map without private fields', () => {
  const { elements, handlers } = loadPlayerApp();

  handlers.message({
    type: 'game:state:private',
    payload: {
      players: [{ playerNumber: 1, location: 'entrance' }],
      map: {
        tiles: [{ id: 'entrance', floor: 'ground', position: { x: 0, y: 0 } }],
        connections: [],
      },
      private: {
        playerNumber: 1,
        movement: { location: 'entrance', reachableMoves: [], canConfirm: false, canRegret: false, explorationPlacements: [] },
        legalActions: [],
        data: { cards: [{ id: 'secret-card', description: '不可出現在地圖的私人資料' }] },
      },
    },
  });

  assert.match(elements['[data-map]'].innerHTML, /entrance/);
  assert.match(elements['[data-map]'].innerHTML, /玩家 1/);
  assert.equal(elements['[data-map]'].innerHTML.includes('secret-card'), false);
  assert.equal(elements['[data-map]'].innerHTML.includes('不可出現在地圖的私人資料'), false);
});

test('Player UI hides state-changing actions while paused or ended and shows the reason', () => {
  const { elements, handlers } = loadPlayerApp();

  handlers.message({
    type: 'game:state:private',
    payload: {
      turn: { phase: 'PAUSED', activePlayerNumber: 1 },
      pause: { active: true, reason: 'player-disconnected' },
      private: {
        playerNumber: 1,
        legalActions: [{ type: 'haunt:survivor:escape' }],
        movement: { reachableMoves: [{ tileId: 'hallway' }], canConfirm: true, canRegret: true, explorationPlacements: [] },
      },
    },
  });

  assert.equal(elements['[data-actions]'].innerHTML, '');
  assert.match(elements['[data-turn-summary]'].textContent, /遊戲已暫停/);

  handlers.message({
    type: 'game:state:private',
    payload: {
      turn: { phase: 'ENDED' },
      haunt: { outcome: { winner: 'survivors', reason: 'all-survivors-escape' } },
      private: { playerNumber: 1, legalActions: [{ type: 'haunt:survivor:escape' }], movement: {} },
    },
  });

  assert.equal(elements['[data-actions]'].innerHTML, '');
  assert.match(elements['[data-turn-summary]'].textContent, /遊戲已結束/);
});

test('Player UI explains the exploration decision before showing movement controls', () => {
  const { elements, handlers } = loadPlayerApp();
  handlers.message({
    type: 'game:state:private',
    payload: {
      players: [{ playerNumber: 1, characterId: 'professor-longfellow', location: 'entrance' }],
      turn: {
        phase: 'EXPLORATION',
        activePlayerNumber: 1,
        movementRemaining: 3,
        pendingInteraction: null,
      },
      private: {
        playerNumber: 1,
        movement: {
          location: 'entrance',
          reachableMoves: [{ tileId: 'hallway', cost: 1 }],
          explorationPlacements: [],
        },
        legalActions: [],
      },
    },
  });

  assert.match(elements['[data-current-action-card]'].innerHTML, /data-action-step="movement"/);
  assert.match(elements['[data-current-action-card]'].innerHTML, /探索你的回合/);
  assert.match(elements['[data-current-action-card]'].innerHTML, /還有 3 點移動力/);
});

test('Player UI explains card draws and haunt rolls as interruption steps', () => {
  const { elements, handlers } = loadPlayerApp();
  handlers.message({
    type: 'game:state:private',
    payload: {
      turn: { phase: 'EXPLORATION', activePlayerNumber: 1, pendingInteraction: { type: 'haunt-roll' } },
      private: {
        playerNumber: 1,
        movement: {},
        legalActions: [{ type: 'game:draw-card', cardType: 'omen' }, { type: 'game:resolve-haunt-roll' }],
      },
    },
  });

  assert.match(elements['[data-current-action-card]'].innerHTML, /data-action-step="haunt-roll"/);
  assert.match(elements['[data-current-action-card]'].innerHTML, /先完成預兆牌效果/);
  assert.match(elements['[data-current-action-card]'].innerHTML, /作祟檢定/);
});

test('Player UI explains combat target selection and outcome ownership', () => {
  const { elements, handlers } = loadPlayerApp();
  handlers.message({
    type: 'game:state:private',
    payload: {
      turn: { phase: 'COMBAT', activePlayerNumber: 1, pendingInteraction: { type: 'combat-target', targetPlayerNumber: 2 } },
      private: {
        playerNumber: 1,
        movement: {},
        legalActions: [{ type: 'game:combat:resolve' }],
      },
      combat: { latestResult: null },
    },
  });

  assert.match(elements['[data-current-action-card]'].innerHTML, /data-action-step="combat"/);
  assert.match(elements['[data-current-action-card]'].innerHTML, /伺服器結算/);
  assert.match(elements['[data-current-action-card]'].innerHTML, /玩家 2/);
});

test('Player UI explains haunt role objectives and final outcome', () => {
  const { elements, handlers } = loadPlayerApp();
  handlers.message({
    type: 'game:state:private',
    payload: {
      turn: { phase: 'ENDED', activePlayerNumber: 1 },
      players: [{ playerNumber: 1, characterId: 'professor-longfellow', location: 'entrance' }],
      haunt: {
        triggered: true,
        mummy: { tileId: 'hallway' },
        outcome: { winner: 'survivors', reason: 'all-survivors-escape' },
      },
      private: {
        playerNumber: 1,
        movement: {},
        legalActions: [],
        haunt: { role: 'survivor', objective: '逃離山莊' },
      },
    },
  });

  assert.match(elements['[data-current-action-card]'].innerHTML, /data-action-step="ended"/);
  assert.match(elements['[data-current-action-card]'].innerHTML, /倖存者勝利/);
  assert.match(elements['[data-current-action-card]'].innerHTML, /逃離山莊/);
  assert.equal(elements['[data-actions]'].innerHTML, '');
});
