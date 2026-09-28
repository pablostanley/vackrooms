# Room shapes (generation 2)

Generation 2 sections vary their ordinary rooms without changing how the maze
connects. Everything is planned in `room-shapes.ts` from its own seeded streams,
so themes, furnishing seeds, landmarks, and section gates stay as they were.
Generation 1 tapes are untouched: none of this data exists for them.

- **Irregular open rooms.** One or two L, T, S, or cross footprints per section
  open their internal walls. Walls are only removed, never added.
- **Ceiling zones.** Low rooms (2.45–2.75 m), tall rooms (4.2–5.4 m), halls
  (6.2–7.6 m), and single-cell shafts (10.5–16 m). Section-border cells, cells
  touching a landmark, and the opening route stay at the standard 3.15 m, so the
  one section that builds a shared wall always agrees with its neighbor. Headers
  between unequal ceilings start at the lower ceiling, in the renderer, Rapier,
  entity navigation, and acoustics alike. Shafts show bands and wall tubes at
  every storey they never built.
- **Angled corners.** Chamfers and long skews seal dead corners between two
  closed walls. The face sits on the room faces of those walls; a triangular
  Rapier prism fills the sealed corner; `canStand` respects it. A cut is only
  kept when the cell center and every open doorway lane stay clear.
- **Stairs to nowhere.** In some tall rooms, carpeted steps (0.19 m risers)
  climb a closed wall to a framed door that opens onto plaster.
- **Inflatable play areas.** About one section in five hands 3–6 connected cells
  to a bouncy castle: glossy vinyl floor, puffed tube walls, corner turrets,
  arches over the doorways back into the office, and kickable giant balls under
  the usual fluorescent ceiling. Jumps there take off at 8.9 m/s (the pool uses
  9.6). The vinyl palette is warm and never blue.

Angled, stair, and play cells skip ordinary dressing (furniture, computers,
pillars, portals). Low ceilings refuse furniture and chair piles that would not fit.
