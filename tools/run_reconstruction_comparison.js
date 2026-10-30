// Prints the synthetic equal-budget comparison table (research E07/E13, offline half). Deterministic for fixed seeds.
//   node tools/run_reconstruction_comparison.js
// Synthetic renderer and a stand-in "vision" with a persistent bias only: this characterises the harness and the solver, not KeyShot.
const harness = require('./reconstruction_harness');

(async () => {
  const seeds = [1, 2, 3, 4, 5, 6], budgets = [12, 24, 48];
  const rows = [];
  const add = (label, budget, x, renders, seed) => rows.push({ label, budget, renders, seed, ...harness.heldOut(x, { seed }) });
  for (const seed of seeds) {
    const independent = await harness.runVisionLoop({ seed }), local = await harness.runVisionLoop({ seed, mode: 'local' });
    add('start (first vision estimate)', 0, independent.start, 1, seed);
    add('vision loop, fresh estimates', independent.renders, independent.x || independent.start, independent.renders, seed);
    add('vision loop, local steps', local.renders, local.x || local.start, local.renders, seed);
    for (const budget of budgets) for (const method of ['coordinate', 'powell']) {
      const r = await harness.runSolver({ seed, budget, method });
      add(`solver (${method})`, budget, r.x, r.renders, seed);
    }
  }
  const mean = (list, key) => list.reduce((n, r) => n + (typeof key === 'function' ? key(r) : r[key]), 0) / list.length;
  const groups = [...new Set(rows.map(r => `${r.label}|${r.budget}`))];
  const lines = ['| Method | Renders | Held-out objective (same view) | Held-out objective (turned view) | RMSE | Key azimuth error (deg) | Key elevation error (deg) |', '|---|---|---|---|---|---|---|'];
  for (const g of groups) {
    const list = rows.filter(r => `${r.label}|${r.budget}` === g);
    lines.push(`| ${list[0].label} | ${mean(list, 'renders').toFixed(0)} | ${mean(list, 'objective_same_view').toFixed(3)} | ${mean(list, 'objective_held_out_view').toFixed(3)} | ${mean(list, 'rmse_same_view').toFixed(3)} | ${mean(list, r => r.parameter_error.key_az_deg).toFixed(1)} | ${mean(list, r => r.parameter_error.key_el_deg).toFixed(1)} |`);
  }
  console.log(`Seeds: ${seeds.join(', ')}. Lower objective is better. Synthetic renderer and stand-in vision only.\n`);
  console.log(lines.join('\n'));
})().catch(error => { console.error(error); process.exit(1); });
