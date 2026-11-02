# KeyShot Director 3.1.0

KeyShot Director 3.1 adds a separate **macOS download** and rebuilds the Mac install and start flow so it no longer depends on Windows-only behavior. The Windows experience is unchanged.

**Verification status.** The macOS work is covered by automated tests on a macOS runner and by injected-platform tests that exercise the macOS branches with a fake file system. **It has not been run on a physical Mac with KeyShot Studio 2026.2.** The exact checks still needed on a real Mac are listed in [docs/MACOS.md](MACOS.md#verification-status).

## What is new

- **Separate macOS download.** `KeyShot-Director-v3.1.0-macOS.zip` contains only what a Mac needs. The Windows download keeps working and also still contains the Mac files.
- **ZIP that works on a Mac.** The release ZIP is now written by `tools/zip-release.js`: forward-slash paths, shell scripts marked executable and stored with LF line endings (the Windows ZIP tools could not record the executable bit, so `.command` files could not be opened). The packager refuses to produce a ZIP that fails these checks.
- **Double-click installer and stopper.** `Install KeyShot Director.command` and `Stop KeyShot Director.command` join `Start KeyShot Director.command`. `bash install-mac.sh` remains the fallback if Gatekeeper blocks a double-click, and it clears the quarantine flag for the extracted folder.
- **Scripts folder discovery.** The installer finds `~/Documents/KeyShot <version>/Scripts`, asks which version when there are several, and only falls back to a user folder (plus one manual Preferences step) when KeyShot's folder does not exist yet. `--scripts-folder` chooses it explicitly. Scripts it did not write are never replaced.
- **Safe stop on macOS.** The server records `bridge/director-server.json` on every platform, and `tools/stop.js` (used by the start script and the stop command) only ends that exact process after checking its command line and start time.
- **Claude and Codex CLI discovery on macOS.** PATH, the Claude desktop app folder under `~/Library/Application Support`, `~/.local/bin`, `~/.claude/local`, Homebrew, npm/bun/nvm folders, and the Codex app bundle. Copies without the executable bit are skipped.
- **Smaller fixes.** The temp folder given to the AI CLIs resolves `/var` to `/private/var`; hidden files such as `._IMG.jpg` are ignored in style folders; the connect command pasted into KeyShot survives quotes in the install path; research-lab scene paths accept macOS paths.

## Under the hood

- New `server/platform.js` holds the platform decisions (opening the browser and folders, the stop marker, the connect command). `server/cli.js` and `server/image-tools.js` accept an injected platform and file system, which is how the macOS branches are tested on any machine.
- New tests: `test_macos_platform.js`, `test_cli_discovery.js`, `test_stop_and_install_mac.js`, `test_mac_package.js`, `test_bridge_platform.py`. CI runs them on both Windows and macOS runners.

## Known limits

- Not verified on a physical Mac. In particular, whether KeyShot's Python can import PySide6 or PySide2 (used to keep KeyShot responsive while the bridge runs) is unconfirmed, and so is the location of the Claude and Codex desktop-app copies on macOS.
- Everything listed under known limits in the [3.0 release notes](RELEASE_NOTES_3.0.md) still applies.
