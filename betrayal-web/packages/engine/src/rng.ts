/**
 * Deterministic RNG. See docs/05-engine.md#54-determinism-and-rng.
 *
 * The engine never calls Math.random(). The PRNG lives inside GameState, so
 * the action log plus the initial state fully reproduce any game — which is
 * what makes crash recovery, bug reports, and replay tests all work.
 *
 * Every function here is pure: it returns the new RngState rather than
 * mutating. Threading that through is mildly annoying and completely worth it.
 */

import type { RngState } from '@bahoth/shared';

export function makeRng(seed: number): RngState {
  return { seed: seed >>> 0, counter: 0 };
}

/** mulberry32 over hash(seed, counter). Returns [value in [0,1), nextState]. */
export function next(rng: RngState): [number, RngState] {
  const next = { seed: rng.seed, counter: rng.counter + 1 };
  let t = (rng.seed + rng.counter * 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

/** Uniform integer in [0, n). */
export function nextInt(rng: RngState, n: number): [number, RngState] {
  if (n <= 0) throw new Error(`nextInt requires n > 0, got ${n}`);
  const [v, r] = next(rng);
  return [Math.floor(v * n), r];
}

/** Fisher-Yates. Returns a new array; the input is not mutated. */
export function shuffle<T>(rng: RngState, items: readonly T[]): [T[], RngState] {
  const out = [...items];
  let r = rng;
  for (let i = out.length - 1; i > 0; i--) {
    const [j, nr] = nextInt(r, i + 1);
    r = nr;
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return [out, r];
}

export type DieFace = 0 | 1 | 2;

/**
 * Roll a single die: uniform draw from {0,1,2}.
 * Returns [face, nextRng].
 */
export function rollDie(rng: RngState): [DieFace, RngState] {
  const [face, nextRng] = nextInt(rng, 3);
  return [face as DieFace, nextRng];
}

/**
 * The game's dice: six-sided with faces 0,0,1,1,2,2 — so each die is a
 * uniform draw from {0,1,2}.
 * Only accepts an integer count in 0..8. Reuses rollDie.
 * Returns [faces, total, nextState].
 */
export function rollDice(rng: RngState, count: number): [DieFace[], number, RngState] {
  if (!Number.isInteger(count) || count < 0 || count > 8) {
    throw new Error(`rollDice requires an integer count between 0 and 8, got ${count}`);
  }
  if (count === 0) {
    return [[], 0, rng];
  }
  const faces: DieFace[] = [];
  let r = rng;
  let total = 0;
  for (let i = 0; i < count; i++) {
    const [face, nr] = rollDie(r);
    r = nr;
    faces.push(face);
    total += face;
  }
  return [faces, total, r];
}
