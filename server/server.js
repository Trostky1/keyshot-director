// server.js - local web server: control UI (2nd monitor / phone) + API into KeyShot via the bridge.
// Run:  node server\server.js      then open http://localhost:8787  (phone: use the QR shown on the page)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { send, heartbeat, markStopped, BASE, SHOTS } = require('./bridge');
const { poseToEye, eyeToPose, sample, presets } = require('./shots');
const agent = require('./agent');
const { execFile } = require('child_process');
const { listenWithFallback } = require('./listen-with-fallback');
const { resizeJpeg } = require('./image-tools');
const textureSets = require('./material-textures');
const textureEdit = require('./texture-edit');
const { compileTexturePlan } = require('./material-core');
const { selectMaterialBuildInputs } = require('./material-build-input');
const { RIGS, ENV_RIGS, buildRig, toPos } = require('./rigs');
const lightingPlaybooks = require('./lighting-playbooks');
const { decode, productStats } = require('./png');
const style = require('./style');
const { runStyleSearch } = require('./style-search');
const { createLightingLab } = require('./lighting-lab');
const video = require('./video');
const janitor = require('./janitor');
const photo = require('./photo');
const { describeLight } = require('./light-spec');
const { createReceiptStore } = require('./job-receipt');
const { createReconstructor } = require('./reconstruction');
const crypto = require('crypto');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lightingLab = createLightingLab({ send, heartbeat, SHOTS });
const MATERIAL_PACKAGE_DIR = path.resolve(__dirname, '..', 'materials');
const packageEntryCache = new Map();

function normalizeMaterialGraphPreset(value) {
  return 'simple_plastic';
}

function kmpEntryNames(filePath, stat) {
  const cached = packageEntryCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.entries;
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const tailLength = Math.min(stat.size, 65557), tail = Buffer.alloc(tailLength);
    fs.readSync(fd, tail, 0, tailLength, stat.size - tailLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= Math.max(0, tail.length - 65557); i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return [];
    const count = tail.readUInt16LE(eocd + 10), directorySize = tail.readUInt32LE(eocd + 12), directoryOffset = tail.readUInt32LE(eocd + 16);
    if (count > 4096 || directorySize > 8 * 1024 * 1024 || directoryOffset + directorySize > stat.size) return [];
    const directory = Buffer.alloc(directorySize);
    fs.readSync(fd, directory, 0, directorySize, directoryOffset);
    const entries = [];
    for (let at = 0; at + 46 <= directory.length && entries.length < count;) {
      if (directory.readUInt32LE(at) !== 0x02014b50) break;
      const flags = directory.readUInt16LE(at + 8), nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30), commentLength = directory.readUInt16LE(at + 32);
      if (at + 46 + nameLength + extraLength + commentLength > directory.length) break;
      const bytes = directory.subarray(at + 46, at + 46 + nameLength);
      entries.push(bytes.toString(flags & 0x800 ? 'utf8' : 'latin1'));
      at += 46 + nameLength + extraLength + commentLength;
    }
    packageEntryCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, entries });
    return entries;
  } catch { return []; }
  finally { if (fd != null) fs.closeSync(fd); }
}

function matchPackageTextureSet(asset, sets) {
  const packedMaps = new Set(kmpEntryNames(asset.path, asset).map(entry => path.basename(entry).toLowerCase()));
  if (!packedMaps.size) return null;
  const matches = sets.map(set => ({ set, files: set.files.filter(file => packedMaps.has(path.basename(file.name).toLowerCase())) }))
    .filter(item => item.files.length >= 2)
    .sort((a, b) => b.files.length - a.files.length || Number(!!a.set.missing?.length) - Number(!!b.set.missing?.length) || b.set.imported.localeCompare(a.set.imported));
  const best = matches[0];
  if (!best || (matches[1] && matches[1].files.length === best.files.length && !best.set.missing?.length && !matches[1].set.missing?.length)) return null;
  return { id: best.set.id, name: best.set.name, files: best.files.map(file => ({ name: file.name, role: file.role })),
    missing: best.set.missing || [], materialx: best.set.materialx ? { values: best.set.materialx.values, connections: best.set.materialx.connections } : null };
}

