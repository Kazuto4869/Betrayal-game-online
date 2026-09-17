/**
 * The only mutator. See docs/05-engine.md#51-public-surface.
 *
 * `reduce` returns an error rather than throwing, because illegal actions are
 * routine — a client with a stale snapshot, a double-click — and must not take
 * down a room.
 *
 * M0 implements the lobby and the bare turn loop. Movement, cards, and the
 * haunt arrive in M2-M4; unimplemented actions return UNKNOWN_ACTION so the
 * protocol is stable but nothing pretends to work.
 */

import {
  DIR_ORDER,
  MAX_PLAYERS,
  MIN_PLAYERS,
  OPPOSITE,
  TRAITS,
  cellKey,
  isEffectPromptPayload,
  isRotateTilePayload,
  neighbourCell,
  placedIdFor,
  rotateDoors,
  type BoardState,
  type CardId,
  type Dir,
  type Floor,
  type GameAction,
  type GameEvent,
  type GameState,
  type MonsterId,
  type MonsterState,
  type MonsterTurnState,
  type MovementContinuation,
  type PendingPrompt,
  type PlacedId,
  type PlacedTile,
  type PlayerState,
  type Rotation,
  type RotateTilePayload,
  type RuleError,
  type RuleErrorCode,
  type SeatId,
  type TargetRef,
  type TileId,
  type TokenState,
  type Trait,
} from '@bahoth/shared';
import type { Character, Content, Effect, Tile } from '@bahoth/content';
import { checkInvariants } from './invariants.js';
import { drawTile, legalRotations, wouldSealFloor } from './discovery.js';
import { resumeEffects, runEffects } from './effects.js';
import {
  armPromptDeadline,
  legalAnswersFor,
  promptExpired,
  raisePrompt,
  validateAnswer,
} from './prompts.js';
import {
  activePlayers,
  canStart,
  getHostSeat,
  isCharacterTaken,
  isRoomActionEligible,
  nextSeatInOrder,
  takenColours,
  traitValue,
  getWeaponAttackModifier,
} from './selectors.js';
import {
  beginTurnFor,
  findPath,
  getCrossingBarrier,
  getDogReachableRooms,
  getMonsterConnections,
  getMonsterLeaveCost,
  getStepDirection,
  rotateDir,
} from './movement.js';
import { makeRng, rollDice, shuffle } from './rng.js';

export interface ReduceResult {
  state: GameState;
  events: GameEvent[];
  error?: RuleError;
}

export interface ReduceOptions {
  /** Throw on invariant violations instead of reporting them. Default true in tests. */
  strictInvariants?: boolean;
  onInvariantViolation?: (problems: string[], state: GameState) => void;
}

export function reduce(
  state: GameState,
  action: GameAction,
  content: Content,
  options: ReduceOptions = {},
): ReduceResult {
  const result = dispatch(state, action, content);

  if (result.error) {
    // On rejection the state is returned untouched, byte for byte.
    return { state, events: [], error: result.error };
  }

  // Accepted but inert: a TICK with nothing due, a RECONNECT for a seat that
  // never dropped. Bumping the version would make nothing look like something
  // — the server logs, broadcasts, and refreshes room activity on every
  // accepted action, so a periodic TICK would keep an idle room alive forever
  // and grow its log without bound.
  if (result.state === state) {
    return { state, events: result.events };
  }

  const problems = checkInvariants(result.state);
  if (problems.length > 0) {
    options.onInvariantViolation?.(problems, result.state);
    if (options.strictInvariants !== false) {
      return {
        state,
        events: [],
        error: { code: 'INVARIANT_VIOLATION', message: problems.join('; ') },
      };
    }
  }

  return { ...result, state: { ...result.state, version: state.version + 1 } };
}

function fail(code: RuleErrorCode, message: string): ReduceResult {
  return { state: {} as GameState, events: [], error: { code, message } };
}

export function isHauntBriefingPending(state: GameState): boolean {
  if (!state.haunt || !state.haunt.revealed) return false;
  const livingParticipants = state.turnOrder.filter((s) => {
    const p = state.players[s];
    return p && !p.isDead && !p.removed;
  });
  const ackSet = new Set(state.haunt.acknowledged);
  return livingParticipants.some((s) => !ackSet.has(s));
}

function ackHauntBriefing(state: GameState, seat: SeatId): ReduceResult {
  if (!state.haunt || !state.haunt.revealed) {
    return fail('WRONG_PHASE', 'No active haunt briefing to acknowledge');
  }
  const player = state.players[seat];
  if (!player || !state.turnOrder.includes(seat) || player.isDead || player.removed) {
    return fail('UNKNOWN_SEAT', 'Seat is not an active living participant');
  }
  if (state.haunt.acknowledged.includes(seat)) {
    return { state, events: [] };
  }
  const nextAcknowledged = [...state.haunt.acknowledged, seat];
  const nextState: GameState = {
    ...state,
    haunt: {
      ...state.haunt,
      acknowledged: nextAcknowledged,
    },
  };
  return {
    state: nextState,
    events: [{ t: 'log', text: `${player.name} is ready.` }],
  };
}

function dispatch(state: GameState, action: GameAction, content: Content): ReduceResult {
  if (isHauntBriefingPending(state)) {
    const allowed = [
      'ACK_HAUNT_BRIEFING',
      'DISCONNECT',
      'RECONNECT',
      'TICK',
      'VOTE_REMOVE',
      'CONCEDE',
    ];
    if (!allowed.includes(action.t)) {
      return fail(
        'WRONG_PHASE',
        'Waiting for all active players to acknowledge haunt briefing',
      );
    }
  }

  if (state.monsterTurn !== null) {
    const allowedDuringMonsterPhase = [
      'START_MONSTER',
      'MOVE_MONSTER',
      'MONSTER_ATTACK',
      'END_MONSTER_TURN',
      'END_MONSTER_PHASE',
      'END_TURN',
      'CONCEDE',
      'DISCONNECT',
      'RECONNECT',
      'TICK',
      'VOTE_REMOVE',
    ];
    if (!allowedDuringMonsterPhase.includes(action.t)) {
      return fail('WRONG_PHASE', 'Cannot perform explorer actions during monster phase');
    }
  }

  switch (action.t) {
    case 'ACK_HAUNT_BRIEFING':
      return ackHauntBriefing(state, action.seat);
    case 'JOIN':
      return join(state, action.seat, action.name);
    case 'CHOOSE_CHAR':
      return chooseChar(state, action.seat, action.charId, content);
    case 'START_GAME':
      return startGame(state, action.seat, content);
    case 'END_TURN':
      return endTurn(state, action.seat, content);
    case 'VOTE_REMOVE':
      return voteRemove(state, action.seat, action.target, action.vote);
    case 'DISCONNECT':
      return setConnected(state, action.seat, false, action.at);
    case 'RECONNECT':
      return setConnected(state, action.seat, true);
    case 'TICK':
      return tick(state, action.now, content);
    case 'CONCEDE':
      return concede(state, action.seat, content);
    case 'MOVE':
      return move(state, action.seat, action.to, content);
    case 'MOVE_THROUGH':
      return moveThrough(state, action.seat, action.dir, content);
    case 'ROTATE_TILE':
      return rotateTile(state, action.seat, action.rotation, content);
    case 'ANSWER':
      return answerPrompt(state, action.seat, action.promptId, action.answer, content);

    // Declared in the protocol, implemented in later milestones.
    case 'USE_ITEM':
      return useItem(state, action.seat, action.cardId, action.target, content);
    case 'DROP':
      return dropItems(state, action.seat, action.cardIds, content);
    case 'PICKUP':
      return pickupItems(state, action.seat, action.cardIds, content);
    case 'COMMAND_DOG':
      return commandDog(state, action.seat, action.destination, action.cardId, content);
    case 'START_MONSTER':
      return startMonster(state, action.seat, action.monsterId, content);
    case 'MOVE_MONSTER':
      return moveMonster(state, action.seat, action.monsterId, action.to, content);
    case 'MONSTER_ATTACK':
      return monsterAttack(
        state,
        action.seat,
        action.monsterId,
        action.target,
        action.trait,
        content,
      );
    case 'END_MONSTER_TURN':
      return endMonsterTurn(state, action.seat, action.monsterId, content);
    case 'END_MONSTER_PHASE':
      return endMonsterPhase(state, action.seat, content);
    case 'ATTACK':
      return attack(state, action.seat, action.target, action.trait, content);
    case 'ROOM_ACTION':
      return roomAction(state, action.seat, action.actionId, content);
    case 'TRADE':
    case 'ASSIGN_DAMAGE':
      return fail('UNKNOWN_ACTION', `${action.t} is not implemented yet`);
  }
}

// --- lobby -----------------------------------------------------------------

/**
 * Trait indices for a chosen character, or all-zero for a seat with none.
 *
 * Index 0 is the skull — the death slot — so an explorer must never sit there
 * while alive. The starting slot is printed on the character card and lives in
 * `character.start` (docs/02-rules-model.md#22-explorers-and-traits).
 */
function startingTraits(character: Character | undefined): PlayerState['traits'] {
  const traits = {} as PlayerState['traits'];
  for (const t of TRAITS) traits[t] = character?.start[t] ?? 0;
  return traits;
}

function makePlayer(seatId: SeatId, name: string): PlayerState {
  const traits = startingTraits(undefined);
  return {
    seatId,
    name,
    charId: null,
    traits,
    location: null,
    movesLeft: 0,
    cameFrom: null,
    items: [],
    omens: [],
    isTraitor: false,
    isDead: false,
    connected: true,
    disconnectedAt: null,
    removed: false,
    hasAttackedThisTurn: false,
    usedCardsThisTurn: [],
    flags: {},
  };
}

function join(state: GameState, seat: SeatId, name: string): ReduceResult {
  const existing = state.players[seat];
  if (existing) {
    // Re-joining an existing seat is a reconnect, not an error.
    return setConnected(state, seat, true);
  }
  if (state.phase !== 'lobby') {
    return fail('WRONG_PHASE', 'The game has already started');
  }
  if (Object.keys(state.players).length >= MAX_PLAYERS) {
    return fail('TOO_MANY_PLAYERS', `A game seats at most ${MAX_PLAYERS} players`);
  }

  return {
    state: { ...state, players: { ...state.players, [seat]: makePlayer(seat, name) } },
    events: [{ t: 'joined', seat, name }],
  };
}

function chooseChar(
  state: GameState,
  seat: SeatId,
  charId: string | null,
  content: Content,
): ReduceResult {
  if (state.phase !== 'lobby')
    return fail('WRONG_PHASE', 'Characters are chosen in the lobby');
  const player = state.players[seat];
  if (!player) return fail('UNKNOWN_SEAT', `No such seat: ${seat}`);

  let character: Character | undefined;
  if (charId !== null) {
    character = content.charactersById[charId];
    if (!character) return fail('UNKNOWN_ACTION', `No such character: ${charId}`);
    if (isCharacterTaken(state, charId, seat)) {
      return fail('CHARACTER_TAKEN', `${character.name} is already taken`);
    }
    if (takenColours(state, content, seat).has(character.colour)) {
      return fail(
        'CHARACTER_TAKEN',
        `Another explorer has already claimed ${character.colour}`,
      );
    }
  }

  // Traits are seeded here rather than at START_GAME so that a seat's indices
  // are never out of step with its character — clearing the choice puts them
  // back to zero, and no state where a character is chosen has skull indices.
  return {
    state: {
      ...state,
      players: {
        ...state.players,
        [seat]: { ...player, charId, traits: startingTraits(character) },
      },
    },
    events: [{ t: 'char_chosen', seat, charId }],
  };
}

/**
 * Place every layout tile and stand every explorer in the start tile
 * (D-e). Ids are cell-derived (`placedIdFor`) rather than counted, so this
 * cannot desync from `board.index` — invariant 3b checks the two agree.
 */
function placeStartingLayout(content: Content): BoardState {
  const placed: BoardState['placed'] = {};
  const index: BoardState['index'] = { basement: {}, ground: {}, upper: {} };
  for (const t of content.house.layout) {
    const id = placedIdFor(t.floor, t.x, t.y);
    placed[id] = {
      id,
      tileId: t.tileId,
      floor: t.floor,
      x: t.x,
      y: t.y,
      rotation: t.rotation,
      discoveredBy: null,
      flags: {},
    };
    index[t.floor][cellKey(t.x, t.y)] = id;
  }
  return { placed, index };
}

function startGame(state: GameState, seat: SeatId, content: Content): ReduceResult {
  if (state.phase !== 'lobby') return fail('WRONG_PHASE', 'The game has already started');
  if (getHostSeat(state) !== seat)
    return fail('NOT_HOST', 'Only the host can start the game');

  const players = activePlayers(state);
  if (players.length < MIN_PLAYERS) {
    return fail('NOT_ENOUGH_PLAYERS', `Need at least ${MIN_PLAYERS} players`);
  }
  if (!canStart(state)) {
    return fail('CHARACTER_REQUIRED', 'Every player must choose an explorer first');
  }

  const rng = state.rng;
  if (!rng)
    return fail('INVARIANT_VIOLATION', 'Cannot start a game from a redacted state');

  const [turnOrder, rngAfterOrder] = shuffle(
    rng,
    players.map((p) => p.seatId),
  );
  // Turn order first, then the tile deck, then card decks — the ordering is fixed
  // so replay reproduces the same decks every time (docs/05-engine.md#54).
  const [tileDeck, rngAfterTile] = shuffle(rngAfterOrder, content.deckTiles);
  const [itemDeck, rngAfterItem] = shuffle(rngAfterTile, content.deckCards?.item ?? []);
  const [eventDeck, rngAfterEvent] = shuffle(
    rngAfterItem,
    content.deckCards?.event ?? [],
  );
  const [omenDeck, nextRng] = shuffle(rngAfterEvent, content.deckCards?.omen ?? []);

  const board = placeStartingLayout(content);
  const startLayout = content.house.layout.find(
    (t) => t.tileId === content.house.startTile,
  );
  // The loader guarantees startTile names a pre-placed tile
  // (assertHouseCoherent), so this is never undefined for content that
  // passed buildContent.
  const startId: PlacedId = placedIdFor(
    startLayout!.floor,
    startLayout!.x,
    startLayout!.y,
  );

  // Trait indices are already set from each character's printed starting slot
  // by CHOOSE_CHAR. Every explorer stands in the Entrance Hall to start
  // (docs/02-rules-model.md#23-the-house).
  const nextPlayers: Record<SeatId, PlayerState> = { ...state.players };
  for (const p of players) {
    nextPlayers[p.seatId] = { ...p, location: startId, cameFrom: null };
  }

  const first = turnOrder[0] ?? null;
  let nextState: GameState = {
    ...state,
    rng: nextRng,
    // Straight to `explore`: characters are chosen in the lobby, so the
    // `setup` phase has nothing to do.
    phase: 'explore',
    players: nextPlayers,
    turnOrder,
    activeSeat: first,
    round: 1,
    // Unarmed: the engine cannot read a clock, so the first TICK of the turn
    // sets the deadline.
    turnDeadline: null,
    board,
    tileDeck,
    tileDiscard: [],
    decks: {
      item: { draw: itemDeck, discard: [], inPlay: [] },
      event: { draw: eventDeck, discard: [], inPlay: [] },
      omen: { draw: omenDeck, discard: [], inPlay: [] },
    },
    omensDrawn: 0,
    haunt: null,
  };
  // Only the first active seat gets a movement budget this turn (D-f);
  // everyone else keeps the movesLeft: 0 they were seeded with in makePlayer.
  if (first) nextState = beginTurnFor(nextState, first, content);

  return {
    state: nextState,
    events: [
      { t: 'game_started', turnOrder },
      ...(first ? [{ t: 'turn_started', seat: first, round: 1 } as GameEvent] : []),
    ],
  };
}

// --- turn loop -------------------------------------------------------------

/**
 * `MOVE { to }` (D-g). `to` may be anywhere `getReachable` offers, not just
 * an adjacent room — docs/07-ui.md has the client highlight `getReachable()`
 * and issue `MOVE` on a click, so the engine has to walk a shortest legal
 * path itself. One `moved` event per room entered (D-b), so the log and any
 * future animation see each step; the known limitation (which of several
 * equal-length paths gets walked becomes player-visible once M3 gives rooms
 * `onEnter` effects) is recorded in docs/11-progress.md.
 */
