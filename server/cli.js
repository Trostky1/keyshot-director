// cli.js - use the user's own signed-in Claude Code (the `claude` command) as the AI engine instead of an API key.
// Each call is one headless `claude -p` run: the prompt goes in on stdin, only the Read tool is allowed (so it can look at
// image files we write to a temp folder), and the reply comes back as text. Nothing is stored in a session.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

let cachedPath, cachedStatus = { at: 0, v: null };

// What the finders need from the machine. Tests replace all of it to exercise the macOS branch from any host.
function systemDeps(deps = {}) {
  const platform = deps.platform || process.platform;
  const fsx = deps.fs || fs;
  return {
    platform, fs: fsx, injected: !!deps.fs,
    env: deps.env || process.env,
    home: deps.home || os.homedir(),
    delimiter: platform === 'win32' ? ';' : ':',
    // a program file: a regular file, and on macOS also executable (a downloaded copy can lose its executable bit)
    ok(p) {
      try {
        if (!p || !fsx.statSync(p).isFile()) return false;
        if (platform !== 'win32' && fsx.accessSync) fsx.accessSync(p, fs.constants.X_OK);
        return true;
      } catch { return false; }
    },
  };
}
const pathJoin = (platform, ...parts) => (platform === 'win32' ? path.win32 : path.posix).join(...parts);
const cmpVersionDesc = (x, y) => { for (let i = 0; i < 4; i++) { const d = (y.key[i] || 0) - (x.key[i] || 0); if (d) return d; } return 0; };
const versionKey = name => String(name).split('.').map(n => parseInt(n, 10) || 0);

// Where a command-line program normally lands on macOS, whichever way it was installed (standalone installer, Homebrew,
// npm, bun). The desktop-app folders are scanned separately because they contain a version folder.
function macProgramFolders(home) {
  return ['.local/bin', '.claude/local', '.npm-global/bin', '.bun/bin', '.volta/bin', '.codex/bin'].map(d => path.posix.join(home, d))
    .concat(['/opt/homebrew/bin', '/usr/local/bin']);
}
// nvm keeps one npm prefix per Node version: ~/.nvm/versions/node/<version>/bin
function nvmFolders(home, fsx) {
  const root = path.posix.join(home, '.nvm', 'versions', 'node');
  try { return fsx.readdirSync(root).map(v => ({ v, key: versionKey(v.replace(/^v/, '')) })).sort(cmpVersionDesc).map(e => path.posix.join(root, e.v, 'bin')); } catch { return []; }
}

