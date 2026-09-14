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

Touch devices have a movement stick, swipe-to-look, and contextual action buttons. The unbranded, translucent camcorder HUD uses Geist Mono; supporting setup text uses Geist Sans. One viewport-based scale controls the HUD type, spacing, icons, and viewfinder marks. Main rooms use sickly-yellow fluorescent illumination with soft cast shadows and restrained damp-brown floors. A single compact icon row exposes sound, flashlight, pause, and cassette settings. The date reads June 18, 1994; the simulated battery starts at 22% and drains with recording time. Setup includes sound, sensitivity, tape damage, and a steady camera option. System reduced-motion preferences are respected. The sound starts with the user's first interaction and pauses with the game.

## How it works

- `src/lib/game/maze.ts`: seeded, connected maze sections. Shared boundary hashes keep gates aligned across streaming and regeneration. A spanning tree guarantees a path through every room; additional openings create nonsensical office spaces and loops.
- `src/lib/game/landmarks.ts`: one large landmark in every 57.6m section, with ordinary offices between discoveries. Empty lobbies have 8.4m ceilings; shuttered food courts have only two tables; pool halls contain recessed 25×16m basins and continuous dry decks. Three aligned sections form 172.8m corridors. Landmark families and footprints survive unseen mutations, while the surrounding office maze changes.
- `src/lib/game/furniture-models.ts`: sofas, tables, lamps, slides, spring horses, alphabet blocks, and chairs, built from batched procedural geometry.
- `src/lib/game/furniture-layout.ts`: solid attachment anchors keep every stacked chair leg embedded in the seat below. Arbitrarily rotated wall/ceiling props intersect the architecture, with reserved walking lanes through each room.
- `src/lib/game/world.ts`: batched architecture, ceiling panels, wallpaper, furniture, faded service areas, and unstable walls. A 3×3 window of sections streams around the player and disposes sections left behind.
- `src/lib/game/engine.ts`: Three.js PointerLockControls, camera feedback, streaming, unseen room changes, noclipping, and an entity that searches the maze when the player looks away.
- `src/lib/game/physics.ts`: Rapier kinematic capsule movement, wall sliding, gravity, automatic small steps, and floor contact. Fixed colliders stream and dispose with each maze section.
- `src/lib/game/renderer.ts`: `vgpu/three` turns exported WGSL helpers into Three.js TSL nodes using `tslExports`. A Three.js `RenderPipeline` samples the scene through `tapeWarp`, softens detail, blooms fluorescent highlights, offsets RGB channels, and grades every frame through `tapeGrade`. The GPU never copies the camera image back to the CPU.
- `src/lib/game/tape-overlay.ts`: lightweight grain plates and scanline losses rendered over the camcorder HUD. Brief horizontal tears replace sustained wavy transitions; steady camera suppresses their motion.
- `src/shaders/tape.wgsl`: reusable VHS warping, tracking, grain, scanlines, vignette, and anomaly distortion. The complete vgpu shader artifact preserves exports through the Next.js WGSL loader.
- `src/shaders/water.wgsl` and `src/lib/game/pool-water.ts`: vgpu WGSL water displacement, moving caustics, view-dependent Fresnel response, and analytical reflections of the fluorescent ceiling rhythm. All resident pools share one material and animation clock; steady camera freezes water motion. WebGL uses an explicit GLSL fallback. Raised coping keeps the player on the connected deck; swimming is not implemented.
- `src/lib/game/audio.ts`: localized fluorescent fixtures and footsteps using Web Audio HRTF panning, camera-relative listening, distance falloff, and smoothly blended room reflections. Carpet stays soft; food courts and pool decks have firmer footfalls. Four nearby fixtures play at once, with up to four fading out; transient voices are capped and disposed after use. Audio suspends on pause and clears spatial sources on descent.
- `src/lib/game/acoustics.ts`: wall and doorway tracing across resident section boundaries, muffled transmission through partitions, and office/hall/pool/corridor reverb profiles. Seeded distant footsteps, duct airflow, and occasional settling noises have 52–104 seconds between opportunities, with deliberate skipped events and no entity or transition stingers. Distant footstep routes begin behind walls and follow open passages.

Ordinary visits and refreshes draw a new random tape, changing the maze and the selection and placement of furniture. Add `?tape=199307` to reproduce a particular starting maze. Cassette settings → COPY TAPE LINK shares the seed, not the player's current position. The initial visual composition is intentional; later sections vary with the tape and depth. On revisiting unloaded sections their base layout regenerates; unseen temporary mutations are bounded to resident sections.

Every tape starts in an office, with a landmark reachable along a route of at most 30m. Further sections guarantee recurring landmarks instead of relying on random rolls with potentially long gaps. Tapes `1`, `2`, `3`, and `8` introduce a lobby, poolroom, corridor, and food court respectively. Each 12-section row contains all four families. Fog hides the outer edge of the nine resident sections without adding an end wall to the long corridors.

## Vercel

Public demo: https://vackrooms.vercel.app

The public project lives in the `pablostanley` Vercel scope. The separate Internal Playground project retains its protected previews.

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

Rapier tests exercise wall sliding, floor contact, streaming, teleportation, pool coping, and walking the complete pool deck. Maze and landmark tests cover first-discovery distance across 128 tapes, recurring variety, physically connected boundary gates around furniture and pool obstacles, straight corridor seams, deterministic generation, and regeneration-compatible gates. `check:shaders` validates both the tape and water WGSL; a successful Next.js build alone is not shader validation. The browser preview must also be checked for real GPU rendering and interaction.

The current game includes procedural offices, service areas, archives, enormous lobbies, abandoned food courts, full-sized poolrooms, long corridors, stacked/clipped furniture, noclip transitions, and stalking behavior. Swimming, traversable vertical drops, and advanced platforming are future extensions.
