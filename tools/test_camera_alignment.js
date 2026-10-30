// Stage B (research E05, offline half): projection convention, reprojection check, pose recovery and silhouette overlay on
// injected fixtures. Nothing here compares against a real KeyShot render, so projection conventions stay unverified live.
const test = require('node:test');
const assert = require('node:assert/strict');
const { projectBounds } = require('../server/photo');
const { projectPoint, createAlignment, reprojectionReport, conditioning, fitPose, polygonMask, silhouetteOverlay } = require('../server/camera-alignment');

const truth = { az: 25, el: 18, dist: 1500, fov: 38, pivot: [10, 130, -20] };
const aspect = 16 / 9;
const box = { min: [-120, 0, -60], max: [120, 260, 60] };
const corner = (x, y, z) => [x ? box.max[0] : box.min[0], y ? box.max[1] : box.min[1], z ? box.max[2] : box.min[2]];
const corners = [0, 1].flatMap(x => [0, 1].flatMap(y => [0, 1].map(z => corner(x, y, z))));
const extra = [[0, 130, 60], [-60, 260, 0], [100, 60, -60]];
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function landmarksFor(pose, points = [...corners, ...extra], noise = 0, seed = 1) {
  const r = rng(seed);
  return points.map((world, i) => { const p = projectPoint(world, pose, aspect); return { id: 'L' + i, world, image: { x: p.x + (r() - 0.5) * noise, y: p.y + (r() - 0.5) * noise } }; });
}

