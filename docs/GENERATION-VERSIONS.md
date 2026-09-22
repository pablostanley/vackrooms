# Interior generation versions

Generation 2 changes only the section's interior RNG seed. Sequential coordinate
mixing removes the old shared hash's structural opposite-coordinate collisions.
That RNG controls the interior maze, theme, and downstream section furnishings.
Global `hash`, landmark cadence and selection, landmark shapes, and boundary gates
intentionally retain their legacy algorithms. Both generations join the same
boundary gates, including at negative coordinates and different regeneration depths.

The old XOR hash made every odd/odd coordinate pair share a seed with its opposite,
regardless of tape number. In the baseline, tape 48 sections (3,1) and (-3,-1)
have identical 144-cell layouts and all 44 furniture records. Generation 2 gives
these sections different interiors and furniture while remaining repeatable.
This is a diversity improvement, not a cryptographic hash or a guarantee that no
32-bit seeds can ever collide.

## Tape links

- Existing valid `?tape=199307` links without a version use generation 1.
- A new visit without a valid tape starts generation 2 and chooses a new tape seed.
- Explicit `generation=1` or `generation=2` selects that version.
- Unsupported explicit versions (including empty values) fall back to generation 1.
- Copying a tape always writes both `tape` and `generation`. The compatible-camera
  retry, next-life tape, and subsequent reload preserve the active version.

Version 1 remains the default for direct generator and engine callers to preserve
existing tests and integrations. The browser explicitly selects its parsed version.
No HUD or settings controls are added. Existing generation-1 layouts are unchanged
by this PR; future changes to either generation's algorithm must account for shared
tape compatibility separately.

Verification covers full pre-change v1 chunk goldens, deterministic v2 regeneration,
4,608 opposite-coordinate seed pairs, actual furniture diversity, connected cell
graphs, matching cross-version/depth boundary gates, URL parsing/copying, and
next-life version persistence.

Browser verification (local WebGL): tape 48 generation 2 copied and reloaded with
the same origin chunk seed; an unversioned tape 48 opened and copied as generation
1; a fresh visit selected generation 2. Temporary instrumentation invoked the real
respawn method and confirmed its new tape URL retained generation 2. A deliberately
triggered error exposed the actual compatibility-mode button; clicking it preserved
the fresh tape seed, generation, and chunk seed. The warm office scene was visually
inspected. Temporary instrumentation was removed before committing.
