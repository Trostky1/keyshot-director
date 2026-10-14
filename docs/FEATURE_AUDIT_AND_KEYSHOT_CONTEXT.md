# KeyShot Director feature audit and scene-context plan

**Audit date:** 2026-10-14

**Scope:** Current repository source, product/workflow documentation, existing lighting and material research, the public KeyShot scripting reference, and one bounded, read-only query against the live KeyShot scene. No scene edits, renders, or saves were issued.

## Executive assessment

Director already has a substantial, unusually capable foundation: it can build native lighting, compare real KeyShot render evidence, inspect and create material graphs, import PBR texture sets, execute guarded geometric displacement, stage actual scene geometry, and reproduce camera motion from video. The first shared scene-context layer is now implemented, shown on demand in Studio, and supplied once at the start of an agent request. The remaining gap is that scene facts still do not connect a selected part to targeted native light placement, and names/bounds cannot identify a semantic surface such as a button or logo.

The next high-value investment is **selected-part-aware lighting with controlled render feedback**. Use the selected part's bounds and material as a spatial target where the light controls can remain coherent, then refine against product-masked Direct, Reflection, and Shadow evidence. Keep the read-only context compact and request deeper graph or geometry details only for workflows that need them.

The remaining hard boundary is semantic feature recognition. KeyShot exposes scene nodes, names, hierarchy, bounds, materials, metadata, selection, and render layers. Those do not necessarily tell Director that a region is a button, logo, bevel, grip, or functional surface. Selection, meaningful scene-tree names, user confirmation, and existing render-layer assignments are the reliable path to that level of focus. Image segmentation can suggest a region, but it must be matched back to a KeyShot part before Director claims or edits that part.

## Implementation started — shared context v1

The first vertical slice is now implemented in source. `scene_context` is a read-only bridge operation that returns an allowlisted scene name/scale summary, camera pose and available lens parameters, active Studio/configuration labels when exposed, environment summary, selected node paths/bounds/material assignments/render layers when available, product bounds, render engine, and Director-managed light specs. It caps selected nodes at eight and selection scanning at 5,000 nodes. It omits absolute scene/HDRI paths, arbitrary metadata, and full material graphs; those remain local or on-demand. Chat captures one snapshot at the start of each user request and can call the tool again on demand, avoiding repeated bridge reads for every model-tool loop.

AI-driven Studio and Material Lab turns receive a fresh snapshot before each model turn. Reference-photo and reference-video planners also receive a snapshot before constructing their plans. Photo and video recipes retain the snapshot locally for reproducibility. Disconnected bridges or unsupported getters leave fields unknown without blocking the conversation. The new bridge module is included in the release package list.

**Live-observed:** two read-only queries against the open five-object millimeter test scene returned schema 1.0 without rendering or changing the scene. The first correctly reported no selection. After the user selected `Rounded Cube`, the second returned its node path, bounds, and assigned `Advanced Plastic #1` material; no render layer or Director-managed lights were reported. Scene scale, camera pose, environment, and render size also returned. The live API returned lens data as a dictionary, and the updated parser now preserves its allowlisted values structurally; this was confirmed by the second query. KeyShot returned an empty configuration object, which the source now omits; that final omission change has not yet been re-queried. A manual, read-only “What Director sees” inspector is now wired to the same scene-context operation; it does not poll or change the scene. The next pass should use selected-part context in lighting/material diagnostics.

## Evidence standard

- **Implemented in source** means the checkout contains a callable path; it does not by itself prove that every input works in every KeyShot scene.
- **Live-observed** means a controlled observation was returned by the current KeyShot session or recorded in the existing research notes. The single context query in this pass did not repeat lighting or material experiments.
- **Documented** means the public KeyShot scripting reference describes the API. The available public reference is 2026.1, while the user’s installed build is 2026.2; new getters should be confirmed with the existing read-only runtime probe before depending on them.
- **Inference** means a design conclusion drawn from the available source and documentation, not a claim that KeyShot has an undocumented feature.

