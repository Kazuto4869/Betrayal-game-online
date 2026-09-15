const { GAME_PHASES } = require('./gamePhase');
const { getReachableMoves, isPositionAdjacentToPlayer } = require('./movement');
const { ROOM_DEFINITIONS } = require('../data/rooms');
const { drawFirstLegalRoom } = require('./roomPlacement');
const { hasDrawableCard } = require('./cardResolution');
const { getLegalCombatTargets } = require('./combat');
const { isTraitor } = require('./haunt/hauntState');
const { getLegalMummyMoves } = require('./haunt/mummyActions');
const { canResumeAfterReconnect } = require('./pauseState');

const TURN_PHASES = new Set([
  GAME_PHASES.EXPLORATION,
  GAME_PHASES.HAUNT,
  GAME_PHASES.COMBAT,
]);

function error(code, message) {
  return { valid: false, error: { code, message } };
}

function isKnownActor(state, actor = {}) {
  if (actor.role === 'host') {
    return true;
  }

  return Number.isInteger(actor.playerNumber)
    && state.players.some((player) => player.playerNumber === actor.playerNumber);
}

function hasOnlyPayloadKeys(payload, allowedKeys) {
  if (payload === undefined) {
    return true;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  return Object.keys(payload).every((key) => allowedKeys.has(key));
}

function isEmptyPendingCardDraw(state, playerNumber) {
  const pending = state.turn.pendingInteraction;
  return pending?.type === 'card-draw'
    && pending.playerNumber === playerNumber
    && !hasDrawableCard(state, pending.cardType);
}

function validateCommand(state, command, actor = {}) {
  if (!isKnownActor(state, actor)) {
    return error('invalid-actor', '無效的操作來源。');
  }

  if (!command || typeof command !== 'object' || typeof command.type !== 'string') {
    return error('invalid-command', '命令格式無效。');
  }

  if (command.baseRevision !== state.revision) {
    return error('stale-revision', '遊戲狀態已更新，請重新取得狀態。');
  }

  const isHostCommand = command.type.startsWith('host:');
  if (isHostCommand && actor.role !== 'host') {
    return error('unauthorized-host-command', '只有 Host 可以執行此命令。');
  }

  if (!isHostCommand && state.pause.active) {
    return error('paused-game', '遊戲目前已暫停。');
  }

  if (!isHostCommand && state.turn.phase === GAME_PHASES.ENDED) {
    return error('game-ended', '遊戲已經結束。');
  }

  if (command.type === 'haunt:mummy:move' || command.type === 'haunt:mummy:attack'
    || command.type === 'haunt:survivor:escape') {
    if (state.turn.phase !== GAME_PHASES.HAUNT) {
      return error('invalid-phase', '目前不是作祟階段。');
    }
    if (actor.playerNumber !== state.turn.activePlayerNumber) {
      return error('not-active-player', '目前不是你的作祟回合。');
    }
    if (command.type !== 'haunt:survivor:escape' && !isTraitor(state, actor.playerNumber)) {
      return error('unauthorized-haunt-action', '只有作祟者可以控制木乃伊。');
    }
    if (command.type === 'haunt:survivor:escape' && isTraitor(state, actor.playerNumber)) {
      return error('unauthorized-haunt-action', '作祟者不能使用倖存者逃脫。');
    }
    if (command.type === 'haunt:mummy:move') {
      if (!hasOnlyPayloadKeys(command.payload, new Set(['tileId']))) {
        return error('tampered-haunt-result', '木乃伊移動結果必須由伺服器決定。');
      }
      if (!getLegalMummyMoves(state).some((move) => move.tileId === command.payload?.tileId)) {
        return error('illegal-mummy-move', '木乃伊無法移動到該房間。');
      }
    } else if (command.type === 'haunt:mummy:attack') {
      if (!hasOnlyPayloadKeys(command.payload, new Set(['targetPlayerNumber']))) {
        return error('tampered-haunt-result', '木乃伊攻擊結果必須由伺服器決定。');
      }
      if (!Number.isInteger(command.payload?.targetPlayerNumber)) {
        return error('invalid-target', '木乃伊攻擊目標無效。');
      }
    } else if (!hasOnlyPayloadKeys(command.payload, new Set())) {
      return error('tampered-haunt-result', '逃脫結果必須由伺服器決定。');
    }
    return { valid: true, command };
  }

  if (command.type === 'game:draw-card' || command.type === 'game:resolve-haunt-roll') {
    if (state.turn.phase !== GAME_PHASES.EXPLORATION) {
      return error('invalid-phase', '目前無法處理卡牌互動');
    }
    if (actor.playerNumber !== state.turn.activePlayerNumber) {
      return error('not-active-player', '只有目前玩家可以處理卡牌互動');
    }

    const pending = state.turn.pendingInteraction;
    if (!pending || pending.playerNumber !== actor.playerNumber) {
      return error('no-pending-interaction', '目前沒有待處理的卡牌互動');
    }

    if (command.type === 'game:draw-card') {
      if (pending.type !== 'card-draw') {
        return error('no-pending-card-draw', '目前沒有待抽取的卡牌');
      }
      if (!hasDrawableCard(state, pending.cardType)) {
        return error('empty-deck', '卡牌牌堆已無可抽取的卡牌');
      }
      if (!hasOnlyPayloadKeys(command.payload, new Set(['cardType']))) {
        return error('tampered-card-result', '卡牌結果必須由伺服器決定');
      }
      if (command.payload?.cardType !== undefined && command.payload.cardType !== pending.cardType) {
        return error('invalid-card-type', '卡牌類型與目前互動不符');
      }
      return { valid: true, command };
    }

    if (pending.type !== 'haunt-roll') {
      return error('no-pending-haunt-roll', '目前沒有待處理的 Haunt Roll');
    }
    if (!hasOnlyPayloadKeys(command.payload, new Set())) {
      return error('tampered-card-result', 'Haunt Roll 結果必須由伺服器決定');
    }
    return { valid: true, command };
  }

  if (command.type === 'game:combat:select-target' || command.type === 'game:combat:resolve') {
    const isTargetSelection = command.type === 'game:combat:select-target';
    const isValidCombatPhase = state.turn.phase === GAME_PHASES.COMBAT
      || (isTargetSelection && state.turn.phase === GAME_PHASES.EXPLORATION);
    if (!isValidCombatPhase) {
      return error('invalid-phase', '目前不是戰鬥階段');
    }
    if (actor.playerNumber !== state.turn.activePlayerNumber) {
      return error('not-active-player', '只有目前玩家可以執行戰鬥');
    }

    if (isTargetSelection) {
      if (state.turn.pendingInteraction?.playerNumber === actor.playerNumber
        && state.turn.pendingInteraction.type !== 'combat-target') {
        return error('pending-interaction', '請先完成目前待處理的互動');
      }
      if (state.turn.pendingMove?.playerNumber === actor.playerNumber) {
        return error('pending-move', '請先確認或取消目前移動');
      }
      if (!hasOnlyPayloadKeys(command.payload, new Set(['targetPlayerNumber']))) {
        return error('tampered-combat-result', '戰鬥結果只能由伺服器計算');
      }
      const targetPlayerNumber = command.payload?.targetPlayerNumber;
      if (!getLegalCombatTargets(state, actor.playerNumber).includes(targetPlayerNumber)) {
        return error('invalid-target', '戰鬥目標無效');
      }
      return { valid: true, command };
    }

    if (!hasOnlyPayloadKeys(command.payload, new Set())) {
      return error('tampered-combat-result', '戰鬥結果只能由伺服器計算');
    }
    const pending = state.turn.pendingInteraction;
    if (pending?.type !== 'combat-target' || pending.playerNumber !== actor.playerNumber) {
      return error('no-combat-target', '尚未確認戰鬥目標');
    }
    if (!getLegalCombatTargets(state, actor.playerNumber).includes(pending.targetPlayerNumber)) {
      return error('invalid-target', '戰鬥目標無效');
    }
    return { valid: true, command };
  }

  if (command.type === 'move:step' || command.type === 'move:explore'
    || command.type === 'move:confirm' || command.type === 'move:regret') {
    if (state.turn.phase !== GAME_PHASES.EXPLORATION) {
      return error('invalid-phase', '移動只能在探索階段進行');
    }
    if (actor.playerNumber !== state.turn.activePlayerNumber) {
      return error('not-active-player', '只有目前玩家可以移動');
    }

    if (state.turn.pendingInteraction?.playerNumber === actor.playerNumber) {
      return error('pending-interaction', '請先完成目前的卡牌互動');
    }

    if ((command.type === 'move:step' || command.type === 'move:explore')
      && state.turn.pendingMove?.playerNumber === actor.playerNumber) {
      return error('pending-move', '請先確認或退回目前移動');
    }

    if (command.type === 'move:explore') {
      const position = command.payload?.position;
      const rotation = command.payload?.rotation;
      if (!position || !Number.isInteger(position.x) || !Number.isInteger(position.y)
        || !Number.isInteger(rotation)) {
        return error('invalid-placement', '房間位置與旋轉格式無效');
      }
      if (state.turn.movementRemaining <= 0) {
        return error('movement-exhausted', 'No movement remains');
      }
      if (!isPositionAdjacentToPlayer(state, actor.playerNumber, position)) {
        return error('illegal-placement', '房間必須放在目前房間的相鄰出口');
      }
      try {
        drawFirstLegalRoom(state.map, ROOM_DEFINITIONS, { position, rotation });
      } catch (placementError) {
        return error(placementError.code || 'no-legal-room', placementError.message);
      }
      return { valid: true, command };
    }

    if (command.type === 'move:step') {
      const targetTileId = command.payload && command.payload.tileId;
      const reachable = getReachableMoves(state, actor.playerNumber);
      if (state.turn.movementRemaining <= 0) {
        return error('movement-exhausted', 'No movement remains');
      }
      if (!reachable.some((move) => move.tileId === targetTileId)) {
        return error('illegal-move', 'Target tile is not reachable');
      }
      return { valid: true, command };
    }

    const pending = state.turn.pendingMove;
    if (!pending || pending.playerNumber !== actor.playerNumber) {
      return error('no-pending-move', 'No pending move belongs to this player');
    }
    if (command.type === 'move:regret' && pending.immediateStop) {
      return error('move-must-confirm', 'Immediate-stop movement must be confirmed');
    }
    return { valid: true, command };
  }

  if (command.type === 'turn:pass'
    && state.turn.pendingInteraction?.playerNumber === actor.playerNumber
    && !isEmptyPendingCardDraw(state, actor.playerNumber)) {
    return error('pending-interaction', '請先完成目前的卡牌互動');
  }

  if (command.type === 'turn:pass' && state.turn.pendingMove?.playerNumber === actor.playerNumber) {
    return error('pending-move', '請先確認或退回目前移動');
  }

  if (command.type === 'turn:pass') {
    if (!TURN_PHASES.has(state.turn.phase)) {
      return error('invalid-phase', '目前階段不可結束回合。');
    }
    if (actor.playerNumber !== state.turn.activePlayerNumber) {
      return error('not-active-player', '目前不是你的回合。');
    }
    return { valid: true, command };
  }

  if (command.type === 'host:pause') {
    if (state.turn.phase === GAME_PHASES.ENDED || state.turn.phase === GAME_PHASES.PAUSED || state.pause.active) {
      return error('invalid-phase', '目前階段不可暫停。');
    }
    return { valid: true, command };
  }

  if (command.type === 'host:resume') {
    if (state.turn.phase !== GAME_PHASES.PAUSED || !state.pause.active) {
      return error('invalid-phase', '目前沒有可解除的暫停。');
    }
    if (!canResumeAfterReconnect(state)) {
      return error('players-disconnected', '仍有玩家尚未重連。');
    }
    return { valid: true, command };
  }

  if (command.type === 'host:restart') {
    if (!hasOnlyPayloadKeys(command.payload, new Set(['confirm']))) {
      return error('invalid-restart-payload', '重啟確認格式無效。');
    }
    if (command.payload?.confirm !== true) {
      return error('restart-confirmation-required', '重啟需要明確確認。');
    }
    return { valid: true, command };
  }

  return error('unknown-command', '未知的遊戲命令。');
}

module.exports = {
  validateCommand,
};
