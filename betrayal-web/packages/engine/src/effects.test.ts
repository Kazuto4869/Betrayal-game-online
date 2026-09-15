/**
 * The effect interpreter, tested in isolation from the reducer — most of
 * these call `runEffects`/`resumeEffects` directly against a real
 * `startedGame()` state rather than going through `reduce`, since none of
 * the effect kinds here are reachable from an action yet except through
 * `tile.onEnter` (covered separately in discovery.test.ts).
 */

import { describe, expect, it } from 'vitest';
import { fixtureContent } from '@bahoth/content';
import type { Effect } from '@bahoth/content';
import { isEffectPromptPayload, type GameState, type TargetRef } from '@bahoth/shared';
import { startedGame } from './testing.js';
import {
  EffectError,
  evalCondition,
  resumeEffects,
  runEffects,
  type EffectContext,
} from './effects.js';

const content = fixtureContent();

function baseCtx(state: GameState): EffectContext {
  return { actor: state.activeSeat! };
}

describe('trait effect', () => {
  it('clamps at the top of the track and emits trait_changed', () => {
    const { state } = startedGame();
    const seat = state.activeSeat!;
    const character = content.charactersById[state.players[seat]!.charId!]!;
    const top = character.tracks.knowledge.length - 1;
    const out = runEffects(
      state,
      [{ e: 'trait', who: 'actor', trait: 'knowledge', delta: 99 }],
      baseCtx(state),
      content,
    );
    expect(out.state.players[seat]!.traits.knowledge).toBe(top);
    expect(out.events).toContainEqual(
      expect.objectContaining({ t: 'trait_changed', seat, trait: 'knowledge' }),
    );
  });

  it('kills the explorer on reaching the skull, and only fires died once', () => {
    const { state } = startedGame();
    const seat = state.activeSeat!;
    const out = runEffects(
      state,
      [{ e: 'trait', who: 'actor', trait: 'sanity', delta: -99 }],
      baseCtx(state),
      content,
    );
    expect(out.state.players[seat]!.traits.sanity).toBe(0);
    expect(out.state.players[seat]!.isDead).toBe(true);
    expect(out.events).toContainEqual({ t: 'died', seat });

    const again = runEffects(
      out.state,
      [{ e: 'trait', who: 'actor', trait: 'sanity', delta: -1 }],
      baseCtx(out.state),
      content,
    );
    expect(again.events.filter((e) => e.t === 'died')).toHaveLength(0);
  });
});

describe('move effect', () => {
  it('resolves entrance_hall to the placed start tile', () => {
    const { state } = startedGame();
    const seat = state.activeSeat!;
    const foyer = Object.values(state.board.placed).find(
      (t) => t.tileId === 'tile.foyer',
    )!;
    const withActorMoved = {
      ...state,
      players: {
        ...state.players,
        [seat]: { ...state.players[seat]!, location: foyer.id },
      },
    };

    const out = runEffects(
      withActorMoved,
      [{ e: 'move', who: 'actor', to: 'entrance_hall' }],
      baseCtx(state),
      content,
    );
    const start = Object.values(state.board.placed).find(
      (t) => t.tileId === content.house.startTile,
    )!;
    expect(out.state.players[seat]!.location).toBe(start.id);
    expect(out.events).toContainEqual(
      expect.objectContaining({ t: 'moved', seat, to: start.id }),
    );
  });

  it('degrades to a log event, not a crash, when the target cannot resolve', () => {
    const { state } = startedGame();
    const out = runEffects(
      state,
      [{ e: 'move', who: 'actor', to: { tile: 'tile.does_not_exist_on_the_board' } }],
      baseCtx(state),
      content,
    );
    expect(out.events).toContainEqual(expect.objectContaining({ t: 'log' }));
    expect(out.state.players[state.activeSeat!]!.location).toBe(
      state.players[state.activeSeat!]!.location,
    );
  });
});

