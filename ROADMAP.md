# KeyShot Director - roadmap

> Next big item: native timeline animation via animated glTF import. See `GLTF_ROUTE_BRIEF.md` (rough brief + experiments, written to hand to a planning model).

Goal: an app on the second monitor / phone that drives the user's open KeyShot, so an AI (Claude) can create and execute camera moves, lighting, part motion and whole shots from plain language and from a reference image or video - "Vizcom for KeyShot animation".

## Where we are (done)
- In-KeyShot bridge (message-pumped loop, hot-reloaded ops) + Node server + web UI (live preview, sliders, presets, saved views, JSON shot recipe, QR for phone).
- Proven: exact 360 orbit, real-time shot playback (viewport ~4-6 fps), safe camera reset, live viewport screenshots.

## PRIORITY CHANGE (user): lighting is the most important part - "take the headache out of professional studio-grade lighting". Camera/animation is easier for the AI. Lighting engine goes right after Phase 2.

## Lighting engine - proven by spike (Oct 8)
- Softbox = imported flat OBJ plane (bridge/assets/cc_light_panel.obj, 100x100 mm, +Z normal) + library material "Area Light 1200 Lumen Neutral" (setObjectMaterial by object ID; the library material gets copied into the scene as "... #1"). Placed with node.applyTransform(M, absolute=True) on the OBJECT node (find(name=..., types=lux.NODE_TYPE_OBJECT)) - the group node refuses absolute transforms. Orientation via luxmath rotateAroundAxis(cross(+Z, dir), angle). Placement read back exactly.
- Import defaults MUST be overridden or KeyShot moves the camera/environment: adjust_camera_look_at, adjust_environment, camera_import, center_geometry, snap_to_ground = False; geometry_units=1000 (mm scene).
- Environments: lux.newEnvironment(name, activate, clone) + Env.setLightingEnvironment(path) / setBrightness / setRotation / setBackgroundColor / ground shadows. Library has 32 studio HDRIs (3 Point, Light Tent, Overhead/Side Panels, Zebra Stripes, gradients) + 65 total.
- Library light materials (77): Area Light 1200 Lumen Cool/Neutral/Warm/White, Emissive *, Point Light *, Spotlight 15-120 deg, fixtures. Light presets: Performance Mode, Basic, Product, Interior, Jewelry. Image style: bloom, vignette, curve (photographic only), denoise.
- Cleanup is clean: delete our nodes (find by name, node.delete()), setActiveEnvironment back, removeEnvironment, deleteMaterial. Leaves one blank "" scene-material entry and the deleted object ID in getObjects().
- Next: rig engine (named lights in spherical coords around the subject bbox: softbox/strip/spot/rim/kicker/flag), rig presets (hero soft 3-point, dark moody single softbox, high-key, edge/rim for glass, e-commerce), light registry + non-destructive group, UI panel, AI-callable API.

## Phase 2 - direct manipulation (like the friend's app)  [DONE: drag orbit / wheel zoom / right-drag pan / touch / record / smooth / replay]
- Drag/scroll/pinch in the app viewport = orbit / pan / zoom the KeyShot camera.
- Record the motion into a shot recipe (path capture), then smooth, retime, ease, replay.
- Problem: KeyShot setters cost 100-250ms, so dragging would lag. Fix: export the product to glTF (lux.exportFile EXPORT_GLTF) and show a WebGL proxy in the app. The proxy responds instantly and records at full rate; KeyShot follows at its own pace; final output is rendered offline at exact time steps.
- Later: phone gyro (DeviceOrientation) for the AR-style hand-held feel (needs HTTPS on the phone).

## Phase 3 - render pipeline
- Shot recipe -> frames at fixed time steps (renderImage / renderFrames) -> video (encodeVideo). Resolution, fps, quality presets, queue.
- Probe createAnimation (editable KeyShot timeline animations) - never call lux.getAnimations (native crash on this scene).

## Phase 4 - knowledge layer from the professor's Render Guide (https://www.subinay.com/render-toolkit)
- Nine standard angles (Hero 3/4, front elevation, profile, high 3/4, top-down, low hero, rear 3/4, macro...) as shot presets; azimuth/inclination/twist/focal length/framing/shift X-Y, matching his "Copy shot recipe" fields (add twist/roll, focal length, shift to our recipe).
- Lens rules: 70-135mm for product; 24-35mm only for drama/scale; 200mm+/ortho for elevations and spec views; change focal length and distance together to keep framing; hero near 30-40 deg azimuth, camera slightly above midline; keep height and lens consistent across a set.
- Sequence: establish, explain, prove, close. Proof shots: macros, exploded/ghosted, colorway lineups. Plan negative space for type; treat the logo as a material.
- Lighting: same product + camera under different environments; light must suit the material (metal vs plastic vs fabric).
- Use as principles for the AI; ask the professor before redistributing his data.

## Phase 5 - scene control (beyond the camera)
- Bridge ops for environments (HDRI, rotation, brightness, ground, backdrop color), lighting presets, material swaps, part show/hide/move/scale (exploded views), model sets, image styles.
- describe_scene so the AI knows the product parts and materials.

## Phase 6 - reference ingestion (the Vizcom part)
- Image first: estimate camera angle/lens/framing, light direction + softness + contrast, background, mood -> pick HDRI/rotation/brightness, materials, framing.
- Video: cut detection, per-shot move classification (orbit, push-in, crane, whip), timing/easing, speed ramps -> recipe. Camera-solve (COLMAP/DPVO style) only as an optional upgrade; clean product renders track poorly.
- Honest limit: exact lighting/material match from a picture is approximate.

## Phase 7 - closed loop
- Execute -> screenshot -> a vision model compares to the reference -> adjust -> repeat. Screenshot is ~55ms, so iteration is cheap. This loop is what makes results converge.

## Phase 8 - polish
- Proper packaged KeyShot script, one-click bridge launch, shot library, shareable recipes, multi-product support.

## Standing risks
- KeyShot main-thread scripting: don't run other scripts / open dialogs while the bridge runs; always save first.
- No headless on this license; live GUI only.
- Camera setters are slow; viewport preview is low fps.
- Friend's code (when it arrives) may show a faster/safer mechanism.
