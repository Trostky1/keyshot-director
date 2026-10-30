# KeyShot Director: reference-lighting research and development findings

Research date: October 29, 2026. Repository inspected at `cf0c75361fe79d34edfaaf40764d88ad77f68cca`.

## Executive findings

Director can plausibly progress from approximate lighting transfer to close image reconstruction on compatible products. The strongest route is camera alignment, controllable light hypotheses, spatial image objectives, and a budgeted search using actual KeyShot renders. No evidence found establishes arbitrary photographic 1:1 matching, recovery of the original studio, or a reliable percentage similarity guarantee.

The existing implementation is further along in native light control than the first plan suggested: its capability registry records live Area, Point, Spotlight, and IES create/update/readback experiments. Its main matching limitations are now measurement quality, restricted search structure, calibration, and integration of those capabilities. Planar lights remain absent from the current four-type grammar. [L1–L8; S3–S10]

The highest-value new research experiment is a fixed-camera, fixed-material reconstruction of a known KeyShot reference. Compare the existing vision refinement with a simple numerical optimizer under the same total render budget. This isolates whether the solver actually improves lighting before introducing photographic uncertainty.

### Decisions recommended

1. Preserve KeyShot as the final renderer and the user's product as the source of truth.
2. Treat close matching of the same object as reconstruction; treat a different reference object as lighting transfer. Evaluate these separately.
3. Finish capability verification and recovery before allowing structural light search.
4. Build editable masks and camera alignment before increasing optimization budgets.
5. Start numerical fitting with a small parameter set and simple algorithms. Escalate solver complexity only after equal-budget comparisons.
6. Research Planar lights, per-light targets, emission shape, and environment control as concrete missing operations.
7. Keep material fitting and scene-set additions explicit optional stages.

## 1. Scope, method, and evidence limits

This report investigates all twelve workstreams in the earlier plan. Five research questions organized the work:

- What does Director already implement, and what has recorded renderer evidence?
- Which KeyShot source and environment controls are documented but missing or unverified?
- What makes reference matching ambiguous, and how should alignment and metrics address it?
- Which existing tools and optimization approaches are suitable for the current architecture?
- What experiments and delivery gates can demonstrate progress without overstating it?

### ECC workflow used

