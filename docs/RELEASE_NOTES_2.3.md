# KeyShot Director 2.3.0

KeyShot Director 2.3 focuses on a more dependable first run, a simpler texture-to-material path, and a clearer live workspace.

## Material workflow

- Build an unassigned, simple Plastic material from Base Color, Roughness, one Normal or Bump map, and optional AO.
- Advanced material graphs, Metallic layering, procedural relief, and geometry displacement are paused. Unsupported maps are reported while usable maps remain available for the build.
- Material recipe planning now runs in JavaScript. Fresh installs and release packaging do not require Rust, Cargo, or a generated WebAssembly file.
- Material graph creation and KMP export verify the resulting graph or file instead of relying on version-dependent API return values. Imported source maps remain unchanged.

## Workspace and startup

- Studio and Materials have a more consistent scene-first layout, clearer type hierarchy, a more visible live preview, and quiet functional motion.
- When the default port is occupied, the server tries the next nine ports and opens the browser at the address it successfully bound.
- The stop helper verifies its own process marker before stopping a server, reducing the chance of terminating an unrelated Node application.
- Windows CLI calls move long system context to standard input when needed to avoid CreateProcess command-line length failures.

## Verification and known limits

- Automated checks cover the material planner, safe Plastic graph builder, agent tool contract, package contents, CLI command sizing, and port fallback behavior.
- KeyShot graph construction still depends on the scripting APIs exposed by the installed KeyShot release. Review generated materials in KeyShot before assigning them or saving a scene.
- Windows 11 with KeyShot Studio 2026.2 is the verified platform. Physical macOS integration remains unverified.
