// server.js - local web server: control UI (2nd monitor / phone) + API into KeyShot via the bridge.
// Run:  node server\server.js      then open http://localhost:8787  (phone: use the QR shown on the page)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { send, heartbeat, BASE, SHOTS } = require('./bridge');
const { poseToEye, eyeToPose, sample, presets } = require('./shots');
const agent = require('./agent');
const { execFile } = require('child_process');
const { RIGS, ENV_RIGS, buildRig, toPos } = require('./rigs');
const { decode, productStats } = require('./png');
const style = require('./style');
const video = require('./video');
const janitor = require('./janitor');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- studio lighting state (what we believe is in KeyShot; the bridge keeps the real registry) ----
const studio = { rig: null, exposure: 1, frameAz: 0, mirror: false, subject: null, env: null, lights: {}, target: null, envScales: false, lastAuto: null };

// Measure the product's own brightness in the live viewport (see png.js productStats).
async function measure(settleMs = 2500) {
  await sleep(Math.min(settleMs, 400));                       // (the capture is a render now; it converges on its own)
  const r = await send('screenshot', { name: 'measure', width: 640, secs: 1.5 }, 30000);
  return productStats(decode(fs.readFileSync(r.path)));
}
// Score the live viewport against a style folder's looks; returns the closest look, its distance, and per-feature deltas.
async function scoreLive(name, settleMs = 2500) {
  await sleep(settleMs);
  const r = await send('screenshot', { name: 'style_score', width: 640, secs: 1.5 }, 30000);
  const f = style.features(decode(fs.readFileSync(r.path)));
  const prof = style.loadProfile(name);
  const scored = prof.looks.map(l => ({ look: l.id, images: l.images.length, ...style.score(f, l.profile) })).sort((a, b) => a.distance - b.distance);
  return { style: name, best: scored[0], all: scored.map(s => ({ look: s.look, distance: s.distance })), features: f };
}
// ---- style matching: tune the current rig toward a style's look by measuring the live viewport --------------------------
// Greedy coordinate descent over: environment brightness, every light's brightness, and the key light's side/position.
// Each probe edits KeyShot, lets the real-time render settle, measures, and keeps the change only if the style distance drops.
const matchJob = { running: false, log: [], result: null };
async function matchStyle(name, { look, rounds = 3, settle = 2200 } = {}) {
  if (matchJob.running) throw new Error('a match is already running');
  Object.assign(matchJob, { running: true, log: [], result: null, startedAt: Date.now() });
  const say = m => { matchJob.log.push(((Date.now() - matchJob.startedAt) / 1000).toFixed(0) + 's  ' + m); };
  try {
    if (!studio.rig || !studio.subject) throw new Error('build a rig first (e.g. Blank studio), then match it');
    const prof = style.loadProfile(name); let target = look && prof.looks.find(l => l.id === look);
    const evalNow = async () => {
      await sleep(150); const r = await send('screenshot', { name: 'match', width: 640, secs: 1.5 }, 30000);
      const f = style.features(decode(fs.readFileSync(r.path)));
      if (!target) target = prof.looks.map(l => ({ l, s: style.score(f, l.profile).distance })).sort((a, b) => a.s - b.s)[0].l;
      return style.score(f, target.profile);
    };
    const baseEnv = studio.rig && RIGS[studio.rig] ? RIGS[studio.rig].env.brightness : 1;
    let envMul = studio.envMul ?? 1;
    const setEnv = async m => { envMul = m; studio.envMul = m; await send('env_set', { brightness: +(baseEnv * m).toFixed(3) }, 30000); };
    const params = [];
    if (studio.rig && !studio.rig.startsWith('hdri_')) {
      params.push({ id: 'env', get: () => envMul, set: v => setEnv(v), min: 0.1, max: 3, step: 1.5, mul: true });
      for (const id of Object.keys(studio.lights)) params.push({ id: id + '.gain', get: () => studio.lights[id].gain ?? 1, set: v => editLight(id, { gain: v }), min: 0.05, max: 5, step: 1.6, mul: true });
      const key = Object.keys(studio.lights).find(i => studio.lights[i].role === 'key');
      if (key) params.push({ id: key + '.az', get: () => studio.lights[key].az, set: v => editLight(key, { az: v }), min: -80, max: 80, step: 18, mul: false });
    }
    let best = await evalNow(); const start = best.distance;
    say(`look "${target.id}" (${target.images.length} images) - start distance ${best.distance}`);
    for (let round = 1; round <= rounds; round++) {
      let improved = false;
      for (const p of params) {
        const cur = p.get();
        for (const dir of [1, -1]) {
          const cand = p.mul ? cur * Math.pow(p.step, dir) : cur + dir * p.step;
          if (cand < p.min || cand > p.max) continue;
          await p.set(cand); const s = await evalNow();
          if (s.distance < best.distance - 0.004) { say(`round ${round}: ${p.id} ${(+cur).toFixed(2)} -> ${(+cand).toFixed(2)}   distance ${best.distance} -> ${s.distance}`); best = s; improved = true; break; }
          await p.set(cur);                                                  // revert and try the other direction
        }
      }
      for (const p of params) p.step = p.mul ? 1 + (p.step - 1) * 0.55 : p.step * 0.55;      // finer steps next round
      if (!improved && round > 1) break;
    }
    const final = await evalNow();
    matchJob.result = { style: name, look: target.id, startDistance: start, finalDistance: final.distance, deltas: final.deltas, tuned: Object.fromEntries(params.map(p => [p.id, +(+p.get()).toFixed(3)])) };
    say(`done: distance ${start} -> ${final.distance}`);
  } catch (e) { matchJob.result = { error: e.message }; say('error: ' + e.message); }
  finally { matchJob.running = false; tidyLater(); }
}
async function setExposure(x) {
  studio.exposure = Math.max(0.05, Math.min(12, x));
  if (studio.envScales && studio.rig && RIGS[studio.rig]) studio.env = await send('env_set', { brightness: +(RIGS[studio.rig].env.brightness * studio.exposure).toFixed(3) }, 30000);
  for (const id of Object.keys(studio.lights)) await editLight(id, {});
}
// Closed loop: measure -> compare with the rig's target tone -> scale exposure -> repeat.
// Which statistic to meter: dark rigs meter the HIGHLIGHT level (p95) like a photographer would, because the median is
// dominated by shadowed glass/liquid that barely responds to light; white rigs meter the median.
async function autoExpose({ target, metric, iterations = 4 } = {}) {
  target = target ?? studio.target ?? 0.3; metric = metric ?? studio.metric ?? 'p50';
  const steps = []; let prev = null;
  for (let i = 0; i < iterations; i++) {
    const m = await measure();
    const v = m[metric];
    steps.push({ exposure: +studio.exposure.toFixed(3), p50: +m.p50.toFixed(3), p95: +m.p95.toFixed(3), clip: +(m.clipFrac * 100).toFixed(1) });
    // guard: if the metric barely moved although exposure changed a lot, more exposure will not help - go back and stop
    if (prev && Math.abs(Math.log(studio.exposure / prev.exposure)) > Math.log(1.8) && Math.abs(Math.log(v / Math.max(0.01, prev.v))) < 0.12) {
      await setExposure(prev.exposure); steps.push({ note: 'flat response - reverted to exposure ' + prev.exposure.toFixed(2) }); break;
    }
    const ratio = target / Math.max(0.02, v);
    if (Math.abs(Math.log(ratio)) < 0.07 || i === iterations - 1) break;      // within ~7% or out of iterations
    prev = { exposure: studio.exposure, v };
    await setExposure(studio.exposure * Math.pow(Math.max(0.4, Math.min(2.5, ratio)), 1.7));
  }
  return (studio.lastAuto = { target, metric, exposure: +studio.exposure.toFixed(3), steps });
}

