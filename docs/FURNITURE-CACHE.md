# Furniture prototype lifetime

Each material owner keeps a lazy `FurnitureLibrary`. Its finite inventory has
21 furniture kinds. The 18 non-computer kinds each have three seeded designs
(`furnitureVariants`), the three computers have one, and each lamp design has a
lit state: at most 60 prototypes. Designs wrap modulo three, other kinds
canonicalize the lamp flag, and unknown kinds are rejected. Prototypes use that
owner's existing material objects; they are never shared between engines.

A design is an authored shape (for example a ladder-, spindle- or padded-back
dining chair; a two-seat, three-seat or armchair sofa) plus small proportion
changes from a seed of the kind and design number, so the same design is the
same everywhere. Placement picks a design from the section's furniture stream.

Section construction clones each prototype part before projecting UVs or applying
placement. Final batches and collider bounds follow the existing paths. Section
disposal owns these cloned and merged geometries; material-owner disposal frees
prototype geometries once, before disposing shared materials. A disposed library
cannot create more prototypes. The library owns no textures or GPU resources.

The full current inventory retains 3,857,328 bytes of vertex/index arrays (about
3.68 MiB), plus JavaScript geometry/object overhead. The measurements below were
taken on the earlier 22-prototype inventory. These source geometries are
never attached to a render scene, so they do not add draw calls or resident GPU
vertex buffers. This deliberately trades bounded CPU memory for fewer repeated
procedural model builds when sections stream or a recording moves deeper.

A read-only instrumented experiment on integration `58373e5`, tape 48, generation
2, depth 0, nine sections around the origin compared seven alternating warmed
samples without a browser running. Median synchronous construction was 529 ms
with per-section prototypes and 403 ms with owner-local prototypes; prototype
creation was 124 ms versus 22 ms, while final merges were 27 ms versus 25 ms.
125 prototype builds became 22. These are local Node/headless-material samples,
not frame-rate claims or browser performance guarantees. The implementation PR
is stacked on furniture PR #43; integration timings include other content PRs.

Tests compare every prototype attribute, bound and material identity with the
original constructor; compare complete section geometry/material/texture/bounds/
collider output against fresh models over 18 seeded sections and two depths;
and exercise independent owners, repeated section teardown and one-time library
geometry disposal.

Browser verification passed in both confirmed WebGL and WebGPU with real textured
materials (PR branch, legacy tape 48). Five alternating nine-section samples using
fresh libraries measured median construction of 224 ms with per-section prototypes
versus 174.5 ms with owner-local prototypes; model builds fell from 107 to 22.
Batch, collider and computer counts matched. This is synchronous construction
profiling in one local browser, not a rendering/frame-rate measurement.

Programmatically streaming to (5,5), (-4,2), then the origin kept nine sections and
22 prototypes; section eviction disposed no prototype geometries. Actual engine
teardown disposed all 561 prototype geometries exactly once. Subsequent library
disposal was inert and reuse rejected. Both renderer screenshots and the returned
origin scene were inspected, with no page errors. Temporary profiling hooks were
removed.

## Placement without clipping

Section construction keeps a registry of every placed solid: furniture parts as
oriented boxes, pillars and wall shelving as boxes. Scattered props, chairs,
table seating, chair piles and computers are only accepted where their part
solids clear that registry; pillars and shelving check it too. Chair piles are
solved from the wooden chair's measured frame: an upright chair, then chairs
turned upside down, resting seat-to-seat and then on upturned legs, with each
backrest hanging outside the seat it passes. Tests check every design, style
and seed for touching support without interpenetration, and generated sections
for no furniture-furniture or furniture-fixture overlap. Deliberate wall and
ceiling embedding is unchanged.
