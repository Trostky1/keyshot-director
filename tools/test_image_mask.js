// Stage B (research E06, offline half): one mask applied symmetrically to the reference and the render, transparent-region
// exclusion, and the display/linear colour contract. Synthetic PNG fixtures only; no KeyShot, no real photographs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { normalizeMask, contains, forEachMasked, polygonArea } = require('../server/image-mask');
const { referenceMetrics, objectiveScore, settings } = require('../server/photo-refinement');
const { analyzeCapture } = require('../server/lighting-evidence');
const colour = require('../server/colour-contract');
const { encodePng } = require('./png_fixture');

const FULL = { x0: 0, y0: 0, x1: 1, y1: 1 };
const blob = (x, y) => x >= 8 && x < 36 && y >= 8 && y < 22;            // the real highlight
const distractor = (x, y) => x >= 48 && x < 60 && y >= 48 && y < 60;    // a bright prop / backdrop patch
const scene = (x, y) => blob(x, y) ? [230, 230, 230] : distractor(x, y) ? [250, 250, 250] : [70, 70, 70];
const referencePng = encodePng(64, 64, scene);
const clownPng = encodePng(64, 64, (x, y) => x >= 10 && x < 40 && y >= 6 && y < 30 ? [200, 50, 50] : [0, 0, 0]);   // product label covers only part of the frame
const target = { id: 'whole-product', identity: 'fixture-bounds', region: FULL };
function capture(t, beautyPng = referencePng) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-mask-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = [['beauty', beautyPng], ['clown', clownPng]].map(([pass, bytes]) => { const file = path.join(dir, pass + '.png'); fs.writeFileSync(file, bytes); return { pass, path: file }; });
  return files;
}
const close = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} vs ${b}`);

test('mask normalization validates shape, rejects crossing or tiny polygons and is idempotent', () => {
  assert.equal(normalizeMask(null), null);
  const rect = normalizeMask({ kind: 'rect' });
  assert.deepEqual(normalizeMask(rect), rect, 're-normalizing a canonical mask keeps its signature');
  const poly = normalizeMask({ points: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]], exclude: [[[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]]] });
  assert.equal(poly.kind, 'polygon'); assert.ok(polygonArea(poly.points) > 0.6);
  assert.notEqual(poly.signature, rect.signature);
  assert.equal(normalizeMask({ points: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]], exclude: [[[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]]] }).signature, poly.signature, 'signature is stable');
  assert.throws(() => normalizeMask({ points: [[0, 0], [1, 1], [1, 0], [0, 1]] }), /cross itself/);
  assert.throws(() => normalizeMask({ points: [[0, 0], [0.05, 0], [0.05, 0.05]] }), /too small/);
  assert.throws(() => normalizeMask({ points: [[0, 0], [2, 0], [1, 1]] }), /within 0 to 1/);
  assert.throws(() => normalizeMask({ kind: 'rect', points: [[0, 0], [1, 0], [1, 1]] }));
  assert.throws(() => normalizeMask({ kind: 'blob' })); assert.throws(() => normalizeMask({ polygon: [] })); assert.throws(() => normalizeMask('x'));
  assert.throws(() => normalizeMask({ exclude: Array.from({ length: 9 }, () => [[0, 0], [0.2, 0], [0.2, 0.2]]) }));
});
test('containment honours polygons and excluded holes, and iterates in rectangle-relative coordinates', () => {
  const mask = normalizeMask({ points: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]], exclude: [[[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]]] });
  assert.equal(contains(mask, 0.2, 0.6), true); assert.equal(contains(mask, 0.2, 0.2), false); assert.equal(contains(mask, 0.8, 0.5), false); assert.equal(contains(null, 5, 5), true);
  const seen = []; forEachMasked(normalizeMask({ kind: 'rect' }), { x0: 0.5, y0: 0.5, x1: 1, y1: 1 }, 8, 8, 1, (x, y, u, v) => seen.push([x, y, u, v]));
  assert.equal(seen.length, 16); assert.deepEqual(seen[0], [4, 4, 0.125, 0.125]);
});
test('the reference and the render are scored on identical pixels, unlike the legacy Clown-product statistics', t => {
  const mask = normalizeMask({ kind: 'rect' });
  const ref = referenceMetrics(referencePng, FULL, mask);
  const evidence = analyzeCapture(capture(t), { measurement_target: target, mask });
  assert.equal(evidence.masked_beauty.mask_signature, ref.mask_signature);
  for (const key of ['p05_luma', 'p50_luma', 'p95_luma']) close(evidence.masked_beauty[key], ref[key]);
  close(evidence.masked_beauty.highlight.x, ref.highlight.x); close(evidence.masked_beauty.highlight.y, ref.highlight.y);
  assert.equal(evidence.masked_beauty.sampled_pixels, ref.sampled_pixels);
  assert.equal(evidence.masked_beauty.colour_space, 'display_srgb'); assert.equal(ref.colour_space, 'display_srgb');
  // The legacy render statistic sees only the Clown product label, so it cannot agree with an all-pixels reference.
  close(evidence.masked_beauty.mean_luma, ref.mean_luma);
  assert.ok(Math.abs(evidence.product.mean_luma - ref.mean_luma) > 0.05, 'the legacy Clown-product mean covers different pixels than the all-pixels reference mean');
});
test('a polygon mask removes a bright distractor from BOTH sides', t => {
  const rectMask = normalizeMask({ kind: 'rect' }), left = normalizeMask({ points: [[0, 0], [0.6, 0], [0.6, 1], [0, 1]] });
  const whole = referenceMetrics(referencePng, FULL, rectMask), masked = referenceMetrics(referencePng, FULL, left);
  const render = analyzeCapture(capture(t), { measurement_target: target, mask: left }).masked_beauty;
  close(render.highlight.x, masked.highlight.x); close(render.highlight.y, masked.highlight.y);
  assert.ok(masked.highlight.x < 0.5 && masked.highlight.y < 0.3, 'highlight sits on the real blob');
  assert.ok(whole.highlight.x > masked.highlight.x + 0.05, 'without the mask the distractor drags the highlight centroid');
});
test('objective scoring uses the masked statistics and fails closed on any mismatch', () => {
  const mask = normalizeMask({ kind: 'rect' }), ref = referenceMetrics(referencePng, FULL, mask);
  const evidence = (overrides = {}) => ({ available: true, measurement_scope: { kind: 'projected_bounds_roi' }, masked_beauty: { ...ref, mask_signature: mask.signature, colour_space: 'display_srgb', ...overrides } });
  assert.ok(objectiveScore(evidence(), ref, 'highlight_position') < 1e-9);
  assert.ok(objectiveScore(evidence({ highlight: { x: ref.highlight.x + 0.2, y: ref.highlight.y } }), ref, 'highlight_position') > 0.19);
  assert.ok(objectiveScore(evidence({ p95_luma: ref.p95_luma - 0.1 }), ref, 'tone') > 0.09);
  assert.equal(objectiveScore(evidence({ mask_signature: 'other' }), ref, 'tone'), null);
  assert.equal(objectiveScore(evidence({ colour_space: 'linear_exr' }), ref, 'tone'), null);
  assert.equal(objectiveScore({ ...evidence(), masked_beauty: undefined }, ref, 'tone'), null, 'old records without masked statistics cannot be scored against a masked target');
  assert.equal(objectiveScore(evidence(), ref, 'highlight_position', null) < 1e-9, true);
});
test('excluding transparent areas needs an alpha reference and is mirrored by the Clown object mask on the render', t => {
  const alphaPng = encodePng(64, 64, (x, y) => { const c = scene(x, y); return [...c, distractor(x, y) ? 0 : 255]; }, { alpha: true });
  const plain = normalizeMask({ kind: 'rect' }), cutout = normalizeMask({ kind: 'rect', exclude_transparent: true });
  assert.notEqual(plain.signature, cutout.signature);
  assert.throws(() => referenceMetrics(referencePng, FULL, cutout), /alpha channel/);
  const kept = referenceMetrics(alphaPng, FULL, plain), cut = referenceMetrics(alphaPng, FULL, cutout);
  assert.equal(kept.sampled_pixels - cut.sampled_pixels, 144);
  assert.ok(cut.mean_luma < kept.mean_luma, 'the transparent bright patch no longer lifts the reference mean');
  const withFlag = analyzeCapture(capture(t), { measurement_target: target, mask: cutout }).masked_beauty;
  const withoutFlag = analyzeCapture(capture(t), { measurement_target: target, mask: plain }).masked_beauty;
  assert.equal(withFlag.sampled_pixels, 30 * 24, 'only pixels labelled as the rendered object remain');
  assert.equal(withoutFlag.sampled_pixels, 64 * 64);
});
test('masks are expressed relative to the measurement rectangle on both sides', t => {
  const polygon = normalizeMask({ points: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]] });
  const rect = { x0: 0, y0: 0, x1: 0.5, y1: 1 };   // left half of the frame only
  const ref = referenceMetrics(referencePng, rect, polygon);
  const render = analyzeCapture(capture(t), { measurement_target: { ...target, region: rect }, mask: polygon }).masked_beauty;
  assert.equal(render.sampled_pixels, ref.sampled_pixels); assert.equal(render.sampled_pixels, 16 * 64);
  close(render.p95_luma, ref.p95_luma);
});
test('default settings share one whole-rectangle mask; a mask without a region is refused', () => {
  assert.equal(settings({ reference_region: FULL }).mask.kind, 'rect');
  assert.equal(settings({}).mask, null);
  assert.throws(() => settings({ mask: { kind: 'rect' } }), /needs a reference region/);
  assert.equal(settings({ reference_region: FULL, mask: { points: [[0, 0], [1, 0], [1, 1]] } }).mask.kind, 'polygon');
});
test('the colour contract keeps linear EXR data and display pixels apart', () => {
  assert.deepEqual(colour.SPACES, { LINEAR: 'linear_exr', DISPLAY: 'display_srgb' });
  for (const name of colour.TRANSFORMS) for (const v of [0, 0.01, 0.18, 0.5, 1]) close(colour.transform(name).toDisplay(colour.transform(name).toLinear(v)), v, 1e-9);
  close(colour.srgbToLinear(0.5), 0.21404114, 1e-6); close(colour.linearToSrgb(0.18), 0.4613561, 1e-6);
  assert.ok(colour.lumaOf(...colour.displayRgbToLinear([0.2, 0.5, 0.8])) < colour.lumaOf(0.2, 0.5, 0.8), 'display luma is not linear luminance');
  const a = colour.tagged(colour.SPACES.DISPLAY, 0.5), b = colour.tagged(colour.SPACES.LINEAR, 0.5);
  assert.equal(colour.assertSameSpace(a, a), 'display_srgb');
  assert.throws(() => colour.assertSameSpace(a, b), /Refusing to compare/);
  assert.throws(() => colour.assertSameSpace(a, { value: 1 }), /not declared/);
  assert.throws(() => colour.tagged('hdr', 1)); assert.throws(() => colour.transform('pq'));
  assert.equal(colour.CAPTURE_CONTRACT.linear_passes.space, colour.SPACES.LINEAR); assert.equal(colour.CAPTURE_CONTRACT.beauty_png.space, colour.SPACES.DISPLAY);
  assert.match(colour.CAPTURE_CONTRACT.comparison_rule, /display_srgb on both sides/);
});
