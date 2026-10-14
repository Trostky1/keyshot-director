// rigs.js - studio lighting rigs, scaled to the product.
// A rig is built in a "stage frame": azimuth 0 = straight at the camera side of the product, positive azimuth
// = camera-right, elevation in degrees, distances / sizes in multiples of the product's largest dimension (span).
// Brightness is set as target illuminance E (lumens per mm^2 at the product) so rigs keep the same exposure
// whatever size the product is or where lights sit:  power(lm) = E * distance_mm^2 * exposure.

const HDRI = {
  allBlack: 'Studio/Basic/All Black 4K.klf',
  allWhite: 'Studio/Basic/All White 4K.klf',
  backdrop: 'Studio/Basic/Studio Backdrop 4K.klf',
  blackCeiling: 'Studio/Basic/Black Ceiling Gradient 4K.klf',
  blackFloor: 'Studio/Basic/Black Floor Gradient 4K.klf',
  threePointMed: 'Studio/3 Point/3 Point Medium 4K.klf',
  threePointDark: 'Studio/3 Point/3 Point Dark 4K.klf',
  overheadPanel: 'Studio/Panels/Overhead/Overhead Panel 4K.klf',
  panelsTilted2: 'Studio/Panels/Side/2 Panels Tilted 4K.klf',
  panelsStraight3: 'Studio/Panels/Side/3 Panels Straight 4K.klf',
  tentOpen: 'Studio/Light Tent/Open/Light Tent White Open 4K.klf',
  tentSpot: 'Studio/Light Tent/Open/Light Tent Spot 4K.klf',
  zebraV: 'Studio/Zebra Stripes/Zebra Stripes Vertical 4K.klf',
  zebraH: 'Studio/Zebra Stripes/Zebra Stripes Horizontal 4K.klf',
};

// L(): one light. az/el degrees, d = distance in spans, w/h = panel size in spans, E = illuminance target.
// E_CAL: calibration from auto-exposure runs on a real scene - the raw E values below came out ~5x too hot, so exposure 1.0
// now starts near correct and auto-exposure only fine-tunes.
const E_CAL = 0.2;
const L = (id, role, az, el, d, w, h, E, kelvin = 5600, extra = {}) => ({ id, role, az, el, d, w, h, E: E * E_CAL, kelvin, refl: true, eye: false, ...extra });

// Per rig: `target` = desired median brightness (0..1, display-encoded) of the product's own pixels, used by
// auto-exposure; `envScales` = exposure also scales the environment brightness (white rigs, where the environment
// does most of the lighting).  Backdrop colours `bg` are DISPLAY colours: KeyShot treats the environment background
// as linear, so buildRig converts them (a "30" asked for here would otherwise render as ~88).
const RIGS = {
  hero_soft: {
    label: 'Hero soft (3-point)', metric: 'p95', target: 0.68,
    blurb: 'Large soft key, gentle fill, thin rim strips and a top light on a dark graphite backdrop. The all-rounder.',
    env: { hdri: HDRI.allBlack, bg: [38, 38, 42], brightness: 1, ground_shadows: true },
    lights: [
      L('key', 'key', -42, 32, 3.2, 2.0, 2.4, 0.0040, 5600),
      L('fill', 'fill', 48, 8, 3.6, 2.6, 2.6, 0.00050, 6200),
      L('rim_r', 'rim', 140, 14, 2.9, 0.34, 3.1, 0.00085, 5600),
      L('rim_l', 'rim', -140, 14, 2.9, 0.34, 3.1, 0.00085, 5600),
      L('top', 'top', 0, 82, 2.5, 2.2, 2.2, 0.0011, 5000),
    ],
  },
  dark_moody: {
    label: 'Dark & moody', metric: 'p95', target: 0.72,
    blurb: 'One big soft key from the side, a cool edge strip behind, near-black backdrop. Glass glows from within.',
    env: { hdri: HDRI.allBlack, bg: [14, 14, 17], brightness: 1, ground_shadows: true },
    lights: [
      L('key', 'key', -62, 22, 3.0, 1.8, 2.8, 0.0042, 4800),
      L('edge', 'rim', 132, 10, 3.0, 0.28, 3.2, 0.0011, 7000),
      L('kick', 'kicker', 28, 4, 3.8, 0.8, 1.6, 0.00045, 3200),
    ],
  },
  glass_edge: {
    label: 'Glass edge-light', metric: 'p95', target: 0.62,
    blurb: 'Tall strips either side so glass edges and facets draw crisp bright lines, plus a soft top. Black backdrop.',
    env: { hdri: HDRI.allBlack, bg: [8, 8, 10], brightness: 1, ground_shadows: true },
    lights: [
      L('strip_l', 'rim', -108, 10, 2.5, 0.3, 3.4, 0.0030, 5600),
      L('strip_r', 'rim', 108, 10, 2.5, 0.3, 3.4, 0.0030, 5600),
      L('back_glow', 'back', 180, 6, 2.6, 1.7, 1.5, 0.0035, 3800),          // behind the bottle: makes the liquid glow
      L('top', 'top', 0, 84, 2.4, 2.0, 2.0, 0.0025, 5200),
      L('front_fill', 'fill', 4, 6, 4.2, 1.4, 1.4, 0.0005, 6000),
    ],
  },
  blank_studio: {
    label: 'Blank studio', metric: 'p50', target: 0.60, envScales: true,
    blurb: 'Clean seamless white: big soft overhead, soft front fill, a gentle key from the side. Even, neutral, honest color. Catalog / e-commerce look.',
    env: { hdri: HDRI.allWhite, bg: [250, 250, 250], brightness: 0.85, ground_shadows: true },
    lights: [
      L('overhead', 'top', 0, 78, 2.6, 3.2, 3.2, 0.0024, 5600),
      L('key', 'key', -36, 34, 3.2, 2.4, 2.4, 0.0020, 5600),
      L('fill', 'fill', 42, 14, 3.6, 2.4, 2.4, 0.0010, 5600),
    ],
  },
  warm_luxe: {
    label: 'Warm luxe', metric: 'p95', target: 0.60,
    blurb: 'Warm key with a cool edge for contrast: golden highlights on a deep brown-black backdrop. Fragrance / spirits feel.',
    env: { hdri: HDRI.allBlack, bg: [30, 21, 17], brightness: 1, ground_shadows: true },
    lights: [
      L('key', 'key', -48, 28, 3.0, 1.9, 2.5, 0.0040, 3000),
      L('edge', 'rim', 128, 12, 3.0, 0.3, 3.2, 0.0010, 6800),
      L('top', 'top', 0, 80, 2.5, 1.8, 1.8, 0.0009, 3400),
    ],
  },
  color_drama: {
    label: 'Color drama', metric: 'p95', target: 0.68,
    blurb: 'A cyan soft key, magenta edge and restrained amber accent on a deep blue-black stage. Adjust each light’s RGB tint to fit the product.',
    env: { hdri: HDRI.allBlack, bg: [6, 9, 20], brightness: 1, ground_shadows: true },
    lights: [
      L('key', 'key', -48, 28, 3.0, 2.0, 2.5, 0.0036, 5600, { rgb: [0.12, 0.60, 1.0] }),
      L('edge', 'rim', 132, 12, 2.9, 0.30, 3.0, 0.0009, 5600, { rgb: [0.82, 0.12, 0.72] }),
      L('warm_kick', 'kicker', 34, 3, 3.5, 0.75, 1.5, 0.00032, 5600, { rgb: [1.0, 0.31, 0.09] }),
    ],
  },
};

