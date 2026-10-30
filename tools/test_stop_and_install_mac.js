// The macOS stop script and installer, driven with a fake file system, fake `ps` output and fake signals.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { stopServer, inspectProcess } = require('./stop');
const installer = require('./install-launcher');

const ROOT = path.resolve('/Users/test/Documents/KeyShotDirector');
const ENTRY = path.join(ROOT, 'server', 'server.js');
const MARKER = path.join(ROOT, 'bridge', 'director-server.json');

function world({ marker, processes = {} }) {
  const files = new Map(marker === undefined ? [] : [[MARKER, typeof marker === 'string' ? marker : JSON.stringify(marker)]]);
  const alive = new Map(Object.entries(processes));
  const signals = [];
  const output = [];
  return {
    files, alive, signals, output,
    deps: {
      root: ROOT,
      fsx: { existsSync: f => files.has(f), readFileSync: f => files.get(f), unlinkSync: f => files.delete(f) },
      inspect: pid => alive.get(String(pid)) || null,
      kill: (pid, signal) => { signals.push([pid, signal]); if (signal === 'SIGTERM' && world.stubborn !== true) alive.delete(String(pid)); if (signal === 'SIGKILL') alive.delete(String(pid)); },
      wait: async () => {},
      log: line => output.push(line),
    },
  };
}
const startedAt = 1767225600000;           // fixed instant

test('stop: no marker means nothing is stopped', async () => {
  const w = world({});
  assert.equal(await stopServer(w.deps), 0);
  assert.deepEqual(w.signals, []);
  assert.match(w.output[0], /No KeyShot Director process marker/);
});

test('stop: an invalid marker, a bad pid or a different port stops nothing', async () => {
  for (const [marker, port] of [['not json', null], [{ pid: 'abc', port: 8787 }, null], [{ pid: -4, port: 8787 }, null], [{ pid: 55, port: 8788 }, 8787]]) {
    const w = world({ marker, processes: { 55: { command: `node ${ENTRY}`, started: startedAt } } });
    assert.equal(await stopServer({ ...w.deps, port }), 1, JSON.stringify(marker));
    assert.deepEqual(w.signals, []);
  }
});

test('stop: a stale marker for a process that is gone is removed and nothing is signalled', async () => {
  const w = world({ marker: { pid: 77, port: 8787, started: startedAt, entry: ENTRY } });
  assert.equal(await stopServer(w.deps), 0);
  assert.deepEqual(w.signals, []);
  assert.ok(!w.files.has(MARKER));
  assert.match(w.output[0], /stale process marker/);
});

test('stop: a reused pid running something else is left alone', async () => {
  for (const command of ['/usr/bin/python3 server/server.js', `/usr/bin/vim ${ENTRY}`, `node /Users/other/KeyShotDirector/server/server.js`]) {
    const w = world({ marker: { pid: 77, port: 8787, started: startedAt, entry: ENTRY }, processes: { 77: { command, started: startedAt } } });
    assert.equal(await stopServer(w.deps), 1, command);
    assert.deepEqual(w.signals, []);
    assert.ok(w.files.has(MARKER), 'the marker stays when nothing was stopped');
  }
});

test('stop: a matching command with a very different start time is a reused pid and is left alone', async () => {
  const w = world({ marker: { pid: 77, port: 8787, started: startedAt, entry: ENTRY }, processes: { 77: { command: `node ${ENTRY}`, started: startedAt - 3 * 3600 * 1000 } } });
  assert.equal(await stopServer(w.deps), 1);
  assert.deepEqual(w.signals, []);
  const unknown = world({ marker: { pid: 77, port: 8787, started: startedAt, entry: ENTRY }, processes: { 77: { command: `node ${ENTRY}`, started: NaN } } });
  assert.equal(await stopServer(unknown.deps), 1);
  assert.match(unknown.output[0], /Could not verify/);
});