describe('set_flag / flag condition', () => {
  it('writes and reads back at game, seat, and tile scope', () => {
    const { state } = startedGame();
    const seat = state.activeSeat!;
    const tileId = state.players[seat]!.location!;

    const out = runEffects(
      state,
      [
        { e: 'set_flag', scope: 'game', key: 'storm', value: true },
        { e: 'set_flag', scope: 'seat', key: 'cursed', value: 3 },
        { e: 'set_flag', scope: 'tile', key: 'searched', value: 'yes' },
      ],
      baseCtx(state),
      content,
    );

    expect(out.state.flags.storm).toBe(true);
    expect(out.state.players[seat]!.flags.cursed).toBe(3);
    expect(out.state.board.placed[tileId]!.flags.searched).toBe('yes');

    expect(
      evalCondition(
        out.state,
        { k: 'flag', scope: 'game', key: 'storm', op: '=', value: true },
        baseCtx(out.state),
        content,
      ),
    ).toBe(true);
    expect(
      evalCondition(
        out.state,
        { k: 'flag', scope: 'seat', key: 'cursed', op: '>=', value: 2 },
        baseCtx(out.state),
        content,
      ),
    ).toBe(true);
    expect(
      evalCondition(
        out.state,
        { k: 'flag', scope: 'seat', key: 'cursed', op: '<=', value: 2 },
        baseCtx(out.state),
        content,
      ),
    ).toBe(false);
  });
});

describe('place_token', () => {
  it('adds a token at the resolved room, with distinct ids for repeats', () => {
    const { state } = startedGame();
    const out = runEffects(
      state,
      [
        { e: 'place_token', token: 'omen_marker', at: 'actor_room' },
        { e: 'place_token', token: 'omen_marker', at: 'actor_room' },
      ],
      baseCtx(state),
      content,
    );
    expect(out.state.tokens).toHaveLength(2);
    expect(new Set(out.state.tokens.map((t) => t.id)).size).toBe(2);
  });
});

describe('end_turn effect', () => {
  it('zeroes movesLeft without touching activeSeat', () => {
    const { state } = startedGame();
    const seat = state.activeSeat!;
    const out = runEffects(
      state,
      [{ e: 'end_turn', who: 'actor' }],
      baseCtx(state),
      content,
    );
    expect(out.state.players[seat]!.movesLeft).toBe(0);
    expect(out.state.activeSeat).toBe(seat);
  });
});

describe('if effect', () => {
  it('splices the true branch and skips the false one', () => {
    const { state } = startedGame();
    const trueBranch: Effect = { e: 'log', text: 'true branch' };
    const falseBranch: Effect = { e: 'log', text: 'false branch' };
    const out = runEffects(
      state,
      [
        {
          e: 'if',
          c: { k: 'turns_elapsed', op: '>=', value: 0 },
          then: [trueBranch],
          else: [falseBranch],
        },
      ],
      baseCtx(state),
      content,
    );
    expect(out.events).toContainEqual({ t: 'log', text: 'true branch' });
    expect(out.events).not.toContainEqual({ t: 'log', text: 'false branch' });
  });

  it('a prompt inside an if branch suspends exactly like a top-level one', () => {
    const { state } = startedGame({ players: ['Ana', 'Ben', 'Cal', 'Dot'] });
    const out = runEffects(
      state,
      [
        {
          e: 'if',
          c: { k: 'turns_elapsed', op: '>=', value: 0 },
          then: [
            {
              e: 'prompt',
              who: 'actor',
              prompt: { kind: 'choose_target', among: 'all_heroes' },
              then: [],
            },
          ],
        },
        { e: 'log', text: 'after the if' },
      ],
      baseCtx(state),
      content,
    );
    expect(out.state.pending?.kind).toBe('choose_target');
    // "after the if" must be part of the resume, not emitted yet.
    expect(out.events).not.toContainEqual({ t: 'log', text: 'after the if' });
  });
});

