# KeyShot Director 3.0.0

KeyShot Director 3.0 is a visual release. The whole interface now follows the orchid design system, and a Home page explains what Director does and how to connect it. The workflows from 2.4 (Material Lab folder import, reference-lighting groundwork, reconstruction milestone 1) are unchanged.

**Verification status.** The redesign was checked in a browser at 1440 and 390 pixels with KeyShot not connected, and passes the uimaster lint and inspector gates. Screens that only appear with a live scene (added lights, the lighting-match result with before and after images, the live material inspector) inherit the new styles but were not seen restyled. Review them with KeyShot connected.

## What is new

- **Orchid design system.** IBM Plex Sans (bundled, SIL OFL 1.1), white and soft surfaces, one night-black scene card and a single orange accent. Tokens, text styles, 36 components and desktop and phone screens live in the Figma file "Orchid Style Handoff"; `DESIGN.md` records the rules.
- **One radius system.** 16px containers, 12px nested blocks, fields and images, pill controls, circle dots. No square boxes.
- **Home page.** A hero with a real fragment of the Lighting setup panel (replaced by the live preview once KeyShot is connected), how it works, limits and boundaries in plain text, and a FAQ. Open it from the Home link; Studio is still the page the app opens on.
- **Phone layout.** A logo and burger bar that opens a full-screen menu, 44px controls and a 20px gutter.
- **Progress bar.** A thin orange bar in the top bar animates while a request or lighting match is running, and respects reduced motion.
- **Accessibility fixes from the audit.** Darker accent for text (4.5:1 or better), a readable setup-command box, sentence-case labels and one disclosure style.

## Under the hood

- `server/public/orchid.css` loads after `director.css`, scoped by `body.orchid`. Markup, ids and scripts are unchanged except for the new Home page, the header and the heading pills.
- The server serves `.woff2` files; the release package includes `orchid.css` and the font with its licence note.

## Known limits

- Windows 11 with KeyShot Studio 2026.2 is the verified platform. Physical macOS integration remains unverified.
- The Home page and the Figma file differ in a few places: the audit replaced placeholder imagery, glows and decorative cards on Home with plain text, and the Figma file has not been updated.
- Everything listed under known limits in the [2.4 release notes](RELEASE_NOTES_2.4.md) still applies.
