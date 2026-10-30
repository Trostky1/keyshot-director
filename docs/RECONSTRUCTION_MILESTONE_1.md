# Reconstruction milestone 1: single-view lighting reconstruction

Date: 2026-10-29. Plan and backlog: [Scene reconstruction: implementation plan and backlog](RECONSTRUCTION_BACKLOG.md). Capability evidence: [Lighting capability and evidence record](LIGHTING_CAPABILITY_RECORD.md).

**Status in one paragraph.** The pipeline from a reference photo to an improved, restorable, optionally saved native lighting setup is built and tested offline end to end against a synthetic renderer. The KeyShot adapter and the save operation exist and load, but **nothing in this milestone has been run against a live KeyShot scene**. Every timing, noise level and score below comes from the synthetic renderer or from fixtures. Treat the live runbook at the end as the real acceptance test.

## What a user gets

With a product open in KeyShot and a reference image, `POST /api/reconstruct` runs one bounded session:

1. **Baseline and recovery.** Records the scene fingerprint (saved name plus product bounds), camera, lights, environment, and the facts that exist (image style and render options have no reader yet and are recorded as unknown, not assumed). Writes a persistent receipt before the first change. Renders the untouched scene twice to measure render time and repeat variation; this is also the "before" image.
2. **Camera.** The current camera is locked and hashed. With four or more landmarks (CAD points with their image positions) it can verify the camera, and with `policy: "propose"` it suggests a pose correction that is applied only after `POST /api/reconstruct/camera {accept:true}`. A reference that no pose can explain stops the session before any light is touched.
3. **Light fit.** One or two Area lights, at most six free physical parameters (azimuth, elevation, distance, size, fixed-flux power), in the fixed-flux `physical` power mode so moving a light does not also change its output. Camera, geometry, materials and environment are locked. A user-drawn product outline separates product from surroundings; each is scored on its own (highlights, shadow direction, tone structure, exposure, tint, sharpness for the product; shadow, gradient, exposure for the background).
4. **Budget.** At most 40 evaluations, and also at most what the time limit can pay for given the measured render time; searching stops early on measured noise (no improvement beyond twice the baseline spread over `patience` evaluations) and always leaves time to re-render the two best candidates at higher quality. The result keeps the best valid state; if it does not beat the untouched scene by more than the measured noise, the original scene is restored.
5. **Outputs.** `reference.png` (resampled to the render size), `before.png`, `after.png`, `difference.png`, `report.json` (scores by region, budget used, stop reason, noise, finalists, trace, diagnosis) and `recipe.json`, plus the receipt. Scores are for ranking against one reference; there is no match percentage.
6. **Residual diagnosis.** Advice only: light structure (the reference has more highlights than the rig can make), camera or geometry, material or white balance, exposure versus albedo ambiguity, focus, set, backdrop. Nothing is changed automatically.
7. **Undo, stop and recovery.** One-level undo; stop restores. If the scene or camera changes underneath a running session it stops without restoring over it, and a restart blocks new jobs (photo and reconstruction both) until the unfinished job is dismissed or, for the same scene only, restored from its receipt.
8. **Explicit save.** `POST /api/reconstruct/deliver {ksp, bip, acknowledge_save_as}` saves a KSP package and/or a BIP scene through the new `scene_save` bridge operation, only to new absolute paths, never over an existing file or the open scene, and verifies the files exist. A BIP save needs the acknowledgement because `lux.saveFile` may behave like Save As and retarget the open document; the response says whether it did. The save is separate from the fit and never automatic.

Materials stay locked: `fit_materials: true` is rejected. There is no UI panel yet (backlog R16); the surface is the API above.

## Tested behaviour (offline)

`tools/test_reconstruction_session.js` (15 tests), `tools/test_scene_save.py` (6), `tools/test_milestone_benchmark.js` (3) and the supporting suites cover:

- Settings: outline required, six-parameter and Area-only limits, evaluation 9–40 and time bounds, material fitting rejected.
- End to end: baseline, locked camera, physical-mode fit, before/after files, receipt contents, undo; renders counted exactly (`baseline + fit + after`).
- Early stop on noise with the original scene restored; a time limit that stops the search yet still re-validates finalists; slow renders that cap evaluations or refuse to start before any change.
- Camera: lock, verify, correction proposed and applied only after confirmation, declined, and an incompatible reference rejected with no scene change.
- Safety: scene change or camera movement mid-fit, cancellation, failed restore, restart blocking, a photo job blocking a reconstruction.
- Delivery: improved results only, new absolute paths, acknowledgement for BIP, files verified, retargeting reported, refusal if the open scene changed. The Python op is tested with a fake `lux` (order: package before scene; validation before any write; silent failure detected).
- Diagnosis rules produce advice only.

Also added this milestone: early stopping and finalist-time handling in the search, product/background region scoring, a smoothing and speck filter in the highlight detector (render noise had made the highlight term jump between one and two components, which stalled the search), a shared recovery implementation for photo and reconstruction jobs, a PNG encoder for saved outputs.

