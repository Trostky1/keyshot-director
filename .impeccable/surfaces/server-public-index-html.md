---
version: 1
slug: "server-public-index-html"
primary_target: "server/public/index.html"
related_targets: ["server/public/director.css", "server/public/photo-ui.js"]
---

# Director studio surface

## Scope and mode

Operate. A premium, scene-first workbench for shaping a real KeyShot scene. The direction contract is the first comment in the page body: the live render leads, native lighting controls stay in the Studio inspector, and one Director brief combines shot goal, reference and prompt. Studio and Materials share one header and one moving live preview. PRODUCT.md owns product constraints and docs/PHOTO_WORKFLOW.md owns workflow detail. DESIGN.md records the current reusable visual system.

## Current composition

The graphite header holds the product name, Studio/Materials navigation, bridge state, provider mode and Settings. Studio uses an elastic live-scene column beside a focused inspector. Lighting setup leads with saved rig, environment brightness, exposure/orientation, native lights and the spatial light map; framing, bridge, video, saved styles and camera motion remain available below. One Director composer follows the scene and combines shot goal, optional reference, saved style, instruction and one submit action. Match evidence, restore and undo remain directly beneath it.

At (980px) and below, Studio stacks the live scene and Director brief above the inspector. At phone width, the header wraps and controls use larger targets. A disconnected scene has enough height for the hookup instruction without colliding with preview controls; a connected scene keeps the (4:3) viewport.

Materials reuses the same header, canvas, live preview and bridge state. The same `#stage` is moved between workspaces, so the product preview remains the real `/api/preview.png` stream. Material Director and the preview occupy the primary column; the inspector shows the actual selected scene material and bridge-exposed parameters. It does not draw a fake node graph or claim to rewire connected inputs. Texture sets, KeyShot library and saved packages use a focused tab row below. Quick copy to the current KeyShot selection is nested inside the library tab; the detailed library workflow retains explicit part selection, map application and save actions.

## Matching and evidence states

The reference picker accepts PNG, JPEG and WebP. When a reference is selected, the user chooses lighting match or Director context. For a lighting match, the shared prompt describes qualities to borrow, optional framing starts unchecked, and visual refinement is the selected default. The shared submit action works with a prompt, reference, or saved style. While a match runs, status and action availability change; Stop & restore remains available, and Undo look becomes available only with a checkpoint. Stop waits for any current native operation before restoration.

A completed look can show before/after actual KeyShot renders, inspectable lighting decisions and limits, preview and recipe downloads, and reversible actions. Downloads are preview quality; the recipe is inspectable JSON, not a native scene. Restored, canceled and failed phases hide the comparison and resynchronize controls. The interface does not claim a similarity score or guarantee.

Reference and preview analysis uses the selected AI provider and local storage, disclosed beside the action. Product geometry and materials remain untouched, and the scene is never saved automatically. Matching cannot reconstruct different materials, physical sets, backplates or HDRIs from lights alone. The rollback camera and one-level undo are session-local; output images and recipes persist. Animation is secondary.

## Evidence and finish status

The approved comp is retained in `docs/ui-redesign-concept/` as a visual reference. Its preview crop and illustrative graph are not shipped as UI assets; the implementation keeps the genuine live render and real material inspector. Existing `.impeccable/review/desktop.jpg` and `mobile.jpg` captures predate this implementation and are historical. Refresh the running app to inspect the current shell. The redesign does not certify photographic matching quality across the user's full set of reference photos.

## Remaining validation

Validate the refreshed app at desktop and phone widths, then exercise workspace switching, live preview orbit, reference selection and the material inspector. Validate actual reference photos, especially reflective or transparent products and cropped details. Selected-part focus is implemented as a spatial target from KeyShot selection and bounds; it still needs live lighting validation and does not identify semantic features. Physical sets/backplates, calibrated render settings and persistent reusable looks remain future work described in PRODUCT.md.
