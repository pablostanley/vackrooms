import { transmission, wallsBetween, type SoundPosition } from "./acoustics";
import { CELL, cellAt, directions, type ChunkData } from "./maze";

/** A small, resident-only doorway search. At most 85 cells (six gates) per query. */
export function soundPath(
  chunks: Map<string, ChunkData>,
  listener: SoundPosition,
  source: SoundPosition,
) {
  const distance = Math.hypot(source.x - listener.x, source.y - listener.y, source.z - listener.z);
  const direct = { ...transmission(wallsBetween(chunks, listener, source), distance), position: source, distance };
  if (!cellAt(chunks, listener.x, listener.z) || !cellAt(chunks, source.x, source.z) || distance >= 32)
    return { ...direct, gain: 0 };
  if (direct.gain === 1 || distance > 24) return direct;

  const sx = Math.floor(listener.x / CELL), sz = Math.floor(listener.z / CELL);
  const tx = Math.floor(source.x / CELL), tz = Math.floor(source.z / CELL);
  const center = (x: number, z: number): SoundPosition => ({ x: (x + 0.5) * CELL, y: listener.y, z: (z + 0.5) * CELL });
  const start = center(sx, sz), end = center(tx, tz);
  const endpoints = Math.hypot(start.x - listener.x, start.z - listener.z) +
    Math.hypot(end.x - source.x, end.z - source.z);
  const queue = [{ x: sx, z: sz, gates: 0, doorway: start }];
  const visited = new Set([`${sx},${sz}`]);
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (current.x === tx && current.z === tz) {
      const routedDistance = Math.max(distance, Math.hypot(current.gates * CELL + endpoints, source.y - listener.y));
      if (routedDistance >= 32) return direct;
      // Diffraction loses high frequencies and energy with the extra travel.
      const detour = routedDistance - distance;
      const gain = 0.68 / (1 + detour * 0.11);
      if (gain <= direct.gain) return direct;
      return { gain, cutoff: 2600 / (1 + detour * 0.09), position: current.doorway, distance: routedDistance };
    }
    if (current.gates === 6) continue;
    const p = center(current.x, current.z), cell = cellAt(chunks, p.x, p.z)!;
    for (const direction of directions) {
      if (!(cell.bits & direction.bit)) continue;
      const x = current.x + direction.dx, z = current.z + direction.dz, key = `${x},${z}`;
      if (visited.has(key)) continue;
      const nextPosition = center(x, z), next = cellAt(chunks, nextPosition.x, nextPosition.z);
      if (!next || !(next.bits & direction.opposite)) continue;
      visited.add(key);
      queue.push({ x, z, gates: current.gates + 1, doorway: current.gates === 0
        ? { x: (p.x + nextPosition.x) / 2, y: listener.y, z: (p.z + nextPosition.z) / 2 }
        : current.doorway });
    }
  }
  return direct;
}
