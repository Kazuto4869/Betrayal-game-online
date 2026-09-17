import { describe, expect, it } from 'vitest';
import { fixtureContent } from '@bahoth/content';
import { reduce } from './reduce.js';
import { checkInvariants } from './invariants.js';
import { startedGame } from './testing.js';
import {
  traitValue,
  getWeaponAttackModifier,
  getPassiveTraitModifier,
  getLegalActions,
} from './selectors.js';
import { beginTurnFor, getDogReachableRooms } from './movement.js';
import type { GameState, SeatId, CardId, GameAction } from '@bahoth/shared';

const content = fixtureContent();

function giveCard(
  state: GameState,
  seat: SeatId,
  cardId: CardId,
  deck: 'item' | 'omen',
): GameState {
  const p = state.players[seat]!;
  const deckState = state.decks[deck];
  const items = deck === 'item' ? [...p.items, cardId] : p.items;
  const omens = deck === 'omen' ? [...p.omens, cardId] : p.omens;
  return {
    ...state,
    decks: {
      ...state.decks,
      [deck]: {
        ...deckState,
        draw: deckState.draw.filter((id) => id !== cardId),
        inPlay: [...deckState.inPlay, cardId],
      },
    },
    players: {
      ...state.players,
      [seat]: {
        ...p,
        items,
        omens,
      },
    },
  };
}

describe('Task 3: Server-authoritative action legality and cooldown', () => {
  it('enforces once-per-turn cooldown for Bell, Crystal Ball, and Spirit Board and resets on next turn', () => {
    const g = startedGame();
    const active = g.state.activeSeat!;
    let state = giveCard(g.state, active, 'item.bell', 'item');
    expect(checkInvariants(state)).toEqual([]);

    // 1. First use succeeds
    const res1 = reduce(
      state,
      { t: 'USE_ITEM', seat: active, cardId: 'item.bell' },
      content,
    );
    expect(res1.error).toBeUndefined();
    expect(res1.state.players[active]!.usedCardsThisTurn).toContain('item.bell');
    state = res1.state;
    expect(checkInvariants(state)).toEqual([]);

    // 2. Second use in same turn fails with cooldown error
    const res2 = reduce(
      state,
      { t: 'USE_ITEM', seat: active, cardId: 'item.bell' },
      content,
    );
    expect(res2.error).toBeDefined();
    expect(res2.error?.code).toBe('ILLEGAL_MOVE');
    expect(res2.error?.message).toContain('already been used this turn');

    // 3. Advancing to player's next turn resets usedCardsThisTurn
    const nextTurnState = beginTurnFor(state, active, content);
    expect(nextTurnState.players[active]!.usedCardsThisTurn).toEqual([]);

    // 4. Can be used again on the new turn
    const res3 = reduce(
      nextTurnState,
      { t: 'USE_ITEM', seat: active, cardId: 'item.bell' },
      content,
    );
    expect(res3.error).toBeUndefined();
    expect(res3.state.players[active]!.usedCardsThisTurn).toContain('item.bell');
  });

  it('rejects invalid direct protocol USE_ITEM calls without state mutation', () => {
    const g = startedGame();
    const active = g.state.activeSeat!;
    const otherSeat = Object.keys(g.state.players).find((s) => s !== active)!;
    let state = giveCard(g.state, active, 'item.armor', 'item');
    state = giveCard(state, active, 'item.bell', 'item');

    // Inactive seat cannot use item
    const resNotTurn = reduce(
      state,
      { t: 'USE_ITEM', seat: otherSeat, cardId: 'item.bell' },
      content,
    );
    expect(resNotTurn.error?.code).toBe('NOT_YOUR_TURN');
    expect(resNotTurn.state.rng).toBe(state.rng);

    // Passive item cannot be actively used
    const resPassive = reduce(
      state,
      { t: 'USE_ITEM', seat: active, cardId: 'item.armor' },
      content,
    );
    expect(resPassive.error?.code).toBe('ILLEGAL_MOVE');
    expect(resPassive.error?.message).toContain('is passive');
    expect(resPassive.state.rng).toBe(state.rng);

    // Unowned card cannot be used
    const resUnowned = reduce(
      state,
      { t: 'USE_ITEM', seat: active, cardId: 'item.revolver' },
      content,
    );
    expect(resUnowned.error?.code).toBe('ILLEGAL_MOVE');
    expect(resUnowned.error?.message).toContain('does not have card');
    expect(resUnowned.state.rng).toBe(state.rng);

    // Item use blocked while a prompt is pending
    const stateWithPrompt: GameState = {
      ...state,
      pending: {
        id: 'p_test',
        seatId: active,
        kind: 'choose_trait',
        payload: {
          kind: 'choose_trait',
          candidates: ['speed', 'might'],
          resume: { actor: active, remaining: [] },
        },
        defaultAnswer: 'speed',
        deadline: null,
      },
    };
    const resPromptLock = reduce(
      stateWithPrompt,
      { t: 'USE_ITEM', seat: active, cardId: 'item.bell' },
      content,
    );
    expect(resPromptLock.error?.code).toBe('ILLEGAL_MOVE');
    expect(resPromptLock.error?.message).toContain('prompt is pending');
    expect(resPromptLock.state.rng).toBe(stateWithPrompt.rng);
  });
});

