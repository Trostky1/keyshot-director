# KeyShot Director

A companion app for **KeyShot** that lights and moves the camera around *your own product*. **Drop in a product video you like and it rebuilds that lighting and those camera moves around the product already open in your scene, framed to fit, then renders the result.** Also: one-click lighting rigs, look-matching from reference images, plain-language prompts, and control from a second monitor or phone.

It does not replace KeyShot: materials, environments, cameras, the timeline and the render dialog all stay in KeyShot. This only adds what KeyShot doesn't have: studio-grade lighting built for you, matching a look from reference images, and an AI prompt box that works the live scene.

> Rough first version. Tested on KeyShot Studio 2026.2 (EDU), Windows 11. Not affiliated with KeyShot / Luxion.

## What you need
- Windows, **KeyShot 2026.x** with Python scripting (the scripting console must exist in your license; *headless* scripting is **not** needed)
- **Node.js 20+** (https://nodejs.org, LTS)
- A browser. An Anthropic API key is **optional** (see *Prompting*).

## Install (2 minutes)
1. On GitHub: **Code -> Download ZIP** (or `git clone`), then unzip anywhere (for example `C:\KeyShotDirector`).
2. Right-click `install.ps1` -> *Run with PowerShell* (or `powershell -ExecutionPolicy Bypass -File install.ps1`). It checks Node, finds KeyShot's Scripts folder, and writes a launcher there called **KeyShot Director**.

## Use it
1. Double-click **Start KeyShot Director.bat**. Leave its window open. A page opens at `http://localhost:8787`.
2. In KeyShot: open your scene, **save it**, then **Scripts tab -> KeyShot Director -> Run**. (No Scripts tab entry? Paste the `exec(...)` line from the top of `Scripts\KeyShot Director.py` into the scripting console.)
3. The page header shows **KeyShot connected** and the live preview appears.

While the bridge runs (up to 4 hours), orbiting and zooming the viewport is fine. **Don't** run other scripts, open dialogs or close panels in KeyShot; that can crash it. Always save first.

To stop: close the console script's job by waiting for it to end, or ask the app (`Studio off` removes lights; closing KeyShot ends the bridge).

## The page
| Area | What it does |
|---|---|
| **Preview** | Live view of the KeyShot viewport (noisy while the real-time render converges; that's normal). Drag = orbit, right-drag/Shift-drag = pan, wheel = zoom, touch = 1 finger orbit / 2 fingers pan + pinch. |
| **Reference video** | Drop a product video. The app copies its lighting and camera work onto your product. See *Match a video* below. |
| **Prompt box** | Plain-language control. Attach reference images (button, paste, or drag-drop). |
| **Studio lighting** | Rigs: *Hero soft*, *Dark & moody*, *Glass edge-light*, *Blank studio*, *Warm luxe*. Each is scaled to your product and auto-balanced. Then tune: exposure, per-light brightness / color temperature / angle / size, or drag lights on the top-down diagram. **Studio off** removes everything and restores your original environment. |
| **Styles** | Every folder in `references/` is a style. Put images in it, **Analyze**, then **Match my rig**: the app measures your references and tunes your lighting toward them. |
| **Camera motion** | Live previews of moves (orbit, push-in, reveal, crane, whip) and a recorder for your own drags. |
| **Open on phone** | QR code; the phone must be on the same Wi-Fi. |

Everything the app adds to your scene is named `CC_L_*` plus an environment called `CC_Studio`. These are real KeyShot objects, so **KeyShot's own Render / Add to Queue works on them**. Save a scene while a rig is on and the lights are saved with it.

## Prompting
Type what you want. Examples:
- *Dark moody lighting, edge-lit so the glass glows*
- *Clean white catalog look*
- *Warm luxury feel, a bit brighter*
- *Slow hero push-in*
- Attach 3-8 photos and write *make it look like these*

**How it works:** your prompt (plus any attached images) goes to Claude together with a list of things the app can do: build a rig, adjust a light, set exposure, set the camera, play a move, analyze a style folder, match a style, look at the live viewport. Claude chooses the actions, the app runs them in KeyShot, **looks at the result** through the viewport, corrects obvious problems, and tells you what it changed.

**Which engine:**
- **Claude** (recommended): Settings -> paste *your own* Anthropic API key. It is stored only on your computer (`config.local.json`) and sent only to Anthropic. Usage is billed to your key. Do not share `config.local.json`.
- **Offline mode** (no key): understands basic commands only: a rig name (*hero, moody, glass, white/blank, warm*), *studio off*, *brighter / darker*, *auto expose*, *orbit / push in / reveal / crane / whip*, *match <style folder>*, *look*.

Claude does **not** need to be "hooked up" in any other way; the app works without anyone else's tools.

## Match a video
1. Open your scene in KeyShot and point the camera at the **front of your product**. That view becomes the video's opening shot.
2. Drop a product video (mp4 / mov / webm, a few seconds to a minute) on **Reference video**. Tick what to copy: lighting, camera, or both.
3. Wait for the log to finish. What happens:
   - about a dozen frames are pulled out of the video in your browser (they are sent to Anthropic only if you set an API key);
   - **lighting**: the frames are measured, the closest rig is built around your product and tuned toward the video's look (1-3 min);
   - **camera**: the shot list is read from the frames (orbit, push-in, crane, cuts, easing, how big the product is in frame);
   - **framing**: one tiny test render measures *your* product's silhouette, so every key lands at the reference's framing even though your product is a different size and shape.
4. **Play move** previews it live. **Render video** renders every frame with KeyShot's own renderer and encodes an mp4 into `renders/<date>/` (frames are kept next to it). Pick size, fps and time per frame first; total time is roughly frames x seconds per frame.

**With a Claude API key** the camera work is read by eye: orbits, elevation changes, cuts and easing. **Without a key** only what can be measured is copied: how large the product is in frame and where it sits, so push-ins and drifts work but orbits do not.

The move also appears as JSON under *Camera motion*, so you can edit keys by hand; anything recorded there can be rendered the same way.

Good to know: it matches lighting *style* and camera *motion*, not the reference product or its set. Depth of field, lens changes mid-shot, moving lights and animated parts in the reference are not copied. Rendering uses your scene exactly as it is, so save first and leave KeyShot alone while it runs.

## Styles (matching a look)
1. Make a folder in `references/` (e.g. `references/clean_white`), drop 5-30 images in (JPG, PNG, WebP, AVIF all work).
2. Click **Analyze**. Images are measured (backdrop, tone, contrast, highlights, where light falls) and grouped into looks (e.g. a light and a dark one).
3. Build a rig, then **Match my rig**. It tries small changes, re-measures the live viewport, keeps what helps (1-3 min).

It matches *lighting and tone*, not the product itself, and it's an approximation: contrast on clear glass can't always reach the contrast of matte gadgets.

## Limits you should know
- **Camera moves are not KeyShot timeline animations.** KeyShot's scripting can't create camera keyframes, and cameras imported from glTF arrive static. So the app renders a move itself, frame by frame, with KeyShot's renderer (*Render video*). It does not go through KeyShot's render queue.
- Live preview is about 4-6 fps (each camera move costs KeyShot 100-250 ms). Final renders aren't affected.
- If your scene references textures that are missing on disk, KeyShot will refuse *Add to Queue* until they're relinked (not this app's doing).
- If KeyShot crashes, its session recovery may bring the lights back; the page re-detects them on connect, or press **Studio off**.
- Windows only (uses Windows message pumping and PowerShell helpers).

## Troubleshooting
| Symptom | Fix |
|---|---|
| Header says *KeyShot bridge not running* | Run the launcher in KeyShot (Scripts tab). It runs up to 4 hours; run it again after that. |
| Launcher error "start it through the launcher" | Run `Scripts\KeyShot Director.py`, not `cc_bridge.py` directly. |
| `node` not recognized | Install Node.js LTS, reopen the window. |
| Port 8787 in use | Set `PORT` (e.g. `set PORT=8800` before starting) and open that port. |
| Prompt says *API key rejected* | Re-paste the key in Settings. |
| Lights look wrong after a KeyShot crash | **Studio off**, then rebuild a rig. |

## Folder map
`server/` the local web server and the page · `bridge/` the scripts that run inside KeyShot · `tools/` image helpers and test scripts · `references/` your style folders (never uploaded, not in git) · `renders/` rendered videos (not in git) · `install.ps1` (also writes `Start KeyShot Director.bat`).

Experimental, not in the page yet: `server/anim.js`, `gltf.js`, `glbanim.js` and `bridge/cc_anim.py` can put **part animation** (turntable, exploded view, cap lift) on KeyShot's real timeline by exporting the product as GLB, adding animation, and importing it back with its materials re-applied.

Screenshots KeyShot makes for the preview are deleted immediately; the app never writes into your Renderings folder permanently.
