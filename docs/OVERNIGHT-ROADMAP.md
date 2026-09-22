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

## Refinement emphasis

User follow-up: improve existing content as well as adding new content. After the initial additions, prioritize audits of creature animation/model quality, texture repetition and sampling, existing room proportions, shadow quality, and generation/streaming costs. Implement evidenced improvements in separate PRs; do not inflate room or asset counts for their own sake.

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
| Rooms | `codex/overnight-rooms` | Maze/landmark office annex and focused tests | PR #44, verified |
| Furniture | `codex/overnight-furniture` | Furniture models/layout and minimal world prop selection | PR #43, verified |
| Sound | `codex/overnight-sound` | Audio and independent room ambience module | PR #42, verified |

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


### First batch (in review)

- [#42 Room ambience](https://github.com/pablostanley/vackrooms/pull/42): 154 tests/typecheck/lint/build pass. Browser confirms active audio signal and pause suspends context; mute/resume restores silence and signal correctly.
- [#43 Office props](https://github.com/pablostanley/vackrooms/pull/43): 152 tests/typecheck/lint/build pass; cooler, copier and archive cartons visually inspected in actual seeded sections. Temporary local camera placement used for QA, removed afterward.
- [#44 Office annex](https://github.com/pablostanley/vackrooms/pull/44): 153 tests/typecheck/lint/build pass. WebGL and WebGPU inspected; fixed jagged blind shadow artifacts found during browser review.
- [#45 Environmental discoveries](https://github.com/pablostanley/vackrooms/pull/45): 155 tests/typecheck/lint/build pass; independent code review found no issues; close-up browser legibility verified.
- [#46 Warehouse annex](https://github.com/pablostanley/vackrooms/pull/46): 154 tests/typecheck/lint/build pass; interior browser check passed.

Next audits assigned: existing creature locomotion smoothing; texture/lighting quality; map architecture and streaming performance. Combined integration branch is for validation, not an additional feature PR.


### Existing-content refinement batch

- [#47 Cream acoustic ceilings](https://github.com/pablostanley/vackrooms/pull/47): same-camera WebGL comparison approved; combined WebGPU rendering also inspected.
- [#48 Exact-output generation optimization](https://github.com/pablostanley/vackrooms/pull/48): original classification and chunk comparison preserved; local 2,000-chunk CPU benchmark median 649 to 116 ms. This is not a whole-game frame-rate claim.
- [#49 Creature locomotion](https://github.com/pablostanley/vackrooms/pull/49): smoother foot lift/contact and shortest-arc turn interpolation; stalk/attack browser previews still work and attack completes through normal tape reset.
- [#50 Bounded streaming](https://github.com/pablostanley/vackrooms/pull/50): evict departures before constructing replacements; intermediate allocations remain at most nine. Real-browser corridor crossing and five relocation checks passed.
- Confirmed follow-up: WebGL postprocessing omits tone mapping and uses an 8-bit intermediate, causing visible changes when effects toggle. Isolated correction is being checked with actual browser pixel comparisons.

Combined branch `codex/overnight-integration` is pushed for validation only. First five implementation branches passed 165 combined tests, TypeScript, lint, all shader validation and production build. The refinement batch is now included and undergoing another focused combined pass. All feature PRs remain unmerged.

Local browser evidence is saved under the task's visualization directory in `overnight/`; it includes before/after ceilings, both-renderer annex views, props, warehouse, close-up note, and creature preview recording.


### Verification checkpoint, 05:55 UTC

The combined refinement branch passes 172 tests. #50 also passed actual browser corridor crossing through the game loop/Rapier and five programmatic streaming-window relocations. Every observed scene/chunk/navigation/physics map stayed at nine or fewer, and final keys agreed. This confirms streaming behavior, not just the pure helper tests.

The deployed integration preview at commit `0c1fec4` was authenticated through Vercel's connected account, loaded in a real browser, and passed Record/Escape smoke checks with no runtime errors: [verified preview](https://vackrooms-kuxtihfjl-pablostanley.vercel.app/?tape=199307). This particular deployment predates #50; later integrated commits must be reverified before describing them as the same build.

PRs #42–#50 are attached to the main task (subagent attachments alone did not appear there). All checked GitHub test/build/deployment statuses and Vercel agent reviews pass. Main remains unchanged. The only combined source conflict was the office/warehouse union in `maze.ts` and `landmarks.ts`; the pushed integration branch contains the reviewed union resolution.

Remaining active work: WebGL tone-mapping/capability correction; measure whether existing creature skin geometry offers a worthwhile appearance-preserving startup/memory improvement. Do not begin more new room types until these refinements and combined verification are finished.


### Refinement checkpoint, 06:06 UTC

- [#51 WebGL output consistency](https://github.com/pablostanley/vackrooms/pull/51): correct HDR intermediate/tone mapping and disable unsupported contact AO on devices lacking float render targets. Independent review caught the fluorescent materials’ per-material tone-mapping exception; the follow-up normalizes their authored radiance and tests actual fixtures. Final review ongoing.
- [#52 Exact creature geometry indexing](https://github.com/pablostanley/vackrooms/pull/52): identical triangle attributes and posed deformation, 8,205,120 to 1,713,528 bytes of geometry buffers (79.1% lower). Adds roughly 0.12 seconds of construction for the pair; no FPS claim. Both creature variants inspected in the integrated browser on WebGL/WebGPU with no errors. Combined branch at `538b153` passes 175 tests before #51.

Further lore research suggests improving existing spaces before creating more categories:

| Reference | Existing space to refine | Candidate, not yet implemented |
| --- | --- | --- |
| [Wikidot Level 2](https://backrooms-wiki.wikidot.com/level-2) | Service halls and corridor | More coherent pipe junctions, valves and quiet machinery; preserve navigation clearance and our brighter lighting. |
| [Wikidot Manila Room](https://backrooms-wiki.wikidot.com/manila-room) | Archive/dead-end office | Rare table-and-document composition using original notes; current environmental discoveries already provide a first small adaptation. Avoid adding another room classification just for this. |
| [Wikidot Level 6.1](https://backrooms-wiki.wikidot.com/level-6-1) | Existing food court | Improve anonymous vending-machine and shuttered-counter silhouettes. Keep our warm palette and sparse layout; no copied music, branding or article text. |

Next review is an evidence-led texture sampling/seam audit. No new room type is queued while rendering consistency remains under review.


### Combined rendering verification

Integration commit `cec6d48` includes #42–#52. It passes TypeScript, lint, all four required shader checks and production build. The 175-test combined suite passed immediately before #51, whose own final 151-test suite also passed. Real-browser settings toggles preserve warm, bright fixtures; both effects can be turned off and back on. The new [deployed preview](https://vackrooms-n8552slou-pablostanley.vercel.app/?tape=199307) passed Record/Escape with no browser errors. #51 and #52 CI/deployment/review checks pass.

The next evidenced fix addresses existing baked floor-contact shadows: some planes face down, vertical-wall fades use the wrong axis, and the nonperiodic gradient repeats at its edge. This is isolated from the completed tone-mapping change. An independent furniture/collider audit is also underway.


### Active follow-up refinements

- Floor-contact shadow correction: all four wall sides now face upward and fade away from the wall; the gradient clamps instead of repeating. Before/after browser corner views preserve subtle grounding and bright carpet. [#53](https://github.com/pablostanley/vackrooms/pull/53) passes 153 tests, TypeScript, lint, build and all shader validations; integrated at `170d31c`.
- Existing utility-cart/computer-desk collision: reproduced grounded feet above visible surfaces because whole-object bounds include empty space. An isolated fix keeps broad entity-navigation bounds while using existing solid-part hulls for player collision. Real Rapier landing tests and browser verification are in progress. Review rejected using all 98 cosmetic desk parts as physical hulls; the fix will use compact major solids instead.

These are corrections to existing geometry and physics, not additional room or asset categories.


### Collision refinement checkpoint

[#54](https://github.com/pablostanley/vackrooms/pull/54) fixes existing desk/cart ghost platforms. Desks use 9 major physical solids rather than 98 decorative parts; carts use 15 parts. All 155 branch tests, typecheck, lint and build pass. Actual browser Space/W/S input after temporary starting-position setup lands on both visible surfaces and walks back onto the floor. Coarse entity-navigation bounds and rendered geometry are unchanged. Integration `4e5b8c0` resolves an import-only conflict by retaining discovery and collision imports.

A further architecture audit reproduced missing neighborhood roof collision: double-jumping onto a house can leave the player grounded on its flat body inside the visible pitched roof. A separate correction is in progress. After it lands, run a 20-minute combined browser resource soak: fixed tape, explicitly programmatic route relocations, normal live game loop, pause/resume and existing lifecycle disposal, resident-map limits, section ownership, and comparable renderer-resource counters. Do not equate those counters with measured VRAM.


### Full batch ready for sustained verification

[#55](https://github.com/pablostanley/vackrooms/pull/55) adds collision matching the existing neighborhood roof slopes. All 152 branch tests, types, lint and build pass, including ten house jump/return cases. Real-browser verification confirms the player lands outside the sealed house and can return to the street; rendered roofs are unchanged.

Integration `e27d279` now includes all implementation PRs #42–#55. All 182 combined tests, TypeScript, lint, four shader validations and the production build pass. The approved 20-minute browser soak is live at this exact commit in `/Users/pablostanley/.codex/worktrees/vackrooms-overnight-soak`, browser session `vackrooms-soak`, port 3029. Its harness and results live in `/Users/pablostanley/.codex/visualizations/2026/09/22/vackrooms-soak/`. It uses existing engine pause/rebuildWorld/start lifecycle, nine seeded room variants, and six cycles. Do not restart a live run because an observation call times out. Roadmap PR #41 and all fourteen implementation PRs are attached to the main task. Main and production remain unchanged.

CI checkpoint: all checked statuses on #42–#54 pass; #55 test/build/deployment checks pass and its automated review now also passes. No failed checks.


## Review and integration notes

All implementation PRs target main independently. The validation branch combines them in numerical order, #42 through #55; its tested tip is `e27d279`. No feature depends on merging the roadmap document first.

Two overlapping areas required explicit union resolutions during integration:

- Office and warehouse variants both extend landmark metadata and dispatch. Keep both optional fields, both variant decisions, and both builders/imports. The integration commit `1e9e8a1` records this resolution.
- Discovery and furniture-collision modules both add an import at the same location in `world.ts`. Keep both imports, as in `4e5b8c0`.

Other overlapping changes merged automatically; the full combined checks validate that result. Use the tested integration source as the resolution reference if merging individual PRs in the morning. Do not infer that separate green PRs alone prove their combination.

The final batch's deployment is ready at [e27d279 preview](https://vackrooms-1n9pz0sdr-pablostanley.vercel.app/?tape=199307). Its deployed browser smoke is still pending until the resource soak releases the browser slot; the earlier documented preview remains the one already browser-verified.


### Navigation refinement and next content pass

[#56](https://github.com/pablostanley/vackrooms/pull/56) adds a 32-entry exact-endpoint failed-route cache, cleared on every navigation reindex. A real tape-48 pursuing simulation makes the same 33 requests but searches once instead of 33 times; its complete behavior trace is unchanged. A single local CPU sample changed from 533 to 51 ms, not an FPS claim. All 156 branch tests/types/lint/build pass; integration `bf18f40` passes 187 combined tests. The running soak remains pinned to `e27d279`, so its results must not be attributed to this later commit.

The next content pass is an original hotel service corridor within the existing three-section corridor layout, inspired by Level 5 research above. It preserves cadence, cells, heights and gates; adds shallow cream/wood trim, sealed doors, frosted transoms and a shared number atlas; and uses no additional dynamic lights. Implementation is isolated and browser checks will wait for the soak to finish.


### Sustained browser result

The 20-minute WebGL soak of `e27d279` passed: 1,200.003 seconds, 306 snapshots, 54 explicitly programmatic relocations, six existing world rebuilds, and six synthetic-keyboard corridor crossings through normal Rapier movement. All five resident maps peaked at nine and agreed on keys. Of 466 tracked section identities, 457 retired sections were disposed exactly once and nine remained resident. Six identical paused snapshots held 150 geometries, 53 textures and 19 shader programs. Fresh seed/depth equality was explicitly checked on all nine rebuilt chunks in cycles 2–6. Six audio suspend/resume cycles passed; no errors or failures.

Scope limits: entities were disabled, no live CRT screen was active, and this was WebGL. Stable resource counters are not a measurement of total GPU memory or proof about every device. The later navigation-cache commit and in-progress hotel variant are not covered by this exact soak. QA checkout is clean; hooks, browser and server were removed/stopped. Full evidence is in `/Users/pablostanley/.codex/visualizations/2026/09/22/vackrooms-soak/RESULTS.md` and `report-final.json`.


### Hotel corridor delivered

[#57](https://github.com/pablostanley/vackrooms/pull/57) adds original numbered doors, frosted transoms, cream/wood joinery and a shallow key cupboard to rare existing corridor runs. Independent review compared another 3,410 chunks; topology is unchanged. Branch 155 tests/types/lint/build and real WebGL/WebGPU visual/traversal checks pass. The fixture follow-up `8ca15aa` accommodates the roof PR’s new shaped-collider field in the combined build.

Integration `3dc53c1` includes #42–#57: 191 runtime tests pass, followed by typecheck, lint, all shader validations and production build. The first combined hotel typecheck caught the fixture mismatch; it was corrected, not bypassed. Hotel integration preserves both development visit aliases, all landmark variant fields, and both note/number material owners and disposers. [Verified deployed preview](https://vackrooms-kcv2v8rx4-pablostanley.vercel.app/?tape=199307) passed Record/Escape with no errors; the local combined hotel view was also inspected.

### Next architecture correction: versioned interior randomness

Audit found structural coordinate-hash collisions: 2,328 of 6,912 sampled opposite-coordinate pairs shared a hash, including all sampled odd/odd pairs. Tape 48 sections `(3,1)` and `(-3,-1)` had identical 144-cell layouts and 44 furniture records. An unversioned shared-hash replacement would also move gates and landmark cadence, so it is not being used.

An isolated generation-v2 PR is in progress. It changes only the chunk interior RNG seed using sequential coordinate mixing, retains existing global gate/cadence rules, and carries an explicit version through tape links, next life and compatible-camera retry. Existing tape links without a version retain the legacy generator; fresh visits use v2. The new PR must prove v1 output is unchanged relative to its base. The separate content additions in this overnight batch are not a promise that all historical game versions rendered identical worlds.

Next complementary QA: 24-minute actual WebGPU/live-CRT lifecycle and settings/resize coverage on the final v2 combined commit. It is prepared but has not started; routes must be recomputed for v2.

### Versioned map diversity delivered

[#58](https://github.com/pablostanley/vackrooms/pull/58) fixes opposite-coordinate interior-seed collisions with generation v2. Fresh visits use v2; existing unversioned tape links use v1. Copy, reload, next life and compatible-camera retry carry the version. Shared gates and landmark cadence remain unchanged. Independent complete-chunk comparisons covered 4,410 cases against both the PR base and the pre-v2 integration: implicit and explicit v1 outputs match exactly. Branch browser checks covered both versions, copy/reload, respawn and retry.

Integration `cb6ddcf` combines #42–#58 and passes all 198 tests, typecheck, lint, all four shader validations and production build. Its merge retains both development visit aliases and eviction-before-creation streaming, passing the selected generation through every chunk-generation call. The combined local browser passed Record/Escape for legacy tape 48 and explicit generation 2. The [current verified deployed preview](https://vackrooms-h0hc2u6sx-pablostanley.vercel.app/?tape=48&generation=2) also passed Record/Escape without browser errors.

The 24-minute WebGPU/live-CRT QA has been dispatched against this exact integration commit; it must establish a real start before being called a running or completed test. Two parallel read-only audits now inspect existing texture/material correctness and creature behavior. Further implementation requires a concrete defect and bounded fix, rather than a target PR count.
