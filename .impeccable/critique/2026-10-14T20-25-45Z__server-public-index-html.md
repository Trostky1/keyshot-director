---
target: KeyShot Director Studio and Materials workspaces
total_score: 26
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 1
timestamp: 2026-10-14T20-25-45Z
slug: server-public-index-html
---
# KeyShot Director UI critique

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 2/4 | A disconnected bridge coexists with a “Live scene” label and active editing controls. |
| 2 | Match between system and real world | 3/4 | Photography language is strong; HDRI and Light Layers need plainer help. |
| 3 | User control and freedom | 3/4 | Match has stop/restore and undo; general lighting edits have less recovery. |
| 4 | Consistency and standards | 3/4 | Shared controls are coherent, but old and new CSS layers overlap. |
| 5 | Error prevention | 3/4 | Preservation intent is clear; scene controls remain active while disconnected. |
| 6 | Recognition rather than recall | 3/4 | Labels and examples help, though many options compete at once. |
| 7 | Flexibility and efficiency | 2/4 | Presets and direct controls exist; repetitive work has few keyboard shortcuts. |
| 8 | Aesthetic and minimalist design | 3/4 | The render leads, but the inspector and six visible rigs add noise. |
| 9 | Error recognition and recovery | 2/4 | Photo matching recovers well; offline scene actions can fail after the click. |
| 10 | Help and documentation | 2/4 | Connection help is actionable; several domain terms and controls lack concise in-context help. |
| **Total** | | **26/40** | **Acceptable** |

## Design Specificity Verdict

The workflow is distinctly built around KeyShot: live scene, framing, studio light rigs, reference matching, and reversible scene changes. The silver/white surfaces and restrained blue are calm and readable, but familiar across creative apps. Product specificity comes from workflow and controls more than a unique visual signature.

The detector emitted 11 findings in regex fallback mode: four `broken-image` warnings, six off-ramp font-size advisories, and one flat type hierarchy warning. The four image warnings are false positives: the live preview, chosen reference, and before/after images are assigned dynamically while hidden or deferred. The scanner could not evaluate custom properties, selector matching, or computed contrast. Manual token contrast measured 15.46:1 for main text, 6.39:1 for muted text on the page background, and 5.57:1 for blue on white. No visual overlay was injected because the available browser surface was read-only for page evaluation; no reliable user-visible overlay exists.

## Overall Impression

The user's actual KeyShot render is the right center of gravity, with reference and prompt nearby. The greatest opportunity is turning the long inspector into a guided lighting workspace with trustworthy connection state and a clearer hierarchy between reference match, style presets, and detailed controls.

## What's Working

- The real render leads Studio, and the prompt follows it directly.
- Reference, scene goal, saved style, and request are co-located in Ask Director.
- Matching exposes progress, stop/restore, before/after renders, a recipe download, and undo.
- Material Lab protects source maps and defaults new materials to unassigned.

## Priority Issues

1. **[P1] Disconnected state conflicts with the scene.** The captured view says “KeyShot bridge not running” while retaining a “Live scene” label, a prior render, and active framing and lighting controls (`server/public/index.html:104-105, 1358-1370`). Mark the image as the last preview, show its age/state, and disable bridge-dependent edits until connected. Suggested command: `$impeccable clarify`.
2. **[P2] Too many first-step choices are presented together.** The scene-goal menu has eight options, the lighting panel shows six rigs, and the composer shows five prompt examples. Group less common goals and rigs under “More looks,” and make reference matching the clearest first path. Suggested command: `$impeccable distill`.
3. **[P2] Technical implementation detail competes with lighting decisions.** Explanations of HDRI fill and unsupported native Light Layers take space in the primary inspector (`server/public/index.html:171, 174`). Lead with what users can do; move bridge limitations into contextual help. Suggested command: `$impeccable clarify`.
4. **[P2] Material Lab reads as a long sequence of unrelated tasks.** Library copying, the Material Director composer, and four browsing tabs appear vertically, so users may scroll between selecting a source and directing its change. Suggested command: `$impeccable layout`.
5. **[P2] Design and accessibility details drift across layers.** An older inline monochrome stylesheet remains beneath the newer silver/blue stylesheet; small 9.5–11.5px styles and inline values persist. The scene image has empty alt text, and chat/toast feedback lacks a clear live announcement. Consolidate shared tokens and add semantic status announcements and a scene description. Suggested command: `$impeccable harden`.

## Persona Red Flags

- **Alex, power user:** six lighting rigs and manual light controls are visible together, while repeated camera and light work has no evident shortcut path.
- **Jordan, first-time user:** the composer offers goal, style, reference, prompt, and example chips at once; “HDRI” and “Light Layers” are not explained at the point of use.
- **Sam, access needs:** a screen reader can miss what the live image shows, and asynchronous chat/toast updates are not announced. Light placement has slider controls, but the canvas itself is pointer-driven.

## Minor Observations

- The two workspaces (Studio and Materials) simplify navigation; reference matching is integrated into Ask Director.
- Material Lab has a strong preservation promise and useful texture-set provenance, but the entry screen is long and sparse before browsing tools appear.
- Small-button targets are 30px on desktop and become 44px at phone width; mobile layouts are defined in CSS, but no phone-sized live capture was available.
- Settings provides provider selection and reconnect instructions, but the narrow modal contains many technical path fields.

## Visual Directions to Explore

- **Light Table (recommended):** keep the calm silver/white identity. Give the render the main canvas, pin the selected reference beside it, and make a compact Look inspector with four visible groups: goal, environment, lights, and recovery. Keep Ask Director as one persistent composer. Best balance for current use.
- **Lighting Console:** use a darker, more technical stage around the render, with a small light-role stack (key/fill/rim/background), live parameter controls, and environment brightness beside the canvas. Best for expert manual lighting; denser and more tool-like.
- **Reference Compare:** make reference and live KeyShot render equal peers, with a shared prompt and visible change history below. Keep lighting recipe and controls in a right rail. Best for learning/recreating references; uses more horizontal space and makes the product preview smaller.

## Questions to Consider

- Which should lead the next direction: Light Table, Lighting Console, or Reference Compare?
- Should the next visual pass cover Studio first or bring Studio and Materials into one coherent redesign?
- For concept development, should I work code-first with an interactive prototype or comp-first with a visual design board?
