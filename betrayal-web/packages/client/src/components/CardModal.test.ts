import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { CardModal } from './CardModal.js';
import { DiceRollTray } from './DiceRollTray.js';
import { useStore } from '../store.js';
import { fixtureContent } from '@bahoth/content';

// Suppress act environment warnings in Node test environment
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('CardModal & DiceRollTray Hook Stability', () => {
  const content = fixtureContent();
  const sampleCard = content.cards[0]!;
  let activeRenderer: TestRenderer.ReactTestRenderer | null = null;

  beforeEach(() => {
    useStore.setState({
      content,
      activeCardDraw: null,
      activeRoll: null,
      presentationQueue: [],
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

  it('renders CardModal transitioning from null to active card draw without hook-order error', () => {
    // Initial render when no card draw is active (returns null)
    TestRenderer.act(() => {
      activeRenderer = TestRenderer.create(React.createElement(CardModal));
    });

    expect(activeRenderer!.toJSON()).toBeNull();

    // Transition to active card draw: must not throw "Rendered more hooks than during the previous render"
    TestRenderer.act(() => {
      useStore.setState({
        activeCardDraw: {
          seat: 'seat_0',
          deck: sampleCard.deck,
          cardId: sampleCard.id,
        },
        presentationQueue: [
          {
            kind: 'card_draw',
            draw: {
              seat: 'seat_0',
              deck: sampleCard.deck,
              cardId: sampleCard.id,
            },
          },
        ],
      });
    });

    expect(activeRenderer!.toJSON()).not.toBeNull();
  });

  it('renders DiceRollTray transitioning from null to active roll without hook-order error', () => {
    // Initial render when no roll is active (returns null)
    TestRenderer.act(() => {
      activeRenderer = TestRenderer.create(React.createElement(DiceRollTray));
    });

    expect(activeRenderer!.toJSON()).toBeNull();

    // Transition to active roll: must not throw hook-order error
    TestRenderer.act(() => {
      useStore.setState({
        activeRoll: {
          seat: 'seat_0',
          dice: [1, 2],
          total: 3,
          reason: 'might',
        },
        presentationQueue: [
          {
            kind: 'roll',
            roll: {
              seat: 'seat_0',
              dice: [1, 2],
              total: 3,
              reason: 'might',
            },
          },
        ],
      });
    });

    expect(activeRenderer!.toJSON()).not.toBeNull();
  });
});