function move(
  state: GameState,
  seat: SeatId,
  to: PlacedId,
  content: Content,
): ReduceResult {
  if (!['explore', 'haunt'].includes(state.phase)) {
    return fail('WRONG_PHASE', `Cannot move during ${state.phase}`);
  }
  const player = state.players[seat];
  if (!player) return fail('UNKNOWN_SEAT', `No such seat: ${seat}`);
  if (state.activeSeat !== seat) return fail('NOT_YOUR_TURN', 'It is not your turn');
  if (state.pending) return fail('PROMPT_PENDING', 'Answer the pending prompt first');
  if (player.isDead || player.removed || player.location === null) {
    return fail('ILLEGAL_MOVE', `${seat} cannot move`);
  }
  if (!state.board.placed[to]) return fail('ILLEGAL_MOVE', `No such room: ${to}`);
  if (to === player.location) return fail('ILLEGAL_MOVE', 'Already there');

  const path = findPath(state, seat, to, content);
  if (!path) {
    return fail(
      'ILLEGAL_MOVE',
      `${to} is not reachable with ${player.movesLeft} move(s) left`,
    );
  }

  return executePath(state, seat, path, false, content);
}

/**
 * Executes movement along a path of PlacedIds one step at a time.
 * For each step:
 * 1. Checks if current location has onExit effects (skipped on the first step if skipFirstExit is true).
 * 2. If onExit runs and suspends on a prompt, stores MovementContinuation in resume.movement and returns.
 * 3. If player dies during onExit, halts movement immediately.
 * 4. Otherwise, enters the next step, decrements movesLeft, emits moved event.
 * 5. Once all steps complete, runs the destination's onEnter effects if present.
 */
function executePath(
  state: GameState,
  seat: SeatId,
  path: PlacedId[],
  skipFirstExit: boolean,
  content: Content,
): ReduceResult {
  let workingState = state;
  const events: GameEvent[] = [];
  const player = workingState.players[seat];
  if (!player || player.isDead || player.location === null) {
    return { state: workingState, events };
  }

  let from = player.location;
  for (let i = 0; i < path.length; i++) {
    const step = path[i]!;
    const shouldRunExit = !(i === 0 && skipFirstExit);

    if (shouldRunExit) {
      const fromPlaced = workingState.board.placed[from];
      if (fromPlaced) {
        const fromTileDef = content.tilesById[fromPlaced.tileId];
        if (fromTileDef && fromTileDef.onExit.length > 0) {
          const exitOutcome = runEffects(
            workingState,
            fromTileDef.onExit,
            { actor: seat },
            content,
          );
          workingState = exitOutcome.state;
          events.push(...exitOutcome.events);

          if (workingState.pending !== null) {
            const remainingSteps = path.slice(i);
            const movement: MovementContinuation = {
              kind: 'move',
              seat,
              from,
              to: path[path.length - 1]!,
              remainingSteps,
            };
            if (isEffectPromptPayload(workingState.pending.payload)) {
              workingState = {
                ...workingState,
                pending: {
                  ...workingState.pending,
                  payload: {
                    ...workingState.pending.payload,
                    resume: {
                      ...workingState.pending.payload.resume,
                      movement,
                    },
                  },
                },
              };
            }
            return { state: workingState, events };
          }

          const pNow = workingState.players[seat];
          if (!pNow || pNow.isDead || pNow.location === null) {
            return { state: workingState, events };
          }
        }
      }
    }

    const p = workingState.players[seat]!;

    const barrier = getCrossingBarrier(
      workingState,
      seat,
      from,
      step,
      p.cameFrom,
      content,
    );
    if (barrier) {
      if (!workingState.rng) {
        return fail('INVARIANT_VIOLATION', 'Cannot roll dice from a redacted state');
      }
      const diceCount = Math.max(
        1,
        Math.min(8, traitValue(workingState, seat, barrier.trait, content)),
      );
      const [dice, total, nextRng] = rollDice(workingState.rng, diceCount);
      workingState = { ...workingState, rng: nextRng };
      events.push({
        t: 'rolled',
        seat,
        dice,
        total,
        reason: `${barrier.fromTileDef.name} Barrier`,
      });

      if (total >= barrier.threshold) {
        events.push({
          t: 'log',
          text: `${p.name} rolled ${total} (needed ${barrier.threshold}+) and successfully crossed the ${barrier.fromTileDef.name} barrier.`,
        });
      } else {
        events.push({
          t: 'log',
          text: `${p.name} rolled ${total} (needed ${barrier.threshold}+) and failed to cross the ${barrier.fromTileDef.name} barrier.`,
        });
        workingState = {
          ...workingState,
          players: {
            ...workingState.players,
            [seat]: {
              ...p,
              movesLeft: 0,
            },
          },
        };
        return { state: workingState, events };
      }
    }

    const nextFlags = { ...p.flags };
    if (nextFlags[`barrier_side:${from}`]) {
      delete nextFlags[`barrier_side:${from}`];
    }
    const stepPlaced = workingState.board.placed[step];
    const fromPlaced = workingState.board.placed[from];
    if (stepPlaced && fromPlaced) {
      const stepDef = content.tilesById[stepPlaced.tileId];
      if (stepDef?.crossing) {
        const entrySide = getStepDirection(stepPlaced, fromPlaced);
        if (entrySide) {
          nextFlags[`barrier_side:${step}`] = entrySide;
        }
      }
    }

    workingState = {
      ...workingState,
      players: {
        ...workingState.players,
        [seat]: {
          ...p,
          flags: nextFlags,
          location: step,
          cameFrom: from,
          movesLeft: p.movesLeft - 1,
        },
      },
    };
    events.push({ t: 'moved', seat, from, to: step });
    from = step;
  }

  const destId = path[path.length - 1]!;
  const destPlaced = workingState.board.placed[destId];
  if (destPlaced) {
    const tileDef = content.tilesById[destPlaced.tileId];
    if (tileDef && tileDef.onEnter.length > 0) {
      const outcome = runEffects(workingState, tileDef.onEnter, { actor: seat }, content);
      workingState = outcome.state;
      events.push(...outcome.events);
    }
    if (destPlaced.tileId === 'tile.mystic_elevator') {
      const elevOutcome = resolveMysticElevator(workingState, seat, destId, content);
      workingState = elevOutcome.state;
      events.push(...elevOutcome.events);
    }
  }

  return { state: workingState, events };
}

/**
 * `MOVE_THROUGH { dir }` — the other half of movement, alongside `MOVE`
 * (docs/02-rules-model.md#24 step 3 and its [RULING] on the draw;
 * docs/05-engine.md#56, steps 1-3 of the worked example). Draws a tile off
 * the deck and either places it immediately, when only one rotation puts a
 * door back on `dir` (docs/09-roadmap.md open question 7: auto-apply), or
 * raises a `rotate_tile` prompt for the seat to choose among the rest.
 *
 * The tile is off the deck from the moment `drawTile` succeeds, whether or
 * not a prompt follows — which is why every place that can otherwise drop
 * `pending` (see `tick`, below) has to resolve a `rotate_tile` prompt rather
 * than discard it. A dropped prompt would be a drawn tile that vanished.
 */
function moveThrough(
  state: GameState,
  seat: SeatId,
  dir: Dir,
  content: Content,
): ReduceResult {
  if (!['explore', 'haunt'].includes(state.phase)) {
    return fail('WRONG_PHASE', `Cannot move during ${state.phase}`);
  }
  const player = state.players[seat];
  if (!player) return fail('UNKNOWN_SEAT', `No such seat: ${seat}`);
  if (state.activeSeat !== seat) return fail('NOT_YOUR_TURN', 'It is not your turn');
  if (state.pending) return fail('PROMPT_PENDING', 'Answer the pending prompt first');
  if (player.isDead || player.removed || player.location === null) {
    return fail('ILLEGAL_MOVE', `${seat} cannot move`);
  }
  if (player.movesLeft <= 0) {
    return fail('ILLEGAL_MOVE', `${seat} has no moves left`);
  }

  const location = state.board.placed[player.location];
  const tileDef = location && content.tilesById[location.tileId];
  if (!location || !tileDef) {
    return fail('ILLEGAL_MOVE', `${seat} is standing on an unrecognised tile`);
  }

  const doors = rotateDoors(tileDef.doors, location.rotation);
  if (!doors[dir]) {
    return fail('ILLEGAL_MOVE', `No doorway ${dir} from ${location.id}`);
  }

  const [nx, ny] = neighbourCell(location.x, location.y, dir);
  if (state.board.index[location.floor][cellKey(nx, ny)]) {
    // This is exactly the client bug this check catches: the cell is already
    // built, so the right action is MOVE, not MOVE_THROUGH.
    return fail(
      'ILLEGAL_MOVE',
      `${cellKey(nx, ny)} on the ${location.floor} is already built — use MOVE instead`,
    );
  }

  const crossingEvents: GameEvent[] = [];
  if (tileDef.crossing && tileDef.crossing.sides) {
    const sideA = rotateDir(tileDef.crossing.sides[0], location.rotation);
    const sideB = rotateDir(tileDef.crossing.sides[1], location.rotation);
    if (dir === sideA || dir === sideB) {
      let entryDir: Dir | null = null;
      if (player.cameFrom) {
        const cfPlaced = state.board.placed[player.cameFrom];
        if (cfPlaced) entryDir = getStepDirection(location, cfPlaced);
      }
      if (!entryDir) {
        const flag = player.flags[`barrier_side:${location.id}`];
        if (flag === 'n' || flag === 'e' || flag === 's' || flag === 'w') {
          entryDir = flag;
        }
      }
      if (entryDir && dir !== entryDir) {
        if (!state.rng) {
          return fail('INVARIANT_VIOLATION', 'Cannot roll dice from a redacted state');
        }
        const diceCount = Math.max(
          1,
          Math.min(8, traitValue(state, seat, tileDef.crossing.trait, content)),
        );
        const [dice, total, nextRng] = rollDice(state.rng, diceCount);
        state = { ...state, rng: nextRng };
        crossingEvents.push({
          t: 'rolled',
          seat,
          dice,
          total,
          reason: `${tileDef.name} Barrier`,
        });
        if (total < tileDef.crossing.threshold) {
          crossingEvents.push({
            t: 'log',
            text: `${player.name} rolled ${total} (needed ${tileDef.crossing.threshold}+) and failed to cross the ${tileDef.name} barrier.`,
          });
          return {
            state: {
              ...state,
              players: {
                ...state.players,
                [seat]: {
                  ...player,
                  movesLeft: 0,
                },
              },
            },
            events: crossingEvents,
          };
        }
        crossingEvents.push({
          t: 'log',
          text: `${player.name} rolled ${total} (needed ${tileDef.crossing.threshold}+) and successfully crossed the ${tileDef.name} barrier.`,
        });
      }
    }
  }

  const rng = state.rng;
  if (!rng) {
    return fail('INVARIANT_VIOLATION', 'Cannot draw a tile from a redacted state');
  }

  let curDeck = state.tileDeck;
  let curDiscard = state.tileDiscard ?? [];
  let curRng = rng;
  let drawnTileId: TileId | null = null;
  let validRotations: Rotation[] = [];
  let drawnTileDef: Tile | null = null;
  // Guard against infinite loops: track tile IDs whose every legal rotation
  // would seal the floor.  Once we see the same tile again (after a reshuffle)
  // we know every remaining candidate seals, and must bail.
  const sealingTiles = new Set<TileId>();

  while (true) {
    const draw = drawTile(curDeck, curDiscard, location.floor, content, curRng);
    if (!draw) {
      return fail(
        'NO_ROOMS_FOR_FLOOR',
        `No remaining room tiles can be placed on the ${location.floor}`,
      );
    }
    curDeck = draw.deck;
    curDiscard = draw.discard;
    curRng = draw.rng;
    const def = content.tilesById[draw.tileId]!;
    const rots = legalRotations(def, OPPOSITE[dir]);
    const nonSealing = rots.filter(
      (r) => !wouldSealFloor(state.board, def, r, location.floor, nx, ny, content),
    );
    if (nonSealing.length > 0) {
      drawnTileId = draw.tileId;
      drawnTileDef = def;
      validRotations = nonSealing;
      break;
    }
    // All rotations of this tile would seal off the floor.
    if (sealingTiles.has(draw.tileId)) {
      // We've seen this tile before — every remaining eligible tile seals.
      return fail(
        'NO_ROOMS_FOR_FLOOR',
        `All remaining room tiles for ${location.floor} would seal the floor`,
      );
    }
    sealingTiles.add(draw.tileId);
    // 2E Rulebook (page 9): set it aside in discard and draw another!
    curDiscard = [...curDiscard, draw.tileId];
  }

  // The tile is committed from here: it is off the deck in `withDraw`
  // regardless of which path below actually places it.
  const withDraw: GameState = {
    ...state,
    tileDeck: curDeck,
    tileDiscard: curDiscard,
    rng: curRng,
  };
  const payload: RotateTilePayload = {
    tileId: drawnTileId,
    floor: location.floor,
    x: nx,
    y: ny,
    from: location.id,
    dir,
    legalRotations: validRotations,
  };

  if (validRotations.length === 1) {
    // No decision to make (open question 7: auto-apply).
    const finishRes = finishDiscovery(
      withDraw,
      seat,
      payload,
      validRotations[0]!,
      content,
    );
    return {
      ...finishRes,
      events: [...crossingEvents, ...finishRes.events],
    };
  }

  // `deadline` starts null and is armed by the next TICK (prompts.ts), for the
  // same reason the turn clock is: this action carries no `now`.
  const pending: PendingPrompt = raisePrompt(state, {
    seatId: seat,
    kind: 'rotate_tile',
    payload,
    defaultAnswer: validRotations[0]!,
  });

  return {
    state: { ...withDraw, pending },
    events: [
      ...crossingEvents,
      // docs/07-ui.md#73 asks for exactly this line for the other players.
      { t: 'log', text: `${player.name} is placing the ${drawnTileDef.name}…` },
    ],
  };
}

/**
 * Land a drawn tile and step the explorer through the doorway. Shared by the
 * auto-apply path in `moveThrough`, `ROTATE_TILE`, and default-answer
 * resolution in `tick` (`resolvePromptWithDefault`) — three ways to reach the
 * same finish line, one function that draws it.
 *
 * Step 6 of the worked example (docs/05-engine.md#56) lands here: once the
 * explorer has moved in, the tile's `onEnter` effects resolve through the
 * shared interpreter (`effects.ts`). Steps 7-8 — the card draw and its
 * `movesLeft = 0`, and the haunt roll — stay out of scope: a discovered tile
 * with a symbol still draws nothing, because the decks don't exist yet.
 */
