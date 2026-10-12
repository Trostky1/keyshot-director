# KeyShot Director

Scene staging is available through the existing AI prompt box: whole-product movement,
center-based rotation/scale, linked-material copies, physical pedestal/floor/backdrop
geometry and session-scoped undo. See [the staging guide](docs/SCENE_STAGING.md) for
examples, limits and the CLI tool contract.

A photo-first companion app for **KeyShot** that lights and frames *your own product*. Choose a reference photograph and borrow its light direction, softness, reflections and background tone through custom product-scaled lights, actual KeyShot previews and an optional visual refinement. Compare before/after and undo the look without changing product materials. Animation/video matching, preset rigs, plain-language prompts and second-monitor/phone control remain available.

It does not replace KeyShot: final material assignment, the timeline, scene saving and final-resolution rendering stay in KeyShot. Reference matching is photographic inference, not exact scene reconstruction. Physical sets/backplates and material differences are reported as limitations. See [the photo workflow and verification guide](docs/PHOTO_WORKFLOW.md).

> Early access. Verified on KeyShot Studio 2026.2 (EDU) on Windows 11. macOS support is included and needs first-run testing on a Mac; see [macOS setup](#macos-setup-and-first-run). Not affiliated with KeyShot / Luxion.

## What you need
- Windows or macOS supported by your KeyShot Studio release, **KeyShot Studio 2026.x** with the Scripting feature available in your license. The scripting console is required; headless scripting is not.
- **Node.js 20+** (https://nodejs.org, LTS)
- A browser. Reference-photo matching needs a signed-in **Codex CLI**, signed-in Claude Code CLI or Anthropic API key. Basic preset controls also work offline. Select the provider in Settings.

## Install (2 minutes)
1. On GitHub, choose **Code -> Download ZIP** (or clone the repository) and unpack it in a folder you will keep. The launcher remembers this location.
2. On Windows, right-click `install.ps1` and choose *Run with PowerShell*. It checks Node, finds KeyShot's Scripts folder and installs the launcher.
3. On macOS, open Terminal in the unpacked folder and run `bash install-mac.sh`. It installs a launcher in your user Library without administrator access; add the printed folder to KeyShot's Scripts folders as described below.

## Use it
1. On Windows, double-click **Start KeyShot Director.bat**. On macOS, double-click **Start KeyShot Director.command**. Leave the terminal window open. The page opens at `http://localhost:8787`.
2. In KeyShot, open your scene and **save it**. Run **Scripts -> KeyShot Director -> Run** from the Scripting window. (If the script is missing, follow the platform-specific setup below.)
3. The page header shows **KeyShot connected** and the live preview appears.

While the bridge runs (up to 4 hours), orbiting and zooming the viewport is fine. **Don't** run other scripts, open dialogs or close panels in KeyShot; that can crash it. Always save first.

To stop: close the console script's job by waiting for it to end, or ask the app (`Studio off` removes lights; closing KeyShot ends the bridge).

## macOS setup and first run

1. Run `bash install-mac.sh` from the extracted project folder. It creates a launcher under `~/Library/Application Support/KeyShot Director/Scripts` and checks that Node.js 20+ is installed.
2. In KeyShot Studio, open **Preferences -> Folders -> Scripts** and add that exact folder. KeyShot stores its resource files in a system Library location on macOS; using a user folder avoids requiring administrator access. Reopen the Scripting window if it was already open.
3. Double-click `Start KeyShot Director.command`. If macOS asks for confirmation the first time, choose **Open**. The companion app opens in your browser and keeps a Terminal window running.
4. Open and save your scene, then run **KeyShot Director** from the Scripting window. The page should show **KeyShot connected**.

If your KeyShot edition does not expose the Scripting window, this integration cannot control that installation. KeyShot's documentation describes scripting as a Pro feature and locates the Scripts tab folders in the Scripting window. A Mac has not yet been used to verify this project end to end; please report the KeyShot version, macOS version and any script-console error when trying it.

## The three workspaces

- **Studio** keeps the live KeyShot viewport, general AI chat, camera, lighting and scene controls. A photo attached to this chat is interpreted with your written instruction; it may be used for a lighting match or another supported task.
- **References** is the guided visual-matching workspace. Drop or paste one photo into **Match a look** to copy lighting and mood with preview and undo. Create a named style collection by pasting, dropping or choosing up to eight images at a time, then **Analyze** and **Match my rig**. Adding photos to an existing collection makes it ready for re-analysis. Reference video tools live here too. Images are stored locally under `references/<collection>/` and sent to the selected AI provider only for an action that needs them.
- **Materials** has its own photo-reference drop, description and AI chat. Add up to eight PNG, JPEG or WebP references; the assistant treats them as context, not as a persistent training dataset. Separately, import a real texture set. With KeyShot 2026.2 connected, **Build KeyShot material** creates a new unassigned Plastic graph: Base Color → Diffuse, Roughness → Color To Number → Plastic Roughness, and Normal (or Bump fallback) → Bump. Those connected maps are verified in the live graph and included in the saved `.kmp`; original imported files remain unchanged under `materials/texture-sets/`. Specular, Metallic, AO, Displacement, arbitrary MaterialX nodes, and graph edits on existing materials are not supported by this converter and are reported as skipped. The Material Lab shelf lists the package with **Download KMP** and **Show in folder**. Import the KMP into KeyShot and drag its library material onto the part you choose; Director never assigns it automatically.
- **Texture sets** are a separate Materials workflow for actual channel files. Choose a folder (or drop its files) containing PNG/JPEG/WebP/TIFF/EXR/HDR maps and optional `.mtlx`; Director copies originals byte-for-byte under `materials/texture-sets/`, recognizes common filename roles and offers **Open this set** or **Build KeyShot material**. A `.mtlx` is parsed for a readable conversion hint only; it is not executed or imported directly as a KeyShot material. Conversion requires the live KeyShot bridge and creates a separate unassigned material.

The dedicated chats use workflow playbooks in `skills/material-lab/SKILL.md` and `skills/reference-video/SKILL.md`. They improve repeatable analysis and explain current KeyShot limits; the bridge and its implemented tools determine what Director can execute. Update a playbook when research or real reference examples show a better repeatable workflow.

## The page
| Area | What it does |
|---|---|
| **Preview** | Live view of the KeyShot viewport (noisy while the real-time render converges; that's normal). Drag = orbit, right-drag/Shift-drag = pan, wheel = zoom, touch = 1 finger orbit / 2 fingers pan + pinch. |
| **Reference video** | In References, drop a product video. The app copies its lighting and camera work onto your product. See *Match a video* below. |
| **Prompt box** | Plain-language control. Attach reference images (button, paste, or drag-drop). |
| **Studio lighting** | Rigs: *Hero soft*, *Dark & moody*, *Glass edge-light*, *Blank studio*, *Warm luxe*. Each is scaled to your product and auto-balanced. Tune exposure, per-light brightness / color temperature / angle / size, camera/reflection/shadow visibility, or drag lights on the stage diagram. **Studio off** removes everything and restores your original environment. |
| **Material lab** | Inspect scene material graphs; explicitly unlock one selected material to adjust its exposed numeric/color values; import source texture sets; build a new unassigned Plastic graph from Base Color, Roughness and Normal/Bump maps; and save a portable `.kmp` package. Existing material graph rewiring and Specular/Metallic/AO/Displacement conversion remain unsupported. |
| **Styles** | Every folder in `references/` is a style. Put images in it, **Analyze**, then **Match my rig**: the app measures your references and tunes your lighting toward them. |
| **Camera motion** | Live previews of moves (orbit, push-in, reveal, crane, whip) and a recorder for your own drags. |
| **Open on phone** | QR code; the phone must be on the same Wi-Fi. |

## What it can do

- **Match still-photo lighting:** choose a reference image, describe the light qualities, preview a lighting plan in the real KeyShot renderer, compare before/after and undo.
- **Shape a shot:** fit the whole product, create a centered or upper-detail crop, choose landscape/square/portrait framing and tune background/ground settings.
- **Build and adjust a studio:** apply a lighting rig, tune individual lights, exposure, environment and backdrop.
- **Control light behavior:** independently choose whether a Director light appears to the camera, in reflections, or in shadows. These toggles do not create KeyShot's native per-part Light Layers. KeyShot's scripting API does not expose native Light Layers, so set those in KeyShot's Light Layers panel.
- **Tune an existing material:** choose it in Material Lab and select **Enable edits**. This changes the live scene material and every part sharing it; only exposed numeric/boolean/color values can be tuned. Connected maps and graph structure stay read-only on existing materials. Use **Undo edit** for the last value or save a KMP snapshot; save the `.bip` scene in KeyShot to persist live scene changes.
- **Build a reusable texture material:** import a texture set and select **Build KeyShot material**. Director creates a separate unassigned Plastic material, wires supported Base Color, Roughness and Normal/Bump maps, saves it to KeyShot's Material Library and exports a `.kmp` under `materials/` (private, Git-ignored). The KMP includes connected map files; original imported files remain in the set. The Material Lab shelf provides **Download KMP** and **Show in folder**. Import the KMP in KeyShot and drag its library entry onto the part you choose. Specular, Metallic, AO and Displacement are not connected.
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
- *Slow hero push-in*
- Attach 3-8 photos and write *make it look like these*

**How it works:** your prompt (plus any attached images) goes to the AI provider selected in Settings, together with a list of things the app can do: build a rig, adjust a light, set exposure, set the camera, play a move, analyze a style folder, match a style, look at the live viewport. The provider chooses actions; the app runs them in KeyShot, **looks at the result** through the viewport, corrects obvious problems, and tells you what it changed.

**Which engine** (Settings -> Engine; *Automatic* tries them in this order):
- **Claude CLI, no API key**: install Claude Code, sign in once with `claude auth login`, then select it in Settings. On macOS, make sure `claude` is on your shell PATH or set its full path in Settings.
- **Codex CLI, no API key**: install Codex CLI, sign in once with `codex login`, then select it in Settings. On macOS, make sure `codex` is on your shell PATH or set its full path in Settings.
- **Codex model choice**: Settings has an optional ChatGPT / Codex model ID. Director passes it to Codex CLI; leave it blank to use your account's default. The selected ID must be available in your installed CLI and account.
- **Claude API key**: Settings -> paste *your own* Anthropic API key. It is stored only on your computer (`config.local.json`) and sent only to Anthropic. Usage is billed to your key. Do not share `config.local.json`.
- **Offline mode** (neither): understands basic commands only: a rig name (*hero, moody, glass, white/blank, warm*), *studio off*, *brighter / darker*, *auto expose*, *orbit / push in / reveal / crane / whip*, *match <style folder>*, *look*.

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
| Port 8787 in use | Close the other Director window, or set `PORT` to a free port before starting. |
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
