interface Coordinates { x: number; z: number }

/** Evict before constructing replacements: even a diagonal step keeps at most
 * nine section graphs and collider sets alive. Callbacks synchronously update
 * the supplied map and the scene/navigation/physics owners together.
 */
export function updateResidentSections(
  resident: ReadonlyMap<string, Coordinates>,
  cx: number,
  cz: number,
  remove: (key: string) => void,
  add: (key: string, x: number, z: number) => void,
) {
  for (const [key, data] of resident)
    if (Math.abs(data.x - cx) > 1 || Math.abs(data.z - cz) > 1) remove(key);
  // Keep the established row-major creation order for seeded placement and
  // subsequent unseen-section mutation selection.
  for (let z = cz - 1; z <= cz + 1; z++)
    for (let x = cx - 1; x <= cx + 1; x++) {
      const key = `${x},${z}`;
      if (!resident.has(key)) add(key, x, z);
    }
}
