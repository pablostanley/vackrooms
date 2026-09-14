# vackrooms

An endless first-person backrooms game, presented as a damaged VHS recording. Built with Next.js App Router, Three.js, Rapier, and [vgpu](https://github.com/vercel-labs/vgpu).

## Run

```sh
npm ci
npm run dev
```

Open http://localhost:3000. A WebGPU-capable browser with hardware acceleration runs the vgpu pipeline. WebGL2 browsers use a GLSL compatibility pass. No service keys or downloaded assets are needed; materials, architecture, and audio are generated locally.

## Controls

| Input                        | Action                             |
| ---------------------------- | ---------------------------------- |
| WASD / arrow keys            | Walk                               |
| Mouse / click and drag       | Look                               |
| Shift                        | Run                                |
| F                            | Toggle flashlight (off by default) |
| Hold E near an unstable wall | Noclip to a deeper level           |
| Escape                       | Pause                              |

Touch devices have a movement stick, swipe-to-look, and contextual action buttons. The unbranded, translucent camcorder HUD uses Geist Mono; supporting setup text uses Geist Sans. One viewport-based scale controls the HUD type, spacing, icons, and viewfinder marks. Main rooms use sickly-yellow fluorescent illumination with soft cast shadows and restrained damp-brown floors. Icon controls expose sound, flashlight, pause, and setup. The date reads June 18, 1994; the simulated battery starts at 22% and drains with recording time. Setup includes sound, sensitivity, tape damage, and a steady camera option. System reduced-motion preferences are respected. The sound starts with the user's first interaction and pauses with the game.

## How it works

- `src/lib/game/maze.ts`: seeded, connected maze sections. Shared boundary hashes keep gates aligned across streaming and regeneration. A spanning tree guarantees a path through every room; additional openings create nonsensical office spaces and loops.
- `src/lib/game/furniture-models.ts`: sofas, tables, lamps, slides, spring horses, alphabet blocks, and chairs, built from batched procedural geometry.
- `src/lib/game/furniture-layout.ts`: solid attachment anchors keep every stacked chair leg embedded in the seat below. Arbitrarily rotated wall/ceiling props intersect the architecture, with reserved walking lanes through each room.
- `src/lib/game/world.ts`: batched architecture, ceiling panels, wallpaper, furniture, faded service areas, and unstable walls. A 3×3 window of sections streams around the player and disposes sections left behind.
- `src/lib/game/engine.ts`: Three.js PointerLockControls, camera feedback, streaming, unseen room changes, noclipping, and an entity that searches the maze when the player looks away.
- `src/lib/game/physics.ts`: Rapier kinematic capsule movement, wall sliding, gravity, automatic small steps, and floor contact. Fixed colliders stream and dispose with each maze section.
- `src/lib/game/renderer.ts`: `vgpu/three` turns exported WGSL helpers into Three.js TSL nodes using `tslExports`. A Three.js `RenderPipeline` samples the scene through `tapeWarp`, softens detail, blooms fluorescent highlights, offsets RGB channels, and grades every frame through `tapeGrade`. The GPU never copies the camera image back to the CPU.
- `src/lib/game/tape-overlay.ts`: lightweight grain plates and scanline losses rendered over the camcorder HUD. Brief horizontal tears replace sustained wavy transitions; steady camera suppresses their motion.
- `src/shaders/tape.wgsl`: reusable VHS warping, tracking, grain, scanlines, vignette, and anomaly distortion. The complete vgpu shader artifact preserves exports through the Next.js WGSL loader.
- `src/lib/game/audio.ts`: synthesized fluorescent hum, ventilation, alternating carpet/tile footsteps, distant sounds, and transition interference using Web Audio.

Add `?tape=199307` to reproduce a starting maze. SETUP → COPY TAPE LINK shares the seed, not the player's current position. The initial visual composition is intentional; later sections vary with the tape and depth. On revisiting unloaded sections their base layout regenerates; unseen temporary mutations are bounded to resident sections.

## Vercel

Next.js statically renders the shell. The browser owns the interactive world. Vercel Web Analytics and Speed Insights are included; enable them in the linked Vercel project dashboard to collect deployment data. There is no artificial backend dependency in the game loop.

```sh
npx vercel@latest deploy --yes
```

## Validation

```sh
npm test
npm run typecheck
npm run lint
npm run check:shaders
npm run build
```

Rapier tests exercise wall sliding, floor contact, streaming, and teleportation. The maze tests cover reachability, paired edges, deterministic generation, regeneration-compatible gates, and closed-wall collision. `check:shaders` requires actual WGSL validation; a successful Next.js build alone is not shader validation. The browser preview must also be checked for real GPU rendering and interaction.

The current game includes procedural offices, service areas, archives, small abandoned basins, stacked/clipped furniture, noclip transitions, and stalking behavior. Large swimming pools, traversable vertical drops, and advanced platforming are future extensions.
