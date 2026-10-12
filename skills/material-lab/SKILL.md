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
5. Turn the request into an achievable specification before acting. For a requested variation of a KeyShot library material, use the Material Lab copy workflow when the user has selected a source and target part. Otherwise default to a new reusable material.

## Current Director capability

- Existing material graphs can be inspected. Existing scene materials stay read-only until the user explicitly enables edits for that selected material in the Inspector. A library material can instead be copied unlinked onto the selected part(s); that new copy is editable and the library source remains unchanged. Only edit the exact authorized copy, using exposed numeric, boolean or color values; do not alter graph structure or connected texture inputs.
- A plain starter material is an unassigned KeyShot Diffuse material, named `Director <descriptive finish>`. When built from actual imported texture channels, the bridge upgrades the fresh Diffuse root to Plastic before connecting maps.
- Inspect the graph and current node IDs before editing. The setter changes concrete numeric, boolean or color-array parameters on Director-created materials, the exact authorized library copy, and the single scene material explicitly unlocked by the user. Prefer relevant exposed values such as roughness or specular strength; do not invent unsupported node inputs.
- Existing connected shader inputs and file-backed texture parameters stay read-only. A separate texture-set converter can build a NEW unassigned Plastic material; do not use it to alter an existing scene material.
- Explain that color and roughness are visual estimates from the reference. A newly created starter is unassigned; a library-material copy is applied only to the explicitly selected part(s).
- When the user asks for a new or tuned material as the result, save the finished Director material to KeyShot's material library and export a KMP package automatically. Report the package path; the Material Lab assets shelf exposes download and show-folder actions. Library-material copies are separate from their source entries.
- Use the one-step material undo after an edit when needed.
- Texture sets are imported separately from reference photos. Originals are retained unchanged under `materials/texture-sets/`; filename-based role labels are hints. The converter supports Base Color, Roughness/Glossiness, Specular, Normal/Bump, optional Displacement, and layered Metalness. It uses a shared Mapping 2D node, saves a KMP to KeyShot's library and the project materials folder, and applies it to selected geometry. AO and arbitrary MaterialX graphs are not converted. An uploaded MaterialX file is parsed only for readable channel hints, never executed as code or treated as a native KeyShot material.
- Each texture set supports up to 32 source files, 128 MB per file, and 512 MB total. Never edit, recompress or overwrite the user's originals. Imported sets are visible in Material Lab with an **Open this set** action.

## Boundaries and next implementation targets

Director does not edit connected maps on an existing material or on a copied library material, and does not alter their graph structure. For unsupported channels, report that they were skipped; do not imply they affected the output. KeyShot's documented native material importer does not list MaterialX.

The library copy action must always use KeyShot's unlinked-copy behavior and only the explicitly selected geometry. Never infer that an existing material is unshared from its name. For unsupported maps, validate each node type/socket on an isolated Director-created material before enabling a channel.

## Reference documentation

- KeyShot 2026 Material Graph Nodes: https://manuals.keyshot.com/kss2026/en-us/manual/material-graph-nodes.html
- KeyShot 2026 Material Node Types: https://manuals.keyshot.com/kss2026/en-us/manual/material-node-types.html
- KeyShot 2026 Material Graph UI: https://manuals.keyshot.com/kss2026/en-us/manual/material-graph-user-interface.html
- KeyShot 2026 scripting console coverage: https://manuals.keyshot.com/kss2026/en-us/manual/scripting-console.html
