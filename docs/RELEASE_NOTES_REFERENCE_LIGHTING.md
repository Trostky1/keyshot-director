# Reference-lighting groundwork (Stages A, B and C, offline slice)

This update implements the parts of the 2026-10-29 reference-lighting research plan that can be built and verified without a live KeyShot scene. Everything that needs the real renderer is listed as open at the end, with its experiment id. No live scene, bridge call, `lux.screenshot`, `lux.getAnimations` or `lux.createAnimation` was used, and no result below is a claim about KeyShot output.

Director still does not report a match percentage and does not claim arbitrary 1:1 photograph matching. See the [capability and evidence record](LIGHTING_CAPABILITY_RECORD.md) for the label on every control, and [Measured refinement](MEASURED_REFINEMENT.md) for the acceptance loop.

## What changed in the app

**IES intensity fix (E03, source level).** A photo plan used to carry `multiplier: 1` for every light, and the light-spec conversion preferred a finite multiplier over `gain`. The planner prompt calls `gain` the IES dimmer, so an IES gain chosen by the planner never reached the native multiplier. The plan now folds `gain` into `multiplier` for IES sources (`gain` wins when both are given) and records `ies_intensity_source`. The bridge only ever reads `spec.multiplier` for IES lights, which a test checks in the bridge source. The live plan, readback, render round trip is still open.

**Power mode in every recipe.** `power_mode` is `artistic` (default, unchanged) or `physical`. Artistic flux is `E * gain * distance^2 * rig exposure`, so moving a light also changes its flux and exposure is a rig multiplier, not sensor exposure. Physical flux is `E * gain * (3 spans * source scale)^2` and ignores distance and rig exposure. Request it with `refinement.power_mode`; the saved `recipe.json` and every applied light report the mode and the formula used. Refinement candidates cannot change the mode.

**Per-light aim and visibility in the photo plan.** A light may set `target_offset: [x, y, z]` (multiples of the product span, clamped to ±0.75) to aim away from the shared target, and `visibility: { reflection, camera, shadows }`. Visibility applies to Area sources only, because the bridge writes those flags only for Area; other types keep the defaults and the plan lists the ignored request under limitations. Named-part targets are not implemented. Locks cover both fields with their groups.

**Persistent job receipts (E14, offline half).** Each photo job writes `receipt.json` next to its other outputs before the first scene change: job identity, scene identity, initial state, owned items, last accepted recipe, operation receipts and restore status. Ownership comes only from items the job recorded; it is declared before each creation and never inferred from a name prefix. A job that did not finish, a failed restore or an unreadable receipt blocks a new match with a 409 until reviewed. `GET /api/photo/recovery` lists them and `POST /api/photo/recovery` with `{ job_id, action }` either dismisses a receipt or restores it. Restore is offered only when the open scene's identity (saved name plus product bounds) equals the recorded one, and it removes only receipt-owned lights. Receipts do not yet record native node ids because the bridge does not return them.

**One mask for both sides (E06, offline half).** Reference statistics used every pixel in the user rectangle while render statistics used a Clown-derived product mask. A refinement with a reference region now applies one mask to both: the whole rectangle by default, or an optional manual `refinement.mask` polygon with excluded holes. Mask coordinates are relative to the measurement rectangle on both sides. `exclude_transparent` drops reference pixels with alpha under 50% and, on the render, pixels outside the Clown object mask, and needs a reference with an alpha channel. Scoring fails closed when the two sides were measured with different masks or colour spaces. This assumes the camera is aligned to the reference.

**Colour contract.** Reference photographs and KeyShot PNG previews are `display_srgb`; EXR passes are `linear_exr`. Photograph-to-render scoring happens only in display space, and the helper refuses to compare across spaces. KeyShot's actual linear-to-PNG transform is an unverified sRGB-like assumption (E04).

## Experimental modules

Update: `camera-alignment.js`, `lighting-objectives.js` and `derivative-free.js` are now used by the reconstruction session and ship (see [Reconstruction milestone 1](RECONSTRUCTION_MILESTONE_1.md)); only `light-basis.js` remains unshipped and unwired. As originally written, these were left out of the release package until their live experiments pass.

