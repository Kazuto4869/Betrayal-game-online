import { describe, it, expect } from 'vitest';
import {
  fixtureContent,
  buildContent,
  type Content,
  type Tile,
  type House,
} from '@bahoth/content';
import { reduce } from './reduce.js';
import { startedGame } from './testing.js';
import { checkInvariants } from './invariants.js';
import { makeRng } from './rng.js';
import { getLegalActions, traitValue } from './selectors.js';
import { getConnections } from './movement.js';
import { type Doors, type Floor, type Trait, placedIdFor } from '@bahoth/shared';

function dtile(id: string, doors: Partial<Doors>, opts: Partial<Tile> = {}): Tile {
  return {
    id,
    name: id,
    doors: { n: false, e: false, s: false, w: false, ...doors },
    floors: ['ground'],
    symbol: null,
    copies: 1,
    staticLinks: [],
    onEnter: [],
    onExit: [],
    onEndTurn: [],
    actions: [],
    ...opts,
  };
}

const LAND_B = dtile('tile.land_b', { n: true }, { floors: ['basement'] });
const LAND_U = dtile('tile.land_u', { n: true }, { floors: ['upper'] });
const FILL_B = dtile('tile.fill_b', { n: true }, { floors: ['basement'] });
const FILL_U = dtile('tile.fill_u', { n: true }, { floors: ['upper'] });
const FILL_G = dtile('tile.fill_g', { n: true }, { floors: ['ground'] });
// A pre-placed ground tile with multiple open doorways so that discovering a
// single-door tile doesn't seal the floor (guards against wouldSealFloor).
const ANTI_SEAL = dtile('tile.anti_seal', { n: true, e: true, s: true, w: true });

function makeForcedDrawContent(start: Tile, drawnTile: Tile): Content {
  // drawnTile is ground-legal; FILL_B and FILL_U satisfy basement and upper deck requirements.
  // ANTI_SEAL is pre-placed at (2,0) on the ground floor to keep open doorways.
  const tiles = [start, drawnTile, ANTI_SEAL, LAND_B, LAND_U, FILL_B, FILL_U];
  const house: House = {
    layout: [
      { tileId: start.id, floor: 'ground', x: 0, y: 0, rotation: 0 },
      { tileId: ANTI_SEAL.id, floor: 'ground', x: 2, y: 0, rotation: 0 },
      { tileId: LAND_B.id, floor: 'basement', x: 0, y: 0, rotation: 0 },
      { tileId: LAND_U.id, floor: 'upper', x: 0, y: 0, rotation: 0 },
    ],
    startTile: start.id,
    landings: { basement: LAND_B.id, ground: start.id, upper: LAND_U.id },
  };
  return buildContent(
    {
      characters: fixtureContent().characters,
      cards: fixtureContent().cards,
      tiles,
      house,
    },
    'room-effects.test.ts',
  );
}

function makePlacedRoomContent(
  start: Tile,
  placedTile: Tile,
  testSource = 'test-source',
): Content {
  const tiles = [start, placedTile, LAND_B, LAND_U, FILL_B, FILL_U, FILL_G];
  const house: House = {
    layout: [
      { tileId: start.id, floor: 'ground', x: 0, y: 0, rotation: 0 },
      { tileId: placedTile.id, floor: 'ground', x: 0, y: -1, rotation: 0 },
      { tileId: LAND_B.id, floor: 'basement', x: 0, y: 0, rotation: 0 },
      { tileId: LAND_U.id, floor: 'upper', x: 0, y: 0, rotation: 0 },
    ],
    startTile: start.id,
    landings: { basement: LAND_B.id, ground: start.id, upper: LAND_U.id },
  };
  return buildContent(
    {
      characters: fixtureContent().characters,
      cards: fixtureContent().cards,
      tiles,
      house,
    },
    testSource,
  );
}

