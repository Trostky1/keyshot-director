# Reference-photo lighting

Open KeyShot Director at `http://localhost:8787`. With the product open and bridge connected:

1. Set a starting angle that shows the product as intended.
2. Choose/drop a PNG, JPG or WebP reference in **Your product. A new light.**
3. Describe what to borrow: highlight shapes, shadow depth, light softness, warmth or background tone.
4. Leave **Match framing too** off to preserve the current view. Enable it for approximate hero/detail composition based on the product's bounding box.
5. Choose **Quick first look** for one visual plan, or **Plan + visual refinement** for an additional comparison against an actual KeyShot render.
6. Select **Match this look**, then inspect before/after renders and **Lighting decisions & limits**. Fine-tune lights or use chat.
7. **Undo look** restores the last pre-match lights, environment and native camera checkpoint. **Stop & restore** waits for the current native operation, then restores rather than leaving a partial rig.

## Framing and environment

**Compose the still** offers full-product fit, centered detail and upper detail, retaining the angle. Detail deliberately crops the full product; it is not selected-part understanding. Output shapes are landscape, square and portrait. Background color, ground shadows and ground reflections are editable. Chat exposes `frame_product`, `set_environment` and `match_photo` for the same workflow.

## What's saved

Each job writes a uniquely named directory under `references/_photos/` with `reference.png`, `before.png`, `after.png` and `recipe.json`. Originals are never overwritten. The exported recipe is an inspectable lighting plan, not a native KeyShot scene or a one-click import in this iteration. Downloads are explicitly preview quality. Use KeyShot for final-resolution stills, image-style adjustments and scene saving.

Original light nodes and materials stay in the scene, temporarily hidden. A `CC_Photo_…` environment and `CC_Photo_Before_…` rollback camera are created intentionally; previews do not create cameras. These checkpoints stay available in the open scene. Repeated matches can accumulate hidden lights/checkpoints; cleanup is not automatic because ownership cannot safely be inferred from old names. Undo/job state is in memory, so restart only after stopping/completing a match and restoring if desired. The output files remain after restart.

## Limits and privacy

- The reference and current preview are analyzed by the AI provider selected in Settings; they are also stored locally. No secret API keys are included in prompts.
- Light placement uses product bounds and the camera frame. It does not identify individual parts, edit materials, infer a full textured set or reconstruct an HDRI from a photograph.
- Preview noise and different materials can obscure highlight comparisons. The refinement pass is a bounded visual correction, not a guaranteed numerical improvement.
- A failed vision request does not silently switch to a made-up match. A failed refinement retains the first complete plan and reports that limitation.
- KeyShot requires positive environment brightness. Requests for zero use `0.000001`, effectively black. Isolated matching environments preserve the original environment without rewriting it on undo.
- The default camera setter is direction-then-position: position-last avoids the eye drift observed in this 2026.2 scene. Native rollback cameras protect undo independently of that setter order.
- A native render already running inside KeyShot cannot safely be interrupted. Cancellation stops future steps and restores once that operation returns.
- The HTTP server still supports trusted LAN/phone use. Cross-site POSTs are rejected, but this is not an authenticated multi-user service; do not expose it to the internet.

## Verification

`node --test tools/test_photo.js` checks bounded plans, framing, malformed PNGs, outputs, undo, rollback, cancellation, refinement failure and busy jobs with isolated fixtures.

`node tools/test_http_safety.js` checks a running server with intentionally invalid requests; it does not change the scene.

`node tools/test_photo_live.js` is an explicitly opt-in live integration check: capture its own reference, run signed-in Codex vision, build native lights, render, then undo and compare original light/environment/camera state. Add `--refined` to test two vision passes. This is a plumbing/restoration check on the phone scene, not evidence that arbitrary references match perfectly.
