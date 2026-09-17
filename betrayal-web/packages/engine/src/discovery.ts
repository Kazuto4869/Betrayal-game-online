/**
 * Pure discovery mechanics: which rotations a drawn tile could land at, and
 * which tile comes off the deck. No reducer plumbing here — `reduce.ts` is
 * the only place that touches `GameState.pending` or emits events; this file
 * just answers questions about tiles and decks so that code can stay thin.
 * See docs/05-engine.md#56 (the worked example this implements steps 2-3 of)
 * and docs/02-rules-model.md#24 step 3, including its [RULING] on the draw.
 */

import {
  cellKey,
  neighbourCell,
  rotateDoors,
  DIR_ORDER,
  ROTATIONS,
  type Dir,
  type Doors,
  type Floor,
  type GameState,
  type BoardState,
  type RngState,
  type Rotation,
  type SeatId,
  type TileId,
} from '@bahoth/shared';
import type { Content, Tile } from '@bahoth/content';
import { shuffle } from './rng.js';

/**
 * Rotations that put a door on `entry`, deduplicated by effective doors.
 *
 * A tile with doors on all four sides has four "legal" rotations that are
 * the same room. Prompting for a choice with no effect is worse than not
 * prompting; deduping is also what makes auto-apply (docs/09-roadmap.md open
 * question 7) fire on exactly the symmetric tiles it should.
 *
 * A tile always has at least one door (`assertTilesCoherent` rejects one with
 * none), so the result is never empty for any `entry`.
 */
