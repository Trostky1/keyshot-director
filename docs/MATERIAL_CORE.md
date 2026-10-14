# Rust material recipe core

`material-core/` is the typed, renderer-independent layer for turning an imported texture set into a KeyShot graph plan. The Node app passes a material name and the set's relative file names and classified roles to the WebAssembly module. Rust checks the recipe, selects a surface model, chooses one map per supported socket, records color-space intent, and emits a graph description plus skipped-file reasons. A Metallic map selects Generic; otherwise explicit plastic/rubber/resin/vinyl names select Plastic and other PBR texture sets default to Generic.

The first compiler profile is intentionally narrow and evidence-based:

| Texture role | Color space | KeyShot graph connection |
| --- | --- | --- |
| Base Color | sRGB | Texture Map → Diffuse |
| Roughness | Linear | Texture Map → Color To Number → Roughness |
| Normal | Linear | Texture Map → Bump |
| Bump | Linear | Texture Map → Bump, used when no Normal map wins |
| Metallic | Linear | Texture Map → Generic Metallic |
| AO, when present by default | Linear | Texture Map → Color Composite Multiply with Base Color → Diffuse |
| Displacement, when present by default | Linear | Texture Map → Displace → Root Geometry |

The live KeyShot graph is created by `bridge/cc_materials.py`. It verifies that each path resolves to an imported texture file, creates a new Director-owned material, and keeps it unassigned. The Rust plan describes the intended graph and is returned with the build result; it does not call KeyShot or infer unsupported sockets. AO and displacement are included by default when their maps exist, even when source MaterialX strengths are zero; users can explicitly omit either map. Geometric displacement defaults to 0.01 mm and is limited to 0.001–0.1 mm. The graph currently uses a 0.2 mm resolution and a one-million-triangle target; resolution still needs live calibration for fine plastic texture. Recognized Poliigon maps use `offset=0.5` as a reasoned midpoint-neutral starting value; it still needs a controlled render check. After the user assigns the material to one visible, unlocked part, Director can call the installed `MaterialGraph.executeGeometryNodes()` API. The bridge verifies that exactly one Displace node with a connected height input drives the material root's Geometry socket, and refuses shared assignments because KeyShot exposes graph-scoped execution, not object-scoped execution. Surface bump and root Label bump/opacity remain separate from geometry displacement.

## Rebuilding

Install Rust stable, then add the WebAssembly target once:

```powershell
rustup target add wasm32-unknown-unknown
.\material-core\build.ps1
```

On macOS or Linux, use `rustup target add wasm32-unknown-unknown` followed by `sh material-core/build.sh`. The build writes `server/material-core.wasm`, which the Node app loads on demand. Release packaging runs this build automatically and includes the generated module, so users of the packaged app do not need Rust installed.

## Next material research steps

Expand the recipe model only when a representative KeyShot graph has been inspected and the matching operation is supported by the scripting API. REA confirmed that this build's Texture Map parameters include `uv_scale_u/v`, mapping mode, texture space, repeats and shifts; their enum values, physical-unit semantics and stable shared-map behavior are not yet verified. Candidate work includes matched per-map scaling, specular model selection, adjustable AO strength, ORM splitting, and better conversion of Poliigon MaterialX hints. The texture importer stores supported image-header dimensions and bit depth on upload and reads legacy headers on demand; use that metadata to validate map selection before building. Compare each result against a hand-built KeyShot material on the same asset and record the source maps, node types, socket links, and parameter values. Do not treat a filename role or a MaterialX socket name as proof that KeyShot supports an equivalent connection.
