// Capture/colour contract: keeps linear render data and display-encoded pixels from being compared with each other.
//   linear_exr      scene-linear floating point values from KeyShot's EXR passes (diagnostics, physical ratios)
//   display_srgb    8-bit display-referred pixels: the user's reference photo and KeyShot's PNG beauty previews
// The exact transform KeyShot applies between its linear buffers and its PNG output has NOT been established on the
// installed build (research experiment E04); `srgb` is the documented working assumption and `gamma22` is what this
// project already uses for backdrop colors. Both are exposed so a measured transform can replace the assumption.
const SPACES = Object.freeze({ LINEAR: 'linear_exr', DISPLAY: 'display_srgb' });
const TRANSFORMS = Object.freeze(['srgb', 'gamma22']);

const clamp01 = v => Math.min(1, Math.max(0, v));
function srgbToLinear(v) { const x = clamp01(v); return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }
function linearToSrgb(v) { const x = Math.max(0, v); return x <= 0.0031308 ? clamp01(x * 12.92) : clamp01(1.055 * Math.pow(x, 1 / 2.4) - 0.055); }
const transforms = {
  srgb: { toLinear: srgbToLinear, toDisplay: linearToSrgb },
  gamma22: { toLinear: v => Math.pow(clamp01(v), 2.2), toDisplay: v => clamp01(Math.pow(Math.max(0, v), 1 / 2.2)) },
};
function transform(name = 'srgb') {
  if (!TRANSFORMS.includes(name)) throw new Error(`Unknown display transform: ${name}.`);
  return transforms[name];
}

// Rec. 709 weights, applied in whichever space the caller declares. Display luma is NOT linear luminance.
const lumaOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// A tagged measurement. `space` is mandatory so downstream code cannot compare values it does not understand.
function tagged(space, value, extra = {}) {
  if (!Object.values(SPACES).includes(space)) throw new Error(`Unknown colour space: ${space}.`);
  return { space, value, ...extra };
}
function assertSameSpace(a, b, what = 'values') {
  const sa = a?.space, sb = b?.space;
  if (!Object.values(SPACES).includes(sa) || !Object.values(SPACES).includes(sb)) throw new Error(`Colour space is not declared for the ${what}.`);
  if (sa !== sb) throw new Error(`Refusing to compare ${what} in ${sa} with ${sb}; convert one side explicitly first.`);
  return sa;
}
// Convert a linear RGB triple to display values for comparison with a photographic reference.
function linearRgbToDisplay(rgb, name = 'srgb') { const t = transform(name); return rgb.map(t.toDisplay); }
function displayRgbToLinear(rgb, name = 'srgb') { const t = transform(name); return rgb.map(t.toLinear); }

const CAPTURE_CONTRACT = Object.freeze({
  version: 1,
  reference_photo: { space: SPACES.DISPLAY, note: 'Display-referred, possibly retouched; clipped highlights do not encode source intensity.' },
  beauty_png: { space: SPACES.DISPLAY, note: 'KeyShot PNG preview; transform to linear assumed sRGB-like and unverified (E04).' },
  linear_passes: { space: SPACES.LINEAR, note: 'Single-level tiled ZIP EXR passes only; used for physical diagnostics, never scored against the photograph.' },
  comparison_rule: 'Photograph-to-render scoring uses display_srgb on both sides; linear_exr is compared only with linear_exr.',
});

module.exports = { SPACES, TRANSFORMS, CAPTURE_CONTRACT, srgbToLinear, linearToSrgb, transform, lumaOf, tagged, assertSameSpace, linearRgbToDisplay, displayRgbToLinear };