function finishDiscovery(
  state: GameState,
  seat: SeatId,
  payload: RotateTilePayload,
  rotation: Rotation,
  content: Content,
): ReduceResult {
  const id = placedIdFor(payload.floor, payload.x, payload.y);

  // Guard the cell one more time. Nothing can occupy it between the prompt
  // being raised and being answered today — a pending prompt blocks every
  // other action — but that is a fact about today's rules, not a property of
  // this function. Clear the prompt without double-placing if it ever does.
  if (state.board.index[payload.floor][cellKey(payload.x, payload.y)]) {
    return { state: { ...state, pending: null }, events: [] };
  }

  const placed: PlacedTile = {
    id,
    tileId: payload.tileId,
    floor: payload.floor,
    x: payload.x,
    y: payload.y,
    rotation,
    discoveredBy: seat,
    flags: {},
  };

  const board: BoardState = {
    placed: { ...state.board.placed, [id]: placed },
    index: {
      ...state.board.index,
      [payload.floor]: {
        ...state.board.index[payload.floor],
        [cellKey(payload.x, payload.y)]: id,
      },
    },
  };

  const player = state.players[seat]!;
  const tileDef = content.tilesById[payload.tileId];
  const hasSymbol = Boolean(tileDef?.symbol);
  const movesLeft = hasSymbol ? 0 : player.movesLeft - 1;
  const fromPlaced = state.board.placed[payload.from];
  const nextFlags = { ...player.flags };
  if (fromPlaced && tileDef?.crossing) {
    const entrySide = getStepDirection(placed, fromPlaced);
    if (entrySide) {
      nextFlags[`barrier_side:${id}`] = entrySide;
    }
  }
  if (nextFlags[`barrier_side:${payload.from}`]) {
    delete nextFlags[`barrier_side:${payload.from}`];
  }

  const players = {
    ...state.players,
    [seat]: {
      ...player,
      flags: nextFlags,
      location: id,
      cameFrom: payload.from,
      movesLeft,
    },
  };

  const fromTileDef = fromPlaced ? content.tilesById[fromPlaced.tileId] : undefined;

  let workingState: GameState = { ...state, board, players, pending: null };
  const events: GameEvent[] = [{ t: 'discovered', seat, placed }];

  if (fromTileDef && fromTileDef.onExit.length > 0) {
    const exitOutcome = runEffects(
      workingState,
      fromTileDef.onExit,
      { actor: seat },
      content,
    );
    workingState = exitOutcome.state;
    events.push(...exitOutcome.events);
    if (workingState.pending !== null) {
      return { state: workingState, events };
    }
  }

  events.push({ t: 'moved', seat, from: payload.from, to: id });

  if (tileDef?.symbol && workingState.decks[tileDef.symbol]) {
    const symbol = tileDef.symbol;
    let deck = workingState.decks[symbol];

    if (deck.draw.length === 0 && deck.discard.length > 0 && workingState.rng) {
      const [shuffled, newRng] = shuffle(workingState.rng, deck.discard);
      deck = { ...deck, draw: shuffled, discard: [] };
      workingState = {
        ...workingState,
        rng: newRng,
        decks: { ...workingState.decks, [symbol]: deck },
      };
    }

    if (deck.draw.length > 0) {
      const cardId = deck.draw[0]!;
      const nextDraw = deck.draw.slice(1);
      const cardDef = content.cardsById[cardId];
      events.push({ t: 'drew_card', seat, deck: symbol, cardId });

      if (symbol === 'item') {
        const nextInPlay = [...deck.inPlay, cardId];
        const nextDeck = { ...deck, draw: nextDraw, inPlay: nextInPlay };
        const currentPlayer = workingState.players[seat]!;
        workingState = {
          ...workingState,
          decks: { ...workingState.decks, item: nextDeck },
          players: {
            ...workingState.players,
            [seat]: { ...currentPlayer, items: [...currentPlayer.items, cardId] },
          },
        };
        if (cardDef?.onDraw && cardDef.onDraw.length > 0) {
          const effOutcome = runEffects(
            workingState,
            cardDef.onDraw,
            { actor: seat },
            content,
          );
          workingState = effOutcome.state;
          events.push(...effOutcome.events);
        }
      } else if (symbol === 'omen') {
        const nextInPlay = [...deck.inPlay, cardId];
        const nextDeck = { ...deck, draw: nextDraw, inPlay: nextInPlay };
        const currentPlayer = workingState.players[seat]!;
        const nextOmensDrawn = workingState.omensDrawn + 1;
        workingState = {
          ...workingState,
          decks: { ...workingState.decks, omen: nextDeck },
          omensDrawn: nextOmensDrawn,
          players: {
            ...workingState.players,
            [seat]: { ...currentPlayer, omens: [...currentPlayer.omens, cardId] },
          },
        };
        if (cardDef?.onDraw && cardDef.onDraw.length > 0) {
          const effOutcome = runEffects(
            workingState,
            cardDef.onDraw,
            { actor: seat },
            content,
          );
          workingState = effOutcome.state;
          events.push(...effOutcome.events);
        }
        if (workingState.haunt === null && workingState.rng) {
          const [dice, total, nextRng] = rollDice(workingState.rng, 6);
          workingState = { ...workingState, rng: nextRng };
          events.push({ t: 'rolled', seat, dice, total, reason: 'haunt_roll' });
          const triggered = total < nextOmensDrawn;
          events.push({ t: 'haunt_roll', total, needed: nextOmensDrawn, triggered });
          if (triggered) {
            const hauntOutcome = triggerHaunt(
              workingState,
              seat,
              cardId,
              payload.tileId,
              content,
            );
            workingState = hauntOutcome.state;
            events.push(...hauntOutcome.events);
          }
        }
      } else if (symbol === 'event') {
        if (cardDef?.onDraw && cardDef.onDraw.length > 0) {
          const effOutcome = runEffects(
            workingState,
            cardDef.onDraw,
            { actor: seat },
            content,
          );
          workingState = effOutcome.state;
          events.push(...effOutcome.events);
        }
        if (cardDef?.keepInPlay) {
          const nextDeck = { ...deck, draw: nextDraw, inPlay: [...deck.inPlay, cardId] };
          workingState = {
            ...workingState,
            decks: { ...workingState.decks, event: nextDeck },
          };
        } else {
          const nextDeck = {
            ...deck,
            draw: nextDraw,
            discard: [...deck.discard, cardId],
          };
          workingState = {
            ...workingState,
            decks: { ...workingState.decks, event: nextDeck },
          };
        }
      }
    }
  }

  if (tileDef && tileDef.onEnter.length > 0) {
    const resolved = runEffects(workingState, tileDef.onEnter, { actor: seat }, content);
    workingState = resolved.state;
    events.push(...resolved.events);
  }

  if (payload.tileId === 'tile.collapsed_room') {
    const colOutcome = resolveCollapsedRoomDiscovery(workingState, seat, id, content);
    workingState = colOutcome.state;
    events.push(...colOutcome.events);
  }

  if (payload.tileId === 'tile.mystic_elevator') {
    const elevOutcome = resolveMysticElevator(workingState, seat, id, content);
    workingState = elevOutcome.state;
    events.push(...elevOutcome.events);
  }

  if (tileDef && tileDef.onEndTurn && tileDef.onEndTurn.length > 0) {
    if (
      workingState.pending !== null &&
      isEffectPromptPayload(workingState.pending.payload)
    ) {
      workingState = {
        ...workingState,
        pending: {
          ...workingState.pending,
          payload: {
            ...workingState.pending.payload,
            resume: {
              ...workingState.pending.payload.resume,
              remaining: [
                ...workingState.pending.payload.resume.remaining,
                ...tileDef.onEndTurn,
                {
                  e: 'set_flag',
                  scope: 'seat',
                  key: `room_end_resolved_${id}`,
                  value: true,
                },
              ],
            },
          },
        },
      };
    } else if (workingState.pending === null) {
      const roomEndOutcome = runEffects(
        workingState,
        tileDef.onEndTurn,
        { actor: seat },
        content,
      );
      workingState = roomEndOutcome.state;
      events.push(...roomEndOutcome.events);

      const currP = workingState.players[seat];
      if (currP) {
        workingState = {
          ...workingState,
          players: {
            ...workingState.players,
            [seat]: {
              ...currP,
              flags: { ...currP.flags, [`room_end_resolved_${id}`]: true },
            },
          },
        };
      }
    }
  }

  return { state: workingState, events };
}

/**
 * Resume the pipeline at the step a prompt suspended (docs/05-engine.md#56).
 *
 * The one place a prompt turns back into game state, reached by all four
 * callers: `ANSWER`, `ROTATE_TILE`, a prompt timing out on its own clock, and
 * a prompt whose owner is leaving. `answer` has already been through
 * `validateAnswer` at every one of them — including the timeout, so a default
 * answer cannot do something no player could have chosen.
 *
 * A kind with no resume step clears the prompt. That is safe for every kind
 * that exists today because none of them can be raised; it stops being safe
 * the moment one is, which is why `PROMPT_HANDLERS` is a total record — a new
 * kind cannot reach this switch without the compiler asking about it.
 */
function discardCardFromSeat(
  state: GameState,
  seat: SeatId,
  cardId: CardId,
  content: Content,
): GameState {
  const player = state.players[seat];
  if (!player) return state;
  const card = content.cardsById[cardId];
  const deckKind = card?.deck ?? (player.omens.includes(cardId) ? 'omen' : 'item');
  const nextItems = player.items.filter((id) => id !== cardId);
  const nextOmens = player.omens.filter((id) => id !== cardId);
  const deck = state.decks[deckKind];
  const nextDeck = {
    ...deck,
    inPlay: deck.inPlay.filter((id) => id !== cardId),
    discard: deck.discard.includes(cardId) ? deck.discard : [...deck.discard, cardId],
  };
  return {
    ...state,
    decks: { ...state.decks, [deckKind]: nextDeck },
    players: {
      ...state.players,
      [seat]: { ...player, items: nextItems, omens: nextOmens },
    },
  };
}

function resumePrompt(
  state: GameState,
  prompt: PendingPrompt,
  answer: unknown,
  content: Content,
): ReduceResult {
  if (prompt.kind === 'rotate_tile' && isRotateTilePayload(prompt.payload)) {
    return finishDiscovery(
      state,
      prompt.seatId,
      prompt.payload,
      answer as Rotation,
      content,
    );
  }
  if (
    (prompt.kind === 'choose_target' ||
      prompt.kind === 'choose_room' ||
      prompt.kind === 'choose_trait') &&
    isEffectPromptPayload(prompt.payload)
  ) {
    const cleared: GameState = { ...state, pending: null };
    const outcome = resumeEffects(
      cleared,
      prompt.payload.resume,
      answer as TargetRef | PlacedId | Trait,
      content,
    );
    let outcomeState = outcome.state;
    const discardCardId = prompt.payload.resume.discardCardId;
    if (discardCardId) {
      if (outcomeState.pending === null) {
        outcomeState = discardCardFromSeat(
          outcomeState,
          prompt.payload.resume.actor,
          discardCardId,
          content,
        );
      } else if (isEffectPromptPayload(outcomeState.pending.payload)) {
        outcomeState = {
          ...outcomeState,
          pending: {
            ...outcomeState.pending,
            payload: {
              ...outcomeState.pending.payload,
              resume: {
                ...outcomeState.pending.payload.resume,
                discardCardId,
              },
            },
          },
        };
      }
    }
    const events = [...outcome.events];
    const movement = prompt.payload.resume.movement;
    if (movement) {
      if (outcomeState.pending === null) {
        const moveRes = executePath(
          outcomeState,
          movement.seat,
          movement.remainingSteps,
          true,
          content,
        );
        outcomeState = moveRes.state;
        events.push(...moveRes.events);
      } else if (isEffectPromptPayload(outcomeState.pending.payload)) {
        outcomeState = {
          ...outcomeState,
          pending: {
            ...outcomeState.pending,
            payload: {
              ...outcomeState.pending.payload,
              resume: {
                ...outcomeState.pending.payload.resume,
                movement,
              },
            },
          },
        };
      }
    }
    const thenEndTurn = prompt.payload.resume.thenEndTurn;
    if (thenEndTurn) {
      if (outcomeState.pending === null) {
        const finishRes = finishEndTurn(
          outcomeState,
          prompt.payload.resume.actor,
          content,
        );
        if (!finishRes.error) {
          outcomeState = finishRes.state;
          events.push(...finishRes.events);
        }
      } else if (isEffectPromptPayload(outcomeState.pending.payload)) {
        outcomeState = {
          ...outcomeState,
          pending: {
            ...outcomeState.pending,
            payload: {
              ...outcomeState.pending.payload,
              resume: {
                ...outcomeState.pending.payload.resume,
                thenEndTurn: true,
              },
            },
          },
        };
      }
    }
    return { state: outcomeState, events };
  }
  return { state: { ...state, pending: null }, events: [] };
}

/**
 * The single gate every player-supplied answer passes through.
 *
 * `promptId` is null for `ROTATE_TILE`, which carries no id, and a real id for
 * `ANSWER`. Checking it is the whole reason the field exists: a client
 * answering the prompt it *saw* must not land on the prompt that replaced it
 * while its message was in flight. `ROTATE_TILE` cannot make that check and
 * keeps its previous behaviour rather than gaining a field the protocol does
 * not carry.
 */
function answerPrompt(
  state: GameState,
  seat: SeatId,
  promptId: string | null,
  answer: unknown,
  content: Content,
): ReduceResult {
  const pending = state.pending;
  if (!pending) return fail('PROMPT_PENDING', 'There is no prompt to answer');
  if (pending.seatId !== seat) {
    return fail('PROMPT_MISMATCH', 'This is not your prompt to answer');
  }
  if (promptId !== null && promptId !== pending.id) {
    return fail('PROMPT_MISMATCH', `Prompt ${promptId} is not the prompt now pending`);
  }
  if (!validateAnswer(pending, answer)) {
    return fail('ILLEGAL_MOVE', `Not a legal answer to a ${pending.kind} prompt`);
  }

  return resumePrompt(state, pending, answer, content);
}

/**
 * `ROTATE_TILE { rotation }`: the seat's answer to a `rotate_tile` prompt.
 * Sugar over `ANSWER` — the kind check is what keeps its error codes specific,
 * everything after it is the generic path.
 */
function rotateTile(
  state: GameState,
  seat: SeatId,
  rotation: Rotation,
  content: Content,
): ReduceResult {
  if (state.pending && state.pending.kind !== 'rotate_tile') {
    return fail('PROMPT_MISMATCH', 'The pending prompt is not a tile rotation');
  }
  return answerPrompt(state, seat, null, rotation, content);
}

function finishEndTurn(state: GameState, seat: SeatId, content: Content): ReduceResult {
  const next = nextSeatInOrder(state, seat);
  if (!next) return fail('INVARIANT_VIOLATION', 'No seat to pass the turn to');

  // A round completes when the turn wraps back to the front of the order.
  const wrapped = state.turnOrder.indexOf(next) <= state.turnOrder.indexOf(seat);
  const round = wrapped ? state.round + 1 : state.round;

  const player = state.players[seat];
  const endingFlags = player ? { ...player.flags } : undefined;
  if (endingFlags) {
    if ('adrenaline_speed' in endingFlags) {
      delete endingFlags['adrenaline_speed'];
    }
    delete endingFlags['dog_used_this_turn'];
    for (const key of Object.keys(endingFlags)) {
      if (key.startsWith('room_end_resolved_') || key.startsWith('attempted_action:')) {
        delete endingFlags[key];
      }
    }
  }
  const players = player
    ? {
        ...state.players,
        [seat]: {
          ...player,
          flags: endingFlags!,
          hasAttackedThisTurn: false,
          cameFrom: null,
        },
      }
    : state.players;

  const livingMonsters = Object.values(state.monsters).filter((m) => !m.isDead);
  const traitorSeat = state.haunt?.traitorSeat;
  const isTraitorTurn = traitorSeat && seat === traitorSeat;

  if (
    state.phase === 'haunt' &&
    livingMonsters.length > 0 &&
    traitorSeat &&
    (isTraitorTurn || (wrapped && state.players[traitorSeat]?.isDead))
  ) {
    const nextState: GameState = {
      ...state,
      players,
      activeSeat: traitorSeat,
      turnDeadline: null,
      monsterTurn: {
        activeMonsterId: null,
        actedMonsterIds: [],
        movesLeft: 0,
        hasAttacked: false,
        rolledSpeed: null,
        controllingSeat: traitorSeat,
      },
    };
    return {
      state: nextState,
      events: [
        { t: 'turn_ended', seat },
        {
          t: 'log',
          text: `Monster Phase begins. ${state.players[traitorSeat]?.name ?? 'Traitor'} commands the monsters.`,
        },
      ],
    };
  }

  // The clock is disarmed, not re-armed: the next TICK arms it with the
  // budget that suits whoever is now active. beginTurnFor gives `next` its
  // Speed-based movement budget (D-f) — this is one of the call sites the
  // plan requires so a seat can never silently end up unable to move.
  let nextState: GameState = {
    ...state,
    players,
    activeSeat: next,
    round,
    turnDeadline: null,
  };
  nextState = beginTurnFor(nextState, next, content);

  return {
    state: nextState,
    events: [
      { t: 'turn_ended', seat },
      { t: 'turn_started', seat: next, round },
    ],
  };
}

