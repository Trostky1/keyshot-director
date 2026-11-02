// Claude and Codex CLI discovery, run against a fake file system so the macOS and Windows branches both execute anywhere.
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('../server/cli');

// A fake file system built from a list of file paths; every ancestor of a file is a folder.
function fakeFs(entries, { nonExecutable = [] } = {}) {
  const files = new Set(entries);
  const dirs = new Map();
  for (const entry of entries) {
    const segments = entry.split('/');
    for (let i = 1; i < segments.length; i++) {
      const dir = segments.slice(0, i).join('/') || '/';
      if (!dirs.has(dir)) dirs.set(dir, new Set());
      dirs.get(dir).add(segments[i]);
    }
  }
  const enoent = p => Object.assign(new Error('ENOENT ' + p), { code: 'ENOENT' });
  return {
    statSync: p => { if (files.has(p)) return { isFile: () => true, mtimeMs: 1 }; if (dirs.has(p)) return { isFile: () => false, mtimeMs: 1 }; throw enoent(p); },
    accessSync: p => { if (!files.has(p) || nonExecutable.includes(p)) throw enoent(p); },
    readdirSync: p => { if (!dirs.has(p)) throw enoent(p); return [...dirs.get(p)]; },
  };
}
const mac = (entries, extra = {}, opts) => ({ platform: 'darwin', home: '/Users/test', env: { PATH: '/usr/bin:/bin' }, fs: fakeFs(entries, opts), ...extra });

test('macOS: claude on PATH wins', () => {
  const deps = mac(['/usr/bin/claude', '/opt/homebrew/bin/claude'], { env: { PATH: '/usr/bin:/bin' } });
  assert.equal(cli.findCli(null, deps), '/usr/bin/claude');
});

test('macOS: a claude without the executable bit is not used', () => {
  const deps = mac(['/usr/bin/claude', '/opt/homebrew/bin/claude'], {}, { nonExecutable: ['/usr/bin/claude'] });
  assert.equal(cli.findCli(null, deps), '/opt/homebrew/bin/claude');
});

test('macOS: the standalone installer, Homebrew and npm locations are searched when PATH is minimal', () => {
  for (const where of ['/Users/test/.local/bin/claude', '/Users/test/.claude/local/claude', '/opt/homebrew/bin/claude', '/usr/local/bin/claude', '/Users/test/.npm-global/bin/claude', '/Users/test/.bun/bin/claude'])
    assert.equal(cli.findCli(null, mac([where])), where, where);
});

test('macOS: nvm installs are found and the newest Node version wins', () => {
  const deps = mac(['/Users/test/.nvm/versions/node/v18.20.4/bin/claude', '/Users/test/.nvm/versions/node/v22.11.0/bin/claude', '/Users/test/.nvm/versions/node/v20.9.0/bin/claude']);
  assert.equal(cli.findCli(null, deps), '/Users/test/.nvm/versions/node/v22.11.0/bin/claude');
});

test('macOS: the Claude desktop app copy is found in every plausible layout and the newest version wins', () => {
  const base = '/Users/test/Library/Application Support/Claude/claude-code';
  assert.equal(cli.findCli(null, mac([`${base}/2.1.5/claude`, `${base}/2.1.12/claude`])), `${base}/2.1.12/claude`);
  assert.equal(cli.findCli(null, mac([`${base}/2.1.5/claude.app/Contents/MacOS/claude`])), `${base}/2.1.5/claude.app/Contents/MacOS/claude`);
  assert.equal(cli.findCli(null, mac([`${base}/2.1.5/abc123/claude`, `${base}/2.0.9/def456/claude`])), `${base}/2.1.5/abc123/claude`);
  assert.equal(cli.findCli(null, mac([`${base}/2.1.5/abc123/claude.app/Contents/MacOS/claude`])), `${base}/2.1.5/abc123/claude.app/Contents/MacOS/claude`);
});

test('macOS: the desktop app copy is preferred to a standalone one, PATH to both, and a Settings path to everything', () => {
  const base = '/Users/test/Library/Application Support/Claude/claude-code';
  const entries = [`${base}/2.1.5/claude`, '/opt/homebrew/bin/claude', '/custom/claude'];
  assert.equal(cli.findCli(null, mac(entries)), `${base}/2.1.5/claude`);
  assert.equal(cli.findCli('/custom/claude', mac(entries)), '/custom/claude');
  assert.equal(cli.findCli('/missing/claude', mac(entries)), `${base}/2.1.5/claude`, 'a wrong Settings path falls back to discovery');
});

test('macOS: nothing found returns null and records where it looked, with no Windows folders', () => {
  assert.equal(cli.findCli(null, mac([])), null);
  const log = cli.lastSearched().join('\n');
  assert.match(log, /Library\/Application Support\/Claude\/claude-code/);
  assert.match(log, /\/opt\/homebrew\/bin\/claude/);
  assert.doesNotMatch(log, /AppData|Packages|\.exe/);
});

test('Windows discovery is unchanged: the Microsoft Store package copy is found with the newest version winning', () => {
  const root = 'C:/Users/test/AppData/Local/Packages/Claude_abc/LocalCache/Roaming/Claude/claude-code';
  const wfs = fakeFs([`${root}/2.1.5/hash1/claude.exe`, `${root}/2.1.12/hash2/claude.exe`, 'C:/Users/test/AppData/Local/Packages/Claude_abc/x']);
  const slash = p => p.replace(/\\/g, '/');
  const deps = { platform: 'win32', home: 'C:/Users/test', env: { PATH: '', LOCALAPPDATA: 'C:/Users/test/AppData/Local', APPDATA: 'C:/Users/test/AppData/Roaming' },
    fs: { statSync: p => wfs.statSync(slash(p)), accessSync: () => {}, readdirSync: p => wfs.readdirSync(slash(p)) } };
  assert.equal(slash(cli.findCli(null, deps)), `${root}/2.1.12/hash2/claude.exe`);
});

test('macOS: codex on PATH, in the desktop app bundle, or in Homebrew/npm homes', () => {
  assert.equal(cli.findCodex(null, mac(['/usr/bin/codex'])).path, '/usr/bin/codex');
  for (const where of ['/Applications/Codex.app/Contents/Resources/codex', '/opt/homebrew/bin/codex', '/Users/test/.npm-global/bin/codex', '/Users/test/Applications/Codex.app/Contents/MacOS/codex'])
    assert.equal(cli.findCodex(null, mac([where])).path, where, where);
  const none = cli.findCodex(null, mac([]));
  assert.equal(none.path, null);
  assert.ok(none.searched.some(line => /Codex\.app/.test(line)));
});

test('the Claude CLI invocation does not move long prompts to stdin on macOS (that limit is Windows-only)', () => {
  const system = 'x'.repeat(60000);
  const mac1 = cli.buildInvocation({ provider: 'claude', bin: '/usr/local/bin/claude', system, prompt: 'hello', dir: '/private/var/folders/x/kd_chat', platform: 'darwin' });
  assert.ok(mac1.args.includes('--system-prompt'));
  assert.equal(mac1.stdin, 'hello');
  const win = cli.buildInvocation({ provider: 'claude', bin: 'claude.exe', system, prompt: 'hello', dir: 'C:/Temp/kd_chat', platform: 'win32' });
  assert.ok(!win.args.includes('--system-prompt'));
});
