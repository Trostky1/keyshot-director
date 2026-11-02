// What a Mac user receives: shell scripts that run, a ZIP that extracts with executable files, exact-case file names, and
// a server that starts and stops through the same marker the Windows stop script uses.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawn, spawnSync } = require('child_process');
const { buildZip, readZip, zipFolder, crc32, MODE_EXEC, MODE_FILE } = require('./zip-release');

const root = path.resolve(__dirname, '..');
const SHELL = ['install-mac.sh', 'start-mac.sh', 'Start KeyShot Director.command', 'Install KeyShot Director.command', 'Stop KeyShot Director.command'];

test('macOS shell scripts have a shebang and LF line endings', () => {
  for (const file of SHELL) {
    const bytes = fs.readFileSync(path.join(root, file));
    assert.ok(bytes.toString('utf8').startsWith('#!/bin/bash\n'), `${file} must start with #!/bin/bash`);
    assert.ok(!bytes.includes(13), `${file} contains CR characters; "#!/bin/bash\\r" fails on macOS`);
  }
  assert.match(fs.readFileSync(path.join(root, '.gitattributes'), 'utf8'), /\*\.sh text eol=lf[\s\S]*\*\.command text eol=lf/);
});

test('macOS shell scripts are stored executable in git', t => {
  const listed = spawnSync('git', ['ls-files', '-s', '--', ...SHELL], { cwd: root, encoding: 'utf8' });
  if (listed.status !== 0 || !listed.stdout.trim()) return t.skip('not a git checkout');
  const modes = Object.fromEntries(listed.stdout.trim().split('\n').map(line => { const [mode, , , ...name] = line.split(/\s+/); return [name.join(' '), mode]; }));
  for (const file of SHELL) assert.equal(modes[file], '100755', `${file} must be committed with mode 100755`);
});

test('macOS shell scripts are valid bash', t => {
  const bash = spawnSync('bash', ['--version']);
  if (bash.status !== 0) return t.skip('bash not available');
  for (const file of SHELL) { const r = spawnSync('bash', ['-n', file], { cwd: root, encoding: 'utf8' }); assert.equal(r.status, 0, `${file}: ${r.stderr}`); }
});

test('the release packager ships every macOS file and writes the ZIP with the Unix-aware writer', () => {
  const source = fs.readFileSync(path.join(root, 'package.ps1'), 'utf8');
  const packaged = new Set();
  for (const match of source.matchAll(/foreach\s*\(\$f in ([\s\S]*?)\)\s*\{\s*Copy-Rel \$f\s*\}/g))
    for (const item of match[1].matchAll(/'([^']+)'/g)) packaged.add(item[1].replace(/\\/g, '/'));
  for (const file of [...SHELL, 'server/platform.js', 'tools/stop.js', 'tools/install-launcher.js', 'docs/MACOS.md', 'docs/RELEASE_NOTES_3.1.md', '.gitattributes'])
    assert.ok(packaged.has(file), `${file} is missing from package.ps1`);
  assert.doesNotMatch(source, /Compress-Archive/, 'Compress-Archive cannot store the executable bit');
  assert.match(source, /zip-release\.js/);
  assert.match(source, /\[ValidateSet\('All', 'Mac'\)\]\[string\]\$Platform/);
  assert.ok(!packaged.has('tools/zip-release.js'), 'the ZIP writer is a build tool, not part of the release');
});