// Environment-only looks (KeyShot's own studio HDRIs): fast, no extra geometry.
const ENV_RIGS = {
  hdri_three_point: { label: 'HDRI: 3-point (medium)', hdri: HDRI.threePointMed },
  hdri_overhead: { label: 'HDRI: overhead panel', hdri: HDRI.overheadPanel },
  hdri_side_panels: { label: 'HDRI: 2 side panels', hdri: HDRI.panelsTilted2 },
  hdri_tent: { label: 'HDRI: light tent', hdri: HDRI.tentOpen },
  hdri_zebra: { label: 'HDRI: zebra stripes', hdri: HDRI.zebraV },
  hdri_backdrop: { label: 'HDRI: studio backdrop', hdri: HDRI.backdrop },
};

const rad = d => (d * Math.PI) / 180;
function toPos(center, frameAz, l, span) {
  const az = rad(frameAz + l.az), el = rad(l.el), dist = l.d * span;
  return [
    center[0] + dist * Math.cos(el) * Math.sin(az),
    center[1] + dist * Math.sin(el),
    center[2] + dist * Math.cos(el) * Math.cos(az),
  ];
}

// Expand a rig definition into concrete light specs for the bridge.
function buildRig(name, subject, { frameAz = 0, exposure = 1, mirror = false } = {}) {
  const rig = RIGS[name];
  if (!rig) throw new Error('unknown rig ' + name);
  const span = subject.span, center = subject.center;
  const lights = rig.lights.map(l0 => {
    const l = { ...l0, az: mirror ? -l0.az : l0.az };
    const pos = toPos(center, frameAz, l, span), dist = l.d * span;
    return {
      id: l.id, role: l.role, az: l.az, el: l.el, d: l.d, w: l.w, h: l.h, E: l.E, kelvin: l.kelvin,
      ...(Array.isArray(l.rgb) ? { rgb: l.rgb.slice(0, 3) } : {}),
      pos, target: center, size: [l.w * span, l.h * span],
      power: +(l.E * dist * dist * exposure).toFixed(2),
      visible_refl: l.refl, visible_eye: l.eye,
    };
  });
  return { name, label: rig.label, target: rig.target, metric: rig.metric || 'p50', envScales: !!rig.envScales, env: envFor(rig, exposure), lights };
}

// display colour -> value to hand to KeyShot (its background is treated as linear, then gamma-encoded for display)
const displayToInput = v => Math.round(255 * Math.pow(Math.max(0, Math.min(255, v)) / 255, 2.2));
function envFor(rig, exposure = 1) {
  const e = { ...rig.env, bg: rig.env.bg.map(displayToInput) };
  if (rig.envScales) e.brightness = +(rig.env.brightness * exposure).toFixed(3);
  return e;
}

module.exports = { RIGS, ENV_RIGS, HDRI, buildRig, toPos, envFor };