describe('Task 4: Room-end hooks on discovery and end_turn', () => {
  const canonical = fixtureContent();

  describe('Library (+1 Knowledge, once per game)', () => {
    const libraryDef = canonical.tilesById['tile.library']!;

    it('first discovery resolves card pipeline before room hook, then grants +1 Knowledge and marks tile spent', () => {
      const start = dtile('tile.start', { n: true });
      const content = makeForcedDrawContent(start, libraryDef);
      const g = startedGame({ content });
      const seat = g.state.activeSeat!;
      const beforeKnowledge = g.state.players[seat]!.traits.knowledge;

      let resMove = reduce(g.state, { t: 'MOVE_THROUGH', seat, dir: 'n' }, content);
      expect(resMove.error).toBeUndefined();
      if (resMove.state.pending?.kind === 'rotate_tile') {
        resMove = reduce(resMove.state, { t: 'ROTATE_TILE', seat, rotation: 0 }, content);
        expect(resMove.error).toBeUndefined();
      }

      // Card pipeline resolves first: drew_card emitted before trait_changed
      const eventTypes = resMove.events.map((e) => e.t);
      expect(eventTypes).toContain('discovered');
      expect(eventTypes).toContain('moved');
      expect(eventTypes).toContain('drew_card');
      expect(eventTypes).toContain('trait_changed');

      const drewIndex = eventTypes.indexOf('drew_card');
      const traitIndex = eventTypes.indexOf('trait_changed');
      expect(drewIndex).toBeLessThan(traitIndex);

      // Trait increased by 1
      expect(resMove.state.players[seat]!.traits.knowledge).toBe(beforeKnowledge + 1);

      // Placed tile marked spent: true
      const placedLoc = resMove.state.players[seat]!.location!;
      const placedTile = resMove.state.board.placed[placedLoc]!;
      expect(placedTile.flags['spent']).toBe(true);

      // Invariants check
      expect(checkInvariants(resMove.state)).toEqual([]);

      // Later END_TURN in the same turn must NOT grant Knowledge again
      const knowledgeAfterDiscovery = resMove.state.players[seat]!.traits.knowledge;
      const resEnd = reduce(resMove.state, { t: 'END_TURN', seat }, content);
      expect(resEnd.error).toBeUndefined();
      expect(resEnd.state.players[seat]!.traits.knowledge).toBe(knowledgeAfterDiscovery);
      expect(resEnd.events.map((e) => e.t)).not.toContain('trait_changed');
      expect(resEnd.state.activeSeat).not.toBe(seat);
    });

    it('ordinary entry into an already-revealed unused Library does not change Knowledge; END_TURN grants +1 Knowledge and marks spent', () => {
      const start = dtile('tile.start', { n: true });
      const libraryTile = { ...libraryDef, floors: ['ground' as Floor] };
      const content = makePlacedRoomContent(start, libraryTile, 'test-ordinary-entry');

      const g = startedGame({ content });
      const seat = g.state.activeSeat!;
      const beforeKnowledge = g.state.players[seat]!.traits.knowledge;
      const libraryPlacedId = g.state.board.index.ground['0,-1']!;

      // Ordinary MOVE into Library
      const resMove = reduce(g.state, { t: 'MOVE', seat, to: libraryPlacedId }, content);
      expect(resMove.error).toBeUndefined();
      // Entry does NOT change Knowledge
      expect(resMove.state.players[seat]!.traits.knowledge).toBe(beforeKnowledge);
      expect(resMove.state.board.placed[libraryPlacedId]!.flags['spent']).toBeUndefined();

      // END_TURN in Library grants +1 Knowledge and marks spent
      const resEnd = reduce(resMove.state, { t: 'END_TURN', seat }, content);
      expect(resEnd.error).toBeUndefined();
      expect(resEnd.state.players[seat]!.traits.knowledge).toBe(beforeKnowledge + 1);
      expect(resEnd.state.board.placed[libraryPlacedId]!.flags['spent']).toBe(true);
      expect(resEnd.events.map((e) => e.t)).toContain('trait_changed');
      expect(resEnd.state.activeSeat).not.toBe(seat);
    });

    it('neither the same explorer nor a different explorer can gain from Library after it is spent', () => {
      const start = dtile('tile.start', { n: true });
      const libraryTile = { ...libraryDef, floors: ['ground' as Floor] };
      const content = makePlacedRoomContent(start, libraryTile, 'test-contention');

      const g = startedGame({ content });
      const seat0 = g.state.activeSeat!;
      const libraryPlacedId = g.state.board.index.ground['0,-1']!;

      // Player 0 moves into Library and ends turn -> gains +1 Knowledge, marks spent
      const s0Move = reduce(
        g.state,
        { t: 'MOVE', seat: seat0, to: libraryPlacedId },
        content,
      );
      const s0End = reduce(s0Move.state, { t: 'END_TURN', seat: seat0 }, content);
      expect(s0End.state.board.placed[libraryPlacedId]!.flags['spent']).toBe(true);

      const seat1 = s0End.state.activeSeat!;
      expect(seat1).not.toBe(seat0);
      const seat1BeforeKnowledge = s0End.state.players[seat1]!.traits.knowledge;

      // Player 1 moves into spent Library and ends turn -> does NOT gain Knowledge
      const s1Move = reduce(
        s0End.state,
        { t: 'MOVE', seat: seat1, to: libraryPlacedId },
        content,
      );
      const s1End = reduce(s1Move.state, { t: 'END_TURN', seat: seat1 }, content);
      expect(s1End.error).toBeUndefined();
      expect(s1End.state.players[seat1]!.traits.knowledge).toBe(seat1BeforeKnowledge);
      expect(s1End.events.map((e) => e.t)).not.toContain('trait_changed');
    });
  });

  describe('Chapel, Gymnasium, and Larder (table-driven stat gains, once per game)', () => {
    const table = [
      {
        room: 'Chapel',
        tileId: 'tile.chapel',
        trait: 'sanity' as const,
        cardDeck: 'event',
      },
      {
        room: 'Gymnasium',
        tileId: 'tile.gymnasium',
        trait: 'speed' as const,
        cardDeck: 'omen',
      },
      {
        room: 'Larder',
        tileId: 'tile.larder',
        trait: 'might' as const,
        cardDeck: 'item',
      },
    ];

    for (const entry of table) {
      it(`${entry.room} (${entry.tileId}) grants +1 ${entry.trait} on discovery, marks spent, and does not repeat`, () => {
        const rawTileDef = canonical.tilesById[entry.tileId]!;
        // Allow placement on ground for testing discovery
        const tileDef = { ...rawTileDef, floors: ['ground' as Floor] };
        const start = dtile('tile.start', { n: true });
        const content = makeForcedDrawContent(start, tileDef);

        const g = startedGame({ content });
        const seat = g.state.activeSeat!;
        const beforeTrait = g.state.players[seat]!.traits[entry.trait];

        let resMove = reduce(g.state, { t: 'MOVE_THROUGH', seat, dir: 'n' }, content);
        expect(resMove.error).toBeUndefined();
        if (resMove.state.pending?.kind === 'rotate_tile') {
          resMove = reduce(
            resMove.state,
            { t: 'ROTATE_TILE', seat, rotation: 0 },
            content,
          );
          expect(resMove.error).toBeUndefined();
        }

        // Check trait gain
        expect(resMove.state.players[seat]!.traits[entry.trait]).toBe(beforeTrait + 1);

        // Check spent flag on tile
        const placedLoc = resMove.state.players[seat]!.location!;
        expect(resMove.state.board.placed[placedLoc]!.flags['spent']).toBe(true);

        // Same-turn END_TURN does not duplicate
        const resEnd = reduce(resMove.state, { t: 'END_TURN', seat }, content);
        expect(resEnd.error).toBeUndefined();
        expect(resEnd.state.players[seat]!.traits[entry.trait]).toBe(beforeTrait + 1);
      });
    }
  });

  describe('Furnace Room and Crypt (repeatable damage, choose_trait prompt)', () => {
    it('Furnace Room discovery: resolves card/haunt, raises choose_trait prompt for speed/might, does not repeat on same-turn END_TURN', () => {
      const rawFurnace = canonical.tilesById['tile.furnace_room']!;
      const furnaceTile = { ...rawFurnace, floors: ['ground' as Floor] };
      const start = dtile('tile.start', { n: true });
      const content = makeForcedDrawContent(start, furnaceTile);

      const g = startedGame({ content });
      const seat = g.state.activeSeat!;
      const beforeSpeed = g.state.players[seat]!.traits.speed;

      let resMove = reduce(g.state, { t: 'MOVE_THROUGH', seat, dir: 'n' }, content);
      expect(resMove.error).toBeUndefined();

      if (resMove.state.pending?.kind === 'rotate_tile') {
        resMove = reduce(resMove.state, { t: 'ROTATE_TILE', seat, rotation: 0 }, content);
        expect(resMove.error).toBeUndefined();
      }

      // Should raise choose_trait prompt for the active seat
      expect(resMove.state.pending).not.toBeNull();
      expect(resMove.state.pending!.kind).toBe('choose_trait');
      expect(resMove.state.pending!.seatId).toBe(seat);

      const payload = resMove.state.pending!.payload as any;
      expect(payload.candidates).toEqual(['speed', 'might']);

      const mightBeforePrompt = resMove.state.players[seat]!.traits.might;

      // Answering prompt with 'might'
      const promptId = resMove.state.pending!.id;
      const resAnswer = reduce(
        resMove.state,
        { t: 'ANSWER', seat, promptId, answer: 'might' },
        content,
      );
      expect(resAnswer.error).toBeUndefined();
      expect(resAnswer.state.pending).toBeNull();
      expect(resAnswer.state.players[seat]!.traits.might).toBe(mightBeforePrompt - 1);
      expect(resAnswer.state.players[seat]!.traits.speed).toBe(beforeSpeed);
      // Turn is still active for the player!
      expect(resAnswer.state.activeSeat).toBe(seat);

      // Calling END_TURN on the same turn does NOT repeat damage
      const resEnd = reduce(resAnswer.state, { t: 'END_TURN', seat }, content);
      expect(resEnd.error).toBeUndefined();
      expect(resEnd.state.pending).toBeNull();
      expect(resEnd.state.players[seat]!.traits.might).toBe(mightBeforePrompt - 1);
      expect(resEnd.state.activeSeat).not.toBe(seat);
    });

    it('Furnace Room ordinary entry does nothing; END_TURN raises choose_trait prompt, damages chosen trait, and only THEN advances seat', () => {
      const rawFurnace = canonical.tilesById['tile.furnace_room']!;
      const furnaceTile = { ...rawFurnace, floors: ['ground' as Floor] };
      const start = dtile('tile.start', { n: true });
      const content = makePlacedRoomContent(start, furnaceTile, 'test-furnace-endturn');

      const g = startedGame({ content });
      const seat = g.state.activeSeat!;
      const furnacePlacedId = g.state.board.index.ground['0,-1']!;

      // Ordinary move into Furnace Room: no prompt, no damage
      const resMove = reduce(g.state, { t: 'MOVE', seat, to: furnacePlacedId }, content);
      expect(resMove.error).toBeUndefined();
      expect(resMove.state.pending).toBeNull();

      const beforeSpeed = resMove.state.players[seat]!.traits.speed;

      // Player calls END_TURN: raises choose_trait prompt, does NOT advance activeSeat yet
      const resEnd = reduce(resMove.state, { t: 'END_TURN', seat }, content);
      expect(resEnd.error).toBeUndefined();
      expect(resEnd.state.pending).not.toBeNull();
      expect(resEnd.state.pending!.kind).toBe('choose_trait');
      expect(resEnd.state.pending!.seatId).toBe(seat);
      // Turn has NOT advanced yet!
      expect(resEnd.state.activeSeat).toBe(seat);

      // Duplicate action while prompt is pending is rejected
      const resDup = reduce(resEnd.state, { t: 'END_TURN', seat }, content);
      expect(resDup.error).toBeDefined();
      expect(resDup.error!.code).toBe('PROMPT_PENDING');

      // Player answers 'speed'
      const promptId = resEnd.state.pending!.id;
      const resAnswer = reduce(
        resEnd.state,
        { t: 'ANSWER', seat, promptId, answer: 'speed' },
        content,
      );
      expect(resAnswer.error).toBeUndefined();
      expect(resAnswer.state.pending).toBeNull();
      expect(resAnswer.state.players[seat]!.traits.speed).toBe(beforeSpeed - 1);
      // Turn advances AFTER damage is applied!
      expect(resAnswer.state.activeSeat).not.toBe(seat);
      expect(resAnswer.events.map((e) => e.t)).toContain('turn_ended');
      expect(resAnswer.events.map((e) => e.t)).toContain('turn_started');
    });

    it('Crypt discovery: raises choose_trait prompt for sanity/knowledge, damages chosen trait', () => {
      const rawCrypt = canonical.tilesById['tile.crypt']!;
      const cryptTile = { ...rawCrypt, floors: ['ground' as Floor] };
      const start = dtile('tile.start', { n: true });
      const content = makeForcedDrawContent(start, cryptTile);

      const g = startedGame({ content });
      const seat = g.state.activeSeat!;
      const beforeSanity = g.state.players[seat]!.traits.sanity;
      const beforeKnowledge = g.state.players[seat]!.traits.knowledge;

      const resMove = reduce(g.state, { t: 'MOVE_THROUGH', seat, dir: 'n' }, content);
      expect(resMove.error).toBeUndefined();

      expect(resMove.state.pending).not.toBeNull();
      expect(resMove.state.pending!.kind).toBe('choose_trait');
      expect(resMove.state.pending!.seatId).toBe(seat);

      const payload = resMove.state.pending!.payload as any;
      expect(payload.candidates).toEqual(['sanity', 'knowledge']);

      const promptId = resMove.state.pending!.id;
      const resAnswer = reduce(
        resMove.state,
        { t: 'ANSWER', seat, promptId, answer: 'sanity' },
        content,
      );
      expect(resAnswer.error).toBeUndefined();
      expect(resAnswer.state.pending).toBeNull();
      expect(resAnswer.state.players[seat]!.traits.sanity).toBe(beforeSanity - 1);
      expect(resAnswer.state.players[seat]!.traits.knowledge).toBe(beforeKnowledge);
    });

    it('timeout on TICK resolves choose_trait prompt with default and finishes turn advancement', () => {
      const rawFurnace = canonical.tilesById['tile.furnace_room']!;
      const furnaceTile = { ...rawFurnace, floors: ['ground' as Floor] };
      const start = dtile('tile.start', { n: true });
      const content = makePlacedRoomContent(start, furnaceTile, 'test-furnace-timeout');

      const g = startedGame({ content });
      const seat = g.state.activeSeat!;
      const furnacePlacedId = g.state.board.index.ground['0,-1']!;

      const resMove = reduce(g.state, { t: 'MOVE', seat, to: furnacePlacedId }, content);
      const resEnd = reduce(resMove.state, { t: 'END_TURN', seat }, content);
      expect(resEnd.state.pending).not.toBeNull();
      expect(resEnd.state.pending!.kind).toBe('choose_trait');

      const t0 = 1_700_000_000_000;
      // Arm prompt deadline via tick
      const resTick1 = reduce(resEnd.state, { t: 'TICK', now: t0 }, content);
      expect(resTick1.state.pending!.deadline).not.toBeNull();

      // Tick past deadline -> auto-resolves with default candidate and finishes turn advancement
      const deadline = resTick1.state.pending!.deadline!;
      const resTick2 = reduce(
        resTick1.state,
        { t: 'TICK', now: deadline + 1000 },
        content,
      );
      expect(resTick2.state.pending).toBeNull();
      expect(resTick2.state.activeSeat).not.toBe(seat);
      expect(resTick2.events.map((e) => e.t)).toContain('turn_ended');
    });

    it('reconnecting player can answer pending choose_trait prompt', () => {
      const rawFurnace = canonical.tilesById['tile.furnace_room']!;
      const furnaceTile = { ...rawFurnace, floors: ['ground' as Floor] };
      const start = dtile('tile.start', { n: true });
      const content = makePlacedRoomContent(start, furnaceTile, 'test-furnace-reconnect');

      const g = startedGame({ content });
      const seat = g.state.activeSeat!;
      const furnacePlacedId = g.state.board.index.ground['0,-1']!;

      const resMove = reduce(g.state, { t: 'MOVE', seat, to: furnacePlacedId }, content);
      const resEnd = reduce(resMove.state, { t: 'END_TURN', seat }, content);
      expect(resEnd.state.pending).not.toBeNull();

      // Disconnect and reconnect
      const resDisc = reduce(
        resEnd.state,
        { t: 'DISCONNECT', seat, at: 1_700_000_000_000 },
        content,
      );
      expect(resDisc.state.pending).not.toBeNull();
      const resRecon = reduce(resDisc.state, { t: 'RECONNECT', seat }, content);
      expect(resRecon.state.pending).not.toBeNull();

      // Answer prompt
      const promptId = resRecon.state.pending!.id;
      const resAnswer = reduce(
        resRecon.state,
        { t: 'ANSWER', seat, promptId, answer: 'might' },
        content,
      );
      expect(resAnswer.error).toBeUndefined();
      expect(resAnswer.state.pending).toBeNull();
      expect(resAnswer.state.activeSeat).not.toBe(seat);
    });
  });
});