describe('for_each effect', () => {
  it('applies to every hero in turn order', () => {
    const { state } = startedGame({ players: ['Ana', 'Ben', 'Cal'] });
    const out = runEffects(
      state,
      [
        {
          e: 'for_each',
          who: 'all_heroes',
          do: [{ e: 'trait', who: { ref: 'each' }, trait: 'sanity', delta: -1 }],
        },
      ],
      baseCtx(state),
      content,
    );
    const changed = out.events.filter((e) => e.t === 'trait_changed');
    expect(changed).toHaveLength(3);
  });

  it('suspends mid-loop on a prompt and resumes the remaining seats', () => {
    const { state } = startedGame({ players: ['Ana', 'Ben', 'Cal'] });
    const suspended = runEffects(
      state,
      [
        {
          e: 'for_each',
          who: 'all_heroes',
          do: [
            {
              e: 'prompt',
              who: { ref: 'each' },
              prompt: { kind: 'choose_room', among: 'placed' },
              then: [{ e: 'log', text: 'chose a room' }],
            },
          ],
        },
        { e: 'log', text: 'after the loop' },
      ],
      baseCtx(state),
      content,
    );
    expect(suspended.state.pending).not.toBeNull();
    expect(isEffectPromptPayload(suspended.state.pending!.payload)).toBe(true);
    const payload = suspended.state.pending!.payload as ReturnType<
      typeof structuredClone
    > & {
      resume: { forEach?: unknown };
    };
    expect(payload.resume.forEach).toBeDefined();

    // Answer every seat's prompt in turn until the loop, then the log after
    // it, both land.
    let working = suspended.state;
    let events = [...suspended.events];
    for (let i = 0; i < 3; i++) {
      expect(working.pending).not.toBeNull();
      const candidates = (working.pending!.payload as { candidates: string[] })
        .candidates;
      const resume = (working.pending!.payload as { resume: any }).resume;
      const result = resumeEffects(
        { ...working, pending: null },
        resume,
        candidates[0]!,
        content,
      );
      working = result.state;
      events = [...events, ...result.events];
    }
    expect(working.pending).toBeNull();
    expect(events.filter((e) => e.t === 'log' && e.text === 'chose a room')).toHaveLength(
      3,
    );
    expect(events).toContainEqual({ t: 'log', text: 'after the loop' });
  });
});

describe('prompt effect', () => {
  it('auto-applies with no suspension when exactly one candidate exists', () => {
    const { state } = startedGame({ players: ['Ana', 'Ben', 'Cal'] });
    const seat = state.activeSeat!;
    // Move everyone but one other seat out of the actor's room, so
    // "other seats in room" resolves to exactly one candidate.
    const others = Object.keys(state.players).filter((s) => s !== seat);
    const away = others[1]!;
    const foyer = Object.values(state.board.placed).find(
      (t) => t.tileId === 'tile.foyer',
    )!;
    const oneOther: GameState = {
      ...state,
      players: {
        ...state.players,
        [away]: { ...state.players[away]!, location: foyer.id },
      },
    };
    const out = runEffects(
      oneOther,
      [
        {
          e: 'prompt',
          who: 'actor',
          prompt: { kind: 'choose_target', among: 'other_seats_in_room' },
          then: [{ e: 'log', text: 'auto-applied' }],
        },
      ],
      baseCtx(oneOther),
      content,
    );
    expect(out.state.pending).toBeNull();
    expect(out.events).toContainEqual({ t: 'log', text: 'auto-applied' });
  });

  it('skips with a log line and no suspension when there are no candidates', () => {
    const { state } = startedGame({ players: ['Ana', 'Ben', 'Cal'] });
    const seat = state.activeSeat!;
    // No moves left this turn, so "reachable from the actor" is empty.
    const noMoves: GameState = {
      ...state,
      players: { ...state.players, [seat]: { ...state.players[seat]!, movesLeft: 0 } },
    };
    const out = runEffects(
      noMoves,
      [
        {
          e: 'prompt',
          who: 'actor',
          prompt: { kind: 'choose_room', among: 'reachable_from_actor' },
          then: [{ e: 'log', text: 'never runs' }],
        },
      ],
      baseCtx(noMoves),
      content,
    );
    expect(out.state.pending).toBeNull();
    expect(out.events).not.toContainEqual({ t: 'log', text: 'never runs' });
  });

  it('raises a real prompt with multiple candidates, and the answer resumes into then via {ref: chosen}', () => {
    const { state } = startedGame({ players: ['Ana', 'Ben', 'Cal', 'Dot'] });
    const suspended = runEffects(
      state,
      [
        {
          e: 'prompt',
          who: 'actor',
          prompt: { kind: 'choose_target', among: 'all_heroes' },
          then: [{ e: 'trait', who: { ref: 'chosen' }, trait: 'might', delta: -1 }],
        },
      ],
      baseCtx(state),
      content,
    );
    expect(suspended.state.pending?.kind).toBe('choose_target');
    const payload = suspended.state.pending!.payload as {
      candidates: TargetRef[];
      resume: any;
    };
    expect(payload.candidates.length).toBeGreaterThan(1);
    const target = payload.candidates[1]!;

    const resumed = resumeEffects(
      { ...suspended.state, pending: null },
      payload.resume,
      target,
      content,
    );
    expect(resumed.events).toContainEqual(
      expect.objectContaining({
        t: 'trait_changed',
        seat: (target as any).seatId,
        trait: 'might',
      }),
    );
  });
});

