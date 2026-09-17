/**
 * Read-only selectors, safe to import from the client.
 * See docs/05-engine.md#57-legality-and-how-the-client-uses-it.
 *
 * getLegalActions is the ONLY source of truth for what a seat may do. The
 * client uses it to enable controls; the server uses it to reject everything
 * else. Never write a second, client-side "can I do this?" check.
 */

import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  type CharId,
  type GameAction,
  type GameState,
  type PlacedTile,
  type PlayerState,
  type Rotation,
  type SeatId,
  type Trait,
} from '@bahoth/shared';
import type { Content, RoomAction } from '@bahoth/content';
import { getOpenDoorways } from './discovery.js';
import { legalAnswersFor } from './prompts.js';
import {
  getCrossingBarrier,
  getDogReachableRooms,
  getMonsterReachable,
  getReachable,
} from './movement.js';

export { getCrossingBarrier, getDogReachableRooms, getMonsterReachable };

/**
 * Seat ids are `seat_<n>` assigned in join order, so ordering by that number
 * IS join order. Compared numerically rather than lexically so the ordering
 * does not silently invert at seat_10 if MAX_PLAYERS ever grows.
 */
function compareSeats(a: SeatId, b: SeatId): number {
  const na = Number(a.slice(a.lastIndexOf('_') + 1));
  const nb = Number(b.slice(b.lastIndexOf('_') + 1));
  if (Number.isNaN(na) || Number.isNaN(nb)) return a < b ? -1 : a > b ? 1 : 0;
  return na - nb;
}

/**
 * The host is the earliest-joined seat that is currently connected, falling
 * back to the earliest-joined seat when nobody is. Without the connection
 * check a host who drops takes the lobby with them: nobody else can start.
 *
 * [06-networking](../../../docs/06-networking.md#disconnection-behaviour) says
 * "longest-connected", which would need a clock the engine is not allowed to
 * read. Earliest-joined-among-connected is the deterministic stand-in, and it
 * behaves better anyway — the role returns to the original host when they come
 * back rather than drifting to whoever has been online longest since.
 */
export function getHostSeat(state: GameState): SeatId | null {
  const seats = Object.keys(state.players)
    .filter((s) => !state.players[s]?.removed)
    .sort(compareSeats);
  return seats.find((s) => state.players[s]?.connected) ?? seats[0] ?? null;
}

/** Seats still taking part: everyone the table has not voted out. */
export function activePlayers(state: GameState): PlayerState[] {
  return Object.values(state.players).filter((p) => !p.removed);
}

export const PASSIVE_TRAIT_MODIFIERS: Record<string, Partial<Record<Trait, number>>> = {
  'item.amulet_of_the_ages': { might: 1, speed: 1, sanity: 1, knowledge: 1 },
  'item.angel_feather': { sanity: 1, speed: 1 },
  'item.armor': { might: 1 },
  'item.candle': { knowledge: 1, sanity: 1 },
  'item.lucky_stone': { speed: 1, sanity: 1 },
  'item.pickpocket_gloves': { speed: 1, knowledge: 1 },
  'item.rabbits_foot': { speed: 1 },
  'omen.book': { knowledge: 2 },
  'omen.holy_symbol': { sanity: 2 },
  'omen.medallion': { sanity: 1 },
  'omen.ring': { sanity: 1 },
  // Companions:
  'omen.dog': { might: 1, sanity: 1 },
  'omen.girl': { sanity: 1, knowledge: 1 },
  'omen.madman': { might: 2, sanity: -1 },
};

export const WEAPON_ATTACK_MODIFIERS: Record<string, { trait: Trait; dice: number }> = {
  'item.axe': { trait: 'might', dice: 1 },
  'item.blood_dagger': { trait: 'might', dice: 2 },
  'item.revolver': { trait: 'might', dice: 2 },
  'item.sacrificial_dagger': { trait: 'might', dice: 2 },
  'omen.ring': { trait: 'might', dice: 2 },
  'omen.spear': { trait: 'might', dice: 2 },
};

export function getPassiveTraitModifier(
  state: GameState,
  seat: SeatId,
  trait: Trait,
): number {
  const player = state.players[seat];
  if (!player) return 0;
  let total = 0;
  const held = [...player.items, ...player.omens];
  for (const cardId of held) {
    const mod = PASSIVE_TRAIT_MODIFIERS[cardId]?.[trait];
    if (mod) total += mod;
  }
  return total;
}

export function getCompanionTraitModifier(
  state: GameState,
  seat: SeatId,
  trait: Trait,
  content: Content,
): number {
  const player = state.players[seat];
  if (!player) return 0;
  let total = 0;
  for (const cardId of player.omens) {
    if (content.cardsById[cardId]?.isCompanion) {
      const mod = PASSIVE_TRAIT_MODIFIERS[cardId]?.[trait];
      if (mod) total += mod;
    }
  }
  return total;
}