async function ensureSubject(force = false) {
  if (!studio.subject || force) {
    const s = await send('subject', {}, 20000);
    // sanity: a product does not suddenly grow 3x or exceed 5 m; if it does, something other than the product was measured
    if (!(s.span > 0) || s.span > 5000 || (studio.subjectOK && s.span > studio.subjectOK.span * 3)) {
      if (studio.subjectOK) { studio.subject = studio.subjectOK; return studio.subject; }
      throw new Error('subject measurement looks wrong (span ' + s.span + ' mm)');
    }
    studio.subject = studio.subjectOK = s;
  }
  return studio.subject;
}
function lightSpec(l) {                       // stage-frame light -> concrete bridge spec
  const s = studio.subject, dist = l.d * s.span;
  return {
    id: l.id, pos: toPos(s.center, studio.frameAz, l, s.span), target: s.center, size: [l.w * s.span, l.h * s.span],
    power: +(l.E * (l.gain ?? 1) * dist * dist * studio.exposure).toFixed(2),
    kelvin: l.kelvin, visible_refl: l.refl, visible_eye: l.eye,
  };
}
// Coalesce rapid edits to one light (slider drags): at most one bridge call in flight per light, latest values win.
const lightJobs = new Map();
function editLight(id, patch) {
  const job = lightJobs.get(id) || { running: false, dirty: false, patch: {}, waiters: [] };
  lightJobs.set(id, job);
  Object.assign(job.patch, patch);
  job.dirty = true;                       // an empty patch still means "re-apply this light" (e.g. exposure changed)
  return new Promise((resolve, reject) => {
    job.waiters.push({ resolve, reject });
    if (job.running) return;
    job.running = true;
    (async () => {
      while (job.dirty) {
        job.dirty = false;
        const p = job.patch, ws = job.waiters; job.patch = {}; job.waiters = [];
        try {
          const l = studio.lights[id] = { ...(studio.lights[id] || { id, role: 'custom', az: -40, el: 30, d: 3, w: 1.5, h: 1.5, E: 0.003, kelvin: 5600, refl: true, eye: false, gain: 1 }), ...p, id };
          const r = await send('light_set', lightSpec(l), 30000);
          ws.forEach(w => w.resolve({ light: l, bridge: r }));
        } catch (e) { ws.forEach(w => w.reject(e)); }
      }
      job.running = false;
    })();
  });
}
// If KeyShot already has our lights (the app or bridge was restarted, or KeyShot recovered a session), rebuild the panel's
// picture of them from what KeyShot reports so they can be edited or removed instead of silently stacking with new ones.
let synced = false;
async function syncFromKeyShot() {
  if (synced) return; synced = true;
  try {
    const l = await send('lights_list', {}, 20000), ids = Object.keys(l); if (!ids.length) return;
    const s = await ensureSubject(); studio.frameAz = 0;
    for (const id of ids) {
      const sp = l[id].spec || {};
      if (sp.pos && sp.size) {
        const v = [sp.pos[0] - s.center[0], sp.pos[1] - s.center[1], sp.pos[2] - s.center[2]], r = Math.hypot(...v) || 1;
        studio.lights[id] = { id, role: 'restored', az: Math.atan2(v[0], v[2]) * 180 / Math.PI, el: Math.asin(v[1] / r) * 180 / Math.PI, d: r / s.span, w: sp.size[0] / s.span, h: sp.size[1] / s.span,
          E: (sp.power || 100) / (r * r), kelvin: sp.kelvin || 5600, refl: sp.visible_refl !== false, eye: !!sp.visible_eye, gain: 1 };
      } else studio.lights[id] = { id, role: 'unknown', az: -40, el: 30, d: 3, w: 1.5, h: 1.5, E: 0.003, kelvin: 5600, refl: true, eye: false, gain: 1 };
    }
    studio.rig = studio.rig || 'restored';
  } catch { synced = false; }          // bridge not ready yet - try again on the next status check
}
async function clearLights() { await send('lights_clear', {}, 60000); studio.lights = {}; }
async function applyRig(name, opts = {}) {
  await clearLights();                    // measure the product only after our own lights are gone
  await ensureSubject(true);
  if (ENV_RIGS[name]) {
    studio.rig = name; studio.env = await send('env_set', { hdri: ENV_RIGS[name].hdri, brightness: 1, ground_shadows: true }, 30000);
    return { rig: name, lights: [], env: studio.env };
  }
  studio.exposure = opts.exposure ?? 1;
  studio.mirror = !!opts.mirror;
  studio.frameAz = opts.frameAz ?? (cur ? cur.az : (base ? base.az : 0));
  const rig = buildRig(name, studio.subject, { frameAz: studio.frameAz, exposure: studio.exposure, mirror: studio.mirror });
  studio.rig = name; studio.target = rig.target; studio.metric = rig.metric; studio.envScales = rig.envScales; studio.envMul = 1;
  studio.env = await send('env_set', rig.env, 30000);
  const placed = [];
  for (const l of rig.lights) {
    studio.lights[l.id] = { id: l.id, role: l.role, az: l.az, el: l.el, d: l.d, w: l.w, h: l.h, E: l.E, kelvin: l.kelvin, refl: l.visible_refl, eye: l.visible_eye, gain: 1 };
    const r = await send('light_set', lightSpec(studio.lights[l.id]), 30000);
    placed.push({ id: l.id, placement_err_mm: r.placement_err_mm });
  }
  const out = { rig: name, label: rig.label, lights: placed, env: studio.env };
  if (opts.auto !== false) out.auto = await autoExpose({ iterations: opts.iterations ?? 3 });
  return out;
}

