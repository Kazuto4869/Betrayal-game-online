import { describe, expect, it } from 'vitest';
import { fixtureContent } from '@bahoth/content';
import { reduce } from './reduce.js';
import { checkInvariants } from './invariants.js';
import { startedGame } from './testing.js';
import type { GameState } from '@bahoth/shared';
import { traitValue, getLegalActions } from './selectors.js';

const content = fixtureContent();

describe('M3: Cards, Decks, and Items', () => {
  it('initializes and shuffles item, event, and omen decks at START_GAME', () => {
    const g = startedGame();
    expect(g.state.phase).toBe('explore');
    expect(g.state.decks.item.draw.length).toBeGreaterThan(0);
    expect(g.state.decks.event.draw.length).toBeGreaterThan(0);
    expect(g.state.decks.omen.draw.length).toBeGreaterThan(0);
    expect(g.state.omensDrawn).toBe(0);
    expect(g.state.haunt).toBeNull();
    expect(checkInvariants(g.state)).toEqual([]);
  });

  it('allows players to USE_ITEM and DROP items', () => {
    const g = startedGame();
    const active = g.state.activeSeat!;
    const stateWithItem = state_with_item(g.state, active, 'item.adrenaline_shot');

    const beforeSpeed = traitValue(stateWithItem, active, 'speed', content);
    const beforeIndex = stateWithItem.players[active]!.traits.speed;
    const resUse = reduce(
      stateWithItem,
      { t: 'USE_ITEM', seat: active, cardId: 'item.adrenaline_shot' },
      content,
    );
    expect(resUse.error).toBeUndefined();
    expect(traitValue(resUse.state, active, 'speed', content)).toBeGreaterThan(
      beforeSpeed,
    );
    expect(resUse.state.players[active]!.traits.speed).toBe(beforeIndex);
    expect(checkInvariants(resUse.state)).toEqual([]);

    // Test DROP
    const resDrop = reduce(
      stateWithItem,
      { t: 'DROP', seat: active, cardIds: ['item.adrenaline_shot'] },
      content,
    );
    expect(resDrop.error).toBeUndefined();
    expect(resDrop.state.players[active]!.items).not.toContain('item.adrenaline_shot');
    expect(checkInvariants(resDrop.state)).toEqual([]);
  });
});