function endTurn(state: GameState, seat: SeatId, content: Content): ReduceResult {
  if (state.monsterTurn !== null) {
    if (state.activeSeat !== seat || state.monsterTurn.controllingSeat !== seat) {
      return fail('NOT_YOUR_TURN', 'It is not your turn');
    }
    if (state.monsterTurn.activeMonsterId !== null) {
      return fail(
        'ILLEGAL_MOVE',
        'Finish active monster turn before ending monster phase',
      );
    }
    return endMonsterPhase(state, seat, content);
  }

  if (!['explore', 'haunt'].includes(state.phase)) {
    return fail('WRONG_PHASE', `Cannot end a turn during ${state.phase}`);
  }
  if (state.activeSeat !== seat) return fail('NOT_YOUR_TURN', 'It is not your turn');
  if (state.pending) return fail('PROMPT_PENDING', 'Answer the pending prompt first');

  const player = state.players[seat];
  if (!player) return fail('UNKNOWN_SEAT', `No such seat: ${seat}`);

  const locId = player.location;
  const placed = locId ? state.board.placed[locId] : null;
  if (placed?.tileId === 'tile.coal_chute') {
    return fail('ILLEGAL_MOVE', 'Cannot end turn on Coal Chute');
  }
  const tileDef = placed ? content.tilesById[placed.tileId] : null;
  const alreadyResolved = locId
    ? Boolean(player.flags[`room_end_resolved_${locId}`])
    : false;

  if (
    locId &&
    tileDef &&
    tileDef.onEndTurn &&
    tileDef.onEndTurn.length > 0 &&
    !alreadyResolved
  ) {
    const roomOutcome = runEffects(state, tileDef.onEndTurn, { actor: seat }, content);
    let workingState = roomOutcome.state;
    const events = [...roomOutcome.events];

    const updatedPlayer = workingState.players[seat];
    if (updatedPlayer) {
      workingState = {
        ...workingState,
        players: {
          ...workingState.players,
          [seat]: {
            ...updatedPlayer,
            flags: {
              ...updatedPlayer.flags,
              [`room_end_resolved_${locId}`]: true,
            },
          },
        },
      };
    }

    if (workingState.pending !== null) {
      if (isEffectPromptPayload(workingState.pending.payload)) {
        workingState = {
          ...workingState,
          pending: {
            ...workingState.pending,
            payload: {
              ...workingState.pending.payload,
              resume: {
                ...workingState.pending.payload.resume,
                thenEndTurn: true,
              },
            },
          },
        };
      }
      return { state: workingState, events };
    }

    const finishRes = finishEndTurn(workingState, seat, content);
    if (finishRes.error) return finishRes;
    return { state: finishRes.state, events: [...events, ...finishRes.events] };
  }

  return finishEndTurn(state, seat, content);
}

// --- connection ------------------------------------------------------------

function setConnected(
  state: GameState,
  seat: SeatId,
  connected: boolean,
  at?: number,
): ReduceResult {
  const player = state.players[seat];
  if (!player) return fail('UNKNOWN_SEAT', `No such seat: ${seat}`);
  if (player.connected === connected) {
    return { state, events: [] };
  }

  // Coming back cancels every vote against you outright. Half a vote left
  // standing from an outage an hour ago should not help remove you later.
  const removeVotes = { ...state.removeVotes };
  if (connected) delete removeVotes[seat];

  const next: GameState = {
    ...state,
    removeVotes,
    players: {
      ...state.players,
      [seat]: { ...player, connected, disconnectedAt: connected ? null : (at ?? null) },
    },
    // The active seat's connection state chooses which budget applies, so a
    // drop or return mid-turn disarms the clock and the next TICK re-arms it
    // with the right one. Dropping shortens the turn to 90s; coming back
    // restores the full budget.
    turnDeadline: state.activeSeat === seat ? null : state.turnDeadline,
  };

  // The host is derived from connection state, so a drop or a return can move
  // it. Nothing is stored; the event exists so the change is visible in the
  // log rather than the Start button quietly appearing on someone else's
  // screen.
  const events: GameEvent[] = [{ t: 'connection_changed', seat, connected }];
  const before = getHostSeat(state);
  const after = getHostSeat(next);
  if (after !== null && after !== before) {
    events.push({
      t: 'log',
      text: `${next.players[after]?.name ?? after} is now the host`,
    });
  }

  return { state: next, events };
}

/**
 * Cast or withdraw a vote to remove an absent seat.
 *
 * Voting is deliberately clock-free so legality stays pure: the table may vote
 * the moment somebody drops, but the vote only *takes effect* once the grace
 * period has passed, which `tick` decides. See `resolveRemovals`.
 */
function voteRemove(
  state: GameState,
  seat: SeatId,
  target: SeatId,
  vote: boolean,
): ReduceResult {
  if (state.phase === 'game_over') return fail('GAME_OVER', 'The game is already over');

  const voter = state.players[seat];
  if (!voter) return fail('UNKNOWN_SEAT', `No such seat: ${seat}`);
  const victim = state.players[target];
  if (!victim) return fail('UNKNOWN_SEAT', `No such seat: ${target}`);

  if (seat === target) return fail('ILLEGAL_MOVE', 'You cannot vote to remove yourself');
  if (voter.removed) return fail('ILLEGAL_MOVE', 'A removed seat does not vote');
  if (victim.removed) return fail('ILLEGAL_MOVE', `${victim.name} is already removed`);
  if (victim.connected) {
    return fail('ILLEGAL_MOVE', `${victim.name} is still here`);
  }

  const current = state.removeVotes[target] ?? [];
  const has = current.includes(seat);
  if (has === vote) return { state, events: [] };

  const nextVoters = vote ? [...current, seat].sort() : current.filter((s) => s !== seat);
  const removeVotes = { ...state.removeVotes };
  if (nextVoters.length === 0) delete removeVotes[target];
  else removeVotes[target] = nextVoters;

  return {
    state: { ...state, removeVotes },
    events: [
      {
        t: 'log',
        text: vote
          ? `${voter.name} voted to remove ${victim.name} (${nextVoters.length}/${votesNeeded(state, target)})`
          : `${voter.name} withdrew their vote to remove ${victim.name}`,
      },
    ],
  };
}

/** Seats entitled to vote on removing `target`: present, playing, not the target. */
function eligibleVoters(state: GameState, target: SeatId): SeatId[] {
  return Object.values(state.players)
    .filter((p) => p.seatId !== target && p.connected && !p.removed && !p.isDead)
    .map((p) => p.seatId);
}

/** A strict majority of those entitled to vote. */
function votesNeeded(state: GameState, target: SeatId): number {
  return Math.floor(eligibleVoters(state, target).length / 2) + 1;
}

/**
 * Apply any removal whose votes have carried AND whose grace period has run
 * out. Both conditions are checked here, at tick time, rather than when the
 * vote is cast — the engine has no clock of its own, and the grace period is
 * the whole point of the feature.
 */
function resolveRemovals(state: GameState, now: number, content: Content): ReduceResult {
  let next = state;
  const events: GameEvent[] = [];

  for (const target of Object.keys(state.removeVotes)) {
    const victim = next.players[target];
    const voters = (next.removeVotes[target] ?? []).filter((s) => {
      const v = next.players[s];
      return v?.connected === true && !v.removed && !v.isDead;
    });

    if (!victim || victim.removed || victim.connected) continue;
    if (victim.disconnectedAt === null) continue;
    if (now - victim.disconnectedAt < next.timers.removeGraceMs) continue;
    if (voters.length < votesNeeded(next, target)) continue;

    // If the seat about to be removed owns the pending prompt, resolve it on
    // its default BEFORE the removal — while it is still a normal player, so
    // `finishDiscovery` writes a coherent state (it expects a seat that is
    // still in `turnOrder` and not yet `removed`). Left unresolved, the
    // prompt becomes unanswerable the instant this seat is `removed`
    // (`getLegalActions` returns `[]` early for a removed seat, full stop),
    // and the tile it carries sits in limbo until the turn clock expires —
    // D5's shape (docs/11-progress.md): a reachable state whose only escape
    // is a clock. This PR is what makes a prompt reachable at all, so it is
    // also what has to close this hole.
    if (next.pending?.seatId === target) {
      const resolved = resolvePromptWithDefault(next, content);
      next = resolved.state;
      events.push(...resolved.events);
    }
    const freshVictim = next.players[target]!;

    const removeVotes = { ...next.removeVotes };
    delete removeVotes[target];

    // nextSeatInOrder needs a seat still in the order to walk from, so the
    // successor is chosen before the removal is applied — but against `next`,
    // not `state`. A tick that carries two removals at once has already marked
    // the first one, and walking the original order would hand the turn to a
    // seat this same tick removed.
    const wasActive = next.activeSeat === target;
    const following = wasActive ? nextSeatInOrder(next, target) : null;

    // The explorer stays exactly where it is, holding what it holds. It simply
    // stops taking turns (docs/06-networking.md#disconnection-behaviour).
    next = {
      ...next,
      removeVotes,
      players: { ...next.players, [target]: { ...freshVictim, removed: true } },
      turnOrder: next.turnOrder.filter((s) => s !== target),
    };

    if (wasActive) {
      const newActive =
        following === null || following === target
          ? (next.turnOrder[0] ?? null)
          : following;
      next = { ...next, activeSeat: newActive, turnDeadline: null };
      // The removed seat's turn budget dies with it; the seat that inherits
      // the turn gets its own (D-f) — otherwise it would be stuck at
      // whatever movesLeft: 0 it had while merely waiting its turn.
      if (newActive) next = beginTurnFor(next, newActive, content);
    }

    events.push({
      t: 'log',
      text: `${freshVictim.name} was removed by vote after leaving the game`,
    });
  }

  return { state: next, events };
}

function concede(state: GameState, seat: SeatId, content: Content): ReduceResult {
  const player = state.players[seat];
  if (!player) return fail('UNKNOWN_SEAT', `No such seat: ${seat}`);
  if (state.phase === 'game_over') return fail('GAME_OVER', 'The game is already over');

  // If this seat owns the pending prompt, resolve it on its default BEFORE
  // it leaves — see the matching comment in `resolveRemovals`, which reaches
  // the same hole from the removal-vote side rather than concede.
  let working = state;
  const priorEvents: GameEvent[] = [];
  if (working.pending?.seatId === seat) {
    const resolved = resolvePromptWithDefault(working, content);
    working = resolved.state;
    priorEvents.push(...resolved.events);
  }
  // Re-read: resolving the prompt may have moved this seat (finishDiscovery
  // updates location/cameFrom/movesLeft), and spreading the stale `player`
  // below would silently revert that.
  const playerNow = working.players[seat]!;

  const remaining = Object.values(working.players).filter(
    (p) => p.seatId !== seat && !p.isDead,
  );
  if (remaining.length === 0) {
    return {
      state: {
        ...working,
        phase: 'game_over',
        turnDeadline: null,
        activeSeat: null,
        result: { outcome: 'abandoned', winners: [], reason: 'Everyone conceded' },
      },
      events: [
        ...priorEvents,
        { t: 'log', text: `${playerNow.name} conceded` },
        {
          t: 'game_over',
          result: { outcome: 'abandoned', winners: [], reason: 'Everyone conceded' },
        },
      ],
    };
  }

  const nextActive =
    working.activeSeat === seat ? nextSeatInOrder(working, seat) : working.activeSeat;
  const finalActive = nextActive === seat ? (remaining[0]?.seatId ?? null) : nextActive;

  let nextState: GameState = {
    ...working,
    players: { ...working.players, [seat]: { ...playerNow, isDead: true } },
    turnOrder: working.turnOrder.filter((s) => s !== seat),
    activeSeat: finalActive,
  };
  // Only re-arm the budget when the conceding seat was the one whose turn it
  // was (D-f) — a concede by someone else must not touch the active seat's
  // movesLeft mid-turn.
  if (working.activeSeat === seat && finalActive) {
    nextState = beginTurnFor(nextState, finalActive, content);
  }

  return {
    state: nextState,
    events: [...priorEvents, { t: 'log', text: `${playerNow.name} conceded` }],
  };
}

/** Whether a turn clock should be running at all. */
function turnClockRuns(state: GameState): boolean {
  return (
    (state.phase === 'explore' || state.phase === 'haunt') && state.activeSeat !== null
  );
}

/**
 * How long the active seat gets. A seat that has dropped gets the short budget
 * — the game does not pause for an absent player
 * (docs/06-networking.md#disconnection-behaviour).
 */
function turnBudget(state: GameState): number {
  const active = state.activeSeat === null ? undefined : state.players[state.activeSeat];
  return active?.connected === false ? state.timers.disconnectedMs : state.timers.turnMs;
}

/**
 * Apply a prompt's own `defaultAnswer` and clear it. The prompt is always
 * cleared, whichever branch runs — a prompt must never simply be able to
 * outlive the thing it is blocking.
 *
 * For `rotate_tile` this finishes the discovery on `defaultAnswer` rather
 * than dropping it: the tile is already off the deck the moment the prompt
 * was raised (see `moveThrough`), so discarding `pending` here would make
 * content vanish — an explorer stuck mid-doorway, a tile that is nowhere.
 *
 * The default goes through `validateAnswer` like any other answer, so a
 * timeout can only ever do something the seat could have chosen. If the
 * default is somehow not legal — invariant 7 says it cannot be for
 * `rotate_tile`, but this function must not be the place that finds out — the
 * first enumerable legal answer stands in, because for a `rotate_tile` prompt
 * "clear it instead" means losing a drawn tile.
 */
export function resolvePromptWithDefault(
  state: GameState,
  content: Content,
): ReduceResult {
  const pending = state.pending;
  if (!pending) return { state, events: [] };

  let answer = pending.defaultAnswer;
  if (!validateAnswer(pending, answer)) {
    const fallback = legalAnswersFor(pending)?.[0];
    if (fallback === undefined) return { state: { ...state, pending: null }, events: [] };
    answer = fallback;
  }

  return resumePrompt(state, pending, answer, content);
}

/**
 * Server-originated clock tick: the engine's only knowledge of time.
 *
 * `now` is carried in the action rather than read from a clock, so the engine
 * stays pure and a replayed log reproduces the same deadlines
 * (docs/05-engine.md#52-actions). A TICK does three things, in order:
 *
 *   1. arms an unarmed prompt clock, or resolves a prompt whose deadline has
 *      passed on its `defaultAnswer` — never both in one tick;
 *   2. arms the turn clock if it is not running yet — this is why the first
 *      TICK of a turn changes state even though nothing has expired;
 *   3. ends the turn if the turn clock has expired.
 *
 * The prompt clock is much shorter than the turn clock (`timers.promptMs`),
 * because a prompt blocks every seat at the table and a turn blocks only the
 * seat spending it. A prompt therefore times out *within* a turn: play resumes
 * on the default answer and the turn carries on, rather than the whole turn
 * being forfeited to one unanswered decision.
 *
 * A TICK with nothing to do returns the state unchanged, by reference, so the
 * server neither logs it nor counts it as room activity.
 */
function tick(state: GameState, now: number, content: Content): ReduceResult {
  let next = state;
  const events: GameEvent[] = [];

  // A seat that dropped before `at` was recorded (an action log written by an
  // older build) gets its clock started here rather than becoming unremovable.
  for (const p of Object.values(next.players)) {
    if (!p.connected && p.disconnectedAt === null) {
      next = {
        ...next,
        players: { ...next.players, [p.seatId]: { ...p, disconnectedAt: now } },
      };
    }
  }

  const removals = resolveRemovals(next, now, content);
  next = removals.state;
  events.push(...removals.events);

  // A prompt gets its own clock, armed here because raising it happened inside
  // an action that carried no `now`. Arming and expiring are deliberately
  // separate ticks: arming to `now + promptMs` and then testing `now >=
  // deadline` in the same pass would fire instantly whenever `promptMs` is 0,
  // and would read as "the prompt expired before anyone saw it".
  const armed = armPromptDeadline(next, now);
  const wasUnarmed = armed !== next;
  next = armed;

  const pending = next.pending;
  if (pending && !wasUnarmed && promptExpired(pending, now)) {
    const resolved = resolvePromptWithDefault(next, content);
    next = resolved.state;
    events.push(...resolved.events);
    events.push({
      t: 'log',
      text: 'A decision timed out and was resolved automatically',
    });
  }

  if (!turnClockRuns(next)) {
    // Disarm a clock left over from a phase that no longer has turns.
    if (next.turnDeadline !== null) next = { ...next, turnDeadline: null };
    return { state: next, events };
  }

  if (next.turnDeadline === null) {
    return { state: { ...next, turnDeadline: now + turnBudget(next) }, events };
  }

  if (now < next.turnDeadline) {
    return { state: next, events };
  }

  // Expired. Resolve any prompt still blocking the turn on its default answer
  // — an unanswered prompt must not be able to hold the room open past the
  // deadline — and pass play on. Resolving rather than dropping matters here
  // exactly as it does above: the explorer walks through the door on the
  // default rotation, THEN the turn ends, so the drawn tile is not a silent
  // content leak.
  const seat = next.activeSeat!;
  if (next.pending) {
    const resolved = resolvePromptWithDefault(next, content);
    next = resolved.state;
    events.push(...resolved.events);
  }

  const ended = endTurn(next, seat, content);
  if (ended.error) {
    // Nothing legal to do; disarm rather than spin on an expired deadline.
    return { state: { ...next, turnDeadline: null }, events };
  }

  return {
    state: ended.state,
    events: [
      ...events,
      { t: 'log', text: `${next.players[seat]?.name ?? seat} ran out of time` },
      ...ended.events,
    ],
  };
}