The installed scripting reference describes useful scene APIs including `getSceneInfo`, `getSceneTree`, `getActiveStudio`, `getActiveConfiguration`, `getActiveEnvironment`, `getActiveImageStyle`, `getCameraLens`, `getRenderOptions`, `getRenderLayers`, `getMaterialMapping`, `getObjectMaterial`, and `SceneNode.getMetadata`, `getPath`, `getSelected`, `isSelected`, `getRenderLayer`, `getBoundingBox`, and `getMaterial`. These are concrete candidates for better context, not proof that every getter is already used or has been runtime-verified in this checkout. [KeyShot 2026.1 scripting reference](https://media.keyshot.com/scripting/doc/2026.1/lux.html) · [Accessing scene nodes](https://manual.keyshot.com/keyshot11/manual/scripting/quick-start-scripting/scripting-accessing-scene-nodes/)

## Feature-by-feature audit

| Feature | What Director has now | Assessment | Best next improvement |
|---|---|---|---|
| **Bridge and prompt control** | Local Node app plus in-KeyShot Python bridge; basic offline controls and optional Claude/Codex/API engines. Typed tool calls cover lighting, camera, materials and scene staging. A bounded scene-context snapshot is attached to Studio and Material Lab turns and supplied to photo/video planners. The Studio inspector exposes the same snapshot on demand. If a CLI returns prose instead of a tool call, unambiguous built-in lighting requests now use a deterministic preset fallback; contradictory looks are not guessed and unavailable actions report that no change was sent. | Useful, but bridge work still runs through KeyShot's scripting thread. The context is deliberately compact and does not establish semantic surface identity. | Validate the inspector against a live selection after the next bridge session, then use selected-part context in lighting/material diagnostics. Keep bridge reads short and edits explicit. |
| **Studio lighting and mood** | Product-scaled Area, Point, Spotlight and installed IES sources; reusable rigs and specialist playbooks; environment brightness, exposure, source controls, visibility behavior, and actual KeyShot preview. The light lab records API surfaces, IES data and pass evidence. | The strongest domain slice. Placement is scene-scaled and several source behaviors have controlled evidence. Scene bounds still describe the whole target, not its intended face or feature. | Use selected part bounds and its assigned material graph as the lighting target. Explain which observed cue caused each light choice. |
| **Still-photo recreation** | Reference plus current KeyShot image; structured light plan; real renderer preview; optional one-step visual refinement; undo and saved recipe. Refined mode can compare Clown-aligned Direct, Reflection and Shadow data and use a same-look repeat as a noise estimate. Planner now also receives a privacy-filtered live scene snapshot. | Real feedback is a major strength. A scene snapshot can prevent wrong assumptions, but it cannot name semantic regions; selected-part material data is verified for one live part, while planner outcomes using it remain untested. | Use selected target data when present and retain the reference/render as primary visual evidence. Report region identity separately from lighting confidence. |
| **Reference-folder styles** | Folder images are measured for backdrop, tone, contrast, highlights, color and composition; light/dark looks are grouped; a live frame can be scored and the rig adjusted. | Useful for clean, consistent references. The current product mask starts from border/corner color differences, so busy backgrounds, dark-on-dark scenes, transparent products and edge-to-edge crops can invalidate the score. | Reuse KeyShot-derived masks and alignment checks where available. Report which descriptors were measurable and abstain when the reference has no separable background. |
| **Framing and camera** | Full-product/detail framing, pose controls, lens/FOV and camera motion presets/recording. Chat and the Detail close-up button can use exactly one selected node's bounds; an explicit prompt or Studio toggle can target a standard lighting rig at that part. Selected-rig exposure estimates a camera-projected bounds region when possible. Video matching calibrates silhouette with an alpha preview where possible. | Bounds projection is approximate for a part's visible pixels and falls back to whole-product metering if projection is unreliable. It does not identify semantic features. Reference-photo lighting adapts sources to the visible camera crop; environment fill remains global. | Validate selected-part framing, rig scale and exposure in a live scene. Keep the current view and lens fixed unless the request asks for a camera change. |
| **Materials and library** | Search KeyShot’s loaded library; identify scene material assignments; inspect nodes, edges, parameter types and values; create independent copies; edit supported channels; save materials and KMPs. | Graph awareness is much stronger than simple name matching. Safe copy-first behavior protects library sources. Graph inspection is on demand rather than a scene-wide material summary. | For the selected part only, summarize root Surface/Label/Geometry branches, map roles, connected inputs and exposed values. Do not expose hundreds of node values to every lighting prompt. |
| **PBR texture sets and map editing** | Imports bounded texture sets with filename role hints and image-header dimensions/channels/bit depth; builds supported Base Color, Roughness, Metallic, Normal/Bump, AO and Displacement graphs; derives limited grayscale edits without overwriting originals; packages maps in KMP. | A useful, guarded pipeline. Filename and image headers identify file properties, but do not guarantee correct UV scale, channel packing, color-space semantics or a visually correct material. | Read and display map role confidence, channel packing, physical texture-size evidence and the live Texture Map settings. Keep unknown mapping units/enums read-only until calibrated. |
| **Geometric displacement** | True Displace-to-root-Geometry topology; low default around 0.01 mm; bounded height and explicit Execute Geometry; single visible/unlocked assignment guard; separate label/surface bump from geometry. | Real geometry displacement is implemented and has a bounded live example. Correct height, mapping scale and tessellation remain asset- and part-dependent. | Add a per-part displacement report: source map and bit depth, map-to-geometry edge path, offset/height/resolution, physical mapping if known, and execution state. Calibrate on representative user materials before generalizing. |
| **Scene staging** | Paginated scene inventory with IDs, names, kinds, bounds, units, hidden/locked flags; move/rotate/scale, duplicate, simple pedestal/floor/backdrop geometry and identity-checked undo. | Safety and undo are carefully handled. Inventory does not yet provide the full ancestry/material/metadata/selection context that would make natural-language part targeting easier. Set pieces are intentionally simple boxes. | Add paths, selected state, assigned material and render-layer name to inventory. Let explicit KeyShot selection disambiguate “move this part.” |
| **Lighting evidence lab** | Bounded beauty plus Direct/Indirect/Reflection/Shadow/Raw/Clown/Depth/Normals captures; pass alignment, masks, EXR deltas, render-noise sampling and scene/render-option fingerprints. | Strong diagnostic plumbing; it can measure causes better than a beauty-only image. It does not currently give each rendered region a dependable semantic part name. | Use existing render-layer names and selected-node paths for region labels where they already exist. Keep anonymous Clown regions anonymous. Add Refraction or Labels only when a transparent-material or label-specific task needs them. |
| **Video matching and animation** | Samples video frames, infers a lighting look and camera keys, calibrates the user product’s frame fill, plays camera paths, renders frames and encodes video. glTF animation routes are experimental and kept separate from native KeyShot timeline claims. | Good camera/framing path; lighting is principally a single rig for the clip. Busy reference backdrops weaken automatic measurements; offline analysis cannot reliably infer orbits. Native camera keyframes and moving-light reproduction are not established. | Use per-shot context, cuts and timestamps. Preserve distinct lighting per shot only when a clip actually changes setups. Treat lens/DOF, moving sources and animated parts as unsupported unless a controlled route is proven. |
| **Phone, packaging and privacy** | Local server, QR/phone access, offline basics, packaged launchers, explicit local reference and render folders. AI/provider use is optional for free-form visual work. | Broadly usable but the local-network app is not a multi-user authenticated service; full scene paths and product metadata should not be sent upstream by default. | Make context-sharing explicit and field-filtered. Keep path-like metadata, texture paths and credentials local; use only the minimum scene context needed for the selected workflow. |

## What KeyShot can tell Director

### 1. Scene identity and scale

`lux.getSceneInfo()` is documented to return the scene name/file, unit-to-meter scale, triangle/object/NURBS/curve counts, scene size, and render dimensions. Director already uses parts of this for staging and lighting. It should become the compact scene header for every workflow, with the full path kept local.

### 2. Which part the user means

`lux.getSceneTree()` exposes a traversable `SceneNode` tree. Documented node methods include name, ID, kind, parent/children, path, selected state, metadata, material, render layer, visibility/lock state, transforms and bounding boxes. `scene_context` now reads selected-node paths, bounds, material assignments and render layers when KeyShot reports a selection; it also returns product-level bounds. One live-selected `Rounded Cube` confirmed the node path, bounds and assigned material. The render-layer value was unavailable for that node. The next step is to converge this record with staging and material discovery, keyed by scene identity plus a current node ID.

**Highest-value interaction:** selection now provides a spatial target for chat close-ups, the Detail close-up button, and explicitly requested selected-part lighting rigs. This can direct a rig toward the chosen part without pretending that bounds identify a button, bevel, or logo. A selected mesh is stronger evidence than a language model guessing from the overall product image.

### 3. How the view is being made

The API documents active camera lens type, FOV, focal length, shift-camera offsets, position, direction, pivot, distance, and up vector. The shared context returns pose, FOV, and focal length. The live getter returned a structured lens dictionary, so the implementation preserves allowlisted lens values instead of formatting the dictionary as a label. Shift and lens-type enum meanings remain unknown until a controlled check establishes them.

The API also documents active Studio, active configuration, model sets, colorways/multimaterials, active environment, and image style. The shared context includes the active fields exposed by the installed build; an empty or opaque configuration object is omitted rather than shown as a misleading label. These facts can explain why an object is hidden, swapped to another finish, or rendered with a different environment/style.

### 4. What materials and maps actually drive the appearance

The bridge can read assigned scene materials and inspect material graph nodes, parameter values, and edges. The public API also documents per-node metadata and render-layer membership. For PBR reasoning, the important context is not just a material name: it is the selected part’s assigned graph, root branch connections, relevant map nodes, and mapping state. Mapping controls found in earlier installed-binary research have unknown enum meanings/physical units, so preserve them as observed data until a controlled test validates their interpretation.

### 5. What the renderer is doing

`lux.getRenderOptions()`, `getRenderEngine()`, `getActiveImageStyle()` and render passes can distinguish a lighting issue from an image-style, engine, output or material issue. The Lighting Capability Lab already captures a useful subset and fingerprints settings around a bounded render.

KeyShot’s Clown pass is **material-colored**, not a semantic object-ID pass. The manual says each material gets a flat selection color, and the active model sets limit which colors appear. So Clown is useful for product/background masks and approximate material regions, but it cannot guarantee “this region is the button.” Existing named Render Layers are a better semantic mask when the user has assigned them; the documented API can read layer membership. Director should never silently assign or modify those layers as a shortcut.

## Recommended context system

### Context contract v1 — read-only

The bounded `scene_context` bridge query and local server wrapper are implemented. The actual record is versioned and currently includes scene counts and scale, camera pose/lens values, available active labels, environment, selected nodes when present, product bounds, Director-managed lights, render engine/size, and explicit limits. Fields unavailable in the installed runtime stay unknown instead of being guessed. A future expansion may add identity hashes, normalized model-set/colorway summaries, native-light summaries, render-option summaries, and evidence availability after each is verified.

```json
{
  "schema_version": "1",
  "scene": { "identity_hash": "…", "display_name": "…", "unit_scale": 1000, "counts": {}, "size": [] },
  "active": { "studio": "…", "configuration": {}, "model_sets": [], "image_style": "…" },
  "camera": { "name": "…", "lens_type": "…", "fov": 35, "focal_length": 50, "shift": {}, "pose": {} },
  "environment": { "name": "…", "brightness": 1, "rotation": 0, "background_rgb": [], "ground": {} },
  "target": { "selection": [], "path": [], "bounds": [], "material": "…", "render_layer": "…" },
  "lighting": { "director_lights": [], "native_light_summary": [] },
  "render": { "engine": "…", "resolution": [], "option_summary": {}, "evidence_available": [] },
  "limits": []
}
```

The JSON above remains a target shape, not a claim that every field is currently returned. Add fields only after the installed runtime confirms the getter. Keep IDs and names for local tool targeting; send paths and metadata to a provider only when they are needed for the requested operation.

### Keep context layered

1. **Always-small preflight:** scene name/scale, active model set/studio where available, camera lens summary, environment summary, selected node summaries, and connection state. KeyShot version, scene identity hash, and busy state are not currently in the record.
2. **Workflow context:** bounds/materials for the target product; relevant light sources for lighting; selected graph for material work; animation and camera summaries for video.
3. **On-demand detail:** child hierarchy pages, node metadata, material graph nodes/edges, texture-map mapping parameters, render-layer membership.
4. **Visual evidence when needed:** viewport/beauty plus only the render passes needed for the question. Keep diagnostic EXRs local; pass compact derived measurements or an explicitly requested image to the selected vision engine.

Do not ask `getLibraryMaterials`, `getLibraryEnvironments`, or similar library queries as part of every prompt preflight. KeyShot documents that resource libraries may load lazily and the first library query can block while they load. Keep those operations behind the library browser or an explicit lookup. [KeyShot scripting reference](https://media.keyshot.com/scripting/doc/2026.1/lux.html)

### Use context differently in each feature

- **Lighting request:** selected part and product bounds, material graph summary, current camera/lens, active environment/image style, current light list, then Clown-aligned lighting passes after the first plan. The agent should explain observed cue → chosen source → measured result.
- **Photo match:** keep the existing reference and current render as primary evidence. The planner now receives active scene/camera/environment summary, selected target when available, product bounds, and material identifiers; preserve the existing noise repeat and linear-pass comparison.
- **Style match:** use valid product masks before scoring; align camera and crop; compare backdrop, Direct, Reflection and Shadow separately. If the mask is unreliable, label the score unavailable instead of treating the full frame as product.
- **Materials:** start from the selected part’s exact material assignment and graph. For texture sets, attach filename role confidence plus dimensions, channels, bit depth, color interpretation and any validated mapping/physical-scale evidence. Keep full MaterialX conversion outside the supported claim.
- **Staging:** use explicit current selection, full ancestry and world bounds. Ask when two product assemblies are plausible. Preserve the existing locked/hidden exclusions and single-operation undo.
- **Video/camera:** combine the base lens and view with frame timestamps/cut boundaries and product silhouette. Keep lighting changes per shot behind explicit evidence; do not infer moving lights from camera movement alone.

## Priorities

### P0 — Selected-part context and lens normalization — implemented

The read-only `scene_context` operation is implemented, packaged, wired into the chat, Material Lab, photo, and video planning paths, and live-observed. Keep the payload capped and privacy-filtered. A selected part's path, bounds, and material assignment are confirmed; render-layer availability remains unknown. A manual Studio inspector displays the same bounded snapshot. Chat, the Detail close-up button, and the Studio rig target checkbox can use one selected part's measured bounds. Lens values are preserved as structured data; empty or opaque configuration labels remain unknown rather than being stringified.

### P1 — Selected-part and semantic-region binding

The read-only context layer and inspector expose `isSelected/getSelected`, node path, bounds, material and existing render layer. Chat and the direct Detail close-up action can use exactly one selected node's bounds. A selected-part rig opt-in now sizes and aims a studio rig around that spatial target; it does not infer semantic geometry. Next, let the user provide a feature label when the CAD name is opaque; add a confirmed local alias only after the user approves the mapping. Use Clown for masks/material regions, never as a guaranteed object identifier.

### P2 — Context-aware lighting feedback

Feed the part/material/view context into lighting playbooks. Selected-part rig placement and approximate bounds-region exposure metering are implemented, but still need a live render comparison before claiming a quality gain. Use Direct to diagnose illumination, Reflection to diagnose source shape/placement, Shadow for softness/contact, and same-look repeats for noise. Prefer a source change that addresses a measured mismatch. Score only product pixels, with region identity confidence shown separately from lighting confidence. Environment fill is global even when a direct-light rig targets one part.

### P3 — Material mapping and asset-scale calibration

Expose mapping settings read-only first. Build a small controlled table from common Poliigon families and the user’s own Advanced Plastic/Plastic Realistic materials. Validate UV mapping mode, scale units, 16-bit displacement midpoint, height and tessellation on one part before enabling any writes by default.

### P4 — Make the audit durable in product language

The compact “What Director sees” inspector is implemented as an on-demand, read-only view of the selected model/part, active environment, camera/lens, materials, units and evidence limits. Keep it factual, show unknowns clearly, and avoid dumping API/debug jargon into the normal prompt flow.

## Gaps and claims to keep bounded

- Scene bounds and node metadata do not establish surface curvature, bevels, button boundaries, logo placement, or physical intent.
- A Clown color identifies a material region, not a guaranteed part. Same-material parts can share its color; current active model sets affect which regions appear.
- A material name or map filename does not prove correct color-space handling, UV scale, roughness convention, height scale, or shader response.
- A supported KeyShot getter in the 2026.1 docs must be checked against the installed 2026.2 runtime before production use.
- A captured pass or parameter is evidence about this scene and render configuration, not a universal lighting recipe.
- More scene data is not automatically better. Huge metadata/graph payloads increase latency, provider exposure and distraction. Fetch the minimum relevant detail and keep local file paths private.

## Broader product audit notes

- `README.md` describes the useful current capabilities but some navigation wording still refers to a separate “References” workspace even though the current UI combines reference work into Studio. Bring the install/use and feature table into line after the context slice is chosen.
- `ROADMAP.md` still frames the lighting engine as future work and carries older phase ordering. Replace its top-level status with the current product truth and point it at this audit and the existing lighting/material deep dives.
- Keep still-photo lighting/mood first. Scene staging, video and animation are valuable, but should not take priority over selected-part context and lighting evidence quality.
- The current KeyShot MCP command catalog is not a better lighting-control route: the existing REA record says it has scene/camera/material/render operations but no light creation or intensity/geometry controls, and its attempted launch failed to load the companion command JSON. The in-KeyShot `lux` bridge remains the practical supported control surface; the reusable lesson from API Anything is typed operation schemas, saved inputs/results and replay checks.

## Sources

- [KeyShot 2026.1 Scripting Documentation: `lux`](https://media.keyshot.com/scripting/doc/2026.1/lux.html)
- [KeyShot manual: Accessing scene nodes](https://manual.keyshot.com/keyshot11/manual/scripting/quick-start-scripting/scripting-accessing-scene-nodes/)
- [KeyShot manual: Material Graph scripting](https://manual.keyshot.com/keyshot11/manual/scripting/quick-start-scripting/scripting-material-graph/)
- [KeyShot manual: Layers and Passes](https://manual.keyshot.com/keyshot11/manual/render-4/render-output/layers-and-passes/)
- Existing repository evidence: `docs/LIGHTING_AND_MOOD_DEEP_DIVE.md`, `docs/MATERIALS_AND_DISPLACEMENT_DEEP_DIVE.md`, `docs/PHOTO_WORKFLOW.md`, `docs/SCENE_STAGING.md`, `README.md`, `ROADMAP.md`, `server/agent.js`, `server/photo.js`, `server/style.js`, `server/video.js`, `bridge/cc_lights.py`, `bridge/cc_materials.py`, and `bridge/cc_stage.py`.