export function legalRotations(tile: Tile, entry: Dir): Rotation[] {
  const out: Rotation[] = [];
  const seen = new Set<string>();
  for (const r of ROTATIONS) {
    const doors = rotateDoors(tile.doors, r);
    if (!doors[entry]) continue;
    const key = DIR_ORDER.map((d) => (doors[d] ? '1' : '0')).join('');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export interface TileDraw {
  tileId: TileId;
  deck: TileId[];
  discard: TileId[];
  rng: RngState;
}

/**
 * Draw the top tile legal on `floor`, following the official 2E shared-stack rule:
 * 1. Inspect tiles from the top of the live `deck`.
 * 2. Incompatible tiles are set aside face-down in `discard`.
 * 3. The first compatible tile is returned without burning RNG.
 * 4. When the live stack is exhausted, if any set-aside tiles are eligible for `floor`,
 *    shuffle `discard` deterministically with `rng` to form the new live deck and draw from it.
 * 5. If no tile in deck or discard is eligible for `floor`, return null.
 */
export function drawTile(
  deck: readonly TileId[],
  discardOrFloor: readonly TileId[] | Floor,
  floorOrContent: Floor | Content,
  contentOrRng?: Content | RngState,
  rngOpt?: RngState,
): TileDraw | null {
  let discard: readonly TileId[];
  let floor: Floor;
  let content: Content;
  let rng: RngState;

  if (Array.isArray(discardOrFloor)) {
    discard = discardOrFloor;
    floor = floorOrContent as Floor;
    content = contentOrRng as Content;
    rng = rngOpt!;
  } else {
    discard = [];
    floor = discardOrFloor as Floor;
    content = floorOrContent as Content;
    rng = contentOrRng as RngState;
  }

  // 1. Scan the live deck from the top
  const i = deck.findIndex((id) => content.tilesById[id]?.floors.includes(floor));
  if (i !== -1) {
    const tileId = deck[i]!;
    const passed = deck.slice(0, i);
    const rest = deck.slice(i + 1);
    return {
      tileId,
      deck: rest,
      discard: [...discard, ...passed],
      rng, // No RNG burned when drawing from current live stack!
    };
  }

  // 2. The live deck contains no tiles for this floor. All remaining cards in deck are passed over.
  const allDiscard = [...discard, ...deck];
  const eligibleInDiscard = allDiscard.filter((id) =>
    content.tilesById[id]?.floors.includes(floor),
  );
  if (eligibleInDiscard.length === 0) {
    // Truly exhausted: neither deck nor discard contains an eligible tile for this floor.
    return null;
  }

  // 3. Reshuffle the set-aside pile to form a new stack
  const [shuffled, nextRng] = shuffle(rng, allDiscard);
  const j = shuffled.findIndex((id) => content.tilesById[id]?.floors.includes(floor));
  const tileId = shuffled[j]!;
  const newPassed = shuffled.slice(0, j);
  const newRest = shuffled.slice(j + 1);

  return {
    tileId,
    deck: newRest,
    discard: newPassed,
    rng: nextRng,
  };
}

/**
 * Determines whether placing a tile at (x, y) on `floor` with `rotation`
 * would seal off the floor (i.e. leave zero open discoverable doorways on the floor).
 *
 * Official 2E Rulebook (page 9):
 * "You can’t place a tile in such a way that it seals off a floor (that is, leaves
 * no way to connect other rooms to that floor). If the only possible placement of a
 * tile would seal off a floor, discard that tile and draw new ones until you draw
 * one that leaves a free doorway."
 */
export function wouldSealFloor(
  board: BoardState,
  tileDef: Tile,
  rotation: Rotation,
  floor: Floor,
  x: number,
  y: number,
  content?: Content,
): boolean {
  const targetKey = cellKey(x, y);
  const placedOnFloor = Object.values(board.placed).filter((p) => p.floor === floor);

  // 1. Check if there are any other open doorways on this floor
  for (const placed of placedOnFloor) {
    const placedDef = content?.tilesById[placed.tileId];
    const baseDoors = (placed as unknown as { doors?: Doors }).doors ??
      placedDef?.doors ?? { n: false, e: false, s: false, w: false };
    const pDoors = rotateDoors(baseDoors, placed.rotation);
    for (const dir of DIR_ORDER) {
      if (!pDoors[dir]) continue;
      const [nx, ny] = neighbourCell(placed.x, placed.y, dir);
      const nKey = cellKey(nx, ny);
      if (nKey === targetKey) {
        // This doorway leads into the cell where the new tile is being placed.
        continue;
      }
      if (!board.index[floor][nKey]) {
        // There is an open doorway elsewhere on this floor that remains open!
        return false;
      }
    }
  }

  // 2. If there are NO other open doorways on this floor, this is the floor's last open doorway.
  // The newly placed tile must have at least one door pointing to an unoccupied cell.
  const newDoors = rotateDoors(tileDef.doors, rotation);
  for (const dir of DIR_ORDER) {
    if (!newDoors[dir]) continue;
    const [nx, ny] = neighbourCell(x, y, dir);
    if (!board.index[floor][cellKey(nx, ny)]) {
      // The new tile provides an open doorway to an unoccupied space!
      return false;
    }
  }

  // The new tile provides no open doorways to unoccupied spaces, sealing the floor.
  return true;
}

/**
 * Can any tile still in the deck be built on `floor`?
 *
 * Deliberately NOT `drawTile(state.tileDeck, floor, content, rng) !== null`.
 * `state.tileDeck` is redacted to `[]` (docs/06-networking.md#64: "Tile deck
 * order — same treatment"), and the client evaluates legality on the
 * redacted snapshot — docs/05-engine.md#57 is explicit that there is one
 * legality function on both sides, not a server version and a client
 * version. Reading `state.tileDeck` directly would be correct on the server
 * and permanently empty on the client, which would make every doorway arrow
 * dead forever.
 *
 * The deck's ORDER is hidden (that is what redaction protects), but its
 * COMPOSITION is not: the tile list is public content, the board is public,
 * and "what's left in the deck" is exactly "every printed copy minus what
 * has already been placed" — arithmetic anyone at a real table could do by
 * counting. `content.deckTiles` never contains a pre-placed tile
 * (`buildTileDeck` excludes them), so counting a deck id's occurrences in
 * `board.placed` is an exact count of how many copies are gone.
 */
export function canDiscoverOn(state: GameState, floor: Floor, content: Content): boolean {
  const placedCounts = new Map<TileId, number>();
  for (const tile of Object.values(state.board.placed)) {
    placedCounts.set(tile.tileId, (placedCounts.get(tile.tileId) ?? 0) + 1);
  }

  const remaining = new Map<TileId, number>();
  for (const id of content.deckTiles) {
    remaining.set(id, (remaining.get(id) ?? 0) + 1);
  }

  for (const [id, copies] of remaining) {
    if (copies - (placedCounts.get(id) ?? 0) <= 0) continue;
    if (content.tilesById[id]?.floors.includes(floor)) return true;
  }
  return false;
}

/** Directions the seat could `MOVE_THROUGH` right now. */
export function getOpenDoorways(state: GameState, seat: SeatId, content: Content): Dir[] {
  const player = state.players[seat];
  if (!player || player.isDead || player.removed || player.location === null) return [];
  if (player.movesLeft <= 0) return [];

  const location = state.board.placed[player.location];
  const tileDef = location && content.tilesById[location.tileId];
  if (!location || !tileDef) return [];

  const doors = rotateDoors(tileDef.doors, location.rotation);

  const out: Dir[] = [];
  for (const dir of DIR_ORDER) {
    if (!doors[dir]) continue;
    const [nx, ny] = neighbourCell(location.x, location.y, dir);
    if (state.board.index[location.floor][cellKey(nx, ny)]) continue;
    // Once nothing left in the deck can be built on this floor, the arrow
    // must go away: getLegalActions feeds property.test.ts straight into
    // reduce, and an offered action that reduce rejects fails that test.
    if (!canDiscoverOn(state, location.floor, content)) continue;
    out.push(dir);
  }
  return out;
}
