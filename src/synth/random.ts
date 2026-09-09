/**
 * Seeded pseudo-random source for the synthetic generator.
 *
 * The generator must be reproducible: the eval set is checked against ground
 * truth, and a set that changes between runs makes a regression indistinguishable
 * from a reshuffle. `Math.random` is therefore never used anywhere under
 * `src/synth` — every draw comes from a `Rng` constructed with an explicit seed.
 */

export interface Rng {
  /** Uniform float in `[0, 1)`. */
  next(): number;
  /** Uniform integer in `[min, max]`, both inclusive. */
  int(min: number, max: number): number;
  /** True with probability `p`. */
  bool(p: number): boolean;
  /** Uniformly chosen element. Throws on an empty list. */
  pick<T>(items: readonly T[]): T;
  /** A new array with the elements shuffled; the input is left untouched. */
  shuffle<T>(items: readonly T[]): T[];
  /** `count` distinct elements, or all of them if `count` exceeds the length. */
  sample<T>(items: readonly T[], count: number): T[];
  /** Uniform float in `[min, max)`. */
  float(min: number, max: number): number;
}

/**
 * mulberry32 — a small, fast 32-bit generator. Chosen over a cryptographic
 * source precisely because it is deterministic and portable: the same seed
 * yields the same dossiers on any machine and any Node version.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,

    int(min, max) {
      if (max < min) throw new Error(`Empty range: [${min}, ${max}]`);
      return min + Math.floor(next() * (max - min + 1));
    },

    float(min, max) {
      return min + next() * (max - min);
    },

    bool(p) {
      return next() < p;
    },

    pick(items) {
      if (items.length === 0) throw new Error("Cannot pick from an empty list");
      return items[rng.int(0, items.length - 1)];
    },

    shuffle(items) {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },

    sample(items, count) {
      return rng.shuffle(items).slice(0, Math.min(count, items.length));
    },
  };

  return rng;
}
