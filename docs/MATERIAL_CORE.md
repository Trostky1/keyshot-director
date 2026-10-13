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

The live KeyShot graph is still created by `bridge/cc_materials.py`. It checks that paths resolve to existing files inside the imported texture-set directory, creates a new Director-owned material, and keeps it unassigned. The Rust plan describes the intended graph and is returned with the build result; it does not call KeyShot or infer unsupported sockets. AO and displacement are included by default when their maps exist, even when source MaterialX strengths are zero; users can explicitly omit either map. Displacement defaults to 0.1 mm, is limited to 0.01–5 mm, and the graph uses a 0.2 mm resolution and a one-million-triangle ceiling. After assigning a displaced material, use KeyShot's Execute Geometry command to see the effect.

## Rebuilding

Install Rust stable, then add the WebAssembly target once:

```powershell
rustup target add wasm32-unknown-unknown
.\material-core\build.ps1
```

On macOS or Linux, use `rustup target add wasm32-unknown-unknown` followed by `sh material-core/build.sh`. The build writes `server/material-core.wasm`, which the Node app loads on demand. Release packaging runs this build automatically and includes the generated module, so users of the packaged app do not need Rust installed.

## Next material research steps

Expand the recipe model only when a representative KeyShot graph has been inspected and the matching operation is supported by the scripting API. Candidate work includes explicit UV and tiling settings, specular model selection, adjustable AO strength, and conversion of Poliigon MaterialX hints. Compare each result against a hand-built KeyShot material on the same asset and record the source maps, node types, socket links, and parameter values. Do not treat a filename role or a MaterialX socket name as proof that KeyShot supports an equivalent connection.
