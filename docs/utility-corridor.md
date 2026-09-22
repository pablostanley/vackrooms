# Utility corridor

This original pipework takes inspiration from the industrial machinery, connected pipes, and fluorescent lighting in [Wikidot Level 2](https://backrooms-wiki.wikidot.com/level-2). It retains this game's warm, bright interior direction rather than importing the source's grime or lighting failures. No source prose, photography, textures, or named organizations are reproduced.

This change is stacked on the hotel corridor PR #57 and should merge after it. The existing run hash selects utilities only when its remainder modulo eight is one. Hotel runs occupy different remainders, so the two variations cannot overlap. No maze cells, gates, room heights, RNG consumption, or landmark cadence change.

Two mains align across each existing three-section corridor. Closed wall bays get at most two risers, handwheels, and shallow service boxes. Main and flange undersides stay above the creature navigation clearance; their tops stay below the existing ceiling ribs. Conservative per-part collision boxes let players walk under the pipes and leave every existing side passage, while jumps bump the visible overhead fittings. No new lights, textures, or interaction prompts are added. Geometry is merged into four existing-material batches and capped at 2,500 triangles per section.

Development review: `?tape=199307&visit=utilityCorridor` visits section (-3, -5), on the run spanning (-3…-1, -5). Check both section seams, open side branches, closed-wall valves, and jump clearance in both renderers.