// Finds the claude command. Returns a path or null; `searched` (module-level) lists where it looked, for the Settings page.
let searched = [];
function findCli(cfgPath, deps) {
  const sys = systemDeps(deps), { platform, env, home, ok } = sys;
  const log = [];
  const done = (p, cache = true) => { searched = log; if (cache && !sys.injected) cachedPath = p; return p; };
  const exe = platform === 'win32' ? 'claude.exe' : 'claude';
  if (cfgPath) { log.push('Settings path: ' + cfgPath); if (ok(cfgPath)) return done(cfgPath); }
  if (!sys.injected && cachedPath && ok(cachedPath)) return done(cachedPath);
  // 1) on PATH (a .cmd shim cannot be run directly, so only real executables count)
  const dirs = String(env.PATH || '').split(sys.delimiter).filter(Boolean);
  for (const d of dirs) { const p = pathJoin(platform, d, exe); if (ok(p)) { log.push('PATH: ' + p); return done(p); } }
  log.push('PATH (' + dirs.length + ' folders): no ' + exe);
  const found = [];
  const scan = (root, shapes) => {
    let vs = []; try { vs = sys.fs.readdirSync(root); } catch { log.push('missing: ' + root); return; }
    log.push('scanned: ' + root + ' (' + vs.length + ' entries)');
    for (const v of vs) for (const shape of shapes(v)) { const p = pathJoin(platform, root, ...shape); if (ok(p)) found.push({ p, key: versionKey(v) }); }
  };
  if (platform === 'darwin') {
    // 2) the copy the Claude desktop app downloads: ~/Library/Application Support/Claude/claude-code/<version>/...
    //    The exact layout inside <version> has not been confirmed on a Mac, so the plausible shapes are all tried.
    const support = path.posix.join(home, 'Library', 'Application Support');
    for (const app of ['Claude', 'Claude Code']) {
      const root = path.posix.join(support, app, 'claude-code');
      let hashes = {}; try { for (const v of sys.fs.readdirSync(root)) { try { hashes[v] = sys.fs.readdirSync(path.posix.join(root, v)); } catch { hashes[v] = []; } } } catch { /* reported by scan */ }
      scan(root, v => [[v, 'claude'], [v, 'claude.app', 'Contents', 'MacOS', 'claude'],
        ...(hashes[v] || []).flatMap(h => [[v, h, 'claude'], [v, h, 'claude.app', 'Contents', 'MacOS', 'claude']])]);
    }
    found.sort(cmpVersionDesc);
    if (found.length) return done(found[0].p);
    // 3) the usual homes of the standalone installer, Homebrew and npm
    for (const d of [...macProgramFolders(home), ...nvmFolders(home, sys.fs)]) { const p = path.posix.join(d, exe); log.push('checked: ' + p); if (ok(p)) return done(p); }
    searched = log; return null;
  }
  if (platform !== 'win32') {
    for (const d of macProgramFolders(home)) { const p = path.posix.join(d, exe); log.push('checked: ' + p); if (ok(p)) return done(p); }
    searched = log; return null;
  }
  // 2) the copy the Claude desktop app ships: <AppData>Claudeclaude-code<version><hash>claude.exe  (newest version wins)
  const appData = env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), local = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local');
  const scanWin = root => {
    let vs = []; try { vs = sys.fs.readdirSync(root); } catch { log.push('missing: ' + root); return; }
    log.push('scanned: ' + root + ' (' + vs.length + ' entries)');
    for (const v of vs) {
      let hs = []; try { hs = sys.fs.readdirSync(path.win32.join(root, v)); } catch { continue; }          // a file, not a folder
      for (const h of hs) { const p = path.win32.join(root, v, h, exe); if (ok(p)) found.push({ p, key: versionKey(v) }); }
    }
  };
  // The Claude desktop app is a Microsoft Store (MSIX) app. Inside the app its data appears under AppData\Roaming, but
  // every other program (like this server) must use the real package folder:
  //   <LocalAppData>\Packages\Claude_<id>\LocalCache\Roaming\Claude\claude-code
  try {
    for (const pk of sys.fs.readdirSync(path.win32.join(local, 'Packages'))) {
      if (/^(Claude|Anthropic)/i.test(pk)) scanWin(path.win32.join(local, 'Packages', pk, 'LocalCache', 'Roaming', 'Claude', 'claude-code'));
    }
  } catch { log.push('no Packages folder under ' + local); }
  scanWin(path.win32.join(appData, 'Claude', 'claude-code'));
  scanWin(path.win32.join(local, 'Claude', 'claude-code'));
  scanWin(path.win32.join(local, 'AnthropicClaude', 'claude-code'));
  found.sort(cmpVersionDesc);
  if (found.length) return done(found[0].p);
  // 3) the standalone installer's usual homes
  for (const p of [path.win32.join(home, '.local', 'bin', exe), path.win32.join(local, 'Programs', 'claude', exe), path.win32.join(appData, 'npm', exe)]) { log.push('checked: ' + p); if (ok(p)) return done(p); }
  searched = log; return null;
}

function status(cfgPath, force = false) {
  return new Promise(resolve => {
    if (!force && cachedStatus.v && Date.now() - cachedStatus.at < 30000) return resolve(cachedStatus.v);
    cachedPath = null;                                                   // re-search: versions change when the desktop app updates
    const bin = findCli(cfgPath), done = v => { cachedStatus = { at: Date.now(), v: { ...v, searched: searched.slice(0, 12) } }; resolve(cachedStatus.v); };
    if (!bin) return done({ found: false, loggedIn: false, path: null });
    execFile(bin, ['auth', 'status'], { windowsHide: true, timeout: 20000 }, (e, so) => {
      let j = null; try { j = JSON.parse(so); } catch { /* old CLI */ }
      done({ found: true, path: bin, loggedIn: !!(j && j.loggedIn), method: j && j.authMethod, error: e && !j ? String(e.message).slice(0, 200) : null });
    });
  });
}

