import type { EntityVariant } from "./entity-anatomy";
import { sculptEntity } from "./entity-model";

type Request = { variant: EntityVariant; seed: number };

self.onmessage = ({ data }: MessageEvent<Request>) => {
  const surface = sculptEntity(data.variant, data.seed);
  (self as unknown as Worker).postMessage({ ...data, surface }, [
    surface.position.buffer, surface.normal.buffer, surface.skinIndex.buffer,
    surface.skinWeight.buffer, surface.index.buffer,
  ]);
};
