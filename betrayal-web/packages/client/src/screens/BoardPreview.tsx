/**
 * Dev-only board preview (docs/07-ui.md#73-board-rendering).
 *
 * The movement graph now exists (`getReachable`, wired in Game.tsx), so this
 * screen is no longer standing in for one. It stays because it renders with
 * no server and no engine at all — a plain BoardState built by hand — which
 * is worth having for pure rendering work: tile size, floor tints, rotation,
 * and door notches can be judged without creating a room. The fixture's five
 * starting tiles plus enough extra placements touch all three floors, both a
 * rotated tile and an open doorway, and all three card symbols.
 *
 * `buildPreviewBoard` is exported separately from the component so
 * layout.test.ts can assert its doors actually meet their neighbours
 * (see "the BoardPreview board" in that file) without importing React.
 */

import { useMemo, useState } from 'react';
import type {
  BoardState,
  Colour,
  Floor,
  PlacedId,
  PlacedTile,
  Rotation,
} from '@bahoth/shared';
import { FLOORS, ROTATIONS, cellKey, placedIdFor } from '@bahoth/shared';
import type { Dir } from '@bahoth/shared';
import type { Content } from '@bahoth/content';
import { fixtureContent } from '@bahoth/content';
import { Board } from '../board/Board.js';
import type { Pawn } from '../board/Board.js';
import { FloorTabs } from '../board/FloorTabs.js';
import { openDoorways, tileViewsForFloor } from '../board/layout.js';

/**
 * A hand-placed tile. Its PlacedId is minted the same way the engine mints
 * one — `placedIdFor(floor, x, y)` — rather than the tile id standing in for
 * it. Invariant 3b (packages/engine/src/invariants.ts) requires exactly that
 * agreement, and nothing here reaches the engine to catch a drift by itself.
 */
interface Placement {
  tileId: string;
  floor: Floor;
  x: number;
  y: number;
  rotation: Rotation;
}

/**
 * Extra placements beyond the fixture's starting layout (entrance hall,
 * foyer, grand staircase, and the two landings). Every door here has been
 * checked by hand against rotateDoors so it meets the neighbour it faces —
 * see the comment on each tile. layout.test.ts re-checks this mechanically
 * so it cannot silently rot as the fixture content changes.
 */
const EXTRA_PLACEMENTS: readonly Placement[] = [
  // North of the foyer's east door (true) — ballroom has all four doors and event symbol.
  { tileId: 'tile.ballroom', floor: 'ground', x: 1, y: 1, rotation: 0 },

  // North of the basement landing's north door (true) — crypt prints n only, so
  // rotating 180 gives south door meeting the landing.
  { tileId: 'tile.crypt', floor: 'basement', x: 0, y: -1, rotation: 180 },
  // East of the landing's east door (true) — servants_quarters has all four doors, omen symbol.
  { tileId: 'tile.servants_quarters', floor: 'basement', x: 1, y: 0, rotation: 0 },
  // West of the landing's west door (true) — wine_cellar prints n+s doors,
  // rotating 90 turns that pair into e+w: e meets the landing, w is left open. Item symbol.
  { tileId: 'tile.wine_cellar', floor: 'basement', x: -1, y: 0, rotation: 90 },

  // North of the upper landing's north door (true) — gallery prints n+s doors,
  // bare south door meets the landing. Also omen symbol.
  { tileId: 'tile.gallery', floor: 'upper', x: 0, y: -1, rotation: 0 },
  // East of the landing's east door (true) — master_bedroom prints n+w doors,
  // west door meets the landing.
  { tileId: 'tile.master_bedroom', floor: 'upper', x: 1, y: 0, rotation: 0 },
];

export function buildPreviewBoard(content: Content): BoardState {
  const placements: Placement[] = [
    ...content.house.layout.map((p) => ({
      tileId: p.tileId,
      floor: p.floor,
      x: p.x,
      y: p.y,
      rotation: p.rotation,
    })),
    ...EXTRA_PLACEMENTS,
  ];

  const placed: Record<string, PlacedTile> = {};
  const index: BoardState['index'] = { basement: {}, ground: {}, upper: {} };
  for (const p of placements) {
    const id = placedIdFor(p.floor, p.x, p.y);
    placed[id] = {
      id,
      tileId: p.tileId,
      floor: p.floor,
      x: p.x,
      y: p.y,
      rotation: p.rotation,
      discoveredBy: null,
      flags: {},
    };
    index[p.floor][cellKey(p.x, p.y)] = id;
  }
  return { placed, index };
}

/**
 * A few pawns scattered around the preview so fan-out and colour pairing are
 * visible. Keyed by tileId, not by the derived PlacedId string — resolved
 * against the actual placements below, so a coordinate change in
 * EXTRA_PLACEMENTS cannot silently orphan a pawn onto an id nobody placed.
 */
const PREVIEW_PAWNS: ReadonlyArray<{
  tileId: string;
  colour: Colour;
  initial: string;
  isMe: boolean;
}> = [
  { tileId: 'tile.entrance_hall', colour: 'red', initial: 'O', isMe: true },
  { tileId: 'tile.entrance_hall', colour: 'blue', initial: 'V', isMe: false },
  { tileId: 'tile.foyer', colour: 'yellow', initial: 'M', isMe: false },
];

/**
 * Stand-in for `getReachable` — this screen has no engine to ask. Keyed by
 * tileId for the same reason as PREVIEW_PAWNS above; resolved to real
 * PlacedIds against the board this preview actually built.
 */
