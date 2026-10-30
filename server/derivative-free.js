// Small derivative-free optimizers written in plain JS, driven through an INJECTED async `evaluate` so they never touch a
// renderer themselves. EXPERIMENTAL (research E07/E13): validated only against a synthetic renderer; not wired into the app.
// Parameters are bounded; each is optimized in a normalized [0, 1] coordinate (optionally on a log scale). Lower score is better.
// Every evaluation is counted against a hard budget, because in KeyShot each one is a real render.

const clamp01 = v => Math.min(1, Math.max(0, v));
function space(bounds) {
  if (!Array.isArray(bounds) || !bounds.length) throw new Error('At least one bounded parameter is required.');
  for (const b of bounds) if (!(Number.isFinite(b.lo) && Number.isFinite(b.hi) && b.hi > b.lo) || (b.log && b.lo <= 0)) throw new Error(`Invalid bounds for ${b.name || 'parameter'}.`);
  const forward = (b, v) => b.log ? (Math.log(v) - Math.log(b.lo)) / (Math.log(b.hi) - Math.log(b.lo)) : (v - b.lo) / (b.hi - b.lo);
  const inverse = (b, u) => b.log ? Math.exp(Math.log(b.lo) + clamp01(u) * (Math.log(b.hi) - Math.log(b.lo))) : b.lo + clamp01(u) * (b.hi - b.lo);
  return {
    toUnit: x => x.map((v, i) => clamp01(forward(bounds[i], Math.min(bounds[i].hi, Math.max(bounds[i].lo, v))))),
    // `wrap` parameters (angles) are reduced into [lo, hi) before evaluation by the caller; the search itself stays bounded.
    toReal: u => u.map((v, i) => inverse(bounds[i], v)),
  };
}
function mean(values) { return values.reduce((n, v) => n + v, 0) / values.length; }
function sd(values) { if (values.length < 2) return 0; const m = mean(values); return Math.sqrt(values.reduce((n, v) => n + (v - m) ** 2, 0) / (values.length - 1)); }

// A hard-budgeted, recorded evaluation wrapper. `score` must be a finite number or { score, ... }.
function meter(evaluate, budget, signal) {
  const log = [];
  const run = async (x, context = {}) => {
    signal?.throwIfAborted();
    if (log.length >= budget) { const e = new Error('Evaluation budget exhausted.'); e.budget = true; throw e; }
    const raw = await evaluate(x, { index: log.length, ...context });
    const score = typeof raw === 'number' ? raw : raw?.score;
    const entry = { index: log.length, x: x.slice(), score: Number.isFinite(score) ? score : Infinity, stage: context.stage || 'search', ...(Number.isFinite(score) ? {} : { invalid: true }) };
    log.push(entry);
    return entry.score;
  };
  return { run, log, remaining: () => budget - log.length };
}

// Compass / pattern search: try +/- step along each coordinate; shrink when no coordinate improves.
async function coordinateSearch({ x0, bounds, evaluate, budget, step0 = 0.2, minStep = 0.01, shrink = 0.5, margin = 0, signal, startScore = null, onlyAfter = null }) {
  const sp = space(bounds), m = meter(evaluate, budget, signal);
  let u = sp.toUnit(x0), step = step0;
  let best = startScore ?? await m.run(sp.toReal(u), { stage: 'search' });
  let converged = false;
  try {
    while (step >= minStep) {
      let improved = false;
      for (let i = 0; i < u.length; i++) for (const direction of [1, -1]) {
        const trial = u.slice(); trial[i] = clamp01(u[i] + direction * step);
        if (trial[i] === u[i]) continue;
        const score = await m.run(sp.toReal(trial), { stage: 'search', coordinate: bounds[i].name || i, step });
        if (best - score > margin) { u = trial; best = score; improved = true; break; }
      }
      if (!improved) step *= shrink;
    }
    converged = true;
  } catch (error) { if (!error.budget) throw error; }
  return { method: 'coordinate', x: sp.toReal(u), score: best, evaluations: m.log, converged, step };
}

