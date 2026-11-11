// request-validation.js - checks for request bodies that reach KeyShot. Each helper either returns clean values or throws
// an Error with status 400, so a typo in a request can never turn exposure, render size or frame rate into NaN/strings
// that then travel into the scene. Kept free of server state so every rule can be unit tested without KeyShot.

const badRequest = message => Object.assign(new Error(message), { status: 400 });

// A required finite number inside [lo, hi]. Strings that hold a number ("1.5") are accepted, because sliders and
// form fields often send strings; anything else (missing, NaN, Infinity, objects) is rejected.
function finiteIn(value, lo, hi, message) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < lo || n > hi) throw badRequest(message);
  return n;
}
// The same check for an optional value: undefined/null mean "use the default".
const optionalFiniteIn = (value, lo, hi, fallback, message) => (value == null ? fallback : finiteIn(value, lo, hi, message));

function exposureValue(value) {
  return finiteIn(value, 0.05, 12, 'Exposure must be a number from 0.05 to 12.');
}

const AUTO_EXPOSE_METRICS = new Set(['p50', 'p95']);
// /api/autoexpose body: { target?, metric?, iterations? }. Defaults stay with the caller (the rig's own target/metric).
function autoExposeOptions(body = {}) {
  const out = {};
  if (body.target != null) out.target = finiteIn(body.target, 0.02, 0.98, 'Auto-exposure target must be a brightness from 0.02 to 0.98.');
  if (body.metric != null) {
    if (!AUTO_EXPOSE_METRICS.has(body.metric)) throw badRequest('Auto-exposure metric must be p50 (median) or p95 (highlights).');
    out.metric = body.metric;
  }
  if (body.iterations != null) out.iterations = Math.round(finiteIn(body.iterations, 1, 8, 'Auto-exposure iterations must be from 1 to 8.'));
  return out;
}

// /api/rig body. Only the options applyRig understands are passed on, each with its type checked.
function rigOptions(body = {}) {
  const out = { mirror: body.mirror === true, useSelectedPart: body.useSelectedPart === true };
  if (body.auto === false) out.auto = false;
  if (body.exposure != null) out.exposure = exposureValue(body.exposure);
  if (body.frameAz != null) out.frameAz = finiteIn(body.frameAz, -3600, 3600, 'Rig frame angle must be a number of degrees.');
  if (body.iterations != null) out.iterations = Math.round(finiteIn(body.iterations, 1, 8, 'Auto-exposure iterations must be from 1 to 8.'));
  return out;
}

// /api/render body: the camera recipe plus output settings. Width/height are rounded to even numbers (video encoders
// need that) after the range check.
function renderOptions(body = {}) {
  const even = n => Math.max(2, Math.round(n / 2) * 2);
  return {
    recipe: body.recipe,
    fps: Math.round(optionalFiniteIn(body.fps, 1, 120, 24, 'Frame rate must be from 1 to 120 fps.')),
    width: even(optionalFiniteIn(body.width, 16, 8192, 1280, 'Render width must be from 16 to 8192 pixels.')),
    height: even(optionalFiniteIn(body.height, 16, 8192, 720, 'Render height must be from 16 to 8192 pixels.')),
    secs: optionalFiniteIn(body.secs, 0.1, 3600, 4, 'Seconds per frame must be from 0.1 to 3600.'),
    samples: body.samples == null || body.samples === '' ? undefined : Math.round(finiteIn(body.samples, 1, 100000, 'Samples must be from 1 to 100000.')),
    keepFrames: body.keepFrames === true,
  };
}

// The renderer writes frame.<n>.png; only those files are deleted after a successful encode.
const RENDER_FRAME_FILE = /^frame\.\d+\.png$/;
const isRenderFrameFile = name => RENDER_FRAME_FILE.test(String(name));

// Saved camera views are stored as keys of a JSON object; keep the names plain so they can never collide with
// object internals such as __proto__.
function viewName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,63}$/u.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name))
    throw badRequest('Name the view with 1–64 letters, numbers, spaces, dots, dashes or underscores.');
  return name;
}

// Product-bounds sanity check. A product does not suddenly grow 3× inside one scene; when it seems to, something other
// than the product was measured and the last good measurement is kept. But when none of the last product's models are
// in the new measurement, a different scene/product is open and the new measurement must win, or every rig would be
// placed around the old product.
function subjectDecision(previousOK, measured) {
  if (!(measured && measured.span > 0) || measured.span > 5000) return previousOK ? 'keep-previous' : 'reject';
  if (!previousOK || !(measured.span > previousOK.span * 3)) return 'accept';
  const before = Array.isArray(previousOK.models) ? previousOK.models : [];
  const now = new Set(Array.isArray(measured.models) ? measured.models : []);
  const sameProduct = before.length > 0 && before.some(name => now.has(name));
  return sameProduct ? 'keep-previous' : 'accept';
}

module.exports = { badRequest, finiteIn, exposureValue, autoExposeOptions, rigOptions, renderOptions, isRenderFrameFile, viewName, subjectDecision };