function listMaterialPackages() {
  if (!fs.existsSync(MATERIAL_PACKAGE_DIR)) return [];
  const sets = textureSets.listTextureSets();
  return fs.readdirSync(MATERIAL_PACKAGE_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.kmp'))
    .map(entry => {
      const filePath = path.join(MATERIAL_PACKAGE_DIR, entry.name);
      const stat = fs.statSync(filePath);
      const asset = { name: entry.name, path: filePath, size: stat.size, modified: stat.mtime.toISOString(), mtimeMs: stat.mtimeMs };
      return { ...asset, source_texture_set: matchPackageTextureSet(asset, sets) };
    }).sort((a, b) => b.modified.localeCompare(a.modified));
}

function resolveMaterialContext(raw) {
  if (raw == null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid material selection. Choose it again from Material Lab.');
  const kind = String(raw.kind || '');
  const cleanName = value => {
    const name = String(value || '').trim();
    if (!name || name.length > 160 || /[\u0000-\u001f]/.test(name)) throw new Error('Invalid material name in the current selection.');
    return name;
  };
  if (kind === 'texture-set') {
    const set = textureSets.listTextureSets().find(item => item.id === String(raw.id || ''));
    if (!set) throw new Error('That texture set is no longer available. Refresh Material Lab and select it again.');
    return { kind, id: set.id, name: set.name, files: set.files.slice(0, 24).map(file => ({ name: file.name, role: file.role })),
      missing: set.missing || [], materialx: set.materialx ? { values: set.materialx.values, connections: set.materialx.connections } : null };
  }
  if (kind === 'material-package') {
    const file = path.basename(String(raw.file || ''));
    const asset = listMaterialPackages().find(item => item.name === file);
    if (!asset) throw new Error('That saved material package is no longer available. Refresh Material Lab and select it again.');
    return { kind, name: asset.name.replace(/\.kmp$/i, ''), file: asset.name, source_texture_set: asset.source_texture_set };
  }
  if (kind === 'scene-material' || kind === 'library-material') return { kind, name: cleanName(raw.name) };
  throw new Error('Unknown Material Lab selection. Choose it again from Material Lab.');
}

// ---- studio lighting state (what we believe is in KeyShot; the bridge keeps the real registry) ----
const studio = { rig: null, exposure: 1, frameAz: 0, mirror: false, subject: null, rigSubject: null, env: null, envBaseBrightness: null, envMultiplier: 1, lights: {}, target: null, envScales: false, lastAuto: null, powerMode: 'artistic' };
let stagingBusy = false;

// Measure the product's own brightness in the live viewport (see png.js productStats).
async function measure(settleMs = 2500, { subject = null, pose = null } = {}) {
  await sleep(Math.min(settleMs, 400));                       // (the capture is a render now; it converges on its own)
  const r = await send('screenshot', { name: 'measure', width: 640, secs: 1.5 }, 30000);
  const image = decode(fs.readFileSync(r.path));
  const region = subject && pose ? photo.projectBounds(subject, pose, image.w / image.h) : null;
  const stats = productStats(image, region || undefined);
  const scope = region ? (stats.fallback ? 'selected-bounds crop; product mask uncertain' : 'selected-part projected bounds')
    : subject ? 'whole-product fallback (selected crop unavailable)' : 'whole-product region';
  return { ...stats, measurement_scope: scope };
}
async function captureStyleMeasurement(previousRunId = null) {
  let record;
  if (previousRunId) record = await lightingLab.replay({ run_id: previousRunId });
  else {
    const scene_context = await send('scene_context', {}, 15000), subject = await ensureSubject(true), pose = await readPose();
    const size = scene_context.render?.image_size;
    const aspect = size?.[0] > 0 && size?.[1] > 0 ? size[0] / size[1] : 16 / 9;
    const dimensions = photo.captureDimensions(aspect);
    const measurement_target = photo.measurementTarget({ scene_context, subject }, pose, dimensions.width / dimensions.height);
    record = await lightingLab.run({ operation_id: 'lighting.capture_diagnostic_passes', inputs: {
      passes: ['clown', 'direct'], ...dimensions, secs: 2, render_engine: 'current', measurement_target
    } });
  }
  if (record.status !== 'verified_shape' || !record.output?.analysis?.available)
    throw new Error(record.error || 'Style measurements did not pass capture validation.');
  const files = record.output.files, beauty = files.find(file => file.pass === 'beauty'), clown = files.find(file => file.pass === 'clown');
  const features = style.features(decode(fs.readFileSync(beauty.path)), {
    mask: decode(fs.readFileSync(clown.path)), region: record.inputs.measurement_target?.region
  });
  return { features, run_id: record.id, comparison: record.output.analysis.comparison_to?.result || null };
}
// Style-folder reference regions remain inferred; live target pixels come from Clown plus bounds.
async function scoreLive(name, settleMs = 2500) {
  await sleep(settleMs);
  const { features: f } = await captureStyleMeasurement();
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
    const evalNow = async ({ previousRunId }) => {
      const measured = await captureStyleMeasurement(previousRunId), f = measured.features;
      if (!target) target = prof.looks.map(l => ({ l, s: style.score(f, l.profile).distance })).sort((a, b) => a.s - b.s)[0].l;
      return { ...style.score(f, target.profile), run_id: measured.run_id, comparison: measured.comparison };
    };
    let envMul = studio.envMultiplier ?? 1;
    const setEnv = async m => { envMul = m; await setEnvironmentMultiplier(m); };
    const params = [];
    if (studio.rig && !studio.rig.startsWith('hdri_')) {
      params.push({ id: 'env', get: () => envMul, set: v => setEnv(v), min: 0, max: 2, step: 1.5, seed: 0.1, mul: true });
      for (const id of Object.keys(studio.lights)) params.push({ id: id + '.gain', get: () => studio.lights[id].gain ?? 1, set: v => editLight(id, { gain: v }), min: 0.05, max: 5, step: 1.6, mul: true });
      const key = Object.keys(studio.lights).find(i => studio.lights[i].role === 'key');
      if (key) params.push({ id: key + '.az', get: () => studio.lights[key].az, set: v => editLight(key, { az: v }), min: -80, max: 80, step: 18, mul: false });
    }
    const result = await runStyleSearch({ params, measure: evalNow, rounds: Math.max(1, Math.min(3, Math.floor(rounds) || 1)), onLog: say });
    matchJob.result = { style: name, look: target.id, ...result,
      limitation: 'Reference-folder product regions are inferred; this score is an approximate style objective, not photographic similarity.' };
    say(`done: distance ${result.startDistance} -> ${result.finalDistance}; ${result.stopReason}`);
  } catch (e) { matchJob.result = { ...(e.searchResult || {}), error: e.message }; say('error: ' + e.message); }
  finally { matchJob.running = false; tidyLater(); }
}
async function setExposure(x) {
  studio.exposure = Math.max(0.05, Math.min(12, x));
  if (studio.envScales && Number.isFinite(studio.envBaseBrightness)) await applyEnvironmentMultiplier();
  for (const id of Object.keys(studio.lights)) await editLight(id, {});
}
async function applyEnvironmentMultiplier() {
  const base = Number.isFinite(studio.envBaseBrightness) ? studio.envBaseBrightness : 1;
  const exposure = studio.envScales ? studio.exposure : 1;
  const multiplier = Number.isFinite(studio.envMultiplier) ? studio.envMultiplier : 1;
  const brightness = Math.max(0.000001, Math.min(5, base * multiplier * exposure));
  studio.env = await send('env_set', { brightness: +brightness.toFixed(6) }, 30000);
  return studio.env;
}
async function setEnvironmentMultiplier(value) {
  if (!Number.isFinite(value) || value < 0 || value > 2) throw new Error('Environment fill must be between 0× and 2×.');
  if (!Number.isFinite(studio.envBaseBrightness)) {
    const current = await send('env_info', {}, 15000);
    studio.env = current;
    studio.envBaseBrightness = Math.max(0.000001, Number(current.brightness) || 1);
  }
  studio.envMultiplier = value;
  await applyEnvironmentMultiplier();
  return { multiplier: studio.envMultiplier, brightness: studio.env?.brightness, environment: studio.env };
}
// Closed loop: measure -> compare with the rig's target tone -> scale exposure -> repeat.
// Which statistic to meter: dark rigs meter the HIGHLIGHT level (p95) like a photographer would, because the median is
// dominated by shadowed glass/liquid that barely responds to light; white rigs meter the median.
async function autoExpose({ target, metric, iterations = 4 } = {}) {
  target = target ?? studio.target ?? 0.3; metric = metric ?? studio.metric ?? 'p50';
  const selectedSubject = studio.rigSubject;
  const measurementPose = selectedSubject ? await readPose().catch(() => null) : null;
  const steps = []; let prev = null;
  for (let i = 0; i < iterations; i++) {
    const m = await measure(2500, { subject: selectedSubject, pose: measurementPose });
    const v = m[metric];
    steps.push({ exposure: +studio.exposure.toFixed(3), p50: +m.p50.toFixed(3), p95: +m.p95.toFixed(3), clip: +(m.clipFrac * 100).toFixed(1), measurement_scope: m.measurement_scope });
    // guard: if the metric barely moved although exposure changed a lot, more exposure will not help - go back and stop
    if (prev && Math.abs(Math.log(studio.exposure / prev.exposure)) > Math.log(1.8) && Math.abs(Math.log(v / Math.max(0.01, prev.v))) < 0.12) {
      await setExposure(prev.exposure); steps.push({ note: 'flat response - reverted to exposure ' + prev.exposure.toFixed(2) }); break;
    }
    const ratio = target / Math.max(0.02, v);
    if (Math.abs(Math.log(ratio)) < 0.07 || i === iterations - 1) break;      // within ~7% or out of iterations
    prev = { exposure: studio.exposure, v };
    await setExposure(studio.exposure * Math.pow(Math.max(0.4, Math.min(2.5, ratio)), 1.7));
  }
  return (studio.lastAuto = { target, metric, exposure: +studio.exposure.toFixed(3), measurement_scope: steps.at(-1)?.measurement_scope || 'whole-product region', steps });
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
function selectedSubjectFromContext(context, product) {
  const selected = context?.target?.selection || [];
  if (selected.length !== 1) throw new Error('Select exactly one part in KeyShot before framing that selected part.');
  if (selected[0].hidden) throw new Error('The selected part is hidden in KeyShot, so it cannot be framed as a visible close-up.');
  const bounds = selected[0].bounds;
  if (!Array.isArray(bounds) || bounds.length !== 2 || !bounds.every(point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)))
    throw new Error('KeyShot did not provide usable bounds for the selected part.');
  const min = bounds[0].slice(0, 3), max = bounds[1].slice(0, 3);
  const size = min.map((value, axis) => max[axis] - value);
  const span = Math.max(...size);
  if (!(span > 0) || span > 5000 || !min.every(Number.isFinite) || !max.every(Number.isFinite))
    throw new Error('The selected part bounds are zero-sized or outside the supported scene range.');
  return { ...product, models: [selected[0].name || selected[0].path?.join(' / ') || 'Selected part'], min, max,
    size, span, center: min.map((value, axis) => (value + max[axis]) / 2) };
}
function lightSpecDetail(l, context = {}) {   // stage-frame light -> concrete bridge spec + the power model that produced it
  return describeLight(l, context, { subject: studio.rigSubject || studio.subject, frameAz: studio.frameAz, exposure: studio.exposure, powerMode: studio.powerMode });
}
const lightSpec = (l, context = {}) => lightSpecDetail(l, context).spec;
// Coalesce rapid edits to one light (slider drags): at most one bridge call in flight per light, latest values win.
const lightJobs = new Map();
function editLight(id, patch) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id || '')) return Promise.reject(new Error('Use a short light name with letters, numbers or underscores.'));
  if (Object.prototype.hasOwnProperty.call(patch, 'kelvin') && Object.prototype.hasOwnProperty.call(patch, 'rgb')) return Promise.reject(new Error('Choose either color temperature or RGB tint for this light, not both.'));
  const limits = { az: [-360,360], el: [-85,85], d: [0.2,20], w: [0.01,20], h: [0.01,20], gain: [0,30], kelvin: [1500,12000], roll: [-360,360], E: [0,0.02], radius: [0,10000], angle: [1,120], falloff: [0,1], multiplier: [0.001,1000000] };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'rgb' && (!Array.isArray(v) || v.length !== 3 || v.some(channel => !Number.isFinite(channel) || channel < 0 || channel > 1))) return Promise.reject(new Error('RGB tint must be three values from 0 to 1.'));
    if (k === 'type' && !['area','point','ies','spotlight'].includes(v)) return Promise.reject(new Error('Choose Area, Point, IES, or Spotlight.'));
    if (k === 'ies_asset_id' && (typeof v !== 'string' || !v.startsWith('Light/IES Light/') || v.includes('..'))) return Promise.reject(new Error('Choose an installed IES profile from the light catalog.'));
    if (k === 'axis' && (!Number.isInteger(v) || v < 0 || v > 5)) return Promise.reject(new Error('IES axis must be an integer from 0 to 5.'));
    if (limits[k] && (!Number.isFinite(v) || v < limits[k][0] || v > limits[k][1])) return Promise.reject(new Error('Invalid light ' + k));
    if (!limits[k] && !['rgb','refl','eye','shadows','role','type','constant_output','ies_asset_id','axis'].includes(k)) return Promise.reject(new Error('Unknown light setting: ' + k));
    if (['refl','eye','shadows','constant_output'].includes(k) && typeof v !== 'boolean') return Promise.reject(new Error('Expected a yes/no light setting: ' + k));
  }
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
          const existing = studio.lights[id];
          const l = { ...(existing || { id, role: 'custom', type: 'area', az: -40, el: 30, d: 3, w: 1.5, h: 1.5, E: 0.0008, kelvin: 5600, radius: 0, angle: 45, falloff: 0.5, constant_output: true, refl: true, eye: false, gain: 1 }), ...p, id };
          if (l.type === 'ies' && (!existing || (p.type === 'ies' && existing.type !== 'ies'))) {
            delete l.kelvin; delete l.rgb;
            if (Object.prototype.hasOwnProperty.call(p, 'kelvin')) l.kelvin = p.kelvin;
            if (Object.prototype.hasOwnProperty.call(p, 'rgb')) l.rgb = p.rgb.slice();
          }
          if (l.type === 'ies') {
            if (Object.prototype.hasOwnProperty.call(p, 'gain')) l.multiplier = l.gain;
            else if (Object.prototype.hasOwnProperty.call(p, 'multiplier')) l.gain = l.multiplier;
            else if (!Number.isFinite(l.multiplier)) l.multiplier = l.gain ?? 1;
          }
          if (Object.prototype.hasOwnProperty.call(p, 'kelvin') && !Object.prototype.hasOwnProperty.call(p, 'rgb')) delete l.rgb;
          if (Object.prototype.hasOwnProperty.call(p, 'rgb')) { delete l.kelvin; l.rgb = p.rgb.slice(); }
          const r = await send('light_set', lightSpec(l), 30000);
          if (l.type === 'ies') {
            if (Array.isArray(r.profile_native_color)) l.profile_rgb = r.profile_native_color.slice(0, 3);
            const cct = String(l.ies_asset_id || '').match(/(?<!\d)(\d{4})\s*K\b/i);
            if (cct) l.profile_kelvin_hint = Number(cct[1]);
          }
          studio.lights[id] = l;
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
      if (l[id].hidden) continue;
      const sp = l[id].spec || {};
      if (sp.pos && sp.size) {
        const v = [sp.pos[0] - s.center[0], sp.pos[1] - s.center[1], sp.pos[2] - s.center[2]], r = Math.hypot(...v) || 1;
        const type = sp.type || 'area', readback = l[id].readback || {};
        const cct = String(sp.ies_asset_id || '').match(/(?<!\d)(\d{4})\s*K\b/i);
        studio.lights[id] = { id, role: 'restored', type, az: Math.atan2(v[0], v[2]) * 180 / Math.PI, el: Math.asin(v[1] / r) * 180 / Math.PI, d: r / s.span, w: sp.size[0] / s.span, h: sp.size[1] / s.span,
          E: (sp.power || 100) / (r * r), ...(Number.isFinite(sp.kelvin) ? { kelvin: sp.kelvin } : type === 'ies' ? {} : { kelvin: 5600 }), radius: sp.radius || 0, angle: sp.angle || 45, falloff: sp.falloff ?? 0.5, constant_output: sp.constant_output !== false, ...(Number.isFinite(sp.multiplier) ? { multiplier: sp.multiplier } : {}), ies_asset_id: sp.ies_asset_id,
          ...(Array.isArray(sp.rgb) ? { rgb: sp.rgb.slice(0, 3) } : {}), ...(type === 'ies' && Array.isArray(l[id].profile_native_color || readback.color) ? { profile_rgb: (l[id].profile_native_color || readback.color).slice(0, 3) } : {}), ...(type === 'ies' && cct ? { profile_kelvin_hint: Number(cct[1]) } : {}),
          refl: sp.visible_refl !== false, eye: !!sp.visible_eye, gain: 1 };
      } else studio.lights[id] = { id, role: 'unknown', type: 'area', az: -40, el: 30, d: 3, w: 1.5, h: 1.5, E: 0.003, kelvin: 5600, radius: 0, angle: 45, falloff: 0.5, constant_output: true, refl: true, eye: false, gain: 1 };
    }
    studio.rig = studio.rig || 'restored';
  } catch { synced = false; }          // bridge not ready yet - try again on the next status check
}
async function clearLights() { await send('lights_clear', {}, 60000); studio.lights = {}; }
async function applyRig(name, opts = {}) {
  if (!RIGS[name] && !ENV_RIGS[name]) throw new Error('Unknown lighting rig.');
  const product = await ensureSubject(true);
  const subject = opts.useSelectedPart === true
    ? selectedSubjectFromContext(await send('scene_context', {}, 15000), product)
    : product;
  await clearLights();                    // validate the requested target before removing the old rig
  studio.rigSubject = opts.useSelectedPart === true ? subject : null;
  if (ENV_RIGS[name]) {
    studio.rig = name; studio.envBaseBrightness = 1; studio.envMultiplier = 1; studio.envScales = false;
    studio.env = await send('env_set', { hdri: ENV_RIGS[name].hdri, brightness: 1, ground_shadows: true }, 30000);
    return { rig: name, lights: [], env: studio.env };
  }
  studio.exposure = opts.exposure ?? 1;
  studio.powerMode = 'artistic';             // preset rigs are exposure-normalized by design
  studio.mirror = !!opts.mirror;
  studio.frameAz = opts.frameAz ?? (cur ? cur.az : (base ? base.az : 0));
  const rig = buildRig(name, subject, { frameAz: studio.frameAz, exposure: studio.exposure, mirror: studio.mirror });
  studio.rig = name; studio.target = rig.target; studio.metric = rig.metric; studio.envScales = rig.envScales;
  studio.envBaseBrightness = RIGS[name].env.brightness; studio.envMultiplier = 1;
  studio.env = await send('env_set', rig.env, 30000);
  const placed = [];
  for (const l of rig.lights) {
    studio.lights[l.id] = { id: l.id, role: l.role, az: l.az, el: l.el, d: l.d, w: l.w, h: l.h, E: l.E, kelvin: l.kelvin, ...(Array.isArray(l.rgb) ? { rgb: l.rgb.slice(0, 3) } : {}), refl: l.visible_refl, eye: l.visible_eye, gain: 1 };
    const r = await send('light_set', lightSpec(studio.lights[l.id], { subject }), 30000);
    placed.push({ id: l.id, placement_err_mm: r.placement_err_mm });
  }
  const out = { rig: name, label: rig.label, lights: placed, env: studio.env };
  if (opts.auto !== false) out.auto = await autoExpose({ iterations: opts.iterations ?? 3 });
  return out;
}