// ---- ChatGPT: the OpenAI Codex CLI (the Codex desktop app ships one; `codex login` signs it in with a ChatGPT account) ----
let codexPath = null, codexStatusCache = { at: 0, v: null };
function findCodex(cfgPath, deps) {
  const sys = systemDeps(deps), { platform, env, home, ok } = sys;
  const searchedC = [];
  const done = p => { if (!sys.injected) codexPath = p; return { path: p, searched: searchedC }; };
  if (cfgPath) { searchedC.push('Settings path: ' + cfgPath); if (ok(cfgPath)) return { path: cfgPath, searched: searchedC }; }
  if (!sys.injected && codexPath && ok(codexPath)) return { path: codexPath, searched: searchedC };
  const exe = platform === 'win32' ? 'codex.exe' : 'codex';
  for (const d of String(env.PATH || '').split(sys.delimiter).filter(Boolean)) { const p = pathJoin(platform, d, exe); if (ok(p)) return done(p); }
  searchedC.push('PATH: no ' + exe);
  if (platform !== 'win32') {
    // The Codex desktop app's bundled copy location on a Mac has not been confirmed; the plausible places are checked.
    const apps = ['/Applications', path.posix.join(home, 'Applications')].map(d => path.posix.join(d, 'Codex.app', 'Contents'));
    const fixed = [...apps.flatMap(a => [path.posix.join(a, 'Resources', exe), path.posix.join(a, 'MacOS', exe)]),
      ...macProgramFolders(home).map(d => path.posix.join(d, exe)), ...nvmFolders(home, sys.fs).map(d => path.posix.join(d, exe))];
    for (const p of fixed) { searchedC.push('checked: ' + p); if (ok(p)) return done(p); }
    return { path: null, searched: searchedC };
  }
  const local = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local');
  const cands = [];
  const bin = path.win32.join(local, 'OpenAI', 'Codex', 'bin');            // the desktop app: ...\OpenAI\Codex\bin\<hash>\codex.exe
  try { for (const h of sys.fs.readdirSync(bin)) { const p = path.win32.join(bin, h, exe); if (ok(p)) cands.push({ p, t: sys.fs.statSync(p).mtimeMs }); } searchedC.push('scanned: ' + bin); } catch { searchedC.push('missing: ' + bin); }
  cands.sort((x, y) => y.t - x.t);
  if (cands.length) return done(cands[0].p);
  for (const p of [path.win32.join(home, '.codex', '.sandbox-bin', exe), path.win32.join(env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), 'npm', exe)]) { searchedC.push('checked: ' + p); if (ok(p)) return done(p); }
  return { path: null, searched: searchedC };
}
function codexStatus(cfgPath, force = false) {
  return new Promise(resolve => {
    if (!force && codexStatusCache.v && Date.now() - codexStatusCache.at < 30000) return resolve(codexStatusCache.v);
    codexPath = null;
    const f = findCodex(cfgPath), done = v => { codexStatusCache = { at: Date.now(), v: { ...v, searched: f.searched.slice(0, 10) } }; resolve(codexStatusCache.v); };
    if (!f.path) return done({ found: false, loggedIn: false, path: null });
    execFile(f.path, ['login', 'status'], { windowsHide: true, timeout: 20000 }, (e, so, se) => {
      const text = String(so || '') + String(se || '');
      done({ found: true, path: f.path, loggedIn: !e && /logged in/i.test(text), method: (text.match(/using (.+)/i) || [])[1] || null, error: e ? String(e.message).slice(0, 160) : null });
    });
  });
}

// One call. opts: { provider: 'claude' | 'codex', bin, system, prompt, dir (folder the model may read), images: [file paths], model, signal, timeoutMs }
function buildInvocation({ provider = 'claude', bin, system, prompt, dir, images = [], model, platform = process.platform }) {
  const cwd = dir || tmpBase();
  let args, outFile = null, stdin = prompt;
  if (provider === 'codex') {
    outFile = path.join(cwd, '.codex_reply_' + process.pid + '_' + Date.now() + '.txt');
    args = ['exec', '--skip-git-repo-check', '-s', 'read-only', '--ephemeral', '--color', 'never', '-C', cwd, '-o', outFile];
    if (model) args.push('-m', model);
    for (const f of images) args.push('-i', f);
    args.push('--', '-');
    stdin = (system ? system + '\n\n---\n\n' : '') + prompt;            // codex has no separate system-prompt flag
  } else {
    args = ['-p', '--output-format', 'json', '--no-session-persistence', '--tools', 'Read', '--allowedTools', 'Read', '--permission-mode', 'default'];
    if (system) args.push('--system-prompt', system);
    if (dir) args.push('--add-dir', dir);
    if (model) args.push('--model', model);
  }

  // Windows CreateProcess has a ~32K UTF-16 command-line ceiling. Scene
  // snapshots and the Material Director tool catalog can make Claude's
  // --system-prompt argument exceed it. Keep the CLI args small and stream the
  // same instructions through stdin when the command approaches that limit.
  if (provider !== 'codex' && platform === 'win32') {
    const commandChars = [String(bin || ''), ...args].reduce((total, value) => total + String(value).length + 3, 0);
    if (commandChars > 24000 && system) {
      const at = args.indexOf('--system-prompt');
      if (at >= 0) args.splice(at, 2);
      stdin = 'DIRECTOR SYSTEM INSTRUCTIONS (follow these for this request):\n' + system +
        '\n\n--- USER REQUEST AND CONTEXT ---\n' + (prompt || '');
    }
  }
  return { args, stdin, outFile, cwd };
}

