// Bounded coordinate search; the injected adapter owns actual KeyShot captures and commands.
async function runStyleSearch({ params, measure, rounds = 3, maxCaptures = 16, maxMs = 180000,
  signal, onLog = () => {}, now = Date.now }) {
  if (!Array.isArray(params) || typeof measure !== 'function') throw new Error('Style search needs parameters and a measurement adapter.');
  const budget = Math.min(16, Math.max(2, Math.floor(maxCaptures) || 16));
  const deadline = now() + Math.min(180000, Math.max(1, Number(maxMs) || 180000));
  let captures = 0, stopReason = 'complete', best, startDistance, noiseDistance = null, acceptanceMargin = null;
  const bestParams = Object.fromEntries(params.map(p => [p.id, p.get()]));
  if (new Set(params.map(p => p.id)).size !== params.length || params.some(p => !Number.isFinite(bestParams[p.id]) || typeof p.set !== 'function' ||
      ![p.min, p.max, p.step].every(Number.isFinite) || p.min > p.max || p.step <= 0 || (p.mul && p.step <= 1)))
    throw new Error('Style parameters need unique ids, finite values and valid bounds/steps.');
  const steps = new Map(params.map(p => [p.id, p.step]));
  function canCapture() {
    signal?.throwIfAborted();
    if (captures >= budget) { stopReason = 'capture_budget'; return false; }
    if (now() >= deadline) { stopReason = 'deadline'; return false; }
    return true;
  }
  async function capture(phase, previousRunId = null) {
    if (!canCapture()) return null;
    captures++;
    const result = await measure({ previousRunId, phase, signal });
    signal?.throwIfAborted();
    if (!result || !Number.isFinite(result.distance) || typeof result.run_id !== 'string' || !result.run_id)
      throw new Error('Style capture returned no finite objective or recorded run identity.');
    if (previousRunId && result.comparison?.available !== true)
      throw new Error('Style capture is incompatible: ' + (result.comparison?.reason || 'paired measurement unavailable'));
    return result;
  }
  const summary = () => ({ startDistance, finalDistance: best?.distance ?? startDistance, deltas: best?.deltas,
    tuned: { ...bestParams }, captures, noiseDistance, acceptanceMargin, stopReason, bestRunId: best?.run_id || null });
  async function restoreBest() {
    const errors = [];
    for (const p of params) {
      try { await p.set(bestParams[p.id]); } catch (error) { errors.push(p.id + ': ' + error.message); }
    }
    if (errors.length) throw new Error('Style restoration needs attention: ' + errors.join('; '));
  }
  try {
    best = await capture('baseline');
    if (!best) return summary();
    startDistance = best.distance;
    const repeat = await capture('repeat_noise', best.run_id);
    if (!repeat) return summary();
    noiseDistance = Math.abs(repeat.distance - best.distance);
    acceptanceMargin = Math.max(0.004, 2 * noiseDistance);
    if (repeat.distance < best.distance) best = repeat;
    onLog(`Measured style repeat noise ${noiseDistance.toFixed(4)}; improvements must exceed ${acceptanceMargin.toFixed(4)}.`);
    outer: for (let round = 1; round <= Math.min(3, Math.max(1, rounds)); round++) {
      let improved = false;
      for (const p of params) {
        const current = bestParams[p.id], step = steps.get(p.id);
        for (const direction of [1, -1]) {
          if (!canCapture()) break outer;
          const candidate = p.mul ? (current === 0 ? (direction > 0 ? (p.seed ?? 0.1) : 0) : current * Math.pow(step, direction)) : current + direction * step;
          if (!Number.isFinite(candidate) || candidate === current || candidate < p.min || candidate > p.max) continue;
          await p.set(candidate);
          // If a slow setter exhausted the deadline, restore before returning.
          if (!canCapture()) { await p.set(current); break outer; }
          const result = await capture('probe', best.run_id);
          if (!result) { await p.set(current); break outer; }
          if (result.distance < best.distance - acceptanceMargin) {
            onLog(`Round ${round}: ${p.id} ${current.toFixed(3)} → ${candidate.toFixed(3)}; style distance ${best.distance.toFixed(4)} → ${result.distance.toFixed(4)}.`);
            bestParams[p.id] = candidate; best = result; improved = true; break;
          }
          await p.set(current);
        }
      }
      for (const p of params) steps.set(p.id, p.mul ? 1 + (steps.get(p.id) - 1) * 0.55 : steps.get(p.id) * 0.55);
      if (!improved) { stopReason = 'no_measured_improvement'; break; }
    }
    return summary();
  } catch (error) {
    stopReason = signal?.aborted ? 'canceled' : 'failed';
    try { await restoreBest(); }
    catch (restoreError) { error.message += ' ' + restoreError.message; }
    error.searchResult = summary();
    throw error;
  }
}
module.exports = { runStyleSearch };
