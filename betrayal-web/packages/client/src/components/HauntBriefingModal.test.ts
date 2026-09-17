import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { HauntBriefingModal } from './HauntBriefingModal.js';
import { HauntBanner } from './HauntBanner.js';
import { useStore } from '../store.js';
import { fixtureContent } from '@bahoth/content';
import type { GameState, HauntBriefing } from '@bahoth/shared';

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('HauntBriefingModal & HauntBanner (Task 11)', () => {
  const content = fixtureContent();
  let activeRenderer: TestRenderer.ReactTestRenderer | null = null;
  const mockSend = vi.fn();

  const mockHeroBriefing: HauntBriefing = {
    hauntId: 1,
    title: 'The Mummy Walks',
    role: 'hero',
    side: {
      goal: 'Banish the Mummy to eternal sleep.',
      rules: ['Search rooms for the sacred amulet.'],
      win: [],
      intro: 'A dusty tomb opens before you.',
      rightNow: ['Place the Sarcophagus in the room.'],
      whatYouKnow: ['The Mummy is slow but impervious to normal attacks.'],
      winWhen: ['The amulet is placed inside the sarcophagus.'],
      specialAttackRules: ['Mummy cannot be attacked with Speed.'],
      ifYouWin: ['The house grows silent as the curse lifts.'],
      additionalSections: [
        {
          title: 'The Sacred Relic',
          bullets: ['Amulet takes 1 Knowledge check to activate.'],
        },
      ],
    },
  };

  const mockTraitorBriefing: HauntBriefing = {
    hauntId: 1,
    title: 'The Mummy Walks',
    role: 'traitor',
    side: {
      goal: 'Awaken the ancient Pharaoh to consume the heroes.',
      rules: ['Command the Mummy on your turn.'],
      win: [],
      intro: 'The ancient powers flow through you.',
      rightNow: ['Take control of the Mummy pawn.'],
      whatYouKnow: ['The heroes seek the sacred amulet.'],
      winWhen: ['All heroes are dead.'],
    },
  };

  const createHauntState = (overrides?: Partial<GameState>): GameState => ({
    version: 1,
    contentHash: content.hash,
    phase: 'haunt',
    players: {
      seat_0: {
        seatId: 'seat_0',
        name: 'Traitor player',
        charId: 'char.ox_bellows',
        traits: { speed: 4, might: 5, sanity: 3, knowledge: 3 },
        location: 'ground:0,0',
        movesLeft: 0,
        cameFrom: null,
        items: [],
        omens: [],
        isTraitor: true,
        isDead: false,
        connected: true,
        disconnectedAt: null,
        removed: false,
        hasAttackedThisTurn: false,
        flags: {},
      },
      seat_1: {
        seatId: 'seat_1',
        name: 'Hero player',
        charId: 'char.zoe_ingstrom',
        traits: { speed: 4, might: 3, sanity: 5, knowledge: 4 },
        location: 'ground:0,0',
        movesLeft: 0,
        cameFrom: null,
        items: [],
        omens: [],
        isTraitor: false,
        isDead: false,
        connected: true,
        disconnectedAt: null,
        removed: false,
        hasAttackedThisTurn: false,
        flags: {},
      },
    },
    turnOrder: ['seat_0', 'seat_1'],
    activeSeat: 'seat_0',
    round: 1,
    timers: { turnBudgetMs: 180000, removeGraceMs: 60000 },
    removeVotes: {},
    turnDeadline: null,
    board: { placed: {}, index: { basement: {}, ground: {}, upper: {} } },
    decks: {
      item: { draw: [], discard: [], inPlay: [] },
      event: { draw: [], discard: [], inPlay: [] },
      omen: { draw: [], discard: [], inPlay: [] },
    },
    tileDeck: [],
    tileDiscard: [],
    omensDrawn: 6,
    pending: null,
    monsters: {},
    tokens: [],
    haunt: {
      hauntId: 1,
      traitorSeat: 'seat_0',
      revealed: true,
      acknowledged: [],
      briefing: mockHeroBriefing,
    },
    ...overrides,
  });

  beforeEach(() => {
    mockSend.mockClear();
    useStore.setState({
      content,
      seatId: 'seat_1',
      send: mockSend,
      isBriefingOpen: false,
      activeCardDraw: null,
      activeRoll: null,
      state: createHauntState(),
    });
  });

  afterEach(() => {
    if (activeRenderer) {
      TestRenderer.act(() => {
        activeRenderer?.unmount();
      });
      activeRenderer = null;
    }
  });

  it('renders hero briefing with all structured sections and handles Ready action', () => {
    TestRenderer.act(() => {
      activeRenderer = TestRenderer.create(React.createElement(HauntBriefingModal));
    });

    const root = activeRenderer!.root;
    expect(
      root.findByProps({ className: 'haunt-briefing-modal__badge' }).children,
    ).toContain('🛡️ SECRETS OF SURVIVAL');
    expect(
      root.findByProps({ className: 'haunt-briefing-modal__title' }).children.join(''),
    ).toContain('Haunt #1: The Mummy Walks');
    expect(
      root.findByProps({ className: 'haunt-briefing-modal__goal' }).children.join(''),
    ).toContain('Banish the Mummy to eternal sleep.');

    // Sections rendered
    const text = JSON.stringify(activeRenderer!.toJSON());
    expect(text).toContain('A dusty tomb opens before you.');
    expect(text).toContain('Place the Sarcophagus in the room.');
    expect(text).toContain('The Mummy is slow but impervious to normal attacks.');
    expect(text).toContain('The amulet is placed inside the sarcophagus.');
    expect(text).toContain('Mummy cannot be attacked with Speed.');
    expect(text).toContain('The house grows silent as the curse lifts.');
    expect(text).toContain('The Sacred Relic');
    expect(text).toContain('Amulet takes 1 Knowledge check to activate.');

    // Click Ready
    const readyBtn = root.findByProps({ className: 'btn btn--primary btn--large' });
    expect(readyBtn.children).toContain('Ready / Close Briefing');

    TestRenderer.act(() => {
      readyBtn.props.onClick();
    });

    expect(mockSend).toHaveBeenCalledWith({
      t: 'ACK_HAUNT_BRIEFING',
      seat: 'seat_1',
    });
  });

  it('renders traitor tome for traitor player', () => {
    const traitorState = createHauntState();
    traitorState.haunt!.briefing = mockTraitorBriefing;

    useStore.setState({
      seatId: 'seat_0',
      state: traitorState,
    });

    TestRenderer.act(() => {
      activeRenderer = TestRenderer.create(React.createElement(HauntBriefingModal));
    });

    const root = activeRenderer!.root;
    expect(
      root.findByProps({ className: 'haunt-briefing-modal__badge' }).children,
    ).toContain("💀 TRAITOR'S TOME");
    const text = JSON.stringify(activeRenderer!.toJSON());
    expect(text).toContain('Awaken the ancient Pharaoh to consume the heroes.');
    expect(text).toContain('Command the Mummy on your turn.');
    // Zero hero text
    expect(text).not.toContain('Banish the Mummy');
    expect(text).not.toContain('A dusty tomb opens');
  });

  it('closes when already acknowledged and reopens on persistent button click', () => {
    const ackState = createHauntState();
    ackState.haunt!.acknowledged = ['seat_1'];

    useStore.setState({
      seatId: 'seat_1',
      state: ackState,
      isBriefingOpen: false,
    });

    // 1. Initial render when already acknowledged: modal is closed (null)
    TestRenderer.act(() => {
      activeRenderer = TestRenderer.create(React.createElement(HauntBriefingModal));
    });
    expect(activeRenderer!.toJSON()).toBeNull();

    // 2. Open briefing via store (persistent button clicked)
    TestRenderer.act(() => {
      useStore.getState().openBriefing();
    });

    expect(activeRenderer!.toJSON()).not.toBeNull();
    const root = activeRenderer!.root;
    const closeBtn = root.findByProps({ className: 'btn btn--ghost btn--large' });
    expect(closeBtn.children).toContain('Close Briefing');

    // Clicking Close does NOT resend ACK_HAUNT_BRIEFING
    TestRenderer.act(() => {
      closeBtn.props.onClick();
    });
    expect(mockSend).not.toHaveBeenCalled();
    expect(useStore.getState().isBriefingOpen).toBe(false);
  });

  it('HauntBanner renders persistent reopen button and readiness indicator', () => {
    TestRenderer.act(() => {
      activeRenderer = TestRenderer.create(React.createElement(HauntBanner));
    });

    const root = activeRenderer!.root;
    // Readiness status shown when pending
    const readiness = root.findByProps({ className: 'haunt-banner__readiness-status' });
    expect(readiness.children.join('')).toContain(
      'Waiting for all players to read briefing',
    );
    expect(readiness.children.join('')).toContain('0/2 Ready');

    // Persistent reopen button
    const bookBtn = root.findByProps({
      className: 'btn btn--secondary btn--small haunt-banner__book-btn',
    });
    expect(bookBtn.children).toContain('📖 Survival Book');

    // Click reopen button
    TestRenderer.act(() => {
      bookBtn.props.onClick();
    });
    expect(useStore.getState().isBriefingOpen).toBe(true);
  });

  it('modal does not collide when card draw or roll is active', () => {
    // Set card draw active
    useStore.setState({
      activeCardDraw: {
        seat: 'seat_1',
        deck: 'omen',
        cardId: 'card.ring',
      },
    });

    TestRenderer.act(() => {
      activeRenderer = TestRenderer.create(React.createElement(HauntBriefingModal));
    });

    // Must return null while card modal is presenting
    expect(activeRenderer!.toJSON()).toBeNull();
  });
});
