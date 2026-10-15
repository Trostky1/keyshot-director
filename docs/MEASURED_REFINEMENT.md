# Measured lighting and material control

## Photo matching

Quick first look still creates one reference-led plan. Measured refinement starts from that plan and keeps a candidate only when a named image objective improves beyond twice the measured repeat variation (with an absolute 0.005 error floor). This error is a heuristic for the chosen objective, not an overall similarity percentage or an estimate of recovered physical lighting.

Open **Measurement region & refinement limits**, enable the reference rectangle, and enter its edges as percentages. Choose Highlight position, Contrast range, or Highlight brightness, and one to three candidates. The rectangle should tightly contain the reference product/detail. With no explicit rectangle or no reliable objective evidence, Director keeps the first plan and explains why. The reference rectangle is user supplied; it is not automatic segmentation.

The render measurement target is one selected part, or whole-product bounds when selection is empty. Perspective projection must be known and unshifted; unsupported/unknown lenses or unusable bounds fail closed. The region clips the Clown mask, beauty measurements, linear passes and paired deltas consistently. Overlapping props/occluders can remain within a projected bounds rectangle: no semantic or pixel-to-object identity is claimed.

Photo beauty previews and diagnostics use the same bounded aspect-derived dimensions (at most 640 pixels per side, even dimensions, minimum 32). Extreme aspect ratios may be rounded. Paired diagnostics require the same target, camera, geometry/material-assignment identity, engine, render settings, dimensions and time budget. Older records without this metadata cannot establish a valid comparison.

Accepted reference aspect ratios are 1:20 through 20:1. Target projection uses the actual rounded capture aspect. Cancellation and time limits are checked between light/environment setters; an individual bridge call or renderer already running must finish before restoration can continue.

Each candidate retains light count/types/IES profiles and camera intent. Optional locks also retain position, power, color, source shape or environment. Failed or rejected candidates reapply the best completed plan; the saved after image and recipe continue to describe that plan. Cancellation, timeout or unrecoverable errors restore the pre-job checkpoint using the existing session undo mechanism. A default job allows two candidates, 12 total preview captures and eight minutes. Rendering already in progress cannot be interrupted by the Node timeout; restoration follows when the bridge returns. Limits count failed capture attempts as well as successful captures.

The recipe includes objectives, budgets, candidate decisions and capture count. Refined diagnostics are supporting evidence; changing products/materials and photographic sets can prevent a useful match. A deterministic objective gate can reject an aesthetically preferable result, so review before saving in KeyShot.

## Material understanding and recovery

Style-folder scoring also uses a Clown mask clipped to the projected target bounds for live renders. Its coordinate search measures baseline repeat noise, requires compatible recorded captures, limits a run to 16 captures/three rounds and a three-minute probe-start deadline, and restores rejected or failed parameter changes to the best values. Reference-folder segmentation remains an inference; a style distance is not a similarity percentage. A render already running may finish after the deadline.

See [Material edit receipts](MATERIAL_EDIT_RECEIPTS.md). The inspector reports actual root Surface/Label/Geometry connections and source provenance. Undo supports a bounded session history of value edits, independent-copy assignments and supported map replacements. Geometry execution, files saved/exported, generated files and material construction are outside that history. Scene identity and current-value/topology checks protect restoration; this is not persistent native KeyShot undo.

## Local verification and remaining live work

Synthetic PNG/EXR tests exercise region measurement, full RGB labels and capture compatibility. Injected workflow tests exercise candidate acceptance, rejection, noise margins, budgets, failures and lock behavior. Fake-lux tests exercise graph provenance and material recovery. These do not establish renderer behavior. No KeyShot scene was queried or modified during implementation. Reloading the updated bridge and controlled live verification remain required before claiming these paths verified on a real scene.
