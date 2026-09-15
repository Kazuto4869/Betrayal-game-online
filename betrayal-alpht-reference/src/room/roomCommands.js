const crypto = require('node:crypto');

const {
  allSeatsConnected,
  createCharacterQueue,
  createRoomState,
  publicRoomState,
} = require('./roomState');
const { createReconnectTokenStore } = require('./reconnectTokens');

class RoomCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RoomCommandError';
    this.code = code;
  }
}

function createRoomCommands(options = {}) {
  const {
    now = () => Date.now(),
    randomInt = (maximum) => crypto.randomInt(maximum),
    tokenStore = createReconnectTokenStore({ now }),
  } = options;
  let state = null;

  function createRoom(targetPlayerCount) {
    if (state) {
      throw new RoomCommandError('room-already-created', '房間已建立。');
    }

    try {
      state = createRoomState(targetPlayerCount, { now });
    } catch (error) {
      throw new RoomCommandError('invalid-player-count', error.message);
    }
    return publicRoomState(state);
  }

  function requireRoom() {
    if (!state) {
      throw new RoomCommandError('room-not-created', '尚未建立房間。');
    }
  }

  function assignNextSeat(connectionId, characterId = null) {
    const playerNumber = state.players.length + 1;
    const player = {
      seat: playerNumber,
      playerNumber,
      characterId,
      connected: true,
      connectionId,
    };
    state.players.push(player);
    return player;
  }

  function join(connectionId) {
    requireRoom();
    expireLobbySeats();
    if (state.players.some((player) => player.connected && player.connectionId === connectionId)) {
      throw new RoomCommandError('already-joined', '此連線已加入房間。');
    }
    if (state.started) {
      throw new RoomCommandError('game-already-started', '遊戲已開始，不接受新玩家。');
    }
    if (state.characterQueue === null) {
      state.characterQueue = createCharacterQueue(state.targetPlayerCount, randomInt);
    }
    const openSeat = state.players.find((player) => !player.connected && player.replacementAvailable);
    const pendingReservedSeat = state.players.some((player) => !player.connected && !player.replacementAvailable);
    if (pendingReservedSeat && !openSeat) {
      throw new RoomCommandError('no-available-seat', '目前沒有可加入的座位。');
    }
    if (state.players.length >= state.targetPlayerCount && !openSeat) {
      throw new RoomCommandError('no-available-seat', '目前沒有可加入的座位。');
    }

    const player = openSeat || assignNextSeat(connectionId, state.characterQueue[state.players.length]);
    if (openSeat) {
      tokenStore.revoke(openSeat.token);
      player.connected = true;
      player.connectionId = connectionId;
      player.replacementAvailable = false;
    }
    const token = tokenStore.issue({ seat: player.seat, characterId: player.characterId });
    player.token = token;
    player.replacementAvailable = false;
    if (allSeatsConnected(state)) {
      state.started = true;
      tokenStore.setPersistent(true);
    }
    return { player: { ...player, token: undefined }, token, started: state.started };
  }

  function disconnect(connectionId) {
    requireRoom();
    const player = state.players.find((candidate) => candidate.connectionId === connectionId);
    if (!player) {
      return false;
    }
    player.connected = false;
    player.connectionId = null;
    player.replacementAvailable = false;
    if (!state.started) {
      player.replacementExpiresAt = now() + 5 * 60 * 1000;
    }
    return true;
  }

  function expireLobbySeats() {
    if (!state || state.started) {
      return;
    }
    for (const player of state.players) {
      if (!player.connected && !player.replacementAvailable && now() >= player.replacementExpiresAt) {
        player.replacementAvailable = true;
      }
    }
  }

  function reconnect(token, connectionId) {
    requireRoom();
    const identity = tokenStore.resolve(token);
    if (!identity) {
      return null;
    }
    const player = state.players.find((candidate) => candidate.seat === identity.seat);
    if (!player || player.characterId !== identity.characterId || player.connected) {
      return null;
    }
    if (!state.started && player.replacementExpiresAt && now() >= player.replacementExpiresAt) {
      tokenStore.revoke(token);
      return null;
    }
    player.connected = true;
    player.connectionId = connectionId;
    player.replacementAvailable = false;
    return { player: { ...player, token: undefined }, started: state.started };
  }

  function getState() {
    requireRoom();
    return state;
  }

  function getPublicState() {
    requireRoom();
    return publicRoomState(state);
  }

  return {
    createRoom,
    disconnect,
    expireLobbySeats,
    getPublicState,
    getState,
    join,
    reconnect,
  };
}

module.exports = {
  RoomCommandError,
  createRoomCommands,
};
