/** Deterministic PRNG so tests are reproducible. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** Starting-position colour grid. */
export function startGrid(): string[] {
  const g = new Array(64).fill("");
  for (let c = 0; c < 8; c++) { g[c] = "b"; g[8 + c] = "b"; g[48 + c] = "w"; g[56 + c] = "w"; }
  return g;
}
