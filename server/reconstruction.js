// Single-view, CAD-first scene reconstruction (milestone 1). The user's product, camera, materials and environment source of
// truth stay as they are; the session fits one or two native Area lights to a reference photograph using real renders as the
// judge, then keeps the best valid result or restores the starting scene.
//
//   baseline -> camera lock/verify -> bounded physical-mode light fit -> finalist check -> residual diagnosis -> before/after
//   (+ an explicit, separate native save). Every stage is recorded in a persistent receipt.
//
// What it does NOT do: change geometry or materials, recover the original studio, claim a similarity percentage, or save
// anything unless asked. All scene access goes through injected `deps`, so it is exercised offline against a synthetic
// renderer; the KeyShot adapter in server.js has not been run against a live scene (see docs/RECONSTRUCTION_MILESTONE_1.md).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const photo = require('./photo');
const { normalizeMask, rasterize } = require('./image-mask');
const objectives = require('./lighting-objectives');
const { optimize } = require('./derivative-free');
const alignment = require('./camera-alignment');
const { createRecovery } = require('./job-receipt');
const { decode, encodeRgb } = require('./png');

const MAX_FREE_PARAMETERS = 6, MAX_EVALUATIONS = 40, MIN_EVALUATIONS = 9;
// Search ranges for the physical, interpretable parameters of an Area light (distances/sizes in product spans, power is the
// fixed-flux multiplier of the physical power mode; log scale).
const PARAMETERS = {
  az: { lo: -180, hi: 180 }, el: { lo: -20, hi: 85 }, d: { lo: 1.5, hi: 6 },
  size: { lo: 0.3, hi: 4, log: true }, power: { lo: 0.05, hi: 12, log: true },
};
const DEFAULT_RIG = {
  lights: [
    { id: 'key', start: { az: -40, el: 45, d: 3, size: 2, power: 1 }, free: ['az', 'el', 'power', 'size'] },
    { id: 'fill', start: { az: 60, el: 10, d: 3.5, size: 2.5, power: 0.25 }, free: ['power', 'az'] },
  ],
};
const finite = v => typeof v === 'number' && Number.isFinite(v);

function rigFrom(input) {
  const rig = input == null ? DEFAULT_RIG : input;
  if (!Array.isArray(rig.lights) || rig.lights.length < 1 || rig.lights.length > 2) throw new Error('A reconstruction rig has one or two Area lights.');
  const ids = new Set();
  const lights = rig.lights.map(light => {
    if (typeof light.id !== 'string' || !/^[a-z_]{1,16}$/.test(light.id) || ids.has(light.id)) throw new Error('Each light needs a unique short lowercase id.');
    ids.add(light.id);
    if (light.type != null && light.type !== 'area') throw new Error('Only Area lights are fitted in this milestone.');
    const free = light.free || [];
    if (!Array.isArray(free) || new Set(free).size !== free.length || free.some(k => !Object.hasOwn(PARAMETERS, k))) throw new Error('Free parameters must be unique names from: ' + Object.keys(PARAMETERS).join(', ') + '.');
    const start = {};
    for (const [key, range] of Object.entries(PARAMETERS)) {
      const value = light.start?.[key];
      if (!finite(value) || value < range.lo || value > range.hi) throw new Error(`Light ${light.id}: start ${key} must be a number from ${range.lo} to ${range.hi}.`);
      start[key] = value;
    }
    return { id: light.id, start, free };
  });
  const total = lights.reduce((n, l) => n + l.free.length, 0);
  if (total < 1 || total > MAX_FREE_PARAMETERS) throw new Error(`Fit between 1 and ${MAX_FREE_PARAMETERS} free parameters (got ${total}).`);
  return { lights, free_parameters: total };
}
// Flat search vector <-> fixed-flux plan. The environment is held fixed (black, background taken from the reference border).
function searchSpace(rig, environment) {
  const bounds = [], x0 = [];
  for (const light of rig.lights) for (const key of light.free) bounds.push({ name: `${light.id}.${key}`, ...PARAMETERS[key] }), x0.push(light.start[key]);
  const toPlan = x => {
    let i = 0;
    const lights = rig.lights.map(light => {
      const v = { ...light.start };
      for (const key of light.free) v[key] = x[i++];
      return { type: 'area', role: light.id, az: v.az, el: v.el, d: v.d, w: v.size, h: v.size, gain: v.power };
    });
    return photo.cleanPlan({ title: 'Reconstruction candidate', power_mode: 'physical', lights, environment, shot: { kind: 'hero' } });
  };
  return { bounds, x0, toPlan, names: bounds.map(b => b.name) };
}

