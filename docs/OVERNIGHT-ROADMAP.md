# Overnight improvement roadmap

Work window: September 21, 2026, 10:30 p.m. to September 22, 4:30 a.m. Pacific (05:30–11:30 UTC). The user authorized autonomous research, implementation, separate agents and separate PRs. PRs remain reviewable; no production merge is planned.

## Direction

Make exploration reward attention: recognizable spaces, believable objects, subtle sound changes, and rare discoveries. Preserve the oppressive fluorescent brightness, warm palette, camcorder-only interface, optional flashlight initially off, and sparse atmosphere. More content should not mean clutter in every room.

The baseline already includes seven landmark types, an indoor neighborhood, furniture anomalies, pool water, a stalker, real CRT browsing, spatial audio, procedural textures, and WebGPU/WebGL rendering. Improve these systems rather than duplicate them.

## Research and adaptation

Backrooms fiction has multiple community canons and revisions. The references below are inspiration, not a claim that vackrooms implements an authoritative canon. All new meshes, audio synthesis, and prose should be original. Do not copy wiki photographs, audio, or article text into the MIT project.

| Reference checked September 21 | Useful spatial idea | Adaptation for this game |
| --- | --- | --- |
| [Wikidot Level 0, archived 2020](https://backrooms-wiki.wikidot.com/archived:level-0-2020) | Yellow rooms, damp carpet, irregular fluorescent hum | Keep the main offices as the visual and acoustic anchor. |
| [Wikidot Level 1](https://backrooms-wiki.wikidot.com/level-1) | Warehouse/parking-like halls, pillars, service pipes, scattered crates | Future loading/storage annex with wide circulation, sparse cartons and distant pipe ticks. No mandatory blackout. |
| [Wikidot Level 4](https://backrooms-wiki.wikidot.com/level-4) | Empty office building, windows and water coolers | Rare sealed office annex, original blind-covered internal windows and cream office appliances. The source is marked as being rewritten. |
| [Wikidot Level 5](https://backrooms-wiki.wikidot.com/level-5) | Old hotel, decorated halls and boiler spaces, distant sound | Later hotel service/reception wing using warm materials and original sound; no copied music or characters. |
| [Wikidot Level 37](https://backrooms-wiki.wikidot.com/level-37) | Interconnected pools with impossible proportions | Later improve basin/column silhouettes and dry circulation. Retain our palette and no-grid-texture rule despite the source's tiled surfaces. |

## Ordered backlog

| Priority | Track | Concrete deliverable | Acceptance |
| --- | --- | --- | --- |
| P0 | Baseline | Run tests and inspect a seeded game in browser; record existing failures | Separate pre-existing issues from regressions |
| P1 | Rooms | Sparse abandoned-office annex within existing lobby cadence | Seeded, traversable, matching section gates, recognizable browser view |
| P1 | Furniture/models | Water cooler, analog copier, archive cartons | Original batched geometry, accurate bounds, doorway clearance, seed coverage |
| P1 | Sound | Smooth room-specific building-air layer | Quiet, bounded voices, deterministic variation, pause/mute/dispose verified |
| P1 | Graphics/reliability | Audit real browser WebGL/WebGPU and frame/resource behavior; fix evidenced defects | Before/after evidence and meaningful regression checks |
| P2 | Easter eggs | Rare original environmental or CRT discovery tied to tape seed | Discoverable without adding permanent HUD clutter; no network dependency |
| P2 | Rooms | Warehouse/loading annex or hotel service wing | Distinct silhouette and sound; preserve familiar landmark cadence |
| P2 | Graphics | Better spatial grounding/material detail where browser evidence warrants | Maintain bright offices, soft shadows, bounded rendering cost |
| P2 | Exploration | Make discoveries repeatable from a shared tape and document verification routes | Same seed reproduces content; no exposed debugging UI in production |
| P3 | Models | More convincing creature details or restrained animation polish | Preserve collision, navigation and readable behavior |
| P3 | Later | Swimming, ledge interactions, larger pool topology | Separate design task; avoid expanding physics scope without thorough validation |

## Work assignments

| Agent | Branch | Scope | Status |
| --- | --- | --- | --- |
| Coordinator | `codex/overnight-roadmap` | Research, roadmap, baseline, cross-branch verification | In progress |
| Rooms | `codex/overnight-rooms` | Maze/landmark office annex and focused tests | In progress |
| Furniture | `codex/overnight-furniture` | Furniture models/layout and minimal world prop selection | In progress |
| Sound | `codex/overnight-sound` | Audio and independent room ambience module | In progress |

Each implementation uses a separate worktree and PR. Coordinate shared file edits before making them. The coordinator owns browser scheduling. Follow-up batches start only after reviewing the first batch's outcomes.

## Repeating work loop

1. Read this roadmap, current branches/PRs and agent progress; do not duplicate active work.
2. Select the highest-value small unfinished item or an evidenced bug.
3. Research unfamiliar APIs from installed documentation and lore from actual source pages.
4. Implement in an isolated branch. Keep client gameplay seed-deterministic and resident sections bounded.
5. Run relevant tests, typecheck/lint and build. Validate authored WGSL with `npm run check:shaders`. Generation changes must exercise connectivity and boundary gates.
6. Inspect visual/interaction changes in a real browser, including relevant pause/settings behavior. Record exactly what was and was not verified.
7. Commit, push, open and attach a concise PR. Record results and new findings here. Do not merge or change production.
8. Reassess what is missing and repeat until the deadline; then stop new work and publish a handoff.

The task heartbeat runs every 20 minutes, attached to this task, and stops starting work at 11:30:36 UTC. It must pause itself at the deadline. Successful execution depends on the host remaining available.

## Validation and deployment rules

- Keep `vercel.json`'s existing ignore guard for the stale project.
- Vercel target: `pablostanley/vackrooms`; only share/verify preview hosts ending `-pablostanley.vercel.app`.
- Prefer `npx vercel@latest` if CLI deployment is needed; the installed global CLI is outdated.
- Do not claim listening verification from audio unit tests or claim visual quality from a build.
- Check the combined changes on a temporary integration branch before recommending a merge order.

## Results

Initial audit: clean detached checkout at `ce5e024`; no open PRs returned by `gh pr list`. Dependencies installed successfully with no reported vulnerabilities. Implementation agents started in isolated worktrees. Baseline verification is running.
