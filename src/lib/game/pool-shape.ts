/**
 * Seeded pool outlines for generation-2 poolrooms. Every outline is a simple,
 * counter-clockwise polygon in basin-local meters: (0, 0) is the basin's
 * north-west bounding corner and the polygon exactly fills width x length.
 */
export type PoolShape =
  | "rectangle"
  | "grecian"
  | "roman"
  | "oval"
  | "trueL"
  | "lazyL"
  | "kidney"
  | "lagoon";

export interface PoolBridge {
  /** Center line of the walkway along z, basin-local. */
  z: number;
  x0: number;
  x1: number;
  /** A pier stops over the water; a bridge reaches the deck on both sides. */
  pier: boolean;
}

export interface PoolDesign {
  shape: PoolShape;
  width: number;
  length: number;
  outline: [number, number][];
  bridge?: PoolBridge;
  trampoline?: { x: number; z: number };
  /** One in four seeded basins is a ball pit instead of water. */
  fill?: "balls";
}

export const POOL_COPING = 0.18;
export const BRIDGE_WIDTH = 1.6;
export const BRIDGE_TOP = 0.44;
export const TRAMPOLINE_RADIUS = 0.95;
export const TRAMPOLINE_TOP = 0.24;

type Point = [number, number];

/** Replace each corner by an arc (or a single chamfer) of up to `radius`. */
function fillet(points: Point[], radius: number, chamfer = false): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[(i + points.length - 1) % points.length];
    const c = points[i];
    const n = points[(i + 1) % points.length];
    const a = [p[0] - c[0], p[1] - c[1]], b = [n[0] - c[0], n[1] - c[1]];
    const la = Math.hypot(a[0], a[1]), lb = Math.hypot(b[0], b[1]);
    const r = Math.min(radius, la * 0.45, lb * 0.45);
    // Already-sampled curves pass through; only real corners are softened.
    const straight = -(a[0] * b[0] + a[1] * b[1]) / (la * lb) > 0.8;
    if (r < 0.05 || straight) {
      out.push(c);
      continue;
    }
    const start: Point = [c[0] + (a[0] / la) * r, c[1] + (a[1] / la) * r];
    const end: Point = [c[0] + (b[0] / lb) * r, c[1] + (b[1] / lb) * r];
    if (chamfer) {
      out.push(start, end);
      continue;
    }
    // Quadratic Bezier through the corner is visually an arc at pool scale.
    for (let s = 0; s <= 6; s++) {
      const t = s / 6, u = 1 - t;
      out.push([
        u * u * start[0] + 2 * u * t * c[0] + t * t * end[0],
        u * u * start[1] + 2 * u * t * c[1] + t * t * end[1],
      ]);
    }
  }
  return out;
}

function radial(samples: number, r: (t: number) => [number, number]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < samples; i++) out.push(r((i / samples) * Math.PI * 2));
  return out;
}

/** Stretch to the exact bounding box and put the winding counter-clockwise. */
function fit(points: Point[], width: number, length: number): Point[] {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of points) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const fitted = points.map(([x, z]): Point => [
    ((x - minX) / (maxX - minX)) * width,
    ((z - minZ) / (maxZ - minZ)) * length,
  ]);
  // Drop consecutive duplicates that arcs can produce at shared endpoints.
  const clean = fitted.filter((p, i) => {
    const q = fitted[(i + fitted.length - 1) % fitted.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4;
  });
  return signedArea(clean) < 0 ? clean.reverse() : clean;
}

export function signedArea(points: readonly Point[]) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, z0] = points[i], [x1, z1] = points[(i + 1) % points.length];
    area += x0 * z1 - x1 * z0;
  }
  return area / 2;
}