const CHAR_AGES: Record<string, number> = {
  'char.heather_granville': 18,
  'char.jenny_leclerc': 21,
  'char.ox_bellows': 23,
  'char.darrin_flash_williams': 20,
  'char.vivian_lopez': 42,
  'char.madame_zostra': 37,
  'char.missy_dubourde': 9,
  'char.zoe_ingstrom': 8,
  'char.peter_akimoto': 13,
  'char.brandon_jaspers': 12,
  'char.professor_longfellow': 57,
  'char.father_rhinehardt': 62,
};

function breakTie(
  candidates: SeatId[],
  revealerSeat: SeatId,
  turnOrder: SeatId[],
): SeatId {
  if (candidates.length === 0) return revealerSeat;
  if (candidates.includes(revealerSeat)) return revealerSeat;
  const revIdx = turnOrder.indexOf(revealerSeat);
  const sorted = [...candidates].sort((a, b) => {
    const distA = (turnOrder.indexOf(a) - revIdx + turnOrder.length) % turnOrder.length;
    const distB = (turnOrder.indexOf(b) - revIdx + turnOrder.length) % turnOrder.length;
    return distA - distB;
  });
  return sorted[0]!;
}

function triggerHaunt(
  state: GameState,
  revealerSeat: SeatId,
  omenCardId: string,
  tileId: string,
  content: Content,
): { state: GameState; events: GameEvent[] } {
  let hauntId = 1;
  const hauntKey = `${omenCardId}:${tileId}`;
  if (content.hauntByOmenAndRoom && content.hauntByOmenAndRoom[hauntKey]) {
    hauntId = content.hauntByOmenAndRoom[hauntKey]!;
  } else if (content.haunts && content.haunts.length > 0) {
    const list = content.haunts;
    let sum = 0;
    for (let i = 0; i < omenCardId.length; i++) sum += omenCardId.charCodeAt(i);
    for (let i = 0; i < tileId.length; i++) sum += tileId.charCodeAt(i);
    hauntId = list[sum % list.length]!.id;
  }

  const hauntDef = content.hauntsById[hauntId] ?? content.haunts[0];
  const traitorRule = hauntDef?.traitorRule ?? { kind: 'trigger' };

  let traitorSeat: SeatId | null = null;
  const livingSeats = state.turnOrder.filter(
    (s) => state.players[s] && !state.players[s]!.isDead && !state.players[s]!.removed,
  );

  switch (traitorRule.kind) {
    case 'trigger':
      traitorSeat = revealerSeat;
      break;
    case 'none':
    case 'hidden':
      traitorSeat = null;
      break;
    case 'left_of_revealer': {
      const eligible = livingSeats.filter((s) => s !== revealerSeat);
      traitorSeat =
        eligible.length > 0
          ? breakTie(eligible, revealerSeat, state.turnOrder)
          : revealerSeat;
      break;
    }
    case 'specific_character_or_trait': {
      const match = livingSeats.find(
        (s) => state.players[s]?.charId === traitorRule.characterId,
      );
      if (match) {
        traitorSeat = match;
      } else {
        const candidates = livingSeats;
        let bestVal = traitorRule.fallbackComparison === 'highest' ? -Infinity : Infinity;
        let tied: SeatId[] = [];
        for (const s of candidates) {
          const val = traitValue(state, s, traitorRule.fallbackTrait, content);
          if (traitorRule.fallbackComparison === 'highest') {
            if (val > bestVal) {
              bestVal = val;
              tied = [s];
            } else if (val === bestVal) {
              tied.push(s);
            }
          } else {
            if (val < bestVal) {
              bestVal = val;
              tied = [s];
            } else if (val === bestVal) {
              tied.push(s);
            }
          }
        }
        traitorSeat = breakTie(tied, revealerSeat, state.turnOrder);
      }
      break;
    }
    case 'specific_character_or_left': {
      const match = livingSeats.find(
        (s) => state.players[s]?.charId === traitorRule.characterId,
      );
      if (match) {
        traitorSeat = match;
      } else {
        const eligible = livingSeats.filter((s) => s !== revealerSeat);
        traitorSeat =
          eligible.length > 0
            ? breakTie(eligible, revealerSeat, state.turnOrder)
            : revealerSeat;
      }
      break;
    }
    case 'age': {
      const candidates = traitorRule.excludeRevealer
        ? livingSeats.filter((s) => s !== revealerSeat)
        : livingSeats;
      const pool = candidates.length > 0 ? candidates : livingSeats;
      let targetAge = traitorRule.comparison === 'oldest' ? -Infinity : Infinity;
      let tied: SeatId[] = [];
      for (const s of pool) {
        const charId = state.players[s]?.charId;
        const age: number = charId ? (CHAR_AGES[charId] ?? 30) : 30;
        if (traitorRule.comparison === 'oldest') {
          if (age > targetAge) {
            targetAge = age;
            tied = [s];
          } else if (age === targetAge) {
            tied.push(s);
          }
        } else {
          if (age < targetAge) {
            targetAge = age;
            tied = [s];
          } else if (age === targetAge) {
            tied.push(s);
          }
        }
      }
      traitorSeat = breakTie(tied, revealerSeat, state.turnOrder);
      break;
    }
    case 'holder': {
      const holder = livingSeats.find((s) => {
        const p = state.players[s]!;
        return (
          p.items.includes(traitorRule.cardId) || p.omens.includes(traitorRule.cardId)
        );
      });
      traitorSeat = holder ?? revealerSeat;
      break;
    }
    case 'highest': {
      const candidates = traitorRule.excludeRevealer
        ? livingSeats.filter((s) => s !== revealerSeat)
        : livingSeats;
      const pool = candidates.length > 0 ? candidates : livingSeats;
      let bestVal = -Infinity;
      let tied: SeatId[] = [];
      for (const s of pool) {
        const val = traitValue(state, s, traitorRule.trait, content);
        if (val > bestVal) {
          bestVal = val;
          tied = [s];
        } else if (val === bestVal) {
          tied.push(s);
        }
      }
      traitorSeat = breakTie(tied, revealerSeat, state.turnOrder);
      break;
    }
    case 'lowest': {
      const candidates = traitorRule.excludeRevealer
        ? livingSeats.filter((s) => s !== revealerSeat)
        : livingSeats;
      const pool = candidates.length > 0 ? candidates : livingSeats;
      let worstVal = Infinity;
      let tied: SeatId[] = [];
      for (const s of pool) {
        const val = traitValue(state, s, traitorRule.trait, content);
        if (val < worstVal) {
          worstVal = val;
          tied = [s];
        } else if (val === worstVal) {
          tied.push(s);
        }
      }
      traitorSeat = breakTie(tied, revealerSeat, state.turnOrder);
      break;
    }
  }

  const nextPlayers = { ...state.players };
  if (traitorSeat && nextPlayers[traitorSeat]) {
    nextPlayers[traitorSeat] = {
      ...nextPlayers[traitorSeat]!,
      isTraitor: true,
    };
  }

  const nextMonsters: Record<MonsterId, MonsterState> = { ...state.monsters };
  const nextTokens: TokenState[] = [...state.tokens];

  const hauntLoc =
    (traitorSeat ? nextPlayers[traitorSeat]?.location : null) ??
    nextPlayers[revealerSeat]?.location ??
    null;

  if (hauntId === 1) {
    nextMonsters['monster.mummy'] = {
      id: 'monster.mummy',
      def: 'The Mummy',
      location: hauntLoc,
      isDead: false,
      flags: { might: 5, speed: 3, sanity: 4, stunned: false },
    };
    nextTokens.push({
      id: 'token.sarcophagus',
      token: 'Sarcophagus',
      location: hauntLoc,
      flags: { opened: false },
    });
  } else if (hauntId === 2) {
    nextMonsters['monster.spirit'] = {
      id: 'monster.spirit',
      def: 'Restless Spirit',
      location: hauntLoc,
      isDead: false,
      flags: { might: 3, speed: 4, sanity: 5, stunned: false },
    };
    nextTokens.push({
      id: 'token.spirit_board',
      token: 'Spirit Board',
      location: nextPlayers[revealerSeat]?.location ?? hauntLoc,
      flags: { active: true },
    });
  } else if (hauntId === 5) {
    nextMonsters['monster.werewolf'] = {
      id: 'monster.werewolf',
      def: 'Werewolf',
      location: hauntLoc,
      isDead: false,
      flags: { might: 6, speed: 4, sanity: 3, stunned: false },
    };
  } else {
    const mId = `monster.haunt_${hauntId}`;
    nextMonsters[mId] = {
      id: mId,
      def: hauntDef?.name ?? 'Haunt Monster',
      location: hauntLoc,
      isDead: false,
      flags: { might: 4, speed: 3, sanity: 4, stunned: false },
    };
    nextTokens.push({
      id: `token.haunt_${hauntId}`,
      token: 'Ritual Objective',
      location: hauntLoc,
      flags: {},
    });
  }

  let nextTurnOrder = state.turnOrder;
  if (traitorSeat && state.turnOrder.includes(traitorSeat)) {
    const tIdx = state.turnOrder.indexOf(traitorSeat);
    nextTurnOrder = [
      ...state.turnOrder.slice(tIdx + 1),
      ...state.turnOrder.slice(0, tIdx + 1),
    ];
  }

  const nextState: GameState = {
    ...state,
    phase: 'haunt',
    turnOrder: nextTurnOrder,
    players: nextPlayers,
    monsters: nextMonsters,
    monsterTurn: null,
    tokens: nextTokens,
    haunt: {
      hauntId,
      traitorSeat,
      revealed: true,
      acknowledged: [],
      heroSide: hauntDef?.heroes,
      traitorSide: hauntDef?.traitor,
      hauntTitle: hauntDef?.name,
    },
  };

  const events: GameEvent[] = [
    { t: 'haunt_begun', hauntId, traitor: traitorSeat },
    {
      t: 'log',
      text: `Haunt #${hauntId}: "${hauntDef?.name ?? 'The Haunt'}" has begun! Monsters and tokens have appeared in the house.`,
    },
  ];

  return { state: nextState, events };
}

function useItem(
  state: GameState,
  seat: SeatId,
  cardId: CardId,
  target: TargetRef | undefined,
  content: Content,
): ReduceResult {
  if (!['explore', 'haunt'].includes(state.phase)) {
    return fail('WRONG_PHASE', `Cannot use items during ${state.phase}`);
  }
  if (state.activeSeat !== seat) return fail('NOT_YOUR_TURN', 'It is not your turn');
  if (state.pending !== null) {
    return fail('ILLEGAL_MOVE', 'Cannot use items while a prompt is pending');
  }
  const player = state.players[seat];
  if (!player || player.isDead || player.removed)
    return fail('ILLEGAL_MOVE', 'Cannot use items');
  const hasCard = player.items.includes(cardId) || player.omens.includes(cardId);
  if (!hasCard) return fail('ILLEGAL_MOVE', `Player does not have card ${cardId}`);

  const card = content.cardsById[cardId];
  if (!card) return fail('ILLEGAL_MOVE', `Card ${cardId} does not exist`);

  if (card.use?.kind === 'passive') {
    return fail('ILLEGAL_MOVE', `${card.name} is passive and cannot be actively used`);
  }
  if (card.use?.kind === 'manual') {
    return fail('ILLEGAL_MOVE', `${card.name} is manual/unsupported`);
  }
  if (!card.onUse || card.onUse.length === 0) {
    return fail('ILLEGAL_MOVE', `${card.name} has no onUse effect`);
  }
  if (card.use?.kind === 'once_per_turn' && player.usedCardsThisTurn?.includes(cardId)) {
    return fail('ILLEGAL_MOVE', `${card.name} has already been used this turn`);
  }

  let nextState = state;
  const events: GameEvent[] = [];

  const usedThisTurn = [...(player.usedCardsThisTurn ?? []), cardId];
  nextState = {
    ...nextState,
    players: {
      ...nextState.players,
      [seat]: {
        ...nextState.players[seat]!,
        usedCardsThisTurn: usedThisTurn,
      },
    },
  };

  const outcome = runEffects(
    nextState,
    card.onUse,
    {
      actor: seat,
      chosen: target
        ? target.kind === 'seat'
          ? target.seatId
          : target.monsterId
        : undefined,
    },
    content,
  );
  nextState = outcome.state;
  events.push(...outcome.events);

  if (cardId === 'item.adrenaline_shot') {
    const curPlayer = nextState.players[seat]!;
    nextState = {
      ...nextState,
      players: {
        ...nextState.players,
        [seat]: {
          ...curPlayer,
          movesLeft: curPlayer.movesLeft + 4,
        },
      },
    };
  }

  if (!card.keepInPlay || card.use?.kind === 'consumable') {
    if (nextState.pending !== null) {
      if (isEffectPromptPayload(nextState.pending.payload)) {
        nextState = {
          ...nextState,
          pending: {
            ...nextState.pending,
            payload: {
              ...nextState.pending.payload,
              resume: {
                ...nextState.pending.payload.resume,
                discardCardId: cardId,
              },
            },
          },
        };
      }
    } else {
      nextState = discardCardFromSeat(nextState, seat, cardId, content);
    }
  }

  events.push({ t: 'log', text: `${player.name} used ${card.name}.` });
  return { state: nextState, events };
}

function dropItems(
  state: GameState,
  seat: SeatId,
  cardIds: CardId[],
  content: Content,
): ReduceResult {
  if (!['explore', 'haunt'].includes(state.phase)) {
    return fail('WRONG_PHASE', `Cannot drop items during ${state.phase}`);
  }
  if (state.activeSeat !== seat) return fail('NOT_YOUR_TURN', 'It is not your turn');
  if (state.pending !== null) {
    return fail('ILLEGAL_MOVE', 'Cannot drop items while a prompt is pending');
  }
  const player = state.players[seat];
  if (!player || player.isDead || player.removed || player.location === null) {
    return fail('ILLEGAL_MOVE', 'Cannot drop items');
  }
  if (cardIds.length === 0) {
    return fail('ILLEGAL_MOVE', 'No cards specified to drop');
  }

  for (const id of cardIds) {
    if (!player.items.includes(id) && !player.omens.includes(id)) {
      return fail('ILLEGAL_MOVE', `Player does not have card ${id}`);
    }
    const card = content.cardsById[id];
    if (card?.isCompanion || id === 'omen.bite') {
      return fail('ILLEGAL_MOVE', `Cannot drop companion or Bite (${id})`);
    }
  }

  const currentLoc = player.location;
  const tile = state.board.placed[currentLoc]!;
  const existingDropped = tile.droppedItems ?? [];
  const newDropped = [...existingDropped, ...cardIds];

  const nextItems = player.items.filter((id) => !cardIds.includes(id));
  const nextOmens = player.omens.filter((id) => !cardIds.includes(id));

  const nextState: GameState = {
    ...state,
    board: {
      ...state.board,
      placed: {
        ...state.board.placed,
        [currentLoc]: {
          ...tile,
          droppedItems: newDropped,
          flags: { ...tile.flags, dropped: newDropped.join(',') },
        },
      },
    },
    players: {
      ...state.players,
      [seat]: { ...player, items: nextItems, omens: nextOmens },
    },
  };

  const cardNames = cardIds.map((id) => content.cardsById[id]?.name ?? id).join(', ');
  return {
    state: nextState,
    events: [{ t: 'log', text: `${player.name} dropped ${cardNames}.` }],
  };
}

