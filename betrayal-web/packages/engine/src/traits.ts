/**
 * Semantic Trait Operations and Death Transitions.
 *
 * All operands are track indices (0..8) or track steps, NEVER displayed trait values.
 * Index 0 is the skull (death slot).
 *
 * Rules:
 * - GAIN_TRAIT: +steps capped at track maximum (index 8). Never revives dead explorer.
 * - LOSE_TRAIT: -steps. In pre-haunt (explore, lobby, setup), floor is index 1 (no death).
 *   In post-haunt (haunt_reveal, haunt, game_over), can reach 0 and invokes death once.
 * - SET_TRAIT: Sets absolute index (0..8). Applies pre-/post-haunt floor.
 * - HEAL_TRAIT: Sets index to max(currentIndex, startIndex). Never lowers above start, never revives dead.
 *
 * Death invariant:
 * - movesLeft = 0
 * - emits 'died' event once
 * - resolves pending prompts owned by the deceased
 * - advances active turn safely if active seat died
 * - inventory/card drop is deferred to Phase 7 room-card-piles (retained on corpse).
 */

import type { GameEvent, GameState, PlayerState, SeatId, Trait } from '@bahoth/shared';
import type { Content } from '@bahoth/content';
import { resolvePromptWithDefault } from './reduce.js';
import { nextSeatInOrder } from './selectors.js';
import { beginTurnFor } from './movement.js';

export interface TraitOperationResult {
  state: GameState;
  events: GameEvent[];
}

/**
 * Atomic death transition for an explorer.
 */
export function killExplorer(
  state: GameState,
  seat: SeatId,
  content: Content,
): TraitOperationResult {
  const player = state.players[seat];
  if (!player || player.isDead) {
    return { state, events: [] };
  }

  let working = state;
  const events: GameEvent[] = [];

  // 1. Resolve pending prompt if owned by the dying seat
  if (working.pending?.seatId === seat) {
    const resolved = resolvePromptWithDefault(working, content);
    working = resolved.state;
    events.push(...resolved.events);
  }

  const playerNow = working.players[seat]!;
  const nextPlayer: PlayerState = {
    ...playerNow,
    isDead: true,
    movesLeft: 0,
  };

  events.push({ t: 'died', seat });

  // 2. Check remaining living players for game over
  const remainingHeroes = Object.values(working.players).filter((p) =>
    p.seatId === seat ? false : !p.isTraitor && !p.isDead && !p.removed,
  );
  const remainingTraitor = Object.values(working.players).filter((p) =>
    p.seatId === seat ? false : p.isTraitor && !p.isDead && !p.removed,
  );
  const remainingMonsters = Object.values(working.monsters).filter((m) => !m.isDead);

  let nextPhase = working.phase;
  let result = working.result;

  if (working.phase === 'haunt' || working.phase === 'haunt_reveal') {
    if (remainingHeroes.length === 0) {
      const traitorWinners = Object.values(working.players)
        .filter((p) => p.isTraitor)
        .map((p) => p.seatId);
      result = {
        outcome: 'traitor',
        winners: traitorWinners.length > 0 ? traitorWinners : [seat],
        reason: 'All heroes have died in the house.',
      };
      nextPhase = 'game_over';
      events.push({ t: 'game_over', result });
    } else if (
      (working.haunt?.traitorSeat
        ? remainingTraitor.length === 0
        : Object.keys(working.monsters).length > 0) &&
      remainingMonsters.length === 0
    ) {
      const heroWinners = remainingHeroes.map((p) => p.seatId);
      result = {
        outcome: 'heroes',
        winners: heroWinners,
        reason: 'The monsters and traitor have been vanquished.',
      };
      nextPhase = 'game_over';
      events.push({ t: 'game_over', result });
    }
  }

  // 3. Handle active seat progression if active player died
  let nextActive = working.activeSeat;
  if (working.activeSeat === seat && nextPhase !== 'game_over') {
    const next = nextSeatInOrder(
      { ...working, players: { ...working.players, [seat]: nextPlayer } },
      seat,
    );
    nextActive = next === seat ? null : next;
  }

  let nextState: GameState = {
    ...working,
    phase: nextPhase,
    result,
    turnDeadline: nextPhase === 'game_over' ? null : working.turnDeadline,
    players: {
      ...working.players,
      [seat]: nextPlayer,
    },
    activeSeat: nextPhase === 'game_over' ? null : nextActive,
  };

  if (working.activeSeat === seat && nextActive && nextPhase !== 'game_over') {
    nextState = beginTurnFor(nextState, nextActive, content);
  }

  return { state: nextState, events };
}

/**
 * GAIN_TRAIT: Move up `steps` indices on the character's 9-slot track.
 * Caps at track.length - 1 (index 8). Never revives a dead player.
 */
