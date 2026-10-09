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

// Send one op and wait for its response. Written to .tmp then renamed so the bridge never reads a partial file.
function send(op, payload = {}, timeoutMs = 8000) {
  const id = `${Date.now()}_${String(seq++).padStart(6, '0')}_${crypto.randomBytes(2).toString('hex')}`;
  const tmp = path.join(CMD, id + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify({ op, ...payload }), 'utf8');
  fs.renameSync(tmp, path.join(CMD, id + '.json'));
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
      if (Date.now() - t0 > timeoutMs) return reject(new Error(`bridge timeout on ${op} (is cc_bridge.py running in KeyShot?)`));
      setTimeout(poll, 15);
    };
    poll();
  });
}

function heartbeat() {
  try {
    const h = JSON.parse(fs.readFileSync(path.join(BASE, 'heartbeat.json'), 'utf8'));
    const age = Date.now() / 1000 - h.t;
    return { state: h.state, age, alive: h.state === 'running' && age < 5, err: h.err };
  } catch { return { state: 'missing', age: null, alive: false }; }
}

module.exports = { send, heartbeat, BASE, SHOTS };
