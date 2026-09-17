import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { useStore, handle } from './store.js';
import { InventoryTray } from './components/InventoryTray.js';
import { CardModal } from './components/CardModal.js';
import { DiceRollTray } from './components/DiceRollTray.js';
import { Board } from './board/Board.js';
import { fixtureContent, buildContent, type Tile, type House } from '@bahoth/content';
import { startedGame, reduce, makeRng } from '@bahoth/engine';
import {
  placedIdFor,
  cellKey,
  type GameState,
  type PlacedTile,
  type ServerMessage,
  type SeatId,
} from '@bahoth/shared';

// Suppress act environment warnings in Node test environment
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const canonical = fixtureContent();

function dtile(
  id: string,
  doors: { n?: boolean; e?: boolean; s?: boolean; w?: boolean },
  opts: Partial<Tile> = {},
): Tile {
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
const FILL_G = dtile('tile.fill_g', { n: true }, { floors: ['ground'] });
const DRAW_B = dtile('tile.draw_b', { n: true }, { floors: ['basement'] });
const DRAW_U = dtile('tile.draw_u', { n: true }, { floors: ['upper'] });
const DRAW_G = dtile('tile.draw_g', { n: true }, { floors: ['ground'] });

describe('Task 8: Player-Visible Room Regression Journey & UI Integration', () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null;

  beforeEach(() => {
    useStore.setState({
      content: canonical,
      state: null,
      seatId: 'seat_0',
      activeCardDraw: null,
      activeRoll: null,
      presentationQueue: [],
      selectedTileId: null,
    });
  });

  afterEach(() => {
    if (renderer) {
      TestRenderer.act(() => {
        renderer?.unmount();
      });
      renderer = null;
    }
  });

  describe('Special Tile concise ruleText UI rendering (current and selected)', () => {
    const specialTilesWithRuleText = canonical.tiles.filter((t) => Boolean(t.ruleText));

    it('finds all 19 special tiles with ruleText in content', () => {
      expect(specialTilesWithRuleText.length).toBe(19);
    });

    specialTilesWithRuleText.forEach((tileDef) => {
      it(`renders concise ruleText for ${tileDef.name} (${tileDef.id}) when room is current`, () => {
        const g = startedGame({ content: canonical });
        const seat = 'seat_0' as SeatId;
        const floor = tileDef.floors[0]!;
        const placedId = placedIdFor(floor, 5, 5);
        const placedTile: PlacedTile = {
          id: placedId,
          tileId: tileDef.id,
          floor,
          x: 5,
          y: 5,
          rotation: 0,
          flags: {},
          droppedItems: [],
        };

        const state: GameState = {
          ...g.state,
          activeSeat: seat,
          board: {
            ...g.state.board,
            placed: {
              ...g.state.board.placed,
              [placedId]: placedTile,
            },
            index: {
              ...g.state.board.index,
              [floor]: {
                ...g.state.board.index[floor],
                [cellKey(5, 5)]: placedId,
              },
            },
          },
          players: {
            ...g.state.players,
            [seat]: {
              ...g.state.players[seat]!,
              location: placedId,
            },
          },
        };

        useStore.setState({ state, seatId: seat, selectedTileId: null });

        TestRenderer.act(() => {
          renderer = TestRenderer.create(React.createElement(InventoryTray));
        });

        const root = renderer!.root;
        const ruleTextElement = root.findByProps({ 'data-testid': 'room-rule-text' });
        expect(ruleTextElement).toBeDefined();
        expect(ruleTextElement.props.children).toBe(tileDef.ruleText);
      });

      it(`renders concise ruleText for ${tileDef.name} (${tileDef.id}) when room is selected on board`, () => {
        const g = startedGame({ content: canonical });
        const seat = 'seat_0' as SeatId;
        const floor = tileDef.floors[0]!;
        const currentPlacedId = g.state.board.index.ground['0,0']!;
        const selectedPlacedId = placedIdFor(floor, 6, 6);
        const placedTile: PlacedTile = {
          id: selectedPlacedId,
          tileId: tileDef.id,
          floor,
          x: 6,
          y: 6,
          rotation: 0,
          flags: {},
          droppedItems: [],
        };

        const state: GameState = {
          ...g.state,
          activeSeat: seat,
          board: {
            ...g.state.board,
            placed: {
              ...g.state.board.placed,
              [selectedPlacedId]: placedTile,
            },
            index: {
              ...g.state.board.index,
              [floor]: {
                ...g.state.board.index[floor],
                [cellKey(6, 6)]: selectedPlacedId,
              },
            },
          },
          players: {
            ...g.state.players,
            [seat]: {
              ...g.state.players[seat]!,
              location: currentPlacedId,
            },
          },
        };

        // Explorer is at currentPlacedId, but user clicked/selected this special room
        useStore.setState({ state, seatId: seat, selectedTileId: selectedPlacedId });

        TestRenderer.act(() => {
          renderer = TestRenderer.create(React.createElement(InventoryTray));
        });

        const root = renderer!.root;
        const ruleTextElement = root.findByProps({ 'data-testid': 'room-rule-text' });
        expect(ruleTextElement).toBeDefined();
        expect(ruleTextElement.props.children).toBe(tileDef.ruleText);
      });
    });
  });

  describe('Client Store / Component Integration for Special Room Mechanics', () => {
    it('Exit roll integration (Junk Room): failure loses 1 Speed and completes move', () => {
      const junkDef = canonical.tilesById['tile.junk_room']!;
      const destTile = dtile('tile.dest', { n: true }); // dest at (0, 1), door north connects to junk door south
      const house: House = {
        layout: [
          { tileId: junkDef.id, floor: 'ground', x: 0, y: 0, rotation: 0 },
          { tileId: destTile.id, floor: 'ground', x: 0, y: 1, rotation: 0 },
          { tileId: LAND_B.id, floor: 'basement', x: 0, y: 0, rotation: 0 },
          { tileId: LAND_U.id, floor: 'upper', x: 0, y: 0, rotation: 0 },
        ],
        startTile: junkDef.id,
        landings: { basement: LAND_B.id, ground: junkDef.id, upper: LAND_U.id },
      };

      const content = buildContent(
        {
          characters: fixtureContent().characters,
          cards: fixtureContent().cards,
          tiles: [junkDef, destTile, LAND_B, LAND_U, DRAW_B, DRAW_U, DRAW_G],
          house,
        },
        'junk-integration-test',
      );

      const g = startedGame({ content });
      const seat = g.state.activeSeat!;
      const junkPlacedId = g.state.board.index.ground['0,0']!;
      const destPlacedId = g.state.board.index.ground['0,1']!;

      // Seed 7 fails Might roll (< 3)
      const state: GameState = {
        ...g.state,
        rng: makeRng(7),
        players: {
          ...g.state.players,
          [seat]: {
            ...g.state.players[seat]!,
            location: junkPlacedId,
            movesLeft: 3,
          },
        },
      };

      const initialSpeed = state.players[seat]!.traits.speed;

      // Move from Junk Room to destination
      const res = reduce(state, { t: 'MOVE', seat, to: destPlacedId }, content);
      expect(res.error).toBeUndefined();

      // Roll failed
      const rolled = res.events.find((e) => e.t === 'rolled') as
        { t: 'rolled'; total: number } | undefined;
      expect(rolled?.total).toBeLessThan(3);

      // Trait decreased by 1
      expect(res.state.players[seat]!.traits.speed).toBe(initialSpeed - 1);
      // Explorer completed move
      expect(res.state.players[seat]!.location).toBe(destPlacedId);

      // Verify UI renders cleanly with updated state
      useStore.setState({ state: res.state, seatId: seat });
      TestRenderer.act(() => {
        renderer = TestRenderer.create(React.createElement(InventoryTray));
      });
      expect(renderer!.toJSON()).toBeDefined();
    });

    it('Barrier crossing failure integration (Chasm): failure stops movement at 0 movesLeft on entry side without trait loss', () => {
      const chasmDef = canonical.tilesById['tile.chasm']!;
      const startTile = dtile('tile.start_b', { e: true }, { floors: ['basement'] });
      const oppTile = dtile('tile.opp_b', { w: true }, { floors: ['basement'] });
      const house: House = {
        layout: [
          { tileId: startTile.id, floor: 'basement', x: 0, y: 0, rotation: 0 },
          { tileId: chasmDef.id, floor: 'basement', x: 1, y: 0, rotation: 0 }, // chasm at (1, 0)
          { tileId: oppTile.id, floor: 'basement', x: 2, y: 0, rotation: 0 }, // opposite at (2, 0)
          { tileId: LAND_U.id, floor: 'upper', x: 0, y: 0, rotation: 0 },
          { tileId: FILL_G.id, floor: 'ground', x: 0, y: 0, rotation: 0 },
        ],
        startTile: FILL_G.id,
        landings: { basement: startTile.id, ground: FILL_G.id, upper: LAND_U.id },
      };

      const content = buildContent(
        {
          characters: fixtureContent().characters,
          cards: fixtureContent().cards,
          tiles: [startTile, chasmDef, oppTile, LAND_U, FILL_G, DRAW_B, DRAW_U, DRAW_G],
          house,
        },
        'chasm-integration-test',
      );

      const g = startedGame({ content });
      const seat = g.state.activeSeat!;
      const startPlacedId = g.state.board.index.basement['0,0']!;
      const chasmPlacedId = g.state.board.index.basement['1,0']!;
      const oppPlacedId = g.state.board.index.basement['2,0']!;

      // Player entered Chasm through west doorway from startTile
      // Seed 0 gives roll total 0 (< 3, failure)
      const state: GameState = {
        ...g.state,
        rng: makeRng(0),
        players: {
          ...g.state.players,
          [seat]: {
            ...g.state.players[seat]!,
            location: chasmPlacedId,
            cameFrom: startPlacedId,
            movesLeft: 3,
          },
        },
      };

      const initialSpeed = state.players[seat]!.traits.speed;

      // Crossing eastward to opposite room across the barrier requires Speed 3+
      const res = reduce(state, { t: 'MOVE', seat, to: oppPlacedId }, content);
      expect(res.error).toBeUndefined();

      // Roll failed
      const rolled = res.events.find((e) => e.t === 'rolled') as
        { t: 'rolled'; total: number } | undefined;
      expect(rolled?.total).toBeLessThan(3);

      // Remains in Chasm with 0 movesLeft
      expect(res.state.players[seat]!.location).toBe(chasmPlacedId);
      expect(res.state.players[seat]!.movesLeft).toBe(0);
      // Speed trait is unchanged
      expect(res.state.players[seat]!.traits.speed).toBe(initialSpeed);

      // Verify client store integration
      useStore.setState({ state: res.state, seatId: seat });
      TestRenderer.act(() => {
        renderer = TestRenderer.create(React.createElement(InventoryTray));
      });
      expect(renderer!.toJSON()).toBeDefined();
    });

    it('End-turn damage prompt integration (Furnace Room): raises choose_trait prompt, damages chosen physical trait, and advances turn', () => {
      const furnaceDef = canonical.tilesById['tile.furnace_room']!;
      const house: House = {
        layout: [
          { tileId: furnaceDef.id, floor: 'basement', x: 0, y: 0, rotation: 0 },
          { tileId: LAND_U.id, floor: 'upper', x: 0, y: 0, rotation: 0 },
          { tileId: FILL_G.id, floor: 'ground', x: 0, y: 0, rotation: 0 },
        ],
        startTile: FILL_G.id,
        landings: { basement: furnaceDef.id, ground: FILL_G.id, upper: LAND_U.id },
      };

      const content = buildContent(
        {
          characters: fixtureContent().characters,
          cards: fixtureContent().cards,
          tiles: [furnaceDef, LAND_U, FILL_G, DRAW_B, DRAW_U, DRAW_G],
          house,
        },
        'furnace-integration-test',
      );

      const g = startedGame({ content });
      const seat = g.state.activeSeat!;
      const furnacePlacedId = g.state.board.index.basement['0,0']!;

      const state: GameState = {
        ...g.state,
        players: {
          ...g.state.players,
          [seat]: {
            ...g.state.players[seat]!,
            location: furnacePlacedId,
          },
        },
      };

      const initialMight = state.players[seat]!.traits.might;

      // 1. Player calls END_TURN: raises choose_trait prompt for speed/might
      const resEnd = reduce(state, { t: 'END_TURN', seat }, content);
      expect(resEnd.error).toBeUndefined();
      expect(resEnd.state.pending).toBeDefined();
      expect(resEnd.state.pending?.kind).toBe('choose_trait');

      // 2. Player answers prompt choosing might
      const resAnswer = reduce(
        resEnd.state,
        {
          t: 'ANSWER',
          seat,
          promptId: resEnd.state.pending!.id,
          answer: 'might',
        },
        content,
      );
      expect(resAnswer.error).toBeUndefined();
      expect(resAnswer.state.pending).toBeNull();
      // Might decreased by 1
      expect(resAnswer.state.players[seat]!.traits.might).toBe(initialMight - 1);
      // Turn advanced to next player
      expect(resAnswer.state.activeSeat).not.toBe(seat);

      // Verify client store integration
      useStore.setState({ state: resAnswer.state, seatId: seat });
      TestRenderer.act(() => {
        renderer = TestRenderer.create(React.createElement(InventoryTray));
      });
      expect(renderer!.toJSON()).toBeDefined();
    });

    it('Optional room action integration (The Vault): opens vault on Knowledge 6+, adds 2 items to inventory, and disappears from legal actions', () => {
      const vaultDef = canonical.tilesById['tile.the_vault']!;
      const house: House = {
        layout: [
          { tileId: vaultDef.id, floor: 'upper', x: 0, y: 0, rotation: 0 },
          { tileId: LAND_B.id, floor: 'basement', x: 0, y: 0, rotation: 0 },
          { tileId: FILL_G.id, floor: 'ground', x: 0, y: 0, rotation: 0 },
        ],
        startTile: FILL_G.id,
        landings: { basement: LAND_B.id, ground: FILL_G.id, upper: vaultDef.id },
      };

      const content = buildContent(
        {
          characters: fixtureContent().characters,
          cards: fixtureContent().cards,
          tiles: [vaultDef, LAND_B, FILL_G, DRAW_B, DRAW_U, DRAW_G],
          house,
        },
        'vault-integration-test',
      );

      const g = startedGame({ content });
      const seat = g.state.activeSeat!;
      const vaultPlacedId = g.state.board.index.upper['0,0']!;

      // Seed 31 rolls >= 6 on 4 Knowledge dice
      const state: GameState = {
        ...g.state,
        rng: makeRng(31),
        players: {
          ...g.state.players,
          [seat]: {
            ...g.state.players[seat]!,
            location: vaultPlacedId,
          },
        },
      };

      // 1. Initial state: InventoryTray renders "Open Vault" button
      useStore.setState({ state, seatId: seat, content });
      TestRenderer.act(() => {
        renderer = TestRenderer.create(React.createElement(InventoryTray));
      });
      const rootBefore = renderer!.root;
      const vaultButton = rootBefore
        .findAllByType('button')
        .find((b) => b.props.children === 'Open Vault');
      expect(vaultButton).toBeDefined();

      // 2. Perform action
      const res = reduce(
        state,
        { t: 'ROOM_ACTION', seat, actionId: 'action.the_vault.open' },
        content,
      );
      expect(res.error).toBeUndefined();
      expect(res.state.board.placed[vaultPlacedId]!.flags['vault_empty']).toBe(true);
      expect(res.state.players[seat]!.items.length).toBe(
        state.players[seat]!.items.length + 2,
      );

      // 3. Update UI with result: "Open Vault" button must be gone
      useStore.setState({ state: res.state, seatId: seat, content });
      TestRenderer.act(() => {
        renderer = TestRenderer.create(React.createElement(InventoryTray));
      });
      const rootAfter = renderer!.root;
      const vaultButtonAfter = rootAfter
        .findAllByType('button')
        .find((b) => b.props.children === 'Open Vault');
      expect(vaultButtonAfter).toBeUndefined();
    });
  });

  describe('Modal / Tray Hook Stability and Presentation Ordering', () => {
    it('maintains ordered presentation transitions (card reveal -> roll) without hook crashes', () => {
      const msg: ServerMessage = {
        t: 'events',
        events: [
          {
            t: 'drew_card',
            seat: 'seat_0',
            deck: 'event',
            cardId: 'event.creepy_crawlies',
          },
          {
            t: 'rolled',
            seat: 'seat_0',
            dice: [2, 1, 1],
            total: 4,
            reason: 'Sanity Roll',
          },
        ],
      };

      handle(msg, useStore.setState, useStore.getState);

      // Step 1: CardModal is active
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          React.createElement(
            'div',
            { id: 'root' },
            React.createElement(CardModal),
            React.createElement(DiceRollTray),
          ),
        );
      });
      expect(renderer!.toJSON()).toBeDefined();

      // Step 2: Dismiss card draw -> DiceRollTray becomes active
      TestRenderer.act(() => {
        useStore.getState().dismissCardDraw();
      });
      expect(useStore.getState().activeRoll).toBeDefined();
      expect(useStore.getState().activeRoll?.total).toBe(4);
      expect(renderer!.toJSON()).toBeDefined();

      // Step 3: Dismiss roll -> both trays are clear
      TestRenderer.act(() => {
        useStore.getState().dismissRoll();
      });
      expect(useStore.getState().activeRoll).toBeNull();
      expect(useStore.getState().activeCardDraw).toBeNull();
      expect(renderer!.toJSON()).toBeDefined();
    });

    it('renders player-facing isolation notice when viewing unexplored Basement Landing', () => {
      const g = startedGame({ content: canonical });
      useStore.setState({ state: g.state, seatId: g.state.activeSeat! });

      let renderer: TestRenderer.ReactTestRenderer | undefined;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          React.createElement(Board, {
            board: g.state.board,
            content: canonical,
            floor: 'basement',
            pawns: [],
            reachable: [],
          }),
        );
      });

      const tree = renderer!.toJSON();
      expect(JSON.stringify(tree)).toContain(
        'The Basement cannot be reached via Grand Staircase',
      );
    });
  });
});