test('stop: the recorded Director server is stopped with SIGTERM and the marker removed', async () => {
  for (const command of [`node ${ENTRY}`, `/opt/homebrew/bin/node ${ENTRY}`, `/Users/test/Tools With Spaces/node ${ENTRY.toUpperCase()}`]) {
    const w = world({ marker: { pid: 77, port: 8788, started: startedAt, entry: ENTRY }, processes: { 77: { command, started: startedAt + 1200 } } });
    assert.equal(await stopServer(w.deps), 0, command);
    assert.deepEqual(w.signals, [[77, 'SIGTERM']]);
    assert.ok(!w.files.has(MARKER));
    assert.match(w.output[0], /Stopped KeyShot Director \(process 77\)/);
  }
});

test('stop: --port must match the recorded port when given', async () => {
  const w = world({ marker: { pid: 77, port: 8788, started: startedAt, entry: ENTRY }, processes: { 77: { command: `node ${ENTRY}`, started: startedAt } } });
  assert.equal(await stopServer({ ...w.deps, port: 8788 }), 0);
});

test('stop: a process that ignores SIGTERM is killed', async () => {
  const w = world({ marker: { pid: 77, port: 8787, started: startedAt, entry: ENTRY }, processes: { 77: { command: `node ${ENTRY}`, started: startedAt } } });
  world.stubborn = true;
  try { assert.equal(await stopServer(w.deps), 0); } finally { world.stubborn = false; }
  assert.deepEqual(w.signals, [[77, 'SIGTERM'], [77, 'SIGKILL']]);
});

test('stop: ps output from macOS is parsed (command line and local start time, including a single-digit day)', () => {
  const answers = { command: `/opt/homebrew/bin/node ${ENTRY}\n`, lstart: 'Thu Jan  1 09:05:07 2026\n' };
  const seen = [];
  const info = inspectProcess(321, (file, args, options) => { seen.push([file, args, options.env.LC_ALL]); return answers[args[3].replace('=', '')]; });
  assert.deepEqual(seen[0].slice(0, 2), ['ps', ['-p', '321', '-o', 'command=']]);
  assert.equal(seen[0][2], 'C');
  assert.equal(info.command, `/opt/homebrew/bin/node ${ENTRY}`);
  assert.equal(info.started, new Date(2026, 0, 1, 9, 5, 7).getTime());
  assert.equal(inspectProcess(321, () => { throw new Error('ps exited 1'); }), null);
  assert.equal(inspectProcess(321, () => '\n'), null);
});

// ---- installer ----

function fakeInstallFs(initial = {}, folders = []) {
  const files = new Map(Object.entries(initial));
  const dirs = new Set(folders);
  return {
    files, dirs,
    readdirSync: dir => { if (!dirs.has(dir)) throw new Error('ENOENT'); return [...dirs].filter(d => path.dirname(d) === dir).map(d => path.basename(d)); },
    statSync: p => { if (dirs.has(p)) return { isDirectory: () => true }; throw new Error('ENOENT'); },
    mkdirSync: p => { dirs.add(p); },
    readFileSync: p => { if (!files.has(p)) throw new Error('ENOENT'); return files.get(p); },
    writeFileSync: (p, text, options) => { files.set(p, text); files.mode = options && options.mode; },
  };
}
const HOME = path.resolve('/Users/test');
const docs = (...names) => names.flatMap(name => [path.join(HOME, 'Documents', name), path.join(HOME, 'Documents', name, 'Scripts')]);
const target = scripts => path.join(scripts, 'KeyShot Director.py');

