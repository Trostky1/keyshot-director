# Reference-photo lighting

> Capability statements in this file are partly historical. The current per-control evidence labels are in [Lighting capability and evidence record](LIGHTING_CAPABILITY_RECORD.md), and the acceptance loop is described in [Measured refinement](MEASURED_REFINEMENT.md).

Open KeyShot Director at `http://localhost:8787`. With the product open and bridge connected:

1. Set a starting angle that shows the product as intended.
2. Choose/drop a PNG, JPG or WebP reference in **Your product. A new light.**
3. Describe what to borrow: highlight shapes, shadow depth, light softness, warmth or background tone.
4. Leave **Match framing too** off to preserve the current view. Enable it for approximate hero/detail composition based on the product's bounding box.
5. Choose **Quick first look** for one visual plan, or leave **Visual refinement** selected for a same-look noise sample, one comparison against a KeyShot render plus product-masked lighting diagnostics, and one final comparison after refinement.
6. Select **Match this look**, then inspect before/after renders and **Lighting decisions & limits**. Fine-tune lights or use chat.
7. **Undo look** restores the last pre-match lights, environment and native camera checkpoint. **Stop & restore** waits for the current native operation, then restores rather than leaving a partial rig.

## Framing and environment

**Compose the still** offers full-product fit, centered detail and upper detail, retaining the angle. The Detail close-up action and chat can use exactly one selected node's bounds to fit the camera to that part; this is spatial framing, not semantic feature recognition. An explicit selected-part lighting request or the Studio rig target checkbox can scale a standard rig to the same bounds. Auto exposure meters an approximate projected bounds region when possible and states when it falls back to whole-product metering; environment fill remains global. Reference-photo matching can also scale sources to the visible camera crop. Output shapes are landscape, square and portrait. Background color, ground shadows and ground reflections are editable. Chat exposes `frame_product`, `set_environment` and `match_photo` for the same workflow.

## What's saved

Each job writes a uniquely named directory under `references/_photos/` with `reference.png`, `before.png`, `after.png` and `recipe.json`. A refined match also stores compact Clown-aligned Direct, Reflection and Shadow measurements in the recipe. The first diagnostic capture supports the visual refinement prompt; an immediate same-look repeat estimates render noise; the final capture compares the refined lighting against the first plan. Full pass records and images remain in the local lighting-lab folder. Originals are never overwritten. The exported recipe is an inspectable lighting plan and evidence summary, not a native KeyShot scene or a one-click import in this iteration. Downloads are explicitly preview quality. Use KeyShot for final-resolution stills, image-style adjustments and scene saving.

Original light nodes and materials stay in the scene, temporarily hidden. A `CC_Photo_…` environment and `CC_Photo_Before_…` rollback camera are created intentionally; previews do not create cameras. These checkpoints stay available in the open scene. Repeated matches can accumulate hidden lights/checkpoints; cleanup is not automatic because ownership cannot safely be inferred from old names. Undo/job state is in memory, so restart only after stopping/completing a match and restoring if desired. The output files remain after restart.

## Limits and privacy

- The reference and current preview are analyzed by the AI provider selected in Settings; they are also stored locally. Compact linear lighting measurements and same-look repeat-noise metrics may be included in the refinement prompt. Full diagnostic passes stay local. No secret API keys are included in prompts.
- Light placement uses product bounds and the camera frame. It does not identify individual parts, edit materials, infer a full textured set or reconstruct an HDRI from a photograph.
- Preview noise and different materials can obscure highlight comparisons. The refinement pass compares lighting-pass measurements with a same-look repeat, but it does not optimize a numeric reference-image score or guarantee improvement.
- Clown labels distinguish rendered object regions by color and position; they do not identify semantic parts such as a button, bevel or logo.
- A failed vision request does not silently switch to a made-up match. A failed refinement retains the first complete plan and reports that limitation.
- KeyShot requires positive environment brightness. Requests for zero use `0.000001`, effectively black. Isolated matching environments preserve the original environment without rewriting it on undo.
- The default camera setter is direction-then-position: position-last avoids the eye drift observed in this 2026.2 scene. Native rollback cameras protect undo independently of that setter order.
- A native render already running inside KeyShot cannot safely be interrupted. Cancellation stops future steps and restores once that operation returns.
- The HTTP server still supports trusted LAN/phone use. Cross-site POSTs are rejected, but this is not an authenticated multi-user service; do not expose it to the internet.

## Verification

`node --test tools/test_photo.js` checks bounded plans, framing, malformed PNGs, outputs, undo, rollback, cancellation, refinement failure and busy jobs with isolated fixtures.

`node tools/test_http_safety.js` checks a running server with intentionally invalid requests; it does not change the scene.

`node tools/test_photo_live.js` is an explicitly opt-in live integration check: capture its own reference, run signed-in Codex vision, build native lights, render, then undo and compare original light/environment/camera state. Add `--refined` to test two vision passes. This is a plumbing/restoration check on the phone scene, not evidence that arbitrary references match perfectly.
# Working-checkout update

The current source adds bounded measured candidates, explicit reference-region/objective controls, consistent capture aspect, compatibility checks and best-result retention. See [Measured refinement](MEASURED_REFINEMENT.md) for the current contract and local-verification limits. Any older single-refinement behavior described below is historical.