function outlineFor(
  shape: PoolShape,
  w: number,
  l: number,
  rng: () => number,
): Point[] {
  const hw = w / 2, hl = l / 2;
  switch (shape) {
    case "rectangle":
      return [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]];
    case "grecian":
      return fillet([[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]], 1.4 + rng() * 1.6, true);
    case "oval": {
      // A stadium: straight sides with fully rounded ends.
      const r = hw;
      const out: Point[] = [];
      for (let i = 0; i <= 16; i++) {
        const t = Math.PI + (i / 16) * Math.PI;
        out.push([Math.cos(t) * r, -hl + r + Math.sin(t) * r]);
      }
      for (let i = 0; i <= 16; i++) {
        const t = (i / 16) * Math.PI;
        out.push([Math.cos(t) * r, hl - r + Math.sin(t) * r]);
      }
      return out;
    }
    case "roman": {
      // Rectangle with a round step centered on each short end.
      const a = hw * (0.42 + rng() * 0.2), depth = Math.min(a, hl * 0.3);
      const body: Point[] = [];
      const cap = (sign: number) => {
        for (let i = 0; i <= 12; i++) {
          const t = (i / 12) * Math.PI;
          body.push([
            -sign * Math.cos(t) * a,
            sign * (hl - depth + Math.sin(t) * depth),
          ]);
        }
      };
      body.push([-hw, -hl + depth], [-hw, hl - depth]);
      cap(1);
      body.push([hw, hl - depth], [hw, -hl + depth]);
      cap(-1);
      return fillet(body, 0.9);
    }
    case "trueL":
    case "lazyL": {
      const leg = w * (0.42 + rng() * 0.16), arm = l * (0.3 + rng() * 0.15);
      const lazy = shape === "lazyL";
      const points: Point[] = [
        [-hw, -hl],
        [-hw + leg, -hl],
        [-hw + leg, lazy ? hl - arm - arm * 0.9 : hl - arm],
        [hw, lazy ? hl - arm * 0.9 : hl - arm],
        [hw, lazy ? hl - arm * 0.9 + arm * 0.75 : hl],
        [lazy ? -hw + leg * 0.6 : -hw, hl],
        ...(lazy ? [[-hw, hl - leg * 0.4] as Point] : []),
      ];
      const chamfer = rng() < 0.4;
      return fillet(points, chamfer ? 1.1 : 0.7, chamfer);
    }
    case "kidney": {
      const pinch = 0.34 + rng() * 0.18, lobe = 0.78 + rng() * 0.18;
      return radial(72, (t) => {
        const s = Math.sin(t), c = Math.cos(t);
        const scale = s < 0 ? lobe : 1;
        // Pull the east flank in around its middle for the bean waist.
        const dent = c > 0 ? pinch * Math.exp(-(s * s) / 0.22) * c : 0;
        return [(c - dent) * scale, s];
      });
    }
    case "lagoon": {
      const waves = [2, 3, 4, 5].map((k) => ({
        k,
        a: (0.05 + rng() * 0.09) / (k - 1),
        phase: rng() * Math.PI * 2,
      }));
      return radial(80, (t) => {
        let r = 1;
        for (const { k, a, phase } of waves) r += a * Math.sin(k * t + phase);
        return [Math.cos(t) * r, Math.sin(t) * r];
      });
    }
  }
}

export function pointInPolygon(points: readonly Point[], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i], [xj, zj] = points[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
      inside = !inside;
  }
  return inside;
}

export function distanceToOutline(points: readonly Point[], x: number, z: number) {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    const [ax, az] = points[i], [bx, bz] = points[(i + 1) % points.length];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}

/** Offset a counter-clockwise ring; positive grows it. Miters are clamped. */
export function offsetOutline(points: readonly Point[], distance: number): Point[] {
  return points.map((c, i) => {
    const p = points[(i + points.length - 1) % points.length];
    const n = points[(i + 1) % points.length];
    const e0 = normalize(c[0] - p[0], c[1] - p[1]);
    const e1 = normalize(n[0] - c[0], n[1] - c[1]);
    // Outward normals of a counter-clockwise ring (x right, z down in plan).
    const n0 = [e0[1], -e0[0]], n1 = [e1[1], -e1[0]];
    const m = normalize(n0[0] + n1[0], n0[1] + n1[1]);
    const cos = Math.max(0.5, m[0] * n1[0] + m[1] * n1[1]);
    return [c[0] + (m[0] * distance) / cos, c[1] + (m[1] * distance) / cos];
  });
}

function normalize(x: number, z: number): [number, number] {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
}

/** Water spans crossed by the horizontal line at z. */
export function crossings(points: readonly Point[], z: number) {
  const xs: number[] = [];
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i], [xj, zj] = points[j];
    if (zi > z !== zj > z) xs.push(xi + ((z - zi) * (xj - xi)) / (zj - zi));
  }
  return xs.sort((a, b) => a - b);
}

/**
 * Dry deck inside the basin's bounding box, as merged axis-aligned rectangles.
 * Cells are dry when their center lies outside the water; the coping covers
 * the remaining sub-cell sliver on both sides of the outline.
 */
export function deckRects(design: PoolDesign, step = 0.25) {
  const columns = Math.ceil(design.width / step), rows = Math.ceil(design.length / step);
  const rects: { x: number; z: number; width: number; length: number }[] = [];
  let open = new Map<string, (typeof rects)[number]>();
  for (let row = 0; row < rows; row++) {
    const z = row * step, depth = Math.min(step, design.length - z);
    const next = new Map<string, (typeof rects)[number]>();
    let start = -1;
    for (let col = 0; col <= columns; col++) {
      const dry = col < columns &&
        !pointInPolygon(design.outline, (col + 0.5) * step, z + depth / 2);
      if (dry && start < 0) start = col;
      if (!dry && start >= 0) {
        const x = start * step, width = Math.min(col * step, design.width) - x;
        const key = `${start},${col}`;
        const previous = open.get(key);
        if (previous) {
          previous.length += depth;
          next.set(key, previous);
        } else {
          const rect = { x, z, width, length: depth };
          rects.push(rect);
          next.set(key, rect);
        }
        start = -1;
      }
    }
    open = next;
  }
  return rects;
}