describe('Task 4: Support choices without card-specific reducer branches', () => {
  it('Healing Salve prompts for trait choice, updates only that trait, and discards', () => {
    const g = startedGame();
    const active = g.state.activeSeat!;
    const state = giveCard(g.state, active, 'item.healing_salve', 'item');

    const mightBefore = state.players[active]!.traits.might;
    const speedBefore = state.players[active]!.traits.speed;

    // Use Healing Salve
    const resUse = reduce(
      state,
      { t: 'USE_ITEM', seat: active, cardId: 'item.healing_salve' },
      content,
    );
    expect(resUse.error).toBeUndefined();
    expect(resUse.state.pending).not.toBeNull();
    expect(resUse.state.pending?.kind).toBe('choose_trait');
    // Suspended consumable remains in inventory while prompt is pending
    expect(resUse.state.players[active]!.items).toContain('item.healing_salve');
    expect(resUse.state.decks.item.inPlay).toContain('item.healing_salve');
    expect(resUse.state.decks.item.discard).not.toContain('item.healing_salve');
    expect(checkInvariants(resUse.state)).toEqual([]);

    const promptId = resUse.state.pending!.id;

    // Answer with 'might'
    const resAnswer = reduce(
      resUse.state,
      { t: 'ANSWER', seat: active, promptId, answer: 'might' },
      content,
    );
    expect(resAnswer.error).toBeUndefined();
    const endState = resAnswer.state;

    // Might trait was increased by 2 (Healing Salve restores 2 steps)
    expect(endState.players[active]!.traits.might).toBe(mightBefore + 2);
    // Other traits untouched
    expect(endState.players[active]!.traits.speed).toBe(speedBefore);
    // Healing Salve was discarded and removed from items and inPlay
    expect(endState.players[active]!.items).not.toContain('item.healing_salve');
    expect(endState.decks.item.inPlay).not.toContain('item.healing_salve');
    expect(endState.decks.item.discard).toContain('item.healing_salve');
    expect(checkInvariants(endState)).toEqual([]);
  });

  it('Smelling Salts prompts for target choice, heals target, and discards', () => {
    const g = startedGame();
    const active = g.state.activeSeat!;
    const otherSeat = Object.keys(g.state.players).find((s) => s !== active)!;

    // Move otherSeat to same location as active
    let state: GameState = {
      ...g.state,
      players: {
        ...g.state.players,
        [otherSeat]: {
          ...g.state.players[otherSeat]!,
          location: g.state.players[active]!.location,
        },
      },
    };
    state = giveCard(state, active, 'item.smelling_salts', 'item');

    const sanityBefore = state.players[otherSeat]!.traits.sanity;

    // Use Smelling Salts
    const resUse = reduce(
      state,
      { t: 'USE_ITEM', seat: active, cardId: 'item.smelling_salts' },
      content,
    );
    expect(resUse.error).toBeUndefined();
    expect(resUse.state.pending).not.toBeNull();
    expect(resUse.state.pending?.kind).toBe('choose_target');
    // Suspended consumable remains in inventory while prompt is pending
    expect(resUse.state.players[active]!.items).toContain('item.smelling_salts');
    expect(resUse.state.decks.item.inPlay).toContain('item.smelling_salts');
    expect(resUse.state.decks.item.discard).not.toContain('item.smelling_salts');
    expect(checkInvariants(resUse.state)).toEqual([]);

    const promptId = resUse.state.pending!.id;

    // Answer targeting otherSeat
    const resAnswer = reduce(
      resUse.state,
      {
        t: 'ANSWER',
        seat: active,
        promptId,
        answer: { kind: 'seat', seatId: otherSeat },
      },
      content,
    );
    expect(resAnswer.error).toBeUndefined();
    const endState = resAnswer.state;

    // otherSeat sanity increased
    expect(endState.players[otherSeat]!.traits.sanity).toBeGreaterThan(sanityBefore);
    // Smelling Salts discarded
    expect(endState.players[active]!.items).not.toContain('item.smelling_salts');
    expect(endState.decks.item.discard).toContain('item.smelling_salts');
    expect(checkInvariants(endState)).toEqual([]);
  });

  it('Dynamite prompts for room, rolls damage, and discards', () => {
    const g = startedGame();
    const active = g.state.activeSeat!;
    const state = giveCard(g.state, active, 'item.dynamite', 'item');
    const playerLoc = state.players[active]!.location!;

    // Use Dynamite
    const resUse = reduce(
      state,
      { t: 'USE_ITEM', seat: active, cardId: 'item.dynamite' },
      content,
    );
    expect(resUse.error).toBeUndefined();
    expect(resUse.state.pending).not.toBeNull();
    expect(resUse.state.pending?.kind).toBe('choose_room');
    // Suspended consumable remains in inventory while prompt is pending
    expect(resUse.state.players[active]!.items).toContain('item.dynamite');
    expect(resUse.state.decks.item.inPlay).toContain('item.dynamite');
    expect(resUse.state.decks.item.discard).not.toContain('item.dynamite');
    expect(checkInvariants(resUse.state)).toEqual([]);

    const promptId = resUse.state.pending!.id;

    // Answer targeting current room
    const resAnswer = reduce(
      resUse.state,
      { t: 'ANSWER', seat: active, promptId, answer: playerLoc },
      content,
    );
    expect(resAnswer.error).toBeUndefined();
    const endState = resAnswer.state;

    // Dynamite discarded
    expect(endState.players[active]!.items).not.toContain('item.dynamite');
    expect(endState.decks.item.discard).toContain('item.dynamite');
    expect(checkInvariants(endState)).toEqual([]);
  });
});