const PORT = +(process.env.PORT || 8787);
const PUBLIC = path.join(__dirname, 'public');
const VIEWS_FILE = path.join(BASE, 'views.json');

let base = null;              // pose captured when the UI connects (pivot/az/el/dist/fov)
let cur = null;               // last pose we applied; authoritative (KeyShot's own pivot readback goes stale)
let lastClient = 0;
let playing = null;           // { cancel: bool }
let latestShot = null;        // Buffer of the newest preview
let shotBusy = false;

const loadViews = () => { try { return JSON.parse(fs.readFileSync(VIEWS_FILE, 'utf8')); } catch { return {}; } };
const saveViews = v => fs.writeFileSync(VIEWS_FILE, JSON.stringify(v, null, 2));

async function readPose() {
  const c = await send('get_camera');
  const fov = typeof c.fov === 'number' ? c.fov : 40;
  const pivot = Array.isArray(c.pivot) ? c.pivot : c.lookat;
  return { ...eyeToPose(c.pos, pivot, fov), up: c.up };
}

async function applyPose(p) {
  cur = { pivot: p.pivot, az: p.az, el: p.el, dist: p.dist, fov: p.fov };
  const eye = poseToEye(p);
  return send('set_view', { pivot: p.pivot, pos: eye, up: [0, 1, 0], fov: p.fov, noread: true });
}

// Preview: OFF by default and capped. Each capture is a small KeyShot render (the screenshot call that used to do this
// added a camera to the user's scene every time). Turn Live on in the page for a refresh every few seconds; one-off
// refreshes happen after actions. A session budget stops runaway captures.
const preview = { live: false, budget: 300, used: 0, minGapMs: 3000, last: 0, wanted: false };
async function grabPreview() {
  if (!heartbeat().alive || shotBusy || renderJob.running || preview.used >= preview.budget) return false;
  shotBusy = true; preview.used++;
  try { const r = await send('screenshot', { name: 'live', width: 960, secs: 1.0 }, 30000); latestShot = fs.readFileSync(r.path); preview.last = Date.now(); return true; }
  catch { return false; } finally { shotBusy = false; }
}
async function captureLoop() {
  while (true) {
    const due = Date.now() - preview.last >= preview.minGapMs;
    if (due && !playing && (preview.wanted || (preview.live && Date.now() - lastClient < 6000))) { preview.wanted = false; await grabPreview(); }
    await new Promise(r => setTimeout(r, 400));
  }
}

