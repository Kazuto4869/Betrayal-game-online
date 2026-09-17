/**
 * The movement graph: adjacency, reachability, and the turn's movement
 * budget. See docs/02-rules-model.md#movement-graph and #24-turn-structure,
 * and docs/04-data-model.md#static-links for what a `StaticLink` means.
 */

import {
  DIR_ORDER,
  OPPOSITE,
  cellKey,
  neighbourCell,
  rotateDoors,
  type Dir,
  type Floor,
  type GameState,
  type PlacedId,
  type PlacedTile,
  type PlayerState,
  type Rotation,
  type SeatId,
  type Trait,
} from '@bahoth/shared';
import type { Content, Tile } from '@bahoth/content';
import { traitValue } from './selectors.js';

/**
 * Rotate a direction clockwise by `rotation` degrees (0, 90, 180, 270).
 */
export function rotateDir(dir: Dir, rotation: Rotation): Dir {
  const steps = (rotation / 90) % 4;
  const idx = DIR_ORDER.indexOf(dir);
  return DIR_ORDER[(idx + steps) % 4]!;
}

/**
 * Returns the orthogonal grid direction from `fromPlaced` to `toPlaced`,
 * or null if they are not grid-adjacent on the same floor.
 */
export function getStepDirection(
  fromPlaced: PlacedTile,
  toPlaced: PlacedTile,
): Dir | null {
  if (fromPlaced.floor !== toPlaced.floor) return null;
  const dx = toPlaced.x - fromPlaced.x;
  const dy = toPlaced.y - fromPlaced.y;
  if (dx === 0 && dy === -1) return 'n';
  if (dx === 1 && dy === 0) return 'e';
  if (dx === 0 && dy === 1) return 's';
  if (dx === -1 && dy === 0) return 'w';
  return null;
}

export interface CrossingBarrier {
  fromTileDef: Tile;
  trait: Trait;
  threshold: number;
}

/**
 * Checks if moving from `from` to `to` crosses a barrier in `from`.
 * Returning through the doorway used to enter does NOT require a roll.
 * Crossing to the opposite doorway requires rolling the specified trait.
 */
export function getCrossingBarrier(
  state: GameState,
  seat: SeatId,
  from: PlacedId,
  to: PlacedId,
  cameFrom: PlacedId | null,
  content: Content,
): CrossingBarrier | null {
  const fromPlaced = state.board.placed[from];
  const toPlaced = state.board.placed[to];
  if (!fromPlaced || !toPlaced) return null;

  const fromTileDef = content.tilesById[fromPlaced.tileId];
  if (!fromTileDef || !fromTileDef.crossing) return null;

  const exitDir = getStepDirection(fromPlaced, toPlaced);
  if (!exitDir) return null;

  const crossing = fromTileDef.crossing;
  if (!crossing.sides) return null;
  const sideA = rotateDir(crossing.sides[0], fromPlaced.rotation);
  const sideB = rotateDir(crossing.sides[1], fromPlaced.rotation);

  if (exitDir !== sideA && exitDir !== sideB) {
    return null;
  }

  const player = state.players[seat];
  let entryDir: Dir | null = null;
  if (cameFrom) {
    const cameFromPlaced = state.board.placed[cameFrom];
    if (cameFromPlaced) {
      entryDir = getStepDirection(fromPlaced, cameFromPlaced);
    }
  }
  if (!entryDir && player) {
    const flag = player.flags[`barrier_side:${from}`];
    if (flag === 'n' || flag === 'e' || flag === 's' || flag === 'w') {
      entryDir = flag;
    }
  }

  // Returning through the entry doorway does not require a roll
  if (entryDir && exitDir === entryDir) {
    return null;
  }

  return {
    fromTileDef,
    trait: crossing.trait,
    threshold: crossing.threshold,
  };
}

