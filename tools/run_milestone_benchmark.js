// Milestone 1 benchmark: the CURRENT workflow (photo director loop with a stand-in vision policy) against the reconstruction
// session, on controlled synthetic scenes with known ground truth, at equal TOTAL render budgets and at the session default.
//   node tools/run_milestone_benchmark.js [--json]
// Everything is synthetic: a deterministic renderer and an invented vision policy with a persistent misreading. It shows how the
// pieces behave together and where they differ; it is not evidence about KeyShot, real vision or real photographs.
const harness = require('./reconstruction_harness');
const synthetic = require('./synthetic_renderer');
const objectives = require('../server/lighting-objectives');
const { rasterize, normalizeMask } = require('../server/image-mask');
const { createReconstructor } = require('../server/reconstruction');
const { createFixture, OUTLINE, image } = require('./reconstruction_fixture');

// [key azimuth, key elevation, key gain, fill gain]; the fill source stays at azimuth 60, elevation 10 (as in the harness).
const SCENES = [
  { id: 'S1 three-quarter key', truth: [-40, 45, 1.0, 0.25], scene: {} },
  { id: 'S2 key from the right', truth: [50, 35, 1.2, 0.30], scene: {} },
  { id: 'S3 raking low key', truth: [-75, 12, 1.4, 0.15], scene: {} },
  { id: 'S4 top light', truth: [10, 75, 0.9, 0.40], scene: {} },
  { id: 'S5 back rim', truth: [140, 25, 1.1, 0.30], scene: {} },
  { id: 'S6 turned camera', truth: [-40, 45, 1.0, 0.25], scene: { yaw: 20 } },
];
const SEEDS = [1, 2];
const TOTAL_BUDGETS = [12, 16];   // total renders, including the baseline and after renders a session needs
const DEFAULT_CAP = 40;

const mask = size => rasterize(normalizeMask({ points: OUTLINE.points }), size, size);
// Held-out: fresh noise seed at final quality, same view and a turned view that neither method fitted against.
function heldOut(rig, { truth, scene, seed }) {
  const reference = synthetic.render(harness.toRig(truth), { scene, seed: 41000 + seed, quality: 'final' });
  const same = synthetic.render(rig, { scene, seed: 42000 + seed, quality: 'final' });
  const turnedScene = { ...scene, yaw: (scene.yaw || 0) + 25 };
  const turnedReference = synthetic.render(harness.toRig(truth), { scene: turnedScene, seed: 43000 + seed, quality: 'final' });
  const turned = synthetic.render(rig, { scene: turnedScene, seed: 44000 + seed, quality: 'final' });
  const m = mask(reference.w), a = objectives.scoreRegions(reference, same, { productMask: m }), b = objectives.scoreRegions(turnedReference, turned, { productMask: m });
  // RMSE in display space is not part of either method's objective, so it is an independent cross-check on the objective itself.
  const rmse = Math.sqrt(reference.rgb.reduce((n, v, i) => n + (v - same.rgb[i]) ** 2, 0) / reference.rgb.length);
  return { combined: a.combined, product: a.product.total, background: a.background.total, turned: b.combined, rmse };
}
const rigOfX = x => harness.toRig(x);

async function session({ truth, scene, seed, start, cap }) {
  const fixture = createFixture({ truth: harness.toRig(truth), scene, original: { lights: [{ az: 0, el: 30, gain: 0.5 }] } });
  try {
    const reconstructor = createReconstructor(fixture.deps);
    const rig = { lights: [
      { id: 'key', start: { az: start[0], el: start[1], d: 3, size: 2, power: start[2] }, free: ['az', 'el', 'power'] },
      { id: 'fill', start: { az: 60, el: 10, d: 3.5, size: 2.5, power: start[3] }, free: ['power'] }] };
    await reconstructor.start({ image: image(fixture.referenceFor(harness.toRig(truth), { seed: 9000 + seed })), outline: OUTLINE, rig, max_evaluations: cap });
    const status = await reconstructor.wait();
    if (status.phase !== 'complete') throw new Error('session failed: ' + status.error);
    return { rig: fixture.state.rig, renders: status.result.budget.renders_total, used: status.result.budget.evaluations_used, stop: status.result.budget.stop_reason, outcome: status.result.outcome };
  } finally { fixture.cleanup(); }
}