function pickupItems(
  state: GameState,
  seat: SeatId,
  cardIds: CardId[],
  content: Content,
): ReduceResult {
  if (!['explore', 'haunt'].includes(state.phase)) {
    return fail('WRONG_PHASE', `Cannot pick up items during ${state.phase}`);
  }
  if (state.activeSeat !== seat) return fail('NOT_YOUR_TURN', 'It is not your turn');
  if (state.pending !== null) {
    return fail('ILLEGAL_MOVE', 'Cannot pick up items while a prompt is pending');
  }
  const player = state.players[seat];
  if (!player || player.isDead || player.removed || player.location === null) {
    return fail('ILLEGAL_MOVE', 'Cannot pick up items');
  }
  if (cardIds.length === 0) {
    return fail('ILLEGAL_MOVE', 'No cards specified to pick up');
  }

  const currentLoc = player.location;
  const tile = state.board.placed[currentLoc];
  if (!tile) return fail('ILLEGAL_MOVE', 'Current tile not found');

  const tileDropped = tile.droppedItems ?? [];
  for (const id of cardIds) {
    if (!tileDropped.includes(id)) {
      return fail('ILLEGAL_MOVE', `Card ${id} is not in the room`);
    }
  }

  const nextDropped = tileDropped.filter((id) => !cardIds.includes(id));
  const newItems = [...player.items];
  const newOmens = [...player.omens];

  for (const id of cardIds) {
    const card = content.cardsById[id];
    if (card?.deck === 'omen') {
      newOmens.push(id);
    } else {
      newItems.push(id);
    }
  }

  const nextState: GameState = {
    ...state,
    board: {
      ...state.board,
      placed: {
        ...state.board.placed,
        [currentLoc]: {
          ...tile,
          droppedItems: nextDropped,
          flags: { ...tile.flags, dropped: nextDropped.join(',') },
        },
      },
    },
    players: {
      ...state.players,
      [seat]: {
        ...player,
        items: newItems,
        omens: newOmens,
      },
    },
  };

  const cardNames = cardIds.map((id) => content.cardsById[id]?.name ?? id).join(', ');
  const events: GameEvent[] = [
    { t: 'log', text: `${player.name} picked up ${cardNames}.` },
  ];

  return { state: nextState, events };
}

function commandDog(
  state: GameState,
  seat: SeatId,
  destination: PlacedId,
  cardId: CardId | undefined,
  content: Content,
): ReduceResult {
  if (!['explore', 'haunt'].includes(state.phase)) {
    return fail('WRONG_PHASE', `Cannot command Dog during ${state.phase}`);
  }
  if (state.activeSeat !== seat) return fail('NOT_YOUR_TURN', 'It is not your turn');
  if (state.pending !== null) {
    return fail('ILLEGAL_MOVE', 'Cannot command Dog while a prompt is pending');
  }
  const player = state.players[seat];
  if (!player || player.isDead || player.removed || player.location === null) {
    return fail('ILLEGAL_MOVE', 'Cannot command Dog');
  }
  if (!player.items.includes('omen.dog') && !player.omens.includes('omen.dog')) {
    return fail('ILLEGAL_MOVE', 'Player does not have the Dog');
  }
  if (
    player.usedCardsThisTurn?.includes('omen.dog') ||
    player.flags['dog_used_this_turn']
  ) {
    return fail('ILLEGAL_MOVE', 'Dog can only be commanded once per turn');
  }

  const reachable = getDogReachableRooms(state, player.location, content);
  if (!reachable.includes(destination)) {
    return fail('ILLEGAL_MOVE', 'Destination room is not reachable by the Dog');
  }

  const destTile = state.board.placed[destination];
  if (!destTile) {
    return fail('ILLEGAL_MOVE', 'Destination room does not exist');
  }

  let nextPlayerItems = [...player.items];
  let nextPlayerOmens = [...player.omens];
  let nextDestDropped = [...(destTile.droppedItems ?? [])];
  let logText = '';
  const destName = content.tilesById[destTile.tileId]?.name ?? 'destination';

  if (cardId) {
    const isOwnerItem = player.items.includes(cardId);
    const isOwnerOmen = player.omens.includes(cardId);
    const isDestDropped = nextDestDropped.includes(cardId);
    const cardDef = content.cardsById[cardId];

    if (cardDef?.isCompanion || cardId === 'omen.dog' || cardId === 'omen.bite') {
      return fail(
        'ILLEGAL_MOVE',
        `Dog cannot carry or fetch companion or Bite (${cardId})`,
      );
    }

    if (isOwnerItem || isOwnerOmen) {
      // Carry from owner and drop at destination
      if (isOwnerItem) {
        nextPlayerItems = nextPlayerItems.filter((c) => c !== cardId);
      } else {
        nextPlayerOmens = nextPlayerOmens.filter((c) => c !== cardId);
      }
      nextDestDropped.push(cardId);
      logText = `${player.name} sent the Dog carrying ${cardDef?.name ?? cardId} to ${destName}.`;
    } else if (isDestDropped) {
      // Fetch from destination floor to owner
      nextDestDropped = nextDestDropped.filter((c) => c !== cardId);
      if (cardDef?.deck === 'omen') {
        nextPlayerOmens.push(cardId);
      } else {
        nextPlayerItems.push(cardId);
      }
      logText = `${player.name} sent the Dog to fetch ${cardDef?.name ?? cardId} from ${destName}.`;
    } else {
      return fail('ILLEGAL_MOVE', `Card ${cardId} is not available to carry or fetch`);
    }
  } else {
    logText = `${player.name} sent the Dog to ${destName}.`;
  }

  const usedCards = [...(player.usedCardsThisTurn ?? []), 'omen.dog'];
  const nextPlayerFlags = {
    ...player.flags,
    dog_used_this_turn: true,
  };

  const nextState: GameState = {
    ...state,
    board: {
      ...state.board,
      placed: {
        ...state.board.placed,
        [destination]: {
          ...destTile,
          droppedItems: nextDestDropped,
          flags: { ...destTile.flags, dropped: nextDestDropped.join(',') },
        },
      },
    },
    players: {
      ...state.players,
      [seat]: {
        ...player,
        items: nextPlayerItems,
        omens: nextPlayerOmens,
        usedCardsThisTurn: usedCards,
        flags: nextPlayerFlags,
      },
    },
    flags: {
      ...state.flags,
      dog_last_run: destination,
    },
  };

  return {
    state: nextState,
    events: [{ t: 'log', text: logText }],
  };
}

function drawItemCard(
  state: GameState,
  seat: SeatId,
  content: Content,
): { state: GameState; events: GameEvent[] } {
  let workingState = state;
  const events: GameEvent[] = [];
  let deck = workingState.decks.item;
  if (deck.draw.length === 0 && deck.discard.length > 0 && workingState.rng) {
    const [shuffled, newRng] = shuffle(workingState.rng, deck.discard);
    deck = { ...deck, draw: shuffled, discard: [] };
    workingState = {
      ...workingState,
      rng: newRng,
      decks: { ...workingState.decks, item: deck },
    };
  }

  if (deck.draw.length > 0) {
    const cardId = deck.draw[0]!;
    const nextDraw = deck.draw.slice(1);
    const cardDef = content.cardsById[cardId];
    events.push({ t: 'drew_card', seat, deck: 'item', cardId });

    const nextInPlay = [...deck.inPlay, cardId];
    const nextDeck = { ...deck, draw: nextDraw, inPlay: nextInPlay };
    const currentPlayer = workingState.players[seat]!;
    workingState = {
      ...workingState,
      decks: { ...workingState.decks, item: nextDeck },
      players: {
        ...workingState.players,
        [seat]: { ...currentPlayer, items: [...currentPlayer.items, cardId] },
      },
    };
    if (cardDef?.onDraw && cardDef.onDraw.length > 0) {
      const effOutcome = runEffects(
        workingState,
        cardDef.onDraw,
        { actor: seat },
        content,
      );
      workingState = effOutcome.state;
      events.push(...effOutcome.events);
    }
  }
  return { state: workingState, events };
}

/** WIP: will be wired into movement/discovery flow in Task 9. */
export function resolveMysticElevator(
  state: GameState,
  seat: SeatId,
  elevatorPlacedId: PlacedId,
  content: Content,
): { state: GameState; events: GameEvent[] } {
  const player = state.players[seat];
  if (!player) return { state, events: [] };
  const turnKey = `elevator_moved_${state.round}_${seat}`;
  if (state.flags[turnKey]) {
    return { state, events: [] };
  }

  const events: GameEvent[] = [];
  let workingState: GameState = {
    ...state,
    flags: { ...state.flags, [turnKey]: true },
  };

  const rng = workingState.rng ?? makeRng(12345);
  const [dice, total, nextRng] = rollDice(rng, 2);
  workingState = { ...workingState, rng: nextRng };
  events.push({
    t: 'rolled',
    seat,
    dice,
    total,
    reason: 'Mystic Elevator Destination Roll',
  });

  let targetFloors: Floor[];
  let damage = 0;

  if (total >= 4) {
    targetFloors = ['upper', 'ground', 'basement'];
  } else if (total === 3) {
    targetFloors = ['upper'];
  } else if (total === 2) {
    targetFloors = ['ground'];
  } else if (total === 1) {
    targetFloors = ['basement'];
  } else {
    targetFloors = ['basement'];
    damage = 1;
  }

  let destinationFound: {
    floor: Floor;
    x: number;
    y: number;
    rotation: Rotation;
  } | null = null;

  const placedElevator = workingState.board.placed[elevatorPlacedId];
  if (!placedElevator) return { state: workingState, events };
  const elevDef = content.tilesById[placedElevator.tileId]!;

  for (const floor of targetFloors) {
    const placedOnFloor = Object.values(workingState.board.placed).filter(
      (p) => p.floor === floor && p.id !== elevatorPlacedId,
    );
    for (const placed of placedOnFloor) {
      const pDef = content.tilesById[placed.tileId];
      if (!pDef) continue;
      const pDoors = rotateDoors(pDef.doors, placed.rotation);
      for (const dir of DIR_ORDER) {
        if (!pDoors[dir]) continue;
        const [nx, ny] = neighbourCell(placed.x, placed.y, dir);
        if (
          !workingState.board.index[floor][cellKey(nx, ny)] &&
          !(
            placedElevator.floor === floor &&
            placedElevator.x === nx &&
            placedElevator.y === ny
          )
        ) {
          const rots = legalRotations(elevDef, OPPOSITE[dir]);
          if (rots.length > 0) {
            destinationFound = {
              floor,
              x: nx,
              y: ny,
              rotation: rots[0]!,
            };
            break;
          }
        }
      }
      if (destinationFound) break;
    }
    if (destinationFound) break;
  }

  if (destinationFound) {
    const oldFloor = placedElevator.floor;
    const oldKey = cellKey(placedElevator.x, placedElevator.y);
    const newId = placedIdFor(
      destinationFound.floor,
      destinationFound.x,
      destinationFound.y,
    );

    const nextIndex: Record<Floor, Record<string, PlacedId>> = {
      ...workingState.board.index,
      [oldFloor]: { ...workingState.board.index[oldFloor] },
      [destinationFound.floor]: { ...workingState.board.index[destinationFound.floor] },
    };
    delete nextIndex[oldFloor][oldKey];
    nextIndex[destinationFound.floor][cellKey(destinationFound.x, destinationFound.y)] =
      newId;

    const nextPlaced = { ...workingState.board.placed };
    delete nextPlaced[elevatorPlacedId];
    nextPlaced[newId] = {
      ...placedElevator,
      id: newId,
      floor: destinationFound.floor,
      x: destinationFound.x,
      y: destinationFound.y,
      rotation: destinationFound.rotation,
    };

    const nextPlayers = { ...workingState.players };
    for (const [pSeat, pState] of Object.entries(nextPlayers)) {
      if (pState.location === elevatorPlacedId) {
        nextPlayers[pSeat as SeatId] = { ...pState, location: newId };
      }
    }

    const nextTokens = workingState.tokens.map((t) =>
      t.location === elevatorPlacedId ? { ...t, location: newId } : t,
    );

    workingState = {
      ...workingState,
      board: {
        ...workingState.board,
        placed: nextPlaced,
        index: nextIndex,
      },
      players: nextPlayers,
      tokens: nextTokens,
    };

    events.push({
      t: 'moved',
      seat,
      from: elevatorPlacedId,
      to: newId,
    });
    events.push({
      t: 'log',
      text: `The Mystic Elevator clanks into motion and moves to the ${destinationFound.floor} floor!`,
    });
  } else {
    events.push({
      t: 'log',
      text: `The Mystic Elevator gears grind, but it remains in place.`,
    });
  }

  if (damage > 0) {
    const [dmgDice, dmgTotal, finalRng] = rollDice(workingState.rng ?? makeRng(12345), 1);
    workingState = { ...workingState, rng: finalRng };
    events.push({
      t: 'rolled',
      seat,
      dice: dmgDice,
      total: dmgTotal,
      reason: 'Mystic Elevator Fall Damage',
    });

    if (dmgTotal > 0) {
      const damageEffects: Effect[] = [];
      for (let i = 0; i < dmgTotal; i++) {
        damageEffects.push({
          e: 'prompt',
          who: 'actor',
          prompt: {
            kind: 'choose_trait',
            traits: ['speed', 'might'],
          },
          then: [
            {
              e: 'trait',
              who: 'actor',
              trait: { ref: 'chosen' },
              delta: -1,
            },
            {
              e: 'log',
              text: `${player.name} took 1 physical damage from the Mystic Elevator.`,
            },
          ],
        });
      }
      const dmgOutcome = runEffects(
        workingState,
        damageEffects,
        { actor: seat },
        content,
      );
      workingState = dmgOutcome.state;
      events.push(...dmgOutcome.events);
    }
  }

  return { state: workingState, events };
}