export function getWeaponAttackModifier(
  state: GameState,
  seat: SeatId,
  trait: Trait,
): number {
  const player = state.players[seat];
  if (!player) return 0;
  let maxBonus = 0;
  const held = [...player.items, ...player.omens];
  for (const cardId of held) {
    const weapon = WEAPON_ATTACK_MODIFIERS[cardId];
    if (weapon && weapon.trait === trait) {
      if (weapon.dice > maxBonus) maxBonus = weapon.dice;
    }
  }
  return maxBonus;
}

export function traitValue(
  state: GameState,
  seat: SeatId,
  trait: Trait,
  content: Content,
): number {
  const player = state.players[seat];
  if (!player?.charId) return 0;
  const character = content.charactersById[player.charId];
  if (!character) return 0;
  const baseValue = character.tracks[trait][player.traits[trait]] ?? 0;
  const passive = getPassiveTraitModifier(state, seat, trait);
  let temp = 0;
  if (trait === 'speed' && typeof player.flags['adrenaline_speed'] === 'number') {
    temp += Number(player.flags['adrenaline_speed']);
  }
  return Math.max(0, baseValue + passive + temp);
}

export function isRoomActionEligible(
  state: GameState,
  seat: SeatId,
  action: RoomAction,
  placed: PlacedTile,
  _content: Content,
): boolean {
  const player = state.players[seat];
  if (!player || player.isDead || player.location !== placed.id) return false;

  // Once-per-game cadence (e.g. Vault)
  if (action.cadence.kind === 'once_per_game') {
    if (action.cadence.scope === 'tile') {
      if (placed.flags[action.cadence.key]) return false;
    } else {
      if (state.flags[action.cadence.key]) return false;
    }
  }

  // Once-per-turn attempt limit (e.g. Vault even after failure)
  if (player.flags[`attempted_action:${action.id}`]) {
    return false;
  }

  // Specific room action eligibility:
  // Gallery: Ballroom must be placed in the house
  if (action.id === 'action.gallery.fall_to_ballroom') {
    const ballroomPlaced = Object.values(state.board.placed).some(
      (t) => t.tileId === 'tile.ballroom',
    );
    if (!ballroomPlaced) return false;
  }

  // Vault: cannot be already empty
  if (action.id === 'action.the_vault.open') {
    if (placed.flags['vault_empty']) return false;
  }

  // Collapsed Room: jump down to basement
  if (action.id === 'action.collapsed_room.fall') {
    return true;
  }

  return true;
}

export function isCharacterTaken(
  state: GameState,
  charId: CharId,
  exceptSeat?: SeatId,
): boolean {
  return Object.values(state.players).some(
    (p) => p.charId === charId && p.seatId !== exceptSeat,
  );
}

/** Characters whose colour is already claimed by another seat. */
export function takenColours(
  state: GameState,
  content: Content,
  exceptSeat?: SeatId,
): Set<string> {
  const colours = new Set<string>();
  for (const p of Object.values(state.players)) {
    if (p.seatId === exceptSeat || !p.charId) continue;
    const c = content.charactersById[p.charId];
    if (c) colours.add(c.colour);
  }
  return colours;
}

export function canStart(state: GameState): boolean {
  // A seat voted out in the lobby does not hold the game up.
  const players = activePlayers(state);
  return (
    state.phase === 'lobby' &&
    players.length >= MIN_PLAYERS &&
    players.length <= MAX_PLAYERS &&
    players.every((p) => p.charId !== null)
  );
}

