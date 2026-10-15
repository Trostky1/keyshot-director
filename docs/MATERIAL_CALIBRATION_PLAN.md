# Material calibration plan

Status: live disposable-scene calibration executed on 2026-10-14 in KeyShot Studio 2026.2 after explicit user authorization. Results and evidence are in [MATERIAL_CALIBRATION_RESULTS.md](MATERIAL_CALIBRATION_RESULTS.md). The production scene was checkpointed, never overwritten, and restored at the end.

## Evidence and questions

The current [material recipe core](MATERIAL_CORE.md) maps imported channels to supported Generic/Plastic graphs. The [materials deep dive](MATERIALS_AND_DISPLACEMENT_DEEP_DIVE.md) records installed parameter names and prior observations, including unresolved mapping enums/units and displacement transfer behavior. Static parameter names alone do not establish physical scale or renderer semantics.

KeyShot's [2026.1 graph API](https://media.keyshot.com/scripting/doc/2026.1/lux.html) documents graph traversal, parameter editing and material-scoped `executeGeometryNodes`. The installed KeyShot Studio 2026.2 runtime reports app version (15, 1, 2, 7) and embedded Python 3.13.12. Live tests establish behavior only for the synthetic UV-mapped fixture and tested PNG/TIFF inputs; they do not establish a generic MaterialX conversion route or every source-map decoder.

## Disposable baseline

Use millimeter units and a saved scene with a 100 mm square plane, rounded cube and cylinder. Use one independent test material on one unlocked visible part at a time; retain baseline copies. Fix camera, engine, image style/exposure, environment, lights and output dimensions. Record KeyShot/Python version, file identity, units, graph nodes/edges/values, assignment and source hashes for each trial. Never save over an existing user scene.

## Experiments and pass criteria

The criteria below are retained as the original test design. Trials 1–6 have now been run; observed passes and unresolved limits are summarized in [MATERIAL_CALIBRATION_RESULTS.md](MATERIAL_CALIBRATION_RESULTS.md).

| Order | Controlled trial | Record and acceptance criterion |
| --- | --- | --- |
| 1 | Known 10 mm checker built manually in KeyShot; inspect supported mapping mode and UV/physical controls. | Read back exact enums, units, scales, shifts and orientation. A recreated material must reproduce checker count/alignment on plane and cylinder within a one-pixel edge allowance at the agreed render size. If the projection cannot represent the geometry's mapping, report that limitation. |
| 2 | Shared Base Color, Roughness and Normal registration using matching labelled maps. | Channels align on the same seams and known marks; no per-map drift. Record mapping per node rather than assuming native defaults are shared. |
| 3 | Neutral ramps/checker values in color and data channels. | Compare Director graph against a hand-built KeyShot graph with identical explicit color-space controls. Record raw file metadata, decoded intent, graph values and linear/rendered differences above repeat noise; do not judge by display thumbnail alone. |
| 4 | Known normal-map directions on planar and curved parts. | Compare OpenGL orientation and any supported inversion control to the manual baseline. Never edit/invert original normal maps automatically. |
| 5 | Known 16-bit height ramp and constant mid-gray maps. | At 0.01, 0.03 and 0.1 mm, isolate offset from height and resolution. Compare fixed-camera silhouette/depth where supported, visible displacement and topology evidence. Stay within existing single-part and 0.1 mm execution limits; unchanged triangle counts alone cannot prove tessellation. |
| 6 | Failure and restoration trials after each calibrated operation. | Verify assignment, graph values/edges, target bounds and baseline renders restored. Displacement has no promised undo; reopen the disposable checkpoint between execution trials. |

Each trial gets at most a baseline, repeat and candidate render at the agreed resolution/time. Restore the disposable checkpoint between families and stop on unexpected geometry, units, assignment or render-state changes. Retain findings with source/graph hashes and measurements; omit private paths from user-facing summaries.

## Resulting implementation decision

Mapping value 4 is verified only for UV-bearing meshes; do not make it a universal default without UV detection or a user-visible fallback. The current scalar Texture Map path applies a square transfer to the tested 8-bit and 16-bit gray maps, and neither texture_use_profile nor the inspected Color Adjust node supplies a verified linearization control. Do not silently alter imported data maps. Investigate a graph-level data correction or an explicitly derived, reversible map workflow before claiming linear Roughness or Displacement behavior. Test vendor TIFF/EXR families before generalizing. Material-scoped executeGeometryNodes remains guarded, while the experiment showed assignment itself can already reevaluate geometry in this runtime.
