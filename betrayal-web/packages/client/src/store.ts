/**
 * Client state. See docs/07-ui.md#77-client-state-and-data-flow.
 *
 * The store holds the redacted GameState exactly as the server sent it. No
 * component holds derived game state in local useState; derived values come
 * from the engine's selectors so the client and server can never disagree
 * about what is legal.
 */

import { create } from 'zustand';
import type {
  CardId,
  GameAction,
  GameState,
  PublicSeat,
  RoomCode,
  SeatId,
  ServerMessage,
} from '@bahoth/shared';
import type { Content } from '@bahoth/content';
import { buildContent } from '@bahoth/content';
import { Connection, saveToken, tokenFor } from './net.js';
import type { LogEntry } from './log/narrate.js';
import { contextFrom, entryFor } from './log/narrate.js';

export type Screen = 'home' | 'lobby' | 'game';

/** How many lines to retain. Beyond this the oldest are dropped. */
const LOG_LIMIT = 200;

export interface CardDrawInfo {
  seat: SeatId;
  cardId: CardId;
  deck: string;
}

export interface RollInfo {
  seat?: SeatId | undefined;
  dice: number[];
  total: number;
  reason: string;
  hauntRoll?: { needed: number; triggered: boolean } | undefined;
}

export type PresentationItem =
  { kind: 'card_draw'; draw: CardDrawInfo } | { kind: 'roll'; roll: RollInfo };

export interface Store {
  screen: Screen;
  connected: boolean;
  name: string;
  content: Content | null;
  contentHash: string;

  roomCode: RoomCode | null;
  seatId: SeatId | null;
  seats: PublicSeat[];
  hostSeatId: SeatId | null;

  state: GameState | null;
  version: number;
  log: LogEntry[];
  error: string | null;
  pendingSeq: number | null;
  /** Seat token from `welcome`, held until `room` reveals the code. */
  heldToken: string | null;

  presentationQueue: PresentationItem[];
  activeCardDraw: CardDrawInfo | null;
  activeRoll: RollInfo | null;

  conn: Connection | null;

  init: () => Promise<void>;
  setName: (name: string) => void;
  createRoom: () => void;
  joinRoom: (code: RoomCode) => void;
  send: (action: GameAction) => void;
  sendChat: (text: string) => void;
  dismissError: () => void;
  dismissCardDraw: () => void;
  dismissRoll: () => void;
  dismissPresentation: () => void;
}

let logId = 0;

export const useStore = create<Store>((set, get) => ({
  screen: 'home',
  connected: false,
  name:
    typeof localStorage !== 'undefined'
      ? (localStorage.getItem('bahoth.name') ?? '')
      : '',
  content: null,
  contentHash: '',

  roomCode: null,
  seatId: null,
  seats: [],
  hostSeatId: null,

  state: null,
  version: -1,
  log: [],
  error: null,
  pendingSeq: null,
  heldToken: null,

  presentationQueue: [],
  activeCardDraw: null,
  activeRoll: null,

  conn: null,

  async init() {
    if (get().conn) return;

    // Content comes from the server so the hashes match by construction.
    const res = await fetch('/api/content');
    const raw: unknown = await res.json();
    const content = buildContent(raw, '/api/content');
    set({ content, contentHash: content.hash });

    const conn = new Connection({
      onOpen: () => {
        set({ connected: true });
        const { name, roomCode } = get();
        conn.hello(
          name || 'Explorer',
          content.hash,
          roomCode ? tokenFor(roomCode) : undefined,
        );
        // Resume in place after a dropped connection.
        if (roomCode) conn.join(roomCode);
      },
      onClose: () => set({ connected: false }),
      onMessage: (msg) => handle(msg, set, get),
    });

    set({ conn });
    conn.connect();
  },

  setName(name) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('bahoth.name', name);
    }
    set({ name });
  },

  createRoom() {
    const { conn, name, contentHash } = get();
    conn?.hello(name || 'Explorer', contentHash);
    conn?.create();
  },

  joinRoom(code) {
    const { conn, name, contentHash } = get();
    const normalised = code.trim().toUpperCase();
    conn?.hello(name || 'Explorer', contentHash, tokenFor(normalised));
    conn?.join(normalised);
  },

  send(action) {
    const seq = get().conn?.action(action) ?? null;
    set({ pendingSeq: seq });
  },

  sendChat(text) {
    // Not echoed locally: chat is broadcast back to the sender too
    // (`broadcast`, not `broadcastExcept`, in packages/server/src/gateway.ts),
    // so echoing here would print every message twice. The round trip also
    // means the sender sees their line in the same order everyone else does.
    const trimmed = text.trim();
    if (trimmed) get().conn?.chat(trimmed);
  },

  dismissError() {
    set({ error: null });
  },

  dismissPresentation() {
    set((s) => {
      const nextQueue = s.presentationQueue.slice(1);
      const head = nextQueue[0];
      return {
        presentationQueue: nextQueue,
        activeCardDraw: head?.kind === 'card_draw' ? head.draw : null,
        activeRoll: head?.kind === 'roll' ? head.roll : null,
      };
    });
  },

  dismissCardDraw() {
    get().dismissPresentation();
  },

  dismissRoll() {
    get().dismissPresentation();
  },
}));

