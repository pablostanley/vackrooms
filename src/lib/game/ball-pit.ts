import * as THREE from "three";
import { random } from "./maze";
import { offsetOutline, pointInPolygon, type PoolDesign } from "./pool-shape";

/** Faded playground plastic. No blue: the halls keep their no-blue rule. */
export const BALL_COLORS = ["#b5503c", "#d3a638", "#7c9942", "#c9772f", "#a4546b", "#d8cba6"];
export const BALL_RADIUS = 0.1;
/** Top of the heap: fuller than the water line, still under the coping. */
export const BALL_TOP = -0.04;
/** Enough plastic for a hall-filling lagoon without drowning the frame budget. */
const MAX_BALLS = 16000;
const BUCKET = 0.5;
const BODY = 0.46;

interface Placement {
  x: number;
  z: number;
  /** Positions to keep clear, such as bridge piers standing in the basin. */
  clear: { x: number; z: number; r: number }[];
}

/**
 * The top layer of a seeded ball pit, as world positions and colour indices.
 * Hex-packed inside the coping; a second, sparser layer fills the gaps.
 */
export function ballPitLayout(design: PoolDesign, seed: number, at: Placement) {
  const rng = random(seed);
  const edge = offsetOutline(design.outline, -BALL_RADIUS * 1.1);
  let area = 0;
  for (let i = 0; i < edge.length; i++) {
    const [x0, z0] = edge[i], [x1, z1] = edge[(i + 1) % edge.length];
    area += x0 * z1 - x1 * z0;
  }
  area = Math.abs(area) / 2;
  // Hex packing covers about 1.15 / spacing^2 balls per square meter per layer.
  const perLayer = MAX_BALLS / 1.75;
  const spacing = Math.max(BALL_RADIUS * 2, Math.sqrt((area * 1.15) / perLayer));
  const row = spacing * Math.sqrt(3) / 2;
  const positions: number[] = [], colors: number[] = [];
  for (const [layer, keep, drop] of [[0, 1, 0], [1, 0.6, 0.11]] as const) {
    for (let r = 0; r * row <= design.length; r++) {
      const z = r * row + (layer ? row / 2 : 0);
      const shift = (r % 2 ? spacing / 2 : 0) + (layer ? spacing / 2 : 0);
      for (let x = shift; x <= design.width; x += spacing) {
        const jx = x + (rng() - 0.5) * spacing * 0.3, jz = z + (rng() - 0.5) * row * 0.3;
        const lift = rng(), tint = Math.floor(rng() * BALL_COLORS.length);
        if (rng() > keep || !pointInPolygon(edge, jx, jz)) continue;
        const wx = at.x + jx, wz = at.z + jz;
        if (at.clear.some((c) => Math.hypot(wx - c.x, wz - c.z) < c.r + BALL_RADIUS)) continue;
        positions.push(wx, BALL_TOP - BALL_RADIUS - drop - lift * 0.05, wz);
        colors.push(tint);
      }
    }
  }
  return { positions: new Float32Array(positions), colors: Uint8Array.from(colors) };
}

/**
 * One instanced mesh per pit. Balls are static until someone wades in: then
 * the ones in the way roll aside and heap up, and settle back behind them.
 */
export class BallPit {
  readonly mesh: THREE.InstancedMesh;
  private base: Float32Array;
  private offset: Float32Array;
  private buckets = new Map<string, number[]>();
  private active = new Set<number>();
  private bounds = new THREE.Box2();
  private matrix = new THREE.Matrix4();

  constructor(layout: ReturnType<typeof ballPitLayout>, material: THREE.Material) {
    const { positions, colors } = layout;
    const count = positions.length / 3;
    // Rounder balls up close; hall-filling pits keep the triangle budget.
    const geometry = new THREE.IcosahedronGeometry(BALL_RADIUS, count < 8000 ? 2 : 1);
    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.name = "ball-pit";
    this.mesh.receiveShadow = true;
    this.base = positions;
    this.offset = new Float32Array(positions.length);
    const palette = BALL_COLORS.map((hex) => new THREE.Color(hex));
    for (let i = 0; i < count; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      this.matrix.makeTranslation(x, y, z);
      this.mesh.setMatrixAt(i, this.matrix);
      this.mesh.setColorAt(i, palette[colors[i]]);
      this.bounds.expandByPoint(new THREE.Vector2(x, z));
      const key = this.key(x, z);
      if (!this.buckets.has(key)) this.buckets.set(key, []);
      this.buckets.get(key)!.push(i);
    }
    this.mesh.computeBoundingSphere();
    // Pushed balls heap a little past their resting envelope.
    this.mesh.boundingSphere!.radius += 0.5;
  }

  private key(x: number, z: number) {
    return `${Math.floor(x / BUCKET)},${Math.floor(z / BUCKET)}`;
  }

  /** `feetY` is the wader's feet; only bodies below the heap move balls. */
  update(x: number, z: number, feetY: number, dt: number, still = false) {
    const wading = !still && feetY < BALL_TOP &&
      x > this.bounds.min.x - BODY && x < this.bounds.max.x + BODY &&
      z > this.bounds.min.y - BODY && z < this.bounds.max.y + BODY;
    if (!wading && !this.active.size) return;
    const pushed = new Set<number>();
    if (wading) {
      const bx = Math.floor(x / BUCKET), bz = Math.floor(z / BUCKET);
      for (let ix = bx - 1; ix <= bx + 1; ix++)
        for (let iz = bz - 1; iz <= bz + 1; iz++)
          for (const i of this.buckets.get(`${ix},${iz}`) ?? []) {
            const dx = this.base[i * 3] - x, dz = this.base[i * 3 + 2] - z;
            const d = Math.hypot(dx, dz);
            if (d >= BODY) continue;
            // Roll out to the body's edge and ride up onto the neighbours.
            const push = BODY - d, nx = d > 1e-3 ? dx / d : 1, nz = d > 1e-3 ? dz / d : 0;
            this.offset[i * 3] = nx * push;
            this.offset[i * 3 + 1] = push * 0.45;
            this.offset[i * 3 + 2] = nz * push;
            pushed.add(i);
            this.active.add(i);
          }
    }
    const settle = Math.exp(-dt * 1.6);
    for (const i of this.active) {
      if (!pushed.has(i)) {
        this.offset[i * 3] *= settle;
        this.offset[i * 3 + 1] *= settle;
        this.offset[i * 3 + 2] *= settle;
        if (Math.abs(this.offset[i * 3]) + Math.abs(this.offset[i * 3 + 2]) < 0.002) {
          this.offset.fill(0, i * 3, i * 3 + 3);
          this.active.delete(i);
        }
      }
      this.matrix.makeTranslation(
        this.base[i * 3] + this.offset[i * 3],
        this.base[i * 3 + 1] + this.offset[i * 3 + 1],
        this.base[i * 3 + 2] + this.offset[i * 3 + 2],
      );
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Displaced balls, for tests. */
  get moving() {
    return this.active.size;
  }
}
