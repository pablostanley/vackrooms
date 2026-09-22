# Exact creature mesh indexing

The marching-cubes surface is unchanged. After skinning, vertices share an index
only when every bit of position, normal, bone index, and bone weight matches.
Triangle order is retained. There is no distance threshold, simplification,
normal recomputation, skeleton change, or altered influence ranking.

Measurements on the development machine, Node/tsx, five constructions per variant
from `ce5e024` before indexing:

| Variant | Median construction | Emitted vertices | Exact unique vertices | Original attribute bytes | Indexed attribute + index bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Stalker | 503 ms | 91,224 | 15,247 | 4,378,752 | 914,304 |
| Pyramid | 440 ms | 79,716 | 13,329 | 3,826,368 | 799,224 |

Together, resident geometry buffers fall from 8,205,120 to 1,713,528 bytes,
a 79.1% reduction (6,491,592 bytes). These arrays also upload to GPU buffers, so
the geometry-buffer saving applies there too; this does not measure total GPU
memory, driver allocation overhead, or transient startup memory.

The string-key prototype required about 64 ms and 53 ms respectively to identify
exact duplicates, adding roughly 0.12 seconds of construction work for the pair.
The integrated implementation measured median construction times of 565 ms
and 491 ms in a second five-run sample, consistent with that estimate.
This is a deliberate startup/memory tradeoff. Fewer unique vertex inputs can
reduce skinning work, but no frame-rate improvement is claimed from these counts.

Tests expand both indexed meshes and compare complete triangle attribute hashes
to the baseline, compare every posed triangle vertex through idle, walk and grab,
and retain the normalized-weight tests. Independent fixtures cover signed zero,
attribute seams, and the fallback to 32-bit indices for large generated meshes.
