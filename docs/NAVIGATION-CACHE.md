# Repeated failed creature routes

A failed route is deterministic for the exact start/destination coordinates and
current resident navigation geometry. Remember up to 32 failed endpoint pairs,
evicting the oldest pair when full. Every section add, replacement, removal, or
clear invalidates the cache through the existing navigation reindex operation.
Successful paths are still generated normally and never retained by this cache.
The 6,000-node search limit, clearance checks, pursuit timing, and target selection
are unchanged.

Reproduction: tape 48, depth 0, resident sections (-1..1, -1..1), staged pursuit
from (2.4, 55.2) toward the running player at (-2.4, 60), 900 fixed steps of 1/30 s.
The apparently close destination has a 192 m route through room centers;
the bounded planner declines it. Before caching, all 33 identical
requests repeated that search. One local before/after sample on the development machine:

| Measurement | Before | After |
| --- | ---: | ---: |
| Route requests | 33 | 33 |
| Searches | 33 | 1 |
| Segment clearance checks | 204,369 | 6,193 |
| Total route-request CPU time | 533 ms | 51 ms |

An earlier combined-branch audit measured 563 ms before caching; timing varies
with load and warmup. These figures describe this reproduction, not general frame
rate. The complete phase/position/gait/heading/speed trace hashes identically
before and after. Tests also cover exact endpoint changes, every geometry
mutation, FIFO eviction, and independent successful path arrays.
