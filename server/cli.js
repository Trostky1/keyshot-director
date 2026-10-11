// cli.js - use the user's own signed-in Claude Code (the `claude` command) as the AI engine instead of an API key.
// Each call is one headless `claude -p` run: the prompt goes in on stdin, only the Read tool is allowed (so it can look at
// image files we write to a temp folder), and the reply comes back as text. Nothing is stored in a session.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

let cachedPath, cachedStatus = { at: 0, v: null };

// Finds the claude command. Returns a path or null; `searched` (module-level) lists where it looked, for the Settings page.
let searched = [];
function findCli(cfgPath) {
  searched = [];
  const ok = p => { try { return !!p && fs.statSync(p).isFile(); } catch { return false; } };
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  if (cfgPath) { searched.push('Settings path: ' + cfgPath); if (ok(cfgPath)) return (cachedPath = cfgPath); }
  if (cachedPath && ok(cachedPath)) return cachedPath;
  // 1) on PATH (a .cmd shim cannot be run directly, so only real executables count)
  for (const d of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) { const p = path.join(d, exe); if (ok(p)) { searched.push('PATH: ' + p); return (cachedPath = p); } }
  searched.push('PATH (' + (process.env.PATH || '').split(path.delimiter).length + ' folders): no ' + exe);
  // 2) the copy the Claude desktop app ships: <AppData>Claudeclaude-code<version><hash>claude.exe  (newest version wins)
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const found = [];
  const scan = root => {
    let vs = []; try { vs = fs.readdirSync(root); } catch { searched.push('missing: ' + root); return; }
    searched.push('scanned: ' + root + ' (' + vs.length + ' entries)');
    for (const v of vs) {
      let hs = []; try { hs = fs.readdirSync(path.join(root, v)); } catch { continue; }          // a file, not a folder
      for (const h of hs) { const p = path.join(root, v, h, exe); if (ok(p)) found.push({ p, key: v.split('.').map(n => parseInt(n, 10) || 0) }); }
    }
  };
  // The Claude desktop app is a Microsoft Store (MSIX) app. Inside the app its data appears under AppData\\Roaming, but
  // every other program (like this server) must use the real package folder:
  //   <LocalAppData>\\Packages\\Claude_<id>\\LocalCache\\Roaming\\Claude\\claude-code
  try {
    for (const pk of fs.readdirSync(path.join(local, 'Packages'))) {
      if (/^(Claude|Anthropic)/i.test(pk)) scan(path.join(local, 'Packages', pk, 'LocalCache', 'Roaming', 'Claude', 'claude-code'));
    }
  } catch { searched.push('no Packages folder under ' + local); }
  scan(path.join(appData, 'Claude', 'claude-code'));
  scan(path.join(local, 'Claude', 'claude-code'));
  scan(path.join(local, 'AnthropicClaude', 'claude-code'));
  found.sort((x, y) => { for (let i = 0; i < 4; i++) { const d = (y.key[i] || 0) - (x.key[i] || 0); if (d) return d; } return 0; });
  if (found.length) return (cachedPath = found[0].p);
  // 3) the standalone installer's usual homes
  for (const p of [path.join(home, '.local', 'bin', exe), path.join(local, 'Programs', 'claude', exe), path.join(appData, 'npm', exe)]) { searched.push('checked: ' + p); if (ok(p)) return (cachedPath = p); }
  return null;
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
function findCodex(cfgPath) {
  const ok = p => { try { return !!p && fs.statSync(p).isFile(); } catch { return false; } };
  const searchedC = [];
  if (cfgPath) { searchedC.push('Settings path: ' + cfgPath); if (ok(cfgPath)) return { path: cfgPath, searched: searchedC }; }
  if (codexPath && ok(codexPath)) return { path: codexPath, searched: searchedC };
  const exe = process.platform === 'win32' ? 'codex.exe' : 'codex';
  for (const d of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) { const p = path.join(d, exe); if (ok(p)) return { path: (codexPath = p), searched: searchedC }; }
  searchedC.push('PATH: no ' + exe);
  const home = os.homedir(), local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const cands = [];
  const bin = path.join(local, 'OpenAI', 'Codex', 'bin');            // the desktop app: ...\OpenAI\Codex\bin\<hash>\codex.exe
  try { for (const h of fs.readdirSync(bin)) { const p = path.join(bin, h, exe); if (ok(p)) cands.push({ p, t: fs.statSync(p).mtimeMs }); } searchedC.push('scanned: ' + bin); } catch { searchedC.push('missing: ' + bin); }
  cands.sort((x, y) => y.t - x.t);
  if (cands.length) return { path: (codexPath = cands[0].p), searched: searchedC };
  for (const p of [path.join(home, '.codex', '.sandbox-bin', exe), path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm', exe)]) { searchedC.push('checked: ' + p); if (ok(p)) return { path: (codexPath = p), searched: searchedC }; }
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
function ask({ provider = 'claude', bin, system, prompt, dir, images = [], model, signal, timeoutMs = 5 * 60 * 1000 }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Stopped.'));
    const who = provider === 'codex' ? 'Codex (ChatGPT)' : 'Claude';
    const cwd = dir || os.tmpdir();
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
    const p = spawn(bin, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', killed = false;
    const t = setTimeout(() => { killed = true; p.kill(); }, timeoutMs);
    const abort = () => { killed = true; p.kill(); };
    if (signal) signal.addEventListener('abort', abort, { once: true });
    p.stdout.on('data', d => (out = (out + d).slice(-2000000))); p.stderr.on('data', d => (err = (err + d).slice(-2000000)));
    p.stdin.on('error', () => {});
    p.on('error', e => { clearTimeout(t); signal?.removeEventListener('abort', abort); reject(e); });
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

function tmpDir(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), 'kd_' + tag + '_')); }
function rmDir(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }

module.exports = { findCli, status, findCodex, codexStatus, ask, extractJson, tmpDir, rmDir };
