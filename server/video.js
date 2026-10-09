// video.js - "match a reference video": frames (extracted in the browser) -> lighting look + camera shot list
// -> a camera recipe framed for the user's own product.
//
//   frames   [{ t: seconds, png: Buffer }]                 sampled evenly from the dropped video
//   measure  per frame: where the product sits and how much of the frame it fills (corner-backdrop mask, style.js)
//   plan     Claude reads the frames + measurements and returns a shot list (JSON). Without an API key the plan is
//            built from the measurements alone: framing and push/pull, but no orbit (that needs eyes).
//   recipe   shot list + one calibration of the user's product in the live viewport -> keys for shots.js
const fs = require('fs');
const path = require('path');
const { decode } = require('./png');
const style = require('./style');
const agent = require('./agent');
const cli = require('./cli');

const RIGS = ['hero_soft', 'dark_moody', 'glass_edge', 'blank_studio', 'warm_luxe'];
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- 1. measure -----------------------------------------------------------------------------------------------
// fillH / fillW: the product's bounding box as a fraction of frame height / width. cx, cy: its centre offset from the
// frame centre (fractions of width / height, +x right, +y down). ok=false when there is no clean backdrop to mask against.
function measureFrame(png) {
  const f = style.features(decode(png)), [x0, y0, x1, y1] = f.box;
  const fillH = y1 - y0, fillW = x1 - x0;
  return { ok: !!f.hasBackdrop && fillH < 0.97 && fillW < 0.97 && fillH > 0.03, fillH: +fillH.toFixed(3), fillW: +fillW.toFixed(3),
    cx: +((x0 + x1) / 2 - 0.5).toFixed(3), cy: +((y0 + y1) / 2 - 0.5).toFixed(3), aspect: f.aspect, features: f };
}

// ---- 2. lighting ------------------------------------------------------------------------------------------------
function saveAsStyle(frames, name = '_video') {
  const dir = path.join(style.ROOT, name); fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (/^ref_\d+\.png$/.test(f)) fs.unlinkSync(path.join(dir, f));      // only files this feature wrote
  const cache = path.join(dir, '.cache'); if (fs.existsSync(cache)) for (const f of fs.readdirSync(cache)) if (/^ref_\d+\./.test(f)) fs.unlinkSync(path.join(cache, f));
  frames.forEach((f, i) => fs.writeFileSync(path.join(dir, `ref_${String(i + 1).padStart(2, '0')}.png`), f.png));
  return name;
}
// Pick the closest ready-made rig from measured tone (used when Claude is not available or gives no answer).
function guessRig(ms) {
  const F = k => med(ms.map(m => m.features[k]));
  const bg = F('bgLuma'), glow = F('edgeGlow'), warm = F('highlightWarmth'), contrast = F('contrast');
  const rig = bg > 0.55 ? 'blank_studio' : bg < 0.2 ? (glow > 1.25 ? 'glass_edge' : warm > 0.1 ? 'warm_luxe' : 'dark_moody') : (warm > 0.12 ? 'warm_luxe' : contrast > 2.6 ? 'dark_moody' : 'hero_soft');
  return { rig, mirror: F('sideBias') < -0.08, why: `backdrop ${bg.toFixed(2)}, contrast ${contrast.toFixed(1)}, edge glow ${glow.toFixed(2)}, highlight warmth ${warm.toFixed(2)}` };
}

// ---- 3. plan ------------------------------------------------------------------------------------------------------
const PLAN_SYSTEM = `You analyse a product-commercial clip so its lighting and camera work can be re-created around a DIFFERENT product in a 3D renderer.
You get evenly spaced frames (with timestamps) and, per frame, a rough automatic measurement of how much of the frame the product fills (unreliable when the backdrop is busy; trust your eyes over it).

Reply with ONE JSON object and nothing else:
{
 "summary": "one sentence describing the clip",
 "lighting": { "rig": "hero_soft|dark_moody|glass_edge|blank_studio|warm_luxe", "mirror": false, "notes": "key side, softness, backdrop, colour" },
 "keys": [ { "t": 0.0, "azimuth": 0, "elevation": 10, "fill": 0.6, "x": 0, "y": 0, "ease": "easeInOut", "cut": false } ]
}
Rules for "keys" (the camera, described relative to the product):
- t: seconds from the start. First key at 0, last key at the clip's duration. Add a key wherever the move changes speed or direction; 2-8 keys is typical.
- azimuth: degrees the camera has travelled AROUND the product since the first frame's view. 0 at the first key unless the clip clearly opens off-axis. Positive = the camera moves to its own right (we see more of the product's right side). A spinning product on a turntable counts as the camera orbiting the opposite way. A full turn is 360; keep counting past 360, do not wrap.
- elevation: degrees the camera is above the product's horizon (0 = level, 90 = top-down, negative = looking up).
- fill: fraction of the frame HEIGHT the product's height occupies (1.0 = touches top and bottom, >1 = cropped close-up, 0.3 = small in frame). This sets the distance, so be careful with it.
- x, y: where the product's centre sits, as offsets from frame centre in fractions of the frame (x +right, y +down). 0,0 = centred.
- ease: how the camera travels INTO this key from the previous one: linear, easeIn, easeOut, easeInOut.
- cut: true when this key starts a new shot (a hard cut), false for a continuous move.
- rig: dark_moody = one big soft side key on near-black; glass_edge = rim/edge strips with a back glow, for glass and liquids on dark; hero_soft = classic soft 3-point on grey; blank_studio = bright seamless white; warm_luxe = warm key on deep brown-black. mirror = true if the key light comes from camera-right instead of camera-left.`;