export function getLegalActions(
  state: GameState,
  seat: SeatId,
  content: Content,
): GameAction[] {
  const player = state.players[seat];
  if (!player) return [];
  // A seat the table has voted out is a spectator with a body on the board.
  if (player.removed) return [];

  // Haunt briefing readiness gate: until all living participants acknowledge,
  // ordinary gameplay is blocked. Living unacknowledged seats can only ACK_HAUNT_BRIEFING.
  if (state.haunt && state.haunt.revealed) {
    const livingParticipants = state.turnOrder.filter((s) => {
      const p = state.players[s];
      return p && !p.isDead && !p.removed;
    });
    const ackSet = new Set(state.haunt.acknowledged);
    const pendingBriefing = livingParticipants.some((s) => !ackSet.has(s));
    if (pendingBriefing) {
      if (!ackSet.has(seat) && !player.isDead && !player.removed) {
        return [{ t: 'ACK_HAUNT_BRIEFING' as const, seat }];
      }
      return [];
    }
  }

  // Monster phase: only the controlling traitor can command monsters
  if (state.monsterTurn !== null) {
    if (state.activeSeat !== seat || state.monsterTurn.controllingSeat !== seat) {
      return [];
    }
    const monsterActions: GameAction[] = [];
    if (state.monsterTurn.activeMonsterId === null) {
      for (const m of Object.values(state.monsters)) {
        if (!m.isDead && !state.monsterTurn.actedMonsterIds.includes(m.id)) {
          monsterActions.push({ t: 'START_MONSTER', seat, monsterId: m.id });
        }
      }
      monsterActions.push({ t: 'END_MONSTER_PHASE', seat });
      monsterActions.push({ t: 'END_TURN', seat });
    } else {
      const activeMonsterId = state.monsterTurn.activeMonsterId;
      const monster = state.monsters[activeMonsterId];
      if (monster && monster.location) {
        if (state.monsterTurn.movesLeft > 0) {
          const reachable = getMonsterReachable(
            state,
            monster.location,
            state.monsterTurn.movesLeft,
            content,
          );
          for (const to of reachable) {
            monsterActions.push({
              t: 'MOVE_MONSTER',
              seat,
              monsterId: activeMonsterId,
              to,
            });
          }
        }
        if (!state.monsterTurn.hasAttacked) {
          for (const other of Object.values(state.players)) {
            if (
              !other.isDead &&
              !other.removed &&
              !other.isTraitor &&
              other.location === monster.location
            ) {
              monsterActions.push({
                t: 'MONSTER_ATTACK',
                seat,
                monsterId: activeMonsterId,
                target: { kind: 'seat', seatId: other.seatId },
                trait: 'might',
              });
            }
          }
        }
      }
      monsterActions.push({ t: 'END_MONSTER_TURN', seat, monsterId: activeMonsterId });
    }
    return monsterActions;
  }

  // A pending prompt blocks everything except the seat that must answer it.
  if (state.pending) {
    if (state.pending.seatId !== seat) return [];
    // The choices come from the prompt's own handler (prompts.ts), so legality
    // and `reduce`'s `validateAnswer` read the same table and cannot drift —
    // docs/05-engine.md#57 requires exactly that. A kind whose answers are not
    // enumerable (`null`) offers nothing rather than an `ANSWER` the reducer
    // would then reject; that is deviation 16, and it still holds.
    if (state.pending.kind === 'rotate_tile') {
      const answers = legalAnswersFor(state.pending) ?? [];
      return answers.map((rotation) => ({
        t: 'ROTATE_TILE' as const,
        seat,
        rotation: rotation as Rotation,
      }));
    }
    // choose_target/choose_room/choose_trait have no bespoke action type, unlike
    // rotate_tile — they answer through the generic ANSWER.
    if (
      state.pending.kind === 'choose_target' ||
      state.pending.kind === 'choose_room' ||
      state.pending.kind === 'choose_trait'
    ) {
      const answers = legalAnswersFor(state.pending) ?? [];
      const promptId = state.pending.id;
      return answers.map((answer) => ({ t: 'ANSWER' as const, seat, promptId, answer }));
    }
    return [];
  }

  const actions: GameAction[] = [];

  // Voting on an absent seat is available in every live phase, including the
  // lobby, where a seat that never comes back would otherwise block the start.
  // The vote is clock-free; the grace period is enforced when it resolves.
  if (state.phase !== 'game_over') {
    for (const other of Object.values(state.players)) {
      if (other.seatId === seat || other.connected || other.removed) continue;
      const voted = state.removeVotes[other.seatId]?.includes(seat) ?? false;
      actions.push({ t: 'VOTE_REMOVE', seat, target: other.seatId, vote: !voted });
    }
  }

  switch (state.phase) {
    case 'lobby': {
      const claimed = takenColours(state, content, seat);
      for (const c of content.characters) {
        if (isCharacterTaken(state, c.id, seat)) continue;
        if (claimed.has(c.colour)) continue;
        actions.push({ t: 'CHOOSE_CHAR', seat, charId: c.id });
      }
      if (player.charId) actions.push({ t: 'CHOOSE_CHAR', seat, charId: null });
      if (canStart(state) && getHostSeat(state) === seat) {
        actions.push({ t: 'START_GAME', seat });
      }
      break;
    }

    case 'explore':
    case 'haunt': {
      if (state.activeSeat === seat && !player.isDead) {
        // Every room getReachable offers must be MOVE-able: the property test
        // walks getLegalActions straight into reduce, so the two must agree
        // exactly (D-h).
        for (const to of getReachable(state, seat, content)) {
          actions.push({ t: 'MOVE', seat, to });
        }
        for (const dir of getOpenDoorways(state, seat, content)) {
          actions.push({ t: 'MOVE_THROUGH', seat, dir });
        }
        for (const cardId of [...player.items, ...player.omens]) {
          const card = content.cardsById[cardId];
          if (!card) continue;
          if (card.use?.kind === 'passive' || card.use?.kind === 'manual') continue;
          if (!card.onUse || card.onUse.length === 0) continue;
          if (
            card.use?.kind === 'once_per_turn' &&
            player.usedCardsThisTurn?.includes(cardId)
          ) {
            continue;
          }
          actions.push({ t: 'USE_ITEM', seat, cardId });
        }
        for (const cardId of [...player.items, ...player.omens]) {
          const card = content.cardsById[cardId];
          if (card?.isCompanion || cardId === 'omen.bite') continue;
          actions.push({ t: 'DROP', seat, cardIds: [cardId] });
        }
        if (player.location) {
          const tile = state.board.placed[player.location];
          for (const cardId of tile?.droppedItems ?? []) {
            actions.push({ t: 'PICKUP', seat, cardIds: [cardId] });
          }
        }
        if (
          (player.items.includes('omen.dog') || player.omens.includes('omen.dog')) &&
          !player.usedCardsThisTurn?.includes('omen.dog') &&
          !player.flags['dog_used_this_turn'] &&
          player.location
        ) {
          const dogDestinations = getDogReachableRooms(state, player.location, content);
          for (const dest of dogDestinations) {
            actions.push({ t: 'COMMAND_DOG', seat, destination: dest });
            for (const c of [...player.items, ...player.omens]) {
              if (
                c !== 'omen.dog' &&
                c !== 'omen.bite' &&
                !content.cardsById[c]?.isCompanion
              ) {
                actions.push({ t: 'COMMAND_DOG', seat, destination: dest, cardId: c });
              }
            }
            const destPlaced = state.board.placed[dest];
            for (const c of destPlaced?.droppedItems ?? []) {
              if (c !== 'omen.bite' && !content.cardsById[c]?.isCompanion) {
                actions.push({ t: 'COMMAND_DOG', seat, destination: dest, cardId: c });
              }
            }
          }
        }
        if (state.phase === 'haunt' && !player.hasAttackedThisTurn && player.location) {
          for (const other of Object.values(state.players)) {
            if (
              other.seatId !== seat &&
              !other.isDead &&
              !other.removed &&
              other.location === player.location
            ) {
              actions.push({
                t: 'ATTACK',
                seat,
                target: { kind: 'seat', seatId: other.seatId },
                trait: 'might',
              });
            }
          }
        }
        if (player.location) {
          const placed = state.board.placed[player.location];
          if (placed) {
            const tileDef = content.tilesById[placed.tileId];
            if (tileDef?.actions) {
              for (const action of tileDef.actions) {
                if (isRoomActionEligible(state, seat, action, placed, content)) {
                  actions.push({ t: 'ROOM_ACTION', seat, actionId: action.id });
                }
              }
            }
            const hasIncompleteToken = Boolean(
              state.tokens?.some(
                (t) => t.location === player.location && !t.flags?.['completed'],
              ),
            );
            if (hasIncompleteToken) {
              actions.push({ t: 'ROOM_ACTION', seat, actionId: 'interact_token' });
            }
          }
        }
        const currentPlaced = player.location
          ? state.board.placed[player.location]
          : null;
        if (currentPlaced?.tileId !== 'tile.coal_chute') {
          actions.push({ t: 'END_TURN', seat });
        }
      }
      break;
    }

    case 'setup':
    case 'haunt_reveal':
    case 'game_over':
      break;
  }

  return actions;
}

