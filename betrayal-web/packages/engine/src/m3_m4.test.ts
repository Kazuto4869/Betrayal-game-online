import { describe, expect, it } from 'vitest';
import { fixtureContent } from '@bahoth/content';
import { reduce } from './reduce.js';
import { checkInvariants } from './invariants.js';
import { startedGame } from './testing.js';
import type { GameState } from '@bahoth/shared';

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

    const beforeSpeed = stateWithItem.players[active]!.traits.speed;
    const resUse = reduce(
      stateWithItem,
      { t: 'USE_ITEM', seat: active, cardId: 'item.adrenaline_shot' },
      content,
    );
    expect(resUse.error).toBeUndefined();
    expect(resUse.state.players[active]!.traits.speed).toBeGreaterThan(beforeSpeed);
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
        acknowledged: [],
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
        acknowledged: [],
      },
      players: {
        ...g.state.players,
        [active]: { ...g.state.players[active]!, location: loc, traits: { ...g.state.players[active]!.traits, might: 8 } },
        // Opponent has Might 1, taking any damage drops them to skull (index 0)
        [opponent]: { ...g.state.players[opponent]!, location: loc, isTraitor: true, traits: { ...g.state.players[opponent]!.traits, might: 1 } },
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
        acknowledged: [],
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
