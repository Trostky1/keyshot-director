const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resizeJpeg, normalizeFolder } = require('../server/image-tools');

function tinyBmp() {
  const b = Buffer.alloc(62);
  b.write('BM'); b.writeUInt32LE(b.length, 2); b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14); b.writeInt32LE(2, 18); b.writeInt32LE(1, 22);
  b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(8, 34);
  b.set([40, 100, 220, 190, 180, 140, 0, 0], 54);
  return b;
}

test('macOS image conversion supports preview JPEGs and normalized style PNGs', { skip: process.platform !== 'darwin' }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-sips-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const folder = path.join(root, 'style'); fs.mkdirSync(folder);
  const source = path.join(folder, 'fixture.bmp'), jpeg = path.join(root, 'preview.jpg');
  fs.writeFileSync(source, tinyBmp());
  await resizeJpeg(source, jpeg, 900);
  assert.deepEqual(fs.readFileSync(jpeg).subarray(0, 2), Buffer.from([0xff, 0xd8]));
  const normalized = await normalizeFolder(folder, path.join(root, 'cache'), 900);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].status, 'ok');
  assert.deepEqual(fs.readFileSync(normalized[0].png).subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
});
