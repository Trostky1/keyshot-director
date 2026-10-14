# Lighting and mood recreation: deep dive and gameplan

## Objective

Make KeyShot Director reliably turn a visual reference into an editable, product-scaled lighting setup, then improve that setup through evidence from the actual KeyShot renderer. Optimize for a strong visual match and a comprehensible workflow. Recovering the reference photographer's exact physical light rig is neither necessary nor generally possible from one image.

## Current implementation

### What is already in place

- `server/photo.js` sends the reference and a current KeyShot render to the selected vision agent. It asks for a bounded plan containing a KeyShot HDRI, background and ground settings, up to six area lights, optional framing, observations, and limitations.
- The plan uses camera-relative azimuth, elevation, and product-span units. `server/rigs.js` uses a similar product-scaled coordinate system for the named studio rigs.
- `bridge/cc_lights.py` creates real rectangular emissive panels in KeyShot, aims them at the product center, sets power, color temperature, reflection visibility, and shadow visibility, and checks panel placement against an independently computed bounding box.
- The photo workflow snapshots camera, environment, visible Director lights, and bridge state; hides existing Director lights; creates an isolated photo environment; captures a real renderer preview; and can restore the previous state. It keeps a recipe and before/after images.
- The standard style matcher measures a live render, scores it against a style-folder profile, and uses bounded greedy search over environment brightness, light gains, and the key light's azimuth.
- The Studio inspector now exposes a separate 0–2× global environment-fill slider. It scales HDRI illumination across the scene while leaving direct-light power, exposure, and the visible backdrop independent; the zero endpoint is represented by a tiny positive native brightness. It cannot selectively darken one region of the HDRI; localized reflection/illumination shaping would need verified HDRI pins or physical flags/lights. The style matcher's environment search is capped to the same supported range.
- Lighting rigs already include a useful vocabulary: key, fill, rim, top, kick, backlight, and environment-only looks. Existing exposure adjustment meters p95 for darker looks and p50 for white studio looks.

### Where the current match gets its evidence

For a photo match, hand-engineered pixel features are sent to the vision model as approximate measurements. The model proposes the scene and light parameters. In refined mode, the first candidate also gets a Clown-aligned Direct/Reflection/Shadow capture; compact linear measurements are supplied to the one visual refinement pass, then an identical pass set is captured again and compared against its baseline. The workflow still does not score the candidate against a numeric reference-image objective or systematically search light parameters.

The reusable style profile extracts background tone/gradient, product brightness percentiles, clipping/crushed blacks, contrast, warmth, highlight center, left/right and top/bottom bias, edge glow, and approximate product bounds. Reference images are split only into light and dark background groups. The segmentation is a border-color heuristic, not a robust object/shadow/reflection decomposition.

### KeyShot constraints that should shape the specialists

