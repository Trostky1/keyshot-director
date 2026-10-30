# KeyShot Director

A photo-first companion to KeyShot Studio, used alongside its live viewport on a second monitor. The user's own product geometry, materials and renderer remain the source of truth.

## Primary task

Choose a reference product photograph, describe the lighting qualities to borrow, and apply an editable lighting/environment setup to the currently open product. Check the result in actual KeyShot renders; refine visually rather than equating whole-image brightness with photographic similarity. Keep the current angle unless framing changes are requested. Support full-product shots and cropped details.

## Constraints

- KeyShot Studio 2026.2 is the user's installed version. No other scripts/dialogs should run while its bridge is working.
- Preserve product geometry and materials. Never save the user's scene automatically.
- The visual direction is the orchid system (see DESIGN.md and the Figma file "Orchid Style Handoff"): a large real KeyShot scene first, with reference matching and controls in a focused inspector. Use IBM Plex Sans, white and soft grey surfaces with one night-black scene card, a single orange accent, clear hierarchy, and responsive controls. Keep the Home page copy factual: it states real limits and never promises exact matches.
- Matching is an inference, not exact inverse reconstruction. Clearly identify noise, different materials and physical sets/backplates that lights alone cannot recreate.
- Reference and preview images may be sent to the selected signed-in AI provider only as part of the requested matching workflow. Explain this before the action.
- Keep original lights intact; hide them during matching. Use an isolated environment and one intentional native rollback camera per photo job. Undo is session-local, one level; output images and recipe JSON are durable.
- Do not delete preexisting files. Automatic camera deletion is disabled. Existing scratch files are preserved at startup.
- Animation remains available but secondary to still-photo lighting and environment work.

## Primary workflow

Reference + brief → scene inspection and rollback checkpoint → visual lighting plan → custom product-scaled native lights and environment → real renderer preview → optional bounded measured refinement → compare, tune or undo.

Measured refinement requires an explicit reference region and objective. Keep the best result only when comparable target-region evidence improves beyond repeat-render variation. Report projection/occlusion uncertainty and keep the first look when evidence is unavailable. Materials explain actual graph connections and provide verified session recovery only for supported operations.

No reference-matching percentage or unsupported quality guarantee. Final-resolution output remains KeyShot's job in this iteration; downloadable images are explicitly previews.

## Next investment

Validate against the user's actual reference photos, especially dark reflective products, transparent materials and cropped details. Then add selected-part focus, calibrated exposure/render settings, physical set/backplate support, persistent reusable look application and richer animation direction. Image generation may support backplates or mood concepts, but must not substitute for the user's real product render.
