export type GenerationVersion = 1 | 2;

/** Sequential mixing avoids the legacy XOR's simultaneous coordinate-negation symmetry. */
export function interiorSeed(x: number, z: number, seed: number) {
  const mix = (value: number) => {
    value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
    value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
    return (value ^ (value >>> 16)) >>> 0;
  };
  return mix(mix(mix(seed ^ 0x7632696e) ^ x) ^ z);
}
