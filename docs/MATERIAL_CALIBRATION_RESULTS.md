# KeyShot material calibration results

Date: 2026-10-14. Status: live disposable-scene experiment completed in KeyShot Studio 2026.2.

## Scope and protection

The run used a synthetic UV-mapped 100 mm plane, 100 mm rounded cube, and 100 mm cylinder. Before any experiment, the original open KeyShot scene was copied to `bridge/shots/Calibration-20261014-220836/PluginTest_checkpoint.bip`. Calibration never saved over the original scene. At the end, this checkpoint copy was reopened and verified: millimeter units, five geometry objects, 241,948 triangles, 57 NURBS, and the saved Rounded Cube, Cube, Torus, Cylinder, and Sphere material assignments intact.

The working calibration folder is `bridge/shots/Calibration-20261014-220836/`; generated maps are under `materials/texture-sets/KD_Calibration_20261014_220836/`. These assets are locally ignored. Files named `*_pre_explicit.bip` capture the state immediately before the explicit geometry call; KeyShot had already reevaluated the geometry when the material was assigned.

## Runtime and capture settings

- KeyShot display version 2026.2; internal version `(15, 1, 2, 7)`.
- Embedded Python 3.13.12, 64-bit.
- Calibration scene units: millimeters. Flat baseline: 3 objects and 3,656 triangles.
- Plane bounds before displacement: X `[-210,-110]` mm, Y `0` mm, Z `[-50,50]` mm; 100×100 mm with authored UVs.
- Fixed grazing camera position `[-160,35,200]` mm, FOV 28 degrees.
- Render engine 0, Default image style, Environment brightness 1, output 1280×960, alpha disabled, 2-second render limit. Actual calls took about 3.0–3.5 seconds.
- Flat repeat noise: mean absolute difference 0.0747, p95 1, max 3; one pixel exceeded 2 code values.

## Mapping and channel registration

Mapping enum value 4 was the only tested value from 0–7 that followed authored UVs on both the plane and cylinder. With a 10 mm checker, it produced the designed repeat count. This is evidence for UV-bearing meshes only; it does not make value 4 a safe universal mapping mode.

On the live Texture Map node, `uv_mapping` displayed as “Mapping Type”; `texture_space=1` displayed as “Center On”; `uv_scale_mode=2` displayed as “Scale Mode”; and `uv_scale_u/v` displayed as Width/Height. With mode 2 and scale 1, the checker matched the UV layout. Doubling U or V doubled repeats on that axis; a 0.5 shift moved half a UV tile; 90 degrees rotated the pattern. Switching scale mode 0→1→2 changed stored scale values between 1 and 0.001, but the meanings of the other modes and general physical units remain unresolved.

Base Color, Roughness, and Normal maps aligned on the rounded cube after all three Texture Map nodes were explicitly set to mapping 4 with equal scale, shift, and angle. KeyShot did not share this choice automatically across graph nodes. OpenGL and DirectX normal variants produced image differences above repeat noise; no normal-specific inversion parameter appeared on the live graph. UV flip controls are coordinate flips and must not be treated as a normal green-channel switch.

## Color and scalar data interpretation

Toggling `texture_use_profile` on a Base Color PNG with an embedded sRGB profile produced no measurable difference above repeat noise in the plane ROI (mean absolute difference about 0.248, p95 1). Toggling the same parameter on an embedded-profile 16-bit height TIFF also produced identical geometry bounds.

A direct Texture Map → Displace test exposed a square transfer for synthetic grayscale data. At 0.03 mm height and offset 0.5, measured plane Y bounds imply these sample values:

| Stored grayscale value | Value inferred at displacement | Measured Y position |
| ---: | ---: | ---: |
| 0.00 (16-bit TIFF) | 0.00 | -0.015000 mm |
| 0.25 (16-bit TIFF) | 0.0625 | -0.013125 mm |
| 0.50 (16-bit TIFF) | 0.25 | -0.007500 mm |
| 0.75 (16-bit TIFF) | 0.5625 | +0.001875 mm |
| 1.00 (16-bit TIFF) | 1.00 | +0.014999 mm |
| 128/255 (8-bit PNG) | 0.251965 | -0.007441 mm |

