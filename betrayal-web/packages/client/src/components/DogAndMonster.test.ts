import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { DogCommandModal } from './DogCommandModal.js';
import { MonsterPhasePanel } from './MonsterPhasePanel.js';
import { InventoryTray } from './InventoryTray.js';
import { useStore } from '../store.js';
import { fixtureContent } from '@bahoth/content';
import type { GameState } from '@bahoth/shared';

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('Dog Companion UI & Monster Phase Panel (Task 12)', () => {
  const content = fixtureContent();
  let activeRenderer: TestRenderer.ReactTestRenderer | null = null;
  const mockSend = vi.fn();

  const createBaseState = (): GameState => ({
    version: 1,
    contentHash: content.hash,
    phase: 'haunt',
    round: 2,
    activeSeat: 'seat_0',
    turnOrder: ['seat_0', 'seat_1', 'seat_2'],
    turnDeadline: null,
    hauntRollCount: 6,
    haunt: {
      hauntId: 1,
      traitorSeat: 'seat_1',
      revealed: true,
      acknowledged: ['seat_0', 'seat_1', 'seat_2'],
    },
    players: {
      seat_0: {
        seatId: 'seat_0',
        charId: 'char_0',
        name: 'Hero Explorer',
        traits: { speed: 3, might: 3, sanity: 3, knowledge: 3 },
        movesLeft: 3,
        location: 'f_ground_0_0',
        items: ['item.revolver'],
        omens: ['omen.dog'],
        isDead: false,
        isTraitor: false,
        usedCardsThisTurn: [],
        hasAttackedThisTurn: false,
        flags: {},
      },
      seat_1: {
        seatId: 'seat_1',
        charId: 'char_1',
        name: 'Traitor Leader',
        traits: { speed: 3, might: 4, sanity: 4, knowledge: 3 },
        movesLeft: 0,
        location: 'f_ground_0_0',
        items: [],
        omens: [],
        isDead: false,
        isTraitor: true,
        usedCardsThisTurn: [],
        hasAttackedThisTurn: false,
        flags: {},
      },
      seat_2: {
        seatId: 'seat_2',
        charId: 'char_2',
        name: 'Victim Hero',
        traits: { speed: 2, might: 2, sanity: 2, knowledge: 2 },
        movesLeft: 0,
        location: 'f_ground_0_1',
        items: [],
        omens: [],
        isDead: false,
        isTraitor: false,
        usedCardsThisTurn: [],
        hasAttackedThisTurn: false,
        flags: {},
      },
    },
    board: {
      placed: {
        f_ground_0_0: {
          tileId: 'tile.entrance_hall',
          floor: 'ground',
          x: 0,
          y: 0,
          rotation: 0,
          discoveredBy: 'seat_0',
          droppedItems: [],
        },
        f_ground_0_1: {
          tileId: 'tile.foyer',
          floor: 'ground',
          x: 0,
          y: 1,
          rotation: 0,
          discoveredBy: 'seat_0',
          droppedItems: ['item.healing_salve'],
        },
      },
      index: {
        ground: { '0,0': 'f_ground_0_0', '0,1': 'f_ground_0_1' },
        upper: {},
        basement: {},
        roof: {},
      },
      tileDeck: [],
      discard: [],
    },
    decks: {
      item: { draw: [], discard: [] },
      event: { draw: [], discard: [] },
      omen: { draw: [], discard: [] },
    },
    roll: null,
    pending: null,
    removeVotes: {},
    flags: {},
    log: [],
    monsters: {
      'monster.mummy': {
        id: 'monster.mummy',
        def: 'The Mummy',
        location: 'f_ground_0_1',
        isDead: false,
        flags: { might: 5, speed: 2, stunned: false },
      },
    },
    monsterTurn: null,
  });

  beforeEach(() => {
    mockSend.mockReset();
    useStore.setState({
      content,
      seatId: 'seat_0',
      send: mockSend,
      pendingSeq: null,
      selectedTileId: null,
    });
  });

  afterEach(() => {
    if (activeRenderer) {
      act(() => {
        activeRenderer?.unmount();
      });
      activeRenderer = null;
    }
  });

  describe('Dog Companion UI Integration', () => {
    it('renders Command Dog button in InventoryTray for dog owner when unused this turn', () => {
      const state = createBaseState();
      useStore.setState({ state, seatId: 'seat_0' });

      act(() => {
        activeRenderer = TestRenderer.create(React.createElement(InventoryTray));
      });

      const root = activeRenderer!.root;
      const dogBtn = root.findAllByProps({ 'data-testid': 'command-dog-btn' });
      expect(dogBtn.length).toBe(1);
      expect(dogBtn[0]!.children).toContain('🐶 Sai Chó (Command)');
    });

    it('shows already-used indicator when dog_used_this_turn is set', () => {
      const state = createBaseState();
      state.players['seat_0']!.flags['dog_used_this_turn'] = true;
      useStore.setState({ state, seatId: 'seat_0' });

      act(() => {
        activeRenderer = TestRenderer.create(React.createElement(InventoryTray));
      });

      const root = activeRenderer!.root;
      const dogBtn = root.findAllByProps({ 'data-testid': 'command-dog-btn' });
      expect(dogBtn.length).toBe(0);

      const buttons = root.findAllByType('button');
      const usedBtn = buttons.find((b) => b.children.includes('⏳ Chó đã đi lượt này'));
      expect(usedBtn).toBeDefined();
    });

    it('dispatches COMMAND_DOG with destination and items in DogCommandModal', () => {
      const state = createBaseState();
      useStore.setState({ state, seatId: 'seat_0' });

      let modalOpen = true;
      act(() => {
        activeRenderer = TestRenderer.create(
          React.createElement(DogCommandModal, {
            isOpen: modalOpen,
            onClose: () => {
              modalOpen = false;
            },
          }),
        );
      });

      const root = activeRenderer!.root;
      const destSelect = root.findByProps({ 'data-testid': 'dog-dest-select' });

      // Select destination room
      act(() => {
        destSelect.props.onChange({ target: { value: 'f_ground_0_1' } });
      });

      // Click "Mang vật phẩm đến" (carry)
      const buttons = root.findAllByType('button');
      const carryBtn = buttons.find((b) =>
        b.children.some((c) => typeof c === 'string' && c.includes('Mang vật phẩm đến')),
      );
      expect(carryBtn).toBeDefined();

      act(() => {
        carryBtn!.props.onClick();
      });

      // Select item to carry
      const carrySelect = root.findByProps({ 'data-testid': 'dog-carry-select' });
      act(() => {
        carrySelect.props.onChange({ target: { value: 'item.revolver' } });
      });

      // Click submit
      const confirmBtn = root.findByProps({ 'data-testid': 'dog-confirm-btn' });
      act(() => {
        confirmBtn.props.onClick();
      });

      expect(mockSend).toHaveBeenCalledWith({
        t: 'COMMAND_DOG',
        seat: 'seat_0',
        destination: 'f_ground_0_1',
        carryCardId: 'item.revolver',
      });
      expect(modalOpen).toBe(false);
    });
  });

  describe('Monster Phase Panel Integration', () => {
    it('renders hero view banner when monster phase is active under traitor control', () => {
      const state = createBaseState();
      state.monsterTurn = {
        activeMonsterId: 'monster.mummy',
        actedMonsterIds: [],
        movesLeft: 2,
        hasAttacked: false,
        rolledSpeed: 2,
        controllingSeat: 'seat_1',
      };
      useStore.setState({ state, seatId: 'seat_0' }); // Hero viewer

      act(() => {
        activeRenderer = TestRenderer.create(React.createElement(MonsterPhasePanel));
      });

      const text = JSON.stringify(activeRenderer!.toJSON());
      expect(text).toContain('MONSTER PHASE');
      expect(text).toContain('Commanded by Traitor Leader');
      expect(text).toContain('The Mummy');
    });

    it('renders traitor controller view with activation buttons and attack options', () => {
      const state = createBaseState();
      state.monsterTurn = {
        activeMonsterId: null,
        actedMonsterIds: [],
        movesLeft: 0,
        hasAttacked: false,
        rolledSpeed: null,
        controllingSeat: 'seat_1',
      };
      useStore.setState({ state, seatId: 'seat_1' }); // Traitor controller

      act(() => {
        activeRenderer = TestRenderer.create(React.createElement(MonsterPhasePanel));
      });

      const root = activeRenderer!.root;
      const buttons = root.findAllByType('button');
      const startBtn = buttons.find((b) =>
        b.children.some((c) => typeof c === 'string' && c.includes('Kích hoạt')),
      );
      expect(startBtn).toBeDefined();

      // Click start monster turn
      act(() => {
        startBtn!.props.onClick();
      });

      expect(mockSend).toHaveBeenCalledWith({
        t: 'START_MONSTER',
        seat: 'seat_1',
        monsterId: 'monster.mummy',
      });

      // Now test active monster view with hero attack
      const activeState = {
        ...state,
        monsterTurn: {
          activeMonsterId: 'monster.mummy',
          actedMonsterIds: [],
          movesLeft: 2,
          hasAttacked: false,
          rolledSpeed: 2,
          controllingSeat: 'seat_1',
        },
      };
      act(() => {
        useStore.setState({ state: activeState, seatId: 'seat_1' });
        activeRenderer!.update(React.createElement(MonsterPhasePanel));
      });

      const activeRoot = activeRenderer!.root;
      const attackHeroBtn = activeRoot.findByProps({
        'data-testid': 'monster-attack-btn',
      });
      expect(attackHeroBtn).toBeDefined();

      // Attack hero in room
      act(() => {
        attackHeroBtn!.props.onClick();
      });

      expect(mockSend).toHaveBeenCalledWith({
        t: 'MONSTER_ATTACK',
        seat: 'seat_1',
        monsterId: 'monster.mummy',
        target: { kind: 'seat', seatId: 'seat_2' },
      });

      // End monster turn
      const endTurnBtn = activeRoot.findByProps({
        'data-testid': 'end-monster-turn-btn',
      });
      act(() => {
        endTurnBtn.props.onClick();
      });

      expect(mockSend).toHaveBeenCalledWith({
        t: 'END_MONSTER_TURN',
        seat: 'seat_1',
        monsterId: 'monster.mummy',
      });
    });
  });
});
