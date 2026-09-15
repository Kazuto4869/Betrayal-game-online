import { describe, expect, it } from 'vitest';
import { fixtureContent } from '@bahoth/content';
import { startedGame } from './testing.js';
import { checkInvariants } from './invariants.js';
import { evalCondition } from './effects.js';
import { gainTrait, healTrait, killExplorer, loseTrait, setTrait } from './traits.js';
import { nextSeatInOrder } from './selectors.js';
import type { GameState } from '@bahoth/shared';

const content = fixtureContent();

describe('trait operations and death transitions', () => {
  it('GAIN_TRAIT advances index, caps at track max (index 8), and never revives the dead', () => {
    const { state } = startedGame();
    const seat = state.activeSeat!;
    const charId = state.players[seat]!.charId!;
    const char = content.charactersById[charId]!;
    const startMight = state.players[seat]!.traits.might;

    // 1. Gain +1
    const res1 = gainTrait(state, seat, 'might', 1, content);
    expect(res1.state.players[seat]!.traits.might).toBe(startMight + 1);
    expect(res1.events).toContainEqual({
      t: 'trait_changed',
      seat,
      trait: 'might',
      from: startMight,
      to: startMight + 1,
    });

    // 2. Gain +99 caps at max index (8 / track.length - 1)
    const maxIdx = char.tracks.might.length - 1;
    const resMax = gainTrait(state, seat, 'might', 99, content);
    expect(resMax.state.players[seat]!.traits.might).toBe(maxIdx);

    // 3. Dead explorer cannot gain traits or be revived
    const deadState: GameState = {
      ...state,
      players: {
        ...state.players,
        [seat]: { ...state.players[seat]!, isDead: true, traits: { ...state.players[seat]!.traits, might: 0 } },
      },
    };
    const resDead = gainTrait(deadState, seat, 'might', 3, content);
    expect(resDead.state.players[seat]!.isDead).toBe(true);
    expect(resDead.state.players[seat]!.traits.might).toBe(0);
    expect(resDead.events).toHaveLength(0);
  });

  it('LOSE_TRAIT in explore phase clamps to min 1 and never kills', () => {
    const { state } = startedGame();
    expect(state.phase).toBe('explore');
    const seat = state.activeSeat!;

    const res = loseTrait(state, seat, 'speed', 99, content);
    expect(res.state.players[seat]!.traits.speed).toBe(1);
    expect(res.state.players[seat]!.isDead).toBe(false);
    expect(res.events.some((e) => e.t === 'died')).toBe(false);
    expect(checkInvariants(res.state)).toEqual([]);
  });

  it('LOSE_TRAIT in haunt phase reaches index 0, kills explorer, sets movesLeft=0, and fires died once', () => {
    const { state: base } = startedGame();
    const seat = base.activeSeat!;
    const state: GameState = {
      ...base,
      phase: 'haunt',
      haunt: { hauntId: 1, traitorSeat: null, revealed: true, acknowledged: [] },
    };

    const res = loseTrait(state, seat, 'speed', 99, content);
    expect(res.state.players[seat]!.traits.speed).toBe(0);
    expect(res.state.players[seat]!.isDead).toBe(true);
    expect(res.state.players[seat]!.movesLeft).toBe(0);
    expect(res.events).toContainEqual({ t: 'died', seat });
    expect(checkInvariants(res.state)).toEqual([]);

    // Further loss while dead does not emit died again
    const resAgain = loseTrait(res.state, seat, 'speed', 1, content);
    expect(resAgain.events.filter((e) => e.t === 'died')).toHaveLength(0);
  });

  it('SET_TRAIT validates index bounds (0..8) and respects pre/post haunt death floor', () => {
    const { state } = startedGame();
    const seat = state.activeSeat!;

    // Invalid index throws without mutating
    expect(() => setTrait(state, seat, 'sanity', -1, content)).toThrow();
    expect(() => setTrait(state, seat, 'sanity', 9, content)).toThrow();
    expect(() => setTrait(state, seat, 'sanity', 2.5, content)).toThrow();

    // In explore phase: setting 0 is clamped to floor 1 (cannot die pre-haunt)
    const resPre = setTrait(state, seat, 'sanity', 0, content);
    expect(resPre.state.players[seat]!.traits.sanity).toBe(1);
    expect(resPre.state.players[seat]!.isDead).toBe(false);

    // In haunt phase: setting 0 reaches skull and kills explorer
    const hauntState: GameState = {
      ...state,
      phase: 'haunt',
      haunt: { hauntId: 1, traitorSeat: null, revealed: true, acknowledged: [] },
    };
    const resPost = setTrait(hauntState, seat, 'sanity', 0, content);
    expect(resPost.state.players[seat]!.traits.sanity).toBe(0);
    expect(resPost.state.players[seat]!.isDead).toBe(true);
    expect(resPost.events).toContainEqual({ t: 'died', seat });
  });

  it('HEAL_TRAIT restores to start index, does not lower above start, and does not revive', () => {
    const { state } = startedGame();
    const seat = state.activeSeat!;
    const charId = state.players[seat]!.charId!;
    const char = content.charactersById[charId]!;
    const startMight = char.start.might;

    // 1. Degraded below start -> heals up to start
    const degraded: GameState = {
      ...state,
      players: {
        ...state.players,
        [seat]: { ...state.players[seat]!, traits: { ...state.players[seat]!.traits, might: 1 } },
      },
    };
    const resHeal = healTrait(degraded, seat, 'might', content);
    expect(resHeal.state.players[seat]!.traits.might).toBe(startMight);
    expect(resHeal.events).toContainEqual({
      t: 'trait_changed',
      seat,
      trait: 'might',
      from: 1,
      to: startMight,
    });

    // 2. Above start -> heal is a no-op (does not lower)
    const buffed: GameState = {
      ...state,
      players: {
        ...state.players,
        [seat]: { ...state.players[seat]!, traits: { ...state.players[seat]!.traits, might: 8 } },
      },
    };
    const resBuffed = healTrait(buffed, seat, 'might', content);
    expect(resBuffed.state.players[seat]!.traits.might).toBe(8);
    expect(resBuffed.events).toHaveLength(0);

    // 3. Dead -> no-op
    const dead: GameState = {
      ...degraded,
      players: {
        ...degraded.players,
        [seat]: { ...degraded.players[seat]!, isDead: true, traits: { ...degraded.players[seat]!.traits, might: 0 } },
      },
    };
    const resDead = healTrait(dead, seat, 'might', content);
    expect(resDead.state.players[seat]!.isDead).toBe(true);
    expect(resDead.state.players[seat]!.traits.might).toBe(0);
    expect(resDead.events).toHaveLength(0);
  });

  it('trait_at_least compares printed values via content track, not track index', () => {
    const { state } = startedGame();
    const seat = state.activeSeat!;
    const charId = state.players[seat]!.charId!;
    const char = content.charactersById[charId]!;
    // Character tracks have duplicate printed values (e.g. index 3 might have printed value 4, index 4 also printed value 4)
    // Find track details
    const track = char.tracks.knowledge;
    const startIdx = char.start.knowledge;
    const printedValue = track[startIdx]!;

    const ctx = { actor: seat, round: 1 };
    // Should be true when checking against printed value <= printedValue
    expect(
      evalCondition(
        state,
        { k: 'trait_at_least', who: 'actor', trait: 'knowledge', value: printedValue },
        ctx,
        content,
      ),
    ).toBe(true);

    // Should be false when checking against value > printedValue
    expect(
      evalCondition(
        state,
        { k: 'trait_at_least', who: 'actor', trait: 'knowledge', value: printedValue + 1 },
        ctx,
        content,
      ),
    ).toBe(false);
  });

  it('death transition preserves inventory, resolves pending prompts, and advances active turn', () => {
    const { state: base } = startedGame();
    const active = base.activeSeat!;
    const expectedNext = nextSeatInOrder(base, active)!;

    // Give player items, a pending rotate_tile prompt, and movesLeft
    const stateWithPrompt: GameState = {
      ...base,
      phase: 'haunt',
      haunt: { hauntId: 1, traitorSeat: null, revealed: true, acknowledged: [] },
      players: {
        ...base.players,
        [active]: {
          ...base.players[active]!,
          items: ['item.adrenaline_shot'],
          omens: ['omen.bite'],
          movesLeft: 3,
        },
      },
      pending: {
        id: 'p1',
        seatId: active,
        kind: 'rotate_tile',
        payload: {
          kind: 'rotate_tile',
          tileId: 'tile.chapel',
          floor: 'ground',
          x: 1,
          y: 0,
          from: base.players[active]!.location!,
          legalRotations: [0, 90],
        },
        defaultAnswer: 0,
        deadline: null,
      },
    };

    const outcome = killExplorer(stateWithPrompt, active, content);
    const deadPlayer = outcome.state.players[active]!;

    // 1. Player is dead and movesLeft is 0
    expect(deadPlayer.isDead).toBe(true);
    expect(deadPlayer.movesLeft).toBe(0);

    // 2. Inventory is preserved (deferred to Phase 7 room-card-pile drop)
    expect(deadPlayer.items).toEqual(['item.adrenaline_shot']);
    expect(deadPlayer.omens).toEqual(['omen.bite']);

    // 3. Pending prompt was resolved and no longer belongs to dead player
    expect(outcome.state.pending).toBeNull();

    // 4. Active turn advanced to next living player
    expect(outcome.state.activeSeat).toBe(expectedNext);
    expect(outcome.state.players[expectedNext]!.movesLeft).toBeGreaterThan(0);

    // 5. Invariants hold
    expect(checkInvariants(outcome.state)).toEqual([]);
  });
});