async function playRecipe(recipe) {
  if (playing) playing.cancel = true;
  const job = (playing = { cancel: false });
  const b = { ...(base || (base = await readPose())), ...(cur ? { pivot: cur.pivot } : {}) };   // presets stay relative to the current pan
  const dur = recipe.duration || 4;
  // KeyShot takes ~100-250ms per camera move, so sample by wall-clock time and drop frames
  // rather than falling behind: a 5s shot plays in 5s, at whatever frame rate the viewport sustains.
  try { await send('perf', { on: true }); } catch { /* optional */ }
  const t0 = Date.now();
  let frames = 0;
  try {
    while (!job.cancel) {
      const u = Math.min(1, (Date.now() - t0) / 1000 / dur);
      await applyPose(sample(recipe, b, u));
      frames++;
      if (u >= 1) break;
    }
  } finally {
    try { await send('perf', { on: false }); } catch { /* optional */ }
    if (playing === job) playing = null;
  }
  const secs = (Date.now() - t0) / 1000;
  return { played: !job.cancel, frames, secs: +secs.toFixed(2), avgFps: +(frames / secs).toFixed(1) };
}

// ---- match a reference video: lighting + camera, framed for the user's product ------------------------------------------
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const videoJob = { running: false, log: [], result: null, cancel: false };
async function matchVideo({ frames, duration, lighting = true, camera = true, rounds = 2 }) {
  if (videoJob.running) throw new Error('a video match is already running');
  Object.assign(videoJob, { running: true, log: [], result: null, cancel: false, startedAt: Date.now() });
  const say = m => videoJob.log.push(((Date.now() - videoJob.startedAt) / 1000).toFixed(0) + 's  ' + m);
  const stopIf = () => { if (videoJob.cancel) throw new Error('stopped'); };
  try {
    if (!Array.isArray(frames) || frames.length < 2) throw new Error('need at least 2 frames from the video');
    const fr = frames.map(f => { const m = /^data:image\/png;base64,(.+)$/.exec(f.png || ''); if (!m) throw new Error('frames must be PNG data URLs'); return { t: +f.t || 0, png: Buffer.from(m[1], 'base64') }; });
    duration = Math.max(0.5, +duration || fr[fr.length - 1].t);
    say(`${fr.length} frames, ${duration.toFixed(1)}s - analysing`);
    const a = await video.analyze(fr, duration, { log: say });
    const plan = a.plan; stopIf();
    say(`${a.engine === 'claude' ? 'AI' : 'offline'} plan: ${plan.summary}`);
    say(`lighting: ${plan.lighting.rig}${plan.lighting.mirror ? ' (mirrored)' : ''}${plan.lighting.notes ? ' - ' + plan.lighting.notes : ''}`);
    say('camera keys: ' + plan.keys.map(k => `${k.t.toFixed(1)}s az ${Math.round(k.azimuth)} el ${Math.round(k.elevation)} fill ${k.fill.toFixed(2)}${k.cut ? ' CUT' : ''}`).join(' | '));
    const out = { plan, engine: a.engine, aspect: a.aspect, duration, recipe: null };
    if (!heartbeat().alive) { say('KeyShot is not connected - plan only. Connect KeyShot and run it again to build it.'); videoJob.result = out; return; }
    if (!base) base = await readPose();
    const front = { ...(cur || base) };                       // the user's current view = the video's opening view
    if (lighting) {
      video.saveAsStyle(fr, '_video');
      const prof = await style.analyzeFolder('_video');
      say(`look profile from ${prof.analyzed} frames; building rig ${plan.lighting.rig}`);
      await applyRig(plan.lighting.rig, { mirror: plan.lighting.mirror, iterations: 3 }); stopIf();
      say('tuning the rig toward the video (this is the slow part)');
      await matchStyle('_video', { rounds });
      const r = matchJob.result; say(r && !r.error ? `lighting matched: distance ${r.startDistance} -> ${r.finalDistance}` : 'lighting tune skipped: ' + (r && r.error)); stopIf();
    }
    if (camera) {
      const subject = await ensureSubject();
      const probe = { pivot: subject.center, az: front.az, el: clamp(front.el, 0, 25), dist: front.dist, fov: front.fov };
      const cw = a.aspect >= 1 ? 320 : Math.round(320 * a.aspect / 2) * 2, chh = a.aspect >= 1 ? Math.round(320 / a.aspect / 2) * 2 : 320;
      const probeFile = path.join(SHOTS, 'calib.png');
      const shoot = async () => { await send('render_view', { pos: poseToEye(probe), pivot: probe.pivot, fov: probe.fov, path: probeFile, width: cw, height: chh, secs: 1, alpha: true }, 120000); return video.calibrateAlpha(fs.readFileSync(probeFile), probe.dist); };
      let cal = await shoot().catch(() => null);
      for (let i = 0; i < 2 && cal && (cal.touches || cal.hfrac > 0.85 || cal.hfrac < 0.12); i++) {       // cropped or tiny: step to a distance that measures well
        probe.dist *= cal.touches ? 2.2 : cal.hfrac / 0.5; cal = await shoot().catch(() => null);
      }
      if (!cal || cal.touches) { cal = video.calibrateAnalytic(subject, probe, a.aspect); say('could not measure the product in a test render - framing estimated from the lens instead'); }
      else say(`your product fills ${(cal.hfrac * 100).toFixed(0)}% of frame height at ${Math.round(cal.dist)} mm`);
      out.recipe = video.buildRecipe(plan, { base: front, subject, calib: cal, aspect: a.aspect, duration });
      out.calibration = cal;
      await applyPose(sample(out.recipe, front, 0));
      say(`camera move ready: ${out.recipe.keys.length} keys over ${duration.toFixed(1)}s - Play to preview, Render to make the video`);
    }
    videoJob.result = out;
  } catch (e) { videoJob.result = { error: e.message }; say('error: ' + e.message); }
  finally { videoJob.running = false; tidyLater(); }
}

