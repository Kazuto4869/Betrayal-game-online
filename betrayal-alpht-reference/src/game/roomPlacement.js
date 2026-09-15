const { CARDINAL_SIDES } = require('../data/rooms');
const { cloneMapState } = require('./mapState');

const SIDE_OFFSETS = Object.freeze({
  north: Object.freeze({ x: 0, y: -1 }),
  east: Object.freeze({ x: 1, y: 0 }),
  south: Object.freeze({ x: 0, y: 1 }),
  west: Object.freeze({ x: -1, y: 0 }),
});

function normalizeRotation(rotation) {
  if (!Number.isInteger(rotation) || rotation % 90 !== 0) {
    return null;
  }
  return ((rotation % 360) + 360) % 360;
}

function rotateSide(side, rotation) {
  const normalized = normalizeRotation(rotation);
  const index = CARDINAL_SIDES.indexOf(side);
  if (normalized === null || index === -1) {
    throw new Error('Invalid cardinal side or rotation');
  }
  return CARDINAL_SIDES[(index + (normalized / 90)) % CARDINAL_SIDES.length];
}

function oppositeSide(side) {
  return CARDINAL_SIDES[(CARDINAL_SIDES.indexOf(side) + 2) % CARDINAL_SIDES.length];
}

function positionKey(position) {
  return `${position.x},${position.y}`;
}

function tileAt(map, position) {
  return map.tiles.find((tile) => tile.position.x === position.x && tile.position.y === position.y) || null;
}

function tileDoors(room, rotation) {
  return room.doors.map((door) => ({
    side: rotateSide(door.side, rotation),
    type: door.type,
  }));
}

function hasSpecialConnection(room, targetFloor) {
  return room.specialConnections.some((connection) => connection.targetFloor === targetFloor);
}

function canConnect(room, rotation, map, position) {
  const adjacent = [];
  for (const side of CARDINAL_SIDES) {
    const offset = SIDE_OFFSETS[side];
    const neighbor = tileAt(map, {
      x: position.x + offset.x,
      y: position.y + offset.y,
    });
    if (neighbor) {
      adjacent.push({ side, neighbor });
    }
  }

  if (adjacent.length === 0) {
    return map.tiles.length === 0;
  }

  const candidateDoors = tileDoors(room, rotation);
  return adjacent.every(({ side, neighbor }) => {
    if (hasSpecialConnection(room, neighbor.floor) && hasSpecialConnection(neighbor, room.floor)) {
      return true;
    }
    const candidateDoor = candidateDoors.find((door) => door.side === side);
    const neighborDoor = neighbor.doors.find((door) => door.side === oppositeSide(side));
    return Boolean(candidateDoor && neighborDoor && candidateDoor.type === neighborDoor.type);
  }) && adjacent.every(({ neighbor }) => (
    neighbor.floor === room.floor
    || (hasSpecialConnection(room, neighbor.floor) && hasSpecialConnection(neighbor, room.floor))
  ));
}

function getLegalPlacements(map, room) {
  const positions = map.tiles.length === 0
    ? [{ x: 0, y: 0 }]
    : map.tiles.flatMap((tile) => CARDINAL_SIDES.map((side) => {
      const offset = SIDE_OFFSETS[side];
      return { x: tile.position.x + offset.x, y: tile.position.y + offset.y };
    }));
  const uniquePositions = [...new Map(positions.map((position) => [positionKey(position), position])).values()]
    .filter((position) => !tileAt(map, position));
  const placements = [];

  for (const position of uniquePositions) {
    for (const rotation of [0, 90, 180, 270]) {
      if (canConnect(room, rotation, map, position)) {
        const connections = CARDINAL_SIDES.flatMap((side) => {
          const offset = SIDE_OFFSETS[side];
          const neighbor = tileAt(map, {
            x: position.x + offset.x,
            y: position.y + offset.y,
          });
          if (!neighbor) {
            return [];
          }
          const candidateDoor = tileDoors(room, rotation).find((door) => door.side === side);
          const neighborDoor = neighbor.doors.find((door) => door.side === oppositeSide(side));
          const stairs = hasSpecialConnection(room, neighbor.floor)
            && hasSpecialConnection(neighbor, room.floor);
          return stairs
            ? [{ from: neighbor.id, to: room.id, type: 'stairs' }]
            : candidateDoor && neighborDoor && candidateDoor.type === neighborDoor.type
              ? [{ from: neighbor.id, to: room.id, type: candidateDoor.type }]
              : [];
        });
        placements.push({ position, rotation, connections });
      }
    }
  }

  return placements;
}

function placementError(message) {
  const error = new Error(message);
  error.code = 'illegal-placement';
  return error;
}

function placeRoom(map, room, placement) {
  const legal = getLegalPlacements(map, room).find((candidate) => (
    candidate.position.x === placement.position.x
    && candidate.position.y === placement.position.y
    && candidate.rotation === placement.rotation
  ));
  if (!legal) {
    throw placementError('Room placement is not legal');
  }

  const next = cloneMapState(map);
  next.tiles.push({
    id: room.id,
    floor: room.floor,
    icons: [...room.icons],
    doors: tileDoors(room, placement.rotation),
    specialConnections: room.specialConnections.map((connection) => ({ ...connection })),
    rotation: placement.rotation,
    position: { ...placement.position },
  });
  next.connections.push(...legal.connections);
  next.explored.push(room.id);
  next.roomDeck = next.roomDeck.filter((roomId) => roomId !== room.id);
  return next;
}

function getFirstLegalRoomPlacements(map, definitions) {
  const byId = new Map(definitions.map((room) => [room.id, room]));
  const inspected = cloneMapState(map);
  if (!Array.isArray(inspected.roomDeck)) {
    inspected.roomDeck = [];
  }
  while (inspected.roomDeck.length > 0) {
    const roomId = inspected.roomDeck.shift();
    const room = byId.get(roomId);
    if (!room) {
      continue;
    }
    const placements = getLegalPlacements(inspected, room);
    if (placements.length > 0) {
      return placements.map((placement) => ({
        position: { ...placement.position },
        rotation: placement.rotation,
      }));
    }
  }
  return [];
}

function drawFirstLegalRoom(map, definitions, requestedPlacement = null) {
  const byId = new Map(definitions.map((room) => [room.id, room]));
  let inspected = cloneMapState(map);

  while (inspected.roomDeck.length > 0) {
    const roomId = inspected.roomDeck.shift();
    const room = byId.get(roomId);
    if (!room) {
      continue;
    }
    const placements = getLegalPlacements(inspected, room);
    const atRequestedPosition = requestedPlacement
      ? placements.filter((placement) => (
        placement.position.x === requestedPlacement.position.x
        && placement.position.y === requestedPlacement.position.y
      ))
      : placements;
    if (requestedPlacement && atRequestedPosition.length > 0) {
      const selected = atRequestedPosition.find((placement) => placement.rotation === requestedPlacement.rotation);
      if (!selected) {
        throw placementError('illegal-placement', 'Room rotation is not legal');
      }
      const placed = placeRoom(inspected, room, selected);
      return { map: placed, roomId, placement: selected };
    }
    if (requestedPlacement) {
      continue;
    }
    if (placements.length === 0) {
      continue;
    }
    const placement = placements[0];
    const placed = placeRoom(inspected, room, placement);
    return { map: placed, roomId, placement };
  }

  throw placementError('No legal room remains in deck');
}

module.exports = {
  drawFirstLegalRoom,
  getFirstLegalRoomPlacements,
  getLegalPlacements,
  placeRoom,
  rotateSide,
};