function settings(input = {}) {
  const integer = (v, d, lo, hi, what) => { if (v == null) return d; if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`${what} must be an integer from ${lo} to ${hi}.`); return v; };
  if (input.fit_materials === true) throw new Error('Material fitting is not available yet. Materials stay locked.');
  const outline = normalizeMask(input.outline);
  if (!outline || outline.kind !== 'polygon') throw new Error('Draw the product outline (a polygon on the reference) so the product and its surroundings can be scored separately.');
  const camera = input.camera || {};
  const policy = camera.policy || (camera.landmarks ? 'verify' : 'lock');
  if (!['lock', 'verify', 'propose'].includes(policy)) throw new Error('Camera policy must be lock, verify or propose.');
  if (policy !== 'lock' && !(Array.isArray(camera.landmarks) && camera.landmarks.length >= 4)) throw new Error('Verifying or correcting the camera needs at least four landmarks.');
  return {
    rig: rigFrom(input.rig), outline, camera: { policy, landmarks: camera.landmarks || [], tolerance_px: finite(camera.tolerance_px) ? Math.min(60, Math.max(1, camera.tolerance_px)) : 10, free_fov: camera.free_fov === true },   // tolerance: pixels at a 1000-pixel-tall frame
    max_evaluations: integer(input.max_evaluations, MAX_EVALUATIONS, MIN_EVALUATIONS, MAX_EVALUATIONS, 'The evaluation budget'),
    max_seconds: integer(input.max_seconds, 600, 60, 1800, 'The time limit'), search_secs: finite(input.search_secs) ? Math.min(6, Math.max(0.5, input.search_secs)) : 2,
    final_secs: finite(input.final_secs) ? Math.min(20, Math.max(1, input.final_secs)) : 5, patience: integer(input.patience, 8, 3, 20, 'Patience'),
  };
}

// ---- image helpers --------------------------------------------------------------------------------------------------
function toImage(buffer) {
  const png = decode(buffer), rgb = new Float32Array(png.w * png.h * 3);
  for (let y = 0; y < png.h; y++) for (let x = 0; x < png.w; x++) { const p = png.px(x, y); for (let c = 0; c < 3; c++) rgb[(y * png.w + x) * 3 + c] = p[c] / 255; }
  return { w: png.w, h: png.h, rgb };
}
// Box-filter resample (nearest when enlarging) so the reference is compared at the render's size.
function resample(img, w, h) {
  if (img.w === w && img.h === h) return img;
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.floor(x * img.w / w), x1 = Math.max(x0 + 1, Math.floor((x + 1) * img.w / w)), y0 = Math.floor(y * img.h / h), y1 = Math.max(y0 + 1, Math.floor((y + 1) * img.h / h));
    for (let c = 0; c < 3; c++) { let s = 0, n = 0; for (let yy = y0; yy < Math.min(img.h, y1); yy++) for (let xx = x0; xx < Math.min(img.w, x1); xx++) { s += img.rgb[(yy * img.w + xx) * 3 + c]; n++; } out[(y * w + x) * 3 + c] = s / Math.max(1, n); }
  }
  return { w, h, rgb: out };
}
function borderBackground(img) {   // display RGB 0..255 of the frame border: the backdrop estimate (not fitted)
  const samples = [[], [], []]; const t = Math.max(1, Math.round(Math.min(img.w, img.h) * 0.04));
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (x < t || y < t || x >= img.w - t || y >= img.h - t) for (let c = 0; c < 3; c++) samples[c].push(img.rgb[(y * img.w + x) * 3 + c]);
  return samples.map(s => Math.round(255 * s.sort((a, b) => a - b)[Math.floor(s.length / 2)]));
}
const differenceImage = (a, b) => ({ w: a.w, h: a.h, rgb: Float32Array.from(a.rgb, (v, i) => Math.min(1, Math.abs(v - b.rgb[i]) * 3)) });

