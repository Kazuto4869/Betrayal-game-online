(function bootstrapHostPage() {
  const status = document.querySelector('[data-status]');
  const state = document.querySelector('[data-state]');
  const map = document.querySelector('[data-map]');
  const joinUrl = document.querySelector('[data-join-url]');
  const decks = document.querySelector('[data-decks]');
  const pending = document.querySelector('[data-pending]');
  const publicLog = document.querySelector('[data-public-log]');
  const combat = document.querySelector('[data-combat]');
  const haunt = document.querySelector('[data-haunt]');
  const hostCurrentAction = document.querySelector('[data-host-current-action]');
  const controls = document.querySelector('[data-host-actions]');
  const createRoomButton = document.querySelector('[data-create-room]');
  const roomTargetCount = document.querySelector('[data-room-target-count]');
  const roomCode = document.querySelector('[data-room-code]');
  const roomStatus = document.querySelector('[data-room-status]');
  const roomProgress = document.querySelector('[data-room-progress]');
  const lobbyStatus = document.querySelector('[data-lobby-status]');
  const seats = document.querySelector('[data-seats]');
  const copyJoinButton = document.querySelector('[data-copy-join]');
  const mapStatus = document.querySelector('[data-map-status]');
  let currentRevision = 0;
  let latestJoinUrl = '';
  let pendingRequest = false;
  const roleLabel = document.body.dataset.role === 'host' ? '主持人' : '使用者';

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    }[character]));
  }

  function updateStatus(message, tone = '') {
    status.textContent = message;
    if (status?.dataset) {
      status.dataset.statusKind = tone;
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

  function renderLobby(value) {
    if (!value) return;
    const players = Array.isArray(value.players) ? value.players : [];
    const target = value.targetPlayerCount || 0;
    const started = Boolean(value.started);
    if (roomCode) roomCode.textContent = value.roomCode || '— — —';
    if (roomStatus) {
      roomStatus.textContent = started ? '遊戲進行中' : value.roomCode ? '等待玩家' : '尚未建立';
      roomStatus.dataset.tone = started ? 'success' : value.roomCode ? 'warning' : '';
    }
    if (roomProgress) {
      roomProgress.textContent = value.roomCode
        ? `${players.filter((player) => player.connected).length} / ${target} 位玩家已連線`
        : '等待建立房間';
    }
    if (lobbyStatus) {
      lobbyStatus.textContent = value.roomCode
        ? (started ? '已開局' : `${players.length} / ${target} 個座位`)
        : '等待房間';
    }
    if (seats) {
      if (!value.roomCode) {
        seats.innerHTML = '<p class="empty-state">建立房間後，玩家座位會出現在這裡。</p>';
      } else {
        const bySeat = new Map(players.map((player) => [player.seat, player]));
        seats.innerHTML = Array.from({ length: target }, (_, index) => {
          const seat = index + 1;
          const player = bySeat.get(seat);
          if (!player) {
            return `<article class="seat-card"><span class="seat-number">${seat}</span><span><strong>等待加入</strong><small>座位尚未被佔用</small></span><span class="status-badge" data-tone="warning">空位</span></article>`;
          }
          const connection = player.connected ? '已連線' : '可重連';
          const tone = player.connected ? 'success' : 'warning';
          return `<article class="seat-card"><span class="seat-number">${seat}</span><span><strong>玩家 ${player.playerNumber}</strong><small>${escapeHtml(player.characterId || '角色待分配')}</small></span><span class="status-badge" data-tone="${tone}">${connection}</span></article>`;
        }).join('');
      }
    }
  }

  function updateState(value) {
    state.textContent = JSON.stringify(value, null, 2);
    if (joinUrl && value && Object.prototype.hasOwnProperty.call(value, 'joinUrl')) {
      latestJoinUrl = value.joinUrl || '';
      joinUrl.textContent = value.joinUrl
        ? `玩家加入網址：${value.joinUrl}`
        : '玩家加入網址：等待偵測可用的 LAN IPv4 位址。';
      if (copyJoinButton) copyJoinButton.disabled = !value.joinUrl;
    }
  }

  function renderMap(value) {
    if (!map) {
      return;
    }
    const tiles = Array.isArray(value?.map?.tiles) ? value.map.tiles : [];
    const players = Array.isArray(value?.players) ? value.players : [];
    if (tiles.length === 0) {
      map.textContent = '尚未探索房間。';
      if (mapStatus) mapStatus.textContent = '等待探索';
      return;
    }
    if (mapStatus) mapStatus.textContent = `${tiles.length} 個房間已探索`;
    map.innerHTML = tiles.map((tile) => {
      const occupants = players
        .filter((player) => player.location === tile.id)
        .map((player) => `玩家 ${player.playerNumber}`)
        .join('、');
      const position = tile.position ? `（${tile.position.x}, ${tile.position.y}）` : '';
      return `<article class="room-tile"><strong>房間 ${escapeHtml(tile.id)}</strong><span>${escapeHtml(tile.floor || '未知樓層')} ${position}</span>${occupants ? `<span>在場：${escapeHtml(occupants)}</span>` : ''}</article>`;
    }).join('');
  }

  function renderDecks(value) {
    if (!decks) {
      return;
    }
    const summary = value?.decks;
    if (!summary) {
      decks.textContent = '牌堆資料尚未同步。';
      return;
    }
    decks.textContent = [
      `房間牌堆：${summary.room?.remaining ?? 0}`,
      `事件牌：抽牌 ${summary.event?.draw ?? 0}、棄牌 ${summary.event?.discard ?? 0}`,
      `物品牌：抽牌 ${summary.item?.draw ?? 0}、棄牌 ${summary.item?.discard ?? 0}`,
      `預兆牌：抽牌 ${summary.omen?.draw ?? 0}、棄牌 ${summary.omen?.discard ?? 0}`,
    ].join('；');
  }

  function renderPending(value) {
    if (!pending) {
      return;
    }
    const interaction = value?.turn?.pendingInteraction;
    if (!interaction) {
      pending.textContent = '目前沒有待處理互動。';
      return;
    }
    if (interaction.type === 'haunt-roll') {
      pending.textContent = '待處理互動：作祟檢定（Haunt Roll）。';
      return;
    }
    if (interaction.type === 'combat-target') {
      pending.textContent = `待處理互動：選擇玩家 ${interaction.targetPlayerNumber}。`;
      return;
    }
    pending.textContent = '待處理互動：抽牌。';
  }

  function renderPublicLog(value) {
    if (!publicLog) {
      return;
    }
    publicLog.textContent = value?.latestPublicLog?.summary || '尚無公開事件。';
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
    if (!data?.triggered) {
      haunt.textContent = '尚未觸發作祟。';
      return;
    }
    const mummy = data.mummy?.tileId || '未知';
    const outcome = data.outcome ? `；結果：${data.outcome.winner}` : '';
    haunt.textContent = `作祟劇本：${data.scenarioId}；木乃伊位置：${mummy}${outcome}`;
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

  function renderHostCurrentAction(value) {
    if (!hostCurrentAction) {
      return;
    }

    const phase = value?.turn?.phase;
    const pendingInteraction = value?.turn?.pendingInteraction;
    let step = 'waiting';
    let title = '等待遊戲狀態';
    let description = '建立房間並等待玩家加入。';
    let detail = '';

    if (value?.pause?.active) {
      step = 'paused';
      title = '遊戲暫停中';
      description = value.pause.reason === 'player-disconnected'
        ? '有玩家中斷連線；等待重連後才能繼續。'
        : '主持人已暫停遊戲；可由主持人恢復。';
    } else if (phase === 'ENDED') {
      step = 'ended';
      title = '本局已結束';
      description = outcomeLabel(value.haunt?.outcome);
      detail = '公開結果已同步給所有玩家。';
    } else if (pendingInteraction) {
      step = 'attention';
      const playerNumber = pendingInteraction.playerNumber || '目前玩家';
      if (pendingInteraction.type === 'haunt-roll') {
        title = '等待作祟檢定';
        description = `等待玩家 ${playerNumber} 完成作祟檢定。`;
        detail = '檢定結果由伺服器擲骰並判定是否觸發作祟。';
      } else if (pendingInteraction.type === 'card-draw') {
        title = '等待抽牌';
        description = `等待玩家 ${playerNumber} 抽取${pendingInteraction.cardType || ''}牌。`;
        detail = '抽牌與卡牌效果由伺服器處理。';
      } else if (pendingInteraction.type === 'combat-target') {
        title = '等待戰鬥流程';
        description = `等待玩家 ${playerNumber} 完成戰鬥目標選擇。`;
        detail = '戰鬥數值、骰子與傷害由伺服器結算。';
      }
    } else if (phase === 'EXPLORATION') {
      step = 'turn';
      title = `探索階段 · 玩家 ${value?.turn?.activePlayerNumber || '—'} 的回合`;
      description = '觀察公開地圖與玩家位置，等待目前玩家完成移動。';
      detail = `還有 ${value?.turn?.movementRemaining ?? 0} 點移動力。`;
    } else if (phase) {
      step = 'phase';
      title = phaseLabel(phase);
      description = `目前輪到玩家 ${value?.turn?.activePlayerNumber || '—'}。`;
      detail = '公開資訊會隨伺服器狀態更新。';
    }

    hostCurrentAction.innerHTML = `<article class="action-card host-action-card" data-host-step="${escapeHtml(step)}">`
      + `<p class="action-kicker">${escapeHtml(phaseLabel(phase))}</p>`
      + `<h2>${escapeHtml(title)}</h2>`
      + `<p>${escapeHtml(description)}</p>`
      + (detail ? `<p class="action-detail">${escapeHtml(detail)}</p>` : '')
      + '</article>';
  }

  function renderControls(value) {
    if (!controls) return;
    const hostControls = value?.hostControls || {};
    const buttons = [];
    if (hostControls.canPause) {
      buttons.push('<button type="button" data-command="host:pause">暫停遊戲</button>');
    }
    if (hostControls.canResume) {
      buttons.push('<button type="button" data-command="host:resume">恢復遊戲</button>');
    }
    if (hostControls.canRestart) {
      buttons.push('<button type="button" data-command="host:restart">確認重新開始</button>');
    }
    controls.innerHTML = buttons.join('');
  }

  updateStatus(`正在將${roleLabel}連線到房間傳輸層…`);

  const socket = io();

  if (copyJoinButton) {
    copyJoinButton.addEventListener('click', async () => {
      if (!latestJoinUrl || !navigator.clipboard) return;
      await navigator.clipboard.writeText(latestJoinUrl);
      updateStatus('玩家加入網址已複製。', 'success');
    });
  }

  if (createRoomButton) {
    createRoomButton.addEventListener('click', () => {
      if (pendingRequest) return;
      pendingRequest = true;
      setButtonBusy(createRoomButton, true, '建立中…');
      socket.emit('message', {
        type: 'room:create',
        requestId: 'create-room',
        payload: { targetPlayerCount: Number(roomTargetCount?.value || 3) },
      });
    });
  }

  socket.on('connect', () => {
    updateStatus(`${roleLabel}已連線到房間傳輸層。`, 'success');
  });

  socket.on('disconnect', () => {
    updateStatus(`${roleLabel}已斷線，正在等待重連。`, 'offline');
  });

  socket.on('message', (envelope) => {
    if (envelope.type === 'room:state') {
      pendingRequest = false;
      setButtonBusy(createRoomButton, false);
      renderLobby(envelope.payload);
      updateStatus(`${roleLabel}已同步共享房間狀態。`, 'success');
      updateState(envelope.payload);
      return;
    }

    if (envelope.type === 'error:rejected') {
      pendingRequest = false;
      setButtonBusy(createRoomButton, false);
      updateStatus(`${envelope.payload?.message || '操作被拒絕。'}（${envelope.payload?.code || 'unknown'}）`, 'error');
      return;
    }

    if (envelope.type === 'game:state:public') {
      currentRevision = envelope.payload?.revision ?? currentRevision;
      renderHostCurrentAction(envelope.payload);
      renderMap(envelope.payload);
      renderDecks(envelope.payload);
      renderPending(envelope.payload);
      renderPublicLog(envelope.payload);
      renderCombat(envelope.payload);
      renderHaunt(envelope.payload);
      renderControls(envelope.payload);
    }

    updateStatus(`${roleLabel}收到 ${envelope.type} 訊息。`);
    updateState(envelope);
  });

  if (controls) {
    controls.addEventListener('click', (event) => {
      const commandType = event.target?.dataset?.command;
      if (!commandType) return;
      socket.emit('message', {
        type: 'game:command',
        requestId: commandType.replaceAll(':', '-'),
        payload: {
          type: commandType,
          baseRevision: currentRevision,
          payload: commandType === 'host:restart' ? { confirm: true } : {},
        },
      });
    });
  }
}());
