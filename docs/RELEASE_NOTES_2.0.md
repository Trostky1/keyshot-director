# KeyShot Director 2.0.0

KeyShot Director 2.0 brings reference-led lighting and material workflows into a single companion for KeyShot Studio. It builds editable scene changes through KeyShot's scripting bridge and checks lighting against real KeyShot previews.

## First run on Windows

1. Download the release ZIP from [GitHub Releases](https://github.com/Trostky1/keyshot-director/releases/latest) and extract it to a folder you will keep.
2. Double-click **Install KeyShot Director.bat**. It checks for Node.js 20+, installs the KeyShot script, and creates a desktop shortcut. It does not require administrator access.
3. Start **KeyShot Director** from the desktop. In KeyShot, save your scene, then open **Window -> Scripting** and run **KeyShot Director**.
4. The app shows **KeyShot connected** and the live viewport when the bridge is ready. The disconnected view includes a copy-and-paste hookup command if you need it.

Basic lighting, camera and scene controls work without an AI account. Reference matching and open-ended requests require a signed-in Codex or Claude CLI, or an Anthropic API key. Do not put credentials in the release folder or GitHub.

## What is included

- Combined Studio and Materials workspaces around the live KeyShot scene.
- Reference-image lighting and mood matching with native lights, preview evidence, and reversible changes.
- Adjustable studio rigs, environment brightness, exposure, framing, and selected-part targeting.
- Material-library copies, texture-set workflows, and supported procedural or geometric displacement workflows.
- Camera motion previews and video matching with KeyShot-rendered frames.
- A packaged material compiler; end users do not need Rust.

## Requirements and limits

- KeyShot Studio 2026.x with its Scripting feature available, Node.js 20+, and a current browser.
- Windows 11 is the verified platform. macOS setup is included but has not been verified on a physical Mac.
- Save the scene in KeyShot before connecting. Director does not save it automatically.
- Reference matching is an approximation from available images and scene evidence; lights cannot reproduce different materials, physical sets, or backplates by themselves.
- The companion app must remain running while you use it. The KeyShot bridge runs inside KeyShot and should be left alone while active.