async function main() {
  const cases = [];
  for (const spec of SCENES) for (const seed of SEEDS) {
    const vision = { independent: await harness.runVisionLoop({ truth: spec.truth, seed, scene: spec.scene }), local: await harness.runVisionLoop({ truth: spec.truth, seed, scene: spec.scene, mode: 'local' }) };
    const start = vision.independent.start;
    const row = { scene: spec.id, seed, start: heldOut(rigOfX(start), { ...spec, seed }),
      director: Object.fromEntries(Object.entries(vision).map(([k, v]) => [k, { ...heldOut(v.rig || rigOfX(start), { ...spec, seed }), renders: v.renders }])), session: {} };
    for (const total of TOTAL_BUDGETS) { const s = await session({ ...spec, seed, start, cap: Math.max(9, total - 3) }); row.session['total' + total] = { ...heldOut(s.rig, { ...spec, seed }), renders: s.renders, used: s.used, outcome: s.outcome }; }
    const full = await session({ ...spec, seed, start, cap: DEFAULT_CAP }); row.session.default = { ...heldOut(full.rig, { ...spec, seed }), renders: full.renders, used: full.used, stop: full.stop, outcome: full.outcome };
    cases.push(row);
  }
  const mean = list => list.reduce((n, v) => n + v, 0) / list.length, sd = list => { const m = mean(list); return Math.sqrt(list.reduce((n, v) => n + (v - m) ** 2, 0) / Math.max(1, list.length - 1)); };
  const pick = (k, f) => cases.map(c => f(c));
  const methods = [
    ['Start (first vision estimate)', c => c.start], ['Current matcher, fresh estimates', c => c.director.independent], ['Current matcher, local steps', c => c.director.local],
    ...TOTAL_BUDGETS.map(t => [`Reconstruction session, ${t} total renders`, c => c.session['total' + t]]), [`Reconstruction session, default cap ${DEFAULT_CAP}`, c => c.session.default]];
  const lines = ['| Method | Mean renders | Combined | Product | Background | Turned view | Pixel RMSE (independent) | Combined spread (sd) |', '|---|---|---|---|---|---|---|---|'];
  for (const [label, f] of methods) {
    const rows = cases.map(f);
    lines.push(`| ${label} | ${rows[0].renders ? mean(rows.map(r => r.renders ?? 1)).toFixed(1) : '1'} | ${mean(rows.map(r => r.combined)).toFixed(3)} | ${mean(rows.map(r => r.product)).toFixed(3)} | ${mean(rows.map(r => r.background)).toFixed(3)} | ${mean(rows.map(r => r.turned)).toFixed(3)} | ${mean(rows.map(r => r.rmse)).toFixed(3)} | ${sd(rows.map(r => r.combined)).toFixed(3)} |`);
  }
  const wins = t => cases.filter(c => c.session['total' + t].combined < Math.min(c.director.independent.combined, c.director.local.combined)).length;
  const scenes = ['| Scene (seed) | Start | Matcher (fresh) | Matcher (local) | Session, 12 total | Session, 16 total | Session, default (used / stop) |', '|---|---|---|---|---|---|---|',
    ...cases.map(c => `| ${c.scene} (${c.seed}) | ${c.start.combined.toFixed(3)} | ${c.director.independent.combined.toFixed(3)} | ${c.director.local.combined.toFixed(3)} | ${c.session.total12.combined.toFixed(3)} | ${c.session.total16.combined.toFixed(3)} | ${c.session.default.combined.toFixed(3)} (${c.session.default.used} / ${c.session.default.stop}) |`)];
  if (process.argv.includes('--json')) return console.log(JSON.stringify({ cases }, null, 2));
  console.log(`Controlled synthetic scenes: ${SCENES.length} x seeds ${SEEDS.join(', ')} = ${cases.length} cases. Lower is better; every score is held-out (fresh noise, product outline mask).\n`);
  console.log(lines.join('\n')); console.log('\nPer case (combined, held-out):\n'); console.log(scenes.join('\n'));
  console.log(`\nSession beat the better of the two matcher variants in ${wins(12)} of ${cases.length} cases at 12 total renders and ${wins(16)} of ${cases.length} at 16.`);
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { SCENES, heldOut, session, main };