These points follow approximately `decoded = stored²` for both tested 8-bit PNG and 16-bit TIFF. The embedded profile was 588 bytes; setting profile use on or off did not change the 16-bit result. The inspected 2026.2 Texture Map node has no `texture_use_srgb` parameter. The Color Adjust node has no Gamma parameter, and the inspected scripting module exposed no gamma/linear shader constant.

As confirmation, a 16-bit TIFF value of 46,340/65,535 = 0.707103 (square 0.499995) produced Y bounds about -0.00000062 mm with offset 0.5 and 0.03 mm height. This shows that a square-root-encoded derived test map neutralizes this fixture in this build. It does not authorize rewriting or automatically transforming imported vendor data; TIFF/EXR decoders and asset conventions need verification first.

## Displacement height and resolution

The generated 16-bit ramp was connected directly to a Displace node wired to root Geometry. `resolution in pixels=false`, native resolution 0.0002 for primary trials, max triangles 1.0 million, offset 0.5, UV mapping 4, map scale 1.

| Requested height | KeyShot API value (m) | Resolution value | Scene triangles after assignment | Plane Y bounds (mm) |
| ---: | ---: | ---: | ---: | ---: |
| 0.01 mm | 0.000010 | 0.0002 | 822,656 | -0.0049997 to +0.0048824 |
| 0.03 mm | 0.000030 | 0.0002 | 822,656 | -0.0149990 to +0.0146472 |
| 0.10 mm | 0.000100 | 0.0002 | 822,656 | -0.0499965 to +0.0488241 |
| 0.10 mm | 0.000100 | 0.0004 | 413,056 | -0.0499965 to +0.0488241 |

Bounds scaled linearly with the requested height. Doubling the native resolution value approximately halved the scene triangle count on this fixture without changing height bounds. This is one sampling measurement, not a universal rule for other meshes. The one-million-triangle target was not reached.

**Assignment-side effect:** applying each displacement graph changed the scene from 3,656 to 822,656 triangles before the bridge's explicit geometry call. `MaterialGraph.executeGeometryNodes()` then succeeded, but bounds and triangle counts stayed the same. Before/after explicit-call renders had p95 absolute pixel difference 1 and no pixels above 8 code values. The explicit operation was effectively unchanged in the measured fixture; assignment had already evaluated geometry.

A constant 16-bit map storing 0.5 did not stay flat. With height 0.03 mm, offset 0.5 produced -0.0075 mm and offset 0 produced +0.0075 mm. This matches a sampled value of 0.25. With the square-root-encoded map, offset 0.5 produced near-zero bounds. Offset is meaningful in decoded-value space, not guaranteed to neutralize a file's stored midpoint.

## Recovery and evidence files

Each height/offset/resolution family began by reopening the flat checkpoint and verified 3,656 triangles before the next trial. A transient bridge command-file permission error interrupted one mid-gray readback; its recovery path reopened the flat checkpoint, and the scalar sweep completed successfully afterward.

| Artifact | SHA-256 |
| --- | --- |
| Flat displacement baseline BIP | `113B83CC7BC45189F40293B60E09D19E54182AE824A8462BE6E489F4E281FDB8` |
| Fixture OBJ | `1FBC66FFC20305DD07132053EC802715C187B655C62FBABD165E1A16B8A3CF4F` |
| 10 mm checker PNG | `3F202FB409072393A363A47FED3D0B657A24BCC5A8968565BF05327A7431D152` |
| 16-bit height ramp TIFF | `09141753D36E6B2952B6DE05EFAEF5C572A2639BB89ABDEDE1B5FB0F448B542A` |
| 16-bit mid-gray TIFF, stored 32768 | `658F17B8DB6F58CB70FDE277EFBF1B352E6DA3F06FEC2C5DE741FF63C2E450DA` |
| 16-bit encoded-neutral TIFF, stored 46340 | `CCE5F10CF99B32B2D80D9BC9DE2491D0E1992AF8143BC53C59EE0A6D6C1CC52D` |