const SHAPES: [PoolShape, number][] = [
  ["rectangle", 2],
  ["grecian", 1],
  ["roman", 1],
  ["oval", 1],
  ["trueL", 1],
  ["lazyL", 1],
  ["kidney", 1.5],
  ["lagoon", 1.5],
];

/**
 * Pick a shape, size, and optional bridge or trampoline within the room's
 * floor, leaving at least `margin` meters of dry deck to every room wall.
 */
export function designPool(
  rng: () => number,
  roomWidth: number,
  roomLength: number,
): PoolDesign {
  let pick = rng() * SHAPES.reduce((sum, [, weight]) => sum + weight, 0);
  let shape: PoolShape = "rectangle";
  for (const [candidate, weight] of SHAPES)
    if ((pick -= weight) < 0) {
      shape = candidate;
      break;
    }
  const snap = (value: number) => Math.round(value * 2) / 2;
  const maxWidth = Math.floor((roomWidth - 10.4) * 2) / 2;
  const maxLength = Math.floor((roomLength - 11) * 2) / 2;
  // Plunge pools, ordinary hotel pools, and a few that nearly fill the hall.
  const size = rng();
  const [low, high] = size < 0.25 ? [7, 11] : size < 0.7 ? [11, 17] : [16, maxWidth];
  const stretched = shape === "oval" || shape === "roman";
  const aspect = stretched ? 1.3 + rng() * 0.7 : 0.8 + rng() * 1.3;
  const w = Math.min(maxWidth, snap(low + rng() * (high - low)));
  const l = Math.min(maxLength, snap(Math.max(9, w * aspect)));
  let raw = outlineFor(shape, w, l, rng);
  // Mirror asymmetric shapes so their notches and waists face any side.
  if (rng() < 0.5) raw = raw.map(([x, z]) => [-x, z]);
  if (rng() < 0.5) raw = raw.map(([x, z]) => [x, -z]);
  const design: PoolDesign = { shape, width: w, length: l, outline: fit(raw, w, l) };

  if (rng() < 0.45) design.bridge = planBridge(design, rng);
  if (!design.bridge) delete design.bridge;
  if (rng() < 0.4) {
    const trampoline = planTrampoline(design, rng, roomWidth, roomLength);
    if (trampoline) design.trampoline = trampoline;
  }
  return design;
}

function planBridge(design: PoolDesign, rng: () => number): PoolBridge | undefined {
  const pier = rng() < 0.45;
  for (let attempt = 0; attempt < 8; attempt++) {
    const z = design.length * (0.25 + rng() * 0.5);
    // The whole walkway must cross one continuous span of water.
    let x0 = Infinity, x1 = -Infinity, single = true;
    for (let s = -2; s <= 2; s++) {
      const xs = crossings(design.outline, z + (s * BRIDGE_WIDTH) / 4);
      if (xs.length !== 2) single = false;
      else {
        x0 = Math.min(x0, xs[0]);
        x1 = Math.max(x1, xs[1]);
      }
    }
    if (!single || x1 - x0 < 5) continue;
    // Land 0.8m onto the dry deck, past the coping.
    const west = x0 - 0.8, east = x1 + 0.8;
    if (!pier) return { z, x0: west, x1: east, pier };
    const reach = (x1 - x0) * (0.4 + rng() * 0.25);
    const bridge = rng() < 0.5
      ? { z, x0: west, x1: x0 + reach, pier }
      : { z, x0: x1 - reach, x1: east, pier };
    // The tip must hang over open water, clear of any curving rim.
    const tip = bridge.x0 === west ? bridge.x1 : bridge.x0;
    if (distanceToOutline(design.outline, tip, z) > 1.5) return bridge;
  }
  return undefined;
}

function planTrampoline(
  design: PoolDesign,
  rng: () => number,
  roomWidth: number,
  roomLength: number,
) {
  const { outline } = design;
  // Room walls in basin-local coordinates, since the basin is centered.
  const minX = (design.width - roomWidth) / 2 + 1.6, maxX = (design.width + roomWidth) / 2 - 1.6;
  const minZ = (design.length - roomLength) / 2 + 1.6, maxZ = (design.length + roomLength) / 2 - 1.6;
  const ring = offsetOutline(outline, POOL_COPING + 0.35 + TRAMPOLINE_RADIUS);
  for (let attempt = 0; attempt < 12; attempt++) {
    const [x, z] = ring[Math.floor(rng() * ring.length)];
    if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
    if (distanceToOutline(outline, x, z) < POOL_COPING + 0.3 + TRAMPOLINE_RADIUS) continue;
    if (pointInPolygon(outline, x, z)) continue;
    const bridge = design.bridge;
    if (bridge && Math.abs(z - bridge.z) < BRIDGE_WIDTH / 2 + TRAMPOLINE_RADIUS + 0.8 &&
        x > bridge.x0 - TRAMPOLINE_RADIUS - 1.2 && x < bridge.x1 + TRAMPOLINE_RADIUS + 1.2)
      continue;
    return { x, z };
  }
  return undefined;
}
