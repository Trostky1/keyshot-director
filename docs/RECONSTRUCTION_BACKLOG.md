# Scene reconstruction: implementation plan and backlog

Written 2026-10-29 against branch `scene-reconstruction-m1` (built on the reference-lighting work). Direction: CAD-first reconstruction, KeyShot as the judge. A user's own product plus one reference image become a progressively improved native scene: matched camera, editable native lights, preserved geometry, locked materials, before/after, reliable restoration, and an explicit native save.

Evidence labels follow the [capability record](LIGHTING_CAPABILITY_RECORD.md): `source-confirmed` (in code, offline-tested), `recorded-live` (earlier controlled KeyShot experiment in project docs), `documented` (official docs), `proposed`, `open`. Nothing below is claimed as live-verified unless it says `recorded-live`.

## 1. What the repository actually has (checked, not assumed)

| Need | Finding | Evidence |
|---|---|---|
| Scene identity, units, cameras, env, image style, render settings | Scene context op reports name, unit, counts, size, camera and lens; env snapshot/restore exist; image style is set (`op_image_style`) but there is **no reader**; render options are read only inside the pass-capture op. No single baseline record exists. | `bridge/cc_scene_context.py`, `cc_lights.py` |
| Render time and noise | Not measured anywhere. The photo loop uses one repeat difference. Per-render cost on the user's machine is unknown. | `server/photo-refinement.js` |
| Camera | `get_camera`, `set_view`, native checkpoint/restore exist; a landmark/silhouette pose fit now exists but is unwired and fixture-only. | `bridge/cc_ops.py`, `server/camera-alignment.js` |
| Light fitting | Vision proposal loop (3 attempts max). A budgeted derivative-free search with finalist re-validation exists, synthetic-only. Physical (fixed-flux) power mode exists, offline-tested. | `server/derivative-free.js`, `server/light-spec.js` |
| Recovery | Photo undo is one level and session-local; staging and materials have their own. Job receipts now persist for photo jobs only. | `server/job-receipt.js` |
| Native save / package | **Not implemented.** `saveFile`/`savePackage` are documented (2026.1 lux reference) but appear nowhere in the bridge. `save_file` exists in the shipped command catalog; `save_package` does not. | grep of `bridge/`, catalog per REA doc |
| Materials | Simple Plastic texture compiler only; receipts for bounded edits on independent copies. | `server/material-core.js`, `docs/MATERIAL_EDIT_RECEIPTS.md` |
| Sets | Pedestal/floor/backdrop boxes only; no flags or reflectors. | `bridge/cc_stage.py` |
| Multi-view / video | glTF animation import ops and a camera-frame renderer exist; nothing fits shared parameters across views. | `bridge/cc_anim.py`, `server/video.js` |

## 2. Where the reports are challenged

1. **Saving may retarget the open scene.** `lux.saveFile(path)` is documented as saving "to a file" with "known path" semantics; if it behaves like Save As, the user's open document silently becomes the new file. The reports treat save as a harmless explicit action. This plan requires an explicit acknowledgement for a BIP save, records the scene file name before and after, and defaults to the KSP route, which is documented as a separate export. Whether either retargets is `open` until probed.
2. **`isSceneChanged` cannot detect mutation.** Project notes record that a first render toggled it while nothing else changed, so "scene unchanged" must come from a fingerprint (name, product bounds, unit, object counts), not that flag.
3. **The REA suggestion conflicts with a recorded project decision.** The project decided on 2026-10-09 not to decompile KeyShot because the license restricts it and the user's EDU license is at risk. The REA appendix only inspected PE resources and re-used an older static analysis. No new concrete question here needs the binary: save/package are documented API, and Planar/HDRI pins are best resolved by documented-API probes first. REA was therefore not run; revisit only with the user's explicit decision.
4. **The reports give no render-latency figure, and none exists in the repository.** Preview captures are at most 640 px per side with a 2 s cap, but the cost of an evaluation (a light update plus a render) is unmeasured. Measuring it is therefore the first act of every session, and fitting is capped by wall-clock as well as by evaluation count (40 is a ceiling, not a target).
5. **"Fix pose, then lights" has a coupling the reports under-weight:** a reference crop or a lens shift (documented as unsupported by the target contract) invalidates the camera stage. The camera stage must be able to say "reference incompatible" before any lighting budget is spent.
6. **ECC tooling** (Firecrawl/Exa) was not available and was not run; its search-first principle was applied by inspecting existing components before adding any.

## 3. Prioritized backlog

Completion criteria are written so a reviewer can tell done from nearly done. Items marked **LIVE** need the user's KeyShot open on a disposable saved copy and cannot be closed offline.

### P0: first milestone (this change; offline-complete, live-open)

