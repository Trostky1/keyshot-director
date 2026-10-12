---
name: director-material-lab
description: Interpret a material reference and create or tune a reusable KeyShot starting material using Director's currently supported material graph tools.
---

# Material Lab workflow

Use this playbook for reference-photo-to-material requests and material questions in the dedicated Material Lab.

## Read the reference

1. The user may attach up to 8 reference images. Treat them as one evidence pack for the current prompt: compare cues across all images, identify agreement/conflict, and synthesize a consistent target rather than treating each image as a separate request.
2. Distinguish image roles when possible: different angles corroborate a finish, close-ups reveal texture scale and direction, and map sheets may encode base color/albedo, roughness, bump/height, normal or specular. Do not assume a photo is a map (or a map is a photo) without evidence; describe uncertain roles as hypotheses.
3. Separate visible surface cues from lighting and environment cues. Describe base hue, value, gloss/roughness, apparent texture scale, directionality, transparency, metallic response and edge behavior only when visible. A bright highlight does not uniquely reveal roughness; warm illumination does not prove a warm base color. State uncertainty briefly when it matters.
4. The reference pack is transient context for this prompt, not a persistent training dataset. Do not imply it trains or fine-tunes the model.
5. Turn the request into an achievable specification before acting. Ask one concise question only if the selected part versus reusable library material materially changes the requested result. Otherwise default to a new reusable, unassigned material.

## Current Director capability

- Existing material graphs can be inspected. Existing scene materials stay read-only until the user explicitly enables edits for that selected material in the Inspector. This is a live edit to the real scene material and can affect every object that shares it; do not edit other materials or graph structure.
- A plain starter material is an unassigned KeyShot Diffuse material, named `Director <descriptive finish>`. When built from actual imported texture channels, the bridge upgrades the fresh Diffuse root to Plastic before connecting maps.
- Inspect the graph and current node IDs before editing. The setter changes concrete numeric, boolean or color-array parameters on Director-created materials and on the single scene material explicitly unlocked by the user. Prefer relevant exposed values such as roughness or specular strength; do not invent unsupported node inputs.
- Existing connected shader inputs and file-backed texture parameters stay read-only. A separate texture-set converter can build a NEW unassigned Plastic material; do not use it to alter an existing scene material.
- Explain that color and roughness are visual estimates from the reference, and the material is not assigned to the product. The user can drag it onto chosen parts in KeyShot.
- When the user asks for a new/tuned material as the result, save the finished Director material to KeyShot's material library and export a KMP package automatically. Report the package path; the Material Lab assets shelf exposes download and show-folder actions. The material remains unassigned, so the artist can drag it onto chosen parts in KeyShot.
- Use the one-step material undo after an edit when needed.
- Texture sets can be imported separately from reference photos. Originals are retained unchanged under `materials/texture-sets/`; filename-based role labels are hints. The live-verified KeyShot 2026.2 converter wires Base Color → Plastic Diffuse, Roughness → Color To Number → Plastic Roughness, and Normal (or Bump fallback) → Plastic Bump. It exports the new material to KeyShot's library and a `.kmp` package; verified KMP contents include the three connected image maps. The material remains unassigned. Specular, Metallic, AO, displacement and arbitrary MaterialX nodes are not wired by this converter. An uploaded MaterialX file is parsed only for channel-connection and strength hints, never executed as code or treated as a native KeyShot material.
- Before using `material/texture-file`, keep each source at or below 11 MB and each set at or below 80 MB. Never edit, recompress or overwrite the user's originals. Imported sets are visible in Material Lab with an **Open this set** action.

## Boundaries and next implementation targets

Director does not edit connected maps on an existing material, nor currently wire Specular, Metallic, AO, Displacement, layered, glass, label or arbitrary MaterialX nodes. For unsupported channels, report that they were skipped; do not imply they affected the output. KeyShot's documented native material importer does not list MaterialX.

Do not add an apply-to-selected-parts action without first verifying its scene-node/material-sharing behavior and adding explicit confirmation. Never infer that a material is unshared from its name. For unsupported maps, validate each node type/socket on an isolated Director-created material before enabling a channel.

## Reference documentation

- KeyShot 2026 Material Graph Nodes: https://manuals.keyshot.com/kss2026/en-us/manual/material-graph-nodes.html
- KeyShot 2026 Material Node Types: https://manuals.keyshot.com/kss2026/en-us/manual/material-node-types.html
- KeyShot 2026 Material Graph UI: https://manuals.keyshot.com/kss2026/en-us/manual/material-graph-user-interface.html
- KeyShot 2026 scripting console coverage: https://manuals.keyshot.com/kss2026/en-us/manual/scripting-console.html