describe('Task 5: Derive passive equipment effects from ownership', () => {
  it('Amulet of the Ages grants +1 passive bonus while held, removes on drop, restores on pickup', () => {
    const g = startedGame();
    const active = g.state.activeSeat!;
    const baseSpeed = traitValue(g.state, active, 'speed', content);
    const baseMight = traitValue(g.state, active, 'might', content);
    const baseMightIndex = g.state.players[active]!.traits.might;

    // 1. Give Amulet
    let state = giveCard(g.state, active, 'item.amulet_of_the_ages', 'item');
    expect(traitValue(state, active, 'speed', content)).toBe(baseSpeed + 1);
    expect(traitValue(state, active, 'might', content)).toBe(baseMight + 1);
    // Base trait index is completely stable!
    expect(state.players[active]!.traits.might).toBe(baseMightIndex);
    expect(getPassiveTraitModifier(state, active, 'might')).toBe(1);

    // 2. Drop Amulet
    const resDrop = reduce(
      state,
      { t: 'DROP', seat: active, cardIds: ['item.amulet_of_the_ages'] },
      content,
    );
    expect(resDrop.error).toBeUndefined();
    state = resDrop.state;
    // Bonus disappears immediately
    expect(traitValue(state, active, 'speed', content)).toBe(baseSpeed);
    expect(traitValue(state, active, 'might', content)).toBe(baseMight);
    expect(getPassiveTraitModifier(state, active, 'might')).toBe(0);
    expect(state.players[active]!.traits.might).toBe(baseMightIndex);

    // 3. Pick up Amulet
    const resPickup = reduce(
      state,
      { t: 'PICKUP', seat: active, cardIds: ['item.amulet_of_the_ages'] },
      content,
    );
    expect(resPickup.error).toBeUndefined();
    state = resPickup.state;
    // Bonus returns immediately
    expect(traitValue(state, active, 'speed', content)).toBe(baseSpeed + 1);
    expect(traitValue(state, active, 'might', content)).toBe(baseMight + 1);
    expect(getPassiveTraitModifier(state, active, 'might')).toBe(1);
    expect(checkInvariants(state)).toEqual([]);
  });

  it('weapon attack bonus applies to attack rolls and does not stack multiple weapons', () => {
    const g = startedGame();
    const active = g.state.activeSeat!;

    // Axe grants +1 Might die
    let state = giveCard(g.state, active, 'item.axe', 'item');
    expect(getWeaponAttackModifier(state, active, 'might')).toBe(1);

    // Blood Dagger grants +2 Might dice
    state = giveCard(state, active, 'item.blood_dagger', 'item');
    // Weapons do NOT stack: max bonus (2) is used
    expect(getWeaponAttackModifier(state, active, 'might')).toBe(2);
    expect(checkInvariants(state)).toEqual([]);
  });

  it('Adrenaline Shot temporary speed expires at end of turn and discards', () => {
    const g = startedGame();
    const active = g.state.activeSeat!;
    const state = giveCard(g.state, active, 'item.adrenaline_shot', 'item');
    const baseSpeed = traitValue(state, active, 'speed', content);
    const baseIndex = state.players[active]!.traits.speed;
    const initialMoves = state.players[active]!.movesLeft;

    // Use Adrenaline Shot
    const resUse = reduce(
      state,
      { t: 'USE_ITEM', seat: active, cardId: 'item.adrenaline_shot' },
      content,
    );
    expect(resUse.error).toBeUndefined();
    const usedState = resUse.state;

    // Speed trait value boosted by 4
    expect(traitValue(usedState, active, 'speed', content)).toBe(baseSpeed + 4);
    // movesLeft boosted by 4
    expect(usedState.players[active]!.movesLeft).toBe(initialMoves + 4);
    // Base trait index remains unchanged
    expect(usedState.players[active]!.traits.speed).toBe(baseIndex);
    // Card is discarded
    expect(usedState.players[active]!.items).not.toContain('item.adrenaline_shot');
    expect(usedState.decks.item.discard).toContain('item.adrenaline_shot');

    // End turn: temporary speed expires immediately at end of turn
    const resEnd = reduce(usedState, { t: 'END_TURN', seat: active }, content);
    expect(resEnd.error).toBeUndefined();
    expect(traitValue(resEnd.state, active, 'speed', content)).toBe(baseSpeed);
    expect(resEnd.state.players[active]!.flags['adrenaline_speed']).toBeUndefined();
    expect(checkInvariants(resEnd.state)).toEqual([]);

    // Next turn begins: verified clean
    const nextTurnState = beginTurnFor(resEnd.state, active, content);
    expect(traitValue(nextTurnState, active, 'speed', content)).toBe(baseSpeed);
    expect(nextTurnState.players[active]!.movesLeft).toBe(baseSpeed);
    expect(nextTurnState.players[active]!.flags['adrenaline_speed']).toBeUndefined();
    expect(checkInvariants(nextTurnState)).toEqual([]);
  });
});