| Module | Purpose | Offline evidence |
|---|---|---|
| `camera-alignment.js` | Landmark and silhouette overlay data model, projection matching the one `photo.projectBounds` uses, reprojection check, bounded pose fit with held-out landmarks, ambiguity warnings | Injected fixtures only (E05) |
| `lighting-objectives.js` | Highlight components with count and extent, shadow direction, regional tone and colour structure, multiscale tone, sharpness, bounded robust losses | Adversarial synthetic cases (E07) |
| `derivative-free.js` | Coordinate and Powell-style search under a hard evaluation budget, baseline repeat noise, finalist re-validation | Analytic and synthetic (E07, E13) |
| `light-basis.js` | NNLS intensities from per-source linear renders, held-out mixtures, measured-noise acceptance | Synthetic renderer only (E09) |

The adversarial cases covered: same centroid with a different highlight shape, correct brightness with the shadow on the wrong side, blur lowering the score, and a material colour change that raw pixel error rewards but the lighting score does not (a global tint shift is reported separately and is not scored). Recolouring a render moved the lighting score by under 0.03 in the fixture.

## Synthetic equal-budget comparison (E07 and E13, offline half)

`tools/run_reconstruction_comparison.js` runs the real director loop (its objective, acceptance gate and locks) against a stand-in vision policy with a persistent misreading, and a derivative-free solver started from the same first estimate, on a deterministic synthetic renderer. Six seeds; lower objective is better; the objective is the experimental one above, evaluated on fresh noise and on a turned camera that neither method optimized against.

| Method | Renders | Objective, same view | Objective, turned view | Key azimuth error (deg) | Key elevation error (deg) |
|---|---|---|---|---|---|
| First vision estimate | 1 | 0.313 | 0.253 | 10.4 | 13.2 |
| Vision loop, fresh estimates | 12 | 0.273 | 0.238 | 15.2 | 11.0 |
| Vision loop, local steps | 12 | 0.291 | 0.249 | 10.8 | 13.2 |
| Coordinate search | 12 | 0.174 | 0.162 | 15.5 | 7.2 |
| Powell-style search | 12 | 0.243 | 0.273 | 24.9 | 13.2 |
| Coordinate search | 24 | 0.072 | 0.085 | 9.2 | 5.9 |
| Powell-style search | 24 | 0.193 | 0.213 | 22.5 | 10.1 |
| Coordinate search | 48 | 0.024 | 0.022 | 5.3 | 4.4 |
| Powell-style search | 48 | 0.109 | 0.134 | 22.5 | 11.4 |

What this does and does not show. The harness works, counts every render against one budget, and is deterministic. On this synthetic problem, with a four-parameter reduced search, coordinate search improves on the stand-in at the same 12 renders and keeps improving with more. The Powell-style variant did worse than coordinate search here because the bounded line searches settle in local minima where the saturating highlight losses are flat. The stand-in vision is invented: real vision behavior, KeyShot noise, materials, denoising and real photographs are all untested, so this is not evidence that numerical fitting beats the present refinement in KeyShot.

## Summary of status

**Implemented and tested offline (unit tests with fixtures or injected dependencies):** IES gain trace and fix; power-mode model and its recording; per-light aim and visibility fields with validation and locks; job receipts, restart simulation, scene-identity conflict handling and recovery API; shared reference/render masks including polygons, holes and transparent-region exclusion; the colour contract; the generated capability record.

**Implemented but validated only on the synthetic renderer or injected fixtures:** camera alignment and pose fit (E05); multi-component objectives and adversarial cases (E07); coordinate and Powell-style optimizers with repeat-noise gating and finalist re-validation (E07, E13); the equal-budget comparison harness; light-response NNLS with held-out validation (E09).

**Still requiring live KeyShot experiments:** E01 source replay and verified restore; E02 independent parameter sweeps, including the physical power mode; E03 plan to readback to render round trip for IES; E04 repeat distributions and the linear-to-PNG transform; E05 rendered calibration target; E06 ground-truth masks on real products; E07 same-renderer KeyShot cases with blinded preference; E08 native Planar construction (Planar is documented, not constructible here, and not claimed); E09 light-response prediction on real renders; E10 structural source moves; E11 IES axis and profile ranking; E12 flags and cards, and HDRI pins; E13 optimizer comparison on real latency; E14 restart and interruption on a disposable scene; E15 real photographs; E16 multi-view consistency.