export function resolveCollapsedRoomDiscovery(
  state: GameState,
  seat: SeatId,
  collapsedRoomId: PlacedId,
  content: Content,
): { state: GameState; events: GameEvent[] } {
  const player = state.players[seat];
  if (!player) return { state, events: [] };
  const flagKey = `collapsed_room_discovered_${collapsedRoomId}`;
  if (state.flags[flagKey]) return { state, events: [] };

  const events: GameEvent[] = [];
  let workingState: GameState = {
    ...state,
    flags: { ...state.flags, [flagKey]: true },
  };

  const rng = workingState.rng ?? makeRng(12345);
  const speedVal = Math.max(
    1,
    Math.min(8, traitValue(workingState, seat, 'speed', content)),
  );
  const [dice, total, nextRng] = rollDice(rng, speedVal);
  workingState = { ...workingState, rng: nextRng };

  events.push({
    t: 'rolled',
    seat,
    dice,
    total,
    reason: 'Collapsed Room Fall Avoidance (Speed 5+)',
  });

  if (total >= 5) {
    events.push({
      t: 'log',
      text: `${player.name} rolled ${total} (needed 5+) and avoided falling through the Collapsed Room!`,
    });
    return { state: workingState, events };
  }

  events.push({
    t: 'log',
    text: `${player.name} rolled ${total} (needed 5+) and fell through the hole in the Collapsed Room!`,
  });

  // Draw and place a basement tile
  let destId: PlacedId | null = null;
  const drawRes = drawTile(
    workingState.tileDeck,
    workingState.tileDiscard ?? [],
    'basement',
    content,
    workingState.rng ?? makeRng(12345),
  );

  if (drawRes) {
    workingState = {
      ...workingState,
      tileDeck: drawRes.deck,
      tileDiscard: drawRes.discard,
      rng: drawRes.rng,
    };
    const bTileDef = content.tilesById[drawRes.tileId];
    // Find open doorway on basement
    const basementTiles = Object.values(workingState.board.placed).filter(
      (p) => p.floor === 'basement',
    );
    let targetSlot: { x: number; y: number; rotation: Rotation } | null = null;
    for (const bTile of basementTiles) {
      const bDef = content.tilesById[bTile.tileId];
      if (!bDef) continue;
      const bDoors = rotateDoors(bDef.doors, bTile.rotation);
      for (const dir of DIR_ORDER) {
        if (!bDoors[dir]) continue;
        const [nx, ny] = neighbourCell(bTile.x, bTile.y, dir);
        if (!workingState.board.index.basement[cellKey(nx, ny)]) {
          const rots = bTileDef ? legalRotations(bTileDef, OPPOSITE[dir]) : [];
          if (rots.length > 0) {
            targetSlot = { x: nx, y: ny, rotation: rots[0]! };
            break;
          }
        }
      }
      if (targetSlot) break;
    }

    if (targetSlot && bTileDef) {
      destId = placedIdFor('basement', targetSlot.x, targetSlot.y);
      const newPlaced: PlacedTile = {
        id: destId,
        tileId: drawRes.tileId,
        floor: 'basement',
        x: targetSlot.x,
        y: targetSlot.y,
        rotation: targetSlot.rotation,
        discoveredBy: seat,
        flags: {},
      };
      workingState = {
        ...workingState,
        board: {
          ...workingState.board,
          placed: { ...workingState.board.placed, [destId]: newPlaced },
          index: {
            ...workingState.board.index,
            basement: {
              ...workingState.board.index.basement,
              [cellKey(targetSlot.x, targetSlot.y)]: destId,
            },
          },
        },
      };
      events.push({ t: 'discovered', seat, placed: newPlaced });
    }
  }

  if (!destId) {
    destId =
      workingState.board.index.basement['0,0'] ??
      Object.keys(workingState.board.placed).find(
        (pid) => workingState.board.placed[pid]?.floor === 'basement',
      ) ??
      null;
  }

  if (destId) {
    const tokenState: TokenState = {
      id: 'token.below_collapsed_room',
      token: 'Below Collapsed Room',
      location: destId,
      flags: {},
    };
    workingState = {
      ...workingState,
      tokens: [
        ...workingState.tokens.filter((t) => t.token !== 'Below Collapsed Room'),
        tokenState,
      ],
      players: {
        ...workingState.players,
        [seat]: {
          ...workingState.players[seat]!,
          location: destId,
          movesLeft: 0,
        },
      },
    };
    events.push({ t: 'moved', seat, from: collapsedRoomId, to: destId });
    events.push({
      t: 'log',
      text: 'Token "Below Collapsed Room" placed in the basement.',
    });

    // Take 1 die of physical damage
    const [dmgDice, dmgTotal, dmgRng] = rollDice(workingState.rng ?? makeRng(12345), 1);
    workingState = { ...workingState, rng: dmgRng };
    events.push({
      t: 'rolled',
      seat,
      dice: dmgDice,
      total: dmgTotal,
      reason: 'Collapsed Room Fall Damage',
    });

    if (dmgTotal > 0) {
      const damageEffects: Effect[] = [];
      for (let i = 0; i < dmgTotal; i++) {
        damageEffects.push({
          e: 'prompt',
          who: 'actor',
          prompt: {
            kind: 'choose_trait',
            traits: ['speed', 'might'],
          },
          then: [
            {
              e: 'trait',
              who: 'actor',
              trait: { ref: 'chosen' },
              delta: -1,
            },
            {
              e: 'log',
              text: `${player.name} took 1 physical damage from falling through the Collapsed Room.`,
            },
          ],
        });
      }
      const dmgOutcome = runEffects(
        workingState,
        damageEffects,
        { actor: seat },
        content,
      );
      workingState = dmgOutcome.state;
      events.push(...dmgOutcome.events);
    }
  }

  return { state: workingState, events };
}

function roomAction(
  state: GameState,
  seat: SeatId,
  actionId: string,
  content: Content,
): ReduceResult {
  if (!['explore', 'haunt'].includes(state.phase)) {
    return fail('WRONG_PHASE', `Cannot perform room action during ${state.phase}`);
  }
  if (state.activeSeat !== seat) return fail('NOT_YOUR_TURN', 'It is not your turn');
  const player = state.players[seat];
  if (!player || player.isDead || player.location === null) {
    return fail('ILLEGAL_MOVE', 'Cannot perform room action');
  }

  if (actionId === 'interact_token') {
    const tokenIndex = state.tokens.findIndex(
      (t) => t.location === player.location && !t.flags['completed'],
    );
    if (tokenIndex !== -1) {
      const token = state.tokens[tokenIndex]!;
      const updatedTokens = [...state.tokens];
      updatedTokens[tokenIndex] = {
        ...token,
        flags: { ...token.flags, completed: true },
      };
      const events: GameEvent[] = [
        { t: 'log', text: `${player.name} interacted with ${token.token}!` },
      ];
      return {
        state: {
          ...state,
          tokens: updatedTokens,
        },
        events,
      };
    }
    return fail('ILLEGAL_MOVE', 'No token to interact with here');
  }

  if (actionId === 'action.collapsed_room.fall') {
    const token = state.tokens.find((t) => t.token === 'Below Collapsed Room');
    const targetLoc =
      token?.location ??
      state.board.index.basement['0,0'] ??
      Object.keys(state.board.placed).find(
        (pid) => state.board.placed[pid]?.floor === 'basement',
      );
    if (!targetLoc) {
      return fail('ILLEGAL_MOVE', 'No basement room placed to fall into');
    }

    const events: GameEvent[] = [];
    const fromLoc = player.location;
    const toLoc = targetLoc;

    let workingState: GameState = {
      ...state,
      players: {
        ...state.players,
        [seat]: {
          ...player,
          location: toLoc,
        },
      },
    };
    events.push({ t: 'moved', seat, from: fromLoc, to: toLoc });

    const rng = workingState.rng ?? makeRng(12345);
    const [dice, total, nextRng] = rollDice(rng, 1);
    workingState = { ...workingState, rng: nextRng };
    events.push({
      t: 'rolled',
      seat,
      dice,
      total,
      reason: 'Collapsed Room Fall Physical Damage',
    });

    if (total === 0) {
      events.push({
        t: 'log',
        text: `${player.name} jumped down to the basement and landed safely!`,
      });
      return { state: workingState, events };
    }

    const damageEffects: Effect[] = [];
    for (let i = 0; i < total; i++) {
      damageEffects.push({
        e: 'prompt',
        who: 'actor',
        prompt: {
          kind: 'choose_trait',
          traits: ['speed', 'might'],
        },
        then: [
          {
            e: 'trait',
            who: 'actor',
            trait: { ref: 'chosen' },
            delta: -1,
          },
          {
            e: 'log',
            text: `${player.name} took 1 physical damage from the fall.`,
          },
        ],
      });
    }

    const effOutcome = runEffects(workingState, damageEffects, { actor: seat }, content);
    return {
      state: effOutcome.state,
      events: [...events, ...effOutcome.events],
    };
  }

  const placed = state.board.placed[player.location];
  if (!placed) return fail('ILLEGAL_MOVE', 'Tile not found');
  const tileDef = content.tilesById[placed.tileId];
  const actionDef = tileDef?.actions?.find((a) => a.id === actionId);
  if (!actionDef) {
    return fail('ILLEGAL_MOVE', `No room action "${actionId}" available here`);
  }

  if (!isRoomActionEligible(state, seat, actionDef, placed, content)) {
    return fail('ILLEGAL_MOVE', `Room action "${actionId}" is not eligible`);
  }

  if (actionId === 'action.gallery.fall_to_ballroom') {
    const ballroomTile = Object.values(state.board.placed).find(
      (t) => t.tileId === 'tile.ballroom',
    );
    if (!ballroomTile) {
      return fail('ILLEGAL_MOVE', 'Ballroom is not on the board');
    }

    const events: GameEvent[] = [];
    const fromLoc = player.location;
    const toLoc = ballroomTile.id;

    let workingState: GameState = {
      ...state,
      players: {
        ...state.players,
        [seat]: {
          ...player,
          location: toLoc,
        },
      },
    };
    events.push({ t: 'moved', seat, from: fromLoc, to: toLoc });

    const rng = workingState.rng ?? makeRng(12345);
    const [dice, total, nextRng] = rollDice(rng, 1);
    workingState = { ...workingState, rng: nextRng };
    events.push({
      t: 'rolled',
      seat,
      dice,
      total,
      reason: 'Gallery Fall Physical Damage',
    });

    if (total === 0) {
      events.push({
        t: 'log',
        text: `${player.name} fell from the Gallery to the Ballroom and took no damage.`,
      });
      return { state: workingState, events };
    }

    const damageEffects: Effect[] = [];
    for (let i = 0; i < total; i++) {
      damageEffects.push({
        e: 'prompt',
        who: 'actor',
        prompt: {
          kind: 'choose_trait',
          traits: ['speed', 'might'],
        },
        then: [
          {
            e: 'trait',
            who: 'actor',
            trait: { ref: 'chosen' },
            delta: -1,
          },
          {
            e: 'log',
            text: `${player.name} took 1 physical damage from falling.`,
          },
        ],
      });
    }

    const effOutcome = runEffects(workingState, damageEffects, { actor: seat }, content);
    return {
      state: effOutcome.state,
      events: [...events, ...effOutcome.events],
    };
  }

  if (actionId === 'action.the_vault.open') {
    const updatedPlayer: PlayerState = {
      ...player,
      flags: {
        ...player.flags,
        [`attempted_action:${actionId}`]: true,
      },
    };
    let workingState: GameState = {
      ...state,
      players: {
        ...state.players,
        [seat]: updatedPlayer,
      },
    };

    const diceCount = Math.max(
      1,
      Math.min(8, traitValue(workingState, seat, 'knowledge', content)),
    );
    const rng = workingState.rng ?? makeRng(12345);
    const [dice, total, nextRng] = rollDice(rng, diceCount);
    workingState = { ...workingState, rng: nextRng };
    const events: GameEvent[] = [
      { t: 'rolled', seat, dice, total, reason: 'The Vault Knowledge Roll' },
    ];

    if (total >= 6) {
      workingState = {
        ...workingState,
        board: {
          ...workingState.board,
          placed: {
            ...workingState.board.placed,
            [placed.id]: {
              ...placed,
              flags: {
                ...placed.flags,
                vault_empty: true,
              },
            },
          },
        },
      };
      events.push({
        t: 'log',
        text: `${player.name} cracked the vault and found 2 items!`,
      });

      const draw1 = drawItemCard(workingState, seat, content);
      workingState = draw1.state;
      events.push(...draw1.events);

      const draw2 = drawItemCard(workingState, seat, content);
      workingState = draw2.state;
      events.push(...draw2.events);

      return { state: workingState, events };
    } else {
      events.push({
        t: 'log',
        text: `${player.name} failed to open the vault. The door remains locked.`,
      });
      return { state: workingState, events };
    }
  }

  return fail('ILLEGAL_MOVE', `No handler for room action "${actionId}"`);
}

function attack(
  state: GameState,
  seat: SeatId,
  target: TargetRef,
  trait: Trait | undefined,
  content: Content,
): ReduceResult {
  if (state.phase !== 'haunt') {
    return fail('WRONG_PHASE', 'Can only attack during haunt phase');
  }
  if (state.activeSeat !== seat) return fail('NOT_YOUR_TURN', 'It is not your turn');
  const player = state.players[seat];
  if (!player || player.isDead || player.location === null) {
    return fail('ILLEGAL_MOVE', 'Cannot attack');
  }
  if (player.hasAttackedThisTurn) {
    return fail('ILLEGAL_MOVE', 'Already attacked this turn');
  }

  const attackTrait = trait ?? 'might';
  const weaponBonus = getWeaponAttackModifier(state, seat, attackTrait);
  const attackerDice = Math.max(
    1,
    traitValue(state, seat, attackTrait, content) + weaponBonus,
  );
  const rng = state.rng;
  if (!rng) return fail('INVARIANT_VIOLATION', 'Missing RNG');

  let defenderDice = 1;
  let targetPlayer: PlayerState | null = null;
  let targetMonster: MonsterState | null = null;

  if (target.kind === 'seat') {
    const targetSeat = target.seatId;
    if (targetSeat === seat) return fail('ILLEGAL_MOVE', 'Cannot attack yourself');
    targetPlayer = state.players[targetSeat] ?? null;
    if (!targetPlayer || targetPlayer.isDead || targetPlayer.removed) {
      return fail('ILLEGAL_MOVE', 'Target is not a living opponent');
    }
    if (targetPlayer.location !== player.location) {
      return fail('ILLEGAL_MOVE', 'Target is not in the same room');
    }
    defenderDice = Math.max(1, traitValue(state, targetSeat, attackTrait, content));
  } else {
    targetMonster = state.monsters[target.monsterId] ?? null;
    if (!targetMonster || targetMonster.isDead) {
      return fail('ILLEGAL_MOVE', 'Target monster does not exist or is dead');
    }
    if (targetMonster.location !== player.location) {
      return fail('ILLEGAL_MOVE', 'Monster is not in the same room');
    }
    const monsterStat =
      typeof targetMonster.flags[attackTrait] === 'number'
        ? (targetMonster.flags[attackTrait] as number)
        : typeof targetMonster.flags['might'] === 'number'
          ? (targetMonster.flags['might'] as number)
          : 4;
    defenderDice = Math.max(1, monsterStat);
  }

  const [attDice, attTotal, rng1] = rollDice(rng, attackerDice);
  const [defDice, defTotal, rng2] = rollDice(rng1, defenderDice);

  const diff = Math.abs(attTotal - defTotal);
  let winner: 'attacker' | 'defender' | 'tie' = 'tie';
  if (attTotal > defTotal) winner = 'attacker';
  else if (defTotal > attTotal) winner = 'defender';

  const events: GameEvent[] = [
    { t: 'rolled', seat, dice: attDice, total: attTotal, reason: 'attack' },
    {
      t: 'rolled',
      seat: target.kind === 'seat' ? target.seatId : seat,
      dice: defDice,
      total: defTotal,
      reason: target.kind === 'seat' ? 'defense' : 'monster_defense',
    },
    {
      t: 'attacked',
      seat,
      target,
      result: {
        attackerTotal: attTotal,
        defenderTotal: defTotal,
        winner,
        damage: diff,
      },
    },
  ];

  const nextPlayers = {
    ...state.players,
    [seat]: { ...player, hasAttackedThisTurn: true },
  };
  const nextMonsters = { ...state.monsters };

  if (target.kind === 'seat' && targetPlayer) {
    const targetSeat = target.seatId;
    if (winner === 'attacker' && diff > 0) {
      const currentIdx = targetPlayer.traits[attackTrait];
      const newIdx = Math.max(0, currentIdx - diff);
      const isDead = newIdx === 0;
      nextPlayers[targetSeat] = {
        ...targetPlayer,
        traits: { ...targetPlayer.traits, [attackTrait]: newIdx },
        isDead: targetPlayer.isDead || isDead,
      };
      events.push({
        t: 'trait_changed',
        seat: targetSeat,
        trait: attackTrait,
        from: currentIdx,
        to: newIdx,
      });
      if (isDead && !targetPlayer.isDead) {
        events.push({ t: 'died', seat: targetSeat });
      }
    } else if (winner === 'defender' && diff > 0) {
      const currentIdx = player.traits[attackTrait];
      const newIdx = Math.max(0, currentIdx - diff);
      const isDead = newIdx === 0;
      nextPlayers[seat] = {
        ...nextPlayers[seat]!,
        traits: { ...nextPlayers[seat]!.traits, [attackTrait]: newIdx },
        isDead: player.isDead || isDead,
      };
      events.push({
        t: 'trait_changed',
        seat,
        trait: attackTrait,
        from: currentIdx,
        to: newIdx,
      });
      if (isDead && !player.isDead) {
        events.push({ t: 'died', seat });
      }
    }
  } else if (target.kind === 'monster' && targetMonster) {
    if (winner === 'attacker' && diff > 0) {
      const wasStunned = Boolean(targetMonster.flags['stunned']);
      if (wasStunned || diff >= 4) {
        nextMonsters[target.monsterId] = {
          ...targetMonster,
          isDead: true,
          location: null,
          flags: { ...targetMonster.flags, stunned: false },
        };
        events.push({
          t: 'log',
          text: `${player.name} dealt a fatal blow to ${targetMonster.def} and defeated it!`,
        });
      } else {
        nextMonsters[target.monsterId] = {
          ...targetMonster,
          flags: { ...targetMonster.flags, stunned: true },
        };
        events.push({
          t: 'log',
          text: `${player.name} struck ${targetMonster.def}, stunning it!`,
        });
      }
    } else if (winner === 'defender' && diff > 0) {
      const currentIdx = player.traits[attackTrait];
      const newIdx = Math.max(0, currentIdx - diff);
      const isDead = newIdx === 0;
      nextPlayers[seat] = {
        ...nextPlayers[seat]!,
        traits: { ...nextPlayers[seat]!.traits, [attackTrait]: newIdx },
        isDead: player.isDead || isDead,
      };
      events.push({
        t: 'trait_changed',
        seat,
        trait: attackTrait,
        from: currentIdx,
        to: newIdx,
      });
      events.push({
        t: 'log',
        text: `${targetMonster.def} struck back and dealt ${diff} damage to ${player.name}!`,
      });
      if (isDead && !player.isDead) {
        events.push({ t: 'died', seat });
      }
    }
  }

  let nextState: GameState = {
    ...state,
    rng: rng2,
    players: nextPlayers,
    monsters: nextMonsters,
  };

  const checkHeroesLiving = Object.values(nextPlayers).filter(
    (p) => !p.isTraitor && !p.isDead && !p.removed,
  );
  const checkTraitorLiving = Object.values(nextPlayers).filter(
    (p) => p.isTraitor && !p.isDead && !p.removed,
  );
  const checkMonstersLiving = Object.values(nextMonsters).filter((m) => !m.isDead);

  if (checkHeroesLiving.length === 0) {
    const traitorWinners = Object.values(nextPlayers)
      .filter((p) => p.isTraitor)
      .map((p) => p.seatId);
    const result = {
      outcome: 'traitor' as const,
      winners: traitorWinners.length > 0 ? traitorWinners : [seat],
      reason: 'All heroes have died in the house.',
    };
    nextState = {
      ...nextState,
      phase: 'game_over',
      turnDeadline: null,
      activeSeat: null,
      result,
    };
    events.push({ t: 'game_over', result });
  } else if (
    (state.haunt?.traitorSeat ? checkTraitorLiving.length === 0 : true) &&
    checkMonstersLiving.length === 0
  ) {
    const heroWinners = checkHeroesLiving.map((p) => p.seatId);
    const result = {
      outcome: 'heroes' as const,
      winners: heroWinners,
      reason: 'The monsters and traitor have been vanquished.',
    };
    nextState = {
      ...nextState,
      phase: 'game_over',
      turnDeadline: null,
      activeSeat: null,
      result,
    };
    events.push({ t: 'game_over', result });
  }

  return { state: nextState, events };
}

