import { computerKinds } from "./computer-models";
import {
  chairKinds,
  createFurniture,
  type FurnitureKind,
  type FurnitureModel,
} from "./furniture-models";
import type { Materials } from "./materials";

/** Exhaustive finite inventory; only the lamp has a second material state. */
export const furnitureKinds = [
  ...chairKinds, "filingCabinet", "bookcase", "bench", "sideTable", "utilityCart",
  "waterCooler", "photocopier", "archiveCartons", "sofa", "table", "lamp",
  "slide", "springHorse", "blocks", ...computerKinds,
] as const satisfies readonly FurnitureKind[];
const supported = new Set<FurnitureKind>(furnitureKinds);

/** Material-owner-local immutable prototypes. Sections must clone every part. */
export class FurnitureLibrary {
  private models = new Map<string, FurnitureModel>();
  private disposed = false;

  constructor(private readonly materials: () => Materials) {}

  get(kind: FurnitureKind, lampOn = false): FurnitureModel {
    if (this.disposed) throw new Error("Furniture library is disposed");
    if (!supported.has(kind)) throw new Error(`Unknown furniture kind: ${kind}`);
    const lit = kind === "lamp" && Boolean(lampOn);
    const key = `${kind}:${lit}`;
    let model = this.models.get(key);
    if (!model) {
      model = createFurniture(kind, this.materials(), lit);
      this.models.set(key, model);
    }
    return model;
  }

  /** Dispose only prototype geometry; the material owner disposes materials. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of this.models.values())
      for (const part of model.parts) part.geometry.dispose();
    this.models.clear();
  }
}