let PORT = +(process.env.PORT || 8787);
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
  if (!Array.isArray(p.pivot) || p.pivot.length !== 3 || !p.pivot.every(Number.isFinite) || ![p.az,p.el,p.dist,p.fov].every(Number.isFinite) || p.dist <= 0 || p.fov < 5 || p.fov > 120) throw new Error('Invalid camera pose.');
  const eye = poseToEye(p);
  const r = await send('set_view', { pivot: p.pivot, pos: eye, up: p.up || [0, 1, 0], fov: p.fov, noread: true });
  cur = { ...p }; return r;
}

let currentPhotoSnapshot = null;
// Identity of the open scene for recovery: the saved name plus the product bounds (Director's own lights are excluded from
// those bounds), so it stays stable while this job adds lights but changes when a different scene or product is open.
async function photoSceneIdentity(snapshot) {
  const subject = snapshot?.subject || await ensureSubject(true);
  const context = snapshot?.scene_context || await send('scene_context', {}, 15000).catch(() => null);
  const round = v => Array.isArray(v) ? v.map(x => Math.round(x * 100) / 100) : null;
  return crypto.createHash('sha256').update(JSON.stringify({ name: context?.scene?.display_name ?? null,
    models: [...(subject.models || [])].sort(), min: round(subject.min), max: round(subject.max) })).digest('hex').slice(0, 32);
}
async function sceneInventory() {
  const listed = await send('lights_list');
  return Object.keys(listed || {}).map(id => ({ kind: 'light', id, name: id }));
}
let lastLightingApply = null;   // subject, framing and light ids of the newest applied rig, for lightweight updates
const sharedSceneDeps = {
  async snapshot({ signal } = {}) {
    signal?.throwIfAborted();
    await syncFromKeyShot();
    const subject = await ensureSubject(true), camera = await readPose();
    let scene_context = null;
    try { scene_context = await send('scene_context', {}, 15000); } catch { /* Keep photo matching usable if optional context is unavailable. */ }
    const lights = await send('lights_list');
    signal?.throwIfAborted();
    const checkpoint = await send('camera_checkpoint', {}, 30000);
    currentPhotoSnapshot = { subject, camera, scene_context, checkpoint, environment: await send('env_info'), selectOnly: true, lights, createdIds: [], studio: JSON.parse(JSON.stringify(studio)) };
    return currentPhotoSnapshot;
  },
  async lightProfiles() {
    const r = await send('lighting_ies_assets', { limit: 40 }, 30000);
    return r.installed_files?.assets || [];
  },
  async lightingEvidence(previousRunId = null, { aspect = 16 / 9, snapshot, mask = null, signal } = {}) {
    signal?.throwIfAborted();
    const camera = await readPose();
    const dimensions = photo.captureDimensions(aspect);
    const measurement_target = photo.measurementTarget(snapshot, camera, dimensions.width / dimensions.height);
    signal?.throwIfAborted();
    const record = previousRunId
      ? await lightingLab.replay({ run_id: previousRunId })
      : await lightingLab.run({ operation_id: 'lighting.capture_diagnostic_passes', inputs: {
        passes: ['clown', 'direct', 'reflection', 'shadow'], ...dimensions, secs: 2,
        render_engine: 'current', measurement_target, ...(mask ? { mask } : {})
      } });
    signal?.throwIfAborted();
    if (record.status !== 'verified_shape') throw new Error(record.error || 'KeyShot diagnostic capture did not pass its state checks.');
    return record;
  },
  async restore(s) {
    // Original lights stay in the scene with their actual transforms/materials. Only this run's creations are removed.
    for (const id of s.createdIds) await send('light_remove', { id }, 30000);
    for (const [id, l] of Object.entries(s.lights)) await send('light_visibility', { ids: [id], visible: !l.hidden }, 30000);
    await send('env_restore', { snapshot: s.environment, select_only: !!s.selectOnly }, 30000);
    if (s.checkpoint) { await send('camera_restore', { name: s.checkpoint.name }, 30000); cur = await readPose(); }
    else await applyPose(s.camera);
    Object.assign(studio, s.studio);
  },
  async apply(plan, opts) {
    const check = () => opts.signal?.throwIfAborted();
    check();
    const subject = await ensureSubject(true), camera = await readPose();
    const lightFrame = photo.lightingFrame(subject, camera, plan.shot, opts.aspect, { frameCamera: !!opts.framing });
    const ids = plan.lights.map(l => 'photo_' + opts.id + '_' + l.id);
    const existing = await send('lights_list');
    check(); await send('light_visibility', { ids: Object.keys(existing).filter(id => !ids.includes(id)), visible: false }, 30000);
    studio.lights = {};
    Object.assign(studio, { rig: 'reference_photo', exposure: 1, frameAz: camera.az, mirror: false, subject, rigSubject: subject, envScales: false, envMultiplier: 1, powerMode: plan.power_mode || 'artistic' });
    const placedLights = [];
    const { background, ...environment } = plan.environment;
    studio.envBaseBrightness = Math.max(0.000001, Number(environment.brightness) || 1);
    opts.declareOwned?.({ kind: 'environment', id: 'CC_Photo_' + opts.id });
    check(); studio.env = await send('env_set', { ...environment, director_name: 'CC_Photo_' + opts.id, bg: background.map(v => Math.round(255 * Math.pow(v / 255, 2.2))) }, 30000);
    for (const [i, source] of plan.lights.entries()) {
      check();
      const l = { ...source, id: ids[i], radius: source.radius * subject.span * lightFrame.sourceScale };
      if (!currentPhotoSnapshot.createdIds.includes(l.id)) currentPhotoSnapshot.createdIds.push(l.id);
      const prior = existing[l.id];
      if (prior && (prior.spec?.type || 'area') !== l.type) await send('light_remove', { id: l.id }, 30000);
      const detail = lightSpecDetail(l, { subject, target: lightFrame.target, sourceScale: lightFrame.sourceScale, powerMode: plan.power_mode });
      opts.declareOwned?.({ kind: 'light', id: l.id });   // recorded before creation so an interrupted job still knows what it may have made
      check(); const placed = await send('light_set', detail.spec, 30000);
      check(); await send('light_visibility', { ids: [l.id], visible: true }, 30000); studio.lights[l.id] = l;
      placedLights.push({ id: l.id, type: l.type, created: placed?.created === true, material: placed?.material || null, power: detail.power,
        aim_mm: detail.spec.target, visible_refl: detail.spec.visible_refl, visible_eye: detail.spec.visible_eye, visible_shadows: detail.spec.visible_shadows });
    }
    check(); if (opts.framing) await applyPose(lightFrame.pose);
    lastLightingApply = { subject, lightFrame, ids };
    return { power_mode: studio.powerMode, lights: placedLights, lighting_frame: { aim_point_mm: lightFrame.target, source_scale: lightFrame.sourceScale,
      view_distance_mm: lightFrame.viewDistance, full_product_fit_distance_mm: lightFrame.fullProductDistance,
      camera_framed: !!opts.framing } };
  },
  async capture(file, aspect, secs, signal) {
    signal?.throwIfAborted();
    const { width, height } = photo.captureDimensions(aspect);
    await send('grab', { path: file, width, height, secs }, 120000);
    signal?.throwIfAborted();
    latestShot = fs.readFileSync(file); preview.last = Date.now();
  },
  refresh() { preview.wanted = true; },
};
const photoDirector = photo.createDirector({ ...sharedSceneDeps,
  receipts: createReceiptStore({ root: path.join(__dirname, '..', 'references', '_photos') }),
  sceneIdentity: photoSceneIdentity, inventory: sceneInventory,
  blockers: () => reconstructionReceipts.unresolved() });

// Single-view reconstruction (milestone 1). Shares the photo adapter's snapshot, apply, restore and capture; adds a lightweight
// per-evaluation update, baseline facts, camera access and an explicit native save. NOT yet exercised against live KeyShot.
const reconstructionRoot = path.join(__dirname, '..', 'references', '_reconstruct');
const reconstructionReceipts = createReceiptStore({ root: reconstructionRoot });
const photoReceiptsReader = createReceiptStore({ root: path.join(__dirname, '..', 'references', '_photos') });
const reconstructor = createReconstructor({ ...sharedSceneDeps, root: reconstructionRoot, receipts: reconstructionReceipts,
  blockers: () => photoReceiptsReader.unresolved(), sceneIdentity: photoSceneIdentity, inventory: sceneInventory,
  readPose, applyPose: async pose => { await applyPose(pose); },
  async baseline(snapshot) {
    const ctx = snapshot.scene_context || {};
    return { scene: ctx.scene || null, camera: ctx.camera || null, lights: Object.keys(snapshot.lights || {}).length, environment: snapshot.environment ? { name: snapshot.environment.name ?? null } : null,
      image_style: null, render_settings: null, note: 'Image style and render options have no reader in the bridge yet; they are recorded as unknown, not assumed.' };
  },
  async update(plan, opts) {   // after the first full apply, an evaluation only needs the lights re-set
    const ctx = lastLightingApply; if (!ctx) throw new Error('No applied lighting to update.');
    for (const [i, source] of plan.lights.entries()) {
      opts.signal?.throwIfAborted();
      const l = { ...source, id: ctx.ids[i], radius: source.radius * ctx.subject.span * ctx.lightFrame.sourceScale };
      await send('light_set', lightSpec(l, { subject: ctx.subject, target: ctx.lightFrame.target, sourceScale: ctx.lightFrame.sourceScale, powerMode: plan.power_mode }), 30000);
      studio.lights[l.id] = l;
    }
  },
  async saveScene(targets) { return send('scene_save', targets, 180000); },
});
function assertSceneAvailable(includePrompt = true) {
  if (!heartbeat().alive) throw Object.assign(new Error(NOT_CONNECTED), { status: 409 });
  if (stagingBusy || photoDirector.status().running || reconstructor.status().running || playing || matchJob.running || videoJob.running || renderJob.running || (includePrompt && promptJob && !promptJob.done))
    throw Object.assign(new Error('Another scene job is running. Stop it or wait before changing the scene.'), { status: 409 });
}
async function stagingOperation(op, input = {}) {
  assertSceneAvailable(false);
  stagingBusy = true;
  try { return await send(op, input, 60000); }
  finally { studio.subject = null; studio.subjectOK = null; stagingBusy = false; preview.wanted = true; }
}