describe('SeatRef misuse', () => {
  it('throws for any_hero/all_heroes on a single-seat effect', () => {
    const { state } = startedGame();
    expect(() =>
      runEffects(
        state,
        [{ e: 'trait', who: 'all_heroes', trait: 'speed', delta: 1 }],
        baseCtx(state),
        content,
      ),
    ).toThrow(EffectError);
  });

  it('throws for {ref: chosen} with nothing chosen yet', () => {
    const { state } = startedGame();
    expect(() =>
      runEffects(
        state,
        [{ e: 'trait', who: { ref: 'chosen' }, trait: 'speed', delta: 1 }],
        baseCtx(state),
        content,
      ),
    ).toThrow(EffectError);
  });
});

describe('conditions', () => {
  it('seat_dead / trait_at_least read the acting seat', () => {
    const { state } = startedGame();
    const ctx = baseCtx(state);
    expect(evalCondition(state, { k: 'seat_dead', who: 'actor' }, ctx, content)).toBe(
      false,
    );
    expect(
      evalCondition(
        state,
        { k: 'trait_at_least', who: 'actor', trait: 'speed', value: 0 },
        ctx,
        content,
      ),
    ).toBe(true);
  });

  it('in_room matches the tile the seat currently stands on', () => {
    const { state } = startedGame();
    const ctx = baseCtx(state);
    const tileId = state.board.placed[state.players[ctx.actor]!.location!]!.tileId;
    expect(
      evalCondition(state, { k: 'in_room', who: 'actor', tile: tileId }, ctx, content),
    ).toBe(true);
    expect(
      evalCondition(
        state,
        { k: 'in_room', who: 'actor', tile: 'tile.nowhere' },
        ctx,
        content,
      ),
    ).toBe(false);
  });

  it('any_hero/all_heroes quantify over the hero set', () => {
    const { state } = startedGame({ players: ['Ana', 'Ben', 'Cal'] });
    const ctx = baseCtx(state);
    const anyAlive = evalCondition(
      state,
      { k: 'seat_dead', who: 'any_hero' },
      ctx,
      content,
    );
    const allAlive = evalCondition(
      state,
      { k: 'seat_dead', who: 'all_heroes' },
      ctx,
      content,
    );
    expect(anyAlive).toBe(false); // nobody is dead yet
    expect(allAlive).toBe(false);
  });

  it('not/and/or compose', () => {
    const { state } = startedGame();
    const ctx = baseCtx(state);
    const alwaysTrue = { k: 'turns_elapsed', op: '>=', value: 0 } as const;
    const alwaysFalse = { k: 'turns_elapsed', op: '>=', value: 999999 } as const;
    expect(evalCondition(state, { k: 'not', c: alwaysFalse }, ctx, content)).toBe(true);
    expect(
      evalCondition(state, { k: 'and', cs: [alwaysTrue, alwaysFalse] }, ctx, content),
    ).toBe(false);
    expect(
      evalCondition(state, { k: 'or', cs: [alwaysTrue, alwaysFalse] }, ctx, content),
    ).toBe(true);
  });
});
