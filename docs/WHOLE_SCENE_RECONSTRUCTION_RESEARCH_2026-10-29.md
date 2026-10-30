# KeyShot Director: whole-scene reconstruction feasibility

Research date: October 29, 2026. Scope: research and architecture, not implementation. Companion documents: [lighting investigation](REFERENCE_LIGHTING_RESEARCH_2026-10-29.md) and [fresh REA evidence](WHOLE_SCENE_REA_EVIDENCE_2026-10-29.md).

## 1. Verdict

**The strongest credible product is an assisted scene-reconstruction system built around known product CAD, real KeyShot rendering, and explicit editable scene parameters.** It could progressively fit camera, placement, lighting, selected material parameters, backdrop and props, then deliver a native scene. This is a proposed achievable direction, not a demonstrated accuracy result.

A single image can constrain a convincing camera-specific reconstruction. Multiple consistent views can test and improve a coherent scene. Without CAD, an additional geometry problem appears: a plausible generated or reconstructed mesh is not equivalent to accurate product geometry, native CAD features, or a recovered assembly.

The native delivery route is promising: KeyShot documents BIP scene saving and KSP packaging, and its Python API documents `saveFile` and `savePackage`. Director does not currently expose a verified complete scene-reconstruction/export transaction. Native file-format reverse engineering is unnecessary for this route. [K1–K2]

There is no evidence here that arbitrary images can become exact editable scenes automatically. The appropriate ambition is **measurably close, editable reconstruction within a declared scene class**, with uncertainty, user assistance and rejection of incompatible references.

### Starting-condition matrix

The following ratings are engineering assessments based on the inspected capabilities and research, not measured success rates.

| Starting condition | One-view image match | Coherent additional views | Native editable result | Motion reconstruction | Original setup recovery |
|---|---|---|---|---|---|
| Correct CAD + one image | Strongest near-term target after camera/material calibration | Hidden surfaces/set remain unconstrained; validate separately | Credible through native camera, sources, materials and set assets | One still provides no trajectory | Generally non-unique; seek equivalent appearance |
| Correct CAD + consistent views/video | Strong target with more constraints | Best route to testing a coherent rig and shared materials | Credible, with shared scene and per-frame camera/object transforms | Rigid motion/camera are plausible; ambiguity and import limits remain | More constrained but still not uniquely identified |
| Images without CAD | Plausible reconstruction for favorable cases | Requires geometry reconstruction and coverage; hidden details uncertain | Mesh-based editable assets possible; CAD semantics not recovered | Requires geometry, tracking, motion separation and supported animation | Weakest case; geometry/material/light ambiguity compound |

**Product recommendation:** serve the first two cases well. Offer missing-asset reconstruction as a separate optional workflow, beginning with props and simple sets rather than exact consumer-product CAD.

## 2. Method and evidence levels

