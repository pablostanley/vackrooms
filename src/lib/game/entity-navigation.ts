import { Box3, Vector3 } from "three";
import { wallsBetween, type SoundPosition } from "./acoustics";
import {
  CELL,
  CHUNK,
  HEIGHT,
  N,
  E,
  S,
  W,
  SPAN,
  canStand,
  ceilingAt,
  type ChunkData,
} from "./maze";

export interface GroundPoint {
  x: number;
  z: number;
}
export interface EntityView {
  position: SoundPosition;
  forward: SoundPosition;
  up: SoundPosition;
  fov: number;
  aspect: number;
}
const GRID = CELL / 8;
export const ENTITY_RADIUS = 0.35;
const keyOf = (x: number, z: number) => `${x},${z}`;
export const groundDistance = (a: GroundPoint, b: GroundPoint) =>
  Math.hypot(a.x - b.x, a.z - b.z);

/** Slab intersection over a finite segment, including grazing and vertical rays. */
export function segmentHitsBox(
  a: SoundPosition,
  b: SoundPosition,
  box: Box3,
  pad = 0,
) {
  let near = 0,
    far = 1;
  for (const axis of ["x", "y", "z"] as const) {
    const d = b[axis] - a[axis];
    const margin = axis === "y" ? 0 : pad;
    const min = box.min[axis] - margin,
      max = box.max[axis] + margin;
    if (Math.abs(d) < 1e-10) {
      if (a[axis] < min || a[axis] > max) return false;
    } else {
      const t1 = (min - a[axis]) / d,
        t2 = (max - a[axis]) / d;
      near = Math.max(near, Math.min(t1, t2));
      far = Math.min(far, Math.max(t1, t2));
      if (near > far) return false;
    }
  }
  return true;
}

interface NavSection {
  data: ChunkData;
  furniture: readonly Box3[];
  walls: Box3[];
}
interface Node {
  x: number;
  z: number;
  key: string;
  cost: number;
  rank: number;
  parent?: Node;
}
class Frontier {
  private nodes: Node[] = [];
  get size() {
    return this.nodes.length;
  }
  push(node: Node) {
    let i = this.nodes.length;
    this.nodes.push(node);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.nodes[parent].rank <= node.rank) break;
      this.nodes[i] = this.nodes[parent];
      i = parent;
    }
    this.nodes[i] = node;
  }
  pop() {
    const first = this.nodes[0],
      last = this.nodes.pop()!;
    if (this.nodes.length) {
      let i = 0;
      while (i * 2 + 1 < this.nodes.length) {
        let child = i * 2 + 1;
        if (
          child + 1 < this.nodes.length &&
          this.nodes[child + 1].rank < this.nodes[child].rank
        )
          child++;
        if (last.rank <= this.nodes[child].rank) break;
        this.nodes[i] = this.nodes[child];
        i = child;
      }
      this.nodes[i] = last;
    }
    return first;
  }
}

/** A lazy, bounded navigation grid over the same resident geometry as the player. */
export class EntityNavigation {
  readonly chunks = new Map<string, ChunkData>();
  revision = 0;
  private sections = new Map<string, NavSection>();
  private buckets = new Map<string, { furniture: Box3[]; walls: Box3[] }>();
  private walkable = new Map<string, boolean>();

