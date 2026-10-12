---
name: director-reference-video
description: Analyze product-render reference clips into an honest, product-relative KeyShot lighting and camera plan that Director can preview and render.
---

# Reference video workflow

Use this playbook when analyzing a product animation or commercial clip. The app samples frames with timestamps and rough silhouette measurements, then turns the plan into a KeyShot camera recipe.

## Analyze before planning

1. Review every supplied frame in timestamp order. Identify shot cuts, product orientation changes, camera movement, framing, lighting direction/softness, background and any apparent product motion.
2. Distinguish camera orbit from a turntable/product rotation. If the frames do not disambiguate them, describe the ambiguity and select the camera interpretation only as a preview assumption.
3. Record a small number of meaningful beats: opening hero, transitions, close-up/reveal, and ending hold. Use 2–8 keys for a continuous shot; retain explicit cuts as separate beats. Do not add keys for incidental frame noise.
4. Express camera positions relative to the opening product view: cumulative azimuth, elevation, product frame fill, and image-center offsets. Preserve the clip duration and aspect ratio. Use framing measurements when reliable, but trust the visual evidence when backgrounds or occlusion break the silhouette estimate.
5. Choose a supported Director lighting rig and explain which reference properties lights can approximate. Do not imply that an HDRI, set, moving light, material change, or physical prop was reconstructed.

## What Director can currently execute

- It can preview the resulting camera recipe live, calibrate framing against the user's product with a test render, and render the path frame by frame into a video.
- It can tune a supported still lighting rig toward the sampled clip's lighting profile.
- It does not yet author animated product-part transforms onto KeyShot's native animation timeline. A product spin, exploded sequence, or moving component cannot be claimed as applied by the current camera recipe. Report this clearly and provide a shot plan the user can execute or review.
- Never save the scene automatically. Avoid the native `lux.getAnimations()` and `lux.createAnimation()` calls in this integration; the existing bridge source documents these as crash-prone. Do not experiment with them in the user's live scene.
- If the AI engine is offline, use measured framing and lighting only; do not claim visual interpretation of motion or infer an orbit that was not measured.

## Output quality

Summarize the shot beats, chosen camera interpretation, supported lighting work, and execution limits. Prefer a smooth, legible product reveal over copying every frame. Preserve meaningful pauses; avoid camera paths that pass through the product or jump across cuts as if continuous.

## Reference documentation

- KeyShot 2026 Part Animations: https://manuals.keyshot.com/kss2026/en-us/manual/part-animations.html
- KeyShot 2026 Camera Animations: https://manuals.keyshot.com/kss2026/en-us/manual/camera-animations.html
- KeyShot 2026 Animation Timeline: https://manuals.keyshot.com/kss2026/en-us/manual/animation-timeline.html
- KeyShot 2026 Scripting Console/API coverage: https://manuals.keyshot.com/kss2026/en-us/manual/scripting-console.html
- The timeline supports part transforms/visibility and camera animation nodes; that UI capability does not prove the public scripting API can create them. Verify the exact API before enabling timeline authoring.
