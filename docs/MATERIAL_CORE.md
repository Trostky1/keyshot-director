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

The table records intended source semantics; it does not mean KeyShot's current Texture Map path has been verified to honor those semantics for every channel.

The live KeyShot graph is created by `bridge/cc_materials.py`. It verifies imported-file paths, creates a new Director-owned material, and keeps it unassigned. The Rust plan describes the intended graph; it does not call KeyShot or infer unsupported sockets. AO and displacement are included by default when their maps exist. Geometric displacement defaults to 0.01 mm and is limited to 0.001–0.1 mm. On the calibrated synthetic fixture, native resolution values 0.0002 and 0.0004 produced 822,656 and 413,056 total scene triangles respectively, with the same height bounds; this does not establish a universal tessellation density. The 2026.2 live test also found that assigning a displacement material already reevaluated the mesh before `MaterialGraph.executeGeometryNodes()` was called. That explicit, material-scoped call succeeded but did not change the tested bounds or triangle count. The test's 16-bit scalar maps followed an x² input transfer, so `offset=0.5` did not make a stored 0.5 pixel flat; do not treat it as a source-file-independent neutral value. See [MATERIAL_CALIBRATION_RESULTS.md](MATERIAL_CALIBRATION_RESULTS.md). The bridge still verifies one visible, unlocked part and refuses shared assignments because the API is graph-scoped. Surface bump and root Label bump/opacity remain separate from geometry displacement.

## Rebuilding

Install Rust stable, then add the WebAssembly target once:

```powershell
rustup target add wasm32-unknown-unknown
.\material-core\build.ps1
```

On macOS or Linux, use `rustup target add wasm32-unknown-unknown` followed by `sh material-core/build.sh`. The build writes `server/material-core.wasm`, which the Node app loads on demand. Release packaging runs this build automatically and includes the generated module, so users of the packaged app do not need Rust installed.

## Next material research steps

The disposable calibration verified Texture Map mapping value 4 against authored UVs on the test plane and cylinder. It also confirmed Texture Map parameters for U/V scale, U/V shift, angle, texture space, repeats, and mapping/scale enums. Scale mode 2 displayed Width/Height; doubling a scale doubled repeats, a 0.5 shift moved half a UV tile, and 90 degrees rotated the pattern. The meanings of remaining enums, physical-size metadata, and reliable mapping on meshes without UVs remain open. Higher-priority work is a verified data-linearization path for Roughness and Displacement, followed by per-map mapping controls, Specular, AO strength, ORM splitting, and broader MaterialX hints. Continue to use importer bit depth and source metadata; a filename alone does not prove the runtime's decoded value.
