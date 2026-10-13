const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { editTexture, readPng, encode } = require('../server/texture-edit');

function grayscalePng(w, h, values) {
  const img = { w, h, ihdr: Buffer.from([0,0,0,0,0,0,0,0,8,0,0,0,0]), pixels: Buffer.from(values) };
  img.ihdr.writeUInt32BE(w, 0); img.ihdr.writeUInt32BE(h, 4); return encode(img);
}

test('inverts a grayscale PNG into a derived file and preserves the source', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-texture-edit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'roughness.png'), original = grayscalePng(3, 1, [0, 64, 255]);
  fs.writeFileSync(source, original);
  const result = editTexture({ sourcePath: source, outputDir: path.join(root, 'derived'), operation: 'invert' });
  assert.deepEqual([...readPng(fs.readFileSync(result.path)).pixels], [255, 191, 0]);
  assert.deepEqual(fs.readFileSync(source), original);
  assert.equal(result.width, 3);
});

test('tile offset wraps each pixel to the opposite half', () => {
  const img = readPng(grayscalePng(4, 2, [0,1,2,3,4,5,6,7]));
  const { transform } = require('../server/texture-edit'); transform(img, 'tile-offset');
  assert.deepEqual([...img.pixels], [6,7,4,5,2,3,0,1]);
});

test('refuses color images, unsupported operations and overwrite attempts', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-texture-edit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'color.png'); fs.writeFileSync(source, grayscalePng(1, 1, [80]));
  assert.throws(() => editTexture({ sourcePath: source, outputDir: root, operation: 'paint' }), /Unknown map operation/);
  editTexture({ sourcePath: source, outputDir: root, operation: 'invert' });
  assert.throws(() => editTexture({ sourcePath: source, outputDir: root, operation: 'invert' }), /already exists/);
  const color = Buffer.from(grayscalePng(1, 1, [80])); color[25] = 2;
  assert.throws(() => readPng(color), /grayscale/);
});
