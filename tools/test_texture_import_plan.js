const test = require('node:test');
const assert = require('node:assert/strict');
const { plan } = require('../server/public/texture-import-plan');

const file = (relativePath, size = 1024) => ({
  name: relativePath.split('/').at(-1), webkitRelativePath: relativePath, size,
});

test('a parent folder imports separate assets at one resolution each', () => {
  const result = plan([
    file('Downloads/Wood/2K/Wood_COL_2K.jpg'),
    file('Downloads/Wood/4K/Wood_COL_4K.jpg'),
    file('Downloads/Wood/4K/Wood_ROUGH_4K.png'),
    file('Downloads/Wood/Wood.mtlx'),
    file('Downloads/Wood/Wood_Preview.jpg'),
    file('Downloads/Stone/2K/Stone_COL_2K.jpg'),
  ]);
  assert.deepEqual(result.groups.map(group => [group.name, group.resolution, group.files.length]),
    [['Wood', '4K', 3], ['Stone', '2K', 1]]);
  assert.equal(result.ignored, 1);
  assert.equal(result.groups[0].skipped, 1);
});

test('one asset folder with resolution subfolders stays one asset', () => {
  const result = plan([
    file('Oak/Textures/2K/Oak_COL_2K.jpg'),
    file('Oak/Textures/4K/Oak_COL_4K.jpg'),
    file('Oak/Textures/4K/Oak_NRM_4K.png'),
  ], { targetResolution: '2K' });
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].name, 'Oak');
  assert.deepEqual(result.groups[0].files.map(entry => entry.name), ['Oak_COL_2K.jpg']);
});

test('large files are reported before upload', () => {
  const result = plan([file('Oak/Oak_COL_4K.exr', 81 * 1024 * 1024)]);
  assert.match(result.groups[0].issue, /80 MB/);
});
