export interface RngState {
  value: number;
}

export function seedRng(seed: string): RngState {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return { value: hash >>> 0 };
}

export function nextRandom(state: RngState): {
  state: RngState;
  value: number;
} {
  const nextValue = (state.value + 0x6d2b79f5) >>> 0;
  let mixed = nextValue;
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  const result = ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  return { state: { value: nextValue }, value: result };
}

export function randomInt(
  state: RngState,
  maxExclusive: number,
): { state: RngState; value: number } {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError('maxExclusive must be a positive integer');
  }
  const next = nextRandom(state);
  return {
    state: next.state,
    value: Math.floor(next.value * maxExclusive),
  };
}