function ask({ provider = 'claude', bin, system, prompt, dir, images = [], model, signal, timeoutMs = 5 * 60 * 1000 }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Stopped.'));
    const who = provider === 'codex' ? 'Codex (ChatGPT)' : 'Claude';
    const { args, stdin, outFile, cwd } = buildInvocation({ provider, bin, system, prompt, dir, images, model });
    const p = spawn(bin, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', killed = false;
    const t = setTimeout(() => { killed = true; p.kill(); }, timeoutMs);
    const abort = () => { killed = true; p.kill(); };
    if (signal) signal.addEventListener('abort', abort, { once: true });
    p.stdout.on('data', d => (out = (out + d).slice(-2000000))); p.stderr.on('data', d => (err = (err + d).slice(-2000000)));
    p.stdin.on('error', () => {});
    p.on('error', e => {
      clearTimeout(t); signal?.removeEventListener('abort', abort);
      reject(e && e.code === 'ENAMETOOLONG'
        ? new Error(`${who} could not start because Windows rejected an oversized command line. Director now streams long prompt context through stdin; restart the app if this message persists.`)
        : e);
    });
    p.on('close', code => {
      clearTimeout(t);
      signal?.removeEventListener('abort', abort);
      if (killed) return reject(Object.assign(new Error(signal && signal.aborted ? 'Stopped.' : who + ' took too long to answer'), { name: signal && signal.aborted ? 'AbortError' : 'Error' }));
      if (provider === 'codex') {
        let text = ''; try { text = fs.readFileSync(outFile, 'utf8'); fs.unlinkSync(outFile); } catch { /* no file */ }
        if (text.trim()) return resolve(text);
        const msg = (err + out).trim();
        return reject(new Error(/login|sign in|auth|401/i.test(msg) ? 'Codex is not signed in. Run  "' + bin + '" login  once in a terminal, then try again.' : (msg.split('\n').slice(-3).join(' ') || 'no answer from the Codex CLI (exit ' + code + ')').slice(0, 300)));
      }
      let j; try { j = JSON.parse(out); } catch { return reject(new Error((err || out || 'no answer from the Claude CLI').toString().slice(0, 300))); }
      if (j.is_error) return reject(new Error(/login|auth/i.test(j.result || '') ? 'Claude is not signed in. Run  "' + bin + '" auth login  once in a terminal, then try again.' : String(j.result || 'Claude CLI error').slice(0, 300)));
      resolve(String(j.result || ''));
    });
    p.stdin.end(stdin);
  });
}

// pull the first top-level JSON object out of free text
function extractJson(text) {
  const s = String(text), start = s.indexOf('{'); if (start < 0) throw new Error('no JSON in the model reply');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error('unterminated JSON in the model reply');
}

// macOS temp folders live under /var, a symlink to /private/var. The folder is handed to Claude's --add-dir and Codex's -C, which
// compare real paths, so give them the resolved spelling. Windows keeps os.tmpdir() exactly as before.
function tmpBase(platform = process.platform, tmp = os.tmpdir(), realpath = fs.realpathSync) {
  if (platform === 'win32') return tmp;
  try { return realpath(tmp); } catch { return tmp; }
}
function tmpDir(tag) { return fs.mkdtempSync(path.join(tmpBase(), 'kd_' + tag + '_')); }
function rmDir(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }

function lastSearched() { return searched.slice(); }

module.exports = { lastSearched, tmpBase, findCli, status, findCodex, codexStatus, ask, buildInvocation, extractJson, tmpDir, rmDir };
