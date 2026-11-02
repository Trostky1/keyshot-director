# KeyShot Director on macOS

KeyShot Director is a Node.js app that runs on your Mac plus a script that runs inside KeyShot. They talk through small JSON files in the `bridge` folder, so nothing leaves your computer.

## Requirements

- macOS 12 or newer on Apple silicon or Intel
- KeyShot Studio 2026.x with the Scripting window available in your license (the scripting window is required; headless scripting is not)
- Node.js 20 or newer (the current LTS from <https://nodejs.org>)

## Install

1. Download **KeyShot-Director-v3.1.0-macOS.zip** from the [releases page](https://github.com/Trostky1/keyshot-director/releases/latest) and extract it somewhere permanent, such as your Documents folder. Do not run it from the Downloads folder and do not move it after setup.
2. Double-click **Install KeyShot Director.command**.
   - If macOS says it cannot verify the file, or the file will not open, open Terminal in the extracted folder instead and run:

     ```bash
     bash install-mac.sh
     ```

   The installer checks Node, makes the helper scripts executable, clears the download quarantine flag from this folder only, and writes the KeyShot launcher `KeyShot Director.py`.
3. The installer looks for `~/Documents/KeyShot <version>/Scripts`. If it finds several KeyShot versions it asks which one to use. If it finds none (KeyShot creates the folder the first time it runs), it writes the launcher to `~/Library/Application Support/KeyShot Director/Scripts` and tells you to add that folder in KeyShot under **Preferences > Folders > Scripts**. You can also choose the folder yourself:

   ```bash
   bash install-mac.sh --scripts-folder "/Users/you/Documents/KeyShot 2026/Scripts"
   ```

   An existing script called `KeyShot Director.py` that this installer did not write is never replaced.

## Start

1. Double-click **Start KeyShot Director.command** (or run `bash start-mac.sh`). Leave its Terminal window open. Your browser opens the app.
2. macOS may ask whether `node` may accept incoming network connections. The page is also served to your phone or a second computer on your network; choose **Deny** if you only use the Mac itself.
3. In KeyShot, open and save your scene, open the Scripting window, select **KeyShot Director** and click **Run**. The page header changes to **KeyShot connected**.

## Stop

Press Ctrl+C in the Terminal window, close it, or double-click **Stop KeyShot Director.command**. The stop script only ends the process recorded in `bridge/director-server.json` after checking that it is this folder's `server/server.js` started at the recorded time. Anything else is left alone.

## AI engines

- **Claude CLI, no API key**: install Claude Code and sign in once with `claude auth login`. Director looks on your PATH, in the Claude desktop app's `~/Library/Application Support/Claude/claude-code` folder, and in `~/.local/bin`, `~/.claude/local`, Homebrew (`/opt/homebrew/bin`, `/usr/local/bin`), npm/bun/nvm global folders. If it is not found, paste the full path in Settings.
- **Codex CLI, no API key**: install Codex CLI and sign in with `codex login`. Director checks PATH, the Codex desktop app bundle and the same Homebrew/npm folders. Paste the full path in Settings if needed.
- **API key**: paste your own Anthropic API key in Settings. It is stored only in `config.local.json` in this folder.

## What differs from Windows

| Area | Windows | macOS |
| --- | --- | --- |
| Launchers | `.bat` files | `.command` files and `install-mac.sh` / `start-mac.sh` |
| KeyShot launcher | Documents\KeyShot *N*\Scripts | `~/Documents/KeyShot N/Scripts`, or a folder you add in Preferences |
| Keeping KeyShot responsive while the bridge runs | Win32 message pump | KeyShot's Qt event loop (PySide6, then PySide2); a safe no-op if neither can be imported |
| Image conversion for previews and style folders | PowerShell | the built-in `sips` tool (JPEG and PNG are the safest formats; HEIC, WebP and AVIF depend on your macOS version) |
| Opening folders and the browser | Explorer / `start` | `open` |
| Stop script | `tools/stop.ps1` | `tools/stop.js` |

## Verification status

Be clear about what has and has not been proven.

**Tested automatically (CI on macOS and Windows runners, plus injected-platform tests on any machine):**

- every macOS branch in the server: browser and folder opening, Claude and Codex CLI discovery in each plausible install location, `sips` command construction, the stop script's safety checks, the temp-folder path handling, the connect command with quotes in the install path
- the installer: Scripts folder discovery, version choice, fallback folder, refusal to overwrite foreign scripts, and the generated launcher actually starting the bridge loop against a fake KeyShot
- the bridge loop with the macOS event pump (PySide6, PySide2, neither, a failing Qt app) and the Windows message pump
- the release ZIP: forward-slash paths, shell scripts executable with LF endings, extracted with the real `unzip` on a macOS runner
- starting the real server on a macOS runner, checking its stop marker and stopping it with `tools/stop.js`

**Not yet verified on a real Mac with KeyShot Studio 2026.2.** Please run these checks and report the results:

1. `Install KeyShot Director.command` opens by double-click from a ZIP downloaded in a browser (Gatekeeper behavior), or `bash install-mac.sh` works as the fallback.
2. KeyShot lists **KeyShot Director** in its Scripting window. Note which folder it was installed into (`~/Documents/KeyShot 2026/Scripts` is the expected location).
3. Running the script shows **KeyShot connected** in the page within a few seconds.
4. **While the bridge runs, KeyShot's viewport and menus stay responsive.** This depends on PySide6/PySide2 being importable inside KeyShot's Python 3.13. If the interface freezes, note it and run the stop operation from the page.
5. Orbit the camera and apply a lighting rig; the viewport updates and the preview in the page refreshes.
6. Run `Stop KeyShot Director.command` and confirm the app stops and `bridge/director-server.json` disappears.
7. Style folder analysis and photo previews work with PNG and JPEG images (they use `sips`).
8. If you use the Claude or Codex CLI: Settings shows it found and signed in, and a prompt returns an answer. Report where the CLI lives if it was not auto-found.
9. Material Lab: import a texture folder, build a material, and confirm the `.kmp` lands in `materials/`.
10. `lux.getKeyShotFolder` paths: confirm the material library and environments listings are populated.

## Troubleshooting

- *"command not found: node"* in the Terminal window: install Node.js from <https://nodejs.org> and reopen the file.
- *The `.command` file will not open or says it is from an unidentified developer*: right-click it and choose **Open** once, or run `bash install-mac.sh`, which clears the quarantine flag for this folder.
- *KeyShot does not list the script*: add the folder the installer printed under **Preferences > Folders > Scripts**, then reopen the Scripting window.
- *Page says "KeyShot is not connected"*: run the script from the Scripting window after the app is running. Only one KeyShot window can hold the bridge at a time.
- *A port is busy*: Director automatically tries the next ports (8787 to 8796). The Terminal window prints the address it actually uses.
- If something fails, note your macOS version, KeyShot version, and any script-console error.
