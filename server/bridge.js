// bridge.js - talks to cc_bridge.py running inside KeyShot via the bridge\cmd / bridge\resp folders.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = path.join(__dirname, '..', 'bridge');
const CMD = path.join(BASE, 'cmd');
const RESP = path.join(BASE, 'resp');
const SHOTS = path.join(BASE, 'shots');
for (const d of [CMD, RESP, SHOTS]) fs.mkdirSync(d, { recursive: true });

let seq = 0;
const stoppedSessions = new Set();

// Send one op and wait for its response. Written to .tmp then renamed so the bridge never reads a partial file.
function send(op, payload = {}, timeoutMs = 8000) {
  const id = `${Date.now()}_${String(seq++).padStart(6, '0')}_${crypto.randomBytes(2).toString('hex')}`;
  const tmp = path.join(CMD, id + '.tmp');
  const command = path.join(CMD, id + '.json');
  fs.writeFileSync(tmp, JSON.stringify({ ...payload, op }), 'utf8');
  fs.renameSync(tmp, command);
  const respFile = path.join(RESP, id + '.json');
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (fs.existsSync(respFile)) {
        try {
          const r = JSON.parse(fs.readFileSync(respFile, 'utf8'));
          fs.unlink(respFile, () => {});
          const dt = Date.now() - t0; if (dt > 1500) console.log(`[bridge] slow op ${op} ${payload.id || ''} took ${(dt / 1000).toFixed(1)}s (bridge-side ${r.secs}s)`);
          return r.ok ? resolve(r.result) : reject(new Error(r.error || 'bridge error'));
        } catch (e) { /* partially written, retry */ }
      }
      if (Date.now() - t0 > timeoutMs) {
        // Only our own still-pending command. A claimed native operation cannot be interrupted safely.
        try { fs.unlinkSync(command); } catch { /* already claimed */ }
        return reject(new Error(`bridge timeout on ${op}; a claimed KeyShot operation may still be finishing`));
      }
      setTimeout(poll, 15);
    };
    poll();
  });
}

function heartbeat() {
  try {
    const h = JSON.parse(fs.readFileSync(path.join(BASE, 'heartbeat.json'), 'utf8'));
    const age = Date.now() / 1000 - h.t;
    const fresh = age >= 0 && age < 5;
    let processAlive = null;
    if (h.pid != null) {
      if (!Number.isSafeInteger(h.pid) || h.pid <= 0) processAlive = false;
      else {
        try { process.kill(h.pid, 0); processAlive = true; }
        catch (error) { processAlive = error.code === 'EPERM'; }
      }
    }
    // A KeyShot close can prevent the embedded bridge's finally block from
    // writing state="stopped". Don't trust a fresh-looking heartbeat once its
    // own host process has exited. Older heartbeat files without a PID retain
    // the freshness-only fallback.
    const stopped = typeof h.session === 'string' && stoppedSessions.has(h.session);
    const status = { state: h.state, age, alive: h.state === 'running' && fresh && processAlive !== false && !stopped, err: h.err };
    Object.defineProperty(status, 'instance', { value: h.session || null }); // internal stop correlation; omit from HTTP JSON
    return status;
  } catch { return { state: 'missing', age: null, alive: false }; }
}

function markStopped(instance) {
  if (typeof instance !== 'string' || !instance) return;
  stoppedSessions.add(instance);
  while (stoppedSessions.size > 16) stoppedSessions.delete(stoppedSessions.values().next().value);
}

module.exports = { send, heartbeat, markStopped, BASE, SHOTS };
