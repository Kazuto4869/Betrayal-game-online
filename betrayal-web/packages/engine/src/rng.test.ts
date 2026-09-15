import { describe, expect, it } from 'vitest';
import { makeRng, next, nextInt, rollDie, rollDice, shuffle } from './rng.js';

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = rollDice(makeRng(12345), 6);
    const b = rollDice(makeRng(12345), 6);
    expect(a[0]).toEqual(b[0]);
    expect(a[1]).toEqual(b[1]);
  });

  it('produces different streams for different seeds', () => {
    const a = rollDice(makeRng(1), 8)[0];
    const b = rollDice(makeRng(2), 8)[0];
    expect(a).not.toEqual(b);
  });

  it('never mutates the input state', () => {
    const rng = makeRng(7);
    const before = { ...rng };
    next(rng);
    nextInt(rng, 10);
    shuffle(rng, [1, 2, 3]);
    rollDie(rng);
    rollDice(rng, 3);
    expect(rng).toEqual(before);
  });

  it('rollDie rolls faces in {0,1,2} and advances counter by one', () => {
    let rng = makeRng(42);
    for (let i = 0; i < 100; i++) {
      const [face, nextRng] = rollDie(rng);
      expect([0, 1, 2]).toContain(face);
      expect(nextRng.counter).toBe(rng.counter + 1);
      rng = nextRng;
    }
  });

  it('advances the counter by one per draw', () => {
    const [, r1] = next(makeRng(9));
    expect(r1.counter).toBe(1);
    const [, , r2] = rollDice(makeRng(9), 6);
    expect(r2.counter).toBe(6);
  });

  it('rollDice count 0 returns empty array, total 0, and unchanged RNG', () => {
    const rng = makeRng(99);
    const [faces, total, nextRng] = rollDice(rng, 0);
    expect(faces).toEqual([]);
    expect(total).toBe(0);
    expect(nextRng).toEqual(rng);
  });

  it('rollDice accepts counts up to max 8 and total matches face sum', () => {
    for (let count = 1; count <= 8; count++) {
      const [faces, total, nextRng] = rollDice(makeRng( count * 10), count);
      expect(faces).toHaveLength(count);
      for (const f of faces) expect([0, 1, 2]).toContain(f);
      expect(total).toBe(faces.reduce((a, b) => a + b, 0));
      expect(nextRng.counter).toBe(count);
    }
  });

  it('rollDice throws on invalid counts without consuming RNG', () => {
    const rng = makeRng(123);
    const invalidCounts = [-1, -5, 1.5, 2.7, 9, 10, 100, NaN, Infinity, -Infinity];
    for (const count of invalidCounts) {
      expect(() => rollDice(rng, count)).toThrow();
      expect(rng.counter).toBe(0);
    }
  });

  it('rolls a plausible distribution over many samples', () => {
    // 6 dice of mean 1 each => mean 6. Guards against an off-by-one that
    // would silently bias every haunt roll in the game.
    let rng = makeRng(2024);
    let sum = 0;
    const trials = 4000;
    for (let i = 0; i < trials; i++) {
      const [, total, r] = rollDice(rng, 6);
      rng = r;
      sum += total;
    }
    expect(sum / trials).toBeGreaterThan(5.7);
    expect(sum / trials).toBeLessThan(6.3);
  });

  it('shuffle is a permutation and does not mutate the input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const [out] = shuffle(makeRng(3), input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort((a, b) => a - b)).toEqual(input);
  });

  it('nextInt stays in range', () => {
    let rng = makeRng(11);
    for (let i = 0; i < 500; i++) {
      const [v, r] = nextInt(rng, 7);
      rng = r;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });
});
