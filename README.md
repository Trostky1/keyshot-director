# KeyShot Director

Scene staging is available through the existing AI prompt box: whole-product movement,
center-based rotation/scale, linked-material copies, physical pedestal/floor/backdrop
geometry and session-scoped undo. See [the staging guide](docs/SCENE_STAGING.md) for
examples, limits and the CLI tool contract.

A photo-first companion app for **KeyShot** that lights and frames *your own product*. Choose a reference photograph and borrow its light direction, softness, reflections and background tone through custom product-scaled lights, actual KeyShot previews and an optional visual refinement. Compare before/after and undo the look without changing product materials. Animation/video matching, preset rigs, plain-language prompts and second-monitor/phone control remain available.

It does not replace KeyShot: final material assignment, the timeline, scene saving and final-resolution rendering stay in KeyShot. Reference matching is photographic inference, not exact scene reconstruction. Physical sets/backplates and material differences are reported as limitations. See the [lighting and mood deep dive](docs/LIGHTING_AND_MOOD_DEEP_DIVE.md), [photo workflow and verification guide](docs/PHOTO_WORKFLOW.md), and [Poliigon-to-KeyShot texture workflow](docs/POLIIGON_TEXTURE_WORKFLOW.md).

> Early access. Verified on KeyShot Studio 2026.2 (EDU) on Windows 11. macOS support is included and needs first-run testing on a Mac; see [macOS setup](#macos-setup-and-first-run). Not affiliated with KeyShot / Luxion.

## What you need
- Windows or macOS supported by your KeyShot Studio release, **KeyShot Studio 2026.x** with the Scripting feature available in your license. The scripting console is required; headless scripting is not.
- **Node.js 20+** (https://nodejs.org, LTS)
- A browser. Reference-photo matching needs a signed-in **Codex CLI**, signed-in Claude Code CLI or Anthropic API key. Basic preset controls also work offline. Select the provider in Settings.

## First run on Windows
1. Download the [latest release ZIP](https://github.com/Trostky1/keyshot-director/releases/latest) and extract the whole folder somewhere permanent, such as Documents. Do not run it from inside the ZIP or move it after setup.
2. Double-click **Install KeyShot Director.bat**. It installs the KeyShot script and creates a **KeyShot Director** desktop shortcut. It does not need administrator access. If Node.js is missing, the installer opens the official download page and tells you what to do next.
3. Double-click the desktop shortcut. Keep its window open; the Director page opens in your browser, usually at `http://localhost:8787`. If that port is busy, Director tries nearby ports automatically.
4. Open and save your product scene in KeyShot. In **Window -> Scripting**, select **KeyShot Director** and click **Run**. The page changes to **KeyShot connected** when the live scene is ready.

If **KeyShot Director** is not in KeyShot's script list, run the installer once more. The page also shows a copy-and-paste connection command as a fallback. Basic lighting and scene controls work without an AI account; reference matching and open-ended prompts need a signed-in Codex/Claude CLI or your own Anthropic API key.

Material recipe planning is handled by the bundled JavaScript engine. Neither the release ZIP nor a source checkout needs Rust, Cargo, or WebAssembly to run or package Director.

See the [2.3 release notes](docs/RELEASE_NOTES_2.3.md) for this release's features and current limits.

The working checkout adds [measured lighting refinement](docs/MEASURED_REFINEMENT.md) and [material edit recovery](docs/MATERIAL_EDIT_RECEIPTS.md). Set an explicit reference rectangle and objective to enable measured candidates; missing or incompatible evidence retains the first look. A disposable KeyShot 2026.2 calibration measured material mapping and displacement behavior; its [results](docs/MATERIAL_CALIBRATION_RESULTS.md) refine the [calibration plan](docs/MATERIAL_CALIBRATION_PLAN.md). Broader end-to-end verification of these new lighting and material workflows is still needed in KeyShot.

## macOS setup
1. Download and extract the release ZIP somewhere permanent. Install Node.js 20+ LTS if it is not already installed.
2. Open Terminal in the extracted folder and run `bash install-mac.sh`. It installs a launcher in your user Library without administrator access.
3. In KeyShot Studio, open **Preferences -> Folders -> Scripts** and add the exact folder printed by the installer. Reopen the Scripting window if it was already open.
4. Double-click **Start KeyShot Director.command**, choose **Open** if macOS asks, then open and save your scene in KeyShot and run **KeyShot Director** from the Scripting window.

macOS setup is included but has not yet been verified on a physical Mac; see the [macOS troubleshooting notes](#macos-troubleshooting).

While the bridge runs (up to 4 hours), orbiting and zooming the viewport is fine. **Don't** run other scripts, open dialogs or close panels in KeyShot; that can crash it. Always save first.

To disconnect KeyShot, open Settings and choose **Disconnect KeyShot**; Director now shows whether the bridge acknowledged the stop. **Studio off** removes Director lights but leaves the bridge running. Closing KeyShot also ends its bridge. Use **Quit app** to stop the local companion server.

## macOS troubleshooting
If your KeyShot edition does not expose the Scripting window, this integration cannot control that installation. KeyShot's documentation describes scripting as a Pro feature and locates the Scripts tab folders in the Scripting window. If the Mac setup fails, note the KeyShot version, macOS version and any script-console error. A physical Mac has not yet been used to verify this project end to end.

## Studio and Material Lab

- **Studio** keeps the live KeyShot viewport, scene goal, optional reference image, saved style, and one Director request together. Add a reference and leave **Match lighting and mood** selected to build a reversible lighting match with real KeyShot previews. Choose **Director context only** to discuss the image without invoking that guided match. The same composer handles lighting, framing, camera, and scene requests. Match framing is opt-in. Stop, undo, before/after previews, and the lighting recipe appear beneath the composer. **Saved styles & references** in the inspector holds the named image collections; select **Use in Director** to bring one into the composer. Reference video tools also remain in the Studio inspector. Images in named collections are stored locally under `references/<collection>/` and are sent to the selected AI provider only for an action that needs them.
- **What Director sees** is a manual, read-only scene snapshot in the Studio inspector. Refresh it after changing KeyShot selection or materials to check the selected part path, assigned material, bounds, units, active environment, camera and render size. Chat and the Detail close-up button can fit one selected part's bounds. Use the Studio rig target checkbox or explicitly ask in chat to build a rig around one selected part; ordinary presets still light the whole product. Auto exposure meters the projected selected bounds when the current view supports a reliable crop and identifies a whole-product fallback when it cannot. Empty fields stay unknown; names and bounds do not tell Director that a surface is a button, bevel, logo or grip. Environment fill remains global.
- **Materials** includes a dedicated KeyShot Material Library browser with search, a scene-part picker, and an isolated copy editor. Select a loaded library entry and one unlocked part; only that part receives the independent scene copy, leaving the library entry intact. Import and apply supported Base Color, Roughness, Bump or Normal maps to the copy and tune bump strength, then save the result to the KeyShot library and as a KMP. Add up to eight PNG, JPEG or WebP reference photos for Material Director. **Build KeyShot material** creates an unassigned, simple Plastic material from Base Color, Roughness, one Normal or Bump map, and optional AO. It builds from supported maps already imported and reports missing or skipped files. Advanced graphs, Metallic layering, procedural relief, and geometry displacement are paused. Imported originals remain unchanged under `materials/texture-sets/`. The Material Lab shelf lists packages with **Download KMP** and **Show in folder**.
- **Texture sets** are a separate Materials workflow for actual channel files. Choose a folder (or drop its files) containing PNG/JPEG/WebP/TIFF/EXR/HDR maps and optional `.mtlx`; Director copies originals byte-for-byte under `materials/texture-sets/`, recognizes common filename roles and offers **Open this set** or **Build KeyShot material**. New sets support up to 24 files, 80 MB per file and 512 MB total. Where supported, the importer records dimensions, channels and bit depth for agent inspection. Material chat can also create derived grayscale PNG variants (invert, contrast, seam-centered tile offset, and directional smoothing) without replacing originals; it then wires the selected result to an independent copy when supported. This processing is limited to non-interlaced 8-bit grayscale PNGs, not AI painting or arbitrary graph rewiring. A `.mtlx` is parsed for limited conversion hints only; it is not executed or imported directly as a KeyShot material. Conversion requires the live KeyShot bridge and creates a separate unassigned material.

The dedicated chats use workflow playbooks in `skills/material-lab/SKILL.md` and `skills/reference-video/SKILL.md`. They improve repeatable analysis and explain current KeyShot limits; the bridge and its implemented tools determine what Director can execute. Update a playbook when research or real reference examples show a better repeatable workflow.

The texture-set material builder validates supported channel choices with a small JavaScript recipe planner bundled in the app. Installing or packaging Director does not require Rust, Cargo, or a generated WebAssembly file. See [the material-core notes](docs/MATERIAL_CORE.md) for current map connections and the remaining live KeyShot checks.

## The page
| Area | What it does |
|---|---|
| **Preview** | Live view of the KeyShot viewport (noisy while the real-time render converges; that's normal). Drag = orbit, right-drag/Shift-drag = pan, wheel = zoom, touch = 1 finger orbit / 2 fingers pan + pinch. |
| **Reference video** | In References, drop a product video. The app copies its lighting and camera work onto your product. See *Match a video* below. |
| **Prompt box** | Plain-language control. Attach reference images (button, paste, or drag-drop). |
| **Studio lighting** | Rigs: *Hero soft*, *Dark & moody*, *Glass edge-light*, *Blank studio*, *Warm luxe*. Each is scaled to your product and auto-balanced. Tune exposure, per-light brightness / color temperature / angle / size, camera/reflection/shadow visibility, or drag lights on the stage diagram. **Studio off** removes everything and restores your original environment. |
| **Material lab** | Browse the loaded KeyShot library, copy a selected entry onto one scene part, and edit supported Base Color, Roughness, Bump or Normal maps on the independent copy. Also describe finishes, add reference photos, or build an unassigned simple Plastic graph from Base Color, Roughness, Normal or Bump, and optional AO. Advanced graphs, metallic layering, procedural relief, and geometry displacement are paused. |
| **Styles** | Every folder in `references/` is a style. Put images in it, **Analyze**, then **Match my rig**: the app measures your references and tunes your lighting toward them. |
| **Camera motion** | Live previews of moves (orbit, push-in, reveal, crane, whip) and a recorder for your own drags. |
| **Open on phone** | QR code; the phone must be on the same Wi-Fi. |

## What it can do

- **Match still-photo lighting:** choose a reference image, describe the light qualities, preview a lighting plan in the real KeyShot renderer, compare before/after and undo. The agent can use native Area, Point, Spotlight and installed IES sources; for IES it reads supported profile photometry before choosing a fixture, then checks product-masked beauty and supported linear Direct/Reflection evidence from KeyShot.
- **Shape a shot:** fit the whole product, create a centered or upper-detail crop, choose landscape/square/portrait framing and tune background/ground settings.
- **Build and adjust a studio:** apply a lighting rig, tune individual lights, exposure, environment and backdrop.
- **Control light behavior:** independently choose whether a Director light appears to the camera, in reflections, or in shadows. These toggles do not create KeyShot's native per-part Light Layers. KeyShot's scripting API does not expose native Light Layers, so set those in KeyShot's Light Layers panel.
- **Measure a lighting revision:** the advanced Lighting Capability Lab can capture supported KeyShot render passes, align them to the Clown object mask, and compare a repeat capture by product region and object label.
- **Edit a KeyShot library material:** search the dedicated library browser, choose the material and one scene part, then create its independent copy on that part. Apply supported imported image channels to the copy and save it to the library/KMP. The original library entry remains unchanged; save the `.bip` scene in KeyShot to persist the part assignment.
- **Build a reusable texture material:** import a texture folder and select **Build KeyShot material**. Director creates a separate unassigned Plastic graph and connects available Base Color, Roughness, one Normal or Bump map, and optional AO blended with Base Color. Metallic, displacement, and other unsupported maps are reported as skipped. The result is saved to KeyShot's Material Library and exported as a `.kmp` under `materials/` (private, Git-ignored). The KMP includes connected map files; imported originals remain unchanged. The Material Lab shelf provides **Download KMP** and **Show in folder**. Import the KMP in KeyShot and drag its library entry onto the intended part.
- **Stage the scene:** move or rotate assemblies, make linked-material copies, add neutral pedestal/floor/backdrop geometry, and undo recent staging. Start with the full [scene-staging guide](docs/SCENE_STAGING.md).
- **Direct with words:** use signed-in Claude or Codex CLI, an Anthropic API key, or a smaller set of offline commands. The companion calls KeyShot through its scripting bridge.
- **Make camera moves:** preview recorded and preset moves, or infer a camera path from a reference video and render frames with KeyShot. This does not create native camera keyframes in the KeyShot timeline.

See the [photo-matching guide](docs/PHOTO_WORKFLOW.md) for behavior, privacy and limitations.

Everything the app adds to your scene is named `CC_L_*` plus an environment called `CC_Studio`. These are real KeyShot objects, so **KeyShot's own Render / Add to Queue works on them**. Save a scene while a rig is on and the lights are saved with it.

## Prompting
Type what you want. Examples:
- *Dark moody lighting, edge-lit so the glass glows*
- *Clean white catalog look*
- *Warm luxury feel, a bit brighter*
- *Set Environment brightness near zero*
- *Raise exposure one stop*
- *Raise the existing key light by 20%*
- *Slow hero push-in*
- Attach 3-8 photos and write *make it look like these*

**How it works:** complex prompts and attached references go to the AI provider selected in Settings, with a list of actions such as building a rig, adjusting lights, setting the camera, and matching a style. Simple Environment brightness, Exposure, and tracked-light brightness instructions route directly to the same controls as the Studio sliders, so numeric and relative adjustments work without a CLI/API model. Reference matching and other visual tasks can inspect KeyShot render evidence before reporting.

**Which engine** (Settings -> Engine; *Automatic* tries them in this order):
- **Claude CLI, no API key**: install Claude Code, sign in once with `claude auth login`, then select it in Settings. On macOS, make sure `claude` is on your shell PATH or set its full path in Settings.
- **Codex CLI, no API key**: install Codex CLI, sign in once with `codex login`, then select it in Settings. On macOS, make sure `codex` is on your shell PATH or set its full path in Settings.
- **Codex model choice**: Settings has an optional ChatGPT / Codex model ID. Director passes it to Codex CLI; leave it blank to use your account's default. The selected ID must be available in your installed CLI and account.
- **Claude API key**: Settings -> paste *your own* Anthropic API key. It is stored only on your computer (`config.local.json`) and sent only to Anthropic. Usage is billed to your key. Do not share `config.local.json`.
- **Offline mode** (neither): understands basic commands: a rig name (*hero, moody, glass, white/blank, warm*), Environment brightness (for example *near zero* or *by 20%*), exposure and tracked-light brightness, *studio off*, *auto expose*, *orbit / push in / reveal / crane / whip*, *match <style folder>*, and *look*.

No separate AI hookup is needed beyond selecting an available provider in Settings; basic preset controls work offline.

## Match a video
1. Open your scene in KeyShot and point the camera at the **front of your product**. That view becomes the video's opening shot.
2. Drop a product video (mp4 / mov / webm, a few seconds to a minute) on **Reference video**. Tick what to copy: lighting, camera, or both.
3. Wait for the log to finish. What happens:
   - about a dozen frames are pulled out of the video in your browser and analyzed by the provider selected in Settings;
   - **lighting**: the frames are measured, the closest rig is built around your product and tuned toward the video's look (1-3 min);
   - **camera**: the shot list is read from the frames (orbit, push-in, crane, cuts, easing, how big the product is in frame);
   - **framing**: one tiny test render measures *your* product's silhouette, so every key lands at the reference's framing even though your product is a different size and shape.
4. **Play move** previews it live. **Render video** renders every frame with KeyShot's own renderer and encodes an mp4 into `renders/<date>/` (frames are kept next to it). Pick size, fps and time per frame first; total time is roughly frames x seconds per frame.

**With Claude or Codex CLI, or the Anthropic API** the camera work is read by eye: orbits, elevation changes, cuts and easing. **In offline mode** only measurable framing is copied, so push-ins and drifts work but orbits do not.

The move also appears as JSON under *Camera motion*, so you can edit keys by hand; anything recorded there can be rendered the same way.

Good to know: it matches lighting *style* and camera *motion*, not the reference product or its set. Depth of field, lens changes mid-shot, moving lights and animated parts in the reference are not copied. Rendering uses your scene exactly as it is, so save first and leave KeyShot alone while it runs.

## Styles (matching a look)
1. Make a folder in `references/` (e.g. `references/clean_white`), drop 5-30 images in (JPG, PNG, WebP, AVIF all work).
2. Click **Analyze**. Images are measured (backdrop, tone, contrast, highlights, where light falls) and grouped into looks (e.g. a light and a dark one).
3. Build a rig, then **Match my rig**. It tries small changes, re-measures the live viewport, keeps what helps (1-3 min).

It matches *lighting and tone*, not the product itself, and it's an approximation: contrast on clear glass can't always reach the contrast of matte gadgets.

## Files and privacy

Settings and an optional API key stay in the local, ignored `config.local.json`. Reference photos are analyzed with the AI provider selected in Settings (signed-in Codex/Claude CLI or Anthropic API) and photo-job evidence is saved in `references/_photos/`. Do not put credentials or private product files in GitHub. Reference folders, renders and bridge runtime files are excluded from Git.

The server listens on the local network so a phone can connect. Anyone on that trusted network who can reach the page can control the open KeyShot scene. Use it only on a network you trust; do not port-forward it or expose it to the public internet. The app has origin protections but no multi-user authentication.

The app does not save your scene for you. Save in KeyShot before connecting and before any work you want to keep. Photo-match undo and staging undo are session-local; review each change and save it yourself. Director keeps its own preview/recipe outputs under the project folder. [The KeyShot scripting guide](https://manual.keyshot.com/manual/scripting-2/) describes the Scripts tab and script-folder preferences; current resource-folder paths are listed in [KeyShot's file-path guide](https://support.keyshot.com/en/knowledge-base/keyshot-file-paths).

## Limits you should know
- **Camera moves are not KeyShot timeline animations.** KeyShot's scripting can't create camera keyframes, and cameras imported from glTF arrive static. So the app renders a move itself, frame by frame, with KeyShot's renderer (*Render video*). It does not go through KeyShot's render queue.
- Live preview is about 4-6 fps (each camera move costs KeyShot 100-250 ms). Final renders aren't affected.
- If your scene references textures that are missing on disk, KeyShot will refuse *Add to Queue* until they're relinked (not this app's doing).
- If KeyShot crashes, its session recovery may bring the lights back; the page re-detects them on connect, or press **Studio off**.
- Windows is the verified platform. macOS bridge event pumping uses KeyShot's Qt event loop when available; image resizing/style analysis uses the macOS `sips` utility. The macOS path has not yet been verified on a physical Mac, and `sips` only supports formats available to the installed macOS release. Unsupported style images are reported individually; use PNG or JPEG for the most portable results.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Header says *KeyShot bridge not running* | Run the launcher in KeyShot (Scripts tab). It runs up to 4 hours; run it again after that. |
| Launcher error "start it through the launcher" | Run `Scripts\KeyShot Director.py`, not `cc_bridge.py` directly. |
| `node` not recognized | Install Node.js 20+ LTS, reopen Terminal/PowerShell and start the app again. |
| Port 8787 in use | Director tries the next nine ports automatically and opens the page on the first available one. If all ten are occupied, close another Director window or set `PORT` to a free port before starting. |
| Prompt says *API key rejected* | Re-paste the key in Settings. |
| Lights look wrong after a KeyShot crash | **Studio off**, then rebuild a rig. |

## Folder map
`server/` the local web server, AI tools and page · `bridge/` scripts that run inside KeyShot · `tools/` image helpers and tests · `references/` your style and photo-job folders · `renders/` rendered videos · `install.ps1` and `install-mac.sh` set up each platform's KeyShot launcher.

Experimental, not in the page yet: `server/anim.js`, `gltf.js`, `glbanim.js` and `bridge/cc_anim.py` can put **part animation** (turntable, exploded view, cap lift) on KeyShot's real timeline by exporting the product as GLB, adding animation, and importing it back with its materials re-applied.

Screenshots KeyShot makes for the preview are deleted immediately; the app never writes into your Renderings folder permanently.

## License
MIT. Not affiliated with KeyShot / Luxion; KeyShot is a trademark of its owner.

## References

- [KeyShot Scripting](https://manual.keyshot.com/manual/scripting-2/) — Scripting window, Pro feature and Script folders.
- [KeyShot file paths](https://support.keyshot.com/en/knowledge-base/keyshot-file-paths) — platform resource-folder locations.