test('file names are referenced with their exact case (macOS volumes can be case-sensitive)', () => {
  const missing = [];
  const exactCase = rel => {
    let dir = root;
    for (const part of rel.split('/')) { if (!fs.existsSync(dir) || !fs.readdirSync(dir).includes(part)) return false; dir = path.join(dir, part); }
    return true;
  };
  const source = fs.readFileSync(path.join(root, 'package.ps1'), 'utf8');
  for (const match of source.matchAll(/foreach\s*\(\$f in ([\s\S]*?)\)\s*\{\s*Copy-Rel \$f\s*\}/g))
    for (const item of match[1].matchAll(/'([^']+)'/g)) if (!exactCase(item[1].replace(/\\/g, '/'))) missing.push(item[1]);
  for (const dir of ['server', 'tools', 'bridge']) {
    for (const file of fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith('.js'))) {
      for (const m of fs.readFileSync(path.join(root, dir, file), 'utf8').matchAll(/require\(['"](\.[^'"]*)['"]\)/g)) {
        const target = path.posix.join(dir, m[1]);
        if (!exactCase(path.posix.extname(target) ? target : target + '.js')) missing.push(`${dir}/${file} -> ${m[1]}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('server code keeps Windows-only programs behind the platform helpers', () => {
  const allowed = new Set(['cli.js', 'platform.js', 'image-tools.js', 'server.js']);
  const offenders = [];
  for (const file of fs.readdirSync(path.join(root, 'server')).filter(f => f.endsWith('.js') && !allowed.has(f))) {
    const text = fs.readFileSync(path.join(root, 'server', file), 'utf8');
    if (/process\.platform|\bpowershell\b|explorer\.exe|cmd\.exe|path\.win32/.test(text)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
  const server = fs.readFileSync(path.join(root, 'server', 'server.js'), 'utf8');
  assert.doesNotMatch(server, /process\.platform/, 'server.js must use server/platform.js for platform decisions');
});

// ---- ZIP writer ----

function sampleFolder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kd_zip_'));
  fs.mkdirSync(path.join(dir, 'server'));
  fs.mkdirSync(path.join(dir, 'empty'));
  fs.writeFileSync(path.join(dir, 'start-mac.sh'), '#!/bin/bash\r\necho hi\r\n');
  fs.writeFileSync(path.join(dir, 'Start Me.command'), '#!/bin/bash\r\nexec ./start-mac.sh\r\n');
  fs.writeFileSync(path.join(dir, 'README.md'), 'readme '.repeat(500));
  fs.writeFileSync(path.join(dir, 'server', 'données.js'), 'module.exports = 1;\r\n');
  fs.writeFileSync(path.join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 255, 254, 13, 10]));
  return dir;
}

test('the ZIP writer records Unix modes, forward slashes, LF scripts and valid CRCs', () => {
  const dir = sampleFolder();
  try {
    const zipPath = path.join(dir, '..', 'kd_sample_' + process.pid + '.zip');
    const result = zipFolder(dir, zipPath, { top: 'KeyShotDirector' });
    assert.ok(result.entries >= 7);
    const entries = readZip(fs.readFileSync(zipPath));
    const byName = Object.fromEntries(entries.map(e => [e.name, e]));
    for (const entry of entries) { assert.ok(!entry.name.includes('\\')); assert.equal(entry.host, 3); }
    assert.ok(byName['KeyShotDirector/empty/'] && byName['KeyShotDirector/server/']);
    assert.equal(byName['KeyShotDirector/start-mac.sh'].mode & 0o777, MODE_EXEC & 0o777);
    assert.equal(byName['KeyShotDirector/Start Me.command'].mode & 0o777, 0o755);
    assert.equal(byName['KeyShotDirector/README.md'].mode & 0o777, MODE_FILE & 0o777);
    assert.equal(byName['KeyShotDirector/start-mac.sh'].read().toString(), '#!/bin/bash\necho hi\n');
    assert.equal(byName['KeyShotDirector/server/données.js'].read().toString(), 'module.exports = 1;\r\n', 'non-scripts are stored byte for byte');
    assert.deepEqual([...byName['KeyShotDirector/bin.dat'].read()], [0, 1, 2, 255, 254, 13, 10]);
    fs.rmSync(zipPath);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the CRC-32 matches the standard check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xCBF43926);
});

test('the packager refuses a shell script that is not a script', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kd_zip_bad_'));
  try {
    fs.writeFileSync(path.join(dir, 'broken.sh'), 'echo no shebang\n');
    assert.throws(() => zipFolder(dir, path.join(dir, '..', 'kd_bad_' + process.pid + '.zip'), { top: 'T' }), /no #! line/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an independent unzip tool sees the executable bit and LF endings', t => {
  const zipTool = spawnSync('unzip', ['-v'], { encoding: 'utf8' });
  if (process.platform === 'win32' || zipTool.status !== 0) return t.skip('unzip is not available on this platform');
  const dir = sampleFolder();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kd_unzip_'));
  try {
    const zipPath = path.join(out, 'sample.zip');
    zipFolder(dir, zipPath, { top: 'KeyShotDirector' });
    const extracted = spawnSync('unzip', ['-q', zipPath, '-d', path.join(out, 'x')], { encoding: 'utf8' });
    assert.equal(extracted.status, 0, extracted.stderr);
    const script = path.join(out, 'x', 'KeyShotDirector', 'Start Me.command');
    assert.ok(fs.statSync(script).mode & 0o100, 'the .command file must extract executable');
    assert.ok(!fs.readFileSync(script).includes(13));
    assert.ok(fs.existsSync(path.join(out, 'x', 'KeyShotDirector', 'server', 'données.js')), 'directories are real folders, not backslash names');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); }
});

test('a Python reader agrees with the ZIP writer about hosts, modes and names', t => {
  const python = ['python3', 'python', 'py'].find(name => spawnSync(name, ['-c', 'import zipfile'], { encoding: 'utf8' }).status === 0);
  if (!python) return t.skip('python is not available');
  const dir = sampleFolder();
  try {
    const zipPath = path.join(dir, '..', 'kd_py_' + process.pid + '.zip');
    zipFolder(dir, zipPath, { top: 'KeyShotDirector' });
    const code = 'import zipfile,sys,json\nz=zipfile.ZipFile(sys.argv[1])\nbad=z.testzip()\nprint(json.dumps({"bad":bad,"items":[[i.filename,i.create_system,i.external_attr>>16] for i in z.infolist()]}))';
    const run = spawnSync(python, ['-I', '-c', code, zipPath], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const info = JSON.parse(run.stdout);
    assert.equal(info.bad, null);
    assert.ok(info.items.every(([, system]) => system === 3));
    const script = info.items.find(([name]) => name.endsWith('Start Me.command'));
    assert.equal(script[2] & 0o777, 0o755);
    fs.rmSync(zipPath);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- the real server: start, record the marker, answer, and (on macOS/Linux) stop through tools/stop.js ----

function getJson(port, route) {
  return new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: route }, res => {
    let body = ''; res.on('data', d => (body += d)); res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
  }).on('error', reject));
}

test('the real server writes its stop marker, serves the connect line, and tools/stop.js stops exactly that process', { timeout: 60000 }, async t => {
  if (process.platform === 'win32') return t.skip('stop.js uses ps; Windows uses tools/stop.ps1');
  const marker = path.join(root, 'bridge', 'director-server.json');
  fs.rmSync(marker, { force: true });
  const child = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { cwd: root, env: { ...process.env, PORT: '18787', KD_OPEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', d => (log += d)); child.stderr.on('data', d => (log += d));
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  try {
    const started = Date.now();
    while (!/KeyShot control server: http:\/\/localhost:(\d+)/.test(log)) {
      if (Date.now() - started > 30000) assert.fail('server did not start:\n' + log);
      await new Promise(r => setTimeout(r, 100));
    }
    const port = Number(/KeyShot control server: http:\/\/localhost:(\d+)/.exec(log)[1]);
    const record = JSON.parse(fs.readFileSync(marker, 'utf8'));
    assert.equal(record.pid, child.pid);
    assert.equal(record.port, port);
    assert.equal(record.entry, path.join(root, 'server', 'server.js'));
    const connect = await getJson(port, '/api/connect');
    assert.match(connect.line, /^exec\("KD_HOME = '.*'; exec\(open\(KD_HOME \+ '\/bridge\/cc_bridge\.py'/);

    const stop = spawnSync(process.execPath, [path.join(root, 'tools', 'stop.js'), '--port', String(port)], { cwd: root, encoding: 'utf8' });
    assert.equal(stop.status, 0, stop.stdout + stop.stderr);
    assert.match(stop.stdout, /Stopped KeyShot Director/);
    const result = await Promise.race([exited, new Promise(r => setTimeout(() => r(null), 10000))]);
    assert.ok(result, 'the server process must exit after tools/stop.js');
    assert.ok(!fs.existsSync(marker), 'the marker is removed');
  } finally { child.kill('SIGKILL'); fs.rmSync(marker, { force: true }); }
});

test('the real server starts and records its marker on any platform', { timeout: 60000 }, async () => {
  const marker = path.join(root, 'bridge', 'director-server.json');
  fs.rmSync(marker, { force: true });
  const child = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { cwd: root, env: { ...process.env, PORT: '18807', KD_OPEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', d => (log += d)); child.stderr.on('data', d => (log += d));
  try {
    const started = Date.now();
    while (!/KeyShot control server: http:\/\/localhost:(\d+)/.test(log)) {
      if (Date.now() - started > 30000) assert.fail('server did not start:\n' + log);
      await new Promise(r => setTimeout(r, 100));
    }
    const record = JSON.parse(fs.readFileSync(marker, 'utf8'));
    assert.equal(record.pid, child.pid);
    assert.ok(Number.isInteger(record.port) && record.started > 0);
    const state = await getJson(record.port, '/api/status');
    assert.equal(state.port, record.port);
  } finally { child.kill('SIGKILL'); await new Promise(r => setTimeout(r, 200)); fs.rmSync(marker, { force: true }); }
});
