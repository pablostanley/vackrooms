# Submerged colonnade

This original poolroom composition draws on the excessive pillars and purposeless
spatial arrangements described in [Wikidot's Level 37](https://backrooms-wiki.wikidot.com/level-37).
It retains this game's warm, smooth, fluorescent surfaces; it does not reproduce
the wiki's tiled or blue appearance, images, or prose.

Generation 2 selects one fifth of non-origin poolrooms by tape seed and coordinates.
The selection is stable across regeneration depths. Generation 1 and every origin
pool retain their existing composition. This PR is stacked on generation-version
PR #58 and must land after it.

Six 1.1 m square piers rise from the existing -1.4 m basin floor to the unchanged
6.8 m ceiling. Three connecting beams begin 5.8 m above the deck. Sporting lane
marks are omitted in this variant. All nine solids remain inside the established
16 × 25 m basin: 3.45 m remains between the architecture and each side rim, and
4.95 m at each end. The complete dry deck, coping, water level, basin jump boost,
water-footstep region, and lighting remain unchanged.

Nine boxes add 108 triangles and nine colliders; removing fifteen lane-mark planes
makes the net increase 78 triangles. Existing cream material batches absorb the
geometry. There are no additional draw batches, lights, materials, textures, or
water meshes. Normal section disposal owns all geometry.

Tests retain pre-change generation-1 full-chunk and pool-owned collider goldens, verify rare stable
selection, bound every added collider, compare water geometry and lighting, count
triangles/batches, check disposal, walk the full dry perimeter with Rapier, collide
with a pier and pass between the rows, classify dry/wet footsteps, and enter/escape
every pool edge and corner at 30/60/144 Hz.

Review fixture: tape 199307, generation 2, section (-2,-2), with another at (1,1).
Browser verification of both renderers is pending the shared GPU test slot.
