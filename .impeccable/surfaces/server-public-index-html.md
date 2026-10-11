---
version: 1
slug: "server-public-index-html"
primary_target: "server/public/index.html"
related_targets: ["server/public/director.css", "server/public/photo-ui.js"]
---

# Director studio surface

## Scope and mode

Operate. A calm, Apple-inspired companion workspace for shaping a real KeyShot scene. The direction contract is the first comment in the page body: a live render leads, reference matching is one glance away, and conversation refines the scene. PRODUCT.md owns product constraints and docs/PHOTO_WORKFLOW.md owns workflow detail. DESIGN.md records the current reusable visual system.

## Current composition

The desktop page uses a wide scene column and a focused right inspector. The connected bridge and provider appear in a slim header. The scene heading and actual KeyShot render lead the main area; live-preview controls sit inside the stage. Ask Director and its prompt follow directly beneath. The inspector begins with Match a look, then Frame & background, connection/animation disclosures, studio lighting, styles and motion tools. Secondary tools remain available without competing with the scene.

At (800px) and below, the visual order is scene, Match a look, Ask Director, then the remaining tools. The match task becomes its own rounded card. At phone width, the stage is (4:3), the header wraps and controls use larger targets. The CSS implements this order by flattening the layout wrappers for the narrow sequence.

## Matching and evidence states

The reference picker accepts PNG, JPEG and WebP. A brief describes qualities to borrow, optional framing starts unchecked, and visual refinement is the selected default. The primary match action is disabled until its requirements are met. While running, status and action availability change; Stop & restore remains available, and Undo look becomes available only with a checkpoint. Stop waits for any current native operation before restoration.

A completed look can show before/after actual KeyShot renders, inspectable lighting decisions and limits, preview and recipe downloads, and reversible actions. Downloads are preview quality; the recipe is inspectable JSON, not a native scene. Restored, canceled and failed phases hide the comparison and resynchronize controls. The interface does not claim a similarity score or guarantee.

Reference and preview analysis uses the selected AI provider and local storage, disclosed beside the action. Product geometry and materials remain untouched, and the scene is never saved automatically. Matching cannot reconstruct different materials, physical sets, backplates or HDRIs from lights alone. The rollback camera and one-level undo are session-local; output images and recipes persist. Animation is secondary.

## Evidence and finish status

Final visual evidence: `.impeccable/review/desktop.jpg` and `.impeccable/review/mobile.jpg`. These show the current silver/white, blue-action layout with a genuine KeyShot product render. They are review captures, not shipping image assets. The supplied review verdict is ship on scored fixes; it does not certify photographic matching quality across the user's full set of reference photos.

## Remaining validation

Validate against the user's actual reference photos, especially reflective or transparent products and cropped details. Selected-part focus, physical sets/backplates, calibrated render settings and persistent reusable looks remain future work described in PRODUCT.md.
