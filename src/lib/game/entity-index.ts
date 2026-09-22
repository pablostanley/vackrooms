import * as THREE from "three";

/** Compact generated creature triangles only when every attribute bit matches.
 * No tolerance welding: nearby fingers, hard normals and skin weights stay distinct.
 * Call once before upload; original triangle order remains in the index buffer.
 */
export function indexEntityGeometry(geometry: THREE.BufferGeometry) {
  const attributes = Object.entries(geometry.attributes) as [string, THREE.BufferAttribute][];
  const count = geometry.getAttribute("position").count;
  const words = attributes.map(([, attribute]) => {
    const array = attribute.array;
    // Integer views retain signed zero and all float bits in the comparison key.
    const view = array.BYTES_PER_ELEMENT >= 4
      ? new Uint32Array(array.buffer, array.byteOffset, array.byteLength / 4)
      : array.BYTES_PER_ELEMENT === 2
        ? new Uint16Array(array.buffer, array.byteOffset, array.byteLength / 2)
        : new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    return { view, stride: attribute.itemSize * array.BYTES_PER_ELEMENT / view.BYTES_PER_ELEMENT };
  });
  const unique = new Map<string, number>();
  const sourceVertices: number[] = [];
  const indices = new Uint32Array(count);
  for (let vertex = 0; vertex < count; vertex++) {
    let key = "";
    for (const { view, stride } of words)
      for (let component = 0; component < stride; component++)
        key += view[vertex * stride + component] + ",";
    let index = unique.get(key);
    if (index === undefined) {
      index = sourceVertices.length;
      unique.set(key, index);
      sourceVertices.push(vertex);
    }
    indices[vertex] = index;
  }
  for (const [name, attribute] of attributes) {
    const array = attribute.array.slice(0, sourceVertices.length * attribute.itemSize);
    for (let vertex = 0; vertex < sourceVertices.length; vertex++)
      for (let component = 0; component < attribute.itemSize; component++)
        array[vertex * attribute.itemSize + component] =
          attribute.array[sourceVertices[vertex] * attribute.itemSize + component];
    geometry.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize, attribute.normalized));
  }
  // The generated surface budget can exceed 65,535 distinct vertices.
  geometry.setIndex(new THREE.BufferAttribute(
    sourceVertices.length <= 65535 ? new Uint16Array(indices) : indices, 1,
  ));
  return geometry;
}
