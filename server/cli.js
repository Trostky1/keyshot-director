// cli.js - use the user's own signed-in Claude Code (the `claude` command) as the AI engine instead of an API key.
// Each call is one headless `claude -p` run: the prompt goes in on stdin, only the Read tool is allowed (so it can look at
// image files we write to a temp folder), and the reply comes back as text. Nothing is stored in a session.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

let cachedPath, cachedStatus = { at: 0, v: null };

function findCli(cfgPath) {
  if (cfgPath && fs.existsSync(cfgPath)) return cfgPath;
  if (cachedPath && fs.existsSync(cachedPath)) return cachedPath;
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) for (const n of process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude']) { const p = path.join(d, n); if (fs.existsSync(p)) return (cachedPath = p); }
  // the Claude desktop app ships its own copy: ...\Claude\claude-code\<version>\<hash>\claude.exe
  const roots = [process.env.APPDATA && path.join(process.env.APPDATA, 'Claude', 'claude-code'), path.join(os.homedir(), '.local', 'bin')].filter(Boolean);
  const found = [];
  for (const r of roots) {
    try {
      if (path.basename(r) === 'bin') { const p = path.join(r, exe); if (fs.existsSync(p)) return (cachedPath = p); continue; }
      for (const v of fs.readdirSync(r)) for (const h of fs.readdirSync(path.join(r, v))) {
        const p = path.join(r, v, h, exe);
        if (fs.existsSync(p)) found.push({ p, key: v.split('.').map(n => parseInt(n, 10) || 0) });
      }
    } catch { /* folder missing */ }
  }
  found.sort((a, b) => { for (let i = 0; i < 4; i++) { const d = (b.key[i] || 0) - (a.key[i] || 0); if (d) return d; } return 0; });   // newest version first
  return found.length ? (cachedPath = found[0].p) : null;
}

function status(cfgPath, force = false) {
  return new Promise(resolve => {
    if (!force && cachedStatus.v && Date.now() - cachedStatus.at < 30000) return resolve(cachedStatus.v);
    const bin = findCli(cfgPath), done = v => { cachedStatus = { at: Date.now(), v }; resolve(v); };
    if (!bin) return done({ found: false, loggedIn: false, path: null });
    execFile(bin, ['auth', 'status'], { windowsHide: true, timeout: 15000 }, (e, so) => {
      let j = null; try { j = JSON.parse(so); } catch { /* old CLI */ }
      done({ found: true, path: bin, loggedIn: !!(j && j.loggedIn), method: j && j.authMethod, version: null });
    });
  });
}

// One call. opts: { system, prompt, dir (folder the model may Read from), model, signal, timeoutMs }
function ask({ bin, system, prompt, dir, model, signal, timeoutMs = 5 * 60 * 1000 }) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--tools', 'Read', '--allowedTools', 'Read', '--permission-mode', 'default'];
    if (system) args.push('--system-prompt', system);
    if (dir) args.push('--add-dir', dir);
    if (model) args.push('--model', model);
    const cwd = dir || os.tmpdir();
    const p = spawn(bin, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', killed = false;
    const t = setTimeout(() => { killed = true; p.kill(); }, timeoutMs);
    if (signal) signal.addEventListener('abort', () => { killed = true; p.kill(); });
    p.stdout.on('data', d => (out += d)); p.stderr.on('data', d => (err += d));
    p.on('error', e => { clearTimeout(t); reject(e); });
    p.on('close', () => {
      clearTimeout(t);
      if (killed) return reject(Object.assign(new Error(signal && signal.aborted ? 'Stopped.' : 'Claude took too long to answer'), { name: signal && signal.aborted ? 'AbortError' : 'Error' }));
      let j; try { j = JSON.parse(out); } catch { return reject(new Error((err || out || 'no answer from the Claude CLI').toString().slice(0, 300))); }
      if (j.is_error) return reject(new Error(/login|auth/i.test(j.result || '') ? 'Claude is not signed in. Run  "' + bin + '" auth login  once in a terminal, then try again.' : String(j.result || 'Claude CLI error').slice(0, 300)));
      resolve(String(j.result || ''));
    });
    p.stdin.end(prompt);
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

module.exports = { findCli, status, ask, extractJson, tmpDir, rmDir };
