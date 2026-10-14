# KeyShot Director roadmap

## Product direction

Help a designer understand a lighting reference, build a convincing native KeyShot setup around their own product, and refine it from real render evidence. Keep the product and source materials intact, make scene changes reviewable, and be clear about what KeyShot does not expose.

Lighting and mood recreation remain the main product priority. Camera framing, materials, and staging should improve the lighting workflow rather than compete with it.

## Current foundation

- **Live KeyShot control:** a local Node app and an in-KeyShot Python bridge provide camera, environment, lighting, material, scene-staging, preview, and render operations. The bridge executes in KeyShot's scripting thread.
- **Lighting:** product-scaled Area, Point, Spotlight, and installed IES fixtures; reusable studio and mood rigs; environment brightness and exposure; light behavior controls; typed playbooks for catalog, hero, macro, low-key, color, glass, and reflective materials.
- **Reference matching:** still-photo and reference-folder workflows estimate measurable lighting and tone, apply a real KeyShot rig, and can refine from actual previews. Local lighting evidence supports beauty, Clown, Direct, Indirect, Reflection, Shadow, Raw, Depth, and Normals captures where the installed renderer exposes them.
- **Scene awareness:** the read-only `scene_context` snapshot supplies selected part paths, bounds, assigned materials, camera/lens, environment, scene units, and render details to relevant agent workflows. The Studio inspector exposes the same facts on demand; chat and the Detail close-up button can frame exactly one selected part. Chat or the Studio rig target checkbox can scale a preset around one selected part; selected-rig exposure uses its projected bounds when available and reports a whole-product fallback otherwise. Normal presets continue to target the whole product.
- **Materials:** the Material Lab inspects live graphs, copies source materials before edits, imports bounded PBR texture sets, and supports separate bump/normal and geometric displacement paths. Displacement defaults are deliberately small; geometry execution is explicit and guarded.
- **Framing and motion:** full-product and detail framing, live camera controls, camera-motion recipes, reference-video analysis, and frame-by-frame KeyShot video rendering.
- **Scene staging:** bounded object inventory, transforms, independent copies, simple set pieces, and session-local undo.

The current feature and evidence inventory is in [the full audit](docs/FEATURE_AUDIT_AND_KEYSHOT_CONTEXT.md). See the [lighting and mood research](docs/LIGHTING_AND_MOOD_DEEP_DIVE.md), [materials and displacement research](docs/MATERIALS_AND_DISPLACEMENT_DEEP_DIVE.md), and [photo workflow](docs/PHOTO_WORKFLOW.md) for details and limits.

## Next: make lighting more scene-aware

1. **Verify the context view in a live scene.** Confirm that selection, part path, material, units, camera, and environment remain accurate after normal user changes. Keep inspection manual and bounded so it does not interrupt KeyShot.
2. **Validate selected-target lighting.** The code now accepts an explicit selected-part target, uses its measured bounds for rig scale/aim and approximate projected-region exposure metering, and retains that target for edits within the current Director session. Compare the live close-up and full-product render before claiming improved lighting. Ask for a semantic label when the CAD name is opaque; do not infer buttons, bevels, logos, or grips from bounds alone.
3. **Refine from diagnostic evidence.** Use product-masked Direct, Reflection, and Shadow evidence to distinguish illumination, highlight shape, and softness. Compare same-look repeats to account for render noise; do not score pixels outside a reliable product mask.
4. **Build material-aware recipes from controlled comparisons.** Compare representative reflective metal, glossy polymer, matte polymer, and transparent materials at full-product and close-up scales. Record what generalizes and what remains scene-specific.
5. **Improve reference interpretation.** Keep key direction, source size, fill, environment brightness, shadow character, color, and camera crop as separate decisions. Report uncertainty when the reference background or product mask is ambiguous.

## Then: broaden reliable scene understanding

- Use existing render layers and user-confirmed aliases to connect a visual region to a named part. Clown colors can help mask material regions but are not object IDs.
- Add on-demand material-graph and texture-mapping summaries for the selected part, including map role, bit depth, scale, and displacement-to-Geometry path where those values are exposed.
- Calibrate displacement on representative assets with the user's Advanced Plastic and Realistic Plastic graphs. Keep map, bump, and geometric relief roles distinct, preserve original files, and require explicit execution.
- Expand lighting presets only when controlled render evidence explains why they work. Keep shot scale, mood, source type, and material response as separate recipe axes.

## Boundaries

- A scene tree, node name, material, and bounding box do not reveal the semantic identity or surface normal of a button, bevel, logo, or grip.
- KeyShot scripting operations run on the application thread. Long renders, repeated captures, other scripts, or dialogs can interrupt the user's work; prefer one bounded operation and explicit refreshes.
- Director does not save the user's scene. The user reviews and saves results in KeyShot.
- Native per-part Light Layers, arbitrary hidden APIs, and editable native timeline animation are not claimed unless a supported operation is proven on the installed KeyShot build.
- Reference recreation is an evidence-guided approximation; exact scene reconstruction from a photograph is not promised.
- The local-network app is intended for a trusted network and has no multi-user authentication. Provider requests should receive only the scene context needed for the task.

## Final distribution step

After the audit and implementation pass is complete, create a one-click desktop launcher, perform the final source and package review, and then publish the completed update to GitHub.
