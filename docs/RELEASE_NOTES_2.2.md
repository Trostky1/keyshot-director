# KeyShot Director 2.2.0

KeyShot Director 2.2 adds measured lighting refinement and supported material recovery to the live KeyShot workflow, with a clearer, more focused interface for directing the scene.

## What changed

- **Target-aware lighting measurements.** Captures use consistent, aspect-derived settings and measure the selected part when its visible bounds can be projected reliably. Unsupported cameras, uncertain bounds, and incompatible captures fail closed rather than reporting misleading comparisons.
- **Bounded lighting refinement.** Director compares a small number of candidates against a named image objective and measured repeat variation. It keeps the best completed result and restores the prior best or original checkpoint after a regression, failure, cancellation, or timeout.
- **Material graph explanations and recovery.** The inspector reports supported Surface, Label, and Geometry connections and their provenance. Session undo verifies current values or graph connections before restoring supported edits; it does not claim to undo saved files, generated maps, geometry execution, or arbitrary graph changes.
- **A refreshed interface.** Studio and Materials use a shared scene-first workflow with KeyShot blue actions, restrained orange accents, clearer instructions, and a live preview that can be collapsed. The preview choice persists between workspaces and reloads.
- **KeyShot 2026.2 calibration evidence.** A disposable-scene experiment documented UV mapping and displacement behavior on controlled fixtures. Those measurements narrow the supported guidance; they are not universal rules for other meshes, maps, or KeyShot versions.

## Installation

1. Download the latest release ZIP from [GitHub Releases](https://github.com/Trostky1/keyshot-director/releases/latest) and extract it to a folder you will keep.
2. Double-click **Install KeyShot Director.bat**. The installer checks for Node.js 20+, adds the KeyShot script, and creates a desktop shortcut.
3. Start **KeyShot Director**, save your scene in KeyShot, then open **Window → Scripting** and run **KeyShot Director**.
4. Wait for the connected status before using scene controls. The app does not save your KeyShot scene automatically.

Basic scene and lighting controls work without an AI account. Reference matching and open-ended requests require a signed-in Codex or Claude CLI, or an Anthropic API key configured locally. Do not place credentials in the release folder or GitHub.

## Requirements and limits

- KeyShot Studio 2026.x with the Scripting feature enabled, Node.js 20+, and a current browser.
- Windows 11 is the verified platform. macOS setup is included but has not been verified on physical KeyShot hardware.
- Measured refinement is an objective-specific heuristic, not an overall image similarity score or recovered physical-light solution. Review the result before saving it in KeyShot.
- Recovery covers supported in-session material value edits, independent-copy assignments, and selected map replacements. It is not persistent KeyShot undo and does not reverse saved library files, material creation, generated files, or executed geometry.
- Calibration results apply to the recorded KeyShot 2026.2 fixtures. They do not authorize automatic rewriting or color transformation of imported vendor maps.
