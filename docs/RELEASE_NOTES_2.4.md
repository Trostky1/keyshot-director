# KeyShot Director 2.4.0

KeyShot Director 2.4 adds a folder-based texture import for Material Lab, and the offline groundwork and first milestone for reference-lighting and scene reconstruction.

**Verification status.** The 2.4 lighting and reconstruction features were built and tested offline against a synthetic renderer and fixtures. None of them has been run against a live KeyShot scene, and no result makes a claim about KeyShot output. Review the open experiments in the [capability and evidence record](LIGHTING_CAPABILITY_RECORD.md) and the live runbook in [Reconstruction milestone 1](RECONSTRUCTION_MILESTONE_1.md) before relying on them.

## Material Lab

- Import a downloaded Poliigon folder, either one asset or a parent folder of several. Director keeps one preferred resolution per asset and creates one texture set per asset.
- Choose the exact Base Color, Roughness, Normal or Bump, and AO files before you build. The server validates the selection.
- Set a texture tile size from 1 to 2000 mm (default 41 mm). The value is passed to the KeyShot bridge.
- Each successful build writes a JSON receipt under `materials/build-receipts/`.
- A saved-only image shape preference was added to the UI. Image generation is not included.
- There is no Poliigon API connection.

## Reference lighting (offline groundwork)

- IES fix at source level: a planner `gain` now folds into the native multiplier instead of being shadowed by a default `multiplier: 1`.
- `power_mode` is `artistic` (default) or `physical` (fixed flux) and is recorded in every recipe.
- A photo plan can aim each light with `target_offset` and set Area-light visibility.
- Persistent job receipts and a recovery API (`GET` and `POST /api/photo/recovery`). An unfinished job blocks a new one, and restore needs the same scene identity.
- A shared reference and render mask, and a display and linear colour contract.
- Experimental camera alignment, multi-component objectives, derivative-free search and a synthetic-renderer harness. See [Reference-lighting groundwork](RELEASE_NOTES_REFERENCE_LIGHTING.md).

## Scene reconstruction, milestone 1

- `POST /api/reconstruct` runs one bounded session: baseline, camera lock and verify, a fit of one or two Area lights, a residual diagnosis as advice, before and after images, receipts, undo and recovery. Materials stay locked. There is no UI panel yet.
- A `scene_save` bridge operation saves a KSP or BIP file to a new path only. It is never automatic.
- Director does not report a match percentage and does not claim arbitrary 1:1 photograph matching. See [Reconstruction milestone 1](RECONSTRUCTION_MILESTONE_1.md).

## Known limits

- Windows 11 with KeyShot Studio 2026.2 is the verified platform. Physical macOS integration remains unverified.
- `lux.saveFile` and `lux.savePackage` are documented API only and are unverified in KeyShot.
- The new material file selection, tile size and build receipts have not been run in a real KeyShot build.
