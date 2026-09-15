const { Server } = require('socket.io');

const {
  ERROR_REJECTED,
  MESSAGE_EVENT,
  ROOM_STATE,
  createEnvelope,
} = require('./messageTypes');
const { RoomCommandError, createRoomCommands } = require('../room/roomCommands');
const { findLanIPv4 } = require('../network/lanAddress');
const { createPlayerJoinUrl } = require('../network/qrJoinUrl');
const { GAME_PHASES } = require('../game/gamePhase');
const { createGameState } = require('../game/gameState');
const { createCommandRouter } = require('../game/commandRouter');
const { createPublicSnapshot } = require('../game/publicSnapshot');
const { createPrivateSnapshot } = require('../game/privateSnapshot');
const { ROOM_DEFINITIONS } = require('../data/rooms');
const { createMapState } = require('../game/mapState');
const { placeRoom } = require('../game/roomPlacement');
const { markPlayerReconnected, pauseForDisconnect } = require('../game/pauseState');
const { createHostSnapshot } = require('../host/hostSnapshot');

function createInitialRoomState() {
  return {
    roomCode: null,
    players: [],
    started: false,
  };
}

function createSocketServer(httpServer, options = {}) {
  const io = new Server(httpServer, {
    serveClient: true,
  });
  const roomCommands = createRoomCommands();
  const gameStateFactory = typeof options.gameStateFactory === 'function'
    ? options.gameStateFactory
    : createGameState;
  let gameState = null;
  let gameRouter = null;

  function syncGameState() {
    const room = roomCommands.getState();
    if (!room.started || gameState) {
      return;
    }

    gameState = gameStateFactory({ room, players: room.players });
    const entrance = ROOM_DEFINITIONS.find((definition) => definition.id === 'entrance');
    const map = createMapState(['gallery', 'hallway', 'staircase', 'basement']);
    gameState.map = placeRoom(map, entrance, { position: { x: 0, y: 0 }, rotation: 0 });
    gameState.map.playerPositions = Object.fromEntries(
      room.players.map((player) => [player.playerNumber, 'entrance']),
    );
    gameState.turn.order = room.players.map((player) => player.playerNumber);
    gameState.turn.activePlayerNumber = gameState.turn.order[0] || null;
    gameState.turn.phase = GAME_PHASES.EXPLORATION;
    gameState.turn.movementRemaining = 3;
    gameRouter = createCommandRouter({
      getState: () => gameState,
      commit: (nextState) => { gameState = nextState; },
      emit: () => {},
    });
  }

  function actorForSocket(socket) {
    if (socket.data.role === 'host') {
      return { role: 'host' };
    }
    if (Number.isInteger(socket.data.playerNumber)) {
      return { role: 'player', playerNumber: socket.data.playerNumber };
    }
    return {};
  }

  function emitGameState(requestId) {
    if (!gameState) {
      return;
    }

    const publicPayload = createPublicSnapshot(gameState);
    const hostPayload = createHostSnapshot(gameState);
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.role === 'host' || Number.isInteger(socket.data.playerNumber)) {
        socket.emit(MESSAGE_EVENT, createEnvelope(
          'game:state:public',
          requestId,
          socket.data.role === 'host' ? hostPayload : publicPayload,
        ));
      }
    }
    for (const socket of io.sockets.sockets.values()) {
      if (Number.isInteger(socket.data.playerNumber)) {
        socket.emit(MESSAGE_EVENT, createEnvelope(
          'game:state:private',
          requestId,
          createPrivateSnapshot(gameState, { role: 'player', playerNumber: socket.data.playerNumber }),
        ));
      }
    }
  }

  function getJoinUrl() {
    const address = options.lanAddress || findLanIPv4(options.networkInterfaces);
    const boundAddress = httpServer.address();
    const port = boundAddress && typeof boundAddress === 'object' ? boundAddress.port : null;

    if (!address || !port) {
      return null;
    }

    return createPlayerJoinUrl({ address, port });
  }

  function emitPublicRoomState(requestId = null) {
    const payload = roomCommands.getState ? roomCommands.getPublicState() : createInitialRoomState();
    if (payload.roomCode) {
      payload.joinUrl = getJoinUrl();
    }
    io.emit(MESSAGE_EVENT, createEnvelope(ROOM_STATE, requestId, payload));
  }

  function emitRejected(socket, requestId, type, error) {
    const payload = error instanceof RoomCommandError || error?.code
      ? { code: error.code, message: error.message }
      : { code: 'invalid-command', message: '無法處理此操作。' };
    if (!(error instanceof RoomCommandError)) {
      payload.rejectedType = type;
    }
    socket.emit(MESSAGE_EVENT, createEnvelope(ERROR_REJECTED, requestId, payload));
  }

  function handleCommand(socket, envelope) {
    const requestId = envelope && Object.prototype.hasOwnProperty.call(envelope, 'requestId')
      ? envelope.requestId
      : null;
    const payload = envelope && envelope.payload && typeof envelope.payload === 'object'
      ? envelope.payload
      : {};

    try {
      if (envelope && envelope.type === 'room:create') {
        const state = roomCommands.createRoom(payload.targetPlayerCount);
        socket.data.role = 'host';
        state.joinUrl = getJoinUrl();
        io.emit(MESSAGE_EVENT, createEnvelope(ROOM_STATE, requestId, state));
        return;
      }

      if (envelope && envelope.type === 'room:join') {
        const identity = roomCommands.join(socket.id);
        socket.data.playerNumber = identity.player.playerNumber;
        socket.emit(MESSAGE_EVENT, createEnvelope('player:identity', requestId, identity));
        emitPublicRoomState();
        syncGameState();
        if (gameState) {
          emitGameState(requestId);
        }
        return;
      }

      if (envelope && envelope.type === 'room:reconnect') {
        const identity = roomCommands.reconnect(payload.token, socket.id);
        if (!identity) {
          throw new RoomCommandError('invalid-reconnect-token', '重連資訊無效或已逾時。');
        }
        socket.data.playerNumber = identity.player.playerNumber;
        if (gameState) {
          gameState = markPlayerReconnected(gameState, identity.player.playerNumber);
          gameState.revision += 1;
        }
        socket.emit(MESSAGE_EVENT, createEnvelope('player:identity', requestId, identity));
        emitPublicRoomState();
        if (gameState) {
          emitGameState(requestId);
        }
        return;
      }

      if (envelope && envelope.type === 'game:command') {
        syncGameState();
        if (!gameRouter) {
          throw new RoomCommandError('game-not-started', '遊戲尚未開始。');
        }
        const gameCommand = { ...(payload || {}), requestId };
        const result = gameRouter.dispatch(gameCommand, actorForSocket(socket));
        if (!result.ok) {
          emitRejected(socket, requestId, envelope.type, result.error);
          return;
        }
        emitGameState(requestId);
        return;
      }

      const rejectedType = envelope && Object.prototype.hasOwnProperty.call(envelope, 'type')
        ? envelope.type
        : null;
      socket.emit(MESSAGE_EVENT, createEnvelope(ERROR_REJECTED, requestId, {
        code: 'unknown-command',
        rejectedType,
      }));
    } catch (error) {
      emitRejected(socket, requestId, envelope && envelope.type, error);
    }
  }

  io.on('connection', (socket) => {
    const state = roomCommands.getState ? (() => {
      try {
        return roomCommands.getPublicState();
      } catch (error) {
        return createInitialRoomState();
      }
    })() : createInitialRoomState();
    socket.emit(MESSAGE_EVENT, createEnvelope(ROOM_STATE, null, state));

    socket.on(MESSAGE_EVENT, (envelope) => handleCommand(socket, envelope));
    socket.on('disconnect', () => {
      try {
        const playerNumber = socket.data.playerNumber;
        if (roomCommands.disconnect(socket.id)) {
          if (gameState && roomCommands.getState().started && Number.isInteger(playerNumber)) {
            gameState = pauseForDisconnect(gameState, playerNumber);
            const player = gameState.players.find((entry) => entry.playerNumber === playerNumber);
            if (player) {
              player.connected = false;
              player.controlState = 'disconnected';
            }
            gameState.revision += 1;
            emitGameState(null);
          }
          emitPublicRoomState();
        }
      } catch (error) {
        // 未建立房間時，斷線不需要額外處理。
      }
    });
  });

  return io;
}

function closeSocketServer(io) {
  if (!io) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    io.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

module.exports = {
  closeSocketServer,
  createInitialRoomState,
  createSocketServer,
};
