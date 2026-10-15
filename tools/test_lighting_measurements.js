const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { crc32 } = require('../server/png');
const { analyzeCapture, compareCaptures, normalizeTarget } = require('../server/lighting-evidence');
const { createLightingLab } = require('../server/lighting-lab');

function png(width, height, pixel) {
  const chunk = (type, data) => {
    const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, b.length - 4)), b.length - 4); return b;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) Buffer.from(pixel(x, y)).copy(raw, y * (width * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// A real, single-tile ZIP EXR with one float luminance channel.
function exr(width, height, pixel) {
  const attr = (name, type, data) => { const n = Buffer.from(name + '\0' + type + '\0'), size = Buffer.alloc(4); size.writeUInt32LE(data.length); return Buffer.concat([n, size, data]); };
  const window = Buffer.alloc(16); window.writeInt32LE(width - 1, 8); window.writeInt32LE(height - 1, 12);
  const tiles = Buffer.alloc(9); tiles.writeUInt32LE(width); tiles.writeUInt32LE(height, 4);
  const channel = Buffer.alloc(19); channel.write('Y'); channel.writeInt32LE(2, 2); channel.writeInt32LE(1, 10); channel.writeInt32LE(1, 14);
  const prefix = Buffer.alloc(8); prefix.writeUInt32LE(20000630); prefix.writeUInt32LE(514, 4);
  const header = Buffer.concat([prefix, attr('dataWindow','box2i',window), attr('compression','compression',Buffer.from([3])), attr('tiles','tiledesc',tiles), attr('channels','chlist',channel), Buffer.from([0])]);
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.writeFloatLE(pixel(x,y), (y * width + x) * 4);
  const shuffled = Buffer.alloc(raw.length), half = Math.ceil(raw.length / 2);
  for (let i = 0; i < raw.length; i++) shuffled[i % 2 ? half + (i >> 1) : i >> 1] = raw[i];
  const predicted = Buffer.from(shuffled);
  for (let i = predicted.length - 1; i > 0; i--) predicted[i] = (shuffled[i] - shuffled[i-1] + 128) & 255;
  const data = zlib.deflateSync(predicted), tile = Buffer.alloc(20); tile.writeUInt32LE(data.length, 16);
  const offset = Buffer.alloc(8); offset.writeBigUInt64LE(BigInt(header.length + 8));
  return Buffer.concat([header, offset, tile, data]);
}
const target = { id: 'part:7', identity: 'part-7-bounds-v1', region: { x0: 0, y0: 0, x1: 0.5, y1: 1 } };
function fixtures(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'director-measurement-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const capture = (name, right, labels = x => x < 2 ? [200,100,20] : [210,110,30]) => {
    const files = [['beauty', png(4, 2, x => x < 2 ? [50,50,50] : [right,right,right]), 'png'], ['clown', png(4, 2, labels), 'png'], ['direct', exr(4, 2, x => x < 2 ? 0.2 : right / 100), 'exr']];
    return files.map(([pass, bytes, ext]) => { const file = path.join(root, name + '-' + pass + '.' + ext); fs.writeFileSync(file, bytes); return { pass, path: file }; });
  };
  return capture;
}
const metadata = (changes = {}) => ({ measurement_target: target, compatibility: { camera_hash: 'camera', scene_identity_hash: 'scene', geometry_identity_hash: 'geometry', render_options_hash: 'options', render_engine: 1, width: 4, height: 2, max_render_seconds: 2, ...changes } });

test('projected target excludes another object from beauty, linear passes and paired deltas', t => {
  const capture = fixtures(t), a = capture('a', 90), b = capture('b', 240);
  const report = analyzeCapture(a, { measurement_target: target });
  assert.equal(report.product_mask.sampled_pixels, 4);
  assert.equal(report.product_mask.image_share, 0.5);
  assert.equal(report.product_mask.region_share, 1);
  assert.equal(report.product.mean_luma, 0.1961);
  assert.equal(report.linear_passes.direct.product.mean_luma, 0.2);
  assert.equal(report.measurement_scope.pixel_identity_verified, false);
  assert.match(report.measurement_scope.uncertainty, /occluders/);
  const comparison = compareCaptures(a, b, 1e-4, { require_metadata: true, reference: metadata(), candidate: metadata() });
  assert.equal(comparison.available, true);
  assert.equal(comparison.passes.direct.product.mean_absolute_luma_delta, 0);
  assert.equal(comparison.passes.direct.product.compared_pixels, 4);
});

test('full RGB labels preserve distinct colors previously collapsed into the same three bits', t => {
  const a = fixtures(t)('a', 90), report = analyzeCapture(a);
  assert.equal(report.product_mask.dominant_color_labels.length, 2);
  assert.deepEqual(report.product_mask.dominant_color_labels.map(l => l.rgb), [[200,100,20], [210,110,30]]);
  assert.equal(report.linear_passes.direct.clown_labels.length, 2);
});

test('strict comparisons reject unknown or changed camera, settings, engine and target', () => {
  for (const key of ['camera_hash', 'render_options_hash', 'scene_identity_hash', 'geometry_identity_hash', 'render_engine', 'width', 'max_render_seconds']) {
    const candidate = metadata({ [key]: key.endsWith('hash') ? 'changed' : 8 });
    const result = compareCaptures([], [], 1e-4, { require_metadata: true, reference: metadata(), candidate });
    assert.equal(result.available, false); assert.match(result.reason, /incompatible/);
  }
  const unknown = compareCaptures([], [], 1e-4, { require_metadata: true, reference: metadata(), candidate: { compatibility: {} } });
  assert.match(unknown.reason, /metadata is missing/);
  const changed = metadata(); changed.measurement_target = { ...target, identity: 'another-part' };
  assert.match(compareCaptures([], [], 1e-4, { require_metadata: true, reference: metadata(), candidate: changed }).reason, /target/);
});

test('invalid or empty target regions are rejected; untargeted captures stay available', t => {
  assert.throws(() => normalizeTarget({ ...target, region: { ...target.region, x1: 0 } }), /measurement_target/);
  assert.throws(() => normalizeTarget({ ...target, region: { ...target.region, x0: NaN } }), /measurement_target/);
  const report = analyzeCapture(fixtures(t)('all', 90));
  assert.equal(report.product_mask.sampled_pixels, 8);
  assert.equal(report.measurement_scope.kind, 'all_rendered_labels');
});

test('mask drift and an empty projected region cannot produce a successful comparison', t => {
  const capture = fixtures(t), a = capture('a', 90), b = capture('b', 90, x => x === 0 ? [200,100,20] : [0,0,0]);
  const context = { require_metadata: true, reference: metadata(), candidate: metadata() };
  assert.match(compareCaptures(a, b, 1e-4, context).reason, /silhouette/);
  const empty = capture('empty', 90, () => [0,0,0]);
  assert.match(compareCaptures(empty, empty, 1e-4, context).reason, /no shared/);
  assert.equal(analyzeCapture(empty, { measurement_target: target }).available, false);
});

test('lighting lab validates projected target before issuing any bridge operation', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'director-lab-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let calls = 0;
  const lab = createLightingLab({ SHOTS: root, heartbeat: () => ({ alive: true }), send: async () => { calls++; return {}; } });
  await assert.rejects(lab.run({ operation_id: 'lighting.capture_diagnostic_passes', inputs: { measurement_target: { ...target, region: null } } }), /measurement_target/);
  assert.equal(calls, 0);
});

test('diagnostic schema accepts actual bounded dimensions for wide and tall reference ratios', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'director-lab-aspects-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { dimensions } = require('../server/photo-refinement');
  const payloads = [];
  const lab = createLightingLab({ SHOTS: root, heartbeat: () => ({ alive: true }), send: async (op, inputs) => { payloads.push(inputs); return {}; } });
  for (const aspect of [0.05, 1/3, 4, 20]) {
    const size = dimensions(aspect);
    const record = await lab.run({ operation_id:'lighting.capture_diagnostic_passes', inputs:size });
    assert.equal(record.inputs.width, size.width); assert.equal(record.inputs.height, size.height);
    assert.equal(payloads.at(-1).width, size.width); assert.equal(payloads.at(-1).height, size.height);
    assert.ok(size.width >= 32 && size.height >= 32);
  }
  await assert.rejects(lab.run({ operation_id:'lighting.capture_diagnostic_passes', inputs:{width:30,height:640} }), /32x32/);
  await assert.rejects(lab.run({ operation_id:'lighting.capture_diagnostic_passes', inputs:{width:1282,height:960} }), /1280x960/);
});
