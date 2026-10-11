# Scene staging in KeyShot Director

Use the existing prompt box with the signed-in Codex or Claude CLI. The CLI receives
the same tool definitions as the API engine, plus a scene-staging playbook on every
turn. It must inspect live IDs, product dimensions, hierarchy and units first.

Try:

- “Duplicate the whole phone twice and make a staggered lineup. Keep materials linked.”
- “Lift the original phone 20 mm and tilt it backward 15 degrees.”
- “Put a neutral pedestal beneath the phone, with a thin floor and flat backdrop.”
- “Move the second copy farther right, keeping the original where it is.”
- “Undo the last staging change.”

The existing lighting, reference-photo matching, environment and camera tools can
then light/frame this geometry. Background color/HDRI changes are not physical set
geometry. A generated image is not a 3D prop.

## Tool contract

`scene_objects` returns numeric node IDs, names, kinds, parent IDs, world bounds,
dimensions, hidden/locked flags, ownership, scene units and staging undo count.
The default inventory lists models/set pieces in pages of eight. Pass node_id to
inspect that assembly's immediate parts/groups; use next_offset for further pages.
Select the product MODEL node for whole-assembly operations. Child/group selection
is available for explicit part work. Lights, root/model sets, cameras and animations
are excluded. Locked geometry is rejected, not automatically unlocked.

`move_object`: node_id; optional translation [X,Y,Z], rotation [X,Y,Z], uniform scale,
or position [X,Y,Z]. Translation is a world delta; position is the desired center
and overrides translation. Rotation is incremental degrees, X then Y then Z, about
the current assembly bounding center. Y is up. Scale is a multiplier, 0.1–10.

`duplicate_object`: node_id, count (1–8 ADDITIONAL copies), offset [X,Y,Z], optional
rotation [X,Y,Z], linked_materials (default true). Offset and rotation accumulate
for each copy. Returned node IDs identify the new assemblies.

`create_set_piece`: kind pedestal/floor/backdrop, size [width,height,depth], center
position and optional rotation. These are neutral diffuse boxes. Floors/backdrops
are thin boxes, not curved sweeps. Set-material editing and complex props are not
implemented. Edit their materials in KeyShot. The importer supplies the default
material; no product material is reassigned.

All coordinates use the native scene coordinate system reported by scene_objects;
do not assume millimeters without inspecting scene.unit/unitScale. Refresh the
inventory after staging. Product-size caches are invalidated after every mutation.

`undo_staging` reverses ONE geometry operation, with 20 checkpoints retained inside
the running KeyShot Python session. Geometry uses a world-to-local assembly transform
and its exact inverse for undo, including NURBS groups. Native assembly-bound caches
are refreshed after changes. Undo removes only recorded staging-created
identities, never objects merely sharing a prefix. Undo refuses removal if the
created assembly now contains geometry not created by staging. Save/open/restart
changes can invalidate native checkpoints: undo is not a substitute for saving.
Undo also refuses to overwrite geometry transforms edited outside Director or to
transform an assembly whose geometry membership changed after the checkpoint.

Photo undo restores lighting/environment/camera only. Studio off removes app lights
and restores its environment only. Neither removes staged product copies/set pieces.
Unused materials from imported sets or independent-material copies are intentionally
not purged; deleting a material that another scene object might use is unsafe.

## Local API

- GET /api/scene: read the live inventory; optional node_id and offset query fields.
- POST /api/staging: action move/duplicate/set/undo with the tool fields above.

Mutations use the existing origin protection and busy-job checks. The API remains
a trusted-local-network companion, not a public Internet service.

## Verification

`node tools/test_staging_live.js` is an opt-in live scene integration test. It checks
assembly translation, center-relative rotation/scale, duplication and linked
materials, pedestal/floor/backdrop sizes, undo and original material preservation.
Each successful test operation is undone in a finally block. Do not run it while
another job or an unrelated user edit is in progress. It does not save the scene.