// ---- render a camera recipe: one KeyShot render per frame, then encode. (Camera keyframes cannot be put on KeyShot's
// timeline by script, and imported glTF cameras arrive static, so the move is rendered pose by pose.) ----------------------
const RENDERS = path.join(__dirname, '..', 'renders');
const renderJob = { running: false, cancel: false, frame: 0, total: 0, log: [], result: null };
async function renderRecipe({ recipe, fps = 24, width = 1280, height = 720, secs = 4, samples, keepFrames = false }) {
  if (renderJob.running) throw new Error('a render is already running');
  if (!recipe || !Array.isArray(recipe.keys) || recipe.keys.length < 2) throw new Error('no camera move to render (match a video or record a move first)');
  width = Math.round(width / 2) * 2; height = Math.round(height / 2) * 2;            // video encoders need even sizes
  const total = Math.max(2, Math.round((recipe.duration || 4) * fps));
  Object.assign(renderJob, { running: true, cancel: false, frame: 0, total, log: [], result: null, startedAt: Date.now() });
  const say = m => renderJob.log.push(m);
  const dir = path.join(RENDERS, new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)); fs.mkdirSync(dir, { recursive: true });
  if (playing) playing.cancel = true;
  const b = { ...(base || (base = await readPose())), ...(cur ? { pivot: cur.pivot } : {}) }, back = cur || base;
  try {
    say(`${total} frames at ${width}x${height}, ${samples ? samples + ' samples' : secs + 's'} each -> ${dir}`);
    for (let i = 0; i < total && !renderJob.cancel; i++) {
      const p = sample(recipe, b, i / (total - 1));
      await send('render_view', { pos: poseToEye(p), pivot: p.pivot, fov: p.fov, path: path.join(dir, `frame.${i + 1}.png`), width, height, secs, samples }, 30 * 60 * 1000);
      renderJob.frame = i + 1;
    }
    if (renderJob.cancel) { say(`stopped after ${renderJob.frame} frames (kept in the folder)`); renderJob.result = { dir, frames: renderJob.frame, stopped: true }; return; }
    const v = await send('encode_video', { folder: dir, frames: 'frame.%d.png', video: 'move.mp4', fps, last: total }, 10 * 60 * 1000);
    if (!v.exists) throw new Error('KeyShot rendered the frames but could not encode the video (frames are in ' + dir + ')');
    let freed = 0;
    if (keepFrames !== true) for (const f of fs.readdirSync(dir)) if (/^frame.d+.png$/.test(f)) { try { freed += fs.statSync(path.join(dir, f)).size; fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ } }
    renderJob.result = { dir, video: v.video, frames: total, secs: +((Date.now() - renderJob.startedAt) / 1000).toFixed(0), framesDeleted: keepFrames !== true, freedMB: +(freed / 1048576).toFixed(0) };
    say(`done: ${v.video}` + (keepFrames === true ? '' : ` (frame pictures deleted, ${renderJob.result.freedMB} MB freed)`));
  } catch (e) { renderJob.result = { error: e.message, dir }; say('error: ' + e.message); }
  finally { renderJob.running = false; try { await applyPose(back); } catch { /* bridge gone */ } tidyLater(); }
}

function lanIPs() {
  return Object.values(os.networkInterfaces()).flat().filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
}

// ---- actions: what the prompt box (AI or offline) can do. Each returns {summary, ...data}; throwing = tool error. ----------------
let attachments = [];
const run = (file, args) => new Promise((res, rej) => execFile(file, args, { windowsHide: true, maxBuffer: 1 << 26 }, (e, so, se) => e ? rej(new Error(se || e.message)) : res(so)));
const R2 = n => (typeof n === 'number' ? +n.toFixed(2) : n);
const camState = () => { const p = cur || base; return p ? { azimuth: R2(p.az), elevation: R2(p.el), distance_mm: R2(p.dist), fov: R2(p.fov) } : null; };
const lightView = l => ({ id: l.id, role: l.role, azimuth: R2(l.az), elevation: R2(l.el), distance: R2(l.d), width: R2(l.w), height: R2(l.h), brightness: R2(l.gain ?? 1), kelvin: Math.round(l.kelvin) });

const NOT_CONNECTED = 'KeyShot is not connected. In KeyShot, run Scripts > KeyShot Director, wait for "KeyShot connected" at the top of this page, then try again.';
const needsBridge = fn => async (...a) => { if (!heartbeat().alive) throw new Error(NOT_CONNECTED); return fn(...a); };   // fail in 1 ms, not after a 60 s timeout