/**
 * Structural equality on actions, used to check membership in getLegalActions.
 * Actions are small flat JSON objects, so a stable stringify is sufficient and
 * far clearer than a hand-written comparator per action type.
 */
export function isLegalAction(
  state: GameState,
  action: GameAction,
  content: Content,
): boolean {
  if (!('seat' in action)) return false;
  const legal = getLegalActions(state, action.seat, content);
  return legal.some((a) => sameAction(a, action));
}

function sameAction(a: GameAction, b: GameAction): boolean {
  if (a.t !== b.t) return false;
  // ANSWER carries an opaque payload that legality cannot enumerate; matching
  // on the prompt id is the meaningful check.
  if (a.t === 'ANSWER' && b.t === 'ANSWER') return a.promptId === b.promptId;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function nextSeatInOrder(state: GameState, from: SeatId): SeatId | null {
  const order = state.turnOrder;
  if (order.length === 0) return null;
  const i = order.indexOf(from);
  if (i === -1) return order[0] ?? null;

  // Skip dead and removed players; if nobody is left, fall back to the same
  // seat rather than looping forever.
  for (let step = 1; step <= order.length; step++) {
    const candidate = order[(i + step) % order.length];
    const p = candidate ? state.players[candidate] : undefined;
    if (candidate && p && !p.isDead && !p.removed) return candidate;
  }
  return from;
}
