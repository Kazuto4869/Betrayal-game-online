import { describe, expect, it, beforeEach } from 'vitest';
import { useStore, handle } from './store.js';
import type { ServerMessage } from '@bahoth/shared';

describe('Task 7: Presentation Queue in Client Store', () => {
  beforeEach(() => {
    useStore.setState({
      presentationQueue: [],
      activeCardDraw: null,
      activeRoll: null,
      log: [],
    });
  });

  it('queues card reveal -> card effect roll -> haunt roll in order without overwriting', () => {
    const msg: ServerMessage = {
      t: 'events',
      events: [
        { t: 'drew_card', seat: 'seat_0', deck: 'omen', cardId: 'omen.bite' },
        { t: 'rolled', seat: 'seat_0', dice: [1, 2, 0], total: 3, reason: 'might' },
        {
          t: 'rolled',
          seat: 'seat_0',
          dice: [1, 1, 2, 1, 0, 1],
          total: 6,
          reason: 'haunt_roll',
        },
        { t: 'haunt_roll', total: 6, needed: 1, triggered: false },
      ],
    };

    handle(msg, useStore.setState, useStore.getState);

    const s1 = useStore.getState();
    // 3 presentation items queued: card draw, effect roll, haunt roll
    expect(s1.presentationQueue.length).toBe(3);
    expect(s1.presentationQueue[0]!.kind).toBe('card_draw');
    expect(s1.presentationQueue[1]!.kind).toBe('roll');
    expect(s1.presentationQueue[2]!.kind).toBe('roll');

    // 1. First presentation is the card reveal
    expect(s1.activeCardDraw).toEqual({
      seat: 'seat_0',
      deck: 'omen',
      cardId: 'omen.bite',
    });
    expect(s1.activeRoll).toBeNull();

    // 2. Dismiss card reveal -> next is the effect roll
    s1.dismissCardDraw();
    const s2 = useStore.getState();
    expect(s2.presentationQueue.length).toBe(2);
    expect(s2.activeCardDraw).toBeNull();
    expect(s2.activeRoll).toEqual({
      seat: 'seat_0',
      dice: [1, 2, 0],
      total: 3,
      reason: 'might',
    });

    // 3. Dismiss effect roll -> next is the haunt roll with haunt metadata
    s2.dismissRoll();
    const s3 = useStore.getState();
    expect(s3.presentationQueue.length).toBe(1);
    expect(s3.activeCardDraw).toBeNull();
    expect(s3.activeRoll).toEqual({
      seat: 'seat_0',
      dice: [1, 1, 2, 1, 0, 1],
      total: 6,
      reason: 'haunt_roll',
      hauntRoll: { needed: 1, triggered: false },
    });

    // 4. Dismiss haunt roll -> queue is empty
    s3.dismissRoll();
    const s4 = useStore.getState();
    expect(s4.presentationQueue.length).toBe(0);
    expect(s4.activeCardDraw).toBeNull();
    expect(s4.activeRoll).toBeNull();
  });

  it('queues two rolls in one event batch and presents both sequentially', () => {
    const msg: ServerMessage = {
      t: 'events',
      events: [
        { t: 'rolled', seat: 'seat_0', dice: [2, 1], total: 3, reason: 'attack' },
        { t: 'rolled', seat: 'seat_1', dice: [1, 1], total: 2, reason: 'defend' },
      ],
    };

    handle(msg, useStore.setState, useStore.getState);

    const s1 = useStore.getState();
    expect(s1.presentationQueue.length).toBe(2);
    expect(s1.activeRoll).toEqual({
      seat: 'seat_0',
      dice: [2, 1],
      total: 3,
      reason: 'attack',
    });

    // Dismiss first roll -> second roll appears
    s1.dismissRoll();
    const s2 = useStore.getState();
    expect(s2.presentationQueue.length).toBe(1);
    expect(s2.activeRoll).toEqual({
      seat: 'seat_1',
      dice: [1, 1],
      total: 2,
      reason: 'defend',
    });

    // Dismiss second roll -> finished
    s2.dismissRoll();
    const s3 = useStore.getState();
    expect(s3.presentationQueue.length).toBe(0);
    expect(s3.activeRoll).toBeNull();
  });
});