  addSection(key: string, data: ChunkData, furniture: readonly Box3[]) {
    const walls: Box3[] = [];
    const box = (
      x: number,
      z: number,
      w: number,
      d: number,
      bottom: number,
      top: number,
    ) =>
      walls.push(
        new Box3(
          new Vector3(x - w / 2, bottom, z - d / 2),
          new Vector3(x + w / 2, top, z + d / 2),
        ),
      );
    for (let z = 0; z < CHUNK; z++)
      for (let x = 0; x < CHUNK; x++) {
        const bits = data.cells[z * CHUNK + x],
          h = ceilingAt(data, x, z);
        const wx = data.x * SPAN + x * CELL,
          wz = data.z * SPAN + z * CELL;
        for (const [bit, px, pz, width, depth, neighbor] of [
          [N, wx + CELL / 2, wz, CELL + 0.18, 0.18, ceilingAt(data, x, z - 1)],
          [W, wx, wz + CELL / 2, 0.18, CELL + 0.18, ceilingAt(data, x - 1, z)],
          [
            S,
            wx + CELL / 2,
            wz + CELL,
            CELL + 0.18,
            0.18,
            ceilingAt(data, x, z + 1),
          ],
          [
            E,
            wx + CELL,
            wz + CELL / 2,
            0.18,
            CELL + 0.18,
            ceilingAt(data, x + 1, z),
          ],
        ]) {
          if (!(bits & bit))
            box(px, pz, width, depth, 0, Math.max(h, neighbor));
          else if (h !== neighbor)
            box(px, pz, width, depth, HEIGHT, Math.max(h, neighbor));
        }
      }
    this.sections.set(key, { data, furniture, walls });
    this.chunks.set(key, data);
    this.reindex();
  }
  removeSection(key: string) {
    this.sections.delete(key);
    this.chunks.delete(key);
    this.reindex();
  }
  clear() {
    this.sections.clear();
    this.chunks.clear();
    this.reindex();
  }
  private reindex() {
    this.revision++;
    this.walkable.clear();
    this.buckets.clear();
    for (const section of this.sections.values())
      for (const kind of ["furniture", "walls"] as const)
        for (const box of section[kind]) {
          for (
            let z = Math.floor(box.min.z / CELL);
            z <= Math.floor(box.max.z / CELL);
            z++
          )
            for (
              let x = Math.floor(box.min.x / CELL);
              x <= Math.floor(box.max.x / CELL);
              x++
            ) {
              const key = keyOf(x, z);
              let bucket = this.buckets.get(key);
              if (!bucket)
                this.buckets.set(key, (bucket = { furniture: [], walls: [] }));
              bucket[kind].push(box);
            }
        }
  }
  private *boxes(
    a: GroundPoint,
    b: GroundPoint,
    kind: "furniture" | "walls",
    pad = 0,
  ) {
    for (
      let z = Math.floor((Math.min(a.z, b.z) - pad) / CELL);
      z <= Math.floor((Math.max(a.z, b.z) + pad) / CELL);
      z++
    )
      for (
        let x = Math.floor((Math.min(a.x, b.x) - pad) / CELL);
        x <= Math.floor((Math.max(a.x, b.x) + pad) / CELL);
        x++
      )
        yield* this.buckets.get(keyOf(x, z))?.[kind] ?? [];
  }
  canOccupy(p: GroundPoint) {
    if (!canStand(this.chunks, p.x, p.z, ENTITY_RADIUS)) return false;
    for (const box of this.boxes(p, p, "furniture", ENTITY_RADIUS)) {
      if (box.max.y < 0.08 || box.min.y > 2.75) continue;
      if (
        p.x >= box.min.x - ENTITY_RADIUS &&
        p.x <= box.max.x + ENTITY_RADIUS &&
        p.z >= box.min.z - ENTITY_RADIUS &&
        p.z <= box.max.z + ENTITY_RADIUS
      )
        return false;
    }
    return true;
  }
  clearSegment(a: GroundPoint, b: GroundPoint, radius = ENTITY_RADIUS) {
    const steps = Math.max(1, Math.ceil(groundDistance(a, b) / 0.18));
    for (let i = 0; i <= steps; i++) {
      if (
        !canStand(
          this.chunks,
          a.x + ((b.x - a.x) * i) / steps,
          a.z + ((b.z - a.z) * i) / steps,
          radius,
        )
      )
        return false;
    }
    for (const box of this.boxes(a, b, "furniture", radius)) {
      if (box.max.y < 0.08 || box.min.y > 2.75) continue;
      const y = Math.max(0.08, box.min.y);
      if (segmentHitsBox({ ...a, y }, { ...b, y }, box, radius))
        return false;
    }
    return true;
  }
  sight(a: SoundPosition, b: SoundPosition) {
    if (wallsBetween(this.chunks, a, b)) return false;
    for (const kind of ["walls", "furniture"] as const)
      for (const box of this.boxes(a, b, kind))
        if (segmentHitsBox(a, b, box)) return false;
    return true;
  }
  visible(p: GroundPoint, view: EntityView) {
    const forward = new Vector3().copy(view.forward),
      up = new Vector3().copy(view.up);
    const right = new Vector3().crossVectors(forward, up).normalize();
    const tanY = Math.tan((view.fov * Math.PI) / 360),
      tanX = tanY * view.aspect;
    // Test the head, chest, knees and both shoulders against the real camera frustum.
    for (const [side, y] of [
      [0, 2.6],
      [0, 1.7],
      [0, 0.55],
      [-0.55, 1.7],
      [0.55, 1.7],
    ]) {
      const target = { x: p.x + right.x * side, y, z: p.z + right.z * side };
      const delta = new Vector3().copy(target).sub(view.position),
        depth = delta.dot(forward);
      if (
        depth <= 0 ||
        depth > 85 ||
        Math.abs(delta.dot(right)) > depth * tanX + 0.18 ||
        Math.abs(delta.dot(up)) > depth * tanY + 0.18
      )
        continue;
      if (this.sight(view.position, target)) return true;
    }
    return false;
  }
  private point(x: number, z: number) {
    return { x: (x + 0.5) * GRID, z: (z + 0.5) * GRID };
  }
  private nodeOpen(x: number, z: number) {
    const key = keyOf(x, z);
    let open = this.walkable.get(key);
    if (open === undefined)
      this.walkable.set(key, (open = this.canOccupy(this.point(x, z))));
    return open;
  }
  private nearest(p: GroundPoint, connect: boolean) {
    const x = Math.floor(p.x / GRID),
      z = Math.floor(p.z / GRID);
    const candidates = [];
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++)
        candidates.push({
          x: x + dx,
          z: z + dz,
          distance: groundDistance(p, this.point(x + dx, z + dz)),
        });
    candidates.sort((a, b) => a.distance - b.distance);
    return candidates.find(
      (n) =>
        n.distance < 1.3 &&
        this.nodeOpen(n.x, n.z) &&
        (!connect || this.clearSegment(p, this.point(n.x, n.z))),
    );
  }
  route(from: GroundPoint, to: GroundPoint): GroundPoint[] {
    if (this.clearSegment(from, to)) return [{ x: to.x, z: to.z }];
    const start = this.nearest(from, true),
      goal = this.nearest(to, false);
    if (!start || !goal) return [];
    const frontier = new Frontier(),
      costs = new Map<string, number>();
    const rank = (x: number, z: number) =>
      Math.abs(x - goal.x) + Math.abs(z - goal.z);
    const key = keyOf(start.x, start.z);
    frontier.push({ ...start, key, cost: 0, rank: rank(start.x, start.z) });
    costs.set(key, 0);
    for (let expanded = 0; frontier.size && expanded < 6000; expanded++) {
      const node = frontier.pop();
      if (node.cost !== costs.get(node.key)) continue;
      if (node.x === goal.x && node.z === goal.z) {
        const path: GroundPoint[] = [];
        for (let n: Node | undefined = node; n; n = n.parent)
          path.push(this.point(n.x, n.z));
        path.reverse();
        // String pulling preserves capsule clearance; movement checks each live segment too.
        const smooth: GroundPoint[] = [];
        let anchor = from;
        for (let i = 0; i < path.length; ) {
          let far = i;
          for (let j = i + 1; j < Math.min(path.length, i + 14); j++) {
            if (!this.clearSegment(anchor, path[j])) break;
            far = j;
          }
          smooth.push(path[far]);
          anchor = path[far];
          i = far + 1;
        }
        if (this.clearSegment(anchor, to)) smooth.push({ x: to.x, z: to.z });
        return smooth;
      }
      for (const [dx, dz] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ]) {
        const x = node.x + dx,
          z = node.z + dz,
          key = keyOf(x, z),
          cost = node.cost + 1;
        if (cost >= (costs.get(key) ?? Infinity) || !this.nodeOpen(x, z))
          continue;
        if (!this.clearSegment(this.point(node.x, node.z), this.point(x, z)))
          continue;
        costs.set(key, cost);
        frontier.push({
          x,
          z,
          key,
          cost,
          rank: cost + rank(x, z),
          parent: node,
        });
      }
    }
    return [];
  }
}