describe('M4: Haunt Roll, Haunt Trigger, and Combat', () => {
  it('triggers haunt roll on omen card draw and selects traitor', () => {
    const g = startedGame();
    const state = {
      ...g.state,
      omensDrawn: 6,
      decks: {
        ...g.state.decks,
        omen: {
          ...g.state.decks.omen,
          draw: ['omen.bite', ...g.state.decks.omen.draw],
        },
      },
    };
    expect(state.haunt).toBeNull();
  });

  it('resolves ATTACK combat during haunt phase and inflicts damage', () => {
    const g = startedGame();
    const active = g.state.activeSeat!;
    const opponent = g.state.turnOrder.find((s) => s !== active)!;
    const loc = g.state.players[active]!.location;

    const state: GameState = {
      ...g.state,
      phase: 'haunt',
      haunt: {
        hauntId: 1,
        traitorSeat: opponent,
        revealed: true,
        acknowledged: [...g.state.turnOrder],
      },
      players: {
        ...g.state.players,
        [active]: { ...g.state.players[active]!, location: loc },
        [opponent]: { ...g.state.players[opponent]!, location: loc, isTraitor: true },
      },
    };

    const resAttack = reduce(
      state,
      {
        t: 'ATTACK',
        seat: active,
        target: { kind: 'seat', seatId: opponent },
        trait: 'might',
      },
      content,
    );

    expect(resAttack.error).toBeUndefined();
    expect(resAttack.events.some((e) => e.t === 'attacked')).toBe(true);
    expect(resAttack.state.players[active]!.hasAttackedThisTurn).toBe(true);
    expect(checkInvariants(resAttack.state)).toEqual([]);
  });

  it('handles player death when trait hits 0 and triggers game over', () => {
    const g = startedGame();
    const active = g.state.activeSeat!;
    const opponent = g.state.turnOrder.find((s) => s !== active)!;
    const loc = g.state.players[active]!.location;

    const state: GameState = {
      ...g.state,
      phase: 'haunt',
      haunt: {
        hauntId: 1,
        traitorSeat: opponent,
        revealed: true,
        acknowledged: [...g.state.turnOrder],
      },
      players: {
        ...g.state.players,
        [active]: {
          ...g.state.players[active]!,
          location: loc,
          traits: { ...g.state.players[active]!.traits, might: 8 },
        },
        // Opponent has Might 1, taking any damage drops them to skull (index 0)
        [opponent]: {
          ...g.state.players[opponent]!,
          location: loc,
          isTraitor: true,
          traits: { ...g.state.players[opponent]!.traits, might: 1 },
        },
      },
    };

    const res = reduce(
      state,
      {
        t: 'ATTACK',
        seat: active,
        target: { kind: 'seat', seatId: opponent },
        trait: 'might',
      },
      content,
    );
    expect(res.error).toBeUndefined();
    expect(checkInvariants(res.state)).toEqual([]);
  });

  it('resolves monster combat and updates monster state', () => {
    const g = startedGame();
    const active = g.state.activeSeat!;
    const loc = g.state.players[active]!.location;

    const state: GameState = {
      ...g.state,
      phase: 'haunt',
      haunt: {
        hauntId: 1,
        traitorSeat: null,
        revealed: true,
        acknowledged: [...g.state.turnOrder],
      },
      monsters: {
        'monster.mummy': {
          id: 'monster.mummy',
          def: 'The Mummy',
          location: loc,
          isDead: false,
          flags: { might: 2, speed: 3, stunned: false },
        },
      },
      players: {
        ...g.state.players,
        [active]: {
          ...g.state.players[active]!,
          traits: { ...g.state.players[active]!.traits, might: 8 },
        },
      },
    };

    const res = reduce(
      state,
      {
        t: 'ATTACK',
        seat: active,
        target: { kind: 'monster', monsterId: 'monster.mummy' },
        trait: 'might',
      },
      content,
    );

    expect(res.error).toBeUndefined();
    expect(res.events.some((e) => e.t === 'attacked')).toBe(true);
    expect(res.state.players[active]!.hasAttackedThisTurn).toBe(true);
    expect(checkInvariants(res.state)).toEqual([]);
  });

  it('allows interacting with room tokens via ROOM_ACTION', () => {
    const g = startedGame();
    const active = g.state.activeSeat!;
    const loc = g.state.players[active]!.location;

    const state: GameState = {
      ...g.state,
      tokens: [
        {
          id: 'token.sarcophagus',
          token: 'Sarcophagus',
          location: loc,
          flags: {},
        },
      ],
    };

    const res = reduce(
      state,
      {
        t: 'ROOM_ACTION',
        seat: active,
        actionId: 'interact_token',
      },
      content,
    );

    expect(res.error).toBeUndefined();
    expect(res.state.tokens[0]!.flags['completed']).toBe(true);
    expect(checkInvariants(res.state)).toEqual([]);
  });
});