The requested ECC repository is a collection of workflows rather than one lighting skill. I read its complete [search-first skill](https://github.com/affaan-m/ECC/blob/main/skills/search-first/SKILL.md) and [deep-research skill](https://github.com/affaan-m/ECC/blob/main/skills/deep-research/SKILL.md). Applied practices: tool preflight, repository-first investigation, primary-source search, deeper source reads, adopt/extend/build comparisons, citations, confidence labels, and explicit gaps. [S1–S2]

Firecrawl and Exa, named by ECC deep-research, were not available. The available web search/open tools supplied the fallback. A researcher subagent was requested as directed by search-first, but failed with a model-capacity error; the main agent completed the relevant document review. No ECC installation, hooks, global settings, or memory writes were needed. This is an adapted application of the workflows, not a claim that their preferred tools ran.

Research channels covered: local source and tests; official KeyShot manual and scripting reference; official library documentation; public upstream GitHub repositories; PyPI package pages. No exhaustive package-registry search, dependency installation, model download, new renderer experiment, binary investigation, or private API discovery was performed. Some CVF pages could not be fetched and are excluded as substantive evidence.

### Evidence labels

| Label | Meaning |
|---|---|
| Source-confirmed | Behavior exists in inspected code; actual renderer behavior may still differ |
| Recorded live evidence | Existing registry/documentation reports a controlled live experiment; not rerun here |
| Documented | Official external documentation describes the capability |
| Proposed | Engineering recommendation or experiment, not a demonstrated result |
| Open | Evidence is insufficient or a version-specific check is required |

Confidence is high for directly inspected implementation, moderate for transferring documented 2026 capabilities to this installed build, and low for unmeasured performance or future matching quality. The accessible scripting reference is explicitly **2026.1**, while the project targets **2026.2**. Treat differences as validation questions. [S4]

## 2. Current implementation: findings and corrections

| Area | Findings | Evidence and implication |
|---|---|---|
| Plan grammar | One to six sources; Area, Point, Spotlight, IES; bounded position, size, gain, radius, cone and color | `server/photo.js`, `cleanPlan`. Planar and zero-physical-light environment-only hypotheses are not represented |
| Refinement | At most three attempts; default two; default 12 captures and 480 seconds | `server/photo-refinement.js`, `settings`; this is a bounded proposal loop, not broad inverse optimization |
| Structural search | Baseline count, identities, types, IES profiles, and camera are retained | `lockedPlan`; a wrong initial source family cannot be corrected during refinement |
| Current objective | Bright-pixel centroid, p95 tone, or p95–p05 contrast | `referenceMetrics`, `objectiveScore`; these do not measure complete highlight shape or multiple reflections |
| Acceptance | Improvement must exceed max(0.005, twice the baseline/repeat score difference) | `decision`; a useful heuristic, not a statistical confidence interval |
| Reference region | Explicit rectangle, at least 2.5% wide/high | No semantic reference segmentation |
| Render target | One selected part or combined product bounds; unshifted known perspective required | `measurementTarget`; rejects unsupported projection rather than guessing |
| Pass evidence | Beauty, Clown, and supported linear EXR pass measurements; state/target/mask compatibility | `server/lighting-evidence.js`; already valuable infrastructure to extend |
| EXR support | Current bounded analysis supports single-level tiled ZIP EXR | Broader formats require a tested reader or explicit refusal |
| Native control | Registry records four source families tested on 2026.2 | `lighting.create_native_light`; evidence limited to disposable research-scene conditions |
| Cleanup | Direct research-light removal remains gated; saved research checkpoint is the reliable reset | Structural search cannot assume arbitrary light deletion is proven |
| Saved workflow | Images and recipes persist; job/undo is session-local | Restart recovery and reusable scene-independent rigs need additional design |

### Important parameterization findings

**Distance is coupled to output.** `server/server.js`, `lightSpec`, computes non-IES power as `E * gain * distance² * studio.exposure`. This supports approximately size-independent rig brightness but is not a calibrated physical source law for every type and geometry. Moving a source also changes its assigned flux. A numerical optimizer must either use a fixed-flux physical mode or explicitly model this artistic normalization. Otherwise, a distance experiment is changing two causes simultaneously. `server/rigs.js` documents the same intent. [L3–L4]

**Exposure is a coupled rig multiplier here.** In `lightSpec`, `studio.exposure` multiplies physical power or IES multiplier. It should not be treated as equivalent to photographic sensor exposure without separately inspecting image-style controls. Calibration should distinguish renderer exposure, light energy, and this application-level rig scale. [L3]

**IES intensity semantics need an end-to-end check.** `cleanPlan` defaults `multiplier` to 1. `lightSpec` uses an explicitly finite multiplier before falling back to gain. The planner prompt describes gain as an IES dimmer, but the defaulted multiplier may take precedence. Trace the entire apply path and test a plan varying only gain versus only multiplier. This is a source-level inconsistency candidate, not a live-confirmed defect. [L1; L3]

**Per-light aim is restricted in matching.** `lightSpec` uses a shared target, and photo application provides `lightFrame.target`. Lower-level native operations accept explicit targets. Individual source aiming should be promoted into the photo grammar, with an optional named part/point target. [L3; L5]

**Emission visibility is restricted by the photo grammar.** Cleaned sources force reflection visibility on and camera visibility off. There are good defaults, but they exclude visible practical lights and some reflection-control hypotheses. Expand only with explicit intent and type-appropriate validation. [L1]

**The reference and render masks are asymmetric.** Reference statistics use all pixels in the rectangle, while rendered statistics use a Clown-derived product region. They can compare different visual content even with similar framing. Product masks and region correspondence should precede more elaborate scoring. [L2; L6]

**Bright centroids are underdetermined.** Two highlights and one central highlight can share a centroid. A white diffuse patch can dominate the brightest pixels. This metric is useful as one clue, not an adequate reconstruction target. This conclusion follows directly from the measurement definition. [L2]

### Documentation drift

`docs/LIGHTING_AND_MOOD_DEEP_DIVE.md` mixes historical area-only/no-numeric-objective text with later four-type live findings. `docs/PHOTO_WORKFLOW.md` also retains historical descriptions alongside a working-checkout update. `docs/MEASURED_REFINEMENT.md` and current code are the better authorities for the current acceptance loop. Future work should consolidate these claims into one versioned capability/evidence record. No older documents were rewritten during this research.

## 3. What near 1:1 should mean

Define three separate outcomes:

1. **Controlled reconstruction:** same geometry, materials, camera and renderer; find an equivalent image-producing rig.
2. **Photographic reconstruction:** matching CAD plus photographed product; account for lens, material, set, image processing and illumination differences.
3. **Look transfer:** reference depicts a different product; preserve characteristic lighting relationships rather than demand matching pixels.

Single-image inverse-rendering research jointly estimates illumination and surface properties, and some methods use 3D spatially varying light representations. That research motivates hypothesis-and-render workflows, but its demonstrations are not evidence of compatibility with KeyShot shaders or arbitrary CAD products. [S20]

Mitsuba demonstrates gradient-based inverse rendering through a differentiable rendering implementation. Director does not gain those gradients by calling KeyShot. A substitute renderer would introduce material, camera and integrator mismatch. Use this research for algorithmic understanding; keep direct KeyShot black-box fitting as the first implementation. [S19]

**Proposed success definition:** registered reference and result agree within predeclared tolerances on important highlights, shadows, regional tone/color and background, and a blinded visual comparison supports the result. Report each measurement and excluded region. Define tolerances after baseline repeatability measurements; do not invent a global “match percentage.”

Recovering the photographer's actual lights is a different identifiability question. A visually close solution can be valid without recovering their rig.

## 4. Source coverage and manipulation research

The 2026 manual lists five physical source types. Current Director supports four. Each native parameter must be discovered/read back on the installed build before promotion; material UI labels do not establish script parameter names. [S3–S9]

| Source | Established | Missing investigation | Recommended experiment |
|---|---|---|---|
| Area | Native mesh emitter; power, color, rectangular carrier, visibility controls in source | Front/back emission, textured emission, disk/strip/custom geometry, sampling semantics | Fixed camera/material: size, flux, side and shape sweeps with parameter readback |
| Planar | Documented width/height, separate spread angles, textured color/alpha and visibility | Shader identity, safe construction, parameter types, width/height versus carrier scale | Discover graph on disposable scene; vary one spread axis and dimensions independently |
| Point | Documented flux and source radius; recorded native creation/contribution | Radius response across product scale; position correctness; unit consistency | Equal-flux distance sweep and radius sweep on matte/glossy targets |
| Spotlight | Recorded native creation/readback; local -Y aim in tested setup | Cone-angle/falloff semantics across assets; constant-output behavior | Fixed power angle sweep, then fixed-cone-output sweep; inspect spot footprint |
| IES | Installed MTL/profile load; multiplier, radius, axis and color override paths | Universal axis mapping, profile shape modes, rectangular size, profile ranking | Known asymmetric profile, six-axis sweep, rotated repeats and beam footprint measurement |
| HDRI | Environment file, brightness/rotation, background/ground paths | Full pin access, contrast, generated HDR support, size/height behavior | Inventory Env surface; controlled HDR import and rotation; prove restore |
| Emissive | Documented practical-source material, distinct from main scene lights | Safe owned geometry/material construction, GI prerequisites, alpha and image maps | Small LED/screen scene; compare visible glow and actual illumination with GI settings |

Key distinctions to preserve:

- Area/Planar lumen mode holds total flux fixed as source size changes; the manual's lux mode describes output per emitting area. That mode is not target illuminance. [S5–S6]
- Planar has its own width/height and angular spread behavior. It is not simply another name for a rectangular area carrier. [S6]
- Point orientation is not a directional lighting control; source position and radius matter. [S7]
- IES multiplier scales the photometric profile's embedded output. Default/profile color and axes require explicit handling. [S9]
- Emissive is documented for small practical sources; illumination depends on lighting settings. It should not silently replace main-source control. [S10]

### Shared control model proposed

Each source should have stable identity, provenance, source type, world transform, aim target, units, emission parameters, visibility flags, ownership and capability flags. Expose type-specific extensions rather than pretending every field applies to every source.

Include `create`, `inspect`, `update`, `mute`, `solo`, `duplicate`, `restore`, and eventually `remove`. Make support explicit per operation and version. Creation support alone must not imply deletion or recovery support.

Separate **physical controls** (flux held fixed) from **artistic controls** (normalized apparent brightness). Store the selected mode in every recipe.

## 5. Calibration and image pipeline

**Proposed calibration suite:**

1. Record units, scale, camera/lens, engine, lighting preset, ray settings, image style, denoising, render budget and output encoding.
2. Render neutral matte and glossy targets under one controlled source.
3. Vary power, distance and area independently; verify measured response and readback.
4. Repeat each selected setting to estimate noise and drift.
5. Check CPU/GPU and denoising separately; do not mix their samples in one acceptance decision.
6. Compare linear passes for physical diagnostics and consistently transformed beauty images for visual similarity.

Unknown photographic tone curves, local retouching, clipped highlights and compression remain uncertainty. Do not recover an HDR lighting distribution by assuming clipped JPEG whites encode source intensity.

OpenColorIO is a candidate for an external analysis color pipeline, not evidence of a scriptable native KeyShot OCIO workflow. First establish the actual KeyShot input/output transforms. [S18]

The official OpenEXR library is worth evaluating before extending the custom decoder. Its Python API handles tiled and scanline images and multipart data, but loads arrays into memory; bound dimensions/channels and reject unsupported structures explicitly. [S17]

## 6. Camera alignment and masks

Camera errors change reflected highlight locations. Align camera using silhouette and geometry landmarks, not lighting appearance.

**Proposed progression:** manual overlay and landmarks → known-3D-point/2D-image correspondences → bounded silhouette refinement. OpenCV solvePnP supplies pose estimation from known correspondences and camera intrinsics; it does not infer CAD landmarks or unknown focal length automatically. Symmetric products, coplanar points and crops need ambiguity handling. [S11]

Estimate or sweep focal length separately, verify KeyShot projection conventions with a rendered calibration target, then lock camera. The current projected-bounds contract excludes shifted/unknown lenses; extend it only with tests against actual rendered coordinates. [L1–L2]

**Mask options:**

| Option | Assessment | Decision |
|---|---|---|
| Manual polygon/brush | Predictable correction path, no model dependency; user effort | Build as baseline and fallback |
| OpenCV GrabCut | Existing rectangle/stroke-driven segmentation; useful low-dependency comparison | Evaluate before custom segmentation [S12] |
| SAM 2 | Promptable segmentation with upstream code/weights; substantial ML runtime | Optional candidate, benchmark and package separately [S13] |
| Clown render mask | Existing object labels; does not establish semantic reference correspondence | Extend current path [L6] |

Transparent products need special treatment: a foreground silhouette does not separate transmitted background from material appearance. Let users exclude transparent regions, identify them, or provide a matching backdrop. Do not score the whole glass silhouette as ordinary opaque color error.

## 7. Spatial objectives and acceptance

**Proposed objective components:** silhouette/landmark error for camera; multiscale regional tone/color; highlight component positions, extents and shapes; shadow direction/extent/softness; reflection bands; and separate background gradients. Use robust losses and user-selected importance weights.

Maintain two representations: comparable display-space appearance for the photographic target and linear render data for diagnosis. Never directly compare linear EXR luminance with display-encoded reference pixel values.

LPIPS is an existing learned perceptual metric worth testing as a supporting evaluation measure. It is not lighting-specific and must not become the sole acceptance signal. Its upstream implementation also carries ML/runtime and model-weight considerations. [S14]

Before optimizing any metric, construct adversarial examples: same centroid/different highlight shape; correct brightness/wrong shadow; correct product/wrong background; lower score after blur; and material-color changes that falsely look like lighting improvement.

The current single repeat difference is a noise heuristic. For higher-precision acceptance, repeat baseline and finalist captures, estimate the distribution of each objective, and require improvement larger than observed variability. Use paired seeds only if the renderer exposes and verifies them. Revalidate finalists at higher quality; faster preview ranking may not survive convergence.

## 8. Optimizer investigation

Separate discrete choices (count, type, shape, IES asset) from continuous controls (position, aim, output, size, beam, color). A monolithic search across all source parameters is likely expensive; this is a design inference, not a measured runtime claim.

| Candidate | Evidence | Fit for Director | Decision |
|---|---|---|---|
| Coordinate/pattern search | Small transparent parameter perturbations; current style matcher provides a local precedent | Best initial baseline with limited active parameters | Extend existing patterns |
| Powell via SciPy | Existing derivative-free local optimizer [S15] | Useful bounded local comparison; noise must be managed | Evaluate externally |
| Differential evolution | Broad stochastic search; documented evaluation growth [S16] | Too expensive as an unconstrained default over many sources | Restricted experiment only |
| CMA-ES / pycma | Existing upstream implementation [S21] | Candidate for coupled continuous controls | Evaluate after baseline |
| Bayesian optimization / BoTorch | Designed for expensive noisy black-box objectives [S22] | Promising for a reduced parameter set; heavier dependencies | Later comparison |
| Differentiable renderer | Requires the renderer's derivative machinery [S19] | Does not directly differentiate native KeyShot | Research reference, defer integration |

**Proposed solver loop:**

1. Vision proposes a small number of source hypotheses with evidence and uncertainties.
2. Select a hypothesis and calibrate overall energy once.
3. Fit the dominant source's position/aim and angular size.
4. Fit fill/rim and shadow structure.
5. Fit color and background within declared locks.
6. If residuals imply a missing source, test a bounded structural move.
7. Retain the best compatible completed state; validate at higher quality.

Normalize variables, use log power where appropriate, and handle angular wraparound. Compare algorithms under identical capture/time budgets and initial hypotheses.

### High-value acceleration experiment: light-response basis

For fixed geometry, materials, camera and lighting transport settings, test whether individual source contributions can predict combined linear output. Include a base/environment image and preserve all carrier geometry/occlusion while varying emission. Fit nonnegative intensities with existing NNLS, then verify the combined result in KeyShot. [S23]

This is a proposed experiment, not a proven KeyShot shortcut. Tone mapping, denoising, changing geometry, clipping and measurement noise can break the practical approximation. Reject the acceleration if held-out combinations exceed a measured tolerance. It cannot estimate moving-source responses from one static basis.

### Budget reality

For central finite differences, one gradient estimate for d parameters needs approximately 2d evaluations. Six sources with eight free controls imply about 96 evaluations before repeated noise checks. This arithmetic explains why the current 12-capture default cannot support unconstrained gradient-style fitting. It is not a measured KeyShot timing estimate.

Use coarse previews to shortlist candidates and full-quality finalists to accept results. Cache keys must include scene/material identity, camera, source parameters, output transform, engine and render settings. Parallelize analysis; serialize mutations/renders through the active bridge unless separate rendering sessions are explicitly established.

## 9. Photographic sets and material ambiguity

Introduce optional owned white cards, black flags, backdrop/ground geometry and occluders. First demonstrate that the residual actually needs them. For reflective products, set geometry is part of the visible reflection environment.

Native HDRI-pin automation remains open. Research documented Env operations and installed graph/runtime surfaces first. A generated external HDR environment could be an alternative experiment, but it is not equivalent to native editable pins and cannot reproduce all near-field spatial effects. [L5; S4; S20]

Material diagnostics should report suspected roughness, anisotropy, coating, normal, IOR or transmission mismatches. Begin with observations and separate authorized calibration on independent material copies. Do not compensate indefinitely for the wrong material by adding extreme lights.

Look transfer to a different product should compare lighting descriptors, not penalize different labels, silhouettes or inherent material colors as reconstruction errors.

## 10. Interaction and recovery

The UI should expose real selected-source state, per-source aiming, solo/mute, units, locks and before/after comparison. A command such as “narrow this reflection” should select the corresponding region/source, propose a constrained adjustment, render it and retain it only after measurement/user review.

Persistent recovery is a prerequisite for long searches: record job identity, initial state, owned nodes/materials/environments, last accepted recipe, operation receipts and restoration status. On restart, inspect current scene identity and values before any restoration. Never infer ownership from a name prefix alone.

The research operation that reopens saved `PluginTest.bip` is explicitly disposable-scene recovery. It must not become automatic recovery for an unsaved user product scene. Production cancellation waits for active native calls; a Node timeout does not prove the renderer stopped. [L5; L7–L8]

## 11. Benchmark and experiment register

All following items are proposals. No new live scene experiments were executed for this report.

| ID | Question and method | Pass/fail evidence | Priority |
|---|---|---|---|
| E01 | Replay four existing source families on a saved disposable scene | Graph readback, changed render region, verified complete restore | P0 |
| E02 | Can every parameter be changed independently? One-at-a-time sweeps | Measured response and explicit unit/mode semantics | P0 |
| E03 | Does IES gain control reach native multiplier? Trace/apply gain-only and multiplier-only plans | Plan → bridge → readback → render agrees | P0 |
| E04 | Are capture noise and image transforms stable? Repeat fixed scene at several qualities | Per-metric repeat distributions; clipping/encoding documented | P0 |
| E05 | Can a known camera be recovered? Perturb camera and fit landmarks/silhouette | Held-out landmark and silhouette error, correct projection | P0 |
| E06 | Do matching masks improve ranking? Manual ground-truth regions versus rectangle/automatic masks | Mask errors and ranking failures by material/crop | P0 |
| E07 | Does numerical fitting outperform present refinement? Same rig/reference/budget | Held-out image metrics and blinded preference, repeated trials | P0 |
| E08 | Can native Planar be constructed and restored? Width/spread/alpha sweeps | Graph identity, independent effect, restore receipt | P1 |
| E09 | Does light-response fitting predict actual combined renders? Fit/test different mixtures | Linear residual and final beauty agreement exceed noise criterion | P1 |
| E10 | Does changing source structure help? Same budget, fixed topology versus bounded add/replace | Improvement without increased failures or unowned residue | P1 |
| E11 | Are IES distributions correctly aimed and ranked? Asymmetric profiles, axis/roll sweeps | Beam footprints and consistent profile-specific transforms | P1 |
| E12 | Are flags/cards required for residuals? Controlled glossy reference with known set | Better match plus unchanged product/reliable cleanup | P1 |
| E13 | Which optimizer buys quality per capture? Coordinate, Powell, CMA-ES, reduced BO | Quality/time/capture curves across repeated trials | P2 |
| E14 | Can jobs recover after restart/failure? Interrupt between each operation class | No lost baseline, explicit conflicts, no silent scene overwrite | P0 |
| E15 | Can real photographs match after alignment? Same physical product/CAD; record lens/set where possible | Regional image error, human review, limitations by material | P2 |
| E16 | Does multi-view evidence improve consistency? Optimize one view, validate additional views | Avoid a rig that only fools one view | P2 |

Start with simple matte/glossy primitives, then actual consumer products, glass and brushed metals. Include negative cases: wrong CAD, different materials, retouched references, saturated clipped highlights and busy sets. Split by scene/product into development and held-out sets; do not tune and evaluate on the same images.

Proposed artifacts per case: reference provenance, allowed edits, masks, camera calibration, original scene identity, baseline/final renders, source recipes, timing, all evaluated candidates, accepted/rejected reasons, repeat noise, and restoration receipts.

## 12. Delivery sequence and gates

| Stage | Scope | Gate |
|---|---|---|
| A: trustworthy controls | E01–E04, E14; reconcile capability/docs drift; independent physical parameter mode | Advertised controls and restoration demonstrated on disposable scenes |
| B: comparable images | E05–E06; camera overlay, editable masks, capture/color contract | Correct target correspondence and stable repeat measurements |
| C: controlled reconstruction | E07; reduced-variable numerical fitting and interpretable losses | Beats current matcher on held-out same-renderer cases at equal budget |
| D: richer source vocabulary | E08–E12; Planar, per-light targets, structural hypotheses, optional sets | Each addition improves specific benchmark cases and has recovery |
| E: precision product workflow | E13, E15–E16; optional advanced solver, persistent jobs, material diagnostics | Real-photo results documented by class, with clear failure/abstention behavior |

Do not assign calendar estimates until baseline capture latency, failed-operation frequency and controllable parameter count are measured. The work can proceed in vertical slices; it does not require completing every advanced research idea before a useful release.

## 13. Review of the original twelve-part plan

| Original workstream | Research verdict | Required revision |
|---|---|---|
| 1. Baseline | Strong and necessary | Separate same-product reconstruction, real photos and look transfer |
| 2. All source types | Partially already done | Credit four recorded live families; focus on Planar, missing parameters and recovery |
| 3. Calibration | More important than originally stated | Resolve normalized rig power versus physical flux and image exposure |
| 4. Camera | Necessary for precision | Landmarks/projection validation before automatic silhouette fitting |
| 5. Regions | Highest early leverage | Reference/render mask symmetry and transparent-surface handling |
| 6. Objective | Needed; current scores too narrow | Multiple highlight shapes, shadows, multiscale features and metric failure tests |
| 7. Setup discovery | Correct direction | Separate structural moves from continuous fitting and prove cleanup first |
| 8. Rendering cost | Essential | Measure budget; investigate response basis; avoid unconstrained global search |
| 9. Set tools | Needed for some references | Optional owned geometry; require residual evidence and recovery |
| 10. Materials | Essential diagnostic | Distinct opt-in fitting; do not hide material errors with lighting |
| 11. Manipulation | Valuable after control contract | Per-source aim and image-region linkage, real readback and measured commands |
| 12. Recovery | Must move earlier | Persistent receipts and restart conflicts before long optimization jobs |

## 14. Verification performed

Executed:

```text
node --test tools/test_photo_refinement.js tools/test_lighting_measurements.js tools/test_photo.js
24 tests passed; 0 failed.
```

These cover bounded plans, input validation, target projection, RGB labels, incompatible capture rejection, candidate acceptance/rejection, repeat-noise gating, limits, lock preservation, failures, cancellation, undo and saved outputs using local fixtures/injected dependencies. They do not establish renderer fidelity, successful native Planar control, real-photo matching quality or fresh live recovery.

Only this research Markdown document was added. The application, bridge, active KeyShot scene and global skill configuration were not modified.

## 15. Local evidence index

Paths below are relative to the repository root; function names are stable locators.

- **L1:** `server/photo.js` — `cleanPlan`, `measurementTarget`, `lightingFrame`, `SYSTEM`, `createDirector`.
- **L2:** `server/photo-refinement.js` — `settings`, `referenceMetrics`, `objectiveScore`, `decision`, `lockedPlan`.
- **L3:** `server/server.js` — `lightSpec`, `editLight`, photo-plan application around source radius/target conversion.
- **L4:** `server/rigs.js` — power normalization comments and native light recipe generation.
- **L5:** `server/lighting-lab.js` — `OPERATIONS`, especially native creation, snapshot, research checkpoint, pass capture, and gated removal.
- **L6:** `server/lighting-evidence.js` — `normalizeTarget`, `analyzeCapture`, `compareCaptures`, `summarizeLinearPass`.
- **L7:** `bridge/cc_lights.py` — `_set_params`, `_resolve_ies_asset`, `_load_ies_scene_material`, `op_light_set`, point/spot probe, environment operations.
- **L8:** `docs/MEASURED_REFINEMENT.md`, `docs/PHOTO_WORKFLOW.md` — current contracts and live-validation limits.
- **L9:** `docs/LIGHTING_AND_MOOD_DEEP_DIVE.md`, `docs/FEATURE_AUDIT_AND_KEYSHOT_CONTEXT.md`, `docs/SCENE_STAGING.md` — prior investigations and historical context; reconcile against current implementation.
- **L10:** `tools/test_photo.js`, `tools/test_photo_refinement.js`, `tools/test_lighting_measurements.js` — tests executed for this report.

## 16. External source register

Primary sources accessed October 29, 2026. Versioned pages describe their stated version; live documentation and repositories can change.

1. **S1 — [ECC search-first](https://github.com/affaan-m/ECC/blob/main/skills/search-first/SKILL.md).** Research-before-build workflow; full raw skill read.
2. **S2 — [ECC deep-research](https://github.com/affaan-m/ECC/blob/main/skills/deep-research/SKILL.md).** Research questions, cited synthesis and confidence; full raw skill read.
3. **S3 — [KeyShot 2026 light sources](https://manuals.keyshot.com/kss2026/en-us/manual/light-sources.html).** Physical source-family inventory.
4. **S4 — [KeyShot 2026.1 scripting reference](https://media.keyshot.com/scripting/doc/2026.1/lux.html).** Public API reference; version differs from installed target.
5. **S5 — [Area Light](https://manuals.keyshot.com/kss2026/en-us/manual/area-light.html).** Units, sidedness, source size and visibility.
6. **S6 — [Planar Light](https://manuals.keyshot.com/kss2026/en-us/manual/planar-light.htm).** Distinct source dimensions, spread and alpha controls.
7. **S7 — [Point Light](https://manuals.keyshot.com/kss2026/en-us/manual/point-light.html).** Position, output and radius.
8. **S8 — [Spotlight](https://manuals.keyshot.com/kss2026/en-us/manual/spotlight.html).** Source reference; fetch was retried after an initial timeout; bridge evidence remains the authority for tested axis behavior.
9. **S9 — [IES Light](https://manuals.keyshot.com/kss2026/en-us/manual/ies-light.html).** Profile output, multiplier, source shapes and axis.
10. **S10 — [Emissive](https://manuals.keyshot.com/kss2026/en-us/manual/emissive.html).** Practical-source behavior and lighting prerequisites.
11. **S11 — [OpenCV solvePnP](https://docs.opencv.org/4.x/d5/d1f/calib3d_solvePnP.html).** Known-correspondence pose estimation.
12. **S12 — [OpenCV GrabCut](https://docs.opencv.org/4.x/d8/d83/tutorial_py_grabcut.html).** Interactive rectangle/stroke segmentation.
13. **S13 — [SAM 2 upstream](https://github.com/facebookresearch/sam2) and [installation](https://github.com/facebookresearch/sam2/blob/main/INSTALL.md).** Promptable segmentation candidate; upstream reports Apache 2.0 code/checkpoints with separate demo asset licenses. Compatibility not installed/tested here.
14. **S14 — [LPIPS upstream](https://github.com/richzhang/PerceptualSimilarity).** Learned perceptual image comparison candidate.
15. **S15 — [SciPy Powell](https://docs.scipy.org/doc/scipy/reference/optimize.minimize-powell.html).** Existing local optimization implementation.
16. **S16 — [SciPy differential evolution](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.differential_evolution.html).** Global search and function-evaluation budget.
17. **S17 — [OpenEXR Python documentation](https://openexr.com/en/latest/python.html).** Broader image-reader candidate and memory behavior.
18. **S18 — [OpenColorIO](https://opencolorio.org/).** External color-management framework candidate.
19. **S19 — [Mitsuba inverse-rendering tutorial](https://mitsuba.readthedocs.io/en/stable/src/inverse_rendering/gradient_based_opt.html).** Differentiable renderer requirements and optimization example.
20. **S20 — [NVIDIA: Learning Indoor Inverse Rendering with 3D Spatially-Varying Lighting](https://research.nvidia.com/labs/toronto-ai/inverse-rendering-3d-lighting/).** Primary research project, ICCV 2021; useful conceptual evidence, not a Director benchmark.
21. **S21 — [pycma upstream](https://github.com/CMA-ES/pycma).** Existing CMA-ES implementation candidate.
22. **S22 — [BoTorch overview](https://botorch.org/docs/v0.17.2/overview) and [acquisition documentation](https://botorch.readthedocs.io/en/stable/acquisition.html).** Expensive/noisy black-box optimization; stable acquisition docs recommend log variants over older EI variants.
23. **S23 — [SciPy NNLS](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.nnls.html).** Nonnegative intensity fitting building block; does not establish KeyShot light-basis validity.
24. **S24 — [SciPy PyPI](https://pypi.org/project/scipy/) and [OpenCV Python PyPI](https://pypi.org/project/opencv-python/).** Public distribution options checked; exact wheel/runtime compatibility remains untested.

## 17. Remaining unknowns

- Exact Planar shader identifier, writable parameters and reliable construction/restoration on 2026.2.
- Native editable HDRI-pin API availability; no verified path established.
- Complete production cleanup of imported source carriers without reopening a disposable scene.
- Full matching outcomes from the current measured refinement on varied real products.
- Image transform/denoising effects on candidate ranking and linear-basis accuracy.
- Suitable camera/mask accuracy thresholds for each product class.
- Best optimizer under measured local render latency and realistic budgets.
- Package/model distribution cost and fresh-computer Windows/macOS compatibility.
- How much residual error comes from materials, CAD deviations, set geometry or photographic editing.

The next concrete implementation proposal should cover Stage A plus one controlled reconstruction slice from Stages B/C. That produces measurable evidence toward close matching while resolving the most consequential assumptions early.