// ---- residual diagnosis ---------------------------------------------------------------------------------------------
// Advice only: nothing here changes the scene. Thresholds are the objective's own bounded component scales, not calibrated limits.
function diagnose({ product, background, camera, materialsLocked = true }) {
  const out = [];
  const c = product.components, d = product.diagnostics.highlight_counts;
  if (d.reference > d.render) out.push({ kind: 'light_structure', evidence: `reference has ${d.reference} highlights, render ${d.render}`, advice: 'The reference shows more distinct highlights than this rig produces; a different or additional source is needed (outside this milestone).' });
  else if (c.highlights > 0.35) out.push({ kind: camera.verified ? 'geometry_or_light_position' : 'camera_or_geometry', evidence: `highlight loss ${c.highlights.toFixed(2)}`, advice: camera.verified ? 'Camera was verified, so check the CAD variant or the light position.' : 'Highlight positions disagree and the camera was not verified; confirm camera alignment and the CAD variant before adding lights.' });
  if (product.diagnostics.global_tint_shift_suspected) out.push({ kind: 'material_or_white_balance', evidence: `global tint loss ${c.global_tint.toFixed(2)}`, advice: materialsLocked ? 'Overall colour differs; materials are locked, so check the material finish or the photo white balance. Not scored as lighting.' : 'Overall colour differs.' });
  if (c.exposure > 0.3 && c.tone_structure < 0.15) out.push({ kind: 'exposure_albedo_ambiguity', evidence: `exposure loss ${c.exposure.toFixed(2)} with matching tone structure`, advice: 'Overall brightness differs but the light pattern matches; this is ambiguous between light power, material albedo and photo exposure.' });
  if (c.sharpness > 0.3) out.push({ kind: 'focus_or_resolution', evidence: `sharpness loss ${c.sharpness.toFixed(2)}`, advice: 'Edge sharpness differs; check depth of field, render resolution and photo focus.' });
  if (background) {
    if (background.components.shadow > 0.4) out.push({ kind: 'set', evidence: `background shadow loss ${background.components.shadow.toFixed(2)}`, advice: 'Cast-shadow direction or extent differs; a floor, flag or backdrop in the reference may be missing (set elements are a later milestone).' });
    if (background.components.multiscale_tone > 0.3) out.push({ kind: 'environment_or_backdrop', evidence: `background gradient loss ${background.components.multiscale_tone.toFixed(2)}`, advice: 'The backdrop gradient differs; the environment and backdrop are not fitted in this milestone.' });
  }
  if (camera.status === 'locked_unverified') out.push({ kind: 'camera_unverified', evidence: 'no landmarks were supplied', advice: 'The camera was locked as it is without a check; residual highlight error could be a camera error.' });
  return out;
}

