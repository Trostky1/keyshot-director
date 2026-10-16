# Material recipe core

`server/material-core.js` validates imported texture-set names, channel roles, and conflicts, then builds the small recipe used by the KeyShot bridge. It runs in Node and ships as ordinary JavaScript. Installing and packaging KeyShot Director do not require Rust, Cargo, a WebAssembly target, or a generated compiler file.

The current supported graph is one Plastic surface. Advanced graphs, metallic layering, procedural relief, and geometry displacement are paused.

| Texture role | Handling | KeyShot connection |
| --- | --- | --- |
| Base Color | sRGB color | Texture Map → Plastic Diffuse |
| Roughness | Linear scalar | Texture Map → Color To Number → Plastic Roughness |
| Normal | Linear vector | Texture Map → Plastic Bump |
| Bump | Linear scalar | Texture Map → Plastic Bump (used when no Normal map is selected) |
| AO | Optional linear scalar; requires Base Color | Texture Map → Color Composite Multiply with Base Color → Plastic Diffuse |
| Metallic, Displacement, and other channels | Reported as skipped | Not connected in the current workflow |

The planner selects one file per supported role. When both Normal and Bump are present, Normal wins. Additional conflicting files, unsupported maps, and absent MaterialX-referenced files are reported. AO without Base Color is skipped; if no usable map remains, the planner returns a clear error.

The live graph is created by `bridge/cc_materials.py`. New materials stay unassigned until the user drags them onto a part in KeyShot. Source maps are left unchanged. Map textures use KeyShot's direct physical-size mapping controls; the current default tile size is 41 mm and still needs visual checks against the target model. Base Color enables sRGB, while data maps disable texture profiles. The bridge creates one Plastic surface and only the utility nodes required by selected maps.

## Legacy compiler prototype

`material-core/` contains an earlier Rust/WebAssembly implementation retained for reference. The application and release package no longer load or build it. Changes to supported recipe behavior belong in `server/material-core.js` and its offline tests.

## Verification boundary

Offline tests validate recipe selection and mock graph wiring. They do not prove that every map decodes with the intended color transfer or that KeyShot renders the same result across GPUs and model UV layouts. KeyShot Studio 2026.2 is the current target; live material creation, color-space readback, KMP export, and import on another computer remain integration checks.
