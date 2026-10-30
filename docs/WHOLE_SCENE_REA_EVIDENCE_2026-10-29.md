# Whole-scene reconstruction: installed-artifact evidence

Date: October 29, 2026. Research only; no KeyShot scene operations executed.

## REA inspection

Tool: `inspect_pe_resources`.

- Evidence ID: `ev_5a7095a1c73211e0d49bdfa7ac372c78de8ceb417806948f43e60ea86bc642be`.
- Target: `C:\Users\bentr\AppData\Local\Programs\KeyShot Studio\bin\kscripting.dll`.
- SHA-256: `717834dc1546c216838a8e773b65c76e9f198a349181ad60dd8db5d8a6f68dfe`.
- Size: 1,512,816 bytes.
- Coverage: complete bounded PE resource inventory, three examined directory entries, one resource.
- Authority: shipped artifact. This verifies identity/resource structure, not execution or scripting behavior.
- Limitations: opaque resource payloads other than group icons; no runtime observation, semantic decompilation or API invocation.

The digest matches the historical scripting artifact reported in `LIGHTING_AND_MOOD_DEEP_DIVE.md` around line 469. That document records Ghidra evidence for graph-node construction and typed parameter setters. Matching bytes supports applicability of that historical static analysis; the historical evidence was not replayed here and does not prove native behavior.

REA session inspection found no open target and no retained evidence before this new inspection. Ghidra was available. Native macOS observation tools were unavailable on this Windows host. No analysis session was opened, no binary was patched, and no installation was performed.

## Installed command catalog

Read and parsed `C:\Users\bentr\AppData\Local\Programs\KeyShot Studio\bin\keyshot_commands.json`.

SHA-256: `0f4e06326f6b81803482622b51ab712e888b42e98f544e69d050d2abad57bab5`.

The catalog contains 39 operations. Families include scene, files, cameras, materials, rendering, studios, environments, image styles and realtime screenshots. It exposes `save_file` with a required path. It does not list `save_package` or a dedicated light-control family. `set_environment` takes a name rather than light intensity or rotation. `get_image_style_settings` and `set_image_style_settings` are listed.

These are catalog declarations, not newly verified server behavior. Absence from this catalog does not establish absence from KeyShot's Python API or internal implementation.

## Public API corroboration

The [official 2026.1 lux reference](https://media.keyshot.com/scripting/doc/2026.1/lux.html) documents `saveFile` and `savePackage`, including exclusion flags. The [2026 File manual](https://manuals.keyshot.com/kss2026/en-us/manual/main-menu_file.html) describes BIP scene saving and KSP resource packaging. Together they establish a documented native-delivery route worth testing, not an already verified Director integration or cross-machine round trip.

Recommended next proof: in a separately authorized disposable scene, save to new BIP/KSP paths, reopen the package in isolation, verify scene inventory/materials/cameras/environment/animation and render a matched frame. Do not use reopening as recovery for unsaved user work.
