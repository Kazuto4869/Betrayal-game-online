(function bootstrapPlayerPage() {
  const status = document.querySelector('[data-status]');
  const state = document.querySelector('[data-state]');
  const location = document.querySelector('[data-location]');
  const movement = document.querySelector('[data-movement]');
  const cards = document.querySelector('[data-cards]');
  const interaction = document.querySelector('[data-interaction]');
  const combat = document.querySelector('[data-combat]');
  const haunt = document.querySelector('[data-haunt]');
  const actions = document.querySelector('[data-actions]');
  const turnSummary = document.querySelector('[data-turn-summary]');
  const currentAction = document.querySelector('[data-current-action-card]');
  const character = document.querySelector('[data-character]');
  const map = document.querySelector('[data-map]');
  const joinRoomButton = document.querySelector('[data-join-room]');
  const reconnectRoomButton = document.querySelector('[data-reconnect-room]');
  const reconnectToken = document.querySelector('[data-reconnect-token]');
  const connectionBadge = document.querySelector('[data-connection-badge]');
  const playerIdentity = document.querySelector('[data-player-identity]');
  const playerRevision = document.querySelector('[data-player-revision]');
  let currentRevision = 0;
  let pendingRequest = false;
  let pendingActionButton = null;
  const roleLabel = document.body.dataset.role === 'player' ? '玩家' : '使用者';

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    }[character]));
  }

  function cardTypeLabel(cardType) {
    return {
      event: '事件',
      item: '物品',
      omen: '預兆',
    }[cardType] || '卡牌';
  }

  function updateStatus(message, tone = '') {
    status.textContent = message;
    if (status?.dataset) status.dataset.statusKind = tone;
    if (connectionBadge && tone) {
      connectionBadge.dataset.tone = tone === 'success' ? 'success' : tone === 'offline' ? 'warning' : 'danger';
    }
  }

  function setButtonBusy(button, busy, busyLabel = '處理中…') {
    if (!button) return;
    if (!button.dataset) button.dataset = {};
    if (busy) {
      button.dataset.idleLabel = button.textContent;
      button.textContent = busyLabel;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.idleLabel || button.textContent;
      button.disabled = false;
    }
  }

  function updateState(value) {
    state.textContent = JSON.stringify(value, null, 2);
  }

  function renderMovement(value) {
    const data = value?.private?.movement;
    if (!data) {
      return;
    }
    if (location) {
      location.textContent = `目前位置：${data.location || '未知'}`;
    }
    if (movement) {
      movement.textContent = (data.reachableMoves || [])
        .map((move) => `可前往：${move.tileId}`)
        .join('、');
    }
  }

  function renderCards(value) {
    if (!cards) {
      return;
    }
    const heldCards = value?.private?.data?.cards || [];
    cards.innerHTML = heldCards.length === 0
      ? '<p>尚未持有卡牌。</p>'
      : `<ul>${heldCards.map((card) => (
        `<li><strong>${escapeHtml(card.name || card.type || '未命名卡牌')}</strong>`
          + `${card.description ? `<span>${escapeHtml(card.description)}</span>` : ''}</li>`
      )).join('')}</ul>`;
  }

  function renderInteraction(value) {
    if (!interaction) {
      return;
    }
    if (value?.pause?.active) {
      interaction.textContent = value.pause.reason === 'player-disconnected'
        ? '遊戲已暫停，正在等待玩家重連。'
        : '遊戲已由主持人暫停。';
      return;
    }
    const pending = value?.turn?.pendingInteraction;
    const legalActions = value?.private?.legalActions || [];
    const draw = legalActions.find((action) => action.type === 'game:draw-card');
    const canResolveHauntRoll = legalActions.some(
      (action) => action.type === 'game:resolve-haunt-roll',
    );
    if (pending?.type === 'haunt-roll') {
      interaction.textContent = canResolveHauntRoll
        ? '待處理互動：請進行作祟檢定（Haunt Roll）。'
        : '其他玩家正在進行作祟檢定（Haunt Roll），請稍候。';
      return;
    }
    if (draw) {
      interaction.textContent = `待處理互動：可抽取${cardTypeLabel(draw.cardType)}牌。`;
      return;
    }
    if (pending?.type === 'combat-target') {
      interaction.textContent = `待處理互動：已選擇玩家 ${pending.targetPlayerNumber}。`;
      return;
    }
    interaction.textContent = '目前沒有待處理互動。';
  }

  function phaseLabel(phase) {
    return {
      LOBBY: '大廳',
      EXPLORATION: '探索階段',
      HAUNT: '作祟階段',
      COMBAT: '戰鬥階段',
      PAUSED: '遊戲已暫停',
      ENDED: '遊戲已結束',
    }[phase] || '等待狀態';
  }

  function outcomeLabel(outcome) {
    const winner = {
      survivors: '倖存者勝利',
      traitor: '作祟者勝利',
    }[outcome?.winner] || '遊戲結果已揭曉';
    const reason = {
      'all-survivors-escape': '所有倖存者已逃離山莊。',
      'mummy-custody': '木乃伊已將倖存者拘捕。',
    }[outcome?.reason] || outcome?.reason || '伺服器已結算結果。';
    return `${winner}：${reason}`;
  }

  function renderCurrentAction(value) {
    if (!currentAction) {
      return;
    }

    const phase = value?.turn?.phase;
    const pending = value?.turn?.pendingInteraction;
    const privateData = value?.private || {};
    const movementData = privateData.movement || {};
    const legalActions = privateData.legalActions || [];
    const isActive = value?.turn?.activePlayerNumber === privateData.playerNumber;
    let step = 'waiting';
    let title = '等待遊戲狀態';
    let description = '加入房間後，這裡會顯示你現在要做的事。';
    let detail = '';

    if (value?.pause?.active) {
      step = 'paused';
      title = '遊戲暫停中';
      description = value.pause.reason === 'player-disconnected'
        ? '有玩家中斷連線，所有行動會在重連後繼續。'
        : '主持人暫停了遊戲，請等待恢復。';
    } else if (phase === 'ENDED') {
      step = 'ended';
      title = '本局已結束';
      description = outcomeLabel(value.haunt?.outcome);
      detail = privateData.haunt?.objective
        ? `你的目標：${privateData.haunt.objective}`
        : '';
    } else if (pending?.type === 'haunt-roll') {
      step = 'haunt-roll';
      title = '先完成預兆牌效果';
      description = '預兆牌可能喚醒作祟；結果由伺服器擲骰並結算。';
      detail = legalActions.some((action) => action.type === 'game:resolve-haunt-roll')
        ? '你的下一步：進行作祟檢定。'
        : '等待抽到預兆牌的玩家進行作祟檢定。';
    } else if (pending?.type === 'card-draw') {
      step = 'card-draw';
      title = `抽取${cardTypeLabel(pending.cardType)}牌`;
      description = '你進入了有牌堆圖示的房間；先完成抽牌，才能繼續回合。';
      detail = '卡牌內容與效果由伺服器決定。';
    } else if (pending?.type === 'combat-target') {
      step = 'combat';
      title = `戰鬥：玩家 ${pending.targetPlayerNumber}`;
      description = '目標已選定；戰鬥數值、骰子與傷害都由伺服器結算。';
      detail = legalActions.some((action) => action.type === 'game:combat:resolve')
        ? '你的下一步：結算戰鬥。'
        : '等待戰鬥流程同步。';
    } else if (phase === 'HAUNT' && value?.haunt?.triggered) {
      step = 'haunt';
      const isTraitor = privateData.haunt?.role === 'traitor';
      title = isTraitor ? '作祟者回合' : '倖存者回合';
      description = isTraitor
        ? '控制木乃伊，依序完成移動或攻擊；結果由伺服器判定。'
        : '尋找逃生機會；不要把私人目標透露給其他玩家。';
      detail = privateData.haunt?.objective
        ? `私人目標：${privateData.haunt.objective}`
        : '等待你的合法行動。';
    } else if (phase === 'EXPLORATION' && isActive) {
      step = 'movement';
      title = '探索你的回合';
      description = movementData.explorationPlacements?.length
        ? '選擇相鄰位置放置下一塊房間；房間牌由伺服器抽取。'
        : '選擇相鄰房間前進；進入特殊房間可能立即觸發抽牌。';
      detail = `還有 ${movementData.movementRemaining ?? value?.turn?.movementRemaining ?? 0} 點移動力。`;
    } else if (phase === 'EXPLORATION') {
      step = 'waiting-turn';
      title = `等待玩家 ${value?.turn?.activePlayerNumber || '—'} 的回合`;
      description = '你可以查看地圖、角色與手上的私人卡牌。';
    } else if (phase) {
      step = 'waiting';
      title = phaseLabel(phase);
      description = isActive ? '等待伺服器提供下一個合法行動。' : '請等待目前行動玩家完成操作。';
    }

    currentAction.innerHTML = `<article class="action-card" data-action-step="${escapeHtml(step)}">`
      + `<p class="action-kicker">${escapeHtml(phaseLabel(phase))}</p>`
      + `<h2>${escapeHtml(title)}</h2>`
      + `<p>${escapeHtml(description)}</p>`
      + (detail ? `<p class="action-detail">${escapeHtml(detail)}</p>` : '')
      + '</article>';
  }

  function renderTurnSummary(value) {
    if (!turnSummary) {
      return;
    }
    if (value?.pause?.active) {
      turnSummary.textContent = value.pause.reason === 'player-disconnected'
        ? '遊戲已暫停：正在等待玩家重連。'
        : '遊戲已暫停：請等待主持人恢復。';
      return;
    }
    if (value?.turn?.phase === 'ENDED') {
      turnSummary.textContent = '遊戲已結束，所有操作已鎖定。';
      return;
    }
    const playerNumber = value?.private?.playerNumber;
    const activePlayerNumber = value?.turn?.activePlayerNumber;
    const turnLabel = playerNumber === activePlayerNumber
      ? '你的回合'
      : `等待玩家 ${activePlayerNumber || '—'} 的回合`;
    turnSummary.textContent = `${phaseLabel(value?.turn?.phase)} · ${turnLabel}`;
  }

  function renderCharacter(value) {
    if (!character) {
      return;
    }
    const playerNumber = value?.private?.playerNumber;
    const player = value?.players?.find((entry) => entry.playerNumber === playerNumber);
    character.textContent = player?.characterId
      ? `角色：${player.characterId}`
      : '尚未取得角色資料。';
  }

  function renderMap(value) {
    if (!map) {
      return;
    }
    const tiles = value?.map?.tiles || [];
    const players = value?.players || [];
    if (tiles.length === 0) {
      map.textContent = '尚未探索房間。';
      return;
    }
    map.innerHTML = tiles.map((tile) => {
      const occupants = players
        .filter((player) => player.location === tile.id)
        .map((player) => `玩家 ${player.playerNumber}`)
        .join('、');
      const position = tile.position ? `（${tile.position.x}, ${tile.position.y}）` : '';
      return `<article class="room-tile"><strong>${escapeHtml(tile.id)}</strong><span>${escapeHtml(tile.floor || '未知樓層')} ${position}</span>${occupants ? `<span>在場：${escapeHtml(occupants)}</span>` : ''}</article>`;
    }).join('');
  }

  function renderCombat(value) {
    if (!combat) {
      return;
    }
    const result = value?.combat?.latestResult;
    combat.textContent = result
      ? `戰鬥結果：玩家 ${result.attackerPlayerNumber} 對玩家 ${result.targetPlayerNumber}；攻擊 ${result.attackerTotal}、防禦 ${result.defenderTotal}、傷害 ${result.damage}。`
      : '尚無戰鬥結果。';
  }

  function renderHaunt(value) {
    if (!haunt) return;
    const data = value?.haunt;
    const secret = value?.private?.haunt;
    if (!data?.triggered) {
      haunt.textContent = '尚未觸發作祟。';
      return;
    }
    const role = secret?.role === 'traitor' ? '你是作祟者。' : '你是倖存者。';
    const objective = secret?.objective ? `私人目標：${secret.objective}。` : '';
    const outcome = data.outcome ? `結果：${data.outcome.winner}（${data.outcome.reason}）` : '遊戲仍在進行。';
    haunt.textContent = `${role} ${objective}木乃伊位置：${data.mummy?.tileId || '未知'}。${outcome}`;
  }

  function renderActions(value) {
    if (!actions) {
      return;
    }
    const data = value?.private?.movement || {};
    if (value?.pause?.active || value?.turn?.phase === 'ENDED') {
      actions.innerHTML = '';
      return;
    }
    const buttons = (data.reachableMoves || []).map((move) => (
      `<button type="button" data-command="move:step" data-tile-id="${escapeHtml(move.tileId)}">前往 ${escapeHtml(move.tileId)}</button>`
    ));
    if (data.canConfirm) {
      buttons.push('<button type="button" data-command="move:confirm">確認移動</button>');
    }
    if (data.canRegret) {
      buttons.push('<button type="button" data-command="move:regret">退回起點</button>');
    }
    (data.explorationPlacements || []).forEach((placement) => {
      buttons.push(
        `<button type="button" data-command="move:explore" data-x="${placement.position.x}" data-y="${placement.position.y}" data-rotation="${placement.rotation}">探索（${placement.position.x}, ${placement.position.y}）</button>`,
      );
    });
    (value?.private?.legalActions || []).forEach((action) => {
      if (action.type === 'game:draw-card') {
        buttons.push(`<button type="button" data-command="game:draw-card">抽取${cardTypeLabel(action.cardType)}牌</button>`);
      }
      if (action.type === 'game:resolve-haunt-roll') {
        buttons.push('<button type="button" data-command="game:resolve-haunt-roll">進行作祟檢定</button>');
      }
      if (action.type === 'game:combat:select-target') {
        buttons.push(`<button type="button" data-command="game:combat:select-target" data-target-player-number="${action.targetPlayerNumber}">選擇玩家 ${action.targetPlayerNumber}</button>`);
      }
      if (action.type === 'game:combat:resolve') {
        buttons.push('<button type="button" data-command="game:combat:resolve">結算戰鬥</button>');
      }
      if (action.type === 'haunt:mummy:move') {
        buttons.push(`<button type="button" data-command="haunt:mummy:move" data-tile-id="${escapeHtml(action.tileId)}">木乃伊移動到 ${escapeHtml(action.tileId)}</button>`);
      }
      if (action.type === 'haunt:mummy:attack') {
        buttons.push(`<button type="button" data-command="haunt:mummy:attack" data-target-player-number="${action.targetPlayerNumber}">木乃伊攻擊玩家 ${action.targetPlayerNumber}</button>`);
      }
      if (action.type === 'haunt:survivor:escape') {
        buttons.push('<button type="button" data-command="haunt:survivor:escape">逃離山莊</button>');
      }
    });
    if (value?.turn?.activePlayerNumber === value?.private?.playerNumber
      && !value?.turn?.pendingInteraction
      && !data.canConfirm
      && !data.canRegret) {
      buttons.push('<button type="button" data-command="turn:pass">結束回合</button>');
    }
    actions.innerHTML = buttons.join('');
  }

  function renderPrivateState(value) {
    currentRevision = value.revision ?? currentRevision;
    if (playerRevision) playerRevision.textContent = `REV ${currentRevision}`;
    if (playerIdentity && value.private?.playerNumber) {
      const player = value.players?.find((entry) => entry.playerNumber === value.private.playerNumber);
      playerIdentity.textContent = `玩家 ${value.private.playerNumber} · ${player?.characterId || '角色待同步'}`;
    }
    renderTurnSummary(value);
    renderCurrentAction(value);
    renderCharacter(value);
    renderMap(value);
    renderMovement(value);
    renderCards(value);
    renderInteraction(value);
    renderCombat(value);
    renderHaunt(value);
    renderActions(value);
  }

  function commandDetails(commandType, target) {
    if (commandType === 'move:step') {
      return {
        requestId: `move-step-${target.dataset.tileId}`,
        payload: { tileId: target.dataset.tileId },
      };
    }
    if (commandType === 'move:explore') {
      return {
        requestId: `move-explore-${target.dataset.x}-${target.dataset.y}-${target.dataset.rotation}`,
        payload: {
          position: { x: Number(target.dataset.x), y: Number(target.dataset.y) },
          rotation: Number(target.dataset.rotation),
        },
      };
    }
    if (commandType === 'game:combat:select-target') {
      return {
        requestId: `combat-select-target-${target.dataset.targetPlayerNumber}`,
        payload: { targetPlayerNumber: Number(target.dataset.targetPlayerNumber) },
      };
    }
    if (commandType === 'haunt:mummy:move') {
      return {
        requestId: `mummy-move-${target.dataset.tileId}`,
        payload: { tileId: target.dataset.tileId },
      };
    }
    if (commandType === 'haunt:mummy:attack') {
      return {
        requestId: `mummy-attack-${target.dataset.targetPlayerNumber}`,
        payload: { targetPlayerNumber: Number(target.dataset.targetPlayerNumber) },
      };
    }
    return {
      requestId: commandType.replace('game:', '').replaceAll(':', '-'),
      payload: {},
    };
  }

  updateStatus(`正在將${roleLabel}連線到房間傳輸層…`);

  const socket = io();

  if (joinRoomButton) {
    joinRoomButton.addEventListener('click', () => {
      pendingRequest = true;
      setButtonBusy(joinRoomButton, true, '加入中…');
      socket.emit('message', {
        type: 'room:join',
        requestId: 'join-room',
        payload: {},
      });
    });
  }

  if (reconnectRoomButton) {
    reconnectRoomButton.addEventListener('click', () => {
      pendingRequest = true;
      setButtonBusy(reconnectRoomButton, true, '重連中…');
      socket.emit('message', {
        type: 'room:reconnect',
        requestId: 'reconnect-room',
        payload: { token: reconnectToken?.value?.trim() || '' },
      });
    });
  }

  if (actions) {
    actions.addEventListener('click', (event) => {
      const target = event.target;
      const commandType = target?.dataset?.command;
      if (!commandType) {
        return;
      }
      pendingRequest = true;
      const details = commandDetails(commandType, target);
      pendingActionButton = target;
      setButtonBusy(target, true);
      socket.emit('message', {
        type: 'game:command',
        requestId: details.requestId,
        payload: {
          type: commandType,
          baseRevision: currentRevision,
          payload: details.payload,
        },
      });
    });
  }

  socket.on('connect', () => {
    pendingRequest = false;
    updateStatus(`${roleLabel}已連線到房間傳輸層。`, 'success');
  });

  socket.on('disconnect', () => {
    pendingRequest = false;
    setButtonBusy(joinRoomButton, false);
    setButtonBusy(reconnectRoomButton, false);
    setButtonBusy(pendingActionButton, false);
    pendingActionButton = null;
    updateStatus(`${roleLabel}已斷線，正在等待重連。`, 'offline');
  });

  socket.on('message', (envelope) => {
    if (envelope.type === 'room:state') {
      pendingRequest = false;
      setButtonBusy(joinRoomButton, false);
      setButtonBusy(reconnectRoomButton, false);
      setButtonBusy(pendingActionButton, false);
      pendingActionButton = null;
      updateStatus(`${roleLabel}已同步共享房間狀態。`, 'success');
      updateState(envelope.payload);
      return;
    }

    if (envelope.type === 'error:rejected') {
      pendingRequest = false;
      setButtonBusy(joinRoomButton, false);
      setButtonBusy(reconnectRoomButton, false);
      setButtonBusy(pendingActionButton, false);
      pendingActionButton = null;
      updateStatus(`${envelope.payload?.message || '操作被拒絕。'}（${envelope.payload?.code || 'unknown'}）`, 'error');
      return;
    }

    if (envelope.type === 'player:identity' && reconnectToken && envelope.payload?.token) {
      reconnectToken.value = envelope.payload.token;
    }

    if (envelope.type === 'game:state:private') {
      pendingRequest = false;
      pendingActionButton = null;
      renderPrivateState(envelope.payload);
      setButtonBusy(joinRoomButton, false);
      setButtonBusy(reconnectRoomButton, false);
    }

    updateStatus(`${roleLabel}收到 ${envelope.type} 訊息。`);
    updateState(envelope);
  });
}());
