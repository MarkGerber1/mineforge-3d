# Repair Batch 2 — Reality geometry pipeline

Deterministic Engineering Core owns every number. Photos never claim centimetre
accuracy.

## Pipeline

1. Photo stored with `widthPx` / `heightPx`.
2. Known-distance A–B → isotropic photo-plane scale `scaleMPerPx` (`FIELD_MEASUREMENT`).
3. Further pairs on the same photo inherit that scale as `PHOTO_ESTIMATE`.
4. Annotations (door / opening / shaft / beam / column / wall) produce a **PENDING** finding. Canonical openings, room size, and as-built stay unchanged.
5. ADD TO MODEL (`applyFinding`) writes:
   - door / opening / shaft → `project.openings` (`USER_CONFIRMED` or `FIELD_MEASUREMENT`)
   - beam / column / duct / other → `reality.asBuilt`
   - wall length → `resizeRectangularRoom` (south/north → width, east/west → depth)
6. 2D CAD and 3D twin read the same canonical boxes (`asBuiltPlanAabb` / opening world rect). Compare mode: Проект hides as-built; Факт / Δ shows it.
7. Undo/Redo is the existing `commit` history. `applyFinding` is a pure function.
8. Persistence: project JSON + IndexedDB media. Calibration round-trips (`REAL-10`).

Origin rule: left edge of a wall-hinted photo is wall start (PHOTO_ESTIMATE). Height of a door defaults to 2.100 m when the pair is horizontal.

## Tests

`src/engineering/oracle/reality.test.ts` REAL-01 … REAL-12.
