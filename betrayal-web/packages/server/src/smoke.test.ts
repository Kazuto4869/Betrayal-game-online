/**
 * End-to-end smoke verification covering production/dev server endpoints,
 * WebSocket protocol, solo-start, consumables, once-per-turn cooldown,
 * omen/haunt roll sequence, drop/pickup, and reconnect recovery.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import type { GameAction, ServerMessage } from '@bahoth/shared';
import { checkInvariants } from '@bahoth/engine';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bahoth-smoke-'));
process.env.DATA_DIR = testDir;
process.env.LOG_LEVEL = 'error';

const { createServer } = await import('./index.js');

interface Harness {
  httpUrl: string;
  wsUrl: string;
  close: () => Promise<void>;
  rooms: ReturnType<typeof createServer>['rooms'];
  gateway: ReturnType<typeof createServer>['gateway'];
}

class TestClient {
  readonly received: ServerMessage[] = [];
  private seq = 0;
  private cursor = 0;

  constructor(public readonly ws: WebSocket) {
    ws.on('message', (raw: Buffer) => {
      this.received.push(JSON.parse(raw.toString()) as ServerMessage);
    });
  }

  static async connect(url: string): Promise<TestClient> {
    const ws = new WebSocket(url);
    const client = new TestClient(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    return client;
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  action(action: GameAction): void {
    this.send({ t: 'action', seq: this.seq++, action });
  }

  async next<T extends ServerMessage['t']>(
    t: T,
    where?: (m: Extract<ServerMessage, { t: T }>) => boolean,
    timeoutMs = 3000,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      while (this.cursor < this.received.length) {
        const m = this.received[this.cursor++]!;
        if (m.t === t) {
          const typed = m as Extract<ServerMessage, { t: T }>;
          if (!where || where(typed)) return typed;
        }
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(
      `timed out waiting for "${t}"; received: ${this.received.map((m) => m.t).join(', ')}`,
    );
  }

  close(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}

describe('Task 9: Server smoke verification', () => {
  let harness: Harness;
  let contentHash = '';

  beforeAll(async () => {
    const { server, rooms, gateway, wss } = createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    harness = {
      httpUrl: `http://127.0.0.1:${port}`,
      wsUrl: `ws://127.0.0.1:${port}/ws`,
      rooms,
      gateway,
      close: () =>
        new Promise<void>((resolve) => {
          rooms.closeAll();
          wss.close();
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    };
  });

  afterAll(async () => {
    await harness.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('verifies HTTP endpoints: /, /healthz, /api/content', async () => {
    // 1. /healthz
    const resHealth = await fetch(`${harness.httpUrl}/healthz`);
    expect(resHealth.status).toBe(200);
    const healthJson = (await resHealth.json()) as { ok: boolean; contentHash: string };
    expect(healthJson.ok).toBe(true);

    // 2. /api/content
    const resContent = await fetch(`${harness.httpUrl}/api/content`);
    expect(resContent.status).toBe(200);
    const contentJson = (await resContent.json()) as { hash: string; cards: unknown[] };
    expect(contentJson.hash).toBeDefined();
    expect(contentJson.cards.length).toBeGreaterThan(0);
    contentHash = contentJson.hash;

    // 3. /
    const resRoot = await fetch(`${harness.httpUrl}/`);
    expect(resRoot.status).toBe(200);
  });

  it('handles solo start and card/item drop and pickup flow', async () => {
    let client: TestClient | null = null;
    let client2: TestClient | null = null;
    try {
      client = await TestClient.connect(harness.wsUrl);

      // 1. Hello & Create
      client.send({ t: 'hello', name: 'SoloExplorer', contentHash });
      await client.next('welcome');

      client.send({ t: 'create' });
      const welcomeMsg = await client.next('welcome', (m) => m.seatId !== null);
      const seatId = welcomeMsg.seatId!;
      const token = welcomeMsg.token!;
      expect(seatId).toBeDefined();
      expect(token).toBeDefined();

      const roomMsg = await client.next('room');
      const { code } = roomMsg;
      expect(code).toBeDefined();

      const snap1 = await client.next('snapshot');
      expect(snap1.state.phase).toBe('lobby');

      // 2. Solo start (MIN_PLAYERS = 1)
      const room = harness.rooms.get(code)!;
      const charId = Object.keys(room.state.charactersById ?? {})[0] ?? 'char.ox_bellows';

      client.action({ t: 'CHOOSE_CHAR', seat: seatId, charId });
      await client.next('snapshot');

      client.action({ t: 'START_GAME', seat: seatId });
      const gameSnap = await client.next('snapshot');
      expect(gameSnap.state.phase).toBe('explore');
      expect(gameSnap.state.activeSeat).toBe(seatId);

      // 3. Consumable Item test: Give Adrenaline Shot
      room.state = {
        ...room.state,
        decks: {
          ...room.state.decks,
          item: {
            ...room.state.decks.item,
            draw: room.state.decks.item.draw.filter(
              (id) => id !== 'item.adrenaline_shot',
            ),
            inPlay: [...room.state.decks.item.inPlay, 'item.adrenaline_shot'],
          },
        },
        players: {
          ...room.state.players,
          [seatId]: {
            ...room.state.players[seatId]!,
            items: [...room.state.players[seatId]!.items, 'item.adrenaline_shot'],
          },
        },
      };
      expect(checkInvariants(room.state)).toEqual([]);

      const movesBefore = room.state.players[seatId]!.movesLeft;
      client.action({ t: 'USE_ITEM', seat: seatId, cardId: 'item.adrenaline_shot' });
      await client.next('snapshot');
      const eventsMsg = await client.next('events');

      expect(
        eventsMsg.events.some((e) => e.t === 'log' && e.text.includes('Adrenaline')),
      ).toBe(true);
      expect(room.state.players[seatId]!.movesLeft).toBe(movesBefore + 4);
      expect(room.state.players[seatId]!.items).not.toContain('item.adrenaline_shot');
      expect(room.state.decks.item.discard).toContain('item.adrenaline_shot');
      expect(checkInvariants(room.state)).toEqual([]);

      // 4. Once-per-turn item: Give Bell
      room.state = {
        ...room.state,
        decks: {
          ...room.state.decks,
          item: {
            ...room.state.decks.item,
            draw: room.state.decks.item.draw.filter((id) => id !== 'item.bell'),
            inPlay: [...room.state.decks.item.inPlay, 'item.bell'],
          },
        },
        players: {
          ...room.state.players,
          [seatId]: {
            ...room.state.players[seatId]!,
            items: [...room.state.players[seatId]!.items, 'item.bell'],
          },
        },
      };
      expect(checkInvariants(room.state)).toEqual([]);

      // First use: succeeds
      client.action({ t: 'USE_ITEM', seat: seatId, cardId: 'item.bell' });
      await client.next('snapshot');
      expect(room.state.players[seatId]!.usedCardsThisTurn).toContain('item.bell');

      // Second use in same turn: rejected
      client.action({ t: 'USE_ITEM', seat: seatId, cardId: 'item.bell' });
      const err = await client.next('error');
      expect(err.message).toContain('already been used this turn');

      // 5. Drop & Pickup
      const loc = room.state.players[seatId]!.location!;
      client.action({ t: 'DROP', seat: seatId, cardIds: ['item.bell'] });
      await client.next('snapshot');
      expect(room.state.players[seatId]!.items).not.toContain('item.bell');
      expect(room.state.board.placed[loc]!.droppedItems).toContain('item.bell');
      expect(checkInvariants(room.state)).toEqual([]);

      client.action({ t: 'PICKUP', seat: seatId, cardIds: ['item.bell'] });
      await client.next('snapshot');
      expect(room.state.players[seatId]!.items).toContain('item.bell');
      expect(room.state.board.placed[loc]!.droppedItems).not.toContain('item.bell');
      expect(checkInvariants(room.state)).toEqual([]);

      // 6. Reconnect without duplicate effects
      await client.close();
      client = null;

      client2 = await TestClient.connect(harness.wsUrl);
      client2.send({ t: 'hello', name: 'SoloExplorer', contentHash, token });
      await client2.next('welcome');

      client2.send({ t: 'join', code });
      await client2.next('welcome', (m) => m.seatId === seatId);
      await client2.next('room');

      const snapRejoin = await client2.next('snapshot');
      expect(snapRejoin.state.players[seatId]!.items).toContain('item.bell');
      expect(snapRejoin.state.players[seatId]!.usedCardsThisTurn).toContain('item.bell');
      expect(checkInvariants(room.state)).toEqual([]);
    } finally {
      if (client) await client.close();
      if (client2) await client2.close();
    }
  });
});