KeyShot documents **Area Light** as its scene-illumination material. It supports separate camera, reflection, and shadow visibility. Its documented power modes also matter to our rig grammar: lumens hold total flux constant when source size changes, while lux scales total output with emitting area; source size independently changes shadow softness. The agent therefore must not treat “make the panel bigger” as a purely softening edit if it also changes power in the selected unit. See [KeyShot Area Light](https://manual.keyshot.com/manual/materials/material-types/light-sources/area-light/).

Environment lighting and the visible background are distinct controls: KeyShot says the background color can replace the visible HDRI while the environment still affects lighting and shadows. The HDRI Editor adds rectangular/gradient/image pins and their own color, falloff, and transform controls. This is particularly relevant to reflective metal and glass; our current bridge uses actual area-light panels and environment file/brightness/rotation/background controls, but does not expose HDRI pin editing. Treat HDRI pins as a promising later capability only after the installed scripting API is verified, not as something the current agent can already edit. See [Environment Settings](https://manual.keyshot.com/keyshot11/manual/environments/environment-settings/), [HDRI Editor Pins](https://manual.keyshot.com/manual/environments/hdri-editor/hdri-editor-pins/), and [Environments](https://manual.keyshot.com/manual/environments/).

KeyShot also documents separate shadow, reflection, refraction, and raw render passes. If those passes can be obtained through the installed scripting bridge, they could give the evaluator cleaner evidence than whole-image RGB statistics. This is an investigation item, not a current capability claim. See [Layers and Passes](https://manual.keyshot.com/manual/render-4/render-output/layers-and-passes/).

## Reframed direction: learn KeyShot's lighting system first

The first milestone is not another mood preset or a more elaborate image score. It is a verified map of the light types, scene geometry, material-graph parameters, environment controls, and render settings that this installed KeyShot version exposes to scripts. Mood and shot presets should be recipes made from those verified primitives.

KeyShot's documented scene-lighting model has two main contributors: environment lighting and physical lights implemented as light-source materials on geometry. KeyShot lists four physical types: Area, Point, IES, and Spotlight. These are meaningfully different tools, not interchangeable names for a rectangular panel:

| Primitive | What it contributes | Type-specific controls to verify |
|---|---|---|
| Environment / HDRI | Broad image-based illumination and reflections around the scene | Environment asset, brightness, rotation, size/height, background versus lighting image, ground effects, and whether HDRI pins are scriptable |
| Area | Broad emitting geometry; its dimensions shape reflection size and shadow softness | Geometry shape/orientation, emitted side, flux unit, color/Kelvin, sample count, camera/reflection/shadow visibility |
| Point | A compact source at a position, with source radius affecting shadow softness | Position, radius, power unit/value, color/Kelvin, visibility and any geometry behavior |
| IES | A point-like source shaped by a photometric distribution profile | Profile loading, orientation, distribution dimensions, color and power controls |
| Spotlight | A directed cone with controllable beam and edge behavior | Aim, beam angle, falloff, source radius, power unit/value, color and visibility |

The distinction matters to scene recreation. A large area emitter can create broad specular cards and soft shadows; a spot or IES profile can create a localized directed pool; a point source is more compact and its radius changes penumbra. An environment can shape many reflective surfaces at once. The best match may combine these rather than forcing every effect through area panels. KeyShot's documented [lighting overview](https://manual.keyshot.com/manual/lighting/) and its [physical-light controls](https://manual.keyshot.com/manual/whats-new/feature-highlights/) describe these separate source types and interactive controls.

### What the installed Director bridge currently proves

- `bridge/cc_lights.py` now creates and updates tracked Area, Point, Spotlight, and IES sources through native KeyShot material graphs. Area, Point, and Spotlight use installed light materials; IES loads a verified installed MTL/profile pair into the project.
- The captured KeyShot scripting documentation exposes environment methods such as `setLightingEnvironment`, `setBrightness`, `setRotation`, and ground/background controls. It also exposes material-graph inspection and parameter access in the recorded `lux` API dump.
- Live graph inspection confirmed `lux_mesh_light`, `lux_point_light`, `lux_spotlight`, and `lux_ies_light`. Thirty-one installed IES material/profile pairs were found; a K72 3000 K profile loaded, aimed, rendered, and read back with its native warm color intact when no override was requested.
- Controlled Point and Spotlight checks confirmed typed creation, parameter readback, and visible render contribution. Spotlight’s local -Y aim is verified for the tested material and setup. The saved-scene checkpoint is the reliable rollback; direct deletion of imported light geometry remains unverified.
- Planar Light creation and HDRI-pin editing are still outside the verified script surface. They remain separate REA/API research questions rather than promised capabilities.

### Where API Anything fits

[API Anything](https://github.com/goodnight000/api-anything) learns and calls a website's own HTTP requests through templates, browser capture, CLI, or MCP. KeyShot is a desktop application whose documented automation surface is its in-process Python `lux` / `luxmath` scripting API, not a website endpoint. API Anything therefore cannot grant KeyShot new API access, unlock hidden operations, or bypass licensing. Its useful contribution is an architectural pattern: discover concrete operations, record input/output shapes, replay them with new inputs, and verify the result.

For Director, use that pattern to build a **KeyShot Lighting Capability Explorer** over the supported `lux` API:

1. **Inventory read-only:** record KeyShot version, callable `lux` surfaces, environment methods, scene nodes, light-library materials, shader node types, and every light parameter's name, type, default/current value, and limits where available.
2. **Establish the object model:** determine how each physical light is represented in the scene, how its geometry and transform are read/written, how its material graph attaches, and how it is identified for list/update/remove/restore.
3. **Probe one type at a time on a saved disposable test scene:** use a primitive or library light asset; change one property; render one bounded preview; compare the visible result; then restore. Record exact capability, version, errors, and confidence. Keep probes short and do not run them against the user's product scene by default.
4. **Promote only verified controls:** add typed bridge operations behind a shared light interface, with per-type validation and safe defaults. Keep the existing area-light operation stable while each new type is proven.
5. **Build looks afterward:** let clean catalog, close-up, low-key, and colored dramatic playbooks compose and tune these real primitives. Add material-response adapters for glass, metal, and matte surfaces. Keep renderer settings such as Product/Interior lighting technique explicit because they change how the same rig renders.

The specific API Anything ideas worth carrying over are: represent a learned control as a named operation with a small input schema; compare two distinct input runs so real parameters are separated from constants; test a new input that was not used during discovery; replay only after schema validation; and treat failed validation as a failed operation rather than guessing. For KeyShot, the operation record should also include the observed KeyShot version/build, scene preconditions, before/after scene inventory, render evidence, cleanup result, and confidence label. Do not copy its browser/network-capture mechanism: our observable evidence is the documented `lux` call, its live parameter graph, and the rendered scene. Keep the actual transform/setter implementation deterministic and typed; let the agent select the operation and supply validated values, not synthesize arbitrary Python calls.

This is directly aligned with API Anything's README: its operation templates are learned by comparing page requests across example inputs, then replayed with new arguments and repaired only when replay validation succeeds. Its own readme says an operation only covers a selected feature, not the whole site. In our adaptation, each probe similarly proves one narrow KeyShot action and its caveats; a successful Point material swap does not imply Point creation, orientation, scene ownership, or cleanup is solved. See the [API Anything project overview](https://github.com/goodnight000/api-anything) and its [design notes on learning, replay, and validation](https://github.com/goodnight000/api-anything/blob/main/docs/DESIGN.md).

This is a clean-room integration with KeyShot's documented scripting surface. If later evidence suggests a documented API gap, the next step is to ask the vendor for an extension point or file a reproducible request—not to patch binaries or assume that a web request-capture tool can expose private desktop calls. KeyShot documents scripting for lighting presets, environments, materials, geometry, camera, and rendering in its [scripting reference](https://manual.keyshot.com/manual/scripting-2/).

## Assessment

The foundation is unusually strong for a companion app: it acts on real KeyShot lights, respects product scale, checks an actual render, and has an explicit restoration path. The main capability gap is earlier in the chain than the first draft of this plan assumed: Director currently has a useful area-panel workflow, but it does not yet model or control KeyShot's full physical-light vocabulary. First learn and expose that light model; then improve evidence interpretation and renderer search using the richer controls.

The current photo workflow has four important ceilings:

1. **A single visual plan has no objective feedback loop.** The model makes a large set of coupled choices, gets one render, and gets one chance to revise. The final result can be plausible without being the best candidate.
2. **Image statistics mix together causes.** Product color, material, view angle, exposure, tone mapping, reflections, shadows, backdrop, and light are not separated reliably. A global brightness or color difference can recommend the wrong correction.
3. **The scene description is still coarse.** It knows a bounding box and camera pose, but not which part is glass, metal, dark plastic, or a selected focal area. The same light can make two materials respond very differently.
4. **Reference variation is under-modeled.** Style profiles tolerate per-image spread but currently only separate bright and dark looks. They do not organize by product/material, camera family, physical set, or shot type.

The ambiguity is fundamental: the same pixel appearance can come from different combinations of light and material, even when geometry is known. More observations help constrain the solution; controlled multi-view or moving-object observations can reveal light-surface interactions that a single still cannot. This is why the product goal should be “match the visible look on this product,” not “recover the exact original studio.” [Single-image reflectance and lighting ambiguity](https://openaccess.thecvf.com/content/CVPR2024/papers/Enyo_Diffusion_Reflectance_Map_Single-Image_Stochastic_Inverse_Rendering_of_Illumination_and_CVPR_2024_paper.pdf), [multi-view inverse-rendering example](https://openaccess.thecvf.com/content/CVPR2021/html/Zhang_PhySG_Inverse_Rendering_With_Spherical_Gaussians_for_Physics-Based_Material_Editing_and_Relighting_CVPR_2021_paper.html).

## Recommended system design

Use two cooperating layers:

### 1. Photographer-agent: interpret and explain

The vision model should produce a structured hypothesis, not an unconstrained final answer:

- **Intent:** high-key catalog, soft luxury, dramatic low-key, crisp technical, warm lifestyle, and so on.
- **Evidence:** which reflections, highlight shapes, cast shadows, gradients, and color cues support the interpretation.
- **Scene causes:** likely area-light shapes and positions, environment contribution, negative fill, background/set elements, and possible material contributions.
- **Confidence:** confidence per observation and parameter, with explicit alternatives when the image is ambiguous.
- **Editable proposal:** a compact rig plan with role, size/shape, position, aim, color, output visibility, and approximate power for each light.

The agent should identify what belongs to lighting and what likely belongs to the camera, material, product geometry, compositing, or physical set. It should say when it cannot tell. For example, a bright glass edge can be a strip reflection, a bright background through the glass, or both.

## Specialist lighting skills

Do not make one generic photographer prompt responsible for every look. Route each request through a focused look playbook, while retaining the same scene-safety rules, KeyShot light controls, render loop, rollback, and result format. A look playbook is a specialist policy for choosing and evaluating a rig; it is not a separate code path or a fixed preset that the agent must copy blindly.

Keep three independent axes so the number of skills does not grow as every possible combination:

| Axis | Initial choices | What it changes |
|---|---|---|
| Look intent | clean catalog, polished studio hero, low-key/moody, dramatic colored, natural/lifestyle | contrast target, source arrangement, fill strategy, background and color treatment |
| Shot scale | full product, hero crop, close-up/macro | which region matters, framing guardrails, highlight/shadow detail to evaluate |
| Material response | glass/liquid, reflective metal, matte/textured, mixed | how much to trust reflections, edge cues, diffuse shading, color and texture evidence |

For example, “moody glass macro” combines the low-key look playbook, macro evaluation rules, and glass/liquid response guidance. It should not require a one-off `moody-glass-macro` skill.

### First specialist playbooks

- **Clean catalog / e-commerce:** broad soft sources, restrained contrast, accurate color, clean/seamless backdrop, readable contact shadow, no clipped white details.
- **Studio hero:** deliberate key-to-fill ratio, shaped reflections, controlled rim separation, product-scaled framing, premium but material-faithful contrast.
- **Low-key / moody:** preserve intentional dark mass while protecting important contours and labels; use selective sources and negative fill; evaluate clipping separately from shadow depth.
- **Dramatic colored:** assign color to motivated sources, distinguish colored reflection from global white balance, control spill, and preserve neutral/product-specific accents.
- **Close-up / macro:** optimize the selected detail, not full-object brightness; prioritize local highlight width, surface texture, micro-shadows and edge rolloff; do not fake shallow depth of field through lighting.

Glass/liquid and reflective metal should begin as material-response adapters that can pair with those looks. They may become standalone specialists if benchmark results show their failure modes are distinct enough. That keeps the initial set manageable while directly covering the hardest lighting cases.

### Shared contract for every playbook

Each playbook should define: visual goal; cues to inspect; plausible light roles/shapes; controls it may change; render regions and measurements that matter; search order; material/set ambiguity; confidence rules; common failure cases; and a small evaluation set. All playbooks return the same normalized recipe schema and use the same bounded renderer search. Only the interpretation and evaluation priorities differ.

The router should select one look intent, one shot scale, and relevant material adapters from the user’s request plus scene/reference evidence. It should show the selected direction and let the user correct it before expensive refinement when classification is uncertain. Existing presets then serve as starting recipes for a specialist, not as the specialist itself.

Build the first set from four core looks (catalog, studio hero, low-key, colored dramatic), one close-up scale adapter, and glass/metal material adapters. Expand only when a benchmark failure identifies a missing expertise area. The current `photo.js` has one general still-photo system prompt, so this is a clear agent-quality improvement rather than a request for more KeyShot bridge operations.

### 2. Render-searcher: test and improve the hypothesis

Use the agent to choose a good starting point and name the visual problem. Use bounded, deterministic search to tune numeric settings against real KeyShot renders. Search in stages so the system can explain what it changed:

1. Match the broad environment, backdrop, and exposure without clipping product highlights.
2. Position the key to move the main reflection or shadow in the observed direction.
3. Adjust source size and roll to match highlight width, edge shape, and shadow softness.
4. Set fill and negative-fill contrast.
5. Add rim, kicker, or top accents only when the reference supports them.
6. Refine color temperature and background gradient after the light structure is credible.

Keep the camera, material, and geometry fixed unless the user requests them. Reject a candidate that worsens the score or violates a guardrail, and retain a known-good checkpoint at every accepted stage.

## Roadmap, in order

### Phase A — Map the KeyShot lighting model and establish the benchmark

Build the read-only capability inventory and verify Environment, Area, Point, IES, and Spotlight against the installed KeyShot version. Document how each light is represented, which geometry and material-graph parameters it uses, which environment/render controls affect it, and how Director can safely identify, update, remove, and restore it. Add a render probe only where API signatures alone cannot establish the visible effect. Then establish the small evaluation set below so each new primitive has a controlled validation case.

Create a small, deliberate evaluation set before tuning the agent. Start with representative KeyShot products and materials: diffuse light plastic, glossy colored plastic, polished metal, dark matte material, clear glass, tinted glass/liquid, and a mixed-material product. Include hero and close-up views, plus both dark and bright backgrounds.

Use three complementary evidence pools rather than choosing between online references and KeyShot-made examples:

1. **Professional reference studies** teach vocabulary and plausible strategies: what softboxes look like in reflections, where edge cards are placed, how low-key setups protect a contour, and when a focused fixture is appropriate. Annotate the visible cue and the creator's stated workflow; do not treat a tutorial's precise numbers as universal.
2. **Controlled KeyShot targets** teach cause and effect. Save a known scene recipe, render one intentional change at a time (such as panel width, point radius, environment rotation, or spotlight falloff), and keep the resulting beauty and diagnostic passes. These pairs let us test whether the agent predicts what a control actually changes in this renderer.
3. **Real product/reference matches** test whether the system transfers to unknown geometry, materials, and styles. Here the hidden studio is ambiguous, so collect human ratings of match quality and usefulness rather than a claimed ground-truth source layout.

Keep product models separated between tuning and held-out evaluation. Otherwise, repeated examples of a single product/material can make a system look better than it is. The five-form scene is useful for quick qualitative response checks, but it is not a sufficient benchmark for glass, macro detail, commercial product geometry, or scene-unit calibration.

For controlled cases, generate the target in KeyShot from a known rig and save the exact light/environment recipe. For real references, record a human-approved interpretation and allow multiple plausible rigs. Keep reference, current scene, camera, material, render settings, proposed recipe, before/after render, and human ratings together. Do not use a numeric score as a quality claim until it correlates with expert preference on this set.

Track at least:

- blind pairwise preference: which render better matches the reference's lighting and mood;
- background, silhouette, shadow, and highlight-region scores separately;
- highlight location and shape, shadow direction/softness, clipping, and color cast;
- time and number of render probes to reach an acceptable result;
- regressions by material family, especially glass and polished metal.

### Phase B — Improve visual evidence extraction

- Replace the border-only product mask with a robust mask from a render alpha channel for the KeyShot image and a segmentation model for the reference. Keep product, shadow, and backdrop regions distinct.
- Align the product region before comparing local lighting. If the angles differ, request or estimate framing separately instead of allowing the lighting optimizer to compensate for alignment error.
- Measure local highlight regions, their shape/orientation, shadow direction and penumbra, edge-to-center contrast, backdrop gradient, and clipping. Keep color/exposure comparisons separate from structural light cues.
- Add a scene-inspection summary for visible parts, bounds, selected area, current materials, environment, camera, and render settings. Do not infer a material label from a part name alone.
- Record color-space and display-transform assumptions. Compare perceptual outputs consistently; avoid treating encoded RGB averages as physical light measurements.

### Phase C — Expand the editable lighting grammar

Build typed controls on verified KeyShot primitives, rather than mapping every source to another rectangular panel:

- area panels with shape, size/aspect/roll, emitted side, unit-aware power, color, samples, and camera/reflection/shadow visibility;
- point sources with position, radius, color, and unit-aware power;
- IES sources with a validated profile, orientation, distribution shape, and supported power/color controls;
- spotlights with aim, beam angle, falloff, radius, color, power, and visibility;
- environment controls for HDRI choice, rotation/contribution, ground behavior, and backdrop separation, plus HDRI pins only if the scripting surface proves they are available;
- editable rig compositions generated from these shared typed primitives, with any negative-fill/flag behavior represented only where KeyShot can support it safely.

The agent must be able to explain each light's role and which observed feature it is intended to affect. A visual stage diagram should show the real editable light positions around the measured product.

### Phase D — Closed-loop reference matching

- Start from the photographer-agent proposal.
- Render bounded low-cost candidates at fixed camera and render settings.
- Evaluate product, reflection, shadow, and backdrop objectives independently. Use vision feedback for semantic mistakes the numeric features cannot recognize.
- Search one parameter family at a time with coarse-to-fine steps. Keep a hard render budget, cancellation, rollback, and “best so far” behavior.
- Promote a result only when objective evidence or a human choice supports it. Preserve alternatives when different rigs look equally plausible.
- Use higher-quality KeyShot previews for final comparison; noisy low-cost previews are search evidence, not deliverables.

### Phase E — Make the workflow teachable and reusable

Show the reference, current render, best candidate, and a wipe/overlay comparison. List observations, confidence, limits, and the exact before/after changes in plain language. Let users pin a good light, lock a camera/environment, or request one correction such as “broaden the reflection” or “keep the bottle dark but lift the edge.”

Save named editable looks and recipes with the product/material context they were validated against. Reuse a proven recipe as a starting point for a similar material or product, then verify it in KeyShot. Do not silently accumulate hidden match lights or checkpoints; give the user a clear, scene-safe way to inspect and manage Director-owned items.

### Phase F — Use reference video as extra evidence

For a clip, select stable frames from the same shot and use changes in reflected panels across product rotation or camera movement to constrain the lighting hypothesis. Separate cuts and distinct setups. Explain when motion could be either a turntable or camera orbit. Preserve temporal continuity only for shots that actually share a lighting setup.

## What REA should do here

There is no corporate-interest reason to avoid REA. Use it where it adds evidence: study the observable workflow of a specific app or shipped artifact that the user has selected and is authorized to inspect; compare versions; trace a visible feature from UI action to state/result; then write a clean-room behavior spec for our own implementation.

For this first lighting deep dive, the repository source is available and is the best evidence of what Director currently does, so the REA skill's guidance is to use normal source inspection instead of running a binary-analysis workflow. REA cannot infer lighting physics from a reference photo. For that, use reference examples, scene metadata where available, model interpretation, and controlled KeyShot render experiments. Do not inspect KeyShot internals as a substitute for its documented API or the user's own experiments.

## Immediate next slice

This was the original recommendation before the 2026-10-13 live capability pass. That pass completed the read-only type/graph inventory and proved Point material assignment and rendering. The later saved-checkpoint reopen is the verified rollback route; direct node deletion can still leave retained mesh geometry. The current implementation and outstanding live check are in **Current continuation** below.

The checkout already has useful private references: a dramatic metal product close-up and several bright e-commerce electronics images. The `high_end` collection is currently empty. Use these local files as qualitative examples first; do not transmit them to a provider outside an explicit matching action. Add more reference images only to cover gaps such as clear glass, dark glossy products, warm metallics, and textured materials.

## First live lighting benchmark (2026-10-12)

The user supplied a five-form test scene: Cylinder, Rounded Cube, Cube, Torus, and Sphere. The bridge reported a combined subject span of about 5.98 scene units, but KeyShot reported no usable unit scale. The camera was left untouched (distance about 23.4, FOV about 39.6 degrees). The Director material-object query returned no per-object assignments even though the subject query found all five forms; improve this compatibility path before claiming that a particular material response belongs to a particular object.

Two bounded lighting looks were applied without changing camera, geometry, or object materials:

- **Blank studio:** KeyShot's all-white environment, near-white background, soft overhead, key, and fill. The five forms remained legible and the scene read as a neutral catalog baseline.
- **Dark and moody:** all-black environment/background, a soft 4800 K key, 7000 K edge light, and 3200 K kicker. The black stage and selective edge reflections worked; glass/metal edges separated from the background, while the broad dark faces were close to disappearing. This run deliberately skipped automatic exposure, so it is an initial visual result, not an exposure-calibrated preset.

Each look used one 640-pixel-wide `renderImage` preview. Actual calls took about 2.8 seconds and 2.3 seconds. The bridge stayed running; the original environment is recoverable with `studio_off`. No scene save was issued.

This benchmark exposed two immediate product issues. First, the current feature extractor returned p50=0, p95=0, and 97.48% crushed pixels on the moody image, while labeling 96.1% of the frame as the product. The black background and small, widely spaced test forms defeat the border-color mask and trigger its full-frame fallback; brightness-based automatic tuning must wait for a real product mask/alpha or an explicitly selected region. Second, this camera view makes the objects relatively small, so it can test whole-scene mood and separation but not macro highlight shape or fine surface response. The next benchmark should add a crop/region-of-interest pass while preserving a fixed camera for the whole-product comparison.

This scene is a useful controlled starter because it has matte, glossy/dark, glass-like, and reflective forms in one frame. Keep it as a qualitative test until per-object material assignments are readable and the object mask is corrected. Then add one closer view and validate exposure on actual product pixels before calibrating the look playbooks.

## Source references

- Current product contract: `PRODUCT.md`.
- Current photo workflow and caveats: `docs/PHOTO_WORKFLOW.md`.
- Implementation: `server/photo.js`, `server/style.js`, `server/rigs.js`, `server/server.js`, `bridge/cc_lights.py`.
- KeyShot's documented animation and scripting surface: [Animation](https://manual.keyshot.com/manual/animation/), [Scripting](https://manual.keyshot.com/manual/scripting-2/).
- Inverse-rendering evidence: [Diffusion Reflectance Map, CVPR 2024](https://openaccess.thecvf.com/content/CVPR2024/papers/Enyo_Diffusion_Reflectance_Map_Single-Image_Stochastic_Inverse_Rendering_of_Illumination_and_CVPR_2024_paper.pdf), [PhySG, CVPR 2021](https://openaccess.thecvf.com/content/CVPR2021/html/Zhang_PhySG_Inverse_Rendering_With_Spherical_Gaussians_for_Physics-Based_Material_Editing_and_Relighting_CVPR_2021_paper.html).

## Live capability and evaluation research (2026-10-13)

### Reconnected-session evidence

The restarted bridge answered a harmless `ping`, then read-only camera, product-bounds, environment, and Director-light queries. The active scene was still `PluginTest.bip` with Cube, Rounded Cube, Cylinder, Torus, and Sphere. Its environment was `Environment` using `startup.hdr`; the Lighting preset was `Basic`; the render engine was Product GPU; the baseline query showed no Director lights. The five original scene materials and active camera matched the previously recorded test scene. `lux.isSceneChanged()` was already true at the first runtime-surface query, so the scene was never saved. A later controlled Point Light material-swap probe and its cleanup side effects are documented below; this baseline capture should not be read as the final post-probe state.

The scene reports `unit=unknown` and `unitScale=0.0`. Its measured product span is about 6.72 scene units, but that is not a calibrated physical length. Use product-relative placement for exploratory rigs and defer claims about real-world lumens, lux, or source radii until scene units are known or a scale reference is supplied.

### Light types: native behavior versus current automation

KeyShot's 2026 manual describes physical lights as materials applied to geometry, and its Light Manager recognizes Area, IES, Point, and Spotlight. The separate Planar Light is similar to Area Light but adds horizontal and vertical spread angles. KeyShot's native `Edit > Add Lights` menu can add it. The live `lux` module on this installation exposes shader constants for `lux_mesh_light`, `lux_point_light`, `lux_ies_light`, and `lux_spotlight`, but no distinct Planar Light constant. The installed Light material library has Area, Point, IES, and Spotlight assets, but no Planar asset. This is a boundary of the documented and observed scripting surface, not a claim that no undocumented internal route exists.

The earlier Director test correctly created a flat rectangular, plane-shaped Area Light by importing panel geometry and assigning an Area Light material. That is a useful real light, but it is not KeyShot's native Planar Light material because it has no spread-angle controls. Do not describe the two as equivalent.

Local installed-library `.mtl` samples reveal candidate parameter schemas. A direct read-only `lux.getMaterialGraph(name)` lookup then confirmed the Point, IES, and Spotlight node parameters against KeyShot's live graph without assigning a material or changing the scene:

| Type | Observed graph type and sample parameters | Current Director coverage |
|---|---|---|
| Area | `lux_mesh_light`: power, color, lumen mode, front/back emission, camera/reflection/shadow visibility, samples | Existing default and rig path. It remains the best source for broad highlights, shaped reflections, and soft fill. Front/back controls still need to be surfaced by stable graph parameter name. |
| Point | `lux_point_light`: power, color, lumen mode, radius | Typed create/update and parameter readback are live-verified. Position controls the source; radius controls shadow softness. A subtle local contribution changed about 20% of masked pixels in the five-form test. Checkpoint reopening is the validated cleanup route. |
| IES | `lux_ies_light`: profile file, multiplier, color, radius, light axis, rectangular width/length, shape | Thirty-one installed MTL/profile pairs are catalogued. K72 profile loading, assignment, aim, render contribution, and native warm-color readback are verified. New IES lights no longer inherit Area's 5600 K default; multiplier 1 and the profile's default axis are preserved unless explicitly changed. |
| Spotlight | `lux_spotlight`: power, color, lumen mode, beam angle, falloff, radius, stencil width, in-cone power mode, width/length | Typed create/update and beam-parameter readback are live-verified; local -Y aim produced a measurable render change in the tested setup. Use it for a controlled beam or pool, not broad softbox reflections. Checkpoint reopening is the validated cleanup route. |
| Planar | Native material with spread-angle controls per the KeyShot manual; no exposed constant or installed library asset found | Not available through the verified Director light operation. The current panel operation is Area Light. |
| Environment | Live `Env` object exposes HDRI, brightness, rotation, background/backplate, size/height, ground shadows/reflections/size/color, flattening, and occlusion-ground controls; no pin methods appeared | Director exposes only a subset today. HDRI pins, environment contrast, and a fuller environment setter need separate verification before being treated as scriptable. |

The live Point graph exposed `color`, `lumen`, `power`, and `radius`. The live Spotlight graph exposed `angle`, `falloff`, `focus_power_in_cone`, `color_stencil_width`, `lumen`, `power`, and `radius`; its serialized `.mtl` calls the falloff field `full_fraction`, so the live graph name is the one the agent should target. The live IES graph exposed `file`, `multiplier`, `color`, `radius`, `light axis`, `width`, `length`, and `shape`; KeyShot resolved the selected library profile to its installed IES file. A later Point Light material-swap probe confirmed that the Point graph can be assigned to our disposable panel object and rendered. The visible result was a compact, strong source, but the probe also found a cleanup defect in the current panel-import path; safe lifecycle support for additional light types is therefore not yet verified.

### Controlled Point Light operation and cleanup findings (2026-10-13)

Using the existing research panel on the disposable five-form scene, I changed only its material from Area Light to the installed `Point Light 1200 Lumen Neutral` material. The live graph on the assigned scene material was `lux_point_light` with `color`, `lumen=True`, `power=1200`, and `radius=0`. A cloned render-options object was constructed from `lux.getRenderOptions().getDict()` and used for a 640 x 400 preview; the render took about 3 seconds. The point source produced a visibly compact, intense effect at that position. The black glossy sphere became very bright and some light-colored faces clipped, while the polished cylinder and torus showed different highlight responses. This is a qualitative demonstration of Point Light assignment and rendering, not a calibrated power comparison: the scene's original unit was unknown, and the light was not evaluated with an objective product-only mask.

The first cleanup removed the light's named scene-tree group but left the imported mesh ID in `lux.getObjects()`. Deleting the probe-only scene material cleared the orphan's material assignment, but KeyShot still reported one extra object and an empty material slot. The post-cleanup beauty preview looked like the original five-form baseline, and the five product nodes, camera, environment, and lighting preset remained. However, the probe import also changed the scene's unit metadata from `unknown` / scale `0.0` to `mm` / scale `1000.0`. No save was issued. A likely trigger is `bridge/cc_lights.py::_import_panel()`, which requests `geometry_units=1000.0` while importing the panel OBJ; this should be isolated in a future disposable-scene repro. The live `lux` module exposed only MM, CM, IN, FT, and M unit constants, and the documented `setSceneUnit` accepts only those values; it provides no exact `unknown` state to set back. This means the current import-and-parent-delete lifecycle is not sufficiently reversible for more live probes; stop scene mutation until a later implementation pass gives each imported light a verifiable object handle, deletes its geometry completely, restores the prior scene-unit state if possible, and checks the exact before/after scene inventory. Do not treat the unchanged beauty preview as proof that scene state was fully restored.

### Follow-up mm-scene lifecycle attempt (2026-10-13)

After the user set the same five-form `PluginTest.bip` scene to `mm` / `1000`, two read-only snapshots agreed on the scene signature, five product groups, and baseline geometry inventory. A new live library scan against KeyShot 2026.2 found 12 Area, 3 Point, and 12 Spotlight graph assets at the requested cap, but no IES-named material candidate; the result is limited to the loaded material library and does not establish that IES profile support is absent.

The first Area-panel create attempt reached a bridge that had not reloaded the newer `cc_lights.py` companion module. Its old RGB handling failed on `rgb: null` before light parameters were applied. The bridge was hot-reloaded and retained the exact test ownership record, but retrying cleanup still left imported geometry ID `8` in `lux.getObjects()`. A read-only deleted-node query identifies only the probe's deleted object/group IDs `8` and `7`; the five product groups remain present and units remain millimeters. The probe-only material `Area Light 1200 Lumen White #1` also remains in the scene. No scene save or render occurred during this attempt.

KeyShot's current scripting reference documents `SceneNode.delete()` as deleting a tree node and `lux.clearGeometry()` as clearing **all** geometry; the live `lux` surface exposed no per-ID geometry deletion function. Reattaching the exact deleted probe nodes and deleting the object leaf before its owned group still did not remove geometry ID `8`. Therefore the bridge now refuses broad cleanup for an orphaned probe mesh. Do not call `clearGeometry()` in a product scene. The current disposable scene must be reopened without saving to discard this failed probe before further live mutations; repeat the unit setup on the clean scene. References: [KeyShot 2026.1 `SceneNode` API](https://media.keyshot.com/scripting/doc/2026.1/lux.html) and [`clearGeometry()` API](https://media.keyshot.com/scripting/doc/2026.1/lux.html).

### Area Light power sweep and cleanup gate (2026-10-13)

On the reset five-form `PluginTest.bip` scene, the read-only snapshot again reported `unit=unknown`, `unitScale=0`. KeyShot's documented `setSceneUnit(unit, keep=True)` means keep the current physical size while changing the unit. The typed setup operation set `UNIT_MM`; the five product nodes, geometry IDs, materials, environment, and render options remained the same. Camera position and pivot values changed by a factor of 1000 as coordinates moved to millimeters, while direction, up, distance, FOV, and focal length stayed within floating-point tolerance. The raw `getCameraLookAt()` read became inconsistent with the other camera fields after conversion, so camera identity checks now compare normalized position/pivot plus direction and lens values instead of hashing raw coordinates. The operation replay passed in its idempotent state. KeyShot documentation: [`setSceneUnit`](https://media.keyshot.com/scripting/doc/2026.1/lux.html).

The five forms span **6,719 mm** across X, with combined center `(-12, 500, 431) mm`. A 2,500 × 2,000 mm Area Light panel at `(-2,512, 4,500, 4,931) mm`, aimed at that center, was camera-hidden and visible in reflections and shadows. The live material was `Area Light 1200 Lumen White #1`, graph type `lux_mesh_light`; readback confirmed the requested power and visibility values. With a stable Clown product mask (about 8.94% of the frame and unchanged bounds), the 640 × 400 beauty results were:

The first preview reported `render_height` changing from 2398 to 2400 while the active RenderOptions hash stayed unchanged; subsequent captures had stable scene and RenderOptions signatures. This metadata normalization is retained in the research record rather than treated as a lighting effect.

| Input power | Product mean luminance | Median | 95th percentile | Clipped product share |
|---:|---:|---:|---:|---:|
| Environment baseline | 0.6413 | 0.6588 | 0.9098 | 0.21% |
| 12,000 lm | 0.6428 | 0.6667 | 0.9137 | 0.19% |
| 60,000 lm | 0.6713 | 0.7300 | 0.9574 | 0.49% |
| 120,000 lm | 0.7027 | 0.7709 | 1.0000 | 5.75% |

This is a useful power-response calibration for this panel, distance, environment, camera, and mixed-material benchmark: 12k lm was subtle, 60k lm produced a clear lift, and 120k lm clipped too much. It is not a universal preset. Each light-on capture recorded a direct-light EXR and Clown mask; the no-light baseline recorded beauty and Clown. The operations retained exact inputs/outputs and SHA-256 result hashes, and every capture verified that render options stayed unchanged.

The same-ID replay at 60k lm worked and read back `power=60000`. Removal deleted the panel group/object nodes but KeyShot retained mesh ID `8` in `lux.getObjects()` and the scene copy of the light material. The exact-owner cleanup correctly refused a scene-wide clear. Scene tree, product groups, camera, environment, and render options remained intact, but the full inventory did not return to baseline. `lighting.apply_area_light_recipe` and `lighting.remove_native_light` are therefore gated until a supported targeted cleanup strategy is validated. Do not save this scene; reopen the saved disposable scene without saving, reconnect the bridge, clear the stale ownership record safely, and then resume research.

The successful clone method matters for safe evaluation: `copy.copy(lux.getRenderOptions())` fails because the wrapped `lux.RenderOptions` cannot be pickled. The documented method is to pass `lux.getRenderOptions().getDict()` to a new `lux.RenderOptions(...)` instance, then change preview-only options on that instance. KeyShot's [RenderOptions API description](https://media.keyshot.com/scripting/doc/2026.1/lux.html) explains that `getDict()` can persist settings for a new object.

### What professionals actually manipulate

The reference tutorials support a more useful light model than “key, fill, rim” alone:

- For metal and glossy plastic, the shape and position of a bright or dark reflected card are often the actual design control. A Point or Spot source can illuminate a surface but has no broad emitter area to draw a rectangular softbox reflection. An Area Light or HDRI pin can define that reflection. Esben Oxholm's workflow explicitly combines a subtle HDRI, one Area Light key, then a separate HDRI pin to shape the metal reflection; Will Gibbons distinguishes image-based lighting from local physical lights and notes that point/spot/IES sources do not form broad reflections on specular materials.
- For a clean studio product, start with the environment or broad sources for baseline coverage, then tune local emitters for reflection placement, shadow softness, and silhouette separation. More lights are not automatically better: each one can add another reflection, shadow blocker, or spill problem.
- For dramatic low-key work, a recent professional tutorial uses a darkened HDRI, positioned Planar sources, narrowed spread angles, targeted highlight placement, colored accents, and then balances tone mapping and bloom. That sequence implies a deliberate order: design the light shapes first, then tune their power and color, then finish the display transform.
- IES profiles should represent actual fixture distributions. Their files already contain photometric shape and lumen data, so a multiplier of 1 is the neutral baseline. Spotlight beam width also has a power interpretation choice: constant total flux makes a narrow beam brighter on its target; constant illuminance changes total emitted flux with beam angle. The agent must record this choice instead of searching “power” as if it had one invariant meaning.
- A close-up is a different evaluation scale, not just a zoomed full-product recipe. It changes the target ROI, apparent reflector dimensions, tolerance for local clipping, and which surface cues matter.
- KeyShot's own lighting UI exposes two useful surface-aware placement ideas: HDRI **Set Highlight** creates or re-aims a pin at a clicked product point, while physical-light positioning offers **Highlight**, **Normal**, **Target**, and **Orbit** modes. The Director bridge currently describes area panels by a world-space position and target, which covers a basic Target mode; inferring a clicked 3D point or reflected highlight from an image is a separate problem. KeyShot's public `lux` reference documents environment image/brightness/rotation/size/ground controls but no HDRI pin methods, so the next runtime API scan should look for exposed pin/target/pick helpers before we assume automation can match these native tools.

These are evidenced practice patterns, not universal numeric recipes. Sources: [Esben Oxholm's HDRI + Area Light workflow](https://www.youtube.com/watch?v=umnswWAS2vw), [KeyShot's HDRI Editor custom-lighting walkthrough](https://www.keyshot.com/blog/how-to-create-quick-custom-lighting-with-the-keyshot-hdri-editor/), [KeyShot Light Manager](https://manuals.keyshot.com/kss2026/en-us/manual/lighting-manager.html), [KeyShot HDRI Editor pins](https://manuals.keyshot.com/kss2026/en-us/manual/hdri-editor-pins.html), [KeyShot Light Positioning](https://manuals.keyshot.com/kss2025/en-us/manual/Light-Positioning.htm), [Will Gibbons' physical-light guide](https://www.keyshot.com/blog/how-to-create-and-use-physical-lights-in-keyshot/), [Will Gibbons' dramatic Planar Light tutorial](https://www.youtube.com/watch?v=1Qh6sbie6CQ), and the current KeyShot manuals for [Area](https://manuals.keyshot.com/kss2026/en-us/manual/area-light.html), [Point](https://manuals.keyshot.com/kss2026/en-us/manual/point-light.html), [IES](https://manuals.keyshot.com/kss2026/en-us/manual/ies-light.html), [Spotlight](https://manuals.keyshot.com/kss2026/en-us/manual/spotlight.html), and [Planar](https://manuals.keyshot.com/kss2026/en-us/manual/planar-light.htm) lights.

### Visual cue to scene-control map

The interpreter should reason from the visible defect toward the smallest plausible scene cause, then ask the renderer whether the predicted cue changed:

| Visible cue | First controls to consider | Common confounds / diagnostic check |
|---|---|---|
| Cast-shadow direction | Direction from product toward the dominant source; environment orientation if the shadow is broad | Multiple sources overlap; verify on the Shadow pass rather than inferring it from dark product faces |
| Shadow softness / penumbra | Area-emitter apparent size (size relative to distance), or Point/Spot radius | Contact geometry, product-ground gap, and scene scale also change the edge; compare at fixed camera/scale |
| Long rectangular highlight on metal/plastic | Reflected card dimensions, orientation, roll, and angular position; HDRI rectangular pin when supported | Brightness is not a substitute for shape; inspect the Reflection pass and lock the material |
| Highlight lands on wrong product region | Rotate/translate the reflector or environment pin; use the target point on the relevant surface | Camera/object alignment can masquerade as a lighting error; align the product before changing lights |
| Focused pool or patterned patch | Spotlight beam/falloff or a measured IES distribution; Planar spread/gobo if available | A broad Area Light may require texture/shaping; do not make an IES profile from a generic spotlight guess |
| Glass silhouette disappears | Bright strips plus dark reflected flags, stronger environment edge structure, or a more useful background behind the glass | Refraction, IOR, thickness, tint, and background contrast can all cause the same cue; use Raw/Refraction/Reflection evidence |
| Whole product is too bright/dark | Separate product exposure and light energy from background and display transform | Do not tune against full-frame averages; first mask the object and inspect clipping/black crush |
| Warm/cool cast is wrong | Source color temperature, explicit RGB accent, environment spectrum, then image style | Keep source color separate from global white balance / tone mapping so neutral product areas remain diagnosable |

This suggests a stable optimization order: **align and classify → solve direction and reflection/shadow shape → solve source size/softness → balance fill and contrast → tune power/exposure → tune color and display transform**. Searching power first often creates a brighter version of the wrong geometry. KeyShot’s physical-light controls support these separate interpretations: Area size changes shadow softness; Point and Spot radius changes penumbra; the Spotlight beam-angle option changes how the entered flux/illuminance is interpreted; and HDRI pins have their own shape, falloff, and transform settings.

### Recommended look playbooks, with shared controls

The product should route a request into one visual intent, one shot scale, and one or more material-response adapters. These are focused operating guides over a common lighting engine, not different agents with competing APIs:

| Playbook | Primary image evidence | Likely controls and success criteria |
|---|---|---|
| Clean catalog | near-white backdrop, broad clean gradients, controlled contact shadow, color accuracy | Broad Area/HDRI sources, restrained contrast, even product coverage, detail retention in whites |
| Studio hero | a clear highlight hierarchy, shaped metal/plastic reflections, clean silhouette | Environment base plus a few broad reflectors and selective edge accents; balance contrast without flattening texture |
| Low-key / moody | dark field, a few readable surfaces, deliberate bright edges, shadow direction | Lower environment contribution, selective narrow/large sources as appropriate, negative fill or dark set cards only when controllable; preserve required labels and contour detail |
| Dramatic colored | motivated colored accents and separation between warm/cool regions | Colored Area/Planar sources or textured emitters where supported; score color spill separately from neutral product color and display transform |
| Close-up / macro | local highlight width, texture, micro-shadow, edge rolloff in a selected crop | Re-evaluate source size relative to the crop/product, lock camera, score a detail ROI, do not let full-frame background dominate |
| Reflective metal | highlight-card geometry and dark-to-bright transitions in reflection | HDRI plus Area/HDRI rectangular pins; optimize reflection pass and card shape, not merely diffuse brightness |
| Glass / liquid | edge highlights, transmitted background, refraction, caustics, dark flags reflected on the silhouette | Bright/dark cards, environment structure, refraction and caustics evidence; distinguish lighting from IOR, tint, thickness, and backdrop |

The high-level workflow should first state what visual feature it is trying to recreate, then propose plausible scene causes, then tune only the corresponding control family. Example: “broaden the long highlight on the upper metal shell” should first alter reflector width/orientation or an environment pin, not raise exposure or change the metal material. “Keep the bottle dark while lifting the rim” should change edge-source contribution and ROI weights, not globally brighten the image.

### Feasibility and value ranking

| Rank | Capability | Why it is useful | Evidence / gate |
|---|---|---|---|
| 1 | Region-aware render comparison using Clown/object labels plus lighting, reflection, shadow, and raw passes | Stops a black backdrop or ground from corrupting product brightness scores; makes error explanations local and actionable | Render pass output is live-proven; compare reference and render with aligned object/background/shadow regions before optimizing |
| 2 | Light-object understanding: type, transform, graph parameters, linked part, units, visibility, ownership, reversible lifecycle | Prevents treating every source as a plane and protects the user's scene while building typed controls | Typed create/update/readback and checkpoint restore are verified; direct per-light geometry deletion still needs a supported KeyShot route |
| 3 | Playbook router across intent × shot scale × material response | Gives studio, close-up, moody, colored, glass, and metal different goals without combinatorial prompt explosion | The first composable router and focus selector are implemented; crop-aware scoring and material-specific benchmarks remain |
| 4 | Bounded closed-loop search with a best-so-far rig, named objective, and hard render budget | Replaces “one prompt, one revision” with measured improvement while explaining changes | Feasible with existing Area/environment controls and cloned render options; must use a correct object mask and preserve scene state |
| 5 | Native Point, IES, and Spotlight bridge operations | Expands what the agent can physically represent: compact emitter, real fixture distribution, and directed/gobo pool | Typed creation, graph readback, and controlled render response are verified for the installed KeyShot build; calibrate power and appearance on held-out products and retain checkpoint restore for cleanup |
| 6 | Native Planar spread control, HDRI pins, environment contrast, Light Layers | Could improve shaped reflection, local influence, and targeted highlight control | Valuable but not verified in installed script methods; treat as research-gated and prefer vendor API request if required |
| 7 | Video or multi-view lighting reconstruction | Temporal reflection motion constrains directions and helps separate camera/product motion from light placement | Strong research value, but costlier data handling and multi-shot segmentation; do after stable still-image workflow |

### Updated next step

The panel-import cleanup and millimeter-unit guard are now implemented. On a fresh disposable scene in millimeters, first record a baseline, create one Area panel, edit its tint, remove it, and compare scene-tree nodes, geometry IDs, materials, camera, environment, and render options. Keep the light operation gated if any owned content or baseline state remains. After the lifecycle passes, run one bounded RGB-look preview and refine its starter values from the actual render. Then add Point, Spotlight, and IES individually. Native Planar and HDRI pin work remain gated on a supported API route or vendor guidance. In parallel, add Clown-aligned crop regions and reference-aware material tests so the playbooks optimize visible product evidence instead of full-frame brightness.

KeyShot's physical-light guidance says to combine environment lighting with specific local lights, use IES for man-made source distributions, keep product scale realistic, and avoid using Emissive materials as general scene illumination. A professional KeyShot workflow also shows an HDRI as soft ambient/fill, a local Area Light for the key, and an HDRI pin to place a reflection on metal. Another product-visualization tutorial uses named fill/key/rim pins and directs each at a desired surface highlight. These are starting patterns, not fixed power ratios or universal three-light recipes.

### Render passes and masks: live-proven

The installed `RenderOptions` object has setters for Direct Lighting, Indirect Lighting, Shadow, Reflection, Raw, Clown, Depth, Normals, Diffuse, Refraction, Caustics, Ambient Occlusion, and Labels passes. These setters are absent from the current screenshot operation, but a probe used a *cloned* `RenderOptions` object so the active scene settings were not changed. At 640 x 400 on the current Product GPU scene, a five-pass EXR probe took 2.3 seconds and wrote separate files for beauty, `_lighting`, `_gi`, `_shadow`, `_reflection`, and `_raw`; the EXRs were single RGB pass files rather than one channel-packed EXR. A second 2.6-second PNG probe wrote separate `_clown.png`, `_depth.exr`, and `_normals.exr` outputs.

The Clown pass is the most useful immediate result for the match evaluator. In this five-form scene it produced five dominant flat colors on a black background, with a 9.0% nonblack image share, so a product matte can be formed without guessing from brightness or border color. Antialiasing creates extra edge colors, but the main object labels remain clear. The beauty image's alpha channel was not a product-only mask here: 75.3% of pixels had nonzero alpha, including the broad background/ground transition. Prefer the Clown pass for the current object mask; treat ground, object shadow, and reflection regions as separate objectives when we have a reliable region assignment.

This gives the evaluator distinct evidence channels: Clown for product pixels; Direct and Indirect Lighting for light contributions; Reflection for highlight shape; Shadow for cast/contact shadow structure; Raw for appearance before image style; and Depth/Normals for alignment and form cues. The installed scripting surface did not expose a Cryptomatte setter in the live `RenderOptions` method list. KeyShot documents Cryptomatte in the UI, so it remains an API gap to verify rather than a claimed Director feature.

Probe outputs are retained in `bridge/shots/lighting_pass_probe_20261013*` and `bridge/shots/lighting_mask_probe_20261013*`.

### Recommended agent structure and order

Use one shared lighting interpreter, one normalized editable recipe, and a set of playbooks—not separate incompatible lighting agents for every look. Each playbook should specify: the visual goal; cues to inspect; allowed scene controls; preferred light types; region-specific score weights; and conditions for asking the renderer or a person to resolve ambiguity. This retains shared technical understanding while giving Studio, Close-up, Low-key, Colored/Dramatic, Reflective Metal, and Glass/Transparent work different objectives.

The shared recipe needs typed Environment, Area, Point, IES, and Spotlight sources with roles, units, product-relative position/aim, shape, visibility, and provenance. First make every scene-changing light operation transactional and prove complete cleanup on a resettable disposable scene. Then connect the Clown mask and separate render passes to a fixed-camera one-variable search; implement and compare one additional native type at a time only after its full create/update/remove/restore lifecycle is verified. Specialist playbooks can be specified in parallel, then tuned against the evaluation set. A single reference remains insufficient to recover the photographer's unique physical rig; the target is an editable KeyShot scene that reproduces the visible look on the user's real product and materials.

Professional references consulted: [KeyShot physical-light guidance](https://www.keyshot.com/blog/how-to-create-and-use-physical-lights-in-keyshot/), [KeyShot HDRI Editor custom-lighting tutorial](https://www.keyshot.com/blog/how-to-create-quick-custom-lighting-with-the-keyshot-hdri-editor/), [Esben Oxholm's HDRI-plus-Area-Light study](https://www.youtube.com/watch?v=umnswWAS2vw), and the [KeyShot 2026 Planar Light manual](https://manuals.keyshot.com/kss2026/en-us/manual/planar-light.htm). The multi-view framing of inverse rendering in [PhySG (CVPR 2021)](https://openaccess.thecvf.com/content/CVPR2021/html/Zhang_PhySG_Inverse_Rendering_With_Spherical_Gaussians_for_Physics-Based_Material_Editing_and_Relighting_CVPR_2021_paper.html) reinforces why image matching should be treated as constrained visual reconstruction, not exact recovery of a hidden rig.

## Implementation update (2026-10-13)

The first KeyShot-native API Anything slice is now implemented:

- The Studio **Lighting capability lab** runs a typed, read-only inspection for Area, Point, IES, or Spotlight library graphs. It records the selected type as an input, so the same operation can be replayed with a different type.
- The lab also has a distinct read-only lighting API-surface operation. It records `lux.Env`, Studio, graph, scene-node, and RenderOptions methods and searches runtime names for HDRI-pin/lighting controls without loading resource libraries or reading the scene. The public 2026.1 API documents environment image, brightness, rotation, background, size/height, and ground controls, but no HDRI pin operation. The runtime probe is necessary because undocumented names may vary by installed KeyShot version; names alone are not accepted as proof that a call is safe or works.
- The bridge returns the installed KeyShot/Python version, relevant `lux` and `RenderOptions` method names, matching light materials, shader node types, and each exposed parameter's name, display name, type, purity, and readable value.
- The local operation registry validates inputs before dispatch, checks the returned shape, records the exact inputs/output and a SHA-256 result digest under `bridge/shots/lighting-lab/`, and supports replaying an earlier run with new inputs. This is an explicit operation template; it does not capture arbitrary Python or synthesize bridge code.
- The catalog distinguishes runnable graph inspection and bounded diagnostic-pass capture from the gated scene-changing light lifecycle. It does not promote a parameter to “understood” until a controlled render experiment demonstrates its effect.
- The ordinary preview now creates a detached `RenderOptions` clone before setting alpha or render time, so the preview does not adjust the active KeyShot render options.
- Diagnostic capture uses the verified KeyShot pass setters, one small PNG beauty render, and selectable lighting/reflection/shadow/Clown/depth/normal passes. It records file checksums and verifies PNG dimensions, scene signature, and the active render-options signature before promoting a run.

The graph-inspection operation completed against the running KeyShot bridge. A four-family inventory recorded 14 Area, 3 Point, and 21 Spotlight name candidates (8, 3, and 8 graphs inspected respectively); their graph parameters are stored with operation version and result digest. IES whole-word search returned no current candidates and its run is correctly marked `needs_review` rather than claiming support.

The active bridge also exposes `SHADER_TYPE_IES_LIGHT` and the `MaterialGraph` class has `newNode`, `newEdge`, `removeNode`, and `removeEdge`; `ShaderParameter` exposes `setValue`. This establishes that graph-level building blocks exist in `lux`, but not the exact IES node-construction signature, required geometry, transform behavior, or rollback path. `getMaterialTemplates()` returned zero entries in this KeyShot session, and the documented `setMaterialTemplate()` applies to the scene, so it is not used as a read-only discovery shortcut.

The first recorded diagnostic-pass capture (run `296f6cbc-8a36-429c-9f06-709de6507b22`) rendered a 640 × 400 beauty image plus Clown, Reflection, and Shadow outputs in 3.37 seconds. The pass files were hashed, the PNGs decoded at the requested size, and both the scene signature and active `RenderOptions` signature matched before and after. The beauty image showed the five expected primitives, and the Clown pass isolated each shape cleanly. Post-capture analysis measured an 8.9% product-mask share and five dominant label colors; product gamma-luma was p05 0.188, median 0.659, and p95 0.893. The left-minus-right product luma delta was -0.090, indicating the right side of this neutral baseline is brighter. These are scene measurements, not a reference-match score. The recorder now stores those region metrics on subsequent captures. The Studio panel and script were served successfully after a Director restart, and the live graph-inspection and replay flow passed through the local API. Creating or deleting lights remains gated until object cleanup and unit restoration pass a baseline inventory check.

### Light lifecycle safety hardening (2026-10-13)

The light bridge no longer treats the imported light's parent group as the light itself. Cleanup now targets the exact imported object node, checks that import-created groups are empty before deleting them, and verifies that both scene-tree node IDs and `lux.getObjects()` geometry IDs return to baseline. It deletes a scene material only when the current operation created it and no remaining object uses it. A failed create attempts an immediate rollback; a failed edit restores a captured world transform and the light graph's parameter values. Ownership records survive bridge hot reloads, while recovered older lights are treated as not owning their materials.

Area-light panels use millimeter coordinates. The bridge now refuses to import panel geometry unless the live scene reports `mm` and a unit-per-meter scale of 1000. KeyShot documents `geometry_units` as a conversion factor from meters and notes that importing or manually changing units can affect light intensity and material scale; the unit picker exposes named units, not a restorable `unknown` state. This guard is intentional: a test scene with unknown units must not silently become millimeter-calibrated. See the [KeyShot import scripting reference](https://manuals.keyshot.com/kss2026/en-us/manual/scripting-import-file.html), [2026.1 `lux` API reference](https://media.keyshot.com/scripting/doc/2026.1/lux.html), and [Scene Units manual](https://manual.keyshot.com/manual/models-tab/scene-units/).

The capability lab now has a read-only scene snapshot operation that records unit scale, object IDs, scene-tree identities, assigned materials, camera, environment, render-options hash, dirty-state flag, and a SHA-256 signature. This creates a repeatable before/after evidence point for the eventual native-light probe. These code-path changes have **not yet been live-tested by creating or removing a light**; the mutation operation stays gated until the disposable-scene lifecycle check confirms exact inventory restoration.

**Evidence correction:** implementing the fuller snapshot exposed that the original `_lighting_render_state()` attempted to look up KeyShot's `getSceneInfo`, `getSceneMaterials`, and `getObjects` functions in the bridge's global namespace instead of calling them on `lux`. Those fields were saved as read errors, so the earlier diagnostic run's `scene_unchanged: true` was not a complete scene-integrity proof. The saved render outputs, dimensions, hashes, camera/environment reads, and render-options comparison remain evidence; the scene-tree integrity claim must be re-earned with the corrected state reader. Do not use the earlier run as proof that every scene field stayed unchanged.

### Specialist playbooks and RGB lighting slice (2026-10-13)

The Studio workflow now has a composable lighting-focus selector and a shared playbook catalog for clean catalog, hero, macro/detail, low-key, colored drama, glass/transparency, and reflective metal work. A selected focus adds guidance while prompt cues can add an independent axis: “close-up glass in a moody setup” combines crop, glass, and mood priorities. The playbooks tell the agent what visible evidence to inspect, which controls address it, and which misleading shortcuts to avoid. They are not claims that each look has a fully calibrated physical rig.

The photo-match path now computes a `lighting_frame` from the camera view: it aims generated sources at the active framing pivot and scales panel dimensions and distance by the view's size relative to a full-product fit. The record stores the chosen aim point and scale with the recipe. This addresses the previous full-product-scaling mismatch for zoomed or detail views, but remains a geometry heuristic: it does not know semantic part boundaries, and it still needs a bounded live-render comparison on the clean disposable scene.

The first new renderable look is `color_drama`: a cyan key, magenta edge, and restrained amber kicker on a blue-black background. KeyShot’s existing light bridge already accepted normalized RGB values, but the Director controls previously exposed only Kelvin. The RGB tint now flows through rig construction, per-light editing, reference-photo plans, and the studio color picker; switching back to Kelvin explicitly clears any stored RGB tint. Kelvin remains a warm-to-cool white control, while RGB is for saturated hues.

The color rig and tint controls are **implemented but not yet validated in a live render**. Their hues and powers are starter values, not a calibrated reference match. The macro playbook also explicitly records a current limitation: the camera can crop the full product, but rig geometry still scales to full-product bounds, so close-up lighting should not be described as selected-part-aware. The next live gate is a single colored-light lifecycle on the user's disposable millimeter scene, with before/create/edit/remove/after snapshots and no scene save. Once cleanup passes, compare the color rig on the five forms and refine only with a bounded preview; then extend to material-specific look evaluation and crop-aware regions.

### Saved-checkpoint rollback and native light-family follow-up (2026-10-13)

The official KeyShot manual confirms the core model: physical lights are light-source materials applied to geometry; the geometry can be imported, already in the scene, or added as a primitive. The Add Lights menu creates geometry and applies the light material. Point Light replaces the carrier with a point at the part center, while Area Light emits from geometry and its dimensions shape reflections and shadow softness. This means the product agent should reason about **source type + carrier shape/orientation + material graph + camera/reflection behavior**, rather than treating every light as a generic XYZ point. See KeyShot's [Lighting overview](https://manual.keyshot.com/manual/lighting/), [Area Light](https://manual.keyshot.com/manual/materials/material-types/light-sources/area-light/), and [Point Light](https://manual.keyshot.com/manual/materials/material-types/light-sources/point-light/) pages.

A live KeyShot 2026.2 graph scan sampled up to eight Area and Spotlight assets and returned all three Point assets: Area uses `lux_mesh_light`, Point uses `lux_point_light`, and Spotlight uses `lux_spotlight`. Their observable controls include:

- **Area:** power, color, lumen mode, emitter-side controls, camera/reflection/shadow visibility, and samples. Two Area material graphs return display labels “Apply to Front” and “Apply to Back” opposite their parameter names (`apply to back of geometry` and `apply to front of geometry`). Automation must write by stable parameter name, not display label.
- **Point:** power, color, lumen mode, and radius. KeyShot documents radius as the control for shadow softness; the light's position is the carrier part's center.
- **Spotlight:** power, color, radius, beam angle, falloff, and `focus_power_in_cone` (“Constant Light Output”). KeyShot documents the difference as constant total flux versus constant illuminance when beam angle changes. The live scan found angle presets at 15°, 30°, 45°, and 120°.
- **IES:** the earlier live material-name scan did not surface IES entries, but the installed user library contains IES Light `.mtl` assets and `.ies` profiles. A K72 material loaded as `lux_ies_light`, retained its profile reference, aimed, and affected the rendered product. A follow-up exposed and fixed an inherited 5600 K default that had overridden its warm MTL color; the current route preserves the MTL color unless Kelvin/RGB is explicitly requested.

The first 640 × 400 baseline render normalized KeyShot's reported render height from 2398 to 2400 and toggled `isSceneChanged`; the product nodes, geometry IDs, materials, camera, environment, and active RenderOptions did not change. The render verifier now retains full raw hashes, but also reports a scene-content fingerprint that separates those renderer-owned dimension/dirty-flag fields. A stable follow-up preview passed both scene-content and raw-state checks.

The documented `lux.openFile(path, dontAsk=True)` checkpoint route was then tested on the exact saved `<user Documents>\KeyShot Studio\Scenes\Templates\PluginTest.bip` file. A guarded typed operation verifies the current file identity and five-form scene before reopening it. It restored the original five model groups/materials, removed the research light and its retained mesh, cleared only the research ownership registry, and returned `scene_changed=false`; the saved checkpoint's unit state is `unknown` and must be configured to mm again before geometry placement. This is now the tested rollback for disposable probes; direct per-node deletion remains unsafe.

Using that rollback, a second 60,000-lumen white Area panel was created at the prior benchmark placement and rendered, then removed by reopening the saved checkpoint. Product-mask share remained 8.94%. The new preview measured mean luma 0.6711, median 0.7300, p95 0.9577, and clipped share 0.51%, closely reproducing the earlier 60k result (mean 0.6713, median 0.7300, p95 0.9574, clipped share 0.49%). This supports the 60k point as a repeatable **test-scene** calibration for that panel and environment, not a universal lighting preset.

A prior typed Point/Spotlight probe verified material assignment and readback. A later controlled overhead Spotlight render isolated its effective local **-Y** emission axis: local +Z aimed at the product had no measurable change, while local -Y produced a visible beam and clipped highlight on the black sphere. That confirms the axis for this material/setup; power and appearance are still scene-scale dependent. The tracked create/update route, IES MTL loader, and checkpoint restore have since passed live lifecycle checks.

### Evidence update: installed IES assets and focused REA pass (2026-10-13)

The installed KeyShot 2026.2 executable was identified at `<KeyShot installation>\bin\keyshot.exe` (SHA-256 `136a98c2f19bcc04cab244bdb4be7674572bc21c864b14f12ee6e13befb7a46d`). REA `open_binary` identified it as an x86-64 PE. A targeted REA `inspect_pe_resources` completed as Evidence `ev_11259c429cec39a75b7bfaf98c2b2d78fe8e1a3c0cf12c738abb6e94519071e7`; that result verifies artifact identity/resource layout only and does not establish light behavior.

The narrower Ghidra-backed search for light shader/UI strings and the attempt to switch to `kscripting.dll` did not return within the bounded investigation window. They were stopped rather than treated as findings. The remaining binary questions are still open: native call paths from UI actions, and any undocumented light constructors. This is a provider/time limitation, not evidence that those calls do or do not exist.

The installed `keyshot_commands.json` has 39 named commands across Scene, Cameras, Materials, Environments, Rendering, ImageStyles, Studios, File, and System. It includes environment get/set/create calls but no light or pin creation commands. That is a boundary of this command catalog; the separately observed in-process `lux` scripting surface and Director's own `light_set` bridge remain the actual routes for light graph work. KeyShot's official material-graph scripting guide confirms `lux.getMaterialGraph`, node parameters, `getParameter(name)`, and `ShaderParameter.setValue()` as documented scripting mechanisms. See [Material Graph scripting](https://manual.keyshot.com/keyshot11/manual/scripting/quick-start-scripting/scripting-material-graph/) and [Accessing scene nodes](https://manual.keyshot.com/keyshot11/manual/scripting/quick-start-scripting/scripting-accessing-scene-nodes/).

The filesystem search corrects the older bounded live-library result: the user library contains IES material files under `Materials/Light/IES Light` and matching profiles under `Textures/IES Profiles`. A sample K72 IES material references `IES_140403XX_REC_K72_LED-500MA_V0.Ies`, and that basename is present in the installed IES-profile tree. KeyShot documents the profile as the photometric distribution and stored lumen value, multiplier 1 as the neutral reference, and shape/axis as additional controls. Live assignment, aim, render contribution, and native profile-color preservation are now verified for this fixture on the installed build.

### Current continuation (2026-10-13)

The core lighting operation now dispatches `area`, `point`, `spotlight`, and `ies` through a tracked carrier. It selects the correct KeyShot shader graph, writes type-specific parameters by stable graph parameter name, reads them back, and refuses to change the type of an existing light ID. IES MTLs load through `lux.loadMaterials()` into the current project, after checking that both the `.mtl` and referenced `.ies` profile are installed. The profile catalog is read-only and does not load materials or mutate the scene.

The normal Ask Director tool and reference-photo planner now carry source type, radius, beam angle/falloff, IES asset ID, and IES multiplier. The lighting panel displays type-appropriate controls. Specialist guidance maps visual cues to source choice: Area for reflected source shapes and softboxes, Point for compact local sources, Spotlight for a directed pool, and IES only when an exact installed profile exists. The latest live checks below now cover create/update, graph readback, visible contribution, and checkpoint rollback for these four types. Production-quality matching and broader material/product coverage remain open.

The API Anything adaptation is represented by the lighting-lab operation registry: each operation declares its inputs, preconditions, side effects, validations, evidence, and limits; completed runs persist normalized inputs, bridge output, validation results, and a `replay_of` link. Replaying a recipe therefore tests the same concrete operation with changed or repeated inputs and compares the readback instead of relying on conversational memory.

The focused static REA pass on the already-open `kscripting.dll` (SHA-256 `717834dc1546c216838a8e773b65c76e9f198a349181ad60dd8db5d8a6f68dfe`) succeeded. Ghidra observed `KScriptMaterialGraphMod::install` registering the Python constants `SHADER_TYPE_IES_LIGHT`, `SHADER_TYPE_MESH_LIGHT`, `SHADER_TYPE_POINT_LIGHT`, and `SHADER_TYPE_SPOTLIGHT` with their corresponding `lux_*` shader identifiers (Evidence `ev_08a2468bc4813704be100501443cb15a4c4ec70a0363afefa61c1bb3247f5dfb`). Its method inventory includes `newNode`, `removeNode`, `newEdge`, and `removeEdge`; the analyzed `newNode` binding passes a requested shader-type string to KeyShot's graph and returns a wrapped `ShaderNode` (Evidence `ev_5d28be495c180251632ede19897503374feab87fbeaa7772d1927c870eaf5b58`, `ev_7e24c9f240b42a236a8bf2669a5a3fda447e40af6ac80789b96b5d1924a6ccc0`). `ShaderParameter.setValue` dispatches typed Python inputs to KeyShot's parameter setter and reports unsupported complex value types (Evidence `ev_afad8f345c820ce1164d5ee7f691857cdd7705c3cc43b3e351e2eda356e7250d`). This is strong evidence for generic material-graph editing, but it does not prove that arbitrary shader strings are valid or that a hidden Planar-light shader exists. The UI-to-native action path and undocumented light constructors remain unresolved; static strings alone are not behavior proof.

| Capability | Current status | Next evidence step |
|---|---|---|
| Area light placement and material parameters | Native graph, placement, create/update/remove, and repeatable test-scene response verified; 40k lm raised product-mask median from 0.659 to 0.707 with 0.3% clipped pixels | Validate on held-out products/materials; expose stable front/back controls only where they address a real need |
| Point light | Native graph and type-specific create/update verified; a subtle local contribution changed about 20% of masked product pixels without materially shifting median exposure | Compare on close product crops and glossy/matte held-out materials; tune power/radius separately |
| Spotlight | Native graph, create/update, beam parameters, local -Y aim, and a small measurable render change verified | Evaluate beam footprint, falloff, and radius on targeted close-ups and non-black backgrounds |
| IES fixture | 31 installed MTL/profile pairs found. K72's six-axis sweep has a noise-controlled product-only response; a wide 80° Smart Cake profile shows a strong direct-pass increase at 10× its native 2,683 lm | Keep the profile axis and tint by default; scale the native multiplier from masked render evidence, not from source-name assumptions |
| Planar Light | Native UI feature documented; no verified lux graph or scripting constructor | Keep Area and Planar distinct; revisit only if a focused REA/UI action trace returns a concrete constructor or state route |

The live pass used a saved-checkpoint rollback and verified restoration of the five original forms, camera, and millimeter units. A fresh bridge reload picked up the IES-color fix automatically. Keep `PluginTest.bip` unsaved and restore it from the exact path returned by a fresh snapshot after each probe.

### Follow-up live source tests (2026-10-13)

The baseline at 640 × 400 had product-mask median luma 0.6588, p95 0.9098, and 0.21% clipped product pixels. A 100,000-lumen Area source raised the median to 0.7642 and clipping to 5.57%; lowering the same panel to 40,000 lumens yielded median 0.7067 and 0.30% clipped. The panel placement self-check reported 0 mm error. These are repeatable readings for the five-form test setup, not universal power recommendations.

The typed Point source created with a `lux_point_light` graph and read back its power/radius. Its product-mask median remained near baseline at displayed precision, while a pixelwise beauty comparison found changes in about 20.1% of masked product pixels (mean absolute RGB change 0.22/255). This is a real but relatively subtle local contribution; it should be assessed on a closer product crop before auto-tuning.

The typed Spotlight used `lux_spotlight`, reported the beam controls, and produced a small measurable change when aimed along local -Y. Replaying the same ID updated angle and power while retaining a single owned light. The control semantics are now understood well enough for recipe construction, but scale and useful falloff still depend on the actual product and crop.

The installed library scan found 31 valid IES material/profile pairs. The K72 3000 K 15-degree MTL loaded through documented `lux.loadMaterials()` and returned material name `K72 LED 3000K 15° 14040309`; its graph read back the selected profile, multiplier, radius, color, and axis. A six-axis 10× diagnostic sweep altered roughly 15–20% of product pixels, although global product median rounded to the same value. This proves a visible local contribution and graph assignment, not a universal fixture-orientation rule. A typed create with Kelvin/RGB omitted initially exposed a mismatch: the new-light template supplied Area's 5600 K default, changing the IES graph from its MTL color `[0.898, 0.465, 0.164]` to `[1.000, 0.938, 0.883]`. Removing that inherited default made the live readback exactly match the profile tint. An explicit RGB control using the MTL tint independently produced the same readback. The exact checkpoint restore passed after both tests.

Point, Spotlight, and IES operations were removed by reopening the exact saved checkpoint, which restored the original five forms and millimeter setup. Do not use broad geometry clearing as cleanup. The scene has not been saved over the user's checkpoint.

### Professional lighting principles for the agent

Across the product-photography and KeyShot walkthroughs, the repeatable method is to name the visible failure, make one controlled change, and compare at a fixed camera/crop/exposure. The cues are:

- **Highlight shape and width:** reveals apparent source size and reflection placement. A broad highlight needs a larger reflected source shape; power alone cannot fix an incorrect reflection.
- **Light-to-dark transition:** reveals form and source softness. Move or resize the key before adding fill; add fill only when important shadow-side information is missing.
- **Shadow direction, contact, and edge softness:** reveal key direction and source distance/size. Preserve the contact shadow unless the brief asks for a floating look.
- **Reflections:** glossy metal and glass behave like mirrors of the environment. Design the reflected bright and dark regions with broad sources, HDRI pins, and negative-fill-like geometry/flags; rotate the product or camera slightly when a glare patch must move off a label.
- **Background separation:** product exposure and background brightness are separate decisions. For white products on white, preserve a highlight inside the form and darker value at the contour; control the background and environment highlights independently.
- **Material-specific priority:** matte finishes need directional form and restrained fill; polished metal needs designed bright/dark reflection bands; clear glass needs deliberate bright-field or dark-field edges and readable labels; colored gels should be assigned distinct roles rather than tinting every source.

These are visual-reconstruction rules, not claims that a single reference reveals the original studio equipment. A reference can support a good appearance match while leaving the original number, type, and physical placement of sources ambiguous. See [MakeAD's controlled product-lighting workflow](https://make-ad.com/resources/product-photography-lighting-setup), KeyShot's [white-on-white walkthrough](https://www.keyshot.com/blog/3d-rendering-white-products-on-white-backgrounds-in-keyshot/), [adding light reflections](https://www.keyshot.com/de/blog/adding-light-reflections-in-keyshot/), and Esben Oxholm's [HDRI plus Area Light study](https://www.youtube.com/watch?v=umnswWAS2vw).

The resulting diagnostic order is: keep the view and exposure fixed; establish one dominant key; correct its direction and apparent size; add restrained fill only for missing information; shape glossy contours with dark regions or reflection controls; tune background separately; then evaluate the source at final resolution. Each turn should record the observation, changed parameters, render evidence, and result so the operation can be replayed and improved with new inputs.

### Connected IES and scripting-binding follow-up (2026-10-14)

The connected bridge reported the clean saved `PluginTest.bip` with the five forms and units `mm` / `1000`. All IES experiments below used an Interior GPU diagnostic capture at 640 × 400; the capture restored the original Product CPU engine (`0 → 4 → 0`), and its validation reported unchanged scene content and render options.

For the K72 15° profile at 100×, I compared six 2-second Direct-pass EXRs against the average of two independently captured no-light baselines. The repeated baselines' product-mask mean absolute difference was `6.7e-6` linear luma (maximum `0.000488`). Axis 0, 2, and 4 produced mean signed product changes of `+4.50e-5`, `+5.59e-5`, and `+5.68e-5`; axes 1, 3, and 5 produced `+5.3e-6`, `+1.24e-5`, and `+5.9e-6`. Outside-mask mean changes stayed at or below `1e-7`. The even/odd split is much larger than this repeated-baseline noise, but it is only a measured response for this K72 profile, placement, camera, scene, and render engine. Do not encode a universal interpretation of the axis numbers; keep each fixture's native axis unless visual evidence supports a deliberate change.

The broader `Smart cake 160 diffuse LED 3000K 80°` profile is a more useful calibration example. Its installed MTL/profile pair read back shader `lux_ies_light`, native color `[0.897978, 0.464591, 0.163912]`, axis `4`, and multiplier `1`; its IES photometric header reports 2,683 lm. Replaying the same tracked operation at multiplier `10` preserved its profile color/axis and read back the new multiplier. The 1× 4-second and 10× 5-second beauty captures measured product mean/median/p95 luma of `0.6327 / 0.6515 / 0.9028` and `0.6450 / 0.6740 / 0.9207`; clipped product pixels stayed about `0.17–0.18%`. Comparing the paired Direct EXRs, the 10× pass increased masked-product mean linear luma by `0.0313548`; the outside-mask signed change was `5e-7`, with 70.2% of product pixels changing by more than `1e-4`. This establishes a controlled, local light response and useful multiplier authority for this broad fixture. It remains a fixture-and-scene calibration, not a universal 10× recommendation. Runs: 1× create `7f9ed4e8-d2e7-4d2a-99ad-5b5ef74c3daa`, 1× capture `4ee17958-25d4-4bc0-bab8-6b47fa32aea5`, 10× replay `0e4ee567-3aac-4ff6-b8b7-31540c8d5760`, 10× capture `72ca7a41-7639-4c6b-8613-b53ad2282266`.

The saved checkpoint was reopened afterward. The restore record verified the same file, five forms, original tree and materials, and millimeter units; the final read-only snapshot still reported five objects and no test light (`85db8c6c-0512-4acb-a0cf-5028bab19b7f`, `171f9eef-321b-4d13-9f9a-10b7190e59e5`). The user checkpoint was not saved over.

The REA binding evidence complements, but does not replace, these live tests. The `MaterialGraph` Python type can create/remove nodes and edges, while `ShaderParameter.setValue` supports typed concrete values and rejects pure parameters or unsupported complex types. This suggests a path for richer graph operations and eventual user-facing light controls. It does not establish that a missing material graph can be created as a complete scene light, nor that Planar Light has a recognized shader type. Before adding an unverified light type, the next safe question is whether KeyShot's live UI creates an inspectable graph/shader that the same `lux` graph API can serialize and reapply.

Next validation should hold a reflective metal and a matte polymer product fixed, compare the same fixture at 1× / 3× / 10× with a product mask and fixed crop, then repeat at a closer shot scale. That will tell the agent when a profile is a useful local emitter and when an Area source is the better choice for shaping broad reflections.

### IES photometry catalog slice (2026-10-14)

The read-only IES profile catalog now parses the supported LM-63 `TILT=NONE` numeric block and returns a compact photometry record with the MTL/profile pair. It includes a lumen reference when the file supplies a positive lamp-lumen rating, input watts, candela peak and its vertical/horizontal angles, photometric type, sample counts, and median dominant-lobe widths measured at 50% and 10% of each horizontal plane's peak. The widths follow the contiguous main lobe around that peak. This avoids turning a wall washer's separated lobes into one misleading 180° span. When a file uses absolute candela without a positive lumen rating, the catalog reports that the lumen reference is unavailable rather than deriving or inventing flux.

All 31 installed IES material/profile pairs returned a parsed distribution in live record `69b1b4bb-1de3-4f8f-b00f-86a2a339adda`. The K72 15° profile reports 739 lm, 4,023 cd peak, and a 7° dominant-lobe half-peak width; the Smart Cake diffuse 80° profile reports 2,683 lm, 1,302 cd peak, and a 37° half-peak width. These half-peak widths describe the sampled dominant vertical lobe, not the manufacturer's beam-angle label or secondary beams. A profile's name is now only a clue when quantitative photometry is present.

`list_light_profiles` now returns these measurements to the main agent. The still-photo planner receives the full installed set and the same measurements, then chooses only an exact `asset_id`; it is instructed to preserve native tint/axis and treat widths as estimates. KeyShot's manual describes the IES profile's lumen value and says multiplier 1 is the accurate starting point; its multiplier adjusts the profile intensity. The underlying profile parser follows the official [ANSI/IES LM-63 file format](https://store.ies.org/product/approved-method-ies-standard-file-format-for-the-electronic-transfer-of-photometric-data-and-related-information/?v=eb65bcceaa5f), while profile controls follow the [KeyShot IES Light manual](https://manuals.keyshot.com/kss2026/en-us/manual/ies-light.html). `TILT=INCLUDE`, malformed profiles, and absolute candela with no positive lumen field remain explicitly limited. The change does not load a material or edit the scene.

### Linear render-pass evidence and Area-versus-IES comparison (2026-10-14)

Lighting captures now decode the installed build's tiled, ZIP-compressed, single-level EXR passes when the file uses supported half- or full-float RGB/Y channels. Direct, Indirect, Reflection, Shadow, and Raw passes are aligned pixel-for-pixel to KeyShot's Clown product mask. The report stores linear-luma mean, median, 95th percentile, positive-pixel share, and mean RGB by product and non-product regions. It also stores those metrics per non-black Clown color label, with normalized centroid and bounds so the label can be related to a visible object in the mask and scene inventory. Those label colors are not semantic names and are not assumed to persist across scenes. Unsupported EXR layouts produce a per-pass unavailable reason and do not invalidate the beauty/Clown report. Resource bounds reject files over 128 MiB and images over four million pixels. The non-product region includes the ground, shadows, and reflections; it is not called a background-only region.

This adds a useful diagnostic distinction for mood recreation: beauty output is display transformed and combines causes, while the Direct and Reflection passes separately show whether a revision changed illumination on the product or its reflected source shapes. Linear RGB means also retain hue evidence for cyan/magenta or warm/cool recipes. These are aggregate measurements, not feature recognition; the agent still cannot identify a button, bevel, logo, or semantic material region from the Clown mask alone.

The Lighting Capability Lab now has a **Capture again + compare** action. It replays the same pass request against the current scene, compares Direct/Indirect/Reflection/Shadow/Raw per-pixel deltas against the prior capture, and reports mask and label overlap. The comparison excludes pixels whose product/background classification changed; it flags a lighting-only comparison as suitable when the product-mask intersection-over-union is at least 0.95, and separately flags per-label metrics only when the labels also agree at least 95%. These thresholds are guardrails, not proof that the camera is identical. This is the concrete learn → replay → check loop: it gives the agent a controlled way to see whether a lighting revision changed product illumination, reflected shapes, or unintended surroundings. It is a diagnostic, not yet an automatic search over light settings.

To test source-family choice, I captured the same five-form scene and camera with an Interior GPU preview, first using the warm Smart Cake 80° IES profile at 10× (`2,683 lm × 10`) and then an Area panel at `26,830 lm`, tinted to the same RGB readback as the fixture profile and placed at the same location and target. Both previews were 640 × 400 at five seconds and included Direct, Reflection, and Clown passes. On the product mask, the IES capture's Direct mean linear luma was `0.3038480` versus `0.2915493` for Area; the Reflection means were `0.1351528` and `0.1350934`. Equal nominal lumen did not produce identical distribution or reflection behavior.

The paired per-pixel comparison is more informative than the similar beauty values. IES minus Area changed the product Direct pass by `+0.012312` mean signed luminance and `0.012593` mean absolute luminance; 70.0% of product pixels differed by more than `1e-4`. The Reflection pass changed by only `+0.0000646` mean signed luminance, but 30.3% of product pixels still differed by more than `1e-4`, with a maximum absolute difference of `0.0740`. Outside the product mask, mean absolute change was `2.5e-7` for Direct and `9.7e-8` for Reflection. Per-label metrics show where that change landed: the IES was brighter on Direct over the right-hand shiny-plastic rounded cube by `0.02886` and the left rough-plastic cube by `0.01216`; the black sphere changed by only `0.00205`, and the glass torus and polished-aluminum cylinder had no measured Direct difference in this pass. In Reflection, the Area candidate differed across 49.8% of the aluminum cylinder pixels, 41.3% of the glass torus, and 13.8% of the black sphere by more than `1e-4`; the average change was negative for cylinder and torus, and positive for the sphere. Here the Clown labels were mapped to those shapes by their mask positions and the scene inventory. This is still one rig and one camera, but it demonstrates why the agent should evaluate the product surface and the relevant pass instead of optimizing one global brightness number.

Runs: IES capture `e6e5b5bf-832b-4431-9bd0-f7d9db42e01d`; Area capture `b7199c6a-ad3c-4b87-9c41-181a4c4d968f`. This is one controlled scene, crop, material set, profile, and engine, so the measured deltas calibrate this comparison only. The five-form checkpoint was restored and verified after each experiment; no user scene was saved over. Next research should repeat the source-family comparison on a reflective metal and a matte polymer at both full-product and detail crops, then use the same pass evidence to set objective weights for the playbook router.

### Shipped KeyShot MCP server inspection (2026-10-14)

The installed KeyShot Studio 2026.2 folder contains `bin\keyshot-mcp-server.exe` and a companion `bin\keyshot_commands.json`. The JSON defines 39 tools across System, Scene, File, Cameras, Environments, ImageStyles, Materials, Rendering, Studios, and VisualInput. It has no Lights or Lighting category. `set_environment` accepts an environment name only; there are no light position, geometry, power, beam, profile, intensity, or environment brightness/rotation inputs in this tool catalog. The server can still be a useful source of high-level scene, camera, material, image-style, and render operations if it can be launched reliably.

The installed command catalog is a concrete API Anything-style artifact: each tool includes a name, category, description, JSON input schema, and permission label. We can learn and compare its surface without treating its descriptions as proof of behavior. The KeyShot 2026 scripting manual separately documents the live `lux` scripting console and Python 3.13, including environment control, scene-node operations, image styles, render options, passes, and renders; that remains the broader supported route used by this plugin. [KeyShot Studio scripting](https://manuals.keyshot.com/kss2026/en-us/manual/scripting-console.html)

One direct `keyshot-mcp-server.exe --help` launch failed before the server started: the frozen Python app reported a missing `keyshot_commands.json` in its temporary `_MEI...` bundle and advised `ninja dump_mcp_tools && dump_mcp_tools keyshot_commands.json`. The sidecar JSON is present in the installed `bin` folder, but this invocation did not load it. REA identified the executable as a 64-bit PE (`5b2878140681450f307b8eceb4fa0b0ab0a4ac7ebb8204e86a957ceee809fdb6`); its defined-string search found no direct `light`/`lighting` strings, which is only a bounded static observation. Ghidra overview and startup evidence: `ev_8eb71dca53ddc1654d9945ec1c3613344554d35dc2eb96a8b661892b09328a2a`, `ev_8accda0fe2926463230920a653c398a0ddfcd3a784725f8baab6c2b7511d34b1`, and `ev_4e0158aebd8fd2c8c6b9cfe26a01a4ab27ae5644ade36023589dba6ddcdc864a`.

**Conclusion:** this installed MCP catalog does not provide deeper light controls than the existing `lux` bridge. Do not route lighting changes through it. Keep the lab's explicit operation schemas, side-effect labels, exact inputs, replay records, and result checks; those are the useful API Anything patterns. Whether KeyShot launches this MCP server through a different supported path, or exposes additional tools elsewhere, remains unknown. No MCP process was connected to KeyShot and no scene state was changed during this inspection.

### Fresh live validation (2026-10-14)

After the user reconnected the bridge, the installed runtime reported KeyShot Studio `2026.2` / scripting API `15.1.2.7`, Python `3.13.12`, and the five-form `PluginTest.bip` at millimeter scale `1000`. A read-only scene inventory, runtime-control inspection, light-graph inspection, subject-bounds query, and installed-IES scan all passed their typed shape checks. The current runtime exposes 55 lighting-related `lux` names; live graphs returned 12 Area assets, 3 Point assets, and 12 Spotlight assets, while 31 installed IES pairs parsed completely. The IES count is a separate installed-profile catalog, not a count of loaded scene graphs.

The new diagnostic pipeline then rendered one 640 × 400 preview at a 2-second budget with Clown, Direct, Reflection, and Shadow passes. Every requested pass appeared; the EXR decoder and Clown-aligned measurements ran successfully. KeyShot reported identical before/after scene and render-option fingerprints, and the active Product engine was restored. A second bounded capture replayed the same request: product-mask IoU was `1.0`, anonymous Clown-label agreement was `1.0`, and average absolute Direct change was `0.0000765` linear luminance, consistent with a near-stable repeated render rather than a lighting edit. Despite that tiny mean difference, 10.1% of Direct and 18.2% of Reflection product pixels crossed the raw `1e-4` threshold, confirming that this threshold-crossing share alone overstates meaningful change. The Lab UI now emphasizes signed and mean-absolute delta magnitudes, and refined photo matching captures a same-look repeat as a noise reference before using later comparisons. Records: baseline `bcc23e74-b655-4fbd-a05a-bdece1891581`; replay comparison `31d481b0-3d0e-4432-9e46-2895c2d8e1d9`. The preview is a bright neutral studio look; the measurements diagnose this scene and crop only, and do not establish product-part semantics.