## Benchmark against the current workflow

Run `node tools/run_milestone_benchmark.js`. Six controlled synthetic scenes (different key directions, a raking light, a top light, a back rim, a turned camera) times two seeds, each with a known truth rig. The "current matcher" is the real photo director loop (its objective, noise gate and locks) driven by an invented vision policy with a persistent misreading; the session starts from the same first estimate. All scores are held-out: fresh render noise, product outline mask, plus a camera turned by 25 degrees that neither method fitted. Pixel RMSE is not part of either objective and is the independent cross-check. Lower is better.

| Method | Mean renders | Combined | Product | Background | Turned view | Pixel RMSE | Spread (sd) |
|---|---|---|---|---|---|---|---|
| Start (first vision estimate) | 1 | 0.212 | 0.186 | 0.274 | 0.196 | 0.094 | 0.081 |
| Current matcher, fresh estimates | 12.0 | 0.208 | 0.185 | 0.262 | 0.202 | 0.091 | 0.077 |
| Current matcher, local steps | 12.0 | 0.206 | 0.180 | 0.267 | 0.197 | 0.092 | 0.079 |
| Session, 12 total renders | 12.0 | 0.191 | 0.180 | 0.215 | 0.195 | 0.092 | 0.088 |
| Session, 16 total renders | 16.0 | 0.100 | 0.106 | 0.087 | 0.109 | 0.063 | 0.052 |
| Session, default cap 40 | 22.9 | 0.093 | 0.101 | 0.073 | 0.096 | 0.062 | 0.041 |

Read it carefully:

- Budgets count total renders including the two baseline renders and the final "after" render. At 12 total renders the session has only nine evaluations and is barely better than the matcher (it beat the better matcher variant in 4 of 12 cases). At 16 it won 10 of 12 cases, and the default 40-evaluation cap stopped on patience after 22.9 renders on average.
- The current matcher hardly moves in these scenes: with a persistent misreading, new proposals rarely beat the noise gate, so its result is close to the start. That depends entirely on the invented vision policy.
- The session did not improve every case. Scenes S3 (seed 1) and S5 (seed 1) stayed near their start even at the default cap, consistent with a local minimum in a landscape where the highlight terms saturate. Those are real failures of this search on this problem.
- The optimization objective and the "combined" score are the same family, which is why pixel RMSE is shown; it moves the same way.
- Nothing here measures KeyShot render time, KeyShot noise, real vision, real photographs, materials or sets.

## Native light capability matrix

See the matrix at the top of the [capability record](LIGHTING_CAPABILITY_RECORD.md). Cells are **R** recorded live in earlier controlled experiments, **S** source-confirmed, **D** documented only, **O** open with the probe named. No cell was newly verified in KeyShot for this milestone. Open cells: IES size and shape, every Planar capability beyond documentation, and the spatial environment control (HDRI pins).

## Remaining uncertainties

- Real render time, noise and whether a 40-evaluation fit is affordable (R10).
- KeyShot projection conventions against a rendered calibration target, and lens shift or crop (R11).
- Whether `lux.saveFile` retargets the open scene, whether `lux.savePackage` bundles all resources, and the reopen round trip (R13).
- Restart and interruption recovery against a real scene (R15). Receipts hold light ids and materials, not native node ids, because the bridge does not return them.
- The lightweight per-evaluation update path in `server.js` is written but unrun; a full photo apply per evaluation would be slower.
- Everything about materials, sets, multi-view and video is deferred.

## Live runbook (to close R01, R10, R13)

Use a saved **disposable copy** of the product scene. Save first; do not run other scripts while the bridge is active.

1. Start the server, then run the Director script in KeyShot. Confirm "KeyShot connected".
2. `GET /api/reconstruct/recovery` returns no items.
3. Pick a reference rendered from that same scene with a known rig (render it once from KeyShot with your own lights, then move or delete those lights), and draw the product outline.
4. `POST /api/reconstruct` with `image`, `outline`, and a deliberately wrong starting `rig`; start with `max_evaluations: 12`, then 40.
5. Record from `report.json`: `render_ms_mean`, `repeat_variation`, `evaluation_cap`, `evaluations_used`, `stop_reason`, scores before/after by region, the finalists, the camera status.
6. Check in KeyShot that the product is untouched, the new lights are editable native lights, and `Undo` (`POST /api/reconstruct/undo`) restores the original lights, environment and camera.
7. Save only a copy: `POST /api/reconstruct/deliver {"ksp":"<new path>.ksp"}`; then, separately, a `.bip` with `acknowledge_save_as:true`, and note whether the open scene name changed.
8. In a clean KeyShot session open the KSP/BIP, check lights, materials, cameras and environment, render at the same size and compare with `after.png` within the measured repeat variation.
9. Relabel the matching entries in `server/lighting-capabilities.js` with what you saw (including failures) and regenerate the record.