// Preview: OFF by default and capped. Each capture is a small KeyShot render (the screenshot call that used to do this
// added a camera to the user's scene every time). Turn Live on in the page for a refresh every few seconds; one-off
// refreshes happen after actions. A session budget stops runaway captures.
const preview = { live: false, budget: 300, used: 0, minGapMs: 3000, last: 0, wanted: false };
let previewTimer = null;
async function grabPreview() {
  if (!heartbeat().alive || stagingBusy || shotBusy || renderJob.running || photoDirector.status().running || reconstructor.status().running || matchJob.running || videoJob.running || (promptJob && !promptJob.done) || preview.used >= preview.budget) return false;
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
    let sceneContext = null;
    if (heartbeat().alive) {
      try { sceneContext = await actions.scene_context(); }
      catch (error) { say('scene context unavailable; analysing the clip without it'); }
    }
    const a = await video.analyze(fr, duration, { log: say, sceneContext });
    const plan = a.plan; stopIf();
    say(`${a.engine === 'claude' ? 'AI' : 'offline'} plan: ${plan.summary}`);
    say(`lighting: ${plan.lighting.rig}${plan.lighting.mirror ? ' (mirrored)' : ''}${plan.lighting.notes ? ' - ' + plan.lighting.notes : ''}`);
    say('camera keys: ' + plan.keys.map(k => `${k.t.toFixed(1)}s az ${Math.round(k.azimuth)} el ${Math.round(k.elevation)} fill ${k.fill.toFixed(2)}${k.cut ? ' CUT' : ''}`).join(' | '));
    const out = { plan, engine: a.engine, aspect: a.aspect, duration, scene_context: sceneContext, recipe: null };
    if (!heartbeat().alive) { say('KeyShot is not connected - plan only. Connect KeyShot and run it again to build it.'); videoJob.result = out; return; }
    if (!base) base = await readPose();
    const front = { ...(cur || base) };                       // the user's current view = the video's opening view
    if (lighting) {
      const videoStyle = video.saveAsStyle(fr, '_video');
      const prof = await style.analyzeFolder(videoStyle);
      say(`look profile from ${prof.analyzed} frames; building rig ${plan.lighting.rig}`);
      await applyRig(plan.lighting.rig, { mirror: plan.lighting.mirror, iterations: 3 }); stopIf();
      say('tuning the rig toward the video (this is the slow part)');
      await matchStyle(videoStyle, { rounds });
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
let materialPromptJob = null;
const run = (file, args) => new Promise((res, rej) => execFile(file, args, { windowsHide: true, maxBuffer: 1 << 26 }, (e, so, se) => e ? rej(new Error(se || e.message)) : res(so)));
const R2 = n => (typeof n === 'number' ? +n.toFixed(2) : n);
const camState = () => { const p = cur || base; return p ? { azimuth: R2(p.az), elevation: R2(p.el), distance_mm: R2(p.dist), fov: R2(p.fov) } : null; };
const lightView = l => ({ id: l.id, role: l.role, type: l.type || 'area', azimuth: R2(l.az), elevation: R2(l.el), distance: R2(l.d), width: R2(l.w), height: R2(l.h), brightness: R2(l.gain ?? 1), ...(Number.isFinite(l.kelvin) ? { kelvin: Math.round(l.kelvin) } : {}), radius: R2(l.radius || 0), angle: R2(l.angle ?? 45), falloff: R2(l.falloff ?? 0.5), constant_output: l.constant_output !== false, multiplier: R2(l.multiplier ?? 1), ies_asset_id: l.ies_asset_id || null, ...(Array.isArray(l.rgb) ? { rgb: l.rgb.slice(0, 3) } : {}), ...(Array.isArray(l.profile_rgb) ? { profile_rgb: l.profile_rgb.slice(0, 3) } : {}), ...(Number.isFinite(l.profile_kelvin_hint) ? { profile_kelvin_hint: l.profile_kelvin_hint } : {}) });

const NOT_CONNECTED = 'KeyShot is not connected. In KeyShot, run Scripts > KeyShot Director, wait for "KeyShot connected" at the top of this page, then try again.';
const needsBridge = fn => async (...a) => { if (!heartbeat().alive) throw new Error(NOT_CONNECTED); return fn(...a); };   // fail in 1 ms, not after a 60 s timeout

const actions = {
  setAttachments(a) { attachments = a || []; },
  async scene_context() { return send('scene_context', {}, 15000); },
  async scene_objects(input = {}) { return send('scene_objects', input, 30000); },
  async move_object(input) {
    const result = await stagingOperation('stage_transform', input);
    return { summary: 'Object assembly transformed; staging undo available', ...result };
  },
  async duplicate_object(input) {
    const result = await stagingOperation('stage_duplicate', input);
    return { summary: 'Product copies created; staging undo available', ...result };
  },
  async create_set_piece(input) {
    const result = await stagingOperation('stage_set', input);
    return { summary: 'Physical set geometry created; staging undo available', ...result };
  },
  async undo_staging() {
    const result = await stagingOperation('stage_undo');
    return { summary: 'Last staging operation restored', ...result };
  },
  async match_photo({ brief, match_framing, quality }) {
    assertSceneAvailable(false);
    await photoDirector.start({ image: attachments[0], brief, framing: !!match_framing, quality });
    const r = await photoDirector.wait();
    if (r.error) throw new Error(r.error);
    return { summary: r.result.title, ...r.result };
  },
  async frame_product({ kind, focus, fill, fov, aspect, use_selected_part }) {
    const product = await ensureSubject(true), pose = await readPose();
    const selectedTarget = use_selected_part === true;
    const subject = selectedTarget ? selectedSubjectFromContext(await actions.scene_context(), product) : product;
    const framing = photo.frame(subject, pose, { kind, focus: selectedTarget && focus == null ? [0, 0, 0] : focus, fill, fov }, aspect);
    await applyPose(framing);
    return { summary: selectedTarget ? `Close-up framed around ${subject.models[0]}` : 'Product framing updated', camera: camState(),
      ...(selectedTarget ? { target_part: subject.models[0], target_bounds: { min: subject.min, max: subject.max } } : {}) };
  },
  async set_environment({ brightness, rotation, background, ground_shadows, ground_reflections }) {
    const p = {};
    if (brightness != null) { if (!Number.isFinite(brightness) || brightness < 0 || brightness > 5) throw new Error('Environment brightness must be 0–5.'); p.brightness = brightness; }
    if (rotation != null) { if (!Number.isFinite(rotation)) throw new Error('Invalid environment rotation.'); p.rotation = rotation; }
    if (background != null) { if (!Array.isArray(background) || background.length !== 3 || !background.every(v => Number.isFinite(v) && v >= 0 && v <= 255)) throw new Error('Background needs RGB values 0–255.'); p.bg = background.map(v => Math.round(255 * Math.pow(v / 255, 2.2))); }
    if (typeof ground_shadows === 'boolean') p.ground_shadows = ground_shadows;
    if (typeof ground_reflections === 'boolean') p.ground_reflections = ground_reflections;
    studio.env = await send('env_set', p, 30000);
    if (brightness != null) {
      // This action requests an absolute native brightness, so make it the new rig baseline.
      studio.envMultiplier = 1;
      const exposure = studio.envScales ? studio.exposure : 1;
      studio.envBaseBrightness = Math.max(0.000001, brightness / Math.max(0.000001, exposure));
    }
    return { summary: 'Environment updated', environment: studio.env };
  },
  async get_state() {
    if (!base) base = await readPose();
    const sub = studio.subject || await ensureSubject().catch(() => null);
    return { summary: `rig ${studio.rig || 'none'}, ${Object.keys(studio.lights).length} lights`, rig: studio.rig, exposure: R2(studio.exposure), lights: Object.values(studio.lights).map(lightView),
      camera: camState(), product_size_mm: sub ? sub.size.map(R2) : null, environment_brightness_multiplier: R2(studio.envMultiplier), styles: style.listStyles().filter(s => !s.name.startsWith('_')).map(s => ({ name: s.name, images: s.images, analyzed: s.analyzed, looks: s.looks })), bridge_alive: heartbeat().alive };
  },
  async look() {
    await sleep(1800);
    const r = await send('screenshot', { name: 'look', width: 960, secs: 3 }, 30000);
    const jpg = path.join(BASE, 'shots', 'look_small.jpg');
    await resizeJpeg(r.path, jpg, 900);
    const m = productStats(decode(fs.readFileSync(r.path))), b64 = fs.readFileSync(jpg).toString('base64');
    return { summary: 'viewport captured', imageBase64: b64, imageDataUrl: 'data:image/jpeg;base64,' + b64,
      product_brightness: { median: R2(m.p50), highlights: R2(m.p95), clipped_pct: R2(m.clipFrac * 100) }, backdrop_brightness: R2(m.bg) };
  },
  async apply_rig({ name, mirror, auto_exposure, use_selected_part }) {
    if (!RIGS[name]) throw new Error('unknown rig ' + name);
    const r = await applyRig(name, { mirror: !!mirror, auto: auto_exposure !== false, useSelectedPart: use_selected_part === true });
    const targetLabel = use_selected_part === true ? ` on ${studio.rigSubject.models[0]}` : '';
    return { summary: `${RIGS[name].label}${targetLabel}: ${r.lights.length} lights` + (r.auto ? `, exposure ${r.auto.exposure}` : ''), rig: name, lights: Object.values(studio.lights).map(lightView), exposure: studio.exposure,
      ...(r.auto ? { auto_exposure: r.auto } : {}),
      ...(use_selected_part === true ? { target_part: studio.rigSubject.models[0], target_bounds: { min: studio.rigSubject.min, max: studio.rigSubject.max } } : {}) };
  },
  async set_light({ id, type, azimuth, elevation, distance, width, height, brightness, kelvin, rgb, in_reflections, visible_to_camera, in_shadows, radius, angle, falloff, constant_output, multiplier, ies_asset_id, axis }) {
    await ensureSubject();
    const p = {}; if (type != null) p.type = type; if (azimuth != null) p.az = azimuth; if (elevation != null) p.el = elevation; if (distance != null) p.d = distance; if (width != null) p.w = width; if (height != null) p.h = height;
    if (brightness != null) p.gain = brightness; if (kelvin != null) p.kelvin = kelvin; if (rgb != null) p.rgb = rgb; if (in_reflections != null) p.refl = in_reflections;
    if (visible_to_camera != null) p.eye = visible_to_camera; if (in_shadows != null) p.shadows = in_shadows;
    if (radius != null) p.radius = radius; if (angle != null) p.angle = angle; if (falloff != null) p.falloff = falloff;
    if (constant_output != null) p.constant_output = constant_output; if (multiplier != null) p.multiplier = multiplier;
    if (ies_asset_id != null) p.ies_asset_id = ies_asset_id; if (axis != null) p.axis = axis;
    if (!studio.lights[id] && !studio.rig) studio.rig = 'custom';
    const r = await editLight(id, p);
    return { summary: `light ${id} updated`, light: lightView(r.light) };
  },
  async set_light_brightness({ light, brightness, relative_percent }) {
    const selector = String(light || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!selector) throw new Error('Name the existing light ID or role, such as key or fill.');
    if (brightness != null && relative_percent != null) throw new Error('Provide either an absolute brightness or a relative percentage change, not both.');
    if (relative_percent != null && (!Number.isFinite(relative_percent) || relative_percent < -100 || relative_percent > 500)) throw new Error('Relative light brightness change must be between -100% and +500%.');
    const tracked = Object.values(studio.lights);
    const exactId = tracked.filter(item => String(item.id).toLowerCase().replace(/[\s-]+/g, '_') === selector);
    const matches = exactId.length ? exactId : tracked.filter(item => String(item.role || '').toLowerCase().replace(/[\s-]+/g, '_') === selector);
    if (!matches.length) throw new Error(`No Director light matches “${light}”. Check the current light IDs in Studio.`);
    if (matches.length > 1) throw new Error(`“${light}” matches multiple lights (${matches.map(item => item.id).join(', ')}). Name one exact light ID.`);
    if (relative_percent != null && ['restored', 'unknown'].includes(String(matches[0].role || '').toLowerCase())) throw new Error('This restored light has no known current brightness multiplier. Set an absolute value, such as 0.8×.');
    const target = relative_percent != null
      ? Math.max(0.05, Math.min(4, Number(matches[0].gain ?? 1) * (1 + relative_percent / 100)))
      : brightness;
    if (!Number.isFinite(target) || target < 0.05 || target > 4) throw new Error('Light brightness must be between 0.05× and 4×.');
    return actions.set_light({ id: matches[0].id, brightness: target });
  },
  async list_light_profiles() {
    const r = await send('lighting_ies_assets', { limit: 40 }, 30000);
    const assets = r.installed_files?.assets || [];
    const withPhotometry = assets.filter(asset => asset.profile_exists && asset.photometry?.status === 'parsed').length;
    return { summary: `${assets.filter(asset => asset.profile_exists).length} installed IES profiles are available; ${withPhotometry} include parsed lumen and distribution data.`, assets };
  },
  async list_materials() { const r = await send('materials_list', {}, 15000); return { summary: `${r.materials.length} scene and Director materials${r.editable_target ? `; authorized edit target: ${r.editable_target}` : ''}`, ...r }; },
  async list_material_library({ query = '' } = {}) { return send('material_library', { query }, 30000); },
  async list_texture_sets() {
    const sets = textureSets.listTextureSets({ includeMetadata: true });
    return { summary: `${sets.length} imported texture set${sets.length === 1 ? '' : 's'}`,
      sets: sets.map(set => ({ id: set.id, name: set.name, files: set.files.map(file => ({ name: file.name, role: file.role,
        metadata: file.metadata || null,
        expected_color_space: /^Poliigon_/i.test(file.name) ? (file.role === 'base-color' ? 'sRGB' : ['displacement','roughness','metallic','normal','bump','ambient-occlusion'].includes(file.role) ? 'Raw / linear data' : null) : null
      })), missing: set.missing || [] })) };
  },
  async edit_texture_map({ texture_set_id, filename, operation, amount }) {
    const set = textureSets.listTextureSets().find(item => item.id === String(texture_set_id || ''));
    const sourceFile = set?.files.find(file => file.name === filename);
    if (!set || !sourceFile) throw new Error('Choose a texture from an imported set.');
    if (operation === 'invert' && sourceFile.role !== 'glossiness') throw new Error('Only a confirmed glossiness map may be inverted; never invert a normal map.');
    if (operation === 'contrast' && !['roughness','glossiness','bump','displacement'].includes(sourceFile.role)) throw new Error('Contrast edits are limited to grayscale roughness, glossiness, bump or height/displacement maps.');
    if (['horizontal-grain','vertical-grain'].includes(operation) && !['roughness','glossiness','bump','displacement'].includes(sourceFile.role)) throw new Error('Directional smoothing is limited to grayscale scalar maps, not color or normal maps.');
    const sourcePath = path.resolve(set.path, filename);
    if (!sourcePath.startsWith(path.resolve(set.path) + path.sep)) throw new Error('Invalid texture location.');
    const edited = textureEdit.editTexture({ sourcePath, outputDir: set.path, operation, amount });
    let imported;
    try { imported = textureSets.addTextureFile(set.id, path.basename(edited.path), fs.readFileSync(edited.path)); }
    finally { try { fs.unlinkSync(edited.path); } catch { /* source and registered set files remain intact */ } }
    return { summary: `Created ${imported.name} as a derived map; the original ${filename} is unchanged. You can now wire it as the ${imported.role} channel.`,
      ...edited, path: path.join(set.path, imported.name), name: imported.name, role: imported.role };
  },
  async build_material_from_texture_set({ texture_set_id, name, graph_preset, use_ao = true,
    use_displacement = false, geometry_template, selected_files, tile_size_mm = 41 }) {
    assertSceneAvailable(false);
    const set = textureSets.listTextureSets().find(item => item.id === String(texture_set_id || ''));
    if (!set) throw new Error('That texture set is no longer available. Refresh Material Lab and try again.');
    graph_preset = normalizeMaterialGraphPreset(graph_preset);
    const supportedRoles = new Set(['base-color', 'roughness', 'normal', 'bump']);
    const hasUsableMap = set.files.some(file => supportedRoles.has(file.role));
    if (!hasUsableMap)
      throw new Error('Add a Base Color, Roughness, Normal, or Bump map to build a material.');
    const scene = await send('materials_list', {}, 15000);
    const existing = new Set(scene.materials || []);
    const rawBase = String(name || `Director ${set.name}`).trim();
    let baseName = rawBase.startsWith('Director ') ? rawBase : `Director ${rawBase}`;
    baseName = baseName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 80).trim();
    if (baseName.length < 12) throw new Error('Give this material a longer name (12 characters minimum).');
    let materialName = baseName, suffix = 2;
    while (existing.has(materialName)) {
      const ending = ` (${suffix++})`;
      materialName = baseName.slice(0, 80 - ending.length).trimEnd() + ending;
    }
    if (use_displacement || geometry_template) throw new Error('Geometry displacement is paused for reliability. Remove that option and build the supported Plastic maps.');
    const { recipeFiles } = selectMaterialBuildInputs(set.files, { selected_files, use_ao, tile_size_mm });
    const plan = await compileTexturePlan({ name: materialName,
      files: recipeFiles.map(file => ({ name: file.name, role: file.role })) });
    const filesByName = new Map(set.files.map(file => [file.name, file]));
    const selected = plan.maps.map(map => {
      const file = filesByName.get(map.path);
      if (!file) throw new Error(`Material recipe referenced a missing texture: ${map.path}`);
      return { role: map.role, path: path.join(set.path, file.name), filename: file.name, metadata: file.metadata || null };
    });
    let wiring;
    try {
      await send('material_create', { name: materialName }, 20000);
      wiring = await send('material_texture_apply', { name: materialName, model: 'Plastic',
        tile_size_mm, maps: selected.map(({ role, path: filePath }) => ({ role, path: filePath })) }, 30000);
    } catch (error) {
      try { await send('material_discard', { name: materialName }, 15000); } catch { /* preserve the material if KeyShot says it is no longer safe to discard */ }
      throw new Error(`KeyShot could not build this texture set: ${error.message}`);
    }
    let saved;
    try { saved = await send('material_save', { name: materialName }, 60000); }
    catch (error) {
      try { await send('material_discard', { name: materialName }, 15000); } catch { /* keep the scene material if KeyShot cannot safely discard it */ }
      throw new Error(`KeyShot could not save the material package: ${error.message}`);
    }
    const wiredRoles = new Set(wiring.maps.map(map => map.role));
    const usedFiles = selected.filter(({ role }) => wiredRoles.has(role)).map(({ role, filename, metadata }) => ({ role, name: filename, metadata }));
    const usedNames = new Set(usedFiles.map(file => file.name));
    const skipped = [...set.files.filter(file => !usedNames.has(file.name)).map(file => ({ name: file.name, role: file.role,
      reason: file.role === 'metallic' ? 'Metallic layering is paused' :
        file.role === 'ambient-occlusion' && !use_ao ? 'AO blend not enabled' :
        file.role === 'displacement' ? 'Geometry displacement is paused' :
        plan.skipped.find(item => item.name === file.name)?.reason ||
        (supportedRoles.has(file.role) || file.role === 'ambient-occlusion' ? 'Not selected for this build' : 'No supported connection') })),
      ...(set.missing || []).map(name => ({ name, role: null, reason: 'Source file is missing; the material was built from available maps.' }))];
    const channels = wiring.maps.map(map => map.role).join(', ');
    const manualGraphSteps = [
      'Open the saved material in KeyShot Material Graph and confirm the built connections.',
      'Check the texture mapping scale and placement on the intended model.'
    ];
    const graphPresetName = 'Simple Plastic';
    const receipt = { version: 1, built_at: new Date().toISOString(), texture_set_id: set.id,
      material_name: materialName, model: 'Plastic', tile_size_mm: wiring.tile_size_mm,
      used_files: usedFiles, skipped_files: skipped, missing_files: set.missing || [],
      graph: wiring, package_path: saved.path, library: saved.library, assignment: 'unassigned' };
    let receiptPath = null;
    try {
      const receiptDir = path.join(MATERIAL_PACKAGE_DIR, 'build-receipts');
      fs.mkdirSync(receiptDir, { recursive: true });
      receiptPath = path.join(receiptDir, `${set.id}-${Date.now()}-${require('crypto').randomBytes(3).toString('hex')}.json`);
      fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { flag: 'wx' });
    } catch (error) { console.warn('Material built, but its receipt could not be saved:', error.message); }
    return { summary: `${materialName} built as an unassigned ${wiring.model || plan.material.model} material using the ${graphPresetName} preset from ${channels}; saved to the KeyShot library and as a portable KMP.`,
      name: materialName, path: saved.path, library: saved.library, material: wiring, used_files: usedFiles, skipped_files: skipped,
      tile_size_mm: wiring.tile_size_mm, receipt: receiptPath,
      graph_preset,
      manual_graph_steps: manualGraphSteps,
      recipe: plan,
      assignment: 'Not applied to any product part. Drag it from KeyShot’s Material Library onto the chosen part.' };
  },
  async execute_material_geometry({ name }) {
    throw new Error('Geometry displacement is paused for reliability.');
  },
  async inspect_material({ name }) { return await send('material_inspect', { name }, 15000); },
  async create_material({ name }) { const r = await send('material_create', { name }, 15000); return { summary: `${name} created but not applied to the product`, ...r }; },
  async copy_material({ source, object_id, name }) { const r = await send('material_copy', { source, object_id, name }, 30000); return { summary: `Independent copy ${r.name} created on the selected part; source ${source} is unchanged`, ...r }; },
  async material_library_copy({ source, object_id, name }) { const r = await send('material_library_copy', { source, object_id, name }, 30000); return { summary: `Independent copy ${r.name} created on the selected part; library source ${source} is unchanged`, ...r }; },
  async set_material_bump({ name, path, role, strength }) { const r = await send('material_bump_set', { name, path, role, strength }, 30000); return { summary: `${name} bump settings updated; original source material is unchanged`, ...r }; },
  async set_material_value({ name, node_id, parameter, value, expected_value }) { const r = await send('material_set', { name, node_id, parameter, value, ...(expected_value !== undefined ? { expected_value } : {}) }, 15000); return { summary: `${name}: ${parameter} updated`, ...r }; },
  async undo_material() { const r = await send('material_undo', {}, 15000); return { summary: `${r.parameter} restored`, ...r }; },
  async save_material({ name }) { const r = await send('material_save', { name }, 30000); return { summary: `Portable material package saved: ${r.path}`, ...r }; },
  async remove_light({ id }) { await send('light_remove', { id }, 30000); delete studio.lights[id]; return { summary: `removed ${id}` }; },
  async set_exposure({ value, relative_stops }) {
    await ensureSubject();
    if (value != null && relative_stops != null) throw new Error('Provide either an absolute exposure value or a relative stop change, not both.');
    if (relative_stops != null && (!Number.isFinite(relative_stops) || relative_stops < -8 || relative_stops > 8)) throw new Error('Relative exposure change must be between -8 and +8 stops.');
    if (relative_stops == null && !Number.isFinite(value)) throw new Error('Exposure must be a finite multiplier.');
    const target = relative_stops != null ? studio.exposure * Math.pow(2, relative_stops) : +value;
    await setExposure(target);
    return { summary: `exposure ${R2(studio.exposure)}x`, exposure: studio.exposure };
  },
  async set_environment_brightness({ multiplier, relative_percent }) {
    if (multiplier != null && relative_percent != null) throw new Error('Provide either an absolute multiplier or a relative percentage change, not both.');
    if (relative_percent != null && (!Number.isFinite(relative_percent) || relative_percent < -100 || relative_percent > 500)) throw new Error('Relative environment brightness change must be between -100% and +500%.');
    const current = Number.isFinite(studio.envMultiplier) ? studio.envMultiplier : 1;
    const target = relative_percent != null ? Math.max(0, Math.min(2, current * (1 + relative_percent / 100))) : +multiplier;
    const result = await setEnvironmentMultiplier(target);
    return { summary: `environment fill ${Number(result.multiplier).toFixed(2)}×`, ...result };
  },
  async auto_expose() { await ensureSubject(); const a = await autoExpose({}); return { summary: `exposure ${a.exposure}`, ...a }; },
  async studio_off() { const r = await send('studio_off', {}, 60000); studio.lights = {}; studio.rig = null; studio.rigSubject = null; studio.env = null; studio.envBaseBrightness = null; studio.envMultiplier = 1; studio.envScales = false; return { summary: 'lights removed, original environment restored', ...r }; },
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
    fs.mkdirSync(style.ROOT, { recursive: true });
    const dir = fs.mkdtempSync(path.join(style.ROOT, '_prompt_')), name = path.basename(dir);
    attachments.forEach((d, i) => { const m = /^data:image\/([a-z0-9+.-]+);base64,(.+)$/i.exec(d); if (m) fs.writeFileSync(path.join(dir, `ref_${i + 1}.${m[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg')}`), Buffer.from(m[2], 'base64')); });
    return { ...(await actions.analyze_style({ name })), name };
  },
  async match_style({ name, look }) {
    if (!studio.rig) throw new Error('build a rig first (apply_rig), then match it');
    await matchStyle(name, { look, rounds: 3 });
    const r = matchJob.result; if (!r || r.error) throw new Error((r && r.error) || 'match failed');
    return { summary: `style distance ${r.startDistance} -> ${r.finalDistance}`, ...r, deltas: undefined };
  },
};

