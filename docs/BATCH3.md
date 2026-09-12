# Repair Batch 3 — Reality → Engineering + true 3D vertical geometry

Deterministic Engineering Core owns every number. Photos never claim centimetre
accuracy. Visual ceiling hide does not remove the engineering envelope.

## 3D geometry

`Aabb3` (`src/engineering/aabb3.ts`) is the canonical XYZ box.

Collision exists only when X **and** Y **and** Z overlap. Plan overlap with
Z-separation is not a collision.

Helpers: `rackAabb3` (floor-mounted z = 0…heightM), `asBuiltAabb3`,
`roomEnvelope3`, `ceilingAabb3` (slab at z = room.heightM), `openingAabb3`
(respects `bottomElevationM` + `heightM`).

## Engineering consequences

- Confirmed as-built that intersects a rack in XYZ → warning, both IDs, rack
  marked `blocked`, `usableCapacity` excludes that rack. SAFE uses
  `usableCapacity` when racks are placed — only if rack/space is the
  bottleneck.
- A beam above a rack (Z-separated) does not change SAFE.
- Rack top above `room.heightM` → ceiling envelope warning and blocked capacity.
- Confirmed EXHAUST / SHAFT Reality opening updates the existing exhaust in
  place (same id) so `resolvedVentComponents` copies the new size into the vent
  network. Area, pressure, operating point, and SAFE recalculate when
  ventilation is the bottleneck.

## AI Reality — same pipeline

`parseAiFinding(raw, id)` in Engineering Core:

- finite numbers only; no `x || 1` fallbacks
- door → Opening `DOOR` (bottom 0)
- opening → Opening `TECHNICAL`
- shaft → Opening `EXHAUST`
- wall → `wallResize`
- beam / column / duct / obstruction → `estimated` AsBuiltObject
- missing required geometry → `incomplete` PENDING; ADD is fail-closed
- Grok never calls `applyFinding`

## Twin / compare

Twin3D draws a ceiling plane at `project.room.heightM`. Changing room height
moves the plane. A HUD toggle hides the mesh; engineering ceiling remains.

Compare modes Проект / Факт / Δ are visual. 2D and 3D read the same canonical
x/y/z/width/depth/height.

## Tests

GEO-3D-01…04 in `src/engineering/oracle/aabb3.test.ts`
REAL-13…24 in `src/engineering/oracle/reality.test.ts`
REAL-02 / REAL-07 beam Z updated to actually intersect the 2.0 m rack (physics
correction, not a weakened assertion).

Live preview: `scripts/batch3-live.mjs` — beam, ventilation opening, AI door,
ceiling hide.