| Id | Item | Done when |
|---|---|---|
| R01 | Reproducible baseline and recovery record | A session records scene fingerprint, unit, camera, environment, lights, image style (where readable) and render settings; measures repeat-render variation and per-render time on the unchanged scene; writes a receipt before the first change; stops with restore if the fingerprint changes; restart blocks until reviewed. Offline tests cover each stop. **LIVE:** timings and noise on a real scene. |
| R02 | Camera stage: lock, verify, correct | Current camera is locked and hashed. With landmarks, held-out reprojection decides accept, or proposes a correction that is applied only after explicit confirmation; ambiguous or incompatible references are rejected before lighting starts. Offline fixtures cover accept, correct, reject. **LIVE:** conventions against a rendered calibration target (E05). |
| R03 | One complete lighting-fit loop | One or two area lights, at most six free physical parameters (enforced), fixed-flux mode, camera/geometry/materials locked, 40-evaluation ceiling plus a time limit, early stop from measured noise, finalist re-validation at higher quality, best valid state retained and applied. Region-separated scores (product, background, highlight, shadow). |
| R04 | Residual diagnosis | After the fit, residuals are classified as lighting, camera, material, set or geometry suspects with evidence, as advice only; nothing is changed automatically. |
| R05 | Before/after and explicit native delivery | Before, after and reference images with per-region numbers saved with the job. `scene_save` bridge op saves BIP and/or KSP only to new explicit paths, refuses overwrite and the current scene file, reports whether the open scene's file name changed. **LIVE:** save, reopen, inventory, fresh-render comparison (R13). |
| R06 | Benchmark against the current matcher | Equal-render-budget comparison on controlled synthetic scenes with known ground truth, reported per region with spread. |
| R07 | Native light capability matrix | Source-by-capability table with an evidence label per cell and the probe that would close each open cell. |

### P1: close the live gaps (needs the user's KeyShot)

| Id | Item | Done when |
|---|---|---|
| R10 | Live baseline measurement | Render time and repeat noise recorded for three scene sizes and two render engines; stored in the capability record. |
| R11 | Camera conventions | A rendered calibration target recovers a perturbed camera within a stated pixel tolerance, including lens shift behavior. |
| R12 | Native light probes | Every cell of the R07 matrix that is `open` is probed once on a disposable copy and relabeled with the result, starting with per-light aim, then Planar construction, then environment/HDRI pins as a separate track. |
| R13 | BIP/KSP round trip | Save both, reopen in a clean session, verify inventory, lights, materials, cameras and environment, and a fresh render within the measured noise of the accepted one; state whether the open document was retargeted. |
| R14 | Controlled KeyShot reference scenes and live benchmark | Five scenes rendered by KeyShot from known rigs; session and current matcher compared at 16 and 40 renders with held-out noise and view. |
| R15 | Interrupt and restart recovery | Interrupt between each operation class on a disposable scene; no silent loss; conflicts explicit. |
| R16 | Minimal UI | One panel: pick reference, draw product outline, choose single view, progress with noise-aware stop reason, before/after, restore, save. Technical controls hidden by default. |

### P2: materials and sets (after lighting is measurable)

| Id | Item | Done when |
|---|---|---|
| R20 | Residual-driven material fitting | At most two parameters on an independent copy; accepted only if a held-out alternate light does not regress; baked shading cannot pass. |
| R21 | Simple-Plastic import limitation | Unsupported channels reported before fitting; no fitting claim on materials the importer cannot represent. |
| R22 | Owned set elements | Floor, backdrop, flags and reflectors added only when diagnosis points at shadows/reflections, with exact ownership and cleanup. |

### P3: later tracks

| Id | Item | Done when |
|---|---|---|
| R30 | Shared multi-view fit | One light/material/set configuration fitted across views with per-view camera, with held-out views and a check for per-view cheating. |
| R31 | Video | Camera vs product motion separated; rigid glTF animation channels validated on 2026.2 independently. |
| R40 | Imagery-only geometry | Separate research track; simple props first; no accuracy claim for product geometry. |

## 4. Milestone 1 definition

A single call runs: baseline and noise/time measurement, camera lock and optional verification, a budgeted physical-mode area-light fit against an outline-masked reference, finalist check, residual diagnosis, before/after outputs, a persistent receipt, restoration, and an optional explicit native save. It is built from existing components (photo apply and restore, light-spec, job receipts, masks, objectives, derivative-free search) and exposed as an API. Smallest complete means a failure at any stage leaves a restorable scene and a stated reason.

## 5. Risks

- Render cost may make 40 evaluations unaffordable; the time cap and the measured per-render cost decide, and the report states the effective count.
- The objective may disagree with human judgment; before/after is always shown and the best state is retained only on measured improvement beyond noise, never claimed as a percentage.
- Saving may retarget the open document (see above).
- A constrained rig (two area lights) cannot match a reference that needs another source type; diagnosis says so rather than forcing it.
- Everything offline here uses a synthetic renderer; a good synthetic result is not evidence about KeyShot.