function startMonster(
  state: GameState,
  seat: SeatId,
  monsterId: MonsterId,
  content: Content,
): ReduceResult {
  if (state.phase !== 'haunt') {
    return fail('WRONG_PHASE', 'Monsters can only act during the haunt phase');
  }
  if (!state.monsterTurn) {
    return fail('WRONG_PHASE', 'It is not the monster phase');
  }
  if (state.activeSeat !== seat || state.monsterTurn.controllingSeat !== seat) {
    return fail('NOT_YOUR_TURN', 'Only the controlling player can command monsters');
  }
  if (state.monsterTurn.activeMonsterId !== null) {
    return fail('ILLEGAL_MOVE', 'A monster is already currently acting');
  }
  const monster = state.monsters[monsterId];
  if (!monster || monster.isDead) {
    return fail('ILLEGAL_MOVE', 'Monster does not exist or is dead');
  }
  if (state.monsterTurn.actedMonsterIds.includes(monsterId)) {
    return fail('ILLEGAL_MOVE', 'Monster has already acted this round');
  }

  // Check stun lifecycle: clears stun on start and cannot act this turn
  if (monster.flags['stunned']) {
    const nextMonster: MonsterState = {
      ...monster,
      flags: { ...monster.flags, stunned: false },
    };
    const nextActed = [...state.monsterTurn.actedMonsterIds, monsterId];
    const nextMonsterTurn: MonsterTurnState = {
      ...state.monsterTurn,
      activeMonsterId: null,
      actedMonsterIds: nextActed,
      movesLeft: 0,
      hasAttacked: false,
      rolledSpeed: null,
    };
    const nextState: GameState = {
      ...state,
      monsters: {
        ...state.monsters,
        [monsterId]: nextMonster,
      },
      monsterTurn: nextMonsterTurn,
    };
    const livingMonsters = Object.values(nextState.monsters).filter((m) => !m.isDead);
    if (nextActed.length >= livingMonsters.length) {
      return endMonsterPhase(nextState, seat, content, [
        {
          t: 'log',
          text: `${monster.def} recovers from being stunned and cannot move or attack this turn.`,
        },
      ]);
    }
    return {
      state: nextState,
      events: [
        {
          t: 'log',
          text: `${monster.def} recovers from being stunned and cannot move or attack this turn.`,
        },
      ],
    };
  }

  // Roll monster Speed
  if (!state.rng) return fail('INVARIANT_VIOLATION', 'Missing RNG');
  const speedDice =
    typeof monster.flags['speed'] === 'number' ? (monster.flags['speed'] as number) : 3;
  const [dice, total, nextRng] = rollDice(state.rng, Math.max(1, speedDice));
  // Official rule: guarantee at least 1 move space even on total 0
  const moves = Math.max(1, total);

  const nextMonsterTurn: MonsterTurnState = {
    ...state.monsterTurn,
    activeMonsterId: monsterId,
    movesLeft: moves,
    hasAttacked: false,
    rolledSpeed: total,
  };

  return {
    state: {
      ...state,
      rng: nextRng,
      monsterTurn: nextMonsterTurn,
    },
    events: [
      { t: 'rolled', seat, dice, total, reason: 'monster_speed' },
      {
        t: 'log',
        text: `${monster.def} rolled ${total} Speed (moves: ${moves}).`,
      },
    ],
  };
}

function moveMonster(
  state: GameState,
  seat: SeatId,
  monsterId: MonsterId,
  to: PlacedId,
  content: Content,
): ReduceResult {
  if (state.phase !== 'haunt' || !state.monsterTurn) {
    return fail('WRONG_PHASE', 'Cannot move monster outside monster phase');
  }
  if (state.activeSeat !== seat || state.monsterTurn.controllingSeat !== seat) {
    return fail('NOT_YOUR_TURN', 'Only the controlling player can move monsters');
  }
  if (state.monsterTurn.activeMonsterId !== monsterId) {
    return fail('ILLEGAL_MOVE', 'Monster is not the active monster');
  }
  const monster = state.monsters[monsterId];
  if (!monster || monster.isDead || monster.location === null) {
    return fail('ILLEGAL_MOVE', 'Monster cannot move');
  }
  const currentLoc = monster.location;
  if (to === currentLoc) {
    return fail('ILLEGAL_MOVE', 'Cannot move to current room');
  }

  const destTile = state.board.placed[to];
  if (!destTile) {
    return fail('ILLEGAL_MOVE', 'Destination room does not exist');
  }

  const connections = getMonsterConnections(state, currentLoc, content);
  if (!connections.includes(to)) {
    return fail('ILLEGAL_MOVE', 'Rooms are not connected');
  }

  const leaveCost = getMonsterLeaveCost(state, currentLoc);
  if (state.monsterTurn.movesLeft < leaveCost) {
    return fail(
      'ILLEGAL_MOVE',
      `Leaving room with heroes requires ${leaveCost} moves, but only ${state.monsterTurn.movesLeft} left.`,
    );
  }

  const nextMoves = state.monsterTurn.movesLeft - leaveCost;
  const nextMonster: MonsterState = {
    ...monster,
    location: to,
  };
  const nextMonsterTurn: MonsterTurnState = {
    ...state.monsterTurn,
    movesLeft: nextMoves,
  };

  const destName = content.tilesById[destTile.tileId]?.name ?? 'room';
  return {
    state: {
      ...state,
      monsters: {
        ...state.monsters,
        [monsterId]: nextMonster,
      },
      monsterTurn: nextMonsterTurn,
    },
    events: [
      {
        t: 'log',
        text: `${monster.def} moved to ${destName}. (${nextMoves} moves left)`,
      },
    ],
  };
}

function monsterAttack(
  state: GameState,
  seat: SeatId,
  monsterId: MonsterId,
  target: TargetRef,
  trait: Trait | undefined,
  content: Content,
): ReduceResult {
  if (state.phase !== 'haunt' || !state.monsterTurn) {
    return fail('WRONG_PHASE', 'Cannot attack outside monster phase');
  }
  if (state.activeSeat !== seat || state.monsterTurn.controllingSeat !== seat) {
    return fail(
      'NOT_YOUR_TURN',
      'Only the controlling player can command monster attacks',
    );
  }
  if (state.monsterTurn.activeMonsterId !== monsterId) {
    return fail('ILLEGAL_MOVE', 'Monster is not the active monster');
  }
  if (state.monsterTurn.hasAttacked) {
    return fail('ILLEGAL_MOVE', 'Monster has already attacked this turn');
  }
  const monster = state.monsters[monsterId];
  if (!monster || monster.isDead || monster.location === null) {
    return fail('ILLEGAL_MOVE', 'Monster cannot attack');
  }

  if (target.kind !== 'seat') {
    return fail('ILLEGAL_MOVE', 'Monster can only attack explorer seats');
  }
  const targetSeat = target.seatId;
  const targetPlayer = state.players[targetSeat];
  if (
    !targetPlayer ||
    targetPlayer.isDead ||
    targetPlayer.removed ||
    targetPlayer.isTraitor
  ) {
    return fail('ILLEGAL_MOVE', 'Target must be a living hero');
  }
  if (targetPlayer.location !== monster.location) {
    return fail('ILLEGAL_MOVE', 'Target is not in the same room as the monster');
  }

  if (!state.rng) return fail('INVARIANT_VIOLATION', 'Missing RNG');

  const attackTrait: Trait = trait ?? 'might';
  const monsterMight =
    typeof monster.flags[attackTrait] === 'number'
      ? (monster.flags[attackTrait] as number)
      : typeof monster.flags['might'] === 'number'
        ? (monster.flags['might'] as number)
        : 4;
  const attackerDice = Math.max(1, monsterMight);
  const defenderDice = Math.max(1, traitValue(state, targetSeat, attackTrait, content));

  const [attDice, attTotal, rng1] = rollDice(state.rng, attackerDice);
  const [defDice, defTotal, rng2] = rollDice(rng1, defenderDice);

  const diff = Math.abs(attTotal - defTotal);
  let winner: 'attacker' | 'defender' | 'tie' = 'tie';
  if (attTotal > defTotal) winner = 'attacker';
  else if (defTotal > attTotal) winner = 'defender';

  const events: GameEvent[] = [
    { t: 'rolled', seat, dice: attDice, total: attTotal, reason: 'monster_attack' },
    { t: 'rolled', seat: targetSeat, dice: defDice, total: defTotal, reason: 'defense' },
    {
      t: 'attacked',
      seat,
      target,
      result: {
        attackerTotal: attTotal,
        defenderTotal: defTotal,
        winner,
        damage: diff,
      },
    },
  ];

  const nextPlayers = { ...state.players };
  if (winner === 'attacker' && diff > 0) {
    const currentIdx = targetPlayer.traits[attackTrait];
    const newIdx = Math.max(0, currentIdx - diff);
    const isDead = newIdx === 0;
    nextPlayers[targetSeat] = {
      ...targetPlayer,
      traits: { ...targetPlayer.traits, [attackTrait]: newIdx },
      isDead: targetPlayer.isDead || isDead,
    };
    events.push({
      t: 'trait_changed',
      seat: targetSeat,
      trait: attackTrait,
      from: currentIdx,
      to: newIdx,
    });
    if (isDead && !targetPlayer.isDead) {
      events.push({ t: 'died', seat: targetSeat });
    }
  } else {
    // Official 2E rulebook: Defending against a monster attack does NOT harm or stun the monster
    events.push({
      t: 'log',
      text: `${targetPlayer.name} defended against ${monster.def}'s attack.`,
    });
  }

  const nextMonsterTurn: MonsterTurnState = {
    ...state.monsterTurn,
    hasAttacked: true,
  };

  const workingState: GameState = {
    ...state,
    rng: rng2,
    players: nextPlayers,
    monsterTurn: nextMonsterTurn,
  };

  const livingHeroes = Object.values(nextPlayers).filter(
    (p) => !p.isDead && !p.removed && !p.isTraitor,
  );
  if (livingHeroes.length === 0) {
    const traitorWinners = Object.values(nextPlayers)
      .filter((p) => p.isTraitor)
      .map((p) => p.seatId);
    const result = {
      outcome: 'traitor' as const,
      winners: traitorWinners.length > 0 ? traitorWinners : [seat],
      reason: 'All heroes have perished. The traitor and monsters triumph!',
    };
    const gameOverState: GameState = {
      ...workingState,
      phase: 'game_over',
      monsterTurn: null,
      activeSeat: null,
      turnDeadline: null,
      result,
    };
    events.push({ t: 'game_over', result });
    return { state: gameOverState, events };
  }

  return { state: workingState, events };
}

function endMonsterTurn(
  state: GameState,
  seat: SeatId,
  monsterId: MonsterId,
  content: Content,
): ReduceResult {
  if (state.phase !== 'haunt' || !state.monsterTurn) {
    return fail('WRONG_PHASE', 'Cannot end monster turn outside monster phase');
  }
  if (state.activeSeat !== seat || state.monsterTurn.controllingSeat !== seat) {
    return fail('NOT_YOUR_TURN', 'Only the controlling player can end monster turn');
  }
  if (state.monsterTurn.activeMonsterId !== monsterId) {
    return fail('ILLEGAL_MOVE', 'Monster is not the active monster');
  }
  const monster = state.monsters[monsterId];
  const nextActed = [...state.monsterTurn.actedMonsterIds, monsterId];
  const nextMonsterTurn: MonsterTurnState = {
    ...state.monsterTurn,
    activeMonsterId: null,
    actedMonsterIds: nextActed,
    movesLeft: 0,
    hasAttacked: false,
    rolledSpeed: null,
  };

  const nextState: GameState = {
    ...state,
    monsterTurn: nextMonsterTurn,
  };

  const livingMonsters = Object.values(state.monsters).filter((m) => !m.isDead);
  if (nextActed.length >= livingMonsters.length) {
    return endMonsterPhase(nextState, seat, content, [
      { t: 'log', text: `${monster?.def ?? monsterId} finished its turn.` },
    ]);
  }

  return {
    state: nextState,
    events: [{ t: 'log', text: `${monster?.def ?? monsterId} finished its turn.` }],
  };
}

function endMonsterPhase(
  state: GameState,
  seat: SeatId,
  content: Content,
  priorEvents: GameEvent[] = [],
): ReduceResult {
  if (state.phase !== 'haunt' || !state.monsterTurn) {
    return fail('WRONG_PHASE', 'Cannot end monster phase outside monster phase');
  }
  if (state.activeSeat !== seat || state.monsterTurn.controllingSeat !== seat) {
    return fail('NOT_YOUR_TURN', 'Only the controlling player can end monster phase');
  }
  if (state.monsterTurn.activeMonsterId !== null) {
    return fail('ILLEGAL_MOVE', 'Finish active monster turn before ending monster phase');
  }

  const firstHero =
    state.turnOrder.find(
      (s) =>
        !state.players[s]?.isDead &&
        !state.players[s]?.removed &&
        !state.players[s]?.isTraitor,
    ) ?? state.turnOrder[0]!;

  const round = state.round + 1;
  let nextState: GameState = {
    ...state,
    monsterTurn: null,
    activeSeat: firstHero,
    round,
    turnDeadline: null,
  };
  nextState = beginTurnFor(nextState, firstHero, content);

  return {
    state: nextState,
    events: [
      ...priorEvents,
      { t: 'log', text: 'Monster Phase ended. Round advances to the heroes.' },
      { t: 'turn_started', seat: firstHero, round },
    ],
  };
}