async function askClaude(frames, ms, duration, signal) {
  const cfg = agent.getConfig(), eng = await agent.pickEngine(cfg);
  if (eng.engine === 'cli') {                                  // the user's signed-in Claude Code: frames as files it can Read
    const dir = cli.tmpDir('video');
    try {
      const lines = frames.map((f, i) => {
        const p = path.join(dir, 'frame_' + String(i + 1).padStart(2, '0') + '.png'); fs.writeFileSync(p, f.png);
        return 'frame ' + (i + 1) + ' at t=' + f.t.toFixed(2) + 's: ' + p + (ms[i].ok ? ' (auto: fills ' + ms[i].fillH + ' of height, ' + ms[i].fillW + ' of width, centre offset ' + ms[i].cx + ',' + ms[i].cy + ')' : ' (auto measurement unavailable)');
      });
      const prompt = 'Use the Read tool to look at EVERY one of these frame images, then answer.\n\n' + lines.join('\n') + '\n\nThe clip is ' + duration.toFixed(2) + ' seconds long, aspect ratio ' + ms[0].aspect + '. Return the JSON object only.';
      return cli.extractJson(await cli.ask({ bin: eng.bin, system: PLAN_SYSTEM, prompt, dir, model: cfg.cliModel, signal }));
    } finally { cli.rmDir(dir); }
  }
  const key = cfg.apiKey || process.env.ANTHROPIC_API_KEY; if (eng.engine !== 'api' || !key) return null;
  const base = (cfg.baseUrl || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  const content = [];
  frames.forEach((f, i) => {
    content.push({ type: 'text', text: `frame ${i + 1} at t=${f.t.toFixed(2)}s` + (ms[i].ok ? ` (auto: fills ${ms[i].fillH} of height, ${ms[i].fillW} of width, centre offset ${ms[i].cx},${ms[i].cy})` : ' (auto measurement unavailable)') });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: f.png.toString('base64') } });
  });
  content.push({ type: 'text', text: `The clip is ${duration.toFixed(2)} seconds long, aspect ratio ${ms[0].aspect}. Return the JSON.` });
  const r = await fetch(base + '/v1/messages', {
    method: 'POST', signal, headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: cfg.model || 'claude-sonnet-5-5', max_tokens: 2000, system: PLAN_SYSTEM, messages: [{ role: 'user', content }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 401 ? 'The API key was rejected - check it in Settings.' : (j.error && j.error.message) || ('API error ' + r.status));
  const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error('the model did not return a plan');
  return JSON.parse(m[0]);
}

// Plan from measurements only: framing + push/pull + drift. No orbit.
function offlinePlan(frames, ms, duration) {
  const good = frames.map((f, i) => ({ t: f.t, m: ms[i] })).filter(x => x.m.ok);
  const g = guessRig(ms);
  if (good.length < 2) return { summary: 'could not isolate the product from the backdrop; kept a static framing', lighting: g, keys: [{ t: 0, azimuth: 0, elevation: 12, fill: 0.6, x: 0, y: 0 }, { t: duration, azimuth: 0, elevation: 12, fill: 0.6, x: 0, y: 0 }], offline: true };
  // a few evenly spread keys from a smoothed fill track
  const sm = good.map((x, i) => { const w = good.slice(Math.max(0, i - 1), i + 2); return { t: x.t, fill: med(w.map(q => q.m.fillH)), x: med(w.map(q => q.m.cx)), y: med(w.map(q => q.m.cy)) }; });
  const n = Math.min(5, sm.length), keys = [];
  for (let i = 0; i < n; i++) { const s = sm[Math.round(i * (sm.length - 1) / (n - 1))]; keys.push({ t: i === 0 ? 0 : i === n - 1 ? duration : +s.t.toFixed(2), azimuth: 0, elevation: 12, fill: s.fill, x: s.x, y: s.y, ease: 'easeInOut' }); }
  return { summary: `framing track from ${good.length} frames (no orbit detection without an API key)`, lighting: g, keys, offline: true };
}

function cleanPlan(p, duration) {
  if (!p || !Array.isArray(p.keys) || p.keys.length < 1) throw new Error('plan has no camera keys');
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  let keys = p.keys.map(k => ({ t: clamp(num(k.t, 0), 0, duration), azimuth: num(k.azimuth, 0), elevation: clamp(num(k.elevation, 10), -80, 88), fill: clamp(num(k.fill, 0.6), 0.05, 3),
    x: clamp(num(k.x, 0), -0.6, 0.6), y: clamp(num(k.y, 0), -0.6, 0.6), ease: ['linear', 'easeIn', 'easeOut', 'easeInOut'].includes(k.ease) ? k.ease : 'easeInOut', cut: !!k.cut })).sort((a, b) => a.t - b.t);
  keys[0].t = 0; keys[0].cut = false;
  if (keys.length === 1) keys.push({ ...keys[0] });
  keys[keys.length - 1].t = duration;
  const L = p.lighting || {};
  return { summary: String(p.summary || ''), offline: !!p.offline, lighting: { rig: RIGS.includes(L.rig) ? L.rig : 'hero_soft', mirror: !!L.mirror, notes: String(L.notes || L.why || '') }, keys };
}

async function analyze(frames, duration, { signal, log = () => {} } = {}) {
  const ms = frames.map(f => measureFrame(f.png));
  log(`measured ${ms.filter(m => m.ok).length}/${ms.length} frames with a clean backdrop`);
  let plan = null, engine = 'offline';
  try { plan = await askClaude(frames, ms, duration, signal); if (plan) engine = 'claude'; } catch (e) { if (e.name === 'AbortError') throw e; log('AI analysis failed (' + e.message + ') - using measurements only'); }
  if (!plan) plan = offlinePlan(frames, ms, duration);
  plan = cleanPlan(plan, duration);
  return { plan, engine, measurements: ms.map(({ features, ...m }, i) => ({ t: frames[i].t, ...m })), aspect: ms[0].aspect };
}

// ---- 4. recipe ------------------------------------------------------------------------------------------------------
// calib: { dist, hfrac, wfrac } - at camera distance `dist`, rendered at the OUTPUT aspect, the user's product covered
// hfrac of the frame height and wfrac of its width. Size on screen scales with 1/dist, so kH = hfrac*dist and
// kW = wfrac*dist are constants. The reference "fill" (height fraction) sets the distance; if the user's product is
// wider than the reference one it is backed off just enough to stay inside the frame (unless the shot is a crop-in).
function buildRecipe(plan, { base, subject, calib, aspect = 16 / 9, duration }) {
  const kH = calib.hfrac * calib.dist, kW = calib.wfrac * calib.dist, D2R = Math.PI / 180;
  const H = subject.size[1] || subject.span;
  const keys = plan.keys.map(k => {
    const dist = Math.max(kH / k.fill, kW / Math.max(0.92, k.fill));
    const az = base.az + k.azimuth, el = k.elevation;
    const visH = dist * H / kH, visW = visH * aspect;                 // mm visible at the product's depth
    const a = az * D2R, e = el * D2R;
    const right = [Math.cos(a), 0, -Math.sin(a)], up = [-Math.sin(e) * Math.sin(a), Math.cos(e), -Math.sin(e) * Math.cos(a)];
    const pivot = subject.center.map((c, i) => +(c - right[i] * k.x * visW + up[i] * k.y * visH).toFixed(2));
    return { t: +(k.t / duration).toFixed(4), az: +az.toFixed(2), el: +el.toFixed(2), dist: +dist.toFixed(2), fov: base.fov, pivot, ease: k.cut ? 'hold' : k.ease };
  });
  return { name: 'video_match', duration: +duration.toFixed(2), ease: 'easeInOut', keys };
}

// Exact silhouette of the user's product from a small render with an alpha channel (independent of lighting and backdrop).
function calibrateAlpha(png, dist) {
  const img = decode(png); if (!img.hasAlpha) return null;
  let x0 = img.w, x1 = -1, y0 = img.h, y1 = -1;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (img.alpha(x, y) > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const touches = x0 <= 0 || y0 <= 0 || x1 >= img.w - 1 || y1 >= img.h - 1;
  return { dist, hfrac: +((y1 - y0 + 1) / img.h).toFixed(4), wfrac: +((x1 - x0 + 1) / img.w).toFixed(4), cx: +(((x0 + x1 + 1) / 2) / img.w - 0.5).toFixed(4), cy: +(((y0 + y1 + 1) / 2) / img.h - 0.5).toFixed(4), touches };
}
// Last resort: assume the reported FOV is horizontal.
function calibrateAnalytic(subject, pose, aspect = 16 / 9) {
  const visW = 2 * pose.dist * Math.tan((pose.fov * Math.PI / 180) / 2), visH = visW / aspect;
  return { dist: pose.dist, hfrac: (subject.size[1] || subject.span) / visH, wfrac: Math.max(subject.size[0], subject.size[2]) / visW, analytic: true };
}

module.exports = { analyze, measureFrame, saveAsStyle, guessRig, buildRecipe, calibrateAlpha, calibrateAnalytic, cleanPlan, RIGS };