const PREVIEW_REACHABLE: Record<Floor, readonly string[]> = {
  ground: ['tile.foyer', 'tile.mud_room'],
  basement: ['tile.root_cellar'],
  upper: ['tile.linen_press'],
};

/**
 * A stand-in `rotate_tile` prompt (docs/07-ui.md#73: "if a rotation prompt
 * is pending, it renders semi-transparent with rotate left/right buttons and
 * a confirm"). This screen has no engine and no `PendingPrompt`, so all four
 * rotations are offered rather than a real `legalRotations` — the point here
 * is judging the ghost tile and the panel's look, not discovery legality,
 * which `discovery.test.ts` and `reduce.test.ts` (packages/engine) already
 * cover. `x`/`y` sit one cell west of `tile.sunken_cistern`'s open west door
 * (see EXTRA_PLACEMENTS above), so the ghost lands somewhere already visible
 * on the basement floor rather than floating off in empty space.
 */
const DEMO_PROMPT = {
  tileId: 'tile.chasm',
  floor: 'basement' as Floor,
  x: -2,
  y: 0,
};

/** The placement for a given tile id, or undefined if this preview never placed one. */
function placementFor(board: BoardState, tileId: string): PlacedTile | undefined {
  return Object.values(board.placed).find((p) => p.tileId === tileId);
}

export function BoardPreview() {
  const content = fixtureContent();
  const [board] = useState(() => buildPreviewBoard(content));
  const [floor, setFloor] = useState<Floor>('ground');
  // Transient UI state for the rotate_tile demo below — same allowance
  // docs/07-ui.md#77 gives Game.tsx's own preview rotation.
  const [showPrompt, setShowPrompt] = useState(false);
  const [previewRotation, setPreviewRotation] = useState<Rotation>(0);
  const displayFloor = showPrompt ? DEMO_PROMPT.floor : floor;

  const pawnsByFloor = useMemo(() => {
    const byFloor: Record<Floor, Pawn[]> = { basement: [], ground: [], upper: [] };
    for (const pawn of PREVIEW_PAWNS) {
      const placement = placementFor(board, pawn.tileId);
      if (!placement) continue;
      byFloor[placement.floor].push({
        placedId: placement.id,
        colour: pawn.colour,
        initial: pawn.initial,
        isMe: pawn.isMe,
      });
    }
    return byFloor;
  }, [board]);

  const reachableByFloor = useMemo(() => {
    const byFloor: Record<Floor, PlacedId[]> = { basement: [], ground: [], upper: [] };
    for (const f of FLOORS) {
      for (const tileId of PREVIEW_REACHABLE[f]) {
        const placement = placementFor(board, tileId);
        if (placement) byFloor[f].push(placement.id);
      }
    }
    return byFloor;
  }, [board]);

  // A live doorway arrow to demo, on whichever floor is showing — the first
  // one `openDoorways` finds. Real liveness still comes from the same
  // function `Board`'s caller (Game.tsx) uses; this preview has no
  // getLegalActions to ask, so "the first open doorway" stands in for it.
  const demoMoveThrough = useMemo(() => {
    const views = tileViewsForFloor(board, content, displayFloor);
    const first = openDoorways(views)[0];
    if (!first) return undefined;
    return {
      from: first.placedId,
      dirs: [first.dir] as readonly Dir[],
      onMove: (dir: Dir) => console.log('MOVE_THROUGH ->', first.placedId, dir),
    };
  }, [board, content, displayFloor]);

  return (
    <main className="screen">
      <h1 className="title title--sm">Board preview (dev only)</h1>
      <p className="subtitle">
        Hand-built board, no server, no engine. Reachability and move handlers are stubs.
      </p>
      <button
        type="button"
        className="board__btn"
        onClick={() => {
          setPreviewRotation(0);
          setShowPrompt((v) => !v);
        }}
      >
        {showPrompt ? 'Hide' : 'Show'} rotate_tile prompt demo
      </button>
      {showPrompt && (
        <div className="panel rotate-prompt">
          <h3>
            Placing: {content.tilesById[DEMO_PROMPT.tileId]?.name ?? DEMO_PROMPT.tileId}
          </h3>
          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={() =>
                setPreviewRotation(
                  (r) =>
                    ROTATIONS[
                      (ROTATIONS.indexOf(r) + ROTATIONS.length - 1) % ROTATIONS.length
                    ]!,
                )
              }
            >
              Rotate left
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                setPreviewRotation(
                  (r) => ROTATIONS[(ROTATIONS.indexOf(r) + 1) % ROTATIONS.length]!,
                )
              }
            >
              Rotate right
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setShowPrompt(false)}
            >
              Place
            </button>
          </div>
        </div>
      )}
      <FloorTabs active={displayFloor} onSelect={setFloor} pawnsByFloor={pawnsByFloor} />
      <Board
        board={board}
        content={content}
        floor={displayFloor}
        pawns={pawnsByFloor[displayFloor]}
        reachable={reachableByFloor[displayFloor]}
        onMoveTo={(placedId) => console.log('MOVE ->', placedId)}
        moveThrough={showPrompt ? undefined : demoMoveThrough}
        ghost={
          showPrompt
            ? {
                tileId: DEMO_PROMPT.tileId,
                x: DEMO_PROMPT.x,
                y: DEMO_PROMPT.y,
                rotation: previewRotation,
              }
            : undefined
        }
      />
    </main>
  );
}