Saved test-scene and graph snapshots (SHA-256):

| Pre-explicit BIP | SHA-256 |
| --- | --- |
| `displacement_ramp_pre_execute.bip` | `34F949AC175A0ACDD302B7CA84BBCC62A1E4602B72108E97E708742C87F5A4A1` |
| `ramp_0p03_pre_explicit.bip` | `FE199EB91C207109C828B25E16B70BD2C67035850D7BA83423C3165CA763972C` |
| `ramp_0p1_pre_explicit.bip` | `34F70B29CEA45ED4DDCDCF26019D2E6E3B46E7E599A2D795044AAC8323FFC0E6` |
| `ramp_0p1_res04_pre_explicit.bip` | `710115ECEE4960FDB8B46939E2C83DE2FC10E1EA30273EB64426ED03930FD7B3` |
| `midgray_offset05_pre_explicit.bip` | `A42B316EE1FF59109E21E1735DAFAA4688D995E5FB0A4B23EA897CBC97F511B6` |
| `midgray_offset0_pre_explicit.bip` | `C947C2AAC7AC124E8BA9D43126C4120A3A3B45EFAAC36CD1AAFB76E8C63EE3B6` |

Scalar-sweep source files (SHA-256):

| Source map | SHA-256 |
| --- | --- |
| `height_constant_p00_16bit.tif` | `586E275A4C8427027E4221492863402B5BECAC8FB2A828B25452898597BA6E85` |
| `height_constant_p25_16bit.tif` | `526895C36D3575AAB24CD50FD2EE2CA9ABE9A63A573A60A1D2EA3A1EF7CB263C` |
| `height_constant_p50_16bit.tif` | `658F17B8DB6F58CB70FDE277EFBF1B352E6DA3F06FEC2C5DE741FF63C2E450DA` |
| `height_constant_p75_16bit.tif` | `7523C4D95A10465D95E90DE9D3344F6A4A5DD1EBDB445281ED6DF1C82A51D787` |
| `height_constant_p100_16bit.tif` | `46B11126EEF9CFE3049935AC95D87223935953BDC04990158E5D5A73F4143146` |
| `height_constant_p50_8bit.png` | `9C74E290A54E181C6C08AE30D07388B101E3E178D6150E4241492B60DE51FAB9` |
| `height_constant_p50_srgb_16bit.tif` | `87ECA58318CEE6D991F35CBFAC458C7C779E3B56AA05E239AF789E235BE22B1D` |

The folder contains per-trial BIP checkpoints and PNG captures, plus earlier mapping, registration, profile, and normal-map captures. The full saved production-scene checkpoint checksum is 2331D4F4AB51678747527A13574004F9347B255B6543217FFFCFCA897E086808.

## Decisions and next calibration

- Do not set mapping 4 globally. Use it only when UVs are known, or add an explicit mapping choice and fallback.
- Do not claim direct Texture Map scalar inputs are linear in this 2026.2 build. Investigate a supported graph-level correction or an explicit derived-map workflow that preserves the original source; test actual vendor TIFF and EXR files before adopting it.
- Keep height, offset, and sampling controls separate. A stored-map midpoint is not a reliable neutral criterion until the decoded transfer is known.
- Keep the single-part execution guard. Update UI messaging if assigning a displacement material can itself reevaluate geometry; the explicit bridge call did not add measured changes on this fixture.
- Next, inspect the user's saved material graphs read-only and repeat scalar/offset tests with representative vendor TIFF and EXR maps on a disposable plane and curved part. Do not calibrate in the production scene.
