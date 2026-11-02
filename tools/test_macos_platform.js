// macOS branches of the platform helpers, exercised by injecting the platform and a fake file system so they run on every host.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const platform = require('../server/platform');
const imageTools = require('../server/image-tools');
const cli = require('../server/cli');

test('the default browser opener is chosen per platform', () => {
  const url = 'http://localhost:8787';
  assert.deepEqual(platform.openUrlCommand(url, 'darwin'), { file: 'open', args: [url] });
  assert.deepEqual(platform.openUrlCommand(url, 'win32'), { file: 'cmd', args: ['/c', 'start', '""', url] });
  assert.equal(platform.openUrlCommand(url, 'linux'), null);
});

test('the folder opener is chosen per platform and keeps paths with spaces as one argument', () => {
  const folder = '/Users/test/KeyShot Director/materials';
  assert.deepEqual(platform.openFolderCommand(folder, 'darwin'), { file: 'open', args: [folder] });
  assert.deepEqual(platform.openFolderCommand('C:\\KD\\materials', 'win32'), { file: 'explorer.exe', args: ['C:\\KD\\materials'] });
  assert.deepEqual(platform.openFolderCommand(folder, 'linux'), { file: 'xdg-open', args: [folder] });
});

function fakeFiles(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    writeFileSync: (file, text) => files.set(file, text),
    readFileSync: file => { if (!files.has(file)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return files.get(file); },
    unlinkSync: file => { if (!files.delete(file)) throw new Error('ENOENT'); },
  };
}

test('the safe-stop marker is written and removed on macOS exactly as on Windows, and only by its owner', () => {
  const root = path.resolve('/Users/test/KeyShotDirector');
  const entry = path.join(root, 'server', 'server.js');
  const fsx = fakeFiles();
  const record = platform.serverMarkerRecord({ pid: 4242, port: 8788, entry, now: 1700000000000 });
  platform.writeServerMarker(root, record, fsx);
  const marker = platform.serverMarkerFile(root);
  assert.equal(marker, path.join(root, 'bridge', 'director-server.json'));
  assert.deepEqual(JSON.parse(fsx.files.get(marker)), { pid: 4242, port: 8788, started: 1700000000000, entry });
  assert.equal(platform.removeServerMarker(root, { pid: 999, entry }, fsx), false, 'another process must not remove the marker');
  assert.ok(fsx.files.has(marker));
  assert.equal(platform.removeServerMarker(root, { pid: 4242, entry }, fsx), true);
  assert.ok(!fsx.files.has(marker));
  assert.equal(platform.removeServerMarker(root, { pid: 4242, entry }, fsx), false, 'a missing marker is not an error');
});

test('research-lab scene paths from a Mac or a Windows user are both accepted', () => {
  for (const good of ['/Users/test/Documents/PluginTest.bip', 'C:\\Users\\test\\Documents\\PluginTest.bip', 'D:/Scenes/pluginTEST.bip'])
    assert.ok(platform.isAbsoluteScenePath(good), good);
  for (const bad of ['PluginTest.bip', './PluginTest.bip', 'Documents/PluginTest.bip', '', null, 5]) assert.ok(!platform.isAbsoluteScenePath(bad), String(bad));
  assert.equal(platform.sceneBaseName('/Users/test/My Scenes/PluginTest.bip'), 'PluginTest.bip');
  assert.equal(platform.sceneBaseName('C:\\Users\\test\\PluginTest.bip'), 'PluginTest.bip');
});

test('macOS image conversion calls sips with the right arguments and skips hidden files', async () => {
  const calls = [];
  const run = async (file, args) => { calls.push([file, ...args]); return ''; };
  await imageTools.resizeJpeg('/in/a b.heic', '/out/a b.jpg', 640, { platform: 'darwin', run });
  assert.deepEqual(calls[0], ['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '-Z', '640', '/in/a b.heic', '--out', '/out/a b.jpg']);

  calls.length = 0;
  const made = [];
  const fsx = {
    mkdirSync: dir => made.push(dir),
    readdirSync: () => ['b.JPG', '._b.jpg', '.DS_Store', 'a.png', 'notes.txt', 'c.heic'],
    existsSync: file => file === path.join('/out', 'c.png'),
    statSync: () => ({ mtimeMs: 10 }),
  };
  const results = await imageTools.normalizeFolder('/styles/luxe', '/out', 800, { platform: 'darwin', run, fs: fsx });
  assert.deepEqual(made, ['/out']);
  assert.deepEqual(results.map(r => [r.name, r.status]), [['a.png', 'ok'], ['b.JPG', 'ok'], ['c.heic', 'cached']]);
  assert.deepEqual(calls.map(c => path.basename(c[c.length - 3])), ['a.png', 'b.JPG']);
  assert.deepEqual(calls[0], ['sips', '-s', 'format', 'png', '-Z', '800', path.join('/styles/luxe', 'a.png'), '--out', path.join('/out', 'a.png')]);

  const failing = async () => { throw new Error('sips: unsupported format\nsecond line'); };
  const failed = await imageTools.normalizeFolder('/styles', '/out', 800, { platform: 'darwin', run: failing, fs: { ...fsx, readdirSync: () => ['x.jxl'], existsSync: () => false } });
  assert.deepEqual(failed, [{ name: 'x.jxl', png: null, status: 'error: sips: unsupported format' }]);
});

test('image conversion reports unsupported platforms instead of failing silently', async () => {
  await assert.rejects(imageTools.resizeJpeg('a', 'b', 100, { platform: 'linux' }), /Windows and macOS/);
  await assert.rejects(imageTools.normalizeFolder('a', 'b', 100, { platform: 'linux' }), /Windows and macOS/);
});

test('the temp folder handed to the AI CLIs is the real path on macOS and unchanged on Windows', () => {
  const realpath = p => p.replace(/^\/var\//, '/private/var/');
  assert.equal(cli.tmpBase('darwin', '/var/folders/ab/T', realpath), '/private/var/folders/ab/T');
  assert.equal(cli.tmpBase('win32', 'C:\\Users\\BENTR~1\\AppData\\Local\\Temp', () => { throw new Error('must not resolve'); }), 'C:\\Users\\BENTR~1\\AppData\\Local\\Temp');
  assert.equal(cli.tmpBase('darwin', '/tmp/x', () => { throw new Error('boom'); }), '/tmp/x');
});