for (const k of ['scene_context', 'scene_objects', 'move_object', 'duplicate_object', 'create_set_piece', 'undo_staging', 'look', 'frame_product', 'apply_rig', 'set_light', 'set_light_brightness', 'list_light_profiles', 'remove_light', 'set_exposure', 'set_environment_brightness', 'auto_expose', 'studio_off', 'set_camera', 'play_motion', 'match_style']) actions[k] = needsBridge(actions[k]);
{ const gs = actions.get_state; actions.get_state = async () => (heartbeat().alive ? gs() : { summary: 'KeyShot is not connected', bridge_alive: false, styles: style.listStyles().filter(s => !s.name.startsWith('_')).map(s => ({ name: s.name, images: s.images, analyzed: s.analyzed })) }); }

let promptJob = null;
const body = req => new Promise((res, reject) => {
  const chunks = []; let size = 0, tooLarge = false;
  req.on('data', c => { size += c.length; if (size > 16 * 1024 * 1024) { tooLarge = true; chunks.length = 0; } else if (!tooLarge) chunks.push(c); });
  req.on('error', reject); req.on('aborted', () => reject(new Error('Upload interrupted.')));
  req.on('end', () => { if (tooLarge) return reject(Object.assign(new Error('Upload exceeds 16 MB.'), { status: 413 }));
    try { const b = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error(); res(b); }
    catch { reject(Object.assign(new Error('Invalid request JSON.'), { status: 400 })); } });
});
const rawBody = (req, limit) => new Promise((resolve, reject) => {
  const chunks = []; let size = 0, tooLarge = false;
  req.on('data', chunk => { size += chunk.length; if (size > limit) { tooLarge = true; chunks.length = 0; } else if (!tooLarge) chunks.push(chunk); });
  req.on('error', reject); req.on('aborted', () => reject(new Error('Upload interrupted.')));
  req.on('end', () => tooLarge ? reject(Object.assign(new Error(`Texture file exceeds the ${(limit / 1048576).toFixed(0)} MB per-file limit.`), { status: 413 })) : resolve(Buffer.concat(chunks)));
});
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname !== '/api/preview') janitor.touch();
  // anything that can change the picture schedules ONE refresh shortly after the last change (debounced), so the page's
  // preview follows your edits without constant rendering
  if (req.method === 'POST' && !/^\/api\/(preview|quit|tidy|config|bridge|lighting-lab|video\/stop|render\/stop|stop|prompt\/stop|prompt\/reset|styles)/.test(url.pathname)) {
    clearTimeout(previewTimer); previewTimer = setTimeout(() => { preview.wanted = true; }, 1500);
  }
  try {
    if (req.method === 'POST' && req.headers.origin) {
      let origin; try { origin = new URL(req.headers.origin); } catch { throw Object.assign(new Error('Invalid request origin.'), { status: 403 }); }
      if (origin.host !== req.headers.host) throw Object.assign(new Error('Cross-site scene commands are blocked.'), { status: 403 });
    }
    if (req.method === 'POST' && /^\/api\/(pose|rebase|play|rig|light|exposure|autoexpose|env|studio\/off|style\/match|video$|render$|prompt$|views\/goto)/.test(url.pathname)) assertSceneAvailable();
    if (url.pathname === '/api/lighting-lab' && req.method === 'GET') return json(res, 200, { ...lightingLab.catalog(), bridge: heartbeat() });
    if (url.pathname === '/api/lighting-lab/runs' && req.method === 'GET') return json(res, 200, { runs: lightingLab.listRuns() });
    if (url.pathname === '/api/lighting-lab/run' && req.method === 'POST') {
      assertSceneAvailable();
      const b = await body(req);
      return json(res, 201, await lightingLab.run({ operation_id: b.operation_id, inputs: b.inputs }));
    }
    if (url.pathname === '/api/lighting-lab/replay' && req.method === 'POST') {
      assertSceneAvailable();
      const b = await body(req);
      return json(res, 201, await lightingLab.replay({ run_id: b.run_id, inputs: b.inputs }));
    }
    if (url.pathname === '/api/lighting-lab/file' && req.method === 'GET') {
      const file = lightingLab.outputFile(url.searchParams.get('run_id'), url.searchParams.get('name'));
      const contentType = file.extension === '.png' ? 'image/png' : file.extension === '.jpg' || file.extension === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': file.bytes,
        'Content-Disposition': contentType.startsWith('image/') ? 'inline' : 'attachment', 'Cache-Control': 'no-store' });
      return fs.createReadStream(file.path).pipe(res);
    }
    const lightingRun = /^\/api\/lighting-lab\/runs\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (lightingRun && req.method === 'GET') return json(res, 200, lightingLab.getRun(lightingRun[1]));
    if (url.pathname === '/api/photo' && req.method === 'GET') return json(res, 200, photoDirector.status());
    if (url.pathname === '/api/photo' && req.method === 'POST') { const b = await body(req); assertSceneAvailable(); return json(res, 202, await photoDirector.start(b)); }
    if (url.pathname === '/api/reconstruct' && req.method === 'GET') return json(res, 200, reconstructor.status());
    if (url.pathname === '/api/reconstruct' && req.method === 'POST') { const b = await body(req); assertSceneAvailable(); return json(res, 202, await reconstructor.start(b)); }
    if (url.pathname === '/api/reconstruct/stop' && req.method === 'POST') { reconstructor.stop(); return json(res, 200, { stopping: true, note: 'The current KeyShot render finishes before restoration.' }); }
    if (url.pathname === '/api/reconstruct/camera' && req.method === 'POST') { const b = await body(req); return json(res, 200, reconstructor.confirmCamera(b.accept === true)); }
    if (url.pathname === '/api/reconstruct/undo' && req.method === 'POST') { assertSceneAvailable(); return json(res, 200, await reconstructor.undo()); }
    if (url.pathname === '/api/reconstruct/deliver' && req.method === 'POST') { const b = await body(req); assertSceneAvailable(); return json(res, 200, await reconstructor.deliver(b)); }
    if (url.pathname === '/api/reconstruct/recovery' && req.method === 'GET') return json(res, 200, await reconstructor.recovery());
    if (url.pathname === '/api/reconstruct/recovery' && req.method === 'POST') { const b = await body(req); assertSceneAvailable(); return json(res, 200, await reconstructor.resolveRecovery(String(b.job_id || ''), String(b.action || ''))); }
    if (url.pathname === '/api/reconstruct/file' && req.method === 'GET') {
      const file = reconstructor.file(url.searchParams.get('id'), url.searchParams.get('slot'));
      if (!fs.existsSync(file)) return json(res, 404, { error: 'Not available.' });
      res.writeHead(200, { 'Content-Type': file.endsWith('.json') ? 'application/json' : 'image/png', 'Cache-Control': 'no-store' }); return res.end(fs.readFileSync(file));
    }
    if (url.pathname === '/api/photo/recovery' && req.method === 'GET') return json(res, 200, await photoDirector.recovery());
    if (url.pathname === '/api/photo/recovery' && req.method === 'POST') { const b = await body(req); assertSceneAvailable(); return json(res, 200, await photoDirector.resolveRecovery(String(b.job_id || ''), String(b.action || ''))); }
    if (url.pathname === '/api/photo/stop' && req.method === 'POST') { photoDirector.stop(); return json(res, 200, { stopping: true, note: 'The current KeyShot render finishes before restoration.' }); }
    if (url.pathname === '/api/photo/undo' && req.method === 'POST') { assertSceneAvailable(); return json(res, 200, await photoDirector.undo()); }
    if (url.pathname === '/api/photo/file' && req.method === 'GET') {
      const slot = url.searchParams.get('slot'), file = photoDirector.file(url.searchParams.get('id'), slot);
      if (!fs.existsSync(file)) return json(res, 404, { error: 'Photo output is not ready yet.' });
      res.writeHead(200, { 'Content-Type': slot === 'recipe' ? 'application/json' : 'image/png', 'Cache-Control': 'no-store',
        ...(url.searchParams.has('download') ? { 'Content-Disposition': `attachment; filename="keyshot-${slot}.${slot === 'recipe' ? 'json' : 'png'}"` } : {}) });
      return fs.createReadStream(file).pipe(res);
    }
    if (url.pathname === '/api/frame' && req.method === 'POST') { const b = await body(req); assertSceneAvailable(); return json(res, 200, await actions.frame_product(b)); }
    if (url.pathname === '/api/scene' && req.method === 'GET') {
      const input = {};
      for (const key of ['node_id', 'offset']) if (url.searchParams.has(key)) {
        const value = url.searchParams.get(key);
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw Object.assign(new Error('Invalid inventory ' + key), { status: 400 });
        input[key] = Number(value);
      }
      return json(res, 200, await actions.scene_objects(input));
    }
    if (url.pathname === '/api/staging' && req.method === 'POST') {
      const b = await body(req); assertSceneAvailable();
      const allowed = { move: 'move_object', duplicate: 'duplicate_object', set: 'create_set_piece', undo: 'undo_staging' };
      if (!Object.hasOwn(allowed, b.action)) throw new Error('Unknown staging action');
      return json(res, 200, await actions[allowed[b.action]](b));
    }
    if (url.pathname === '/api/environment' && req.method === 'GET') return json(res, 200, await send('env_info'));
    if (url.pathname === '/api/environment' && req.method === 'POST') { const b = await body(req); assertSceneAvailable(); return json(res, 200, await actions.set_environment(b)); }
    if (url.pathname === '/api/status') {
      lastClient = Date.now();
      if (!synced && heartbeat().alive) syncFromKeyShot();
      if (!latestShot && heartbeat().alive && !preview.firstTried) { preview.firstTried = true; preview.wanted = true; }     // first picture on connect
      if (!heartbeat().alive) preview.firstTried = false;
      return json(res, 200, { bridge: heartbeat(), ips: lanIPs(), port: PORT, playing: !!playing, base });
    }
    if (url.pathname === '/api/scene-context' && req.method === 'GET') {
      assertSceneAvailable();
      return json(res, 200, await actions.scene_context());
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
    // ---- lifecycle: restart / quit this app, or tell the bridge inside KeyShot to stop ----
    if (url.pathname === '/api/quit' && req.method === 'POST') {
      const b = await body(req); json(res, 200, { ok: true, restart: !!b.restart });
      setTimeout(() => process.exit(b.restart ? 3 : 0), 250);       // the platform launcher restarts on exit code 3
      return;
    }
    if (url.pathname === '/api/bridge/stop' && req.method === 'POST') {
      if (!heartbeat().alive) return json(res, 200, { ok: true, note: 'the bridge was not running' });
      const current = heartbeat();
      let acknowledged = false;
      try { await send('stop', {}, 15000); acknowledged = true; } catch { /* report an unconfirmed stop instead of claiming success */ }
      if (acknowledged) markStopped(current.instance);
      return json(res, 200, { ok: acknowledged, note: acknowledged ? 'Bridge stopped. In KeyShot, run its launcher again to reconnect.' : 'The stop was not acknowledged. The bridge may still be busy; check its status before sending another request.' });
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
    if (url.pathname === '/api/styles/image' && req.method === 'GET') {
      const name = url.searchParams.get('name'), file = url.searchParams.get('file');
      const entry = style.listStyles().find(s => s.name === name);
      if (!entry || !entry.previews.includes(file)) return json(res, 404, { error: 'Reference image not found.' });
      const target = path.join(style.ROOT, name, file), ext = path.extname(file).toLowerCase();
      const mime = { '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.bmp':'image/bmp','.avif':'image/avif' }[ext];
      if (!mime || !fs.existsSync(target)) return json(res, 404, { error: 'Preview is unavailable for this image type.' });
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'private, max-age=60' }); return fs.createReadStream(target).pipe(res);
    }
    if (url.pathname === '/api/styles/save' && req.method === 'POST') {
      const b = await body(req), name = String(b.name || '').trim();
      if (!/^[a-zA-Z0-9][a-zA-Z0-9 _-]{1,63}$/.test(name) || name.startsWith('_')) return json(res, 400, { error: 'Use 2–64 letters, numbers, spaces, dashes or underscores for the style name.' });
      if (!Array.isArray(b.images) || !b.images.length || b.images.length > 8) return json(res, 400, { error: 'Add 1–8 images to this style.' });
      const images = b.images.map((data, i) => {
        const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(data);
        if (!m) throw Object.assign(new Error(`Image ${i + 1} must be PNG, JPEG or WebP.`), { status: 400 });
        const bytes = Buffer.from(m[2], 'base64');
        if (bytes.length > 4 * 1024 * 1024) throw Object.assign(new Error(`Image ${i + 1} is too large; use an image under 4 MB.`), { status: 400 });
        const valid = m[1] === 'jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 : m[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
        if (!valid) throw Object.assign(new Error(`Image ${i + 1} is not a valid ${m[1]} file.`), { status: 400 });
        return { ext: m[1] === 'jpeg' ? 'jpg' : m[1], bytes };
      });
      const folder = path.join(style.ROOT, name);
      fs.mkdirSync(folder, { recursive: true });
      const stamp = Date.now();
      images.forEach((item, i) => fs.writeFileSync(path.join(folder, `reference_${stamp}_${i + 1}.${item.ext}`), item.bytes, { flag: 'wx' }));
      return json(res, 200, { name, added: images.length, total: style.listStyles().find(s => s.name === name)?.images || images.length });
    }
    if (url.pathname === '/api/styles/analyze' && req.method === 'POST') { const { name } = await body(req); const r = await style.analyzeFolder(name); return json(res, 200, { style: r.style, analyzed: r.analyzed, failed: r.failed, looks: r.looks.map(l => ({ id: l.id, images: l.images.length, profile: l.profile })) }); }
    if (url.pathname === '/api/style/score' && req.method === 'POST') { const { name, settle } = await body(req); return json(res, 200, await scoreLive(name, settle ?? 2500)); }
    // ---- prompt box ----
    if (url.pathname === '/api/config' && req.method === 'GET') return json(res, 200, { ...agent.publicConfig(), ...(await agent.engineStatus()) });
    if (url.pathname === '/api/config' && req.method === 'POST') {
      const b = await body(req), patch = {};
      if (typeof b.codexModel === 'string') {
        const model = b.codexModel.trim();
        if (model.length > 80 || !/^[a-zA-Z0-9._:-]*$/.test(model)) return json(res, 400, { error: 'Enter a Codex model ID using letters, numbers, dots, underscores, colons or dashes, up to 80 characters. Leave it empty for the account default.' });
        patch.codexModel = model;
      }
      if (typeof b.apiKey === 'string') patch.apiKey = b.apiKey.trim();
      if (typeof b.model === 'string' && b.model.trim()) patch.model = b.model.trim();
      if (['auto', 'cli', 'codex', 'api', 'offline'].includes(b.engine)) patch.engine = b.engine;
      if (typeof b.cliPath === 'string') patch.cliPath = b.cliPath.trim();
      if (typeof b.codexPath === 'string') patch.codexPath = b.codexPath.trim();
      agent.setConfig(patch);
      await require('./cli').status(patch.cliPath ?? agent.getConfig().cliPath, true);
      await require('./cli').codexStatus(patch.codexPath ?? agent.getConfig().codexPath, true);
      return json(res, 200, { ...agent.publicConfig(), ...(await agent.engineStatus()) });
    }
    if (url.pathname === '/api/prompt' && req.method === 'POST') {
      if (promptJob && !promptJob.done) return json(res, 409, { error: 'still working on the last request' });
      const b = await body(req); const job = promptJob = { id: Date.now(), events: [], done: false };
      const lightingFocus = lightingPlaybooks.FOCUS.some(item => item.id === b.lighting_focus) ? b.lighting_focus : 'auto';
      // agent.run normally records its own errors and marks the job done in its
      // finally block. Keep a server-side terminal path too, so an unexpected
      // rejection during setup cannot leave the UI polling forever or block the
      // next prompt with a stale "still working" job.
      agent.run(job, { text: String(b.text || ''), images: Array.isArray(b.images) ? b.images.slice(0, 8) : [], lightingFocus }, actions).catch(error => {
        if (job.done) return;
        job.events.push({ type: 'error', message: error && error.message ? error.message : 'Director request failed unexpectedly.', t: Date.now() });
        job.done = true;
        job.events.push({ type: 'done', t: Date.now() });
      });
      return json(res, 200, { id: job.id });
    }
    if (url.pathname === '/api/prompt' && req.method === 'GET') {
      const since = +(url.searchParams.get('since') || 0); const j = promptJob;
      return json(res, 200, j ? { id: j.id, done: j.done, events: j.events.slice(since), next: j.events.length } : { id: null, done: true, events: [], next: 0 });
    }
    if (url.pathname === '/api/prompt/stop' && req.method === 'POST') { if (promptJob && promptJob.abort) promptJob.abort(); photoDirector.stop(); if (playing) playing.cancel = true; return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/prompt/reset' && req.method === 'POST') { agent.history.length = 0; return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/material/prompt' && req.method === 'POST') {
      if (materialPromptJob && !materialPromptJob.done) return json(res, 409, { error: 'Material Director is still working.' });
      const b = await body(req), images = Array.isArray(b.images) ? b.images : [], context = resolveMaterialContext(b.context);
      const graphPreset = normalizeMaterialGraphPreset(b.graph_preset);
      const aspectChoices = new Set(['original', '1:1', '4:3', '3:2', '16:9', '3:4', '2:3', '9:16']);
      const imageAspectRatio = String(b.imageAspectRatio || 'original');
      if (!aspectChoices.has(imageAspectRatio)) return json(res, 400, { error: 'Choose a supported material image aspect ratio.' });
      if (images.length > 8) return json(res, 400, { error: 'A material reference pack can contain up to 8 images.' });
      let imageBytes = 0;
      for (const image of images) {
        const match = typeof image === 'string' && /^data:image\/(png|jpeg|webp);base64,([a-z0-9+/]+=*)$/i.exec(image);
        if (!match) return json(res, 400, { error: 'Each material reference must be a PNG, JPEG or WebP image.' });
        const bytes = Buffer.from(match[2], 'base64').length;
        if (bytes > 4 * 1024 * 1024) return json(res, 413, { error: 'Each material reference must be under 4 MB after resizing.' });
        imageBytes += bytes;
      }
      if (imageBytes > 10 * 1024 * 1024) return json(res, 413, { error: 'The complete material reference pack must be under 10 MB.' });
      const job = materialPromptJob = { id: Date.now(), events: [], done: false };
      agent.run(job, { text: String(b.text || ''), images, context: { ...(context || {}), graph_preset: graphPreset, imageAspectRatio } }, actions, 'material').catch(error => {
        if (job.done) return;
        job.events.push({ type: 'error', message: error && error.message ? error.message : 'Material Director request failed unexpectedly.', t: Date.now() });
        job.done = true;
        job.events.push({ type: 'done', t: Date.now() });
      });
      return json(res, 200, { id: job.id });
    }
    if (url.pathname === '/api/material/prompt' && req.method === 'GET') {
      const since = +(url.searchParams.get('since') || 0), j = materialPromptJob;
      return json(res, 200, j ? { id: j.id, done: j.done, events: j.events.slice(since), next: j.events.length } : { id: null, done: true, events: [], next: 0 });
    }
    if (url.pathname === '/api/material/prompt/stop' && req.method === 'POST') { materialPromptJob?.abort?.(); return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/material/prompt/reset' && req.method === 'POST') { agent.materialHistory.length = 0; return json(res, 200, { ok: true }); }
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
        lightingPlaybooks: lightingPlaybooks.list(),
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
    if (url.pathname === '/api/materials' && req.method === 'GET') return json(res, 200, await send('materials_list', {}, 15000));
    if (url.pathname === '/api/material/library' && req.method === 'GET') return json(res, 200, await send('material_library', { query: url.searchParams.get('q') || '' }, 30000));
    if (url.pathname === '/api/scene/parts' && req.method === 'GET') return json(res, 200, await send('material_scene_objects', {}, 30000));
    if (url.pathname === '/api/material/targets' && req.method === 'POST') return json(res, 200, await send('material_targets', await body(req), 15000));
    if (url.pathname === '/api/material/assets' && req.method === 'GET') return json(res, 200, { directory: MATERIAL_PACKAGE_DIR, assets: listMaterialPackages() });
    if (url.pathname === '/api/material/texture-sets' && req.method === 'GET') return json(res, 200, { directory: textureSets.ROOT, sets: textureSets.listTextureSets() });
    if (url.pathname === '/api/material/texture-sets' && req.method === 'POST') {
      const b = await body(req), created = textureSets.createTextureSet(b.name);
      return json(res, 201, created);
    }
    if (url.pathname === '/api/material/texture-file' && req.method === 'POST') {
      const data = await rawBody(req, textureSets.MAX_FILE_BYTES);
      const file = textureSets.addTextureFile(url.searchParams.get('id'), url.searchParams.get('name'), data);
      return json(res, 201, file);
    }
    if (url.pathname === '/api/material/build-from-texture-set' && req.method === 'POST') {
      const b = await body(req), result = await actions.build_material_from_texture_set({ texture_set_id: b.texture_set_id, name: b.name,
        graph_preset: b.graph_preset, use_ao: b.use_ao !== false, use_displacement: b.use_displacement === true,
        geometry_template: b.geometry_template, selected_files: b.selected_files, tile_size_mm: b.tile_size_mm === undefined ? 41 : b.tile_size_mm });
      return json(res, 201, result);
    }
    if (url.pathname === '/api/material/edit-texture-map' && req.method === 'POST') {
      const b = await body(req), result = await actions.edit_texture_map(b);
      return json(res, 201, result);
    }
    if (url.pathname === '/api/material/file' && req.method === 'GET') {
      const requested = url.searchParams.get('name');
      const asset = listMaterialPackages().find(item => item.name === requested);
      if (!asset || !fs.existsSync(asset.path)) return json(res, 404, { error: 'Material package not found. Refresh the asset list and try again.' });
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': asset.size,
        'Content-Disposition': `attachment; filename="${asset.name.replace(/[\"\\\r\n]/g, '_')}"`, 'Cache-Control': 'no-store' });
      return fs.createReadStream(asset.path).pipe(res);
    }
    if (url.pathname === '/api/material/open-folder' && req.method === 'POST') {
      const b = await body(req);
      const target = b.textureSet ? textureSets.listTextureSets().find(set => set.id === b.textureSet)?.path : MATERIAL_PACKAGE_DIR;
      if (!target || !fs.existsSync(target)) return json(res, 404, { error: 'That material folder could not be found. Refresh the list and try again.' });
      const opener = process.platform === 'win32' ? ['explorer.exe', target]
        : process.platform === 'darwin' ? ['open', target]
          : ['xdg-open', target];
      execFile(opener[0], [opener[1]], { windowsHide: true }, error => {
        if (error) console.warn('Could not open the materials folder:', error.message);
      });
      return json(res, 200, { opened: true, directory: target });
    }
    if (url.pathname === '/api/material/inspect' && req.method === 'POST') return json(res, 200, await send('material_inspect', await body(req), 15000));
    if (url.pathname === '/api/material/create' && req.method === 'POST') return json(res, 200, await send('material_create', await body(req), 15000));
    if (url.pathname === '/api/material/copy' && req.method === 'POST') return json(res, 201, await send('material_copy', await body(req), 30000));
    if (url.pathname === '/api/material/library-copy' && req.method === 'POST') return json(res, 201, await send('material_library_copy', await body(req), 30000));
    if (url.pathname === '/api/material/bump' && req.method === 'POST') return json(res, 200, await send('material_bump_set', await body(req), 30000));
    if (url.pathname === '/api/material/edit-target' && req.method === 'POST') return json(res, 200, await send('material_edit_target', await body(req), 15000));
    if (url.pathname === '/api/material/set' && req.method === 'POST') return json(res, 200, await send('material_set', await body(req), 15000));
    if (url.pathname === '/api/material/undo' && req.method === 'POST') return json(res, 200, await send('material_undo', {}, 15000));
    if (url.pathname === '/api/material/save' && req.method === 'POST') return json(res, 200, await send('material_save', await body(req), 30000));
    if (url.pathname === '/api/material/discard' && req.method === 'POST') return json(res, 200, await send('material_discard', await body(req), 15000));
    if (url.pathname === '/api/exposure' && req.method === 'POST') {
      const { value } = await body(req); await ensureSubject(); await setExposure(+value);
      return json(res, 200, { exposure: studio.exposure });
    }
    if (url.pathname === '/api/environment-fill' && req.method === 'POST') {
      const { multiplier } = await body(req);
      assertSceneAvailable();
      return json(res, 200, await setEnvironmentMultiplier(+multiplier));
    }
    if (url.pathname === '/api/autoexpose' && req.method === 'POST') { const b = await body(req); await ensureSubject(); return json(res, 200, await autoExpose(b)); }
    if (url.pathname === '/api/measure' && req.method === 'GET') { const m = await measure(+(url.searchParams.get('settle') ?? 1500)); return json(res, 200, m); }
    if (url.pathname === '/api/env' && req.method === 'POST') { const b = await body(req); studio.env = await send('env_set', b, 30000); if (Number.isFinite(b.brightness)) { studio.envMultiplier = 1; const exposure = studio.envScales ? studio.exposure : 1; studio.envBaseBrightness = Math.max(0.000001, b.brightness / Math.max(0.000001, exposure)); } return json(res, 200, studio.env); }
    if (url.pathname === '/api/studio/off' && req.method === 'POST') {
      const r = await send('studio_off', {}, 60000); studio.lights = {}; studio.rig = null; studio.rigSubject = null; studio.env = null; studio.envBaseBrightness = null; studio.envMultiplier = 1; studio.envScales = false; return json(res, 200, r);
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
    const file = path.resolve(PUBLIC, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: 'Invalid file path.' });
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
      const headers = { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' };
      if (path.extname(file) === '.woff2') headers['Cache-Control'] = 'public, max-age=86400';
      res.writeHead(200, headers);
      return res.end(fs.readFileSync(file));
    }
    res.writeHead(404); res.end('not found');
  } catch (e) { json(res, e.status || 500, { error: e.message }); }
});

