export const CELL = 4.8;
export const CHUNK = 12;
export const HEIGHT = 3.15;
export const N = 1,
  E = 2,
  S = 4,
  W = 8;
export const directions = [
  { dx: 0, dz: -1, bit: N, opposite: S },
  { dx: 1, dz: 0, bit: E, opposite: W },
  { dx: 0, dz: 1, bit: S, opposite: N },
  { dx: -1, dz: 0, bit: W, opposite: E },
];