describe('Task 5: Room exit rules and movement continuation', () => {
  const canonical = fixtureContent();

  function makeExitTestSetup(
    exitTile: Tile,
    layoutConfig: {
      destPos: [number, number];
      destDoors: Partial<Doors>;
      dest2Pos: [number, number];
      dest2Doors: Partial<Doors>;
      playerStartsInExitRoom?: boolean;
    },
    seed = 1,
    testSource = 'test-exit',
  ) {
    const groundExitTile = { ...exitTile, floors: ['ground' as Floor] };
    const dest = dtile('tile.dest', layoutConfig.destDoors, { floors: ['ground'] });
    const dest2 = dtile('tile.dest2', layoutConfig.dest2Doors, { floors: ['ground'] });
    const tiles: Tile[] = [
      groundExitTile,
      dest,
      dest2,
      LAND_B,
      LAND_U,
      FILL_B,
      FILL_U,
      FILL_G,
    ];

    const startTileId =
      (layoutConfig.playerStartsInExitRoom ?? true) ? groundExitTile.id : dest.id;

    const layout = [
      {
        tileId: groundExitTile.id,
        floor: 'ground' as Floor,
        x: 0,
        y: 0,
        rotation: 0 as const,
      },
      {
        tileId: dest.id,
        floor: 'ground' as Floor,
        x: layoutConfig.destPos[0],
        y: layoutConfig.destPos[1],
        rotation: 0 as const,
      },
      {
        tileId: dest2.id,
        floor: 'ground' as Floor,
        x: layoutConfig.dest2Pos[0],
        y: layoutConfig.dest2Pos[1],
        rotation: 0 as const,
      },
      { tileId: LAND_B.id, floor: 'basement' as Floor, x: 0, y: 0, rotation: 0 as const },
      { tileId: LAND_U.id, floor: 'upper' as Floor, x: 0, y: 0, rotation: 0 as const },
    ];

    const house: House = {
      layout,
      startTile: startTileId,
      landings: { basement: LAND_B.id, ground: startTileId, upper: LAND_U.id },
    };

    const content = buildContent(
      {
        characters: fixtureContent().characters,
        cards: fixtureContent().cards,
        tiles,
        house,
      },
      testSource,
    );
    const g = startedGame({ content });
    const state = { ...g.state, rng: makeRng(seed) };
    const seat = state.activeSeat!;
    const exitPlacedId = state.board.index.ground['0,0']!;
    const destPlacedId =
      state.board.index.ground[`${layoutConfig.destPos[0]},${layoutConfig.destPos[1]}`]!;
    const dest2PlacedId =
      state.board.index.ground[
        `${layoutConfig.dest2Pos[0]},${layoutConfig.dest2Pos[1]}`
      ]!;
    return {
      g: { ...g, state },
      content,
      seat,
      exitPlacedId,
      destPlacedId,
      dest2PlacedId,
    };
  }

  const exitRoomCases = [
    {
      id: 'tile.junk_room',
      name: 'Junk Room',
      trait: 'might' as Trait,
      failLossTrait: 'speed' as Trait,
      threshold: 3,
      reasonSubstring: 'Junk Room',
      failSeed: 7,
      successSeed: 195,
      layout: {
        destPos: [0, 1] as [number, number],
        destDoors: { n: true, s: true },
        dest2Pos: [0, 2] as [number, number],
        dest2Doors: { n: true },
      },
    },
    {
      id: 'tile.the_pentagram_chamber',
      name: 'Pentagram Chamber',
      trait: 'knowledge' as Trait,
      failLossTrait: 'sanity' as Trait,
      threshold: 4,
      reasonSubstring: 'Pentagram Chamber',
      failSeed: 29,
      successSeed: 10,
      layout: {
        destPos: [1, 0] as [number, number],
        destDoors: { w: true, e: true },
        dest2Pos: [2, 0] as [number, number],
        dest2Doors: { w: true },
      },
    },
    {
      id: 'tile.attic',
      name: 'Attic',
      trait: 'speed' as Trait,
      failLossTrait: 'might' as Trait,
      threshold: 3,
      reasonSubstring: 'Attic',
      failSeed: 7,
      successSeed: 10,
      layout: {
        destPos: [0, 1] as [number, number],
        destDoors: { n: true, s: true },
        dest2Pos: [0, 2] as [number, number],
        dest2Doors: { n: true },
      },
    },
    {
      id: 'tile.graveyard',
      name: 'Graveyard',
      trait: 'sanity' as Trait,
      failLossTrait: 'knowledge' as Trait,
      threshold: 4,
      reasonSubstring: 'Graveyard',
      failSeed: 7,
      successSeed: 5,
      layout: {
        destPos: [0, 1] as [number, number],
        destDoors: { n: true, s: true },
        dest2Pos: [0, 2] as [number, number],
        dest2Doors: { n: true },
      },
    },
  ];

  describe.each(exitRoomCases)(
    '$name ($id)',
    ({
      id,
      name: _name,
      trait,
      failLossTrait,
      reasonSubstring,
      failSeed,
      successSeed,
      layout,
    }) => {
      const tileDef = canonical.tilesById[id]!;

      it('entering the room does not trigger exit roll or damage', () => {
        const { g, content, seat, exitPlacedId } = makeExitTestSetup(
          tileDef,
          { ...layout, playerStartsInExitRoom: false },
          failSeed,
          `enter-${id}`,
        );
        const beforeTraitLoss = g.state.players[seat]!.traits[failLossTrait];
        const res = reduce(g.state, { t: 'MOVE', seat, to: exitPlacedId }, content);
        expect(res.error).toBeUndefined();
        expect(res.state.players[seat]!.location).toBe(exitPlacedId);
        expect(res.events.some((e) => e.t === 'rolled')).toBe(false);
        expect(res.state.players[seat]!.traits[failLossTrait]).toBe(beforeTraitLoss);
      });

      it('agrees with getLegalActions when standing in exit room', () => {
        const { g, content, seat, destPlacedId } = makeExitTestSetup(
          tileDef,
          layout,
          failSeed,
          `actions-${id}`,
        );
        const legal = getLegalActions(g.state, seat, content);
        const moveOut = legal.find(
          (a) => a.t === 'MOVE' && (a as { to: string }).to === destPlacedId,
        );
        expect(moveOut).toBeDefined();
      });

      it('failed exit roll damages only the specified trait, emits rolled event with room name, and completes exit', () => {
        const { g, content, seat, exitPlacedId, destPlacedId, dest2PlacedId } =
          makeExitTestSetup(tileDef, layout, failSeed, `fail-${id}`);

        expect(g.state.players[seat]!.location).toBe(exitPlacedId);
        const beforeMoves = g.state.players[seat]!.movesLeft;
        const beforeTraitLoss = g.state.players[seat]!.traits[failLossTrait];
        const beforeRollTrait = g.state.players[seat]!.traits[trait];
        const expectedDice = traitValue(g.state, seat, trait, content);

        // Exit room into dest
        const exitRes = reduce(g.state, { t: 'MOVE', seat, to: destPlacedId }, content);
        expect(exitRes.error).toBeUndefined();

        // 1. Rolled event emitted naming the room and with right dice count
        const rolledEvent = exitRes.events.find((e) => e.t === 'rolled') as
          { t: 'rolled'; reason: string; dice: number[]; total: number } | undefined;
        expect(rolledEvent).toBeDefined();
        expect(rolledEvent!.reason).toContain(reasonSubstring);
        expect(rolledEvent!.dice.length).toBe(expectedDice);

        // 2. Only failLossTrait was reduced by 1
        const afterPlayer = exitRes.state.players[seat]!;
        expect(afterPlayer.traits[failLossTrait]).toBe(beforeTraitLoss - 1);
        if (failLossTrait !== trait) {
          expect(afterPlayer.traits[trait]).toBe(beforeRollTrait);
        }

        // 3. Reached destination room
        expect(afterPlayer.location).toBe(destPlacedId);

        // 4. Failed exit consumes only 1 move space
        expect(afterPlayer.movesLeft).toBe(beforeMoves - 1);

        // 5. Can continue moving if moves remain
        if (afterPlayer.movesLeft > 0) {
          const move2 = reduce(
            exitRes.state,
            { t: 'MOVE', seat, to: dest2PlacedId },
            content,
          );
          expect(move2.error).toBeUndefined();
          expect(move2.state.players[seat]!.location).toBe(dest2PlacedId);
          expect(move2.state.players[seat]!.movesLeft).toBe(beforeMoves - 2);
        }
      });

      it('successful exit roll avoids damage and completes exit', () => {
        const { g, content, seat, exitPlacedId, destPlacedId } = makeExitTestSetup(
          tileDef,
          layout,
          successSeed,
          `succ-${id}`,
        );

        expect(g.state.players[seat]!.location).toBe(exitPlacedId);
        const beforeTraitLoss = g.state.players[seat]!.traits[failLossTrait];
        const beforeMoves = g.state.players[seat]!.movesLeft;

        // Exit room into dest
        const exitRes = reduce(g.state, { t: 'MOVE', seat, to: destPlacedId }, content);
        expect(exitRes.error).toBeUndefined();

        const rolledEvent = exitRes.events.find((e) => e.t === 'rolled') as
          { t: 'rolled'; reason: string } | undefined;
        expect(rolledEvent).toBeDefined();
        expect(rolledEvent!.reason).toContain(reasonSubstring);

        // No damage taken
        const afterPlayer = exitRes.state.players[seat]!;
        expect(afterPlayer.traits[failLossTrait]).toBe(beforeTraitLoss);
        expect(afterPlayer.location).toBe(destPlacedId);
        expect(afterPlayer.movesLeft).toBe(beforeMoves - 1);
      });
    },
  );

  describe('Movement continuation on suspension', () => {
    it('suspending exit effect blocks unrelated actions, and answering completes movement continuation', () => {
      // Create a custom exit room with a suspending prompt in onExit
      const suspendingExitTile = dtile(
        'tile.suspending_exit',
        { n: true, s: true },
        {
          ruleText: 'Exit test prompt.',
          onExit: [
            {
              e: 'prompt',
              who: 'actor',
              prompt: { kind: 'choose_trait' },
              then: [{ e: 'trait', who: 'actor', trait: { ref: 'chosen' }, delta: -1 }],
            },
          ],
        },
      );

      const { g, content, seat, exitPlacedId, destPlacedId } = makeExitTestSetup(
        suspendingExitTile,
        {
          destPos: [0, 1],
          destDoors: { n: true },
          dest2Pos: [0, 2],
          dest2Doors: { n: true },
        },
        1,
        'test-suspension-exit',
      );

      expect(g.state.players[seat]!.location).toBe(exitPlacedId);

      // Initiate exit move to destPlacedId
      const exitRes = reduce(g.state, { t: 'MOVE', seat, to: destPlacedId }, content);
      expect(exitRes.error).toBeUndefined();
      expect(exitRes.state.pending).not.toBeNull();
      expect(exitRes.state.pending!.kind).toBe('choose_trait');

      // The player has not entered destPlacedId yet while suspended
      expect(exitRes.state.players[seat]!.location).toBe(exitPlacedId);

      // Unrelated actions are blocked with PROMPT_PENDING
      const badMove = reduce(
        exitRes.state,
        { t: 'MOVE', seat, to: destPlacedId },
        content,
      );
      expect(badMove.error?.code).toBe('PROMPT_PENDING');

      const badEnd = reduce(exitRes.state, { t: 'END_TURN', seat }, content);
      expect(badEnd.error?.code).toBe('PROMPT_PENDING');

      // getLegalActions only offers ANSWER
      const legal = getLegalActions(exitRes.state, seat, content);
      expect(legal.every((a) => a.t === 'ANSWER')).toBe(true);

      // Reconnect test: disconnect and reconnect preserves pending prompt
      const disc = reduce(
        exitRes.state,
        { t: 'DISCONNECT', seat, at: 1_700_000_000_000 },
        content,
      );
      const recon = reduce(disc.state, { t: 'RECONNECT', seat }, content);
      expect(recon.state.pending).not.toBeNull();

      // Answering completes the movement continuation to destPlacedId
      const promptId = recon.state.pending!.id;
      const answered = reduce(
        recon.state,
        { t: 'ANSWER', seat, promptId, answer: 'speed' },
        content,
      );
      expect(answered.error).toBeUndefined();
      expect(answered.state.pending).toBeNull();
      expect(answered.state.players[seat]!.location).toBe(destPlacedId);
      expect(answered.events.some((e) => e.t === 'moved')).toBe(true);
    });
  });
});