listenWithFallback(server, {
  host: '0.0.0.0',
  port: PORT,
  maxAttempts: 10,
  onPort: port => { PORT = port; },
  onListening: () => {
    if (process.platform === 'win32') {
      const marker = path.join(__dirname, '..', 'bridge', 'director-server.json');
      try { fs.writeFileSync(marker, JSON.stringify({ pid: process.pid, port: PORT, started: Date.now(), entry: path.resolve(__filename) }), 'utf8'); }
      catch (error) { console.warn(`[startup] Could not write the safe-stop marker: ${error.message}`); }
    }
    console.log(`KeyShot control server: http://localhost:${PORT}`);
    if (process.env.KD_OPEN && process.platform === 'win32') execFile('cmd', ['/c', 'start', '""', `http://localhost:${PORT}`], { windowsHide: true }, () => {});
    if (process.env.KD_OPEN && process.platform === 'darwin') execFile('open', [`http://localhost:${PORT}`], () => {});
    for (const ip of lanIPs()) console.log(`  phone / other PC: http://${ip}:${PORT}`);
  },
  onError: (error, range) => {
    if (error.code === 'EADDRINUSE')
      console.log(`\nPorts ${range.firstPort}-${range.lastPort} are already in use. Close another KeyShot Director window, or set PORT to a free port and start again.`);
    else console.log('\nServer error: ' + error.message);
    process.exit(1);
  },
});
function removeServerMarker() {
  if (process.platform !== 'win32') return;
  const marker = path.join(__dirname, '..', 'bridge', 'director-server.json');
  try {
    const record = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (record.pid === process.pid && path.resolve(record.entry || '') === path.resolve(__filename)) fs.unlinkSync(marker);
  } catch { /* already stopped or a different app instance owns the marker */ }
}
process.once('exit', removeServerMarker);
const tidyOpts = { send, cameras: false, alive: () => heartbeat().alive, busy: () => !!(photoDirector.status().running || playing || matchJob.running || videoJob.running || renderJob.running || (promptJob && !promptJob.done) || (materialPromptJob && !materialPromptJob.done) || shotBusy) };
let tidyTimer = null;
function tidyLater() { clearTimeout(tidyTimer); tidyTimer = setTimeout(() => janitor.run(tidyOpts, 'job').catch(() => {}), 5000); }
janitor.start(tidyOpts);
captureLoop();