The investigation used the requested [REA skill](https://github.com/morluto/rea) and ECC's [search-first](https://github.com/affaan-m/ECC/blob/main/skills/search-first/SKILL.md) and [deep-research](https://github.com/affaan-m/ECC/blob/main/skills/deep-research/SKILL.md) workflows. ECC instructions were fully read earlier in this conversation and reused. REA's installed SKILL.md and evidence-workflows reference were read for this pass.

ECC's preferred Firecrawl/Exa tools were unavailable; available web search/open tools supplied the research channel. The main agent wrote this report and incorporated a parallel researcher's independent source review before finalization. The reviewed checkout baseline was `cf0c75361fe79d34edfaaf40764d88ad77f68cca`; local working-tree evidence also informs this report. No dependency installation, model download, native scene mutation, binary patching or BIP inspection occurred.

Evidence labels used throughout:

- **Observed artifact:** fresh local inspection of installed files or REA output.
- **Source-confirmed:** implementation exists in current source; not necessarily live-validated.
- **Recorded live:** project documentation/registry reports an earlier controlled native experiment.
- **Documented:** official external source describes a capability for its stated version.
- **Inference/proposal:** engineering conclusion or experiment requiring validation.

The earlier lighting report remains the detailed reference for source control, image objectives and solver options. This report extends it to geometry, materials, multiview consistency, animation and native delivery. Older project documents contain mixed historical/current claims; function definitions and current contracts take precedence.

## 3. Fresh REA and installed-application findings

REA inspected the current installed `kscripting.dll` without execution. Evidence `ev_5a7095a1c73211e0d49bdfa7ac372c78de8ceb417806948f43e60ea86bc642be` identifies SHA-256 `717834dc1546c216838a8e773b65c76e9f198a349181ad60dd8db5d8a6f68dfe`, 1,512,816 bytes, and complete bounded resource inventory. The hash matches the previously analyzed scripting artifact recorded in the project.

This is **identity evidence**, not a new behavioral finding. Historical Ghidra findings in `docs/LIGHTING_AND_MOOD_DEEP_DIVE.md` around line 469 describe material-graph node/edge wrappers and typed shader-parameter dispatch. Their applicability is supported by the matching artifact hash, but the historical decompilation was not replayed. Neither observation establishes an undocumented Planar constructor or HDRI-pin interface.

The installed `keyshot_commands.json` was freshly parsed. It declares 39 operations, including scene inventory, material assignment, cameras, environments, image-style settings, rendering and `save_file`. It contains no dedicated light-control family, and `set_environment` takes a name only. There is no `save_package` declaration in this catalog. These are declarations, not proof that its server runs successfully. See the companion REA appendix for paths, hashes and limits.

**Implication:** keep Director's typed Python bridge for detailed native manipulation. The shipped command catalog may supply useful integration ideas, but it does not replace that bridge or grant the missing controls.

## 4. Current capability matrix

| Component | Current evidence | Boundary | Relevant source |
|---|---|---|---|
| Scene inventory | Source-confirmed object IDs, hierarchy, units, bounds and selection | Bounds/names do not identify semantic image features | `bridge/cc_scene_context.py`, `bridge/cc_stage.py:op_scene_objects` |
| Product placement | Source-confirmed assembly translation, rotation, scale | Transform conventions and scene membership must remain valid | `bridge/cc_stage.py:op_stage_transform` |
| Duplication | Source-confirmed assembly copies, linked-material option | Not assembly/kinematic reconstruction | `bridge/cc_stage.py:op_stage_duplicate` |
| Sets | Source-confirmed pedestal/floor/backdrop boxes | No curved sweep, arbitrary prop generation or set-material editing in this contract | `docs/SCENE_STAGING.md`, `op_stage_set` |
| Lighting | Four source types with recorded live creation/readback | Planar and native HDRI pins unresolved; research deletion gated | `server/lighting-lab.js`, `bridge/cc_lights.py` |
| Photo fitting | Source-confirmed bounded vision proposals and metric gate | Fixed source count/types; limited objectives; no full-scene solver | `server/photo.js`, `server/photo-refinement.js` |
| Material inspection | Root Surface/Label/Geometry connections and parameter provenance | Connection does not prove geometry execution or arbitrary editability | `docs/MATERIAL_EDIT_RECEIPTS.md` |
| Material recovery | Session receipts for bounded value/copy/map edits | Not all construction, generated files or geometry execution; no persistent global undo | `docs/MATERIAL_EDIT_RECEIPTS.md` |
| Animation import | Source-confirmed glTF import with animation enabled; optional camera import | Native version-specific import behavior must be tested | `bridge/cc_anim.py:op_anim_import` |
| Animation playback | Source operations for info, time, groups and swap workflow | Does not prove arbitrary native timeline authoring | `bridge/cc_anim.py` |
| Native save/package | Official Python API documents both | No complete Director delivery/roundtrip flow established | [K1–K2] |
| Recovery | Lighting, staging and materials have different mechanisms | No atomic whole-scene transaction across them | `PHOTO_WORKFLOW.md`, `SCENE_STAGING.md`, `MATERIAL_EDIT_RECEIPTS.md` |

Do not confuse source presence, registry labels, successful fixture tests and live behavior. The earlier report ran 24 fixture-based photo/measurement tests; this pass did not rerun those tests or execute live scene tests.

## 5. Scene decomposition and uncertainty

**Proposed representation:** a scene hypothesis contains objects, transforms, surfaces, cameras, lights, environment, set geometry and image treatment. Every inferred value carries its evidence region/frame, confidence, allowed range and whether the user confirmed it.

Segmentation should separate product, props, backdrop, floor, cast shadows and reflection regions. Transparent surfaces require special labels because the observed pixels combine surface response and transmitted background. Reflection regions should not be mistaken for painted textures or physical seams.

Use manual corrections as the baseline. SAM-style masks, depth/normal estimates and geometry models can initialize hypotheses, but their outputs need consistency checks. VGGT supplies camera/depth/point/track predictions from views; that is useful geometric initialization, not a complete native scene or material decomposition. [R2]

Evidence that most reduces ambiguity, in recommended order for known CAD:

1. Correct product variant, dimensions and assembly configuration.
2. Matching camera view plus a few marked image/CAD landmarks.
3. Additional views taken under the same lighting and material state.
4. Lens/crop metadata and known scale.
5. Material samples, finish descriptions and texture dimensions.
6. A clean background/ground plate, light/set photographs, or HDR brackets.

For video, first establish whether lighting, exposure, focus and product configuration remain fixed. More frames are not automatically more independent evidence; a static repeated frame adds little constraint.

## 6. Geometry, assembly and physical layout

### Known CAD

Use CAD as a hard geometric constraint. Fit whole-product pose first, then explicitly permitted part configurations. Do not change product shape to improve a photographic score. Investigate contact constraints, support planes, occlusion order, inter-object distances and collision checks for duplicated products or props.

The existing staging implementation already supplies assembly movement, duplication and simple sets. Extend it through typed scene specifications and exact ownership receipts. CAD assembly hierarchy can help part selection, but does not itself supply joint axes or kinematic constraints.

### Missing CAD

| Route | Suitable use | Main uncertainty | Native result |
|---|---|---|---|
| Primitive/procedural fitting | Pedestals, simple boxes, cylinders, backdrops | Dimensions and hidden geometry | Editable generated mesh; optionally source parameters |
| Existing asset retrieval | Known props or catalog objects | Correct variant, rights and scale | Imported mesh/CAD with provenance |
| Photogrammetry/COLMAP | Multiple textured, overlapping views of a stable object | Textureless/specular/transparent regions, scale and coverage | Reconstructed mesh/texture, not original CAD history |
| Learned geometric initialization | Camera/depth/point estimates | Domain error and unobserved structure | Intermediate estimates requiring meshing/validation |
| Image-to-3D generation | Plausible props or concept exploration | Invented hidden details, metric accuracy and topology | Generated mesh/PBR assets, not verified product replication |

COLMAP's documented pipeline recovers cameras/sparse geometry then dense depth/normals/surfaces. Its capture guidance warns about textureless imagery. Use a known dimension to establish scale and reserve unseen views for evaluation. [R1]

TRELLIS produces several representations including meshes and Gaussians. The original upstream implementation documents Linux testing and substantial GPU requirements; it is a candidate to evaluate, not a plug-and-play Windows dependency. Its generated assets do not establish dimensional accuracy. [R3]

Avoid making radiance fields or splats the final editable KeyShot representation without a demonstrated conversion path. A representation that stores view-dependent appearance may reproduce images while entangling illumination and material. Relighting and native editing tests must follow import.

## 7. Camera and photographic pipeline

Fit camera using landmarks, silhouettes and geometry before optimizing illumination. Treat focal length, camera pose, crop and lens shift as distinct variables. A camera solver must be validated against KeyShot's actual coordinate and projection conventions.

The prior report recommends OpenCV pose fitting from known 2D–3D correspondences. That does not automatically solve unknown focal length, feature identity or symmetry. Use bounded focal sweeps and user assistance for ambiguous products. Perspective, orthographic, panoramic and shifted lenses need separate contracts.

Lock exposure and image style during initial physical fitting. Later, fit only declared image-treatment parameters. Distinguish actual camera/image exposure from Director's current rig-energy multiplier. Depth of field, bloom, clipping, white balance and local retouching can otherwise be misdiagnosed as lighting errors.

**Acceptance proposal:** overlay held-out landmarks/silhouette edges; evaluate camera error separately from appearance. If no camera hypothesis fits without altering product shape, flag the reference/CAD mismatch before spending a lighting budget.

## 8. Lighting and reflection reconstruction

Carry forward the detailed source matrix in the earlier report. Its most important changes are independent source targets, explicit physical-unit modes, source-shape freedom and structural hypotheses. Current cleaned plans keep one to six sources, fixed identities/types during refinement, and shared aim behavior. These are useful bounds but exclude many photographic rigs.

The required evidence chain is:

`reference cue → source hypothesis → typed scene parameter → native write → readback → measured render change → verified restoration`.

Do not promote a control until the chain is demonstrated. Examples:

- A long metal reflection suggests a strip/card hypothesis; test extent and orientation, not only brightness.
- A hard projected pattern suggests an occluder/textured directional source; test supported Planar/spotlight paths.
- Dark bands on polished surfaces may require negative fill or reflection geometry, not reduced source power.
- Nearby practical lights may require spatially varying illumination; a distant HDRI may only approximate them.

The earlier investigation establishes the Area/Planar unit distinction, IES profile/multiplier semantics, spotlight aim caveats and emitter visibility controls. Planar and native HDRI-pin automation remain open. Generated external HDR environments are an alternative to investigate, with their own editability and near-field limitations.

## 9. Materials and textures

Recovering materials jointly with illumination is ambiguous. Use the current material graph as a prior, user finish descriptions as constraints, and multiple views as validation. Fit a few exposed physical parameters before considering graph reconstruction.

**Current implementation boundary:** `server/material-core.js` compiles texture sets into Simple Plastic, accepting base color, roughness, normal/bump and optional AO multiplication; unsupported channels are skipped. This path is not a general PBR material importer. Broader material-family fitting below is proposed work, even where separate graph inspection/edit operations already exist.

Recommended order: texture scale/orientation and base-color plausibility; roughness; metallic/dielectric family; coating/anisotropy; transmission/IOR; then normal/bump detail. This is a proposed diagnostic ordering, not a universal solver rule.

For glass, distinguish background transmission, absorption, surface reflection and geometry thickness. For brushed metal, distinguish anisotropy direction from an elongated emitter. For textured plastic, ensure shading has not been baked into the color map. Use alternate-light renders to test material independence.

Director's receipts cover selected exposed values, independent-copy assignments and supported map replacements. They do not cover arbitrary construction, all generated resources, geometry execution or persistent undo. A future material-fitting stage should operate on explicit independent copies with original assignment recovery. [L4]

NVIDIA nvdiffrec demonstrates joint multiview mesh/material/environment estimation with explicit outputs. It is a useful research architecture, but its renderer and material assumptions are not KeyShot's. Importing its outputs would require controlled parameter mapping and native rerender validation. [R4]

## 10. Hierarchical optimization

**Proposed architecture:** an observation model proposes hypotheses; deterministic code validates and applies them; native renders evaluate them; a bounded optimizer updates one parameter block at a time.

1. Validate input compatibility and establish scale.
2. Fit geometry pose/camera using geometric evidence.
3. Fit dominant illumination with materials locked.
4. Diagnose residuals before unlocking material or set changes.
5. Fit selected material blocks on copies.
6. Add set/occluder/source hypotheses when residual structure warrants them.
7. Jointly refine a small selected parameter subset.
8. Validate unseen views, higher-quality renders and native editing.

Start with coordinate/pattern search and compare bounded Powell or CMA-ES later. Consider Bayesian optimization for reduced expensive parameter sets. A differentiable surrogate is a later option, with native KeyShot acceptance as the final gate. These choices and existing libraries are documented in the companion lighting report.

Do not optimize all scene variables at once. Otherwise a wrong camera can be compensated by wrong materials and an implausible rig. Use parameter locks, priors, penalties for unnecessary complexity and explicit alternative hypotheses.

### Measurement design

Track camera/silhouette error, region correspondence, multiscale color/tone, highlight component shape, shadow geometry, background, temporal consistency and restoration separately. A learned perceptual metric may supplement these, but cannot certify physical or native-scene correctness.

Estimate render-repeat variation. Accept candidates only after compatible-state checks and a meaningful improvement relative to noise. Validate finalists at higher sampling quality. A cheap preview that ranks candidates incorrectly should not dictate the final scene.

**Cost model:** measure native render latency first. A solver with dozens of free parameters can exhaust the present short budget before useful exploration. Adaptive resolution, cached identical states and fixed-geometry light-response fitting are experiments, not guaranteed speedups. Serialize writes through the active KeyShot session.

## 11. Video and animation

Multiple frames help only if the scene assumptions are explicit. Split static backgrounds, rigid product motion, camera motion, articulated parts and changing illumination. A moving camera around a static product and a rotating product under fixed lights have different reflection behavior.

Use background tracks, known product landmarks and shadows to constrain motion interpretation. Fit poses first; fit shared illumination/materials across frames second. Hold out frames and camera angles. Do not allow independent per-frame lights to hide a failed shared scene unless reference lighting actually changes.

Current `bridge/cc_anim.py:op_anim_import` requests glTF animation and optionally camera import while preserving placement settings. That is source evidence. The 2026.2 supported-format page marks glTF/GLB, FBX and Alembic as including animation; older 2025 import documentation narrows glTF support to node animation. Do not silently treat that older restriction as confirmed current behavior: test exact 2026.2 channels and interpolation before advertising support. [K3–K4]

The existing `server/video.js` recipe uses camera/framing keys, one rig selection and a fixed base field of view; its offline path lacks orbit detection. It is not a general scene-motion solver. `bridge/cc_anim.py` also records a historical crash warning against `getAnimations`/`createAnimation`; this investigation did not reproduce that crash. Its experimental `CCA_` prefix-based cleanup is weaker than staging's ownership checks and must not become the recovery guarantee for reconstruction.

Rigid node transforms and camera paths are the practical first target. Articulated rigid parts require known segmentation/pivots. Skeletal, morph and deforming reconstruction are outside the established route. Material/light animation and timeline authoring need independent capability probes; setting a playback time is not proof of authoring support.

## 12. Native delivery and scene-wide recovery

A useful deliverable should contain:

- Native BIP scene and portable KSP package, created only through an explicit save/export action.
- Editable native lights, cameras and supported material parameters.
- Imported/generated assets with source/provenance and texture files.
- A scene specification and parameter-lock record.
- Reference alignment, benchmark renders, known limitations and operation receipts.

KSP is the documented packaging route for associated resources. Verify it by reopening in a separate test environment and checking inventory, textures, environments, cameras and animation before comparing a render. A JSON recipe alone is neither a native scene nor proof of portability. [K1–K2]

Current undo domains are separate: photo undo, staging history and material receipts. A whole-scene solver needs a transaction coordinator and persistent journal, not a call to whichever undo function is available.

Record stable scene fingerprint, runtime IDs, created identities, original values/assignments, asset hashes and the last accepted state. Detect external edits and refuse destructive restoration on conflicts. File reopens can invalidate runtime IDs; persistence must remap or require a new session. Current material identity cannot prove a scene-load generation change under every same-file reopen. [L4]

Do not use disposable `PluginTest.bip` reopen recovery on an unsaved user product scene. Long-run cancellation must wait for the current native operation and then follow a verified recovery sequence.

## 13. Architecture alternatives

| Architecture | Achievable target | Dependencies | Main risk | Investment gate |
|---|---|---|---|---|
| A. Guided native reconstruction | Known CAD, selected view, editable camera/lights/simple set and bounded materials | Existing bridge, masks, alignment, numerical search, journal | Confounded image score and recovery gaps | Beat existing matcher on held-out native cases under equal budget |
| B. Multiview scene fitter | Shared scene across images/video; rigid poses and richer props | A plus correspondence/tracking, per-view cameras, shared-variable solver | Incorrect motion/static-scene assumption | Better held-out views without per-view appearance cheating |
| C. Hybrid geometry reconstruction | Missing props/products as imported meshes, then native fitting | COLMAP/learned geometry/generation adapter, import QA | Baked lighting, wrong topology/dimensions | Relighting and measured geometry tests survive native import |
| D. Research surrogate system | Fast gradients/learned proposals for complex joint fitting | Differentiable renderer or trained response model, material translation | Surrogate finds solutions KeyShot cannot reproduce | Native quality per wall-clock cost beats simpler fitting |

**Recommended small-team strategy:** A first, B next, selective C for props, D only after A/B produce a useful dataset and measured bottleneck. Preserve human confirmation for ambiguous correspondence and material/set interpretation. An agent should orchestrate well-defined operations; it should not improvise arbitrary scene scripts during optimization.

## 14. Experiment register

All budgets below are proposed research caps, not timing predictions. Every live experiment requires an isolated saved scene and verified recovery. Stop immediately on scene-identity mismatch or failed restoration.

| ID | Hypothesis / controls | Measurements and acceptance | Initial budget / stop rule |
|---|---|---|---|
| X01 | Existing native controls are repeatable; one source/parameter at a time | Readback and changed expected image region; restored baseline | Four families, three settings each; stop on unexplained mutation |
| X02 | Physical versus normalized output can be separated | Power/distance/area sweep; independent responses documented | One matte and one glossy target; stop if units cannot be established |
| X03 | Known camera can be recovered without lighting changes | Held-out landmarks and silhouette; correct pose family | Three controlled perturbations, 30 evaluations each; stop on symmetry ambiguity |
| X04 | Correct masks improve objective ranking | Manual truth versus rectangle/automatic masks | Ten cases including glass/crops; stop automatic promotion when corrections remain large |
| X05 | A native solver improves same-CAD reference reconstruction | Equal-budget baseline comparison, repeated finalists and blinded review | Five scenes, 40 evaluations per method/case; no claimed generality beyond sample |
| X06 | Per-light aim/Planar expands solvable cases | Readback, beam/highlight shape and restore | Three source configurations; stop if construction/undo unverified |
| X07 | Joint material fitting helps without absorbing lighting | Same scene under alternate validation light and view | Two exposed parameters on a copy, 30 evaluations; reject relighting regression |
| X08 | Owned flags/backdrops explain residuals | Occlusion/reflection change, unchanged product, exact cleanup | Three known-set scenes, at most three props; stop on ownership uncertainty |
| X09 | Shared multiview fitting beats single-view fitting | Held-out view error and shared parameters | Six views per object, fit four/hold two; 60 evaluations; reject per-view cheating |
| X10 | Video motion classification is correct | Background/product tracks, rigid pose and reflection consistency | Two short clips, ten selected frames each; stop at incompatible motion model |
| X11 | glTF rigid animation survives import | Transform samples, timing, materials, hierarchy and camera behavior | One known synthetic animation per channel family; reject unsupported channel |
| X12 | A scene package is portable | Reopen inventory, missing assets, matched render, editable nodes | One fully specified scene and separate reopen; stop if dependencies missing |
| X13 | Recovery spans all mutation domains | Inject failure between each operation; verify originals and accepted state | One test per mutation class; any silent loss blocks release |
| X14 | Reconstructed mesh is useful for native relighting | Geometry dimensions, silhouette, alternate-light/view images | Three props using existing assets versus reconstruction; reject baked-light advantage |
| X15 | Surrogate/basis reduces cost without changing accepted quality | Native finalist error versus predicted ranking | One fixed scene, held-out parameter combinations; stop if ranking is unreliable |

Predeclare per-metric tolerances using baseline noise and the intended output resolution. Do not select tolerances after seeing results. Record total render/analysis/model costs, not just optimizer iterations. Require both a better image and a valid editable scene.

## 15. Roadmap and first implementation slice

### Phase 1: scene contract and repeatability

Unify capability/evidence records, independent physical parameter semantics, capture configuration and persistent operation receipts. Verify existing staging/material/light recovery boundaries and native package roundtrip. Output: a trusted scene-building substrate.

### Phase 2: known-CAD single-view reconstruction

Add camera overlay/landmarks, editable masks, per-source aim, spatial objectives and a reduced numerical search. Output: a camera-specific editable scene with measured residuals and explicit unsupported regions.

### Phase 3: shared multiview scene

Add view correspondence, shared material/light variables, held-out validation and rigid motion. Output: a coherent reusable product setup, not merely independent matched frames.

### Phase 4: optional richer sets and missing assets

Add procedural props/cards, reconstruction adapters and material diagnostics according to measured residuals. Output: broader scenes with asset provenance and editable native mapping.

### Phase 5: research acceleration

Only after measuring cost, evaluate response bases, Bayesian search or surrogate differentiable fitting. Output: demonstrated quality-per-cost improvement over the simpler native solver.

**First slice:** one saved product scene, one known native reference, camera locked initially, one or two area lights, fixed material, editable product mask, six or fewer physical parameters, 40-evaluation cap, best-state retention, high-quality finalist check and explicit native save/package action. Compare against the current matcher with equal captures. Include interruption/restart recovery and reopen verification before extending to arbitrary photos.

This is narrow enough to diagnose failure: if it cannot reconstruct its own known renderer reference under controlled assumptions, adding generative geometry or more agents will obscure the problem.

## 16. Challenge to the recommendation

| Failure hypothesis | Why it matters | Evidence that would change the recommendation |
|---|---|---|
| KeyShot calls are too slow for practical fitting | A sound solver may be unusable interactively | Measured latency/quality curves showing no useful budget; prioritize guided edits or response bases |
| Materials dominate mismatch | Lighting-only fitting plateaus | Alternate-light/view tests show systematic finish errors; prioritize controlled material calibration |
| Native state is not recoverable | Longer runs threaten user work | Repeatable recovery failures; isolate reconstruction in separate user-approved scenes |
| Image objectives disagree with users | Optimization can improve numbers and worsen images | Blinded comparisons; redesign losses before changing solvers |
| Reconstruction assets bake lighting | Relighting/editability fails despite matching input | Alternate illumination test; use known CAD/retrieved assets instead |
| Surrogate translation is inaccurate | Differentiable gains vanish in KeyShot | Persistent native residuals after transfer; abandon surrogate for direct fitting |
| Single-view evidence is insufficient | Hidden scene remains unconstrained | Additional views reveal contradictory solutions; request targeted evidence rather than fabricate certainty |
| Native package loses dependencies | Deliverable cannot be reused | Reopen failure; block portability claims until resolved |

The most optimistic credible outcome is a highly capable scene-fitting assistant with native editing and measured validation. The least defensible promise is one-click exact reconstruction of any product photograph into its original physical scene. The distinction should shape both implementation and product claims.

## 17. Coverage and unresolved questions

| Brief area | Status | Remaining proof |
|---|---|---|
| Scene decomposition | Partially answered | Mask/semantic correspondence accuracy on target products |
| Geometry/layout | Answered at architecture level | Native import accuracy, generated prop fidelity and contact constraints |
| Camera/pipeline | Partially answered | Exact projection/color calibration on installed build |
| Lighting | Existing control evidence consolidated | Planar, HDRI pins, independent targeting and complete recovery |
| Materials | Bounded route identified | Native value/graph lifetimes, joint-fit identifiability |
| Optimization | Comparative experiment plan supplied | Actual quality/cost rankings |
| Video/animation | Rigid route identified | Channel/interpolation import and motion classification benchmarks |
| Native delivery | Documented route established | Director integration and separate-machine package roundtrip |

No new live reconstruction result is claimed. The report answers feasibility and proposes falsifiable next steps; renderer outcomes remain experiments.

## 18. Annotated sources

### KeyShot primary sources

- **K1:** [2026.1 lux scripting reference](https://media.keyshot.com/scripting/doc/2026.1/lux.html): documented scene/camera/material/render operations and native `saveFile`/`savePackage`. Target build is 2026.2; verify version behavior.
- **K2:** [2026 File menu](https://manuals.keyshot.com/kss2026/en-us/manual/main-menu_file.html): BIP saving, KSP packaging and resource localization.
- **K3:** [2026 supported formats](https://manuals.keyshot.com/kss2026/en-us/manual/supported-file-formats.html): glTF/GLB animation-listed import route.
- **K4:** [2026 import](https://manuals.keyshot.com/kss2026/en-us/manual/import.html) and [2025 import](https://manuals.keyshot.com/kss2025/en-us/manual/import.html): placement/import semantics and node-animation limitation; validate installed build.
- Source-specific light documentation and optimization-library references are indexed in the companion lighting report; its claims retain their original evidence limitations.

### Reconstruction research and upstream implementations

- **R1:** [COLMAP tutorial](https://colmap.github.io/tutorial): SfM, dense reconstruction and capture guidance. Existing reconstruction pipeline candidate; not installed/tested here.
- **R2:** [VGGT upstream](https://github.com/facebookresearch/vggt): camera/depth/point/track estimation. Candidate initialization, not complete native scene reconstruction.
- **R3:** [Microsoft TRELLIS upstream](https://github.com/microsoft/TRELLIS): generative 3D representations and installation constraints. Plausibility does not establish geometric accuracy; newer TRELLIS variants need separate version/license/runtime evaluation.
- **R4:** [NVIDIA nvdiffrec project](https://nvlabs.github.io/nvdiffrec/): multiview joint mesh/material/environment reconstruction. Useful explicit-output architecture with substitute-renderer assumptions.

### Local implementation and evidence

- **L1:** `bridge/cc_stage.py`, `docs/SCENE_STAGING.md`: native scene inventory, transforms, duplication, simple sets and staging undo.
- **L2:** `server/photo.js`, `server/photo-refinement.js`, `server/lighting-evidence.js`: proposal grammar, metric acceptance and capture compatibility.
- **L3:** `server/lighting-lab.js`, `bridge/cc_lights.py`, `docs/LIGHTING_AND_MOOD_DEEP_DIVE.md`: source operations, recorded live findings and historical REA evidence.
- **L4:** `docs/MATERIAL_EDIT_RECEIPTS.md`: precise supported recovery boundaries and scene identity limitations.
- **L5:** `bridge/cc_anim.py`: animation import, playback and swap operations; source presence is not complete native validation.
- **L6:** `PRODUCT.md`, `docs/PHOTO_WORKFLOW.md`, `docs/MEASURED_REFINEMENT.md`, `docs/FEATURE_AUDIT_AND_KEYSHOT_CONTEXT.md`: product constraints, contracts and historical feature context.
- **L7:** [fresh REA appendix](WHOLE_SCENE_REA_EVIDENCE_2026-10-29.md): exact installed artifact/catalog fingerprints and observed evidence scope.

License, distribution, GPU/RAM requirements, version pins and Windows/macOS packaging must be checked for each selected external dependency before implementation. No candidate was installed or benchmarked during this report.