const actions = {
  setAttachments(a) { attachments = a || []; },
  async get_state() {
    if (!base) base = await readPose();
    const sub = studio.subject || await ensureSubject().catch(() => null);
    return { summary: `rig ${studio.rig || 'none'}, ${Object.keys(studio.lights).length} lights`, rig: studio.rig, exposure: R2(studio.exposure), lights: Object.values(studio.lights).map(lightView),
      camera: camState(), product_size_mm: sub ? sub.size.map(R2) : null, styles: style.listStyles().filter(s => !s.name.startsWith('_')).map(s => ({ name: s.name, images: s.images, analyzed: s.analyzed, looks: s.looks })), bridge_alive: heartbeat().alive };
  },
  async look() {
    await sleep(1800);
    const r = await send('screenshot', { name: 'look', width: 960, secs: 3 }, 30000);
    const jpg = path.join(BASE, 'shots', 'look_small.jpg');
    await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'tools', 'resize.ps1'), '-In', r.path, '-Out', jpg, '-MaxDim', '900']);
    const m = productStats(decode(fs.readFileSync(r.path))), b64 = fs.readFileSync(jpg).toString('base64');
    return { summary: 'viewport captured', imageBase64: b64, imageDataUrl: 'data:image/jpeg;base64,' + b64,
      product_brightness: { median: R2(m.p50), highlights: R2(m.p95), clipped_pct: R2(m.clipFrac * 100) }, backdrop_brightness: R2(m.bg) };
  },
  async apply_rig({ name, mirror, auto_exposure }) {
    if (!RIGS[name]) throw new Error('unknown rig ' + name);
    const r = await applyRig(name, { mirror: !!mirror, auto: auto_exposure !== false });
    return { summary: `${RIGS[name].label}: ${r.lights.length} lights` + (r.auto ? `, exposure ${r.auto.exposure}` : ''), rig: name, lights: Object.values(studio.lights).map(lightView), exposure: studio.exposure };
  },
  async set_light({ id, azimuth, elevation, distance, width, height, brightness, kelvin, in_reflections }) {
    await ensureSubject();
    const p = {}; if (azimuth != null) p.az = azimuth; if (elevation != null) p.el = elevation; if (distance != null) p.d = distance; if (width != null) p.w = width; if (height != null) p.h = height;
    if (brightness != null) p.gain = brightness; if (kelvin != null) p.kelvin = kelvin; if (in_reflections != null) p.refl = in_reflections;
    if (!studio.lights[id] && !studio.rig) studio.rig = 'custom';
    const r = await editLight(id, p);
    return { summary: `light ${id} updated`, light: lightView(r.light) };
  },
  async remove_light({ id }) { await send('light_remove', { id }, 30000); delete studio.lights[id]; return { summary: `removed ${id}` }; },
  async set_exposure({ value }) { await ensureSubject(); await setExposure(+value); return { summary: `exposure ${R2(studio.exposure)}x`, exposure: studio.exposure }; },
  async auto_expose() { await ensureSubject(); const a = await autoExpose({}); return { summary: `exposure ${a.exposure}`, ...a }; },
  async studio_off() { const r = await send('studio_off', {}, 60000); studio.lights = {}; studio.rig = null; studio.env = null; return { summary: 'lights removed, original environment restored', ...r }; },
  async set_camera({ azimuth, elevation, distance, fov, relative }) {
    if (!base) base = await readPose();
    const c = { ...(cur || base) };
    const add = (k, v, lo, hi) => { if (v != null) c[k] = Math.max(lo, Math.min(hi, relative ? c[k] + v : v)); };
    add('az', azimuth, -1e4, 1e4); add('el', elevation, -85, 85); add('dist', distance, 5, 3000); add('fov', fov, 8, 90);
    await applyPose(c); return { summary: 'camera set', camera: camState() };
  },
  async play_motion({ preset, duration }) {
    if (!base) base = await readPose();
    const rec = presets({ ...(cur || base), pivot: (cur || base).pivot }, duration)[preset]; if (!rec) throw new Error('unknown preset ' + preset);
    const r = await playRecipe(rec); return { summary: `${rec.label}: ${r.secs}s, ${r.avgFps} fps preview`, ...r };
  },
  async analyze_style({ name }) {
    if (!style.listStyles().some(s => s.name === name)) throw new Error('no style folder named ' + name + ' (put images in references/' + name + ')');
    const r = await style.analyzeFolder(name);
    return { summary: `${r.analyzed} images, ${r.looks.length} look(s)`, looks: r.looks.map(l => ({ id: l.id, images: l.images.length, backdrop: l.profile.bgLuma && l.profile.bgLuma.med, tone: l.profile.p50 && l.profile.p50.med, contrast: l.profile.contrast && l.profile.contrast.med })), failed: r.failed.length };
  },
  async use_attached_images_as_style() {
    if (!attachments.length) throw new Error('no images are attached to this message');
    const dir = path.join(style.ROOT, '_prompt'); fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) if (/^ref_\d+\./.test(f)) fs.unlinkSync(path.join(dir, f));       // only files this feature wrote
    attachments.forEach((d, i) => { const m = /^data:image\/([a-z0-9+.-]+);base64,(.+)$/i.exec(d); if (m) fs.writeFileSync(path.join(dir, `ref_${i + 1}.${m[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg')}`), Buffer.from(m[2], 'base64')); });
    return actions.analyze_style({ name: '_prompt' });
  },
  async match_style({ name, look }) {
    if (!studio.rig) throw new Error('build a rig first (apply_rig), then match it');
    await matchStyle(name, { look, rounds: 3 });
    const r = matchJob.result; if (!r || r.error) throw new Error((r && r.error) || 'match failed');
    return { summary: `style distance ${r.startDistance} -> ${r.finalDistance}`, ...r, deltas: undefined };
  },
};