describe('Monster Turns and Monster Phase (Task 12)', () => {
  it('enters monster phase after traitor explorer turn ends with living monsters', () => {
    const g = startedGame();
    const traitor = g.state.turnOrder[1]!;
    const loc = g.state.players[traitor]!.location!;

    const state: GameState = {
      ...g.state,
      phase: 'haunt',
      activeSeat: traitor,
      haunt: {
        hauntId: 1,
        traitorSeat: traitor,
        revealed: true,
        acknowledged: [...g.state.turnOrder],
      },
      players: {
        ...g.state.players,
        [traitor]: { ...g.state.players[traitor]!, isTraitor: true },
      },
      monsters: {
        'monster.mummy': {
          id: 'monster.mummy',
          def: 'The Mummy',
          location: loc,
          isDead: false,
          flags: { might: 5, speed: 3, stunned: false },
        },
      },
      monsterTurn: null,
    };

    const res = reduce(state, { t: 'END_TURN', seat: traitor }, content);
    expect(res.error).toBeUndefined();
    expect(res.state.monsterTurn).toBeDefined();
    expect(res.state.monsterTurn?.controllingSeat).toBe(traitor);
    expect(res.state.monsterTurn?.activeMonsterId).toBeNull();
    expect(res.state.activeSeat).toBe(traitor);
    expect(checkInvariants(res.state)).toEqual([]);
  });

  it('rejects monster actions from non-controlling seats', () => {
    const g = startedGame();
    const traitor = g.state.turnOrder[1]!;
    const hero0 = g.state.turnOrder[0]!;
    const loc = g.state.players[traitor]!.location!;

    const state: GameState = {
      ...g.state,
      phase: 'haunt',
      activeSeat: traitor,
      haunt: {
        hauntId: 1,
        traitorSeat: traitor,
        revealed: true,
        acknowledged: [...g.state.turnOrder],
      },
      monsters: {
        'monster.mummy': {
          id: 'monster.mummy',
          def: 'The Mummy',
          location: loc,
          isDead: false,
          flags: { might: 5, speed: 3, stunned: false },
        },
      },
      monsterTurn: {
        activeMonsterId: null,
        actedMonsterIds: [],
        movesLeft: 0,
        hasAttacked: false,
        rolledSpeed: null,
        controllingSeat: traitor,
      },
    };

    const res = reduce(
      state,
      { t: 'START_MONSTER', seat: hero0, monsterId: 'monster.mummy' },
      content,
    );
    expect(res.error?.code).toBe('NOT_YOUR_TURN');

    const heroLegal = getLegalActions(state, hero0, content);
    expect(heroLegal).toEqual([]);

    const traitorLegal = getLegalActions(state, traitor, content);
    expect(
      traitorLegal.some(
        (a) => a.t === 'START_MONSTER' && a.monsterId === 'monster.mummy',
      ),
    ).toBe(true);
    expect(traitorLegal.some((a) => a.t === 'END_MONSTER_PHASE')).toBe(true);
  });

  it('rolls Speed with guaranteed min 1 move even on 0, moves monster and respects hero slowing', () => {
    const g = startedGame();
    const traitor = g.state.turnOrder[1]!;
    const hero0 = g.state.turnOrder[0]!;
    const hero1 = g.state.turnOrder[2]!;
    const startLoc = g.state.players[traitor]!.location!;
    const dest = Object.keys(g.state.board.placed).find((id) => id !== startLoc)!;

    const state: GameState = {
      ...g.state,
      phase: 'haunt',
      activeSeat: traitor,
      haunt: {
        hauntId: 1,
        traitorSeat: traitor,
        revealed: true,
        acknowledged: [...g.state.turnOrder],
      },
      players: {
        ...g.state.players,
        [traitor]: { ...g.state.players[traitor]!, isTraitor: true, location: startLoc },
        [hero0]: { ...g.state.players[hero0]!, location: startLoc },
        [hero1]: { ...g.state.players[hero1]!, location: dest },
      },
      monsters: {
        'monster.mummy': {
          id: 'monster.mummy',
          def: 'The Mummy',
          location: startLoc,
          isDead: false,
          flags: { might: 5, speed: 1, stunned: false },
        },
      },
      monsterTurn: {
        activeMonsterId: null,
        actedMonsterIds: [],
        movesLeft: 0,
        hasAttacked: false,
        rolledSpeed: null,
        controllingSeat: traitor,
      },
    };

    const resStart = reduce(
      state,
      { t: 'START_MONSTER', seat: traitor, monsterId: 'monster.mummy' },
      content,
    );
    expect(resStart.error).toBeUndefined();
    expect(resStart.state.monsterTurn?.activeMonsterId).toBe('monster.mummy');
    expect(resStart.state.monsterTurn?.movesLeft).toBeGreaterThanOrEqual(1);

    const lowMoveState: GameState = {
      ...resStart.state,
      monsterTurn: {
        ...resStart.state.monsterTurn!,
        movesLeft: 1,
      },
    };
    const resFailMove = reduce(
      lowMoveState,
      { t: 'MOVE_MONSTER', seat: traitor, monsterId: 'monster.mummy', to: dest },
      content,
    );
    expect(resFailMove.error?.code).toBe('ILLEGAL_MOVE');
    expect(resFailMove.error?.message).toContain('heroes requires 2 moves');

    const enoughMoveState: GameState = {
      ...resStart.state,
      monsterTurn: {
        ...resStart.state.monsterTurn!,
        movesLeft: 2,
      },
    };
    const resMove = reduce(
      enoughMoveState,
      { t: 'MOVE_MONSTER', seat: traitor, monsterId: 'monster.mummy', to: dest },
      content,
    );
    expect(resMove.error).toBeUndefined();
    expect(resMove.state.monsters['monster.mummy']!.location).toBe(dest);
    expect(resMove.state.monsterTurn?.movesLeft).toBe(0);
    expect(checkInvariants(resMove.state)).toEqual([]);
  });

  it('monster attacks hero and deals damage; hero winning does NOT stun monster on monster turn', () => {
    const g = startedGame();
    const traitor = g.state.turnOrder[1]!;
    const hero0 = g.state.turnOrder[0]!;
    const loc = g.state.players[traitor]!.location!;

    const state: GameState = {
      ...g.state,
      phase: 'haunt',
      activeSeat: traitor,
      haunt: {
        hauntId: 1,
        traitorSeat: traitor,
        revealed: true,
        acknowledged: [...g.state.turnOrder],
      },
      players: {
        ...g.state.players,
        [hero0]: {
          ...g.state.players[hero0]!,
          location: loc,
          traits: { ...g.state.players[hero0]!.traits, might: 8 },
        },
      },
      monsters: {
        'monster.mummy': {
          id: 'monster.mummy',
          def: 'The Mummy',
          location: loc,
          isDead: false,
          flags: { might: 1, speed: 3, stunned: false },
        },
      },
      monsterTurn: {
        activeMonsterId: 'monster.mummy',
        actedMonsterIds: [],
        movesLeft: 2,
        hasAttacked: false,
        rolledSpeed: 3,
        controllingSeat: traitor,
      },
    };

    const res = reduce(
      state,
      {
        t: 'MONSTER_ATTACK',
        seat: traitor,
        monsterId: 'monster.mummy',
        target: { kind: 'seat', seatId: hero0 },
        trait: 'might',
      },
      content,
    );
    expect(res.error).toBeUndefined();
    expect(res.state.monsterTurn?.hasAttacked).toBe(true);
    expect(res.state.monsters['monster.mummy']!.flags['stunned']).toBe(false);
    expect(res.state.monsters['monster.mummy']!.isDead).toBe(false);
    expect(checkInvariants(res.state)).toEqual([]);
  });

  it('stunned monster clears stun when started and cannot move or attack that turn', () => {
    const g = startedGame();
    const traitor = g.state.turnOrder[1]!;
    const loc = g.state.players[traitor]!.location!;

    const state: GameState = {
      ...g.state,
      phase: 'haunt',
      activeSeat: traitor,
      haunt: {
        hauntId: 1,
        traitorSeat: traitor,
        revealed: true,
        acknowledged: [...g.state.turnOrder],
      },
      monsters: {
        'monster.mummy': {
          id: 'monster.mummy',
          def: 'The Mummy',
          location: loc,
          isDead: false,
          flags: { might: 5, speed: 3, stunned: true },
        },
      },
      monsterTurn: {
        activeMonsterId: null,
        actedMonsterIds: [],
        movesLeft: 0,
        hasAttacked: false,
        rolledSpeed: null,
        controllingSeat: traitor,
      },
    };

    const res = reduce(
      state,
      { t: 'START_MONSTER', seat: traitor, monsterId: 'monster.mummy' },
      content,
    );
    expect(res.error).toBeUndefined();
    expect(res.state.monsters['monster.mummy']!.flags['stunned']).toBe(false);
    expect(
      res.state.monsterTurn === null ||
        res.state.monsterTurn.actedMonsterIds.includes('monster.mummy'),
    ).toBe(true);
    expect(checkInvariants(res.state)).toEqual([]);
  });

  it('advances round to first living hero after monster phase ends', () => {
    const g = startedGame();
    const traitor = g.state.turnOrder[2]!;
    const hero0 = g.state.turnOrder[0]!;
    const loc = g.state.players[traitor]!.location!;

    const state: GameState = {
      ...g.state,
      phase: 'haunt',
      activeSeat: traitor,
      haunt: {
        hauntId: 1,
        traitorSeat: traitor,
        revealed: true,
        acknowledged: [...g.state.turnOrder],
      },
      monsters: {
        'monster.mummy': {
          id: 'monster.mummy',
          def: 'The Mummy',
          location: loc,
          isDead: false,
          flags: { might: 5, speed: 3, stunned: false },
        },
      },
      monsterTurn: {
        activeMonsterId: null,
        actedMonsterIds: ['monster.mummy'],
        movesLeft: 0,
        hasAttacked: false,
        rolledSpeed: null,
        controllingSeat: traitor,
      },
    };

    const beforeRound = state.round;
    const res = reduce(state, { t: 'END_MONSTER_PHASE', seat: traitor }, content);
    expect(res.error).toBeUndefined();
    expect(res.state.monsterTurn).toBeNull();
    expect(res.state.activeSeat).toBe(hero0);
    expect(res.state.round).toBe(beforeRound + 1);
    expect(checkInvariants(res.state)).toEqual([]);
  });

  it('dead traitor with living monsters still runs monster phase at end of hero rounds', () => {
    const g = startedGame();
    const hero0 = g.state.turnOrder[0]!;
    const hero1 = g.state.turnOrder[1]!;
    const traitor = g.state.turnOrder[2]!;
    const loc = g.state.players[hero0]!.location!;

    const state: GameState = {
      ...g.state,
      phase: 'haunt',
      activeSeat: hero1,
      turnOrder: [hero0, hero1, traitor],
      haunt: {
        hauntId: 1,
        traitorSeat: traitor,
        revealed: true,
        acknowledged: [hero0, hero1, traitor],
      },
      players: {
        ...g.state.players,
        [traitor]: { ...g.state.players[traitor]!, isTraitor: true, isDead: true },
      },
      monsters: {
        'monster.mummy': {
          id: 'monster.mummy',
          def: 'The Mummy',
          location: loc,
          isDead: false,
          flags: { might: 5, speed: 3, stunned: false },
        },
      },
      monsterTurn: null,
    };

    const res = reduce(state, { t: 'END_TURN', seat: hero1 }, content);
    expect(res.error).toBeUndefined();
    expect(res.state.monsterTurn).toBeDefined();
    expect(res.state.monsterTurn?.controllingSeat).toBe(traitor);
    expect(res.state.activeSeat).toBe(traitor);
    expect(checkInvariants(res.state)).toEqual([]);
  });
});

function state_with_item(state: GameState, seat: string, cardId: string): GameState {
  const p = state.players[seat]!;
  return {
    ...state,
    decks: {
      ...state.decks,
      item: {
        ...state.decks.item,
        draw: state.decks.item.draw.filter((id) => id !== cardId),
        inPlay: [...state.decks.item.inPlay, cardId],
      },
    },
    players: {
      ...state.players,
      [seat]: { ...p, items: [...p.items, cardId] },
    },
  };
}