// ---- the session -----------------------------------------------------------------------------------------------------
function createReconstructor(deps) {
  const now = deps.now || Date.now;
  const root = deps.root || path.join(__dirname, '..', 'references', '_reconstruct');
  let job = { running: false, phase: 'idle', log: [], result: null }, undo = null, undoJobId = null, controller = null, cameraDecision = null, delivered = null;
  const status = () => { const { promise, ...rest } = job; return { ...rest, canUndo: !!undo }; };
  const note = (phase, message) => { job.phase = phase; job.log.push(message); };
  const check = () => controller.signal.throwIfAborted();
  const sceneChanged = reason => Object.assign(new Error(reason), { sceneChanged: true });

  async function start(input) {
    if (job.running) throw new Error('A reconstruction is already running.');
    let ref, options;
    try { ref = photo.reference(input.image); options = settings(input); } catch (e) { e.status = 400; throw e; }
    const open = [...(deps.receipts?.unresolved() || []), ...(deps.blockers?.() || [])];
    if (open.length) throw Object.assign(new Error('A previous job did not finish. Review it under recovery before starting another.'), { status: 409, recovery: open.map(r => ({ job_id: r.job_id, kind: r.kind, status: r.status })) });
    const id = Date.now() + '_' + crypto.randomBytes(4).toString('hex'), dir = path.join(root, id);
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'reference-original.png'), ref.buf);
    controller = new AbortController(); cameraDecision = null; delivered = null;
    const started = now(), softDeadline = started + options.max_seconds * 850, hardDeadline = started + options.max_seconds * 1000;
    const timer = setTimeout(() => controller.abort(new Error('Reconstruction reached its time limit.')), options.max_seconds * 1000 + 5000); timer.unref?.();
    job = { id, running: true, phase: 'inspecting', log: [], result: null, startedAt: started };
    const execute = async () => {
      let snapshot = null, changed = false, receiptWarning = null, sceneId = null;
      const track = fn => { if (!deps.receipts) return; try { fn(deps.receipts); } catch (e) { receiptWarning = String(e.message || e).slice(0, 160); } };
      try {
        note('inspecting', 'Reading your product, camera, environment and lights.');
        snapshot = await deps.snapshot({ signal: controller.signal }); check();
        sceneId = deps.sceneIdentity ? await deps.sceneIdentity(snapshot) : null;
        const baselineInfo = await deps.baseline?.(snapshot) || {};
        if (deps.receipts) deps.receipts.begin({ job_id: id, kind: 'scene_reconstruction', scene_identity: sceneId, initial_state: photo.persistableSnapshot(snapshot), budget: { ...options, outline: undefined } });
        track(r => r.recordOperation(id, { op: 'baseline_recorded', ok: true, detail: JSON.stringify(baselineInfo).slice(0, 250) }));

        // ---- R01: reproducible baseline: two renders of the untouched scene give render time and repeat variation ----
        const renders = { baseline: 0, fit: 0, after: 0 }, timings = [];
        const grab = async (file, secs) => { check(); const t0 = now(); await deps.capture(file, ref.aspect, secs, controller.signal); const ms = now() - t0; check(); return { image: toImage(fs.readFileSync(file)), ms }; };
        note('measuring', 'Rendering the unchanged scene twice to measure render time and variation.');
        const b1 = await grab(path.join(dir, 'before.png'), options.search_secs); renders.baseline++; timings.push(b1.ms);
        const b2 = await grab(path.join(dir, 'before-repeat.png'), options.search_secs); renders.baseline++; timings.push(b2.ms);
        const renderMs = timings.reduce((a, b) => a + b, 0) / timings.length;
        const grid = { w: b1.image.w, h: b1.image.h };
        if (b2.image.w !== grid.w || b2.image.h !== grid.h) throw new Error('Repeated renders have different sizes; the render setup is unstable.');
        const referenceImage = resample(toImage(ref.buf), grid.w, grid.h);
        const productMask = rasterize(options.outline, grid.w, grid.h);
        const regionScore = img => objectives.scoreRegions(referenceImage, img, { productMask });
        const repeatVariation = objectives.scoreRegions(b1.image, b2.image, { productMask }).combined;
        fs.writeFileSync(path.join(dir, 'reference.png'), encodeRgb(referenceImage));
        const beforeScore = regionScore(b1.image);
        const environment = { hdri: undefined, brightness: 0, background: borderBackground(referenceImage), ground_shadows: true, ground_reflections: false };
        const space = searchSpace(options.rig, environment);

        // ---- R03 budget: evaluations are capped by count AND by what the time limit can pay for ----
        const perEvaluationMs = renderMs * 1.1 + 300;
        const affordable = Math.floor((softDeadline - now()) / perEvaluationMs);
        const evaluationCap = Math.min(options.max_evaluations, affordable);
        const budget = { evaluations_requested: options.max_evaluations, evaluations_affordable: affordable, evaluation_cap: evaluationCap, render_ms_mean: Math.round(renderMs), repeat_variation: repeatVariation };
        if (evaluationCap < MIN_EVALUATIONS) {
          job.result = { id, outcome: 'insufficient_budget', budget, message: `Renders take about ${Math.round(renderMs)} ms; the time limit allows only ${affordable} evaluations (minimum ${MIN_EVALUATIONS}). Nothing was changed.` };
          track(r => { r.setRestore(id, 'not_needed', 'No scene change was made.'); r.finish(id, 'complete'); });
          note('complete', job.result.message); return;
        }
        const startedFit = now();

        // ---- R02: camera stage ----
        note('camera', 'Locking the camera.');
        const pose0 = await deps.readPose(); check();
        const poseHash = p => crypto.createHash('sha256').update(JSON.stringify([p.az, p.el, p.dist, p.fov, p.pivot].map(v => Array.isArray(v) ? v.map(n => +n.toFixed(3)) : +v.toFixed(3)))).digest('hex').slice(0, 16);
        const cameraReport = { policy: options.camera.policy, status: 'locked_unverified', pose: pose0, hash: poseHash(pose0), verified: false };
        if (options.camera.policy !== 'lock') {
          const frameHeight = 1000, landmarks = options.camera.landmarks;   // camera error is reported at a fixed 1000 px frame height, whatever size the previews are
          const conditioningCheck = alignment.conditioning(landmarks);
          if (!conditioningCheck.ok) throw Object.assign(new Error('Camera landmarks cannot constrain a pose: ' + conditioningCheck.refusals.join(' ')), { incompatible: true });
          const before = alignment.reprojectionReport(pose0, landmarks, ref.aspect, { height: frameHeight });
          cameraReport.reprojection = { rms_px: before.rms_px, max_px: before.max_px, warnings: conditioningCheck.warnings };
          if (before.rms_px <= options.camera.tolerance_px) Object.assign(cameraReport, { status: 'verified', verified: true });
          else {
            const heldOut = landmarks.filter((_, i) => i % 3 === 2).map(l => l.id);
            const fit = await alignment.fitPose({ initialPose: pose0, landmarks, aspect: ref.aspect, heldOut, free: options.camera.free_fov ? ['az', 'el', 'dist', 'fov'] : ['az', 'el', 'dist'], height: frameHeight });
            const held = fit.held_out || fit.after;
            cameraReport.proposal = { pose: fit.pose, rms_px_before: before.rms_px, rms_px_after: fit.after.rms_px, held_out_rms_px: held.rms_px, warnings: fit.warnings };
            if (held.rms_px > options.camera.tolerance_px) throw Object.assign(new Error(`The reference does not fit this product and camera: held-out landmark error stays at ${held.rms_px.toFixed(1)} px after fitting (tolerance ${options.camera.tolerance_px} px). Check the CAD variant, lens shift or crop. No lights were changed.`), { incompatible: true });
            if (options.camera.policy === 'propose') {
              cameraReport.status = 'correction_proposed'; job.camera = cameraReport;
              note('awaiting_camera', 'The camera needs a small correction. Review it and accept or decline.');
              const accepted = await new Promise((resolve, reject) => { cameraDecision = resolve; controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }); });
              cameraDecision = null; check();
              if (accepted) {
                changed = true; track(r => r.setRestore(id, 'pending', 'Camera correction is being applied.'));
                await deps.applyPose(fit.pose); check(); track(r => r.recordOperation(id, { op: 'camera_corrected', ok: true }));
                const now = await deps.readPose(); Object.assign(cameraReport, { status: 'corrected', verified: true, pose: now, hash: poseHash(now) });
              } else cameraReport.status = 'correction_declined';
            } else Object.assign(cameraReport, { status: 'needs_correction' });
          }
        }
        job.camera = cameraReport;
        track(r => r.recordOperation(id, { op: 'camera_locked', ok: true, detail: `${cameraReport.status} ${cameraReport.hash}` }));
        const lockedHash = cameraReport.hash;

        // ---- R03: the fit ----
        note('fitting', `Fitting ${options.rig.free_parameters} light parameters within ${evaluationCap} evaluations.`);
        changed = true; track(r => r.setRestore(id, 'pending', 'Lighting changes are being applied.'));
        const declareOwned = item => track(r => r.recordOwned(id, { ...item, evidence: 'declared' }));
        const details = [];
        let applied = false, evaluationCount = 0;
        const guard = async () => {
          if (deps.sceneIdentity && await deps.sceneIdentity(null) !== sceneId) throw sceneChanged('The open scene changed while fitting.');
          const pose = await deps.readPose(); if (poseHash(pose) !== lockedHash) throw sceneChanged('The camera moved while fitting.');
        };
        // Searching stops early enough to leave time to re-validate finalists, using the measured cost of one evaluation.
        const evaluationMs = [];
        const reserveMs = () => 4 * 1.3 * (evaluationMs.length ? evaluationMs.reduce((a, b) => a + b, 0) / evaluationMs.length : perEvaluationMs);
        const evaluate = async (x, ctx) => {
          check();
          const limit = ctx.stage === 'search' ? Math.min(softDeadline, hardDeadline - reserveMs()) : hardDeadline;
          const evaluationStart = now();
          if (now() > limit) throw Object.assign(new Error('Time limit reached.'), { budget: true });
          const plan = space.toPlan(x);
          const t0 = now();
          if (!applied) { await deps.apply(plan, { framing: false, aspect: ref.aspect, id, signal: controller.signal, declareOwned }); applied = true; }
          else if (deps.update) await deps.update(plan, { aspect: ref.aspect, id, signal: controller.signal });
          else await deps.apply(plan, { framing: false, aspect: ref.aspect, id, signal: controller.signal, declareOwned });
          const applyMs = now() - t0;
          const shot = await grab(path.join(dir, 'candidate.png'), ctx.quality === 'final' ? options.final_secs : options.search_secs); renders.fit++; evaluationCount++;
          if (shot.image.w !== grid.w || shot.image.h !== grid.h) { details.push({ x, invalid: 'render size changed' }); return Infinity; }
          const s = regionScore(shot.image);
          evaluationMs.push(now() - evaluationStart);
          details.push({ x: x.slice(), quality: ctx.quality, stage: ctx.stage, combined: s.combined, product: s.product.total, background: s.background?.total ?? null, render_ms: shot.ms, apply_ms: applyMs });
          job.progress = { evaluations: evaluationCount, cap: evaluationCap, best: Math.min(...details.filter(d => Number.isFinite(d.combined)).map(d => d.combined)) };
          if (evaluationCount % 5 === 0) await guard();
          return s.combined;
        };
        const result = await optimize({ x0: space.x0, bounds: space.bounds, evaluate, budget: evaluationCap, method: 'coordinate', baselineRepeats: 3, finalists: 2, finalistRepeats: 2, z: 2, floor: 0.004,
          signal: controller.signal, searchOptions: { step0: 0.12, patience: options.patience } });
        await guard();

        // ---- keep the best valid state: the fitted rig only if it beats the untouched scene by more than the measured noise ----
        const finalX = result.accepted ? result.x : space.x0;
        const finalPlan = space.toPlan(finalX);
        await (deps.update ? deps.update(finalPlan, { aspect: ref.aspect, id, signal: controller.signal }) : deps.apply(finalPlan, { framing: false, aspect: ref.aspect, id, signal: controller.signal, declareOwned })); check();
        const after = await grab(path.join(dir, 'after.png'), options.final_secs); renders.after++;
        const afterScore = regionScore(after.image);
        const noiseMargin = Math.max(0.004, 2 * Math.max(repeatVariation, result.baseline.sd));
        const improvedOverOriginal = beforeScore.combined - afterScore.combined > noiseMargin;
        fs.writeFileSync(path.join(dir, 'difference.png'), encodeRgb(differenceImage(referenceImage, after.image)));
        const diagnosis = diagnose({ product: afterScore.product, background: afterScore.background, camera: cameraReport });
        const report = {
          id, outcome: improvedOverOriginal ? 'improved' : 'unchanged', kept: improvedOverOriginal ? 'fitted_lighting' : 'original_scene',
          scores: { before: { combined: beforeScore.combined, product: beforeScore.product.total, background: beforeScore.background?.total ?? null },
            after: { combined: afterScore.combined, product: afterScore.product.total, background: afterScore.background?.total ?? null },
            components: { before: beforeScore.product.components, after: afterScore.product.components, background_after: afterScore.background?.components ?? null },
            note: afterScore.note },
          required_improvement: noiseMargin, camera: cameraReport, diagnosis, materials: { locked: true, geometry_changed: false },
          budget: { ...budget, evaluations_used: evaluationCount, stop_reason: result.stop_reason, renders, renders_total: renders.baseline + renders.fit + renders.after,
            fit_seconds: +((now() - startedFit) / 1000).toFixed(1), noise: { baseline_sd: result.baseline.sd, baseline_mean: result.baseline.mean, repeat_variation: repeatVariation } },
          search: { method: result.method, accepted: result.accepted, reason: result.reason, finalists: result.finalists, parameters: space.names, start: space.x0, best: result.x, trace: details.slice(0, 60) },
          power_mode: 'physical', plan: finalPlan, receipt_warning: receiptWarning,
        };
        if (!improvedOverOriginal) {
          note('restoring', 'The fitted lighting did not beat the original scene beyond render noise; restoring the original.');
          await deps.restore(snapshot); track(r => r.setRestore(id, 'complete', 'Original scene kept: no measured improvement.'));
          changed = false;
        } else {
          undo = snapshot; undoJobId = id;
          track(r => { r.acceptRecipe(id, { plan: finalPlan, scores: report.scores, parameters: space.names, best: result.x }, 'final'); r.setRestore(id, 'available', 'Session undo is available; a receipt restore is offered only for the same scene.'); });
        }
        fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
        fs.writeFileSync(path.join(dir, 'recipe.json'), JSON.stringify({ power_mode: 'physical', plan: finalPlan, parameters: space.names, values: finalX, camera: cameraReport.hash, materials_locked: true }, null, 2));
        track(r => r.finish(id, 'complete'));
        job.result = report;
        note('complete', improvedOverOriginal ? 'Improved lighting applied. Compare before and after, then save only if you want to.' : 'No measured improvement; your original lighting was restored.');
      } catch (e) {
        job.error = e.message;
        if (changed && snapshot && !e.sceneChanged) {
          note('restoring', 'Restoring the scene from before this job.');
          try { await deps.restore(snapshot); track(r => r.setRestore(id, 'complete', 'Restored after ' + (controller.signal.aborted ? 'cancellation' : 'failure') + '.')); }
          catch (restoreError) { undo = snapshot; undoJobId = id; job.error += ' Restoration needs retry: ' + restoreError.message; track(r => r.setRestore(id, 'failed', restoreError.message)); }
        } else if (e.sceneChanged) {
          track(r => r.setRestore(id, 'failed', 'Stopped without restoring: ' + e.message));
          job.error += ' Nothing was restored automatically because the scene is no longer the one this job started with. Review it under recovery.';
        } else track(r => { if (r.get(id)?.restore.status === 'pending') r.setRestore(id, 'not_needed', 'No scene change was made.'); });
        track(r => { if (r.get(id) && r.get(id).status === 'running') r.finish(id, controller.signal.aborted ? 'canceled' : 'failed'); });
        job.phase = e.incompatible ? 'reference_incompatible' : e.sceneChanged ? 'stopped_scene_changed' : controller.signal.aborted ? 'canceled' : 'failed';
        job.log.push(job.error);
      } finally { clearTimeout(timer); job.running = false; deps.refresh?.(); }
    };
    job.promise = execute();
    return { id, started: true };
  }

  const { recovery, resolveRecovery } = createRecovery({ receipts: deps.receipts, sceneIdentity: deps.sceneIdentity, inventory: deps.inventory, restore: deps.restore, refresh: deps.refresh,
    label: 'reconstruction', isBusy: () => job.running, setBusy: v => { job.running = v; }, isCurrent: id => job.running && job.id === id,
    onRestored: id => { if (undoJobId === id) { undo = null; undoJobId = null; } } });

  // Explicit native save. Never part of a fit. Paths must be new; the BIP route may retarget the open document, so it needs an acknowledgement.
  async function deliver({ bip = null, ksp = null, acknowledge_save_as = false } = {}) {
    if (job.running) throw Object.assign(new Error('Wait for the reconstruction to finish before saving.'), { status: 409 });
    if (!job.id || job.result?.outcome !== 'improved') throw Object.assign(new Error('There is no improved reconstruction to save. Run one first; an unchanged scene needs no export.'), { status: 409 });
    if (!bip && !ksp) throw Object.assign(new Error('Choose a .bip scene path, a .ksp package path, or both.'), { status: 400 });
    if (bip && !acknowledge_save_as) throw Object.assign(new Error('Saving a .bip may make KeyShot treat the new file as the open scene (Save As). Confirm with acknowledge_save_as, or save a .ksp package instead.'), { status: 400 });
    const clean = (p, ext) => {
      if (typeof p !== 'string' || !path.isAbsolute(p) || path.extname(p).toLowerCase() !== ext || p.length > 400 || p.includes('\0')) throw Object.assign(new Error(`Use an absolute path ending in ${ext}.`), { status: 400 });
      if (fs.existsSync(p)) throw Object.assign(new Error(`${p} already exists. Director never overwrites a scene file; choose a new name.`), { status: 409 });
      if (!fs.existsSync(path.dirname(p))) throw Object.assign(new Error('The destination folder does not exist.'), { status: 400 });
      return p;
    };
    const targets = { ...(bip ? { bip: clean(bip, '.bip') } : {}), ...(ksp ? { ksp: clean(ksp, '.ksp') } : {}) };
    const recorded = deps.receipts?.get(job.id)?.scene_identity;
    if (deps.sceneIdentity && recorded && await deps.sceneIdentity(null) !== recorded) throw Object.assign(new Error('The open scene is not the one this reconstruction changed. Nothing was saved.'), { status: 409 });
    const saved = await deps.saveScene(targets);
    const verified = {};
    for (const [kind, file] of Object.entries(targets)) {
      const stat = fs.existsSync(file) ? fs.statSync(file) : null;
      verified[kind] = { path: file, bytes: stat?.size ?? 0, exists: !!stat && stat.size > 0 };
    }
    const ok = Object.values(verified).every(v => v.exists);
    try { deps.receipts?.recordOperation(job.id, { op: 'native_save', ok, detail: JSON.stringify(Object.fromEntries(Object.entries(verified).map(([k, v]) => [k, v.bytes]))) }); } catch { /* advisory */ }
    delivered = { saved, verified, ok, open_scene_changed: saved?.scene_file_before !== saved?.scene_file_after,
      note: ok ? 'Files exist and are non-empty. Reopening them in a clean KeyShot session is the real check and has not been done.' : 'KeyShot reported success but a file is missing or empty.' };
    return delivered;
  }

  return {
    status, start, recovery, resolveRecovery, deliver,
    stop: () => controller?.abort(new Error('Reconstruction canceled.')),
    async wait() { await job.promise; return status(); },
    confirmCamera(accept) { if (!cameraDecision) throw Object.assign(new Error('No camera correction is waiting for a decision.'), { status: 409 }); cameraDecision(accept === true); return { decided: accept === true }; },
    async undo() {
      if (job.running) throw new Error('Stop the reconstruction before restoring.'); if (!undo) throw new Error('No previous reconstruction to restore.');
      job.running = true;
      try { await deps.restore(undo); try { deps.receipts?.setRestore(undoJobId, 'complete', 'Restored by session undo.'); } catch { /* advisory */ } undo = null; undoJobId = null; job.phase = 'restored'; job.log.push('Previous lighting, environment and camera restored.'); deps.refresh?.(); return { restored: true }; }
      finally { job.running = false; }
    },
    file(id, slot) {
      if (!/^\d+_[a-f0-9]{8}$/.test(id || '') || !['reference', 'before', 'after', 'difference', 'report', 'recipe'].includes(slot)) throw new Error('Unknown reconstruction output.');
      return path.join(root, id, slot + (['report', 'recipe'].includes(slot) ? '.json' : '.png'));
    },
  };
}

module.exports = { createReconstructor, settings, rigFrom, searchSpace, diagnose, resample, borderBackground, toImage, PARAMETERS, DEFAULT_RIG, MAX_FREE_PARAMETERS, MAX_EVALUATIONS, MIN_EVALUATIONS };