export type Set = (partial: Partial<Store> | ((s: Store) => Partial<Store>)) => void;
export type Get = () => Store;

export function handle(msg: ServerMessage, set: Set, get: Get): void {
  switch (msg.t) {
    case 'welcome': {
      if (msg.seatId) set({ seatId: msg.seatId });
      // `welcome` carries the seat token but arrives BEFORE `room`, so the
      // room code is not known yet. Hold the token and persist it below.
      const code = get().roomCode;
      if (msg.token) {
        if (code) saveToken(code, msg.token);
        else set({ heldToken: msg.token });
      }
      break;
    }

    case 'room': {
      const before = get();
      set({ roomCode: msg.code, seats: msg.seats, hostSeatId: msg.hostSeatId });
      // Now that the code is known, persist the token from `welcome`. Without
      // this, reconnecting after a page reload is impossible.
      if (before.heldToken) {
        saveToken(msg.code, before.heldToken);
        set({ heldToken: null });
      }
      if (before.screen === 'home') set({ screen: 'lobby' });
      break;
    }

    case 'snapshot': {
      // The snapshot is always the truth; older versions are stale and dropped.
      if (msg.version < get().version) return;
      set({
        state: msg.state,
        version: msg.version,
        screen: msg.state.phase === 'lobby' ? 'lobby' : 'game',
        pendingSeq: null,
      });
      break;
    }

    case 'events': {
      // Narrated against the state that arrived immediately before these
      // events (the server sends `snapshot` then `events` for one version —
      // `broadcastState` in packages/server/src/gateway.ts), which is what
      // lets a `moved` event name the room it moved into.
      const { state, seats, content } = get();
      const ctx = contextFrom(state, seats, content);
      const at = Date.now();

      const newPresentations: PresentationItem[] = [];

      for (const e of msg.events) {
        if (e.t === 'drew_card') {
          newPresentations.push({
            kind: 'card_draw',
            draw: { seat: e.seat, cardId: e.cardId, deck: e.deck },
          });
        } else if (e.t === 'rolled') {
          newPresentations.push({
            kind: 'roll',
            roll: { seat: e.seat, dice: e.dice, total: e.total, reason: e.reason },
          });
        } else if (e.t === 'haunt_roll') {
          const lastRollIdx = [...newPresentations]
            .reverse()
            .findIndex((p) => p.kind === 'roll');
          if (lastRollIdx !== -1) {
            const actualIdx = newPresentations.length - 1 - lastRollIdx;
            const rollItem = newPresentations[actualIdx] as {
              kind: 'roll';
              roll: RollInfo;
            };
            rollItem.roll = {
              ...rollItem.roll,
              hauntRoll: { needed: e.needed, triggered: e.triggered },
            };
          } else {
            newPresentations.push({
              kind: 'roll',
              roll: {
                seat: state?.activeSeat ?? undefined,
                dice: [],
                total: e.total,
                reason: 'haunt_roll',
                hauntRoll: { needed: e.needed, triggered: e.triggered },
              },
            });
          }
        }
      }

      set((s) => {
        const queue = [...s.presentationQueue, ...newPresentations];
        const head = queue[0];
        return {
          log: [...s.log, ...msg.events.map((e) => entryFor(e, ctx, logId++, at))].slice(
            -LOG_LIMIT,
          ),
          presentationQueue: queue,
          activeCardDraw: head?.kind === 'card_draw' ? head.draw : null,
          activeRoll: head?.kind === 'roll' ? head.roll : null,
        };
      });
      break;
    }

    case 'ack':
      set({ pendingSeq: null });
      break;

    case 'error':
      set({ error: msg.message, pendingSeq: null });
      break;

    case 'chat':
      // Carries the server's timestamp rather than arrival time, so a message
      // held up in flight still sorts and reads by when it was said.
      set((s) => ({
        log: [
          ...s.log,
          {
            id: logId++,
            kind: 'chat' as const,
            seat: msg.seatId,
            text: `${seatName(get(), msg.seatId)}: ${msg.text}`,
            at: msg.at,
          },
        ].slice(-LOG_LIMIT),
      }));
      break;

    case 'left':
      // The log goes with the room. Carrying it to the next one would narrate
      // a game the player is no longer in, above the one they just joined.
      set({
        screen: 'home',
        roomCode: null,
        state: null,
        seats: [],
        version: -1,
        log: [],
      });
      break;

    case 'pong':
      break;
  }
}

/**
 * A seat's display name. `state.players` first and the lobby seat list
 * second, for the same reason `contextFrom` (log/narrate.ts) does it that
 * way: the state is the authority once a game is running, but chat happens
 * in the lobby too, before `state.players` exists at all.
 */
function seatName(store: Store, seatId: SeatId): string {
  return (
    store.state?.players[seatId]?.name ??
    store.seats.find((s) => s.seatId === seatId)?.name ??
    seatId
  );
}