describe('Task 6: Crossing barriers (Tower, Catacombs, Chasm)', () => {
  const canonical = fixtureContent();

  function makeBarrierTestSetup(
    barrierTile: Tile,
    options: {
      rotation?: Rotation;
      entryPos: [number, number];
      entryDoors: Partial<Doors>;
      barrierPos: [number, number];
      oppositePos: [number, number];
      oppositeDoors: Partial<Doors>;
      extraTile?: Tile;
      extraPos?: [number, number];
    },
    seed = 1,
    testSource = 'test-barrier',
  ) {
    const rotation = options.rotation ?? 0;
    const groundBarrierTile = { ...barrierTile, floors: ['ground' as Floor] };
    const entryRoom = dtile('tile.entry_room', options.entryDoors, {
      floors: ['ground'],
    });
    const oppositeRoom = dtile('tile.opposite_room', options.oppositeDoors, {
      floors: ['ground'],
    });
    const tiles: Tile[] = [
      entryRoom,
      groundBarrierTile,
      oppositeRoom,
      LAND_B,
      LAND_U,
      FILL_B,
      FILL_U,
      FILL_G,
    ];

    const layout = [
      {
        tileId: entryRoom.id,
        floor: 'ground' as Floor,
        x: options.entryPos[0],
        y: options.entryPos[1],
        rotation: 0 as const,
      },
      {
        tileId: groundBarrierTile.id,
        floor: 'ground' as Floor,
        x: options.barrierPos[0],
        y: options.barrierPos[1],
        rotation,
      },
      {
        tileId: oppositeRoom.id,
        floor: 'ground' as Floor,
        x: options.oppositePos[0],
        y: options.oppositePos[1],
        rotation: 0 as const,
      },
      { tileId: LAND_B.id, floor: 'basement' as Floor, x: 0, y: 0, rotation: 0 as const },
      { tileId: LAND_U.id, floor: 'upper' as Floor, x: 0, y: 0, rotation: 0 as const },
    ];

    if (options.extraTile && options.extraPos) {
      tiles.push(options.extraTile);
      layout.push({
        tileId: options.extraTile.id,
        floor: 'ground' as Floor,
        x: options.extraPos[0],
        y: options.extraPos[1],
        rotation: 0 as const,
      });
    }

    const house: House = {
      layout,
      startTile: entryRoom.id,
      landings: { basement: LAND_B.id, ground: entryRoom.id, upper: LAND_U.id },
    };

    const content = buildContent(
      {
        characters: fixtureContent().characters,
        cards: fixtureContent().cards,
        tiles,
        house,
      },
      testSource,
    );
    const g = startedGame({ content });
    const state = { ...g.state, rng: makeRng(seed) };
    const seat = state.activeSeat!;
    const entryPlacedId =
      state.board.index.ground[`${options.entryPos[0]},${options.entryPos[1]}`]!;
    const barrierPlacedId =
      state.board.index.ground[`${options.barrierPos[0]},${options.barrierPos[1]}`]!;
    const oppositePlacedId =
      state.board.index.ground[`${options.oppositePos[0]},${options.oppositePos[1]}`]!;
    const extraPlacedId = options.extraPos
      ? state.board.index.ground[`${options.extraPos[0]},${options.extraPos[1]}`]
      : undefined;

    return {
      g: { ...g, state },
      content,
      seat,
      entryPlacedId,
      barrierPlacedId,
      oppositePlacedId,
      extraPlacedId,
    };
  }

  const barrierCases = [
    {
      id: 'tile.tower',
      name: 'Tower',
      trait: 'might' as Trait,
      threshold: 3,
      failSeed: 7,
      successSeed: 195,
      layout: {
        entryPos: [0, 0] as [number, number],
        entryDoors: { e: true },
        barrierPos: [1, 0] as [number, number],
        oppositePos: [2, 0] as [number, number],
        oppositeDoors: { w: true },
      },
    },
    {
      id: 'tile.catacombs',
      name: 'Catacombs',
      trait: 'sanity' as Trait,
      threshold: 6,
      failSeed: 7,
      successSeed: 31,
      layout: {
        entryPos: [0, 0] as [number, number],
        entryDoors: { s: true },
        barrierPos: [0, 1] as [number, number],
        oppositePos: [0, 2] as [number, number],
        oppositeDoors: { n: true },
      },
    },
    {
      id: 'tile.chasm',
      name: 'Chasm',
      trait: 'speed' as Trait,
      threshold: 3,
      failSeed: 7,
      successSeed: 10,
      layout: {
        entryPos: [0, 0] as [number, number],
        entryDoors: { e: true },
        barrierPos: [1, 0] as [number, number],
        oppositePos: [2, 0] as [number, number],
        oppositeDoors: { w: true },
      },
    },
  ];

  describe.each(barrierCases)(
    '$name ($id)',
    ({ id, name, trait, threshold, failSeed, successSeed, layout }) => {
      const tileDef = canonical.tilesById[id]!;

      it('return through entry doorway requires no roll and moves out', () => {
        const { g, content, seat, entryPlacedId, barrierPlacedId } = makeBarrierTestSetup(
          tileDef,
          layout,
          failSeed,
          `return-${id}`,
        );

        // Step into barrier room
        const stepIn = reduce(g.state, { t: 'MOVE', seat, to: barrierPlacedId }, content);
        expect(stepIn.error).toBeUndefined();
        expect(stepIn.state.players[seat]!.location).toBe(barrierPlacedId);
        expect(stepIn.state.players[seat]!.cameFrom).toBe(entryPlacedId);

        const movesInBarrier = stepIn.state.players[seat]!.movesLeft;

        // Step back to entry doorway
        const stepBack = reduce(
          stepIn.state,
          { t: 'MOVE', seat, to: entryPlacedId },
          content,
        );
        expect(stepBack.error).toBeUndefined();
        expect(stepBack.state.players[seat]!.location).toBe(entryPlacedId);
        expect(stepBack.state.players[seat]!.movesLeft).toBe(movesInBarrier - 1);
        // Assert NO roll was performed!
        expect(stepBack.events.some((e) => e.t === 'rolled')).toBe(false);
      });

      it('attempt through opposite doorway rolls; failure keeps location in barrier room, sets movesLeft=0, and preserves traits', () => {
        const { g, content, seat, barrierPlacedId, oppositePlacedId } =
          makeBarrierTestSetup(tileDef, layout, failSeed, `fail-${id}`);

        // Step into barrier room
        const stepIn = reduce(g.state, { t: 'MOVE', seat, to: barrierPlacedId }, content);
        expect(stepIn.error).toBeUndefined();

        const traitsBefore = { ...stepIn.state.players[seat]!.traits };
        const expectedDice = traitValue(stepIn.state, seat, trait, content);

        // Attempt opposite doorway
        const attemptCross = reduce(
          stepIn.state,
          { t: 'MOVE', seat, to: oppositePlacedId },
          content,
        );
        expect(attemptCross.error).toBeUndefined();

        // Rolled event emitted with room name and right dice
        const rolled = attemptCross.events.find((e) => e.t === 'rolled') as
          { t: 'rolled'; reason: string; dice: number[]; total: number } | undefined;
        expect(rolled).toBeDefined();
        expect(rolled!.reason).toContain(name);
        expect(rolled!.dice.length).toBe(expectedDice);
        expect(rolled!.total).toBeLessThan(threshold);

        // Log event indicates failure
        expect(
          attemptCross.events.some(
            (e) => e.t === 'log' && (e as { text: string }).text.includes('failed'),
          ),
        ).toBe(true);

        // Location remains in barrier room and movesLeft = 0
        const playerAfter = attemptCross.state.players[seat]!;
        expect(playerAfter.location).toBe(barrierPlacedId);
        expect(playerAfter.movesLeft).toBe(0);

        // CRITICAL: failure NEVER damages traits (specifically Chasm does not reduce Speed)
        expect(playerAfter.traits).toEqual(traitsBefore);
      });

      it('attempt through opposite doorway rolls; success moves out to opposite room and continues remaining movement', () => {
        const { g, content, seat, barrierPlacedId, oppositePlacedId } =
          makeBarrierTestSetup(tileDef, layout, successSeed, `succ-${id}`);

        // Step into barrier room
        const stepIn = reduce(g.state, { t: 'MOVE', seat, to: barrierPlacedId }, content);
        expect(stepIn.error).toBeUndefined();
        const movesInBarrier = stepIn.state.players[seat]!.movesLeft;

        // Attempt opposite doorway
        const attemptCross = reduce(
          stepIn.state,
          { t: 'MOVE', seat, to: oppositePlacedId },
          content,
        );
        expect(attemptCross.error).toBeUndefined();

        // Rolled event emitted
        const rolled = attemptCross.events.find((e) => e.t === 'rolled') as
          { t: 'rolled'; reason: string; total: number } | undefined;
        expect(rolled).toBeDefined();
        expect(rolled!.reason).toContain(name);
        expect(rolled!.total).toBeGreaterThanOrEqual(threshold);

        // Log event indicates success
        expect(
          attemptCross.events.some(
            (e) => e.t === 'log' && (e as { text: string }).text.includes('successfully'),
          ),
        ).toBe(true);

        // Arrives in opposite room and consumes 1 move
        const playerAfter = attemptCross.state.players[seat]!;
        expect(playerAfter.location).toBe(oppositePlacedId);
        expect(playerAfter.movesLeft).toBe(movesInBarrier - 1);
      });

      it('getLegalActions offers both entry and opposite rooms from barrier room', () => {
        const { g, content, seat, entryPlacedId, barrierPlacedId, oppositePlacedId } =
          makeBarrierTestSetup(tileDef, layout, failSeed, `actions-${id}`);

        const stepIn = reduce(g.state, { t: 'MOVE', seat, to: barrierPlacedId }, content);
        const legal = getLegalActions(stepIn.state, seat, content);
        const canReturn = legal.find(
          (a) => a.t === 'MOVE' && (a as { to: string }).to === entryPlacedId,
        );
        const canCross = legal.find(
          (a) => a.t === 'MOVE' && (a as { to: string }).to === oppositePlacedId,
        );
        expect(canReturn).toBeDefined();
        expect(canCross).toBeDefined();
      });
    },
  );

  describe('Rotated placements and travel directions', () => {
    const towerDef = canonical.tilesById['tile.tower']!;
    const catacombsDef = canonical.tilesById['tile.catacombs']!;

    it('Tower in reverse travel direction (East to West) requires no roll returning East and rolls attempting West', () => {
      // Setup Tower from East to West:
      // Entry room at (2, 0) with door 'w'
      // Tower at (1, 0) with rotation 0 (doors 'w' and 'e')
      // Opposite room at (0, 0) with door 'e'
      const { g, content, seat, entryPlacedId, barrierPlacedId, oppositePlacedId } =
        makeBarrierTestSetup(
          towerDef,
          {
            entryPos: [2, 0],
            entryDoors: { w: true },
            barrierPos: [1, 0],
            oppositePos: [0, 0],
            oppositeDoors: { e: true },
          },
          7, // fail seed
          'test-tower-rev',
        );

      // Step into Tower from East
      const stepIn = reduce(g.state, { t: 'MOVE', seat, to: barrierPlacedId }, content);
      expect(stepIn.error).toBeUndefined();

      // Return through East (entry doorway) -> no roll!
      const stepBack = reduce(
        stepIn.state,
        { t: 'MOVE', seat, to: entryPlacedId },
        content,
      );
      expect(stepBack.error).toBeUndefined();
      expect(stepBack.state.players[seat]!.location).toBe(entryPlacedId);
      expect(stepBack.events.some((e) => e.t === 'rolled')).toBe(false);

      // Attempt through West (opposite doorway) -> rolls Might!
      const cross = reduce(
        stepIn.state,
        { t: 'MOVE', seat, to: oppositePlacedId },
        content,
      );
      expect(cross.error).toBeUndefined();
      expect(cross.events.some((e) => e.t === 'rolled')).toBe(true);
      expect(cross.state.players[seat]!.location).toBe(barrierPlacedId); // failed
    });

    it('Tower with 90-degree rotation (doors North and South) uses board connections', () => {
      // Tower rotated 90: 'e' becomes 's', 'w' becomes 'n'
      // Entry room at (0, 0) with door 's'
      // Tower at (0, 1) with rotation 90
      // Opposite room at (0, 2) with door 'n'
      const { g, content, seat, entryPlacedId, barrierPlacedId, oppositePlacedId } =
        makeBarrierTestSetup(
          towerDef,
          {
            rotation: 90,
            entryPos: [0, 0],
            entryDoors: { s: true },
            barrierPos: [0, 1],
            oppositePos: [0, 2],
            oppositeDoors: { n: true },
          },
          7, // fail seed
          'test-tower-rot90',
        );

      // Step in from North
      const stepIn = reduce(g.state, { t: 'MOVE', seat, to: barrierPlacedId }, content);
      expect(stepIn.error).toBeUndefined();

      // Return North (entry doorway) -> no roll!
      const stepBack = reduce(
        stepIn.state,
        { t: 'MOVE', seat, to: entryPlacedId },
        content,
      );
      expect(stepBack.error).toBeUndefined();
      expect(stepBack.state.players[seat]!.location).toBe(entryPlacedId);
      expect(stepBack.events.some((e) => e.t === 'rolled')).toBe(false);

      // Attempt South (opposite doorway) -> rolls!
      const cross = reduce(
        stepIn.state,
        { t: 'MOVE', seat, to: oppositePlacedId },
        content,
      );
      expect(cross.error).toBeUndefined();
      expect(cross.events.some((e) => e.t === 'rolled')).toBe(true);
      expect(cross.state.players[seat]!.location).toBe(barrierPlacedId);
    });

    it('Catacombs with 270-degree rotation (doors West and East) uses board connections', () => {
      // Catacombs unrotated 'n'/'s'. Rotated 270: 'n' -> 'w', 's' -> 'e'.
      // Entry room at (2, 0) with door 'w'
      // Catacombs at (1, 0) with rotation 270
      // Opposite room at (0, 0) with door 'e'
      const { g, content, seat, entryPlacedId, barrierPlacedId, oppositePlacedId } =
        makeBarrierTestSetup(
          catacombsDef,
          {
            rotation: 270,
            entryPos: [2, 0],
            entryDoors: { w: true },
            barrierPos: [1, 0],
            oppositePos: [0, 0],
            oppositeDoors: { e: true },
          },
          7, // fail seed
          'test-catacombs-rot270',
        );

      const stepIn = reduce(g.state, { t: 'MOVE', seat, to: barrierPlacedId }, content);
      expect(stepIn.error).toBeUndefined();

      // Return East -> no roll
      const stepBack = reduce(
        stepIn.state,
        { t: 'MOVE', seat, to: entryPlacedId },
        content,
      );
      expect(stepBack.error).toBeUndefined();
      expect(stepBack.state.players[seat]!.location).toBe(entryPlacedId);
      expect(stepBack.events.some((e) => e.t === 'rolled')).toBe(false);

      // Attempt West -> rolls Sanity 6+
      const cross = reduce(
        stepIn.state,
        { t: 'MOVE', seat, to: oppositePlacedId },
        content,
      );
      expect(cross.error).toBeUndefined();
      expect(cross.events.some((e) => e.t === 'rolled')).toBe(true);
      expect(cross.state.players[seat]!.location).toBe(barrierPlacedId);
    });
  });

  describe('Direct movement and bypass prevention', () => {
    const chasmDef = canonical.tilesById['tile.chasm']!;

    it('direct multi-step MOVE through barrier halts in barrier room on failure', () => {
      const { g, content, seat, barrierPlacedId, oppositePlacedId } =
        makeBarrierTestSetup(
          chasmDef,
          {
            entryPos: [0, 0],
            entryDoors: { e: true },
            barrierPos: [1, 0],
            oppositePos: [2, 0],
            oppositeDoors: { w: true },
          },
          7, // fail seed for Speed
          'test-chasm-direct-fail',
        );

      // Player at (0, 0) issues direct MOVE to (2, 0) through Chasm (1, 0)
      const res = reduce(g.state, { t: 'MOVE', seat, to: oppositePlacedId }, content);
      expect(res.error).toBeUndefined();

      // Rolled event occurred
      expect(res.events.some((e) => e.t === 'rolled')).toBe(true);

      // Explorer stopped inside Chasm and did NOT bypass to opposite room!
      expect(res.state.players[seat]!.location).toBe(barrierPlacedId);
      expect(res.state.players[seat]!.movesLeft).toBe(0);
    });

    it('direct multi-step MOVE through barrier completes to destination on success', () => {
      const { g, content, seat, oppositePlacedId } = makeBarrierTestSetup(
        chasmDef,
        {
          entryPos: [0, 0],
          entryDoors: { e: true },
          barrierPos: [1, 0],
          oppositePos: [2, 0],
          oppositeDoors: { w: true },
        },
        10, // success seed for Speed
        'test-chasm-direct-succ',
      );

      const beforeMoves = g.state.players[seat]!.movesLeft;

      // Player at (0, 0) issues direct MOVE to (2, 0) through Chasm (1, 0)
      const res = reduce(g.state, { t: 'MOVE', seat, to: oppositePlacedId }, content);
      expect(res.error).toBeUndefined();
      expect(res.events.some((e) => e.t === 'rolled')).toBe(true);

      // Reached opposite room, consumed 2 movement points (1 into Chasm, 1 into opposite room)
      expect(res.state.players[seat]!.location).toBe(oppositePlacedId);
      expect(res.state.players[seat]!.movesLeft).toBe(beforeMoves - 2);
    });

    it('unrelated static link does not trigger crossing roll', () => {
      // Barrier room with an extra static link
      const towerWithLink = {
        ...canonical.tilesById['tile.tower']!,
        staticLinks: [
          {
            kind: 'to_tile' as const,
            target: 'tile.extra_room',
            twoWay: true,
          },
        ],
      };
      const extraTile = dtile('tile.extra_room', { n: true }, { floors: ['ground'] });

      const { g, content, seat, barrierPlacedId, extraPlacedId } = makeBarrierTestSetup(
        towerWithLink,
        {
          entryPos: [0, 0],
          entryDoors: { e: true },
          barrierPos: [1, 0],
          oppositePos: [2, 0],
          oppositeDoors: { w: true },
          extraTile,
          extraPos: [5, 5],
        },
        7,
        'test-unrelated-link',
      );

      // Step into Tower
      const stepIn = reduce(g.state, { t: 'MOVE', seat, to: barrierPlacedId }, content);
      expect(stepIn.error).toBeUndefined();

      // Move via static link to extra_room
      const stepExtra = reduce(
        stepIn.state,
        { t: 'MOVE', seat, to: extraPlacedId! },
        content,
      );
      expect(stepExtra.error).toBeUndefined();
      expect(stepExtra.state.players[seat]!.location).toBe(extraPlacedId);
      // No crossing roll was triggered by unrelated link!
      expect(stepExtra.events.some((e) => e.t === 'rolled')).toBe(false);
    });
  });

  describe('Task 7: Coal Chute, Gallery, and Vault room actions', () => {
    describe('Coal Chute (tile.coal_chute)', () => {
      it('entering Coal Chute immediately slides to Basement Landing, costing exactly 1 movement space', () => {
        const coalChuteDef = canonical.tilesById['tile.coal_chute']!;
        const startTile = dtile(
          'tile.entrance_hall',
          { s: true },
          { floors: ['ground'] },
        );
        const house: House = {
          layout: [
            { tileId: startTile.id, floor: 'ground', x: 0, y: 0, rotation: 0 },
            { tileId: coalChuteDef.id, floor: 'ground', x: 0, y: 1, rotation: 0 },
            { tileId: LAND_B.id, floor: 'basement', x: 0, y: 0, rotation: 0 },
            { tileId: LAND_U.id, floor: 'upper', x: 0, y: 0, rotation: 0 },
          ],
          startTile: startTile.id,
          landings: { basement: LAND_B.id, ground: startTile.id, upper: LAND_U.id },
        };
        const content = buildContent(
          {
            characters: fixtureContent().characters,
            cards: fixtureContent().cards,
            tiles: [startTile, coalChuteDef, LAND_B, LAND_U, FILL_B, FILL_U, FILL_G],
            house,
          },
          'coal-chute-test',
        );
        const g = startedGame({ content });
        const seat = g.state.activeSeat!;
        const initialMoves = g.state.players[seat]!.movesLeft;
        const coalChutePlacedId = g.state.board.index.ground['0,1']!;
        const basementLandingPlacedId = g.state.board.index.basement['0,0']!;

        // Move into Coal Chute
        const res = reduce(g.state, { t: 'MOVE', seat, to: coalChutePlacedId }, content);
        expect(res.error).toBeUndefined();

        // Immediately slides to Basement Landing
        const p = res.state.players[seat]!;
        expect(p.location).toBe(basementLandingPlacedId);

        // Whole entry/slide costs exactly 1 movement space
        expect(p.movesLeft).toBe(initialMoves - 1);

        // Ordered events: moved into Coal Chute, slide log, moved into Basement Landing
        const moveEvents = res.events.filter((e) => e.t === 'moved') as Array<{
          t: 'moved';
          from: string | null;
          to: string;
        }>;
        expect(moveEvents.length).toBe(2);
        expect(moveEvents[0]!.to).toBe(coalChutePlacedId);
        expect(moveEvents[1]!.to).toBe(basementLandingPlacedId);
        expect(
          res.events.some(
            (e) => e.t === 'log' && (e as { text: string }).text.includes('Coal Chute'),
          ),
        ).toBe(true);
      });

      it('cannot end turn on Coal Chute', () => {
        const coalChuteDef = canonical.tilesById['tile.coal_chute']!;
        const startTile = dtile(
          'tile.entrance_hall',
          { s: true },
          { floors: ['ground'] },
        );
        const house: House = {
          layout: [
            { tileId: startTile.id, floor: 'ground', x: 0, y: 0, rotation: 0 },
            { tileId: coalChuteDef.id, floor: 'ground', x: 0, y: 1, rotation: 0 },
            { tileId: LAND_B.id, floor: 'basement', x: 0, y: 0, rotation: 0 },
            { tileId: LAND_U.id, floor: 'upper', x: 0, y: 0, rotation: 0 },
          ],
          startTile: startTile.id,
          landings: { basement: LAND_B.id, ground: startTile.id, upper: LAND_U.id },
        };
        const content = buildContent(
          {
            characters: fixtureContent().characters,
            cards: fixtureContent().cards,
            tiles: [startTile, coalChuteDef, LAND_B, LAND_U, FILL_B, FILL_U, FILL_G],
            house,
          },
          'coal-chute-end-turn-test',
        );
        const g = startedGame({ content });
        const seat = g.state.activeSeat!;
        const coalChutePlacedId = g.state.board.index.ground['0,1']!;

        // Artificially place player on Coal Chute
        const stateOnChute: GameState = {
          ...g.state,
          players: {
            ...g.state.players,
            [seat]: {
              ...g.state.players[seat]!,
              location: coalChutePlacedId,
            },
          },
        };

        // getLegalActions must NOT offer END_TURN
        const legal = getLegalActions(stateOnChute, seat, content);
        expect(legal.some((a) => a.t === 'END_TURN')).toBe(false);

        // reduce must reject END_TURN
        const res = reduce(stateOnChute, { t: 'END_TURN', seat }, content);
        expect(res.error).toBeDefined();
        expect(res.error?.code).toBe('ILLEGAL_MOVE');
      });
    });

    describe('Gallery (tile.gallery)', () => {
      function makeGallerySetup(includeBallroom: boolean, seed: number) {
        const galleryDef = canonical.tilesById['tile.gallery']!;
        const ballroomDef = canonical.tilesById['tile.ballroom']!;
        const startTile = dtile(
          'tile.entrance_hall',
          { n: true },
          { floors: ['ground'] },
        );
        const layout: House['layout'] = [
          { tileId: startTile.id, floor: 'ground', x: 0, y: 0, rotation: 0 },
          { tileId: galleryDef.id, floor: 'upper', x: 0, y: 0, rotation: 0 },
          { tileId: LAND_B.id, floor: 'basement', x: 0, y: 0, rotation: 0 },
          { tileId: LAND_U.id, floor: 'upper', x: 1, y: 0, rotation: 0 },
        ];
        const tiles = [startTile, galleryDef, LAND_B, LAND_U, FILL_B, FILL_U, FILL_G];
        if (includeBallroom) {
          layout.push({
            tileId: ballroomDef.id,
            floor: 'ground',
            x: 0,
            y: 1,
            rotation: 0,
          });
          tiles.push(ballroomDef);
        }
        const house: House = {
          layout,
          startTile: startTile.id,
          landings: { basement: LAND_B.id, ground: startTile.id, upper: LAND_U.id },
        };
        const content = buildContent(
          {
            characters: fixtureContent().characters,
            cards: fixtureContent().cards,
            tiles,
            house,
          },
          `gallery-test-${includeBallroom ? 'with' : 'without'}-ballroom-${seed}`,
        );
        const g = startedGame({ content });
        const seat = g.state.activeSeat!;
        const galleryPlacedId = g.state.board.index.upper['0,0']!;
        // Place player in Gallery
        const state: GameState = {
          ...g.state,
          rng: makeRng(seed),
          players: {
            ...g.state.players,
            [seat]: {
              ...g.state.players[seat]!,
              location: galleryPlacedId,
            },
          },
        };
        return { state, seat, content, galleryPlacedId };
      }

      it('Gallery action is absent and rejected when Ballroom is not in the house', () => {
        const { state, seat, content } = makeGallerySetup(false, 0);

        // Not in getLegalActions
        const legal = getLegalActions(state, seat, content);
        expect(
          legal.some(
            (a) =>
              a.t === 'ROOM_ACTION' &&
              (a as { actionId: string }).actionId === 'action.gallery.fall_to_ballroom',
          ),
        ).toBe(false);

        // Rejected by reduce
        const res = reduce(
          state,
          {
            t: 'ROOM_ACTION',
            seat,
            actionId: 'action.gallery.fall_to_ballroom',
          },
          content,
        );
        expect(res.error).toBeDefined();
        expect(res.error?.code).toBe('ILLEGAL_MOVE');
      });

      it('Gallery action is offered when Ballroom is placed, and roll 0 moves to Ballroom with 0 damage', () => {
        // Seed 0 rolls 0 on 1 die
        const { state, seat, content, galleryPlacedId } = makeGallerySetup(true, 0);
        const ballroomPlacedId = state.board.index.ground['0,1']!;

        // Offered in getLegalActions
        const legal = getLegalActions(state, seat, content);
        expect(
          legal.some(
            (a) =>
              a.t === 'ROOM_ACTION' &&
              (a as { actionId: string }).actionId === 'action.gallery.fall_to_ballroom',
          ),
        ).toBe(true);

        const traitsBefore = { ...state.players[seat]!.traits };

        // Execute action
        const res = reduce(
          state,
          {
            t: 'ROOM_ACTION',
            seat,
            actionId: 'action.gallery.fall_to_ballroom',
          },
          content,
        );
        expect(res.error).toBeUndefined();

        // Moved to Ballroom
        const p = res.state.players[seat]!;
        expect(p.location).toBe(ballroomPlacedId);

        // Rolled 1 die with total 0
        const rolled = res.events.find((e) => e.t === 'rolled') as
          { t: 'rolled'; dice: number[]; total: number } | undefined;
        expect(rolled).toBeDefined();
        expect(rolled!.dice.length).toBe(1);
        expect(rolled!.total).toBe(0);

        // No damage, no pending prompt
        expect(res.state.pending).toBeNull();
        expect(p.traits).toEqual(traitsBefore);

        // Moved event emitted
        expect(
          res.events.some(
            (e) =>
              e.t === 'moved' &&
              (e as { from: string; to: string }).from === galleryPlacedId &&
              (e as { from: string; to: string }).to === ballroomPlacedId,
          ),
        ).toBe(true);
      });

      it('Gallery action roll 1 moves to Ballroom, raises choose_trait prompt, and damages chosen physical trait', () => {
        // Seed 200 rolls 1 on 1 die
        const { state, seat, content } = makeGallerySetup(true, 200);
        const ballroomPlacedId = state.board.index.ground['0,1']!;

        const initialSpeed = state.players[seat]!.traits.speed;

        const res = reduce(
          state,
          {
            t: 'ROOM_ACTION',
            seat,
            actionId: 'action.gallery.fall_to_ballroom',
          },
          content,
        );
        expect(res.error).toBeUndefined();

        // Player is now in Ballroom
        expect(res.state.players[seat]!.location).toBe(ballroomPlacedId);

        // Rolled 1
        const rolled = res.events.find((e) => e.t === 'rolled') as
          { t: 'rolled'; total: number } | undefined;
        expect(rolled?.total).toBe(1);

        // Pending choose_trait prompt for speed/might
        expect(res.state.pending).toBeDefined();
        expect(res.state.pending?.kind).toBe('choose_trait');

        // Answer choosing speed
        const resAnswer = reduce(
          res.state,
          {
            t: 'ANSWER',
            seat,
            promptId: res.state.pending!.id,
            answer: 'speed',
          },
          content,
        );
        expect(resAnswer.error).toBeUndefined();
        expect(resAnswer.state.pending).toBeNull();
        expect(resAnswer.state.players[seat]!.traits.speed).toBe(initialSpeed - 1);
      });

      it('Gallery action roll 2 moves to Ballroom and distributes 2 physical damage across chosen traits', () => {
        // Seed 300 rolls 2 on 1 die
        const { state, seat, content } = makeGallerySetup(true, 300);
        const ballroomPlacedId = state.board.index.ground['0,1']!;

        const initialMight = state.players[seat]!.traits.might;
        const initialSpeed = state.players[seat]!.traits.speed;

        const res = reduce(
          state,
          {
            t: 'ROOM_ACTION',
            seat,
            actionId: 'action.gallery.fall_to_ballroom',
          },
          content,
        );
        expect(res.error).toBeUndefined();
        expect(res.state.players[seat]!.location).toBe(ballroomPlacedId);

        // Rolled 2
        const rolled = res.events.find((e) => e.t === 'rolled') as
          { t: 'rolled'; total: number } | undefined;
        expect(rolled?.total).toBe(2);

        // First damage choice: choose might
        expect(res.state.pending?.kind).toBe('choose_trait');
        const res1 = reduce(
          res.state,
          {
            t: 'ANSWER',
            seat,
            promptId: res.state.pending!.id,
            answer: 'might',
          },
          content,
        );
        expect(res1.error).toBeUndefined();
        expect(res1.state.players[seat]!.traits.might).toBe(initialMight - 1);

        // Second damage choice: choose speed
        expect(res1.state.pending?.kind).toBe('choose_trait');
        const res2 = reduce(
          res1.state,
          {
            t: 'ANSWER',
            seat,
            promptId: res1.state.pending!.id,
            answer: 'speed',
          },
          content,
        );
        expect(res2.error).toBeUndefined();
        expect(res2.state.pending).toBeNull();
        expect(res2.state.players[seat]!.traits.speed).toBe(initialSpeed - 1);
      });
    });

    describe('The Vault (tile.the_vault)', () => {
      function makeVaultSetup(seed: number) {
        const vaultDef = canonical.tilesById['tile.the_vault']!;
        const startTile = dtile(
          'tile.entrance_hall',
          { n: true },
          { floors: ['ground'] },
        );
        const house: House = {
          layout: [
            { tileId: startTile.id, floor: 'ground', x: 0, y: 0, rotation: 0 },
            { tileId: vaultDef.id, floor: 'upper', x: 0, y: 0, rotation: 0 },
            { tileId: LAND_B.id, floor: 'basement', x: 0, y: 0, rotation: 0 },
            { tileId: LAND_U.id, floor: 'upper', x: 1, y: 0, rotation: 0 },
          ],
          startTile: startTile.id,
          landings: { basement: LAND_B.id, ground: startTile.id, upper: LAND_U.id },
        };
        const content = buildContent(
          {
            characters: fixtureContent().characters,
            cards: fixtureContent().cards,
            tiles: [startTile, vaultDef, LAND_B, LAND_U, FILL_B, FILL_U, FILL_G],
            house,
          },
          `vault-test-${seed}`,
        );
        const g = startedGame({ content });
        const seat = g.state.activeSeat!;
        const vaultPlacedId = g.state.board.index.upper['0,0']!;
        const state: GameState = {
          ...g.state,
          rng: makeRng(seed),
          players: {
            ...g.state.players,
            [seat]: {
              ...g.state.players[seat]!,
              location: vaultPlacedId,
            },
          },
        };
        return { state, seat, content, vaultPlacedId };
      }

      it('Vault action is offered when standing in Vault, and failed attempt (<6) prevents same-turn retry', () => {
        // Seed 0 gives roll total 0 (< 6)
        const { state, seat, content, vaultPlacedId } = makeVaultSetup(0);

        // Offered in getLegalActions
        const legal = getLegalActions(state, seat, content);
        expect(
          legal.some(
            (a) =>
              a.t === 'ROOM_ACTION' &&
              (a as { actionId: string }).actionId === 'action.the_vault.open',
          ),
        ).toBe(true);

        const itemsBefore = state.players[seat]!.items.length;

        // First attempt (fails)
        const resFail = reduce(
          state,
          {
            t: 'ROOM_ACTION',
            seat,
            actionId: 'action.the_vault.open',
          },
          content,
        );
        expect(resFail.error).toBeUndefined();

        // Roll event emitted, total < 6
        const rolled = resFail.events.find((e) => e.t === 'rolled') as
          { t: 'rolled'; total: number; reason: string } | undefined;
        expect(rolled).toBeDefined();
        expect(rolled!.reason).toContain('Vault');
        expect(rolled!.total).toBeLessThan(6);

        // Did not draw items, vault is NOT empty
        expect(resFail.state.players[seat]!.items.length).toBe(itemsBefore);
        expect(
          resFail.state.board.placed[vaultPlacedId]!.flags['vault_empty'],
        ).toBeFalsy();

        // Same turn retry is absent from getLegalActions
        const legalSameTurn = getLegalActions(resFail.state, seat, content);
        expect(
          legalSameTurn.some(
            (a) =>
              a.t === 'ROOM_ACTION' &&
              (a as { actionId: string }).actionId === 'action.the_vault.open',
          ),
        ).toBe(false);

        // Same turn retry rejected by reduce
        const resRetry = reduce(
          resFail.state,
          {
            t: 'ROOM_ACTION',
            seat,
            actionId: 'action.the_vault.open',
          },
          content,
        );
        expect(resRetry.error).toBeDefined();
        expect(resRetry.error?.code).toBe('ILLEGAL_MOVE');

        // End turn and advance round back to player
        let nextTurnState = resFail.state;
        // Pass turn through other seats until activeSeat is back to seat
        for (let i = 0; i < Object.keys(nextTurnState.players).length; i++) {
          const active = nextTurnState.activeSeat!;
          const endRes = reduce(nextTurnState, { t: 'END_TURN', seat: active }, content);
          expect(endRes.error).toBeUndefined();
          nextTurnState = endRes.state;
          if (nextTurnState.activeSeat === seat) break;
        }

        // On player's next turn, Vault action is available again!
        expect(nextTurnState.activeSeat).toBe(seat);
        const legalNextTurn = getLegalActions(nextTurnState, seat, content);
        expect(
          legalNextTurn.some(
            (a) =>
              a.t === 'ROOM_ACTION' &&
              (a as { actionId: string }).actionId === 'action.the_vault.open',
          ),
        ).toBe(true);
      });

      it('Vault action success (>=6) draws 2 Item cards, sets vault_empty flag, and is permanently absent globally', () => {
        // Seed 31 gives roll total 6 on 4 dice (>= 6)
        const { state, seat, content, vaultPlacedId } = makeVaultSetup(31);

        const itemsBefore = state.players[seat]!.items.length;

        const resSuccess = reduce(
          state,
          {
            t: 'ROOM_ACTION',
            seat,
            actionId: 'action.the_vault.open',
          },
          content,
        );
        expect(resSuccess.error).toBeUndefined();

        // Roll event emitted, total >= 6
        const rolled = resSuccess.events.find((e) => e.t === 'rolled') as
          { t: 'rolled'; total: number; reason: string } | undefined;
        expect(rolled).toBeDefined();
        expect(rolled!.total).toBeGreaterThanOrEqual(6);

        // Exactly 2 Item cards drawn
        const drawEvents = resSuccess.events.filter(
          (e) => e.t === 'drew_card' && (e as { deck: string }).deck === 'item',
        );
        expect(drawEvents.length).toBe(2);
        expect(resSuccess.state.players[seat]!.items.length).toBe(itemsBefore + 2);

        // Tile flag vault_empty is true
        expect(resSuccess.state.board.placed[vaultPlacedId]!.flags['vault_empty']).toBe(
          true,
        );

        // Log indicates vault cracked
        expect(
          resSuccess.events.some(
            (e) =>
              e.t === 'log' && (e as { text: string }).text.includes('cracked the vault'),
          ),
        ).toBe(true);

        // Action is now permanently absent from getLegalActions
        const legalAfter = getLegalActions(resSuccess.state, seat, content);
        expect(
          legalAfter.some(
            (a) =>
              a.t === 'ROOM_ACTION' &&
              (a as { actionId: string }).actionId === 'action.the_vault.open',
          ),
        ).toBe(false);

        // Subsequent attempt rejected globally
        const resSubsequent = reduce(
          resSuccess.state,
          {
            t: 'ROOM_ACTION',
            seat,
            actionId: 'action.the_vault.open',
          },
          content,
        );
        expect(resSubsequent.error).toBeDefined();
        expect(resSubsequent.error?.code).toBe('ILLEGAL_MOVE');
      });
    });

    describe('Room action dispatch, authorization, and token interaction', () => {
      it('rejects spoofed or invalid actionId with ILLEGAL_MOVE', () => {
        const vaultDef = canonical.tilesById['tile.the_vault']!;
        const startTile = dtile(
          'tile.entrance_hall',
          { n: true },
          { floors: ['ground'] },
        );
        const house: House = {
          layout: [
            { tileId: startTile.id, floor: 'ground', x: 0, y: 0, rotation: 0 },
            { tileId: vaultDef.id, floor: 'upper', x: 0, y: 0, rotation: 0 },
            { tileId: LAND_B.id, floor: 'basement', x: 0, y: 0, rotation: 0 },
            { tileId: LAND_U.id, floor: 'upper', x: 1, y: 0, rotation: 0 },
          ],
          startTile: startTile.id,
          landings: { basement: LAND_B.id, ground: startTile.id, upper: LAND_U.id },
        };
        const content = buildContent(
          {
            characters: fixtureContent().characters,
            cards: fixtureContent().cards,
            tiles: [startTile, vaultDef, LAND_B, LAND_U, FILL_B, FILL_U, FILL_G],
            house,
          },
          'invalid-action-test',
        );
        const g = startedGame({ content });
        const seat = g.state.activeSeat!;

        const res = reduce(
          g.state,
          {
            t: 'ROOM_ACTION',
            seat,
            actionId: 'action.completely_fake_action',
          },
          content,
        );
        expect(res.error).toBeDefined();
        expect(res.error?.code).toBe('ILLEGAL_MOVE');
      });

      it('rejects ROOM_ACTION from inactive seat with NOT_YOUR_TURN', () => {
        const g = startedGame({ content: canonical });
        const active = g.state.activeSeat!;
        const other = Object.keys(g.state.players).find((s) => s !== active)! as SeatId;

        const res = reduce(
          g.state,
          {
            t: 'ROOM_ACTION',
            seat: other,
            actionId: 'action.the_vault.open',
          },
          canonical,
        );
        expect(res.error).toBeDefined();
        expect(res.error?.code).toBe('NOT_YOUR_TURN');
      });

      it('interact_token works when an incomplete token is present in room and is offered by getLegalActions', () => {
        const g = startedGame({ content: canonical });
        const seat = g.state.activeSeat!;
        const loc = g.state.players[seat]!.location!;

        const stateWithToken: GameState = {
          ...g.state,
          tokens: [
            {
              id: 'token_1',
              token: 'quest_token',
              location: loc,
              flags: {},
            },
          ],
        };

        const legal = getLegalActions(stateWithToken, seat, canonical);
        expect(
          legal.some(
            (a) =>
              a.t === 'ROOM_ACTION' &&
              (a as { actionId: string }).actionId === 'interact_token',
          ),
        ).toBe(true);

        const res = reduce(
          stateWithToken,
          {
            t: 'ROOM_ACTION',
            seat,
            actionId: 'interact_token',
          },
          canonical,
        );
        expect(res.error).toBeUndefined();
        expect(res.state.tokens[0]!.flags['completed']).toBe(true);
      });
    });
  });

  describe('Task 8: Player-visible room regression journey (Library full lifecycle)', () => {
    it('discovers Library, resolves card first, receives +1 Knowledge before manual END_TURN, and proves globally spent tile never duplicates', () => {
      const libraryDef = canonical.tilesById['tile.library']!;
      const startTile = dtile(
        'tile.entrance_hall',
        { n: true, e: true },
        { floors: ['ground'] },
      );

      const content = makeForcedDrawContent(startTile, libraryDef);
      const g = startedGame({ content });
      const seat1 = g.state.turnOrder[0]!;
      const seat2 = g.state.turnOrder[1]!;

      // Put Library as the next tile to draw
      const stateWithLibraryDeck: GameState = {
        ...g.state,
        activeSeat: seat1,
        tileDeck: [libraryDef.id],
        players: {
          ...g.state.players,
          [seat1]: {
            ...g.state.players[seat1]!,
            location: g.state.board.index.ground['0,0']!,
            movesLeft: 3,
          },
          [seat2]: {
            ...g.state.players[seat2]!,
            location: g.state.board.index.ground['0,0']!,
            movesLeft: 3,
          },
        },
      };

      const initialKnowledgeSeat1 = stateWithLibraryDeck.players[seat1]!.traits.knowledge;
      const initialKnowledgeSeat2 = stateWithLibraryDeck.players[seat2]!.traits.knowledge;

      // 1. Explorer 1 discovers Library by moving through North doorway
      let resMove = reduce(
        stateWithLibraryDeck,
        { t: 'MOVE_THROUGH', seat: seat1, dir: 'n' },
        content,
      );
      expect(resMove.error).toBeUndefined();
      if (resMove.state.pending?.kind === 'rotate_tile') {
        resMove = reduce(
          resMove.state,
          { t: 'ROTATE_TILE', seat: seat1, rotation: 0 },
          content,
        );
        expect(resMove.error).toBeUndefined();
      }

      // Card pipeline resolves first: drew_card event occurs before trait_changed
      const drewCardIndex = resMove.events.findIndex(
        (e) => e.t === 'drew_card' && (e as { deck: string }).deck === 'event',
      );
      const traitChangedIndex = resMove.events.findIndex(
        (e) => e.t === 'trait_changed' && (e as { trait: string }).trait === 'knowledge',
      );
      expect(drewCardIndex).toBeGreaterThanOrEqual(0);
      expect(traitChangedIndex).toBeGreaterThan(drewCardIndex);

      // Knowledge is already +1 BEFORE manual END_TURN
      expect(resMove.state.players[seat1]!.traits.knowledge).toBe(
        initialKnowledgeSeat1 + 1,
      );

      // Placed Library tile is marked spent
      const libraryPlacedId = resMove.state.players[seat1]!.location!;
      expect(resMove.state.board.placed[libraryPlacedId]!.flags['spent']).toBe(true);

      // 2. Explorer 1 calls END_TURN: no duplicate Knowledge gain
      const resEnd1 = reduce(resMove.state, { t: 'END_TURN', seat: seat1 }, content);
      expect(resEnd1.error).toBeUndefined();
      expect(resEnd1.state.players[seat1]!.traits.knowledge).toBe(
        initialKnowledgeSeat1 + 1,
      );
      // Turn advances to seat2
      expect(resEnd1.state.activeSeat).toBe(seat2);

      // 3. Explorer 2 enters the already discovered Library
      const resMove2 = reduce(
        resEnd1.state,
        { t: 'MOVE', seat: seat2, to: libraryPlacedId },
        content,
      );
      expect(resMove2.error).toBeUndefined();
      expect(resMove2.state.players[seat2]!.location).toBe(libraryPlacedId);

      // Explorer 2 calls END_TURN in Library: proves globally spent tile grants NO reward
      const resEnd2 = reduce(resMove2.state, { t: 'END_TURN', seat: seat2 }, content);
      expect(resEnd2.error).toBeUndefined();
      expect(resEnd2.state.players[seat2]!.traits.knowledge).toBe(initialKnowledgeSeat2);

      // 4. Advance turns until Explorer 1 is active again and ends turn in Library
      let roundTripState = resEnd2.state;
      while (roundTripState.activeSeat !== seat1) {
        const active = roundTripState.activeSeat!;
        const resPass = reduce(roundTripState, { t: 'END_TURN', seat: active }, content);
        expect(resPass.error).toBeUndefined();
        roundTripState = resPass.state;
      }

      // Explorer 1 is active again, standing in Library (or moves into it)
      // Call END_TURN again in Library
      const resRevisit = reduce(roundTripState, { t: 'END_TURN', seat: seat1 }, content);
      expect(resRevisit.error).toBeUndefined();
      // Knowledge remains exactly initialKnowledgeSeat1 + 1 (never grants a second reward)
      expect(resRevisit.state.players[seat1]!.traits.knowledge).toBe(
        initialKnowledgeSeat1 + 1,
      );
    });
  });

  describe('Task 9: Floor eligibility, finite floor supply, card symbols, and Basement access', () => {
    it('first discovery of a no-symbol room draws no card and allows movement continuation (movesLeft - 1)', () => {
      const canonical = fixtureContent();
      // Dusty Hallway has symbol: null
      const dustyDef = canonical.tilesById['tile.dusty_hallway']!;
      expect(dustyDef.symbol).toBeNull();

      const start = dtile('tile.start', { n: true, e: true, s: true, w: true });
      const content = makeForcedDrawContent(start, dustyDef);
      const g = startedGame({ content });
      const seat = g.state.activeSeat!;
      const initialMoves = g.state.players[seat]!.movesLeft;
      expect(initialMoves).toBeGreaterThan(1);

      let res = reduce(g.state, { t: 'MOVE_THROUGH', seat, dir: 'n' }, content);
      expect(res.error).toBeUndefined();
      if (res.state.pending?.kind === 'rotate_tile') {
        res = reduce(res.state, { t: 'ROTATE_TILE', seat, rotation: 0 }, content);
        expect(res.error).toBeUndefined();
      }

      // No card drawn
      expect(res.events.some((e) => e.t === 'drew_card')).toBe(false);
      // Moves left reduced by 1, NOT set to 0!
      expect(res.state.players[seat]!.movesLeft).toBe(initialMoves - 1);
    });

    it('first discovery of an omen/event/item room draws exactly one card and ends movement (movesLeft = 0)', () => {
      const canonical = fixtureContent();
      // Chapel has symbol: "event"
      const chapelDef = canonical.tilesById['tile.chapel']!;
      expect(chapelDef.symbol).toBe('event');

      const start = dtile('tile.start', { n: true, e: true, s: true, w: true });
      const content = makeForcedDrawContent(start, chapelDef);
      const g = startedGame({ content });
      const seat = g.state.activeSeat!;

      let res = reduce(g.state, { t: 'MOVE_THROUGH', seat, dir: 'n' }, content);
      expect(res.error).toBeUndefined();
      if (res.state.pending?.kind === 'rotate_tile') {
        res = reduce(res.state, { t: 'ROTATE_TILE', seat, rotation: 0 }, content);
        expect(res.error).toBeUndefined();
      }

      // Card drawn
      expect(res.events.some((e) => e.t === 'drew_card')).toBe(true);
      // Movement ended
      expect(res.state.players[seat]!.movesLeft).toBe(0);
    });

    it('Basement route 1: Coal Chute slides explorer immediately to Basement Landing', () => {
      const canonical = fixtureContent();
      const coalChuteDef = canonical.tilesById['tile.coal_chute']!;
      expect(coalChuteDef).toBeDefined();

      const start = dtile('tile.start', { n: true, e: true, s: true, w: true });
      const content = makeForcedDrawContent(start, coalChuteDef);
      const g = startedGame({ content });
      const seat = g.state.activeSeat!;

      let res = reduce(g.state, { t: 'MOVE_THROUGH', seat, dir: 'n' }, content);
      expect(res.error).toBeUndefined();
      if (res.state.pending?.kind === 'rotate_tile') {
        res = reduce(res.state, { t: 'ROTATE_TILE', seat, rotation: 0 }, content);
        expect(res.error).toBeUndefined();
      }

      // Explorer slid to Basement Landing
      const p = res.state.players[seat]!;
      const basementLandingId = res.state.board.index.basement['0,0']!;
      expect(p.location).toBe(basementLandingId);
      expect(res.events.some((e) => e.t === 'log' && e.text.includes('Coal Chute'))).toBe(
        true,
      );
    });

    it('Basement route 2: Stairs from Basement discovered links two-way with Foyer', () => {
      const canonical = fixtureContent();
      const stairsDef = canonical.tilesById['tile.stairs_from_basement']!;
      expect(stairsDef).toBeDefined();

      // Start at basement landing, discover Stairs from Basement
      const startB = dtile(
        'tile.b_start',
        { n: true, e: true, s: true, w: true },
        { floors: ['basement'] },
      );
      const foyerDef = canonical.tilesById['tile.foyer']!;
      const entranceDef = canonical.tilesById['tile.entrance_hall']!;
      const tiles = [
        startB,
        stairsDef,
        foyerDef,
        entranceDef,
        LAND_U,
        FILL_U,
        FILL_G,
        ANTI_SEAL,
      ];
      const house: House = {
        layout: [
          { tileId: canonical.house.startTile, floor: 'ground', x: 0, y: 0, rotation: 0 },
          { tileId: 'tile.foyer', floor: 'ground', x: 0, y: 1, rotation: 0 },
          { tileId: startB.id, floor: 'basement', x: 0, y: 0, rotation: 0 },
          { tileId: LAND_U.id, floor: 'upper', x: 0, y: 0, rotation: 0 },
        ],
        startTile: startB.id,
        landings: {
          basement: startB.id,
          ground: canonical.house.startTile,
          upper: LAND_U.id,
        },
      };
      const content = buildContent(
        {
          characters: canonical.characters,
          cards: canonical.cards,
          tiles,
          house,
        },
        'stairs-test',
      );

      const g = startedGame({ content });
      const seat = g.state.activeSeat!;

      let res = reduce(g.state, { t: 'MOVE_THROUGH', seat, dir: 'n' }, content);
      expect(res.error).toBeUndefined();
      if (res.state.pending?.kind === 'rotate_tile') {
        res = reduce(res.state, { t: 'ROTATE_TILE', seat, rotation: 0 }, content);
        expect(res.error).toBeUndefined();
      }

      const stairsPlacedId = res.state.players[seat]!.location!;
      const foyerPlacedId = res.state.board.index.ground['0,1']!;

      // Verify two-way connection between Stairs from Basement and Foyer
      const connectionsFromStairs = getConnections(res.state, stairsPlacedId, content);
      expect(connectionsFromStairs).toContain(foyerPlacedId);

      const connectionsFromFoyer = getConnections(res.state, foyerPlacedId, content);
      expect(connectionsFromFoyer).toContain(stairsPlacedId);
    });

    it('Basement route 3: Collapsed Room discovery roll and optional Jump to Basement action', () => {
      const canonical = fixtureContent();
      const colDef = canonical.tilesById['tile.collapsed_room']!;
      expect(colDef).toBeDefined();

      const start = dtile('tile.start', { n: true, e: true, s: true, w: true });
      const content = makeForcedDrawContent(start, colDef);
      const g = startedGame({ content });
      const seat = g.state.activeSeat!;

      let res = reduce(g.state, { t: 'MOVE_THROUGH', seat, dir: 'n' }, content);
      expect(res.error).toBeUndefined();
      if (res.state.pending?.kind === 'rotate_tile') {
        res = reduce(res.state, { t: 'ROTATE_TILE', seat, rotation: 0 }, content);
        expect(res.error).toBeUndefined();
      }

      // Verify Collapsed Room roll happened
      expect(
        res.events.some((e) => e.t === 'rolled' && e.reason.includes('Collapsed Room')),
      ).toBe(true);

      // Now test optional jump action from a player inside Collapsed Room
      const colPlacedId = placedIdFor('ground', 0, -1);
      // Force an explorer into Collapsed Room
      const standingInCol: GameState = {
        ...res.state,
        players: {
          ...res.state.players,
          [seat]: {
            ...res.state.players[seat]!,
            location: colPlacedId,
            movesLeft: 2,
          },
        },
        pending: null,
      };

      const legal = getLegalActions(standingInCol, seat, content);
      expect(
        legal.some(
          (a) => a.t === 'ROOM_ACTION' && a.actionId === 'action.collapsed_room.fall',
        ),
      ).toBe(true);

      // Perform the jump action
      const resJump = reduce(
        standingInCol,
        { t: 'ROOM_ACTION', seat, actionId: 'action.collapsed_room.fall' },
        content,
      );
      expect(resJump.error).toBeUndefined();
      const endLoc = resJump.state.players[seat]!.location;
      const endPlaced = resJump.state.board.placed[endLoc!];
      expect(endPlaced?.floor).toBe('basement');
    });

    it('Basement route 4: Mystic Elevator moves between floors', () => {
      const canonical = fixtureContent();
      const elevDef = canonical.tilesById['tile.mystic_elevator']!;
      expect(elevDef).toBeDefined();

      const start = dtile('tile.start', { n: true, e: true, s: true, w: true });
      const content = makeForcedDrawContent(start, elevDef);
      const g = startedGame({ content });
      const seat = g.state.activeSeat!;

      let res = reduce(g.state, { t: 'MOVE_THROUGH', seat, dir: 'n' }, content);
      expect(res.error).toBeUndefined();
      if (res.state.pending?.kind === 'rotate_tile') {
        res = reduce(res.state, { t: 'ROTATE_TILE', seat, rotation: 0 }, content);
        expect(res.error).toBeUndefined();
      }

      // Verify Mystic Elevator roll happened and clanks into motion
      expect(
        res.events.some((e) => e.t === 'rolled' && e.reason.includes('Mystic Elevator')),
      ).toBe(true);
      expect(
        res.events.some((e) => e.t === 'log' && e.text.includes('Mystic Elevator')),
      ).toBe(true);
    });
  });
});