// Powell-style conjugate direction search with a bounded golden-section line search. Directions live in unit space.
async function powellSearch({ x0, bounds, evaluate, budget, lineEvaluations = 10, sweeps = 8, tolerance = 1e-4, signal, margin = 0 }) {
  const sp = space(bounds), m = meter(evaluate, budget, signal), n = bounds.length;
  let u = sp.toUnit(x0), best = await m.run(sp.toReal(u), { stage: 'search' });
  let directions = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 1 : 0));
  const phi = (Math.sqrt(5) - 1) / 2;
  const along = (start, d, t) => start.map((v, i) => clamp01(v + t * d[i]));
  let reach = 0.5;   // half-width of the line-search interval in unit space; narrows every sweep so late sweeps refine
  async function lineMinimize(start, d, fStart) {
    // admissible t so the whole segment stays inside the unit box
    let lo = -Infinity, hi = Infinity;
    for (let i = 0; i < n; i++) if (d[i] !== 0) { const a = (0 - start[i]) / d[i], b = (1 - start[i]) / d[i]; lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b)); }
    if (!(hi - lo > 1e-9)) return { t: 0, f: fStart };
    let a = Math.max(lo, -reach), b = Math.min(hi, reach);
    let c = b - phi * (b - a), dd = a + phi * (b - a), used = 0;
    const eval1 = t => { used++; return m.run(sp.toReal(along(start, d, t)), { stage: 'search', line: true }); };
    let fc = await eval1(c), fd = await eval1(dd);
    while (used < lineEvaluations && Math.abs(b - a) > tolerance) {
      if (fc < fd) { b = dd; dd = c; fd = fc; c = b - phi * (b - a); fc = await eval1(c); }
      else { a = c; c = dd; fc = fd; dd = a + phi * (b - a); fd = await eval1(dd); }
    }
    const t = fc < fd ? c : dd, f = Math.min(fc, fd);
    return f < fStart - margin ? { t, f } : { t: 0, f: fStart };
  }
  let converged = false;
  try {
    for (let sweep = 0; sweep < sweeps; sweep++) {
      reach = Math.max(0.01, 0.5 * Math.pow(0.55, sweep));
      const start = u.slice(), fStart = best;
      let biggest = 0, biggestDrop = 0;
      for (let i = 0; i < directions.length; i++) {
        const before = best, r = await lineMinimize(u, directions[i], best);
        if (r.t !== 0) { u = along(u, directions[i], r.t); best = r.f; }
        if (before - best > biggestDrop) { biggestDrop = before - best; biggest = i; }
      }
      const move = u.map((v, i) => v - start[i]);
      if (Math.hypot(...move) < tolerance || fStart - best < 1e-12) { converged = true; break; }
      const length = Math.hypot(...move), unitMove = move.map(v => v / length);
      const r = await lineMinimize(u, unitMove, best);
      if (r.t !== 0) { u = along(u, unitMove, r.t); best = r.f; }
      directions = directions.map((d, i) => i === biggest ? unitMove : d);   // replace the direction that helped most
    }
  } catch (error) { if (!error.budget) throw error; }
  return { method: 'powell', x: sp.toReal(u), score: best, evaluations: m.log, converged };
}

// Repeat-noise estimation and finalist re-validation around either search.
function summarizeRepeats(values) { const finite = values.filter(Number.isFinite); return { n: finite.length, mean: finite.length ? mean(finite) : NaN, sd: sd(finite) }; }

async function optimize({ x0, bounds, evaluate, budget, method = 'coordinate', baselineRepeats = 3, finalists = 2, finalistRepeats = 2, z = 2, floor = 0, signal, searchOptions = {} }) {
  if (!Number.isInteger(budget) || budget < 1) throw new Error('A positive integer evaluation budget is required.');
  const reserve = finalists * finalistRepeats, baselineN = Math.max(1, baselineRepeats);
  if (budget < baselineN + reserve + 2) throw new Error('The budget is too small for baseline repeats, a search and finalist validation.');
  const trace = [];
  const guarded = async (x, context) => { signal?.throwIfAborted(); const raw = await evaluate(x, context); const score = typeof raw === 'number' ? raw : raw?.score; trace.push({ x: x.slice(), score, stage: context?.stage }); return score; };
  const baselineScores = [];
  for (let i = 0; i < baselineN; i++) baselineScores.push(await guarded(x0, { stage: 'baseline', quality: 'search', repeat: i }));
  const baseline = summarizeRepeats(baselineScores);
  const searchBudget = budget - baselineN - reserve;
  const margin = Math.max(floor / 2, z * baseline.sd);   // do not accept steps that pure render noise could produce
  const search = method === 'powell' ? powellSearch : coordinateSearch;
  const found = await search({ x0, bounds, evaluate: (x, c) => guarded(x, { ...c, quality: 'search' }), budget: searchBudget, signal, margin, startScore: method === 'powell' ? undefined : baseline.mean, ...searchOptions });
  // distinct finalists: best few search points, always including nothing that equals the baseline point
  const unique = [], seen = new Set();
  for (const e of [...found.evaluations].filter(e => Number.isFinite(e.score) && e.stage === 'search').sort((a, b) => a.score - b.score)) {
    const key = e.x.map(v => v.toPrecision(6)).join(','); if (seen.has(key) || key === x0.map(v => v.toPrecision(6)).join(',')) continue; seen.add(key); unique.push(e); if (unique.length >= finalists) break;
  }
  const validated = [];
  for (const candidate of unique) {
    const scores = [];
    for (let i = 0; i < finalistRepeats; i++) scores.push(await guarded(candidate.x, { stage: 'finalist', quality: 'final', repeat: i }));
    validated.push({ x: candidate.x, search_score: candidate.score, ...summarizeRepeats(scores) });
  }
  validated.sort((a, b) => a.mean - b.mean);
  const top = validated[0];
  const noise = top ? Math.sqrt(baseline.sd ** 2 / baseline.n + top.sd ** 2 / Math.max(1, top.n)) : 0;
  const required = Math.max(floor, z * noise);
  const improvement = top ? baseline.mean - top.mean : 0;
  const accepted = !!top && improvement > required;
  return { method, accepted, x: accepted ? top.x : x0.slice(), baseline, finalists: validated, improvement, required_improvement: required,
    reason: accepted ? 'Finalist improved beyond repeat noise on re-validation.' : 'No finalist improved beyond repeat noise; the starting point is kept.',
    evaluations_used: trace.length, budget, trace };
}

module.exports = { coordinateSearch, powellSearch, optimize, summarizeRepeats, space };