for (const k of ['look', 'apply_rig', 'set_light', 'remove_light', 'set_exposure', 'auto_expose', 'studio_off', 'set_camera', 'play_motion', 'match_style']) actions[k] = needsBridge(actions[k]);
{ const gs = actions.get_state; actions.get_state = async () => (heartbeat().alive ? gs() : { summary: 'KeyShot is not connected', bridge_alive: false, styles: style.listStyles().filter(s => !s.name.startsWith('_')).map(s => ({ name: s.name, images: s.images, analyzed: s.analyzed })) }); }

let promptJob = null;
const body = req => new Promise(res => { let d = ''; req.on('data', c => (d += c)); req.on('end', () => { try { res(JSON.parse(d || '{}')); } catch { res({}); } }); });
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname !== '/api/preview') janitor.touch();
  try {
    if (url.pathname === '/api/status') {
      lastClient = Date.now();
      if (!synced && heartbeat().alive) syncFromKeyShot();
      return json(res, 200, { bridge: heartbeat(), ips: lanIPs(), port: PORT, playing: !!playing, base });
    }
    if (url.pathname === '/api/preview.jpg' || url.pathname === '/api/preview.png') {
      lastClient = Date.now();
      if (!latestShot) { res.writeHead(204); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      return res.end(latestShot);
    }
    if (url.pathname === '/api/preview' && req.method === 'POST') { const b = await body(req); if (typeof b.live === 'boolean') { preview.live = b.live; if (b.live) preview.used = 0; } if (b.now) preview.wanted = true; return json(res, 200, { live: preview.live, used: preview.used, budget: preview.budget }); }
    if (url.pathname === '/api/connect' && req.method === 'GET') {
      // one statement for KeyShot's scripting console; forward slashes so there is nothing to escape
      const root = path.resolve(__dirname, '..').split(path.sep).join('/');
      const line = `exec("KD_HOME = '${root.replace(/'/g, "\\'")}'; exec(open(KD_HOME + '/bridge/cc_bridge.py', encoding='utf-8-sig').read())")`;
      return json(res, 200, { line });
    }
    if (url.pathname === '/api/tidy' && req.method === 'POST') return json(res, 200, await janitor.run(tidyOpts, 'manual'));
    if (url.pathname === '/api/preview' && req.method === 'GET') return json(res, 200, { live: preview.live, used: preview.used, budget: preview.budget });
    if (url.pathname === '/api/pose' && req.method === 'GET') { base = base || (await readPose()); return json(res, 200, cur || base); }
    if (url.pathname === '/api/rebase' && req.method === 'POST') { base = cur = await readPose(); return json(res, 200, base); }
    if (url.pathname === '/api/pose' && req.method === 'POST') {
      const b = await body(req); base = base || (await readPose());
      return json(res, 200, await applyPose({ pivot: b.pivot || (cur || base).pivot, az: b.az, el: b.el, dist: b.dist, fov: b.fov ?? base.fov }));
    }
    if (url.pathname === '/api/play' && req.method === 'POST') {
      let b = await body(req);
      if (b.preset) { if (!base) base = await readPose(); const rec = presets(cur || base, b.duration)[b.preset]; if (!rec) return json(res, 400, { error: 'unknown preset ' + b.preset }); b = rec; }
      return json(res, 200, await playRecipe(b));
    }
    if (url.pathname === '/api/stop' && req.method === 'POST') { if (playing) playing.cancel = true; return json(res, 200, { ok: true }); }
    // ---- styles (reference folders) ----
    if (url.pathname === '/api/styles' && req.method === 'GET') return json(res, 200, style.listStyles());
    if (url.pathname === '/api/styles/analyze' && req.method === 'POST') { const { name } = await body(req); const r = await style.analyzeFolder(name); return json(res, 200, { style: r.style, analyzed: r.analyzed, failed: r.failed, looks: r.looks.map(l => ({ id: l.id, images: l.images.length, profile: l.profile })) }); }
    if (url.pathname === '/api/style/score' && req.method === 'POST') { const { name, settle } = await body(req); return json(res, 200, await scoreLive(name, settle ?? 2500)); }
    // ---- prompt box ----
    if (url.pathname === '/api/config' && req.method === 'GET') return json(res, 200, { ...agent.publicConfig(), ...(await agent.engineStatus()) });
    if (url.pathname === '/api/config' && req.method === 'POST') { const b = await body(req); const patch = {}; if (typeof b.apiKey === 'string') patch.apiKey = b.apiKey.trim(); if (typeof b.model === 'string' && b.model.trim()) patch.model = b.model.trim(); if (['auto', 'cli', 'api', 'offline'].includes(b.engine)) patch.engine = b.engine; agent.setConfig(patch); return json(res, 200, { ...agent.publicConfig(), ...(await agent.engineStatus()) }); }
    if (url.pathname === '/api/prompt' && req.method === 'POST') {
      if (promptJob && !promptJob.done) return json(res, 409, { error: 'still working on the last request' });
      const b = await body(req); const job = promptJob = { id: Date.now(), events: [], done: false };
      agent.run(job, { text: String(b.text || ''), images: Array.isArray(b.images) ? b.images.slice(0, 8) : [] }, actions).catch(() => {});
      return json(res, 200, { id: job.id });
    }
    if (url.pathname === '/api/prompt' && req.method === 'GET') {
      const since = +(url.searchParams.get('since') || 0); const j = promptJob;
      return json(res, 200, j ? { id: j.id, done: j.done, events: j.events.slice(since), next: j.events.length } : { id: null, done: true, events: [], next: 0 });
    }
    if (url.pathname === '/api/prompt/stop' && req.method === 'POST') { if (promptJob && promptJob.abort) promptJob.abort(); if (playing) playing.cancel = true; return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/prompt/reset' && req.method === 'POST') { agent.history.length = 0; return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/motions' && req.method === 'GET') { if (!base) base = await readPose(); return json(res, 200, Object.entries(presets(cur || base)).map(([id, r]) => ({ id, label: r.label, duration: r.duration }))); }
    if (url.pathname === '/api/style/match' && req.method === 'POST') { const b = await body(req); matchStyle(b.name, b).catch(() => {}); return json(res, 200, { started: true }); }
    if (url.pathname === '/api/style/match' && req.method === 'GET') return json(res, 200, matchJob);
    // ---- reference video + render ----
    if (url.pathname === '/api/video' && req.method === 'POST') { const b = await body(req); if (videoJob.running) return json(res, 409, { error: 'a video match is already running' }); matchVideo(b).catch(() => {}); return json(res, 200, { started: true }); }
    if (url.pathname === '/api/video' && req.method === 'GET') return json(res, 200, videoJob);
    if (url.pathname === '/api/video/stop' && req.method === 'POST') { videoJob.cancel = true; return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/render' && req.method === 'POST') { const b = await body(req); if (renderJob.running) return json(res, 409, { error: 'a render is already running' }); if (!heartbeat().alive) return json(res, 400, { error: NOT_CONNECTED }); renderRecipe(b).catch(() => {}); return json(res, 200, { started: true }); }
    if (url.pathname === '/api/render' && req.method === 'GET') return json(res, 200, renderJob);
    if (url.pathname === '/api/render/stop' && req.method === 'POST') { renderJob.cancel = true; return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/render/video' && req.method === 'GET') {
      const v = renderJob.result && renderJob.result.video; if (!v || !fs.existsSync(v)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': fs.statSync(v).size, 'Cache-Control': 'no-store' }); return fs.createReadStream(v).pipe(res);
    }
    // ---- studio lighting ----
    if (url.pathname === '/api/studio' && req.method === 'GET') {
      return json(res, 200, {
        studio,
        rigs: Object.entries(RIGS).map(([id, r]) => ({ id, label: r.label, blurb: r.blurb })),
        envRigs: Object.entries(ENV_RIGS).map(([id, r]) => ({ id, label: r.label })),
      });
    }
    if (url.pathname === '/api/rig' && req.method === 'POST') { const b = await body(req); return json(res, 200, await applyRig(b.name, b)); }
    if (url.pathname === '/api/light' && req.method === 'POST') {
      const b = await body(req); await ensureSubject();
      const { id, ...patch } = b; if (!id) return json(res, 400, { error: 'id required' });
      return json(res, 200, await editLight(id, patch));
    }
    if (url.pathname === '/api/light/remove' && req.method === 'POST') {
      const { id } = await body(req); await send('light_remove', { id }, 30000); delete studio.lights[id]; return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/exposure' && req.method === 'POST') {
      const { value } = await body(req); await ensureSubject(); await setExposure(+value);
      return json(res, 200, { exposure: studio.exposure });
    }
    if (url.pathname === '/api/autoexpose' && req.method === 'POST') { const b = await body(req); await ensureSubject(); return json(res, 200, await autoExpose(b)); }
    if (url.pathname === '/api/measure' && req.method === 'GET') { const m = await measure(+(url.searchParams.get('settle') ?? 1500)); return json(res, 200, m); }
    if (url.pathname === '/api/env' && req.method === 'POST') { const b = await body(req); studio.env = await send('env_set', b, 30000); return json(res, 200, studio.env); }
    if (url.pathname === '/api/studio/off' && req.method === 'POST') {
      const r = await send('studio_off', {}, 60000); studio.lights = {}; studio.rig = null; studio.env = null; return json(res, 200, r);
    }
    if (url.pathname === '/api/views' && req.method === 'GET') return json(res, 200, loadViews());
    if (url.pathname === '/api/views' && req.method === 'POST') {
      const { name } = await body(req); const v = loadViews(); v[name] = await readPose(); saveViews(v); return json(res, 200, v);
    }
    if (url.pathname === '/api/goto' && req.method === 'POST') {
      const { name } = await body(req); const p = loadViews()[name];
      if (!p) return json(res, 404, { error: 'no such view' });
      return json(res, 200, await applyPose(p));
    }
    // static files
    const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname.replace(/\.\./g, ''));
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      return res.end(fs.readFileSync(file));
    }
    res.writeHead(404); res.end('not found');
  } catch (e) { json(res, 500, { error: e.message }); }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`KeyShot control server: http://localhost:${PORT}`);
  for (const ip of lanIPs()) console.log(`  phone / other PC: http://${ip}:${PORT}`);
});
const tidyOpts = { send, alive: () => heartbeat().alive, busy: () => !!(playing || matchJob.running || videoJob.running || renderJob.running || (promptJob && !promptJob.done) || shotBusy) };
let tidyTimer = null;
function tidyLater() { clearTimeout(tidyTimer); tidyTimer = setTimeout(() => janitor.run(tidyOpts, 'job').catch(() => {}), 5000); }
janitor.start(tidyOpts);
captureLoop();
