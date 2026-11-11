// Request checks that keep malformed values (NaN, strings, out-of-range numbers) from reaching KeyShot.
const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../server/request-validation');

const rejects400 = (fn, pattern) => assert.throws(fn, error => error.status === 400 && (!pattern || pattern.test(error.message)));

test('exposure must be a finite number in range; a missing value no longer becomes NaN', () => {
  assert.equal(v.exposureValue(2), 2);
  assert.equal(v.exposureValue('1.5'), 1.5);
  for (const bad of [undefined, null, '', 'abc', NaN, Infinity, 0, 13, {}]) rejects400(() => v.exposureValue(bad), /Exposure/);
});

test('auto-exposure accepts only known metrics and sane targets', () => {
  assert.deepEqual(v.autoExposeOptions({}), {});
  assert.deepEqual(v.autoExposeOptions({ target: 0.3, metric: 'p95', iterations: 3.4 }), { target: 0.3, metric: 'p95', iterations: 3 });
  rejects400(() => v.autoExposeOptions({ metric: 'p75' }), /metric/);
  rejects400(() => v.autoExposeOptions({ target: 'bright' }), /target/);
  rejects400(() => v.autoExposeOptions({ iterations: 40 }), /iterations/);
});

test('rig options keep only typed values; a string exposure cannot reach toFixed()', () => {
  assert.deepEqual(v.rigOptions({ name: 'hero_soft', mirror: true, exposure: '2', useSelectedPart: true, junk: 1 }),
    { mirror: true, useSelectedPart: true, exposure: 2 });
  assert.deepEqual(v.rigOptions({ auto: false, frameAz: -30, iterations: 2 }), { mirror: false, useSelectedPart: false, auto: false, frameAz: -30, iterations: 2 });
  rejects400(() => v.rigOptions({ exposure: 'loud' }), /Exposure/);
  rejects400(() => v.rigOptions({ frameAz: 'left' }), /frame angle/);
});

test('render options default sensibly, round to even sizes and reject values that would make zero frames', () => {
  const recipe = { keys: [1, 2], duration: 2 };
  assert.deepEqual(v.renderOptions({ recipe }), { recipe, fps: 24, width: 1280, height: 720, secs: 4, samples: undefined, keepFrames: false });
  const r = v.renderOptions({ recipe, fps: '30', width: 1921, height: 1081, secs: 6, samples: 128, keepFrames: true });
  assert.deepEqual([r.fps, r.width, r.height, r.secs, r.samples, r.keepFrames], [30, 1922, 1082, 6, 128, true]);
  rejects400(() => v.renderOptions({ recipe, fps: 'fast' }), /Frame rate/);
  rejects400(() => v.renderOptions({ recipe, width: 0 }), /width/);
  rejects400(() => v.renderOptions({ recipe, secs: -1 }), /Seconds/);
});

test('only rendered frame pictures are deleted after encoding (the old pattern never matched)', () => {
  for (const name of ['frame.1.png', 'frame.24.png', 'frame.1000.png']) assert.equal(v.isRenderFrameFile(name), true, name);
  for (const name of ['move.mp4', 'frame.png', 'frameX1Xpng', 'frame.1.png.bak', 'my-frame.1.png', 'frame.dd.png']) assert.equal(v.isRenderFrameFile(name), false, name);
});

test('saved view names are plain text and never object internals', () => {
  assert.equal(v.viewName('  Hero 3/4 '.replace('/', '-')), 'Hero 3-4');
  assert.equal(v.viewName('Détail_1.b'), 'Détail_1.b');
  for (const bad of [undefined, '', ' ', '__proto__', 'constructor', 'a/b', 'x'.repeat(65), 42]) rejects400(() => v.viewName(bad), /view/);
});

test('product bounds: a sudden 3x growth in the same scene keeps the last good product, a different scene wins', () => {
  const phone = { models: ['Modular Tactile Smartphone'], span: 141 };
  assert.equal(v.subjectDecision(null, phone), 'accept');
  assert.equal(v.subjectDecision(null, { models: [], span: 0 }), 'reject');
  assert.equal(v.subjectDecision(phone, { models: [], span: 0 }), 'keep-previous');
  assert.equal(v.subjectDecision(phone, { models: ['Modular Tactile Smartphone'], span: 300 }), 'accept', 'growth under 3x is normal');
  assert.equal(v.subjectDecision(phone, { models: ['Modular Tactile Smartphone', 'Wall'], span: 900 }), 'keep-previous', 'same product plus something huge');
  assert.equal(v.subjectDecision(phone, { models: ['Espresso Machine'], span: 520 }), 'accept', 'a different product is not ignored any more');
  assert.equal(v.subjectDecision(phone, { models: ['Espresso Machine'], span: 6000 }), 'keep-previous', 'beyond 5 m is never a product');
});
