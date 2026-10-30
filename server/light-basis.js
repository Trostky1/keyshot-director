// Light-response basis (research E09): fit nonnegative source intensities from per-source LINEAR renders by NNLS, then verify
// on held-out mixtures before trusting the shortcut. EXPERIMENTAL: only the synthetic renderer has exercised it. In KeyShot,
// tone mapping, clipping, denoising, changing geometry and global illumination can break the linear-superposition assumption
// this relies on, and it can never predict the response of a source that MOVES. Use only linear (EXR) data, never display pixels.

// Lawson-Hanson active-set NNLS: minimize ||A x - b|| subject to x >= 0. columns: array of n arrays of length m.
function nnls(columns, b, { maxIterations = 200, tolerance = 1e-10 } = {}) {
  const n = columns.length, m = b.length;
  if (!n || columns.some(c => c.length !== m)) throw new Error('NNLS needs equally long columns.');
  const dotp = (u, v) => { let s = 0; for (let i = 0; i < m; i++) s += u[i] * v[i]; return s; };
  const gram = columns.map(ci => columns.map(cj => dotp(ci, cj))), rhs = columns.map(c => dotp(c, b));
  const solveSubset = set => {   // unconstrained least squares restricted to `set`, via Gaussian elimination on the normal equations
    const k = set.length, M = set.map(i => [...set.map(j => gram[i][j]), rhs[i]]);
    for (let col = 0; col < k; col++) {
      let pivot = col; for (let r = col + 1; r < k; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
      if (Math.abs(M[pivot][col]) < 1e-14) return null;
      [M[col], M[pivot]] = [M[pivot], M[col]];
      for (let r = 0; r < k; r++) if (r !== col) { const f = M[r][col] / M[col][col]; for (let c = col; c <= k; c++) M[r][c] -= f * M[col][c]; }
    }
    return set.map((_, r) => M[r][k] / M[r][r]);
  };
  const x = new Array(n).fill(0), passive = [];
  let iterations = 0;
  while (iterations++ < maxIterations) {
    const w = columns.map((_, j) => rhs[j] - x.reduce((s, xi, i) => s + xi * gram[j][i], 0));
    let best = -1, bestW = tolerance;
    for (let j = 0; j < n; j++) if (!passive.includes(j) && w[j] > bestW) { best = j; bestW = w[j]; }
    if (best < 0) break;
    passive.push(best);
    for (;;) {
      const s = solveSubset(passive);
      if (!s) { passive.pop(); break; }
      if (s.every(v => v > tolerance)) { passive.forEach((j, i) => { x[j] = s[i]; }); break; }
      let alpha = Infinity;
      passive.forEach((j, i) => { if (s[i] <= tolerance) alpha = Math.min(alpha, x[j] / (x[j] - s[i])); });
      passive.forEach((j, i) => { x[j] += alpha * (s[i] - x[j]); });
      for (let i = passive.length - 1; i >= 0; i--) if (x[passive[i]] < tolerance) { x[passive[i]] = 0; passive.splice(i, 1); }
      if (!passive.length) break;
    }
  }
  const residual = new Float64Array(m); for (let i = 0; i < m; i++) { let s = b[i]; for (let j = 0; j < n; j++) s -= x[j] * columns[j][i]; residual[i] = s; }
  return { x, residual_rms: Math.sqrt(dotp(residual, residual) / m), iterations };
}

// Masked linear samples: all three channels of the pixels inside the mask (or every pixel), as one vector.
function samples(linear, mask = null) {
  const out = [];
  for (let i = 0; i < linear.length / 3; i++) if (!mask || mask[i]) out.push(linear[i * 3], linear[i * 3 + 1], linear[i * 3 + 2]);
  return Float64Array.from(out);
}
const rms = a => Math.sqrt(a.reduce((n, v) => n + v * v, 0) / a.length);

// basis: [{ id, linear }] each the NET linear contribution of one source at unit intensity (render with the source minus the
// render without it, so shared geometry and the base/environment are preserved). base: linear render with no sources.
function fitIntensities({ basis, base, target, mask = null }) {
  const columns = basis.map(b => samples(b.linear, mask)), t = samples(target, mask), b0 = samples(base, mask);
  const fit = nnls(columns, Float64Array.from(t, (v, i) => v - b0[i]));
  return { weights: Object.fromEntries(basis.map((b, i) => [b.id, fit.x[i]])), residual_rms: fit.residual_rms, relative_residual: fit.residual_rms / (rms(t) + 1e-12), iterations: fit.iterations };
}
function predict({ basis, base, weights }) {
  const out = Float32Array.from(base);
  for (const b of basis) { const w = weights[b.id] || 0; if (w) for (let i = 0; i < out.length; i++) out[i] += w * b.linear[i]; }
  return out;
}
// mixtures: [{ weights, actual }] never used in the fit. noise_rms: per-sample render noise (RMS, same units as the data),
// measured from repeated renders rather than assumed. The shortcut is accepted only if EVERY held-out mixture is predicted
// within max(tolerance x signal RMS, 3 x noise_rms).
function validate({ basis, base, mixtures, noise_rms = 0, tolerance = 0.02, mask = null }) {
  if (!mixtures?.length) throw new Error('At least one held-out mixture is required.');
  const results = mixtures.map(m => {
    const p = samples(predict({ basis, base, weights: m.weights }), mask), a = samples(m.actual, mask);
    const error = rms(Float64Array.from(p, (v, i) => v - a[i])), signal = rms(a), limit_rms = Math.max(tolerance * signal, 3 * noise_rms);
    return { rms_error: error, relative_error: error / (signal + 1e-12), limit_rms, within_limit: error <= limit_rms };
  });
  const accepted = results.every(r => r.within_limit);
  return { accepted, worst_relative_error: Math.max(...results.map(r => r.relative_error)), tolerance, noise_rms, results,
    reason: accepted ? 'Held-out mixtures were predicted within the measured tolerance.' : 'Held-out mixtures exceeded the tolerance; do not use the light-response shortcut for this scene.' };
}

module.exports = { nnls, fitIntensities, predict, validate };