export function gainTrait(
  state: GameState,
  seat: SeatId,
  trait: Trait,
  steps: number,
  content: Content,
): TraitOperationResult {
  const player = state.players[seat];
  if (!player || player.isDead || !player.charId || steps <= 0) {
    return { state, events: [] };
  }
  const character = content.charactersById[player.charId];
  const track = character?.tracks[trait];
  if (!track) return { state, events: [] };

  const from = player.traits[trait];
  const to = Math.min(track.length - 1, from + steps);
  if (to === from) return { state, events: [] };

  const nextPlayer: PlayerState = {
    ...player,
    traits: { ...player.traits, [trait]: to },
  };
  return {
    state: {
      ...state,
      players: { ...state.players, [seat]: nextPlayer },
    },
    events: [{ t: 'trait_changed', seat, trait, from, to }],
  };
}

/**
 * LOSE_TRAIT: Move down `steps` indices.
 * Pre-haunt (`explore`, `lobby`, `setup`): floor is index 1 (cannot die, cannot hit skull).
 * Post-haunt (`haunt_reveal`, `haunt`, `game_over`): can reach index 0 (skull) and invokes death.
 */
export function loseTrait(
  state: GameState,
  seat: SeatId,
  trait: Trait,
  steps: number,
  content: Content,
): TraitOperationResult {
  const player = state.players[seat];
  if (!player || player.isDead || !player.charId || steps <= 0) {
    return { state, events: [] };
  }
  const character = content.charactersById[player.charId];
  const track = character?.tracks[trait];
  if (!track) return { state, events: [] };

  const isPreHaunt =
    state.phase === 'explore' || state.phase === 'lobby' || state.phase === 'setup';
  const minFloor = isPreHaunt ? 1 : 0;

  const from = player.traits[trait];
  const to = Math.max(minFloor, from - steps);
  if (to === from) return { state, events: [] };

  const events: GameEvent[] = [{ t: 'trait_changed', seat, trait, from, to }];
  let workingState: GameState = {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...player,
        traits: { ...player.traits, [trait]: to },
      },
    },
  };

  if (to === 0 && !player.isDead) {
    const deathOutcome = killExplorer(workingState, seat, content);
    workingState = deathOutcome.state;
    events.push(...deathOutcome.events);
  }

  return { state: workingState, events };
}

/**
 * SET_TRAIT: Set an absolute index (0..8).
 * Validates index against character track bounds.
 * Applies pre-haunt / post-haunt floor (pre-haunt clamped to min 1).
 * Never revives a dead player.
 */
export function setTrait(
  state: GameState,
  seat: SeatId,
  trait: Trait,
  targetIndex: number,
  content: Content,
): TraitOperationResult {
  const player = state.players[seat];
  if (!player || player.isDead || !player.charId) {
    return { state, events: [] };
  }
  const character = content.charactersById[player.charId];
  const track = character?.tracks[trait];
  if (!track) return { state, events: [] };

  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= track.length) {
    throw new Error(
      `setTrait targetIndex must be an integer between 0 and ${track.length - 1}, got ${targetIndex}`,
    );
  }

  const isPreHaunt =
    state.phase === 'explore' || state.phase === 'lobby' || state.phase === 'setup';
  const minFloor = isPreHaunt ? 1 : 0;
  const to = Math.max(minFloor, targetIndex);
  const from = player.traits[trait];
  if (to === from) return { state, events: [] };

  const events: GameEvent[] = [{ t: 'trait_changed', seat, trait, from, to }];
  let workingState: GameState = {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...player,
        traits: { ...player.traits, [trait]: to },
      },
    },
  };

  if (to === 0 && !player.isDead) {
    const deathOutcome = killExplorer(workingState, seat, content);
    workingState = deathOutcome.state;
    events.push(...deathOutcome.events);
  }

  return { state: workingState, events };
}

/**
 * HEAL_TRAIT: Restore that trait toward its printed starting index:
 * set to max(currentIndex, startIndex).
 * Does not lower a trait already above start, and does not revive the dead.
 */
export function healTrait(
  state: GameState,
  seat: SeatId,
  trait: Trait,
  content: Content,
): TraitOperationResult {
  const player = state.players[seat];
  if (!player || player.isDead || !player.charId) {
    return { state, events: [] };
  }
  const character = content.charactersById[player.charId];
  if (!character) return { state, events: [] };

  const startIndex = character.start[trait];
  const from = player.traits[trait];
  const to = Math.max(from, startIndex);
  if (to === from) return { state, events: [] };

  const nextPlayer: PlayerState = {
    ...player,
    traits: { ...player.traits, [trait]: to },
  };
  return {
    state: {
      ...state,
      players: { ...state.players, [seat]: nextPlayer },
    },
    events: [{ t: 'trait_changed', seat, trait, from, to }],
  };
}
