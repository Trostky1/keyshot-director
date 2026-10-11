// janitor.js - keeps the app from leaving a mess behind. Runs when a job finishes, when the app has been idle for a while,
// and once at start-up. It only ever touches things this app made:
//   * bridge/shots/*          scratch pictures used for measuring and previews (anything older than a few minutes)
//   * auto-numbered cameras   "<scene>-KS20xx. N" (what the old screenshot call piled up); never the active camera,
//                             "last_active", or a camera with any other name; the first few numbered ones are kept
// Rendered videos in renders/ are never deleted. Frames are removed by the renderer itself after a successful encode.
const fs = require('fs');
const path = require('path');

const SHOTS = path.join(__dirname, '..', 'bridge', 'shots');
// Never infer ownership from a filename or age. Preserve anything already present at startup.
const preexisting = new Set(fs.existsSync(SHOTS) ? fs.readdirSync(SHOTS) : []);
const state = { last: 0, running: false, lastReport: null, idleSince: Date.now() };

function tidyShots(maxAgeMs = 5 * 60 * 1000) {
  let n = 0, bytes = 0;
  try {
    for (const f of fs.readdirSync(SHOTS)) {
      if (preexisting.has(f)) continue;
      const p = path.join(SHOTS, f);
      try { const st = fs.statSync(p); if (st.isFile() && Date.now() - st.mtimeMs > maxAgeMs) { bytes += st.size; fs.unlinkSync(p); n++; } } catch { /* in use or gone */ }
    }
  } catch { /* folder missing */ }
  return { files: n, mb: +(bytes / 1048576).toFixed(1) };
}

async function tidyCameras(send, { keepFirst = 30, minAuto = 60 } = {}) {
  const info = await send('cameras_info', {}, 120000);
  if (info.auto_numbered <= minAuto) return { removed: 0, auto: info.auto_numbered };
  let removed = 0, left = 1, rounds = 0;
  while (left > 0 && rounds++ < 400) {
    // short batches with a breather in between: while a batch runs KeyShot's window can't respond
    const r = await send('cameras_cleanup', { keep_first: keepFirst, apply: true, max_secs: 4 }, 180000);
    removed += r.removed; left = r.remaining_to_remove;
    if (r.error || r.removed === 0) break;
    await new Promise(res => setTimeout(res, 1500));
  }
  return { removed, remaining: left };
}

// opts: { send, alive: () => bool, busy: () => bool, cameras: bool }
async function run(opts, why = '') {
  if (state.running) return state.lastReport;
  state.running = true; state.last = Date.now();
  const rep = { why, at: new Date().toISOString(), shots: tidyShots(why === 'job' ? 60 * 1000 : 5 * 60 * 1000) };
  try {
    if (opts.cameras === true && opts.alive() && !opts.busy()) rep.cameras = await tidyCameras(opts.send);
  } catch (e) { rep.error = e.message; }
  finally { state.running = false; state.lastReport = rep; }
  if (rep.shots.files || (rep.cameras && rep.cameras.removed)) console.log('[tidy]', JSON.stringify(rep));
  return rep;
}

// call touch() whenever the user does something; start() then tidies after jobs and when the app sits idle
function start(opts) {
  setInterval(() => {
    const idle = Date.now() - state.idleSince > 10 * 60 * 1000, due = Date.now() - state.last > 30 * 60 * 1000;
    if (idle && due && !opts.busy()) run(opts, 'idle').catch(() => {});
  }, 60 * 1000);
  setTimeout(() => run({ ...opts, cameras: false }, 'start').catch(() => {}), 2000);
}
const touch = () => { state.idleSince = Date.now(); };

module.exports = { run, start, touch, tidyShots, state };