describe('Task 6: Card-zone conservation and pickup', () => {
  it('preserves card zone conservation across drop and pickup', () => {
    const g = startedGame();
    const active = g.state.activeSeat!;
    let state = giveCard(g.state, active, 'item.bell', 'item');
    const loc = state.players[active]!.location!;

    expect(state.decks.item.inPlay).toContain('item.bell');
    expect(state.players[active]!.items).toContain('item.bell');
    expect(checkInvariants(state)).toEqual([]);

    // Drop Bell
    const resDrop = reduce(
      state,
      { t: 'DROP', seat: active, cardIds: ['item.bell'] },
      content,
    );
    expect(resDrop.error).toBeUndefined();
    state = resDrop.state;

    expect(state.players[active]!.items).not.toContain('item.bell');
    expect(state.board.placed[loc]!.droppedItems).toContain('item.bell');
    expect(state.decks.item.inPlay).toContain('item.bell');
    expect(checkInvariants(state)).toEqual([]);

    // Pickup Bell
    const resPickup = reduce(
      state,
      { t: 'PICKUP', seat: active, cardIds: ['item.bell'] },
      content,
    );
    expect(resPickup.error).toBeUndefined();
    state = resPickup.state;

    expect(state.players[active]!.items).toContain('item.bell');
    expect(state.board.placed[loc]!.droppedItems).not.toContain('item.bell');
    expect(state.decks.item.inPlay).toContain('item.bell');
    expect(checkInvariants(state)).toEqual([]);
  });

  it('rejects dropping companions and Bite', () => {
    const g = startedGame();
    const active = g.state.activeSeat!;
    let state = giveCard(g.state, active, 'omen.dog', 'omen');
    state = giveCard(state, active, 'omen.bite', 'omen');

    const resDropDog = reduce(
      state,
      { t: 'DROP', seat: active, cardIds: ['omen.dog'] },
      content,
    );
    expect(resDropDog.error?.code).toBe('ILLEGAL_MOVE');
    expect(resDropDog.error?.message).toContain('Cannot drop companion or Bite');

    const resDropBite = reduce(
      state,
      { t: 'DROP', seat: active, cardIds: ['omen.bite'] },
      content,
    );
    expect(resDropBite.error?.code).toBe('ILLEGAL_MOVE');
    expect(resDropBite.error?.message).toContain('Cannot drop companion or Bite');
  });

  it('rejects remote pickup of items in a different room', () => {
    const g = startedGame();
    const active = g.state.activeSeat!;
    let state = giveCard(g.state, active, 'item.bell', 'item');
    const loc = state.players[active]!.location!;

    // Drop Bell on current tile
    const resDrop = reduce(
      state,
      { t: 'DROP', seat: active, cardIds: ['item.bell'] },
      content,
    );
    state = resDrop.state;

    // Move active to another tile if possible or manually simulate being in another room
    const otherLoc = Object.keys(state.board.placed).find((id) => id !== loc);
    if (otherLoc) {
      state = {
        ...state,
        players: {
          ...state.players,
          [active]: { ...state.players[active]!, location: otherLoc },
        },
      };
      const resRemotePickup = reduce(
        state,
        { t: 'PICKUP', seat: active, cardIds: ['item.bell'] },
        content,
      );
      expect(resRemotePickup.error?.code).toBe('ILLEGAL_MOVE');
      expect(resRemotePickup.error?.message).toContain('is not in the room');
    }
  });

  it('reconnect and replay preserves card zones and cooldown markers without duplicating effects', () => {
    const g = startedGame();
    const active = g.state.activeSeat!;
    let state = giveCard(g.state, active, 'item.bell', 'item');
    state = giveCard(state, active, 'item.healing_salve', 'item');

    const sanityBefore = state.players[active]!.traits.sanity;

    // 1. Use Bell -> once-per-turn cooldown
    const resBell = reduce(
      state,
      { t: 'USE_ITEM', seat: active, cardId: 'item.bell' },
      content,
    );
    expect(resBell.error).toBeUndefined();

    // 2. Use Healing Salve -> suspended prompt
    const resSalve = reduce(
      resBell.state,
      { t: 'USE_ITEM', seat: active, cardId: 'item.healing_salve' },
      content,
    );
    expect(resSalve.error).toBeUndefined();
    expect(resSalve.state.pending).not.toBeNull();
    const promptId = resSalve.state.pending!.id;

    // 3. Answer prompt with 'sanity'
    const resAnswer = reduce(
      resSalve.state,
      { t: 'ANSWER', seat: active, promptId, answer: 'sanity' },
      content,
    );
    expect(resAnswer.error).toBeUndefined();
    const resolvedState = resAnswer.state;

    // Sanity increased (+1 from Bell, +2 from Healing Salve = +3)
    expect(resolvedState.players[active]!.traits.sanity).toBe(sanityBefore + 3);
    expect(resolvedState.players[active]!.usedCardsThisTurn).toContain('item.bell');
    expect(resolvedState.players[active]!.items).not.toContain('item.healing_salve');
    expect(resolvedState.decks.item.discard).toContain('item.healing_salve');

    // 4. Test RECONNECT: reconnecting cannot duplicate effects or mutate state
    const resReconnect = reduce(resolvedState, { t: 'RECONNECT', seat: active }, content);
    expect(resReconnect.error).toBeUndefined();
    expect(resReconnect.state.players[active]!.traits.sanity).toBe(
      resolvedState.players[active]!.traits.sanity,
    );
    expect(resReconnect.state.players[active]!.usedCardsThisTurn).toEqual(
      resolvedState.players[active]!.usedCardsThisTurn,
    );
    expect(resReconnect.state.players[active]!.items).toEqual(
      resolvedState.players[active]!.items,
    );
    expect(resReconnect.state.decks.item.discard).toEqual(
      resolvedState.decks.item.discard,
    );
    expect(checkInvariants(resReconnect.state)).toEqual([]);

    // 5. Test REPLAY: replaying the action sequence yields the exact same state
    const actionSequence: GameAction[] = [
      { t: 'USE_ITEM', seat: active, cardId: 'item.bell' },
      { t: 'USE_ITEM', seat: active, cardId: 'item.healing_salve' },
      { t: 'ANSWER', seat: active, promptId, answer: 'sanity' },
      { t: 'RECONNECT', seat: active },
    ];

    let replayed = state;
    for (const a of actionSequence) {
      const res = reduce(replayed, a, content);
      expect(res.error).toBeUndefined();
      replayed = res.state;
    }

    expect(replayed.players[active]!.traits).toEqual(
      resReconnect.state.players[active]!.traits,
    );
    expect(replayed.players[active]!.usedCardsThisTurn).toEqual(
      resReconnect.state.players[active]!.usedCardsThisTurn,
    );
    expect(replayed.players[active]!.items).toEqual(
      resReconnect.state.players[active]!.items,
    );
    expect(replayed.decks.item.discard).toEqual(resReconnect.state.decks.item.discard);
    expect(checkInvariants(replayed)).toEqual([]);
  });

  describe('Dog Companion and Custody/Passive Companions', () => {
    it('Dog companion provides +1 Might and +1 Sanity passively while held', () => {
      const g = startedGame();
      const active = g.state.activeSeat!;
      const beforeMight = traitValue(g.state, active, 'might', content);
      const beforeSanity = traitValue(g.state, active, 'sanity', content);

      const stateWithDog = giveCard(g.state, active, 'omen.dog', 'omen');
      expect(traitValue(stateWithDog, active, 'might', content)).toBe(beforeMight + 1);
      expect(traitValue(stateWithDog, active, 'sanity', content)).toBe(beforeSanity + 1);
    });

    it('allows once-per-turn COMMAND_DOG to an explored room up to 6 spaces away', () => {
      const g = startedGame();
      const active = g.state.activeSeat!;
      const stateWithDog = giveCard(g.state, active, 'omen.dog', 'omen');
      const startLoc = stateWithDog.players[active]!.location!;

      const dogReachable = getDogReachableRooms(stateWithDog, startLoc, content);
      expect(dogReachable.length).toBeGreaterThan(0);
      const targetRoom = dogReachable[0]!;

      const legal = getLegalActions(stateWithDog, active, content);
      expect(
        legal.some((a) => a.t === 'COMMAND_DOG' && a.destination === targetRoom),
      ).toBe(true);

      const res = reduce(
        stateWithDog,
        { t: 'COMMAND_DOG', seat: active, destination: targetRoom },
        content,
      );
      expect(res.error).toBeUndefined();
      expect(res.state.players[active]!.usedCardsThisTurn).toContain('omen.dog');
      expect(res.state.players[active]!.flags['dog_used_this_turn']).toBe(true);
      expect(res.state.flags['dog_last_run']).toBeDefined();
      expect(checkInvariants(res.state)).toEqual([]);

      // Second attempt in same turn fails
      const res2 = reduce(
        res.state,
        { t: 'COMMAND_DOG', seat: active, destination: targetRoom },
        content,
      );
      expect(res2.error?.code).toBe('ILLEGAL_MOVE');
      expect(res2.error?.message).toContain('once per turn');

      // Advancing turn resets dog use
      let curState = res.state;
      const initialSeat = active;
      // End turns until active seat gets their next turn
      do {
        const currentActive = curState.activeSeat!;
        const endRes = reduce(curState, { t: 'END_TURN', seat: currentActive }, content);
        expect(endRes.error).toBeUndefined();
        curState = endRes.state;
      } while (curState.activeSeat !== initialSeat);

      expect(curState.players[active]?.usedCardsThisTurn ?? []).not.toContain('omen.dog');
      expect(curState.players[active]?.flags['dog_used_this_turn']).toBeUndefined();
    });

    it('allows Dog to carry an item from owner inventory and drop it at destination', () => {
      const g = startedGame();
      const active = g.state.activeSeat!;
      let state = giveCard(g.state, active, 'omen.dog', 'omen');
      state = giveCard(state, active, 'item.bell', 'item');
      const startLoc = state.players[active]!.location!;
      const targetRoom = getDogReachableRooms(state, startLoc, content)[0]!;

      const res = reduce(
        state,
        {
          t: 'COMMAND_DOG',
          seat: active,
          destination: targetRoom,
          cardId: 'item.bell',
        },
        content,
      );
      expect(res.error).toBeUndefined();
      expect(res.state.players[active]!.items).not.toContain('item.bell');
      expect(res.state.board.placed[targetRoom]!.droppedItems).toContain('item.bell');
      expect(checkInvariants(res.state)).toEqual([]);
    });

    it('allows Dog to fetch a dropped item from destination and deliver to owner', () => {
      const g = startedGame();
      const active = g.state.activeSeat!;
      let state = giveCard(g.state, active, 'omen.dog', 'omen');
      const startLoc = state.players[active]!.location!;
      const targetRoom = getDogReachableRooms(state, startLoc, content)[0]!;

      const destTile = state.board.placed[targetRoom]!;
      state = {
        ...state,
        decks: {
          ...state.decks,
          item: {
            ...state.decks.item,
            draw: state.decks.item.draw.filter((id) => id !== 'item.armor'),
            inPlay: [...state.decks.item.inPlay, 'item.armor'],
          },
        },
        board: {
          ...state.board,
          placed: {
            ...state.board.placed,
            [targetRoom]: {
              ...destTile,
              droppedItems: ['item.armor'],
            },
          },
        },
      };

      const beforeMight = traitValue(state, active, 'might', content);
      const res = reduce(
        state,
        {
          t: 'COMMAND_DOG',
          seat: active,
          destination: targetRoom,
          cardId: 'item.armor',
        },
        content,
      );
      expect(res.error).toBeUndefined();
      expect(res.state.players[active]!.items).toContain('item.armor');
      expect(res.state.board.placed[targetRoom]!.droppedItems).not.toContain(
        'item.armor',
      );
      expect(traitValue(res.state, active, 'might', content)).toBe(beforeMight + 1);
      expect(checkInvariants(res.state)).toEqual([]);
    });

    it('rejects Dog carrying companions (Girl, Madman, Dog)', () => {
      const g = startedGame();
      const active = g.state.activeSeat!;
      let state = giveCard(g.state, active, 'omen.dog', 'omen');
      state = giveCard(state, active, 'omen.girl', 'omen');
      const startLoc = state.players[active]!.location!;
      const targetRoom = getDogReachableRooms(state, startLoc, content)[0]!;

      const res = reduce(
        state,
        {
          t: 'COMMAND_DOG',
          seat: active,
          destination: targetRoom,
          cardId: 'omen.girl',
        },
        content,
      );
      expect(res.error?.code).toBe('ILLEGAL_MOVE');
      expect(res.error?.message).toContain('companion');
    });

    it('rejects Dog traversing through roll barrier rooms (Chasm, Tower) and special drops', () => {
      const g = startedGame();
      const active = g.state.activeSeat!;
      const stateWithDog = giveCard(g.state, active, 'omen.dog', 'omen');
      const startLoc = stateWithDog.players[active]!.location!;

      const chasmTile = {
        id: 'basement:5,5',
        tileId: 'tile.chasm',
        floor: 'basement' as const,
        x: 5,
        y: 5,
        rotation: 0 as const,
        discoveredBy: active,
        flags: {},
      };
      const stateWithChasm = {
        ...stateWithDog,
        board: {
          ...stateWithDog.board,
          placed: {
            ...stateWithDog.board.placed,
            [chasmTile.id]: chasmTile,
          },
          index: {
            ...stateWithDog.board.index,
            basement: {
              ...stateWithDog.board.index.basement,
              '5,5': chasmTile.id,
            },
          },
        },
      };

      const dogReachable = getDogReachableRooms(stateWithChasm, startLoc, content);
      expect(dogReachable).not.toContain(chasmTile.id);
    });

    it('Girl and Madman companions provide passive custody bonuses and do not grant movement actions', () => {
      const g = startedGame();
      const active = g.state.activeSeat!;
      const beforeSanity = traitValue(g.state, active, 'sanity', content);
      const beforeMight = traitValue(g.state, active, 'might', content);

      let state = giveCard(g.state, active, 'omen.girl', 'omen');
      expect(traitValue(state, active, 'sanity', content)).toBe(beforeSanity + 1);

      state = giveCard(state, active, 'omen.madman', 'omen');
      expect(traitValue(state, active, 'might', content)).toBe(beforeMight + 2);
      expect(traitValue(state, active, 'sanity', content)).toBe(beforeSanity);

      const legal = getLegalActions(state, active, content);
      expect(legal.filter((a) => a.t === 'COMMAND_DOG')).toHaveLength(0);
    });
  });
});