test('install: the launcher points at this folder, is valid Python text and carries the managed marker', () => {
  const text = installer.launcherSource('/Users/test/My Docs/Key"Shot Director');
  assert.match(text, /^# -\*- coding: utf-8 -\*-\n# AUTHOR KeyShot Director\n/);
  assert.ok(installer.isManaged(text));
  assert.match(text, /KD_HOME = "\/Users\/test\/My Docs\/Key\\"Shot Director"\n/);
  assert.match(text, /exec\(open\(os\.path\.join\(KD_HOME, "bridge", "cc_bridge\.py"\), encoding="utf-8-sig"\)\.read\(\)\)\n$/);
  assert.ok(!text.includes('\r'));
});

test('install: a single KeyShot folder in Documents receives the launcher', async () => {
  const fsx = fakeInstallFs({}, [path.join(HOME, 'Documents'), ...docs('KeyShot 2026', 'Pictures')]);
  const lines = [];
  assert.equal(await installer.main([ROOT], { home: HOME, fs: fsx, log: l => lines.push(l) }), 0);
  const scripts = path.join(HOME, 'Documents', 'KeyShot 2026', 'Scripts');
  assert.match(fsx.files.get(target(scripts)), /KD_HOME = /);
  assert.ok(lines.some(l => l.includes('launcher installed')));
  assert.ok(!lines.some(l => /Preferences > Folders/.test(l)), 'no manual step when the folder was found');
});

test('install: with several KeyShot versions the user chooses, and without a terminal the newest is used', async () => {
  const folders = [path.join(HOME, 'Documents'), ...docs('KeyShot 12', 'KeyShot 2026', 'KeyShot 2025')];
  const chosen = fakeInstallFs({}, folders);
  await installer.main([ROOT], { home: HOME, fs: chosen, log: () => {}, ask: async () => '1' });
  assert.ok(chosen.files.has(target(path.join(HOME, 'Documents', 'KeyShot 2025', 'Scripts'))), 'the list is newest first: 2026, 2025, 12');
  const newest = fakeInstallFs({}, folders);
  const lines = [];
  const realIsTTY = process.stdin.isTTY;
  process.stdin.isTTY = false;
  try { await installer.main([ROOT], { home: HOME, fs: newest, log: l => lines.push(l) }); } finally { process.stdin.isTTY = realIsTTY; }
  assert.ok(newest.files.has(target(path.join(HOME, 'Documents', 'KeyShot 2026', 'Scripts'))));
  assert.ok(lines.some(l => /using the newest/.test(l)));
});

test('install: with no KeyShot folder yet the launcher goes to a user folder and the manual step is explained', async () => {
  const fsx = fakeInstallFs({}, [path.join(HOME, 'Documents')]);
  const lines = [];
  assert.equal(await installer.main([ROOT], { home: HOME, fs: fsx, log: l => lines.push(l) }), 0);
  const fallback = installer.fallbackScriptsFolder(HOME);
  assert.ok(fsx.files.has(target(fallback)));
  assert.ok(lines.some(l => /Preferences > Folders > Scripts/.test(l)));
  assert.ok(lines.some(l => l.includes(fallback)));
});

test('install: --scripts-folder wins, and an existing installer-written launcher is replaced', async () => {
  const custom = path.join(HOME, 'Elsewhere', 'Scripts');
  const old = '# KEYSHOT_DIRECTOR_MANAGED_LAUNCHER\nKD_HOME = "/old/place"\n';
  const fsx = fakeInstallFs({ [target(custom)]: old }, [path.join(HOME, 'Documents'), ...docs('KeyShot 2026')]);
  assert.equal(await installer.main([ROOT, '--scripts-folder', custom], { home: HOME, fs: fsx, log: () => {} }), 0);
  assert.ok(fsx.files.get(target(custom)).includes(JSON.stringify(ROOT)));
  assert.ok(!fsx.files.has(target(path.join(HOME, 'Documents', 'KeyShot 2026', 'Scripts'))));
  assert.equal(await installer.main([ROOT, '--scripts-folder'], { home: HOME, fs: fsx, log: () => {} }), 2);
});

test('install: a script of the same name that this installer did not write is never replaced', async () => {
  const mine = '# my own KeyShot script\nprint("hi")\n';
  const scripts = path.join(HOME, 'Documents', 'KeyShot 2026', 'Scripts');
  const fsx = fakeInstallFs({ [target(scripts)]: mine }, [path.join(HOME, 'Documents'), ...docs('KeyShot 2026')]);
  const lines = [];
  assert.equal(await installer.main([ROOT], { home: HOME, fs: fsx, log: l => lines.push(l) }), 1);
  assert.equal(fsx.files.get(target(scripts)), mine);
  assert.ok(lines.some(l => /was not written by this installer/.test(l)));
});