/**
 * The placed tile that is `floor`'s landing, or null if it has not been
 * placed yet. Every floor has a landing declared in content
 * (`assertHouseCoherent`), but the landing tile itself is pre-placed by
 * `house.layout`, so this never needs to search the draw deck.
 */
function landingPlacedId(
  state: GameState,
  content: Content,
  floor: Floor,
): PlacedId | null {
  const landingTileId = content.house.landings[floor];
  for (const [id, tile] of Object.entries(state.board.placed)) {
    if (tile.tileId === landingTileId) return id;
  }
  return null;
}

/**
 * Every room `from` connects to right now, in a stable order: grid neighbours
 * in `DIR_ORDER` first, then static-link targets in declaration/placement
 * order, deduplicated. Determinism here is load-bearing — `property.test.ts`
 * asserts byte-identical replay, and this function is walked on every MOVE.
 */
export function getConnections(
  state: GameState,
  from: PlacedId,
  content: Content,
): PlacedId[] {
  const tile = state.board.placed[from];
  if (!tile) return [];
  const tileDef = content.tilesById[tile.tileId];

  const out: PlacedId[] = [];
  const seen = new Set<PlacedId>();
  // Never connect a tile to itself (D-c).
  const add = (id: PlacedId): void => {
    if (id === from || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };

  if (tileDef) {
    // 1. Grid adjacency: both edges need a door, after each tile's own
    //    rotation (docs/02-rules-model.md#movement-graph, rule 1).
    const doors = rotateDoors(tileDef.doors, tile.rotation);
    for (const dir of DIR_ORDER) {
      if (!doors[dir]) continue;
      const [nx, ny] = neighbourCell(tile.x, tile.y, dir);
      const neighbourId = state.board.index[tile.floor][cellKey(nx, ny)];
      if (!neighbourId) continue;
      const neighbour = state.board.placed[neighbourId];
      const neighbourDef = neighbour && content.tilesById[neighbour.tileId];
      if (!neighbour || !neighbourDef) continue;
      const neighbourDoors = rotateDoors(neighbourDef.doors, neighbour.rotation);
      if (neighbourDoors[OPPOSITE[dir]]) add(neighbourId);
    }

    // 2. This tile's own static links, forward direction — always active
    //    regardless of `twoWay` (docs/04-data-model.md#static-links).
    for (const link of tileDef.staticLinks) {
      if (link.kind === 'to_tile') {
        for (const [id, other] of Object.entries(state.board.placed)) {
          if (other.tileId === link.target) add(id);
        }
      } else if (link.kind === 'to_floor' || link.kind === 'oneway_drop') {
        const landing = landingPlacedId(state, content, link.floor);
        if (landing) add(landing);
      }
    }
  }

  // 3. Other placed tiles whose `twoWay` link points back at `from`. `twoWay`
  //    describes the link, not the pair, so the reverse direction is found by
  //    scanning rather than by a declaration on this tile (D-c).
  for (const [id, other] of Object.entries(state.board.placed)) {
    if (id === from) continue;
    const otherDef = content.tilesById[other.tileId];
    if (!otherDef) continue;
    for (const link of otherDef.staticLinks) {
      if (link.kind === 'to_tile' && link.twoWay && link.target === tile.tileId) {
        add(id);
      } else if (
        link.kind === 'to_floor' &&
        link.twoWay &&
        link.landing === tile.tileId
      ) {
        add(id);
      }
    }
  }

  return out;
}

/**
 * A node in the BFS's actual state space: not just a room, but the room plus
 * how it was entered. Two visits to the same room with different `cameFrom`
 * are different states, because they forbid different next steps.
 */
interface StateKey {
  pos: PlacedId;
  cameFrom: PlacedId | null;
}

const stateKey = (pos: PlacedId, cameFrom: PlacedId | null): string =>
  `${pos}|${cameFrom ?? ''}`;

interface WalkResult {
  /** The seat's current location, or null if it cannot move at all. */
  start: PlacedId | null;
  /** The root state the BFS started from — `{ start, player.cameFrom }`. */
  root: StateKey | null;
  /**
   * The first (minimal-depth) BFS state that discovered each reachable room,
   * keyed by that room's id. This — not `predState` — is what `getReachable`
   * returns and what `findPath` starts reconstructing from: a room can be
   * discovered by several states along the way, and only the shortest one
   * should ever surface. The seat's own location is deliberately never a key
   * (D-d): it is where you are, not somewhere `MOVE` can take you.
   */
  firstState: Map<PlacedId, StateKey>;
  /**
   * Predecessor state for every BFS state visited, keyed by that state's own
   * key (`pos|cameFrom`), not by `pos` alone.
   *
   * Keying by position alone was the defect: when the BFS loops back through
   * `start` (a room may be walked through, just never landed on), it
   * re-explores start's neighbours from a *different* `cameFrom` than the
   * player's real one. A position-keyed map records whichever of those
   * discoveries happened to run last as "the" predecessor, and if that
   * happened to be the direct-from-start discovery, `findPath` reconstructed
   * a one-step path straight back into the room the player just left — the
   * no-backtrack rule silently defeated, and `move()` charging 1 point for a
   * path that was actually the long way round. Keying by state means each
   * loop through `start` is its own predecessor chain, so reconstruction
   * cannot cross into a different visit's history.
   */
  predState: Map<string, StateKey>;
}

/**
 * BFS over (position, cameFrom) rather than position alone, because the
 * no-backtrack rule makes which room you may not re-enter depend on how you
 * got to the current room (docs/02-rules-model.md#24, the [RULING] on
 * backtracking). `getReachable` and `findPath` both call this so they can
 * never disagree.
 */
function walk(state: GameState, seat: SeatId, content: Content): WalkResult {
  const player = state.players[seat];
  const firstState = new Map<PlacedId, StateKey>();
  const predState = new Map<string, StateKey>();
  if (!player || player.isDead || player.removed || player.location === null) {
    return { start: null, root: null, firstState, predState };
  }
  const budget = player.movesLeft;
  if (budget <= 0) return { start: null, root: null, firstState, predState };

  const start = player.location;
  const root: StateKey = { pos: start, cameFrom: player.cameFrom };
  type QueueEntry = { pos: PlacedId; cameFrom: PlacedId | null; depth: number };
  const queue: QueueEntry[] = [{ pos: start, cameFrom: player.cameFrom, depth: 0 }];
  const visited = new Set<string>([stateKey(start, player.cameFrom)]);

  let head = 0;
  while (head < queue.length) {
    const entry = queue[head++]!;
    if (entry.depth >= budget) continue;

    for (const nb of getConnections(state, entry.pos, content)) {
      // No immediate backtrack into the room just left, except in barrier rooms
      // where returning through the entry doorway is explicitly allowed without roll.
      const tile = state.board.placed[entry.pos];
      const currentTile = tile ? content.tilesById[tile.tileId] : undefined;
      const isBarrier = Boolean(currentTile?.crossing);
      if (nb === entry.cameFrom && !isBarrier) continue;

      const key = stateKey(nb, entry.pos);
      if (visited.has(key)) continue;
      visited.add(key);
      predState.set(key, { pos: entry.pos, cameFrom: entry.cameFrom });
      queue.push({ pos: nb, cameFrom: entry.pos, depth: entry.depth + 1 });

      // The current location is never a destination, even reached by a loop
      // — but it may still be walked *through* on the way to somewhere else.
      // First-discovery only: a room found again later, by a longer route,
      // must not displace the shortest one already on record.
      if (nb !== start && !firstState.has(nb)) {
        firstState.set(nb, { pos: nb, cameFrom: entry.pos });
      }
    }
  }

  return { start, root, firstState, predState };
}

/** Every room the seat may issue `MOVE { to }` for right now. */
export function getReachable(
  state: GameState,
  seat: SeatId,
  content: Content,
): PlacedId[] {
  return Array.from(walk(state, seat, content).firstState.keys());
}

/**
 * The shortest legal path to `to`, excluding the start and including `to`,
 * or null if `to` is not reachable this turn. Shares `walk` with
 * `getReachable` so the two can never disagree about what is reachable.
 */
export function findPath(
  state: GameState,
  seat: SeatId,
  to: PlacedId,
  content: Content,
): PlacedId[] | null {
  const { start, root, firstState, predState } = walk(state, seat, content);
  const dest = start && root ? firstState.get(to) : undefined;
  if (!start || !root || !dest) return null;

  // Walk the predecessor chain from `to`'s first-discovered state back to
  // the root. Stopping at `pos === start` is not enough — a loop through
  // `start` mid-path is a different state (different `cameFrom`) from the
  // root, and stopping there would drop it from the path (see `predState`'s
  // comment on `walk`). Only the root itself — matched by state, not just
  // position — ends the walk.
  const path: PlacedId[] = [];
  let cur: StateKey | undefined = dest;
  while (cur && (cur.pos !== root.pos || cur.cameFrom !== root.cameFrom)) {
    path.unshift(cur.pos);
    cur = predState.get(stateKey(cur.pos, cur.cameFrom));
  }
  return path;
}

/**
 * Reset a seat's movement budget to its current Speed and clear `cameFrom`
 * (docs/02-rules-model.md#24, step 1: "Movement budget is set to the current
 * Speed value"). Called from every place the active seat changes — see
 * D-f — so a missed call site cannot leave a seat silently unable to move.
 */
export function beginTurnFor(
  state: GameState,
  seat: SeatId,
  content: Content,
): GameState {
  const player = state.players[seat];
  if (!player) return state;
  const flags = { ...player.flags };
  delete flags['adrenaline_speed'];
  delete flags['dog_used_this_turn'];
  const nextPlayer: PlayerState = {
    ...player,
    flags,
    usedCardsThisTurn: [],
    cameFrom: null,
  };
  const nextState: GameState = {
    ...state,
    players: {
      ...state.players,
      [seat]: nextPlayer,
    },
  };
  return {
    ...nextState,
    players: {
      ...nextState.players,
      [seat]: {
        ...nextPlayer,
        movesLeft: traitValue(nextState, seat, 'speed', content),
      },
    },
  };
}

/**
 * Valid connections for Dog traversal:
 * - Normal door-to-door connections
 * - Two-way stairs
 * - Excludes oneway drops, mystic elevator, and roll barrier rooms (crossing / exit rolls)
 */
export function getDogConnections(
  state: GameState,
  from: PlacedId,
  content: Content,
): PlacedId[] {
  const tile = state.board.placed[from];
  if (!tile) return [];
  const tileDef = content.tilesById[tile.tileId];
  if (!tileDef) return [];

  if (tileDef.crossing || (tileDef.onExit && tileDef.onExit.length > 0)) {
    return [];
  }
  if (tile.tileId === 'tile.mystic_elevator') {
    return [];
  }

  const out: PlacedId[] = [];
  const seen = new Set<PlacedId>();
  const add = (id: PlacedId): void => {
    if (id === from || seen.has(id)) return;
    const dest = state.board.placed[id];
    if (!dest) return;
    const destDef = content.tilesById[dest.tileId];
    if (!destDef) return;
    if (dest.tileId === 'tile.mystic_elevator') return;
    seen.add(id);
    out.push(id);
  };

  const doors = rotateDoors(tileDef.doors, tile.rotation);
  for (const dir of DIR_ORDER) {
    if (!doors[dir]) continue;
    const [nx, ny] = neighbourCell(tile.x, tile.y, dir);
    const neighbourId = state.board.index[tile.floor][cellKey(nx, ny)];
    if (!neighbourId) continue;
    const neighbour = state.board.placed[neighbourId];
    const neighbourDef = neighbour && content.tilesById[neighbour.tileId];
    if (!neighbour || !neighbourDef) continue;
    const neighbourDoors = rotateDoors(neighbourDef.doors, neighbour.rotation);
    if (neighbourDoors[OPPOSITE[dir]]) add(neighbourId);
  }

  for (const link of tileDef.staticLinks) {
    if (link.kind === 'to_tile' && link.twoWay) {
      for (const [id, other] of Object.entries(state.board.placed)) {
        if (other.tileId === link.target) add(id);
      }
    } else if (link.kind === 'to_floor' && link.twoWay) {
      const landing = landingPlacedId(state, content, link.floor);
      if (landing) add(landing);
    }
  }

  for (const [id, other] of Object.entries(state.board.placed)) {
    if (id === from) continue;
    const otherDef = content.tilesById[other.tileId];
    if (!otherDef) continue;
    for (const link of otherDef.staticLinks) {
      if (link.kind === 'to_tile' && link.twoWay && link.target === tile.tileId) {
        add(id);
      } else if (
        link.kind === 'to_floor' &&
        link.twoWay &&
        link.landing === tile.tileId
      ) {
        add(id);
      }
    }
  }

  return out;
}

export function getDogReachableRooms(
  state: GameState,
  from: PlacedId,
  content: Content,
): PlacedId[] {
  const visited = new Map<PlacedId, number>();
  visited.set(from, 0);
  const queue: Array<{ pos: PlacedId; depth: number }> = [{ pos: from, depth: 0 }];

  let head = 0;
  while (head < queue.length) {
    const { pos, depth } = queue[head++]!;
    if (depth >= 6) continue;

    for (const nb of getDogConnections(state, pos, content)) {
      if (!visited.has(nb)) {
        visited.set(nb, depth + 1);
        queue.push({ pos: nb, depth: depth + 1 });
      }
    }
  }

  const result: PlacedId[] = [];
  for (const [id, depth] of visited.entries()) {
    if (id !== from && depth <= 6) {
      result.push(id);
    }
  }
  return result;
}

export function getDogPath(
  state: GameState,
  from: PlacedId,
  to: PlacedId,
  content: Content,
): PlacedId[] | null {
  if (from === to) return [];
  const pred = new Map<PlacedId, PlacedId>();
  const dist = new Map<PlacedId, number>();
  dist.set(from, 0);
  const queue: PlacedId[] = [from];

  let head = 0;
  while (head < queue.length) {
    const pos = queue[head++]!;
    const d = dist.get(pos)!;
    if (d >= 6) continue;

    for (const nb of getDogConnections(state, pos, content)) {
      if (!dist.has(nb)) {
        dist.set(nb, d + 1);
        pred.set(nb, pos);
        if (nb === to) {
          const path: PlacedId[] = [];
          let cur: PlacedId | undefined = to;
          while (cur && cur !== from) {
            path.unshift(cur);
            cur = pred.get(cur);
          }
          return path;
        }
        queue.push(nb);
      }
    }
  }
  return null;
}

/**
 * Leaving a room containing opponents (heroes) costs +1 movement per hero.
 */
export function getMonsterLeaveCost(state: GameState, from: PlacedId): number {
  const heroesInRoom = Object.values(state.players).filter(
    (p) => !p.isDead && !p.removed && !p.isTraitor && p.location === from,
  ).length;
  return 1 + heroesInRoom;
}

export function getMonsterConnections(
  state: GameState,
  from: PlacedId,
  content: Content,
): PlacedId[] {
  return getConnections(state, from, content);
}

export function getMonsterReachable(
  state: GameState,
  monsterLoc: PlacedId,
  movesLeft: number,
  content: Content,
): PlacedId[] {
  if (movesLeft <= 0) return [];
  const cost = getMonsterLeaveCost(state, monsterLoc);
  if (movesLeft < cost) return [];
  return getMonsterConnections(state, monsterLoc, content);
}