test('projection convention matches the one photo.projectBounds already uses for measurement targets', () => {
  const pts = corners.map(c => projectPoint(c, truth, aspect));
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const rect = projectBounds(box, truth, aspect, 0), pad = 0.012;   // projectBounds pads by at least 1.2% and clips to the frame
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(rect.x0, Math.max(0, Math.min(...xs) - pad)); near(rect.x1, Math.min(1, Math.max(...xs) + pad));
  near(rect.y0, Math.max(0, Math.min(...ys) - pad)); near(rect.y1, Math.min(1, Math.max(...ys) + pad));
});
test('basic projection geometry: pivot is the frame center, up is up, behind the camera is rejected, aspect scales vertically', () => {
  const pose = { az: 0, el: 0, dist: 500, fov: 40, pivot: [0, 0, 0] };
  const c = projectPoint([0, 0, 0], pose, 2); assert.ok(Math.abs(c.x - 0.5) < 1e-12 && Math.abs(c.y - 0.5) < 1e-12);
  assert.ok(projectPoint([0, 50, 0], pose, 2).y < 0.5); assert.ok(projectPoint([50, 0, 0], pose, 2).x > 0.5);
  assert.equal(projectPoint([0, 0, 600], pose, 2), null);
  const wide = projectPoint([0, 50, 0], pose, 1), tall = projectPoint([0, 50, 0], pose, 2);
  assert.ok(0.5 - tall.y > 0.5 - wide.y);
  assert.equal(projectPoint([NaN, 0, 0], pose, 2), null); assert.equal(projectPoint([0, 0, 0], { ...pose, fov: 500 }, 2), null);
});
test('the true pose has zero reprojection error; a perturbed pose does not', () => {
  const lm = landmarksFor(truth);
  assert.ok(reprojectionReport(truth, lm, aspect).rms_px < 1e-9);
  assert.ok(reprojectionReport({ ...truth, az: truth.az + 5 }, lm, aspect).rms_px > 5);
  assert.equal(reprojectionReport({ ...truth, dist: 10 }, lm, aspect).rms_px, Infinity, 'landmarks behind the camera fail closed');
});
for (const method of ['coordinate', 'powell']) {
  test(`a perturbed camera is recovered from landmarks (${method}) with held-out landmarks as the check`, async () => {
    const lm = landmarksFor(truth), heldOut = ['L1', 'L6', 'L9'];
    const start = { ...truth, az: truth.az + 6, el: truth.el - 5, dist: truth.dist * 1.15 };
    const fit = await fitPose({ initialPose: start, landmarks: lm, aspect, heldOut, method, budget: 4000 });
    assert.ok(fit.before.rms_px > 20);
    assert.ok(fit.after.rms_px < 0.5, `training rms ${fit.after.rms_px}`);
    assert.ok(fit.held_out.rms_px < 0.5, `held-out rms ${fit.held_out.rms_px}`);
    assert.ok(Math.abs(fit.pose.az - truth.az) < 0.5 && Math.abs(fit.pose.el - truth.el) < 0.5 && Math.abs(fit.pose.dist / truth.dist - 1) < 0.01);
  });
}
test('measurement noise and one bad landmark do not wreck the fit', async () => {
  const lm = landmarksFor(truth, undefined, 0.002, 7);
  lm[3].image = { x: Math.min(1, lm[3].image.x + 0.25), y: lm[3].image.y };   // a mis-clicked landmark
  const fit = await fitPose({ initialPose: { ...truth, az: truth.az - 4, el: truth.el + 3, dist: truth.dist * 0.9 }, landmarks: lm, aspect, heldOut: ['L1', 'L8'], budget: 4000 });
  assert.ok(Math.abs(fit.pose.az - truth.az) < 1.5 && Math.abs(fit.pose.el - truth.el) < 1.5, `az ${fit.pose.az} el ${fit.pose.el}`);
  assert.ok(fit.held_out.rms_px < 12);
});
test('ambiguous landmark sets are refused or restricted, not silently trusted', async () => {
  const flat = [[-100, 0, 0], [100, 0, 0], [100, 200, 0], [-100, 200, 0], [0, 100, 0]];
  const lm = landmarksFor(truth, flat);
  const c = conditioning(lm); assert.ok(c.ok && c.coplanar && c.warnings.some(w => /coplanar_landmarks/.test(w)));
  const fit = await fitPose({ initialPose: truth, landmarks: lm, aspect, free: ['az', 'el', 'dist', 'fov'], budget: 200 });
  assert.ok(!fit.free.includes('fov') && fit.warnings.includes('fov_locked_ambiguous'));
  const line = landmarksFor(truth, [[0, 0, 0], [0, 100, 0], [0, 200, 0], [0, 300, 0]]);
  assert.equal(conditioning(line).ok, false);
  await assert.rejects(() => fitPose({ initialPose: truth, landmarks: line, aspect }), /collinear/i);
  await assert.rejects(() => fitPose({ initialPose: truth, landmarks: lm.slice(0, 3), aspect }), /four/);
  assert.ok(conditioning(landmarksFor(truth, corners.slice(0, 4).map(p => [p[0] * 0.01, p[1] * 0.01, p[2] * 0.01]))).warnings.some(w => /narrow_screen_spread/.test(w)));
});
test('the alignment data model validates landmarks, silhouette and pose', () => {
  const lm = landmarksFor(truth).slice(0, 4);
  const good = { reference: { width: 800, height: 450, landmarks: lm, silhouette: [[0.2, 0.2], [0.8, 0.2], [0.5, 0.9]] }, render: { pose: truth, aspect } };
  assert.equal(createAlignment(good).version, 1);
  assert.throws(() => createAlignment({ ...good, reference: { landmarks: [...lm, lm[0]] } }), /unique id/);
  assert.throws(() => createAlignment({ ...good, reference: { landmarks: [{ ...lm[0], image: { x: 2, y: 0 } }] } }));
  assert.throws(() => createAlignment({ ...good, reference: { ...good.reference, silhouette: [[0, 0], [1, 1]] } }));
  assert.throws(() => createAlignment({ ...good, render: { pose: { ...truth, fov: 1 }, aspect } }));
});
test('silhouette overlay measures overlap, offset and boundary distance, and flags empty masks', () => {
  const w = 40, h = 30, square = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const a = polygonMask(square(0.2, 0.2, 0.6, 0.7), w, h), same = silhouetteOverlay(a, a, w, h);
  assert.equal(same.iou, 1); assert.equal(same.mean_boundary_distance, 0); assert.ok(Math.abs(same.area_ratio - 1) < 1e-12);
  const b = polygonMask(square(0.3, 0.2, 0.7, 0.7), w, h), moved = silhouetteOverlay(a, b, w, h);
  assert.ok(moved.iou < 0.8 && moved.iou > 0.4); assert.ok(moved.centroid_offset.x > 0.05 && Math.abs(moved.centroid_offset.y) < 0.02);
  assert.ok(moved.mean_boundary_distance > 0.03); assert.deepEqual([...new Set(moved.classes)].sort(), [0, 1, 2, 3]);
  assert.equal(silhouetteOverlay(a, new Uint8Array(w * h), w, h).available, false);
  assert.throws(() => silhouetteOverlay(a, new Uint8Array(5), w, h));
});
