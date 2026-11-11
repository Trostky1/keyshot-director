// Camera motion presets start from the camera the user has now, never from the pose captured when KeyShot connected.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sample, presets, motionDefaults, cameraTarget, withDirectorCamera } = require('../server/shots');

const connect = { pivot: [0, 38.5, 0], az: -40, el: 56, dist: 504, fov: 40 };
const current = { pivot: [5, 38.5, 2], az: 20, el: 40, dist: 404, fov: 30 };
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);

test('an orbit keeps the current elevation, distance and lens (it used to snap back to the connect-time view)', () => {
  const orbit = presets(current).orbit_360, defaults = motionDefaults(connect, current);
  for (const u of [0, 0.5, 1]) {
    const pose = sample(orbit, defaults, u);
    close(pose.el, 40, 'elevation'); close(pose.dist, 404, 'distance'); close(pose.fov, 30, 'fov');
    assert.deepEqual(pose.pivot, current.pivot);
  }
  close(sample(orbit, defaults, 0).az, 20, 'orbit starts at the current azimuth');
  close(sample(orbit, defaults, 1).az, 380, 'and turns a full circle');
});

test('every preset keeps the values it does not animate', () => {
  const defaults = motionDefaults(connect, current), all = presets(current);
  const keyed = name => new Set(all[name].keys.flatMap(key => Object.keys(key)));
  for (const name of Object.keys(all)) {
    for (const u of [0, 0.37, 1]) {
      const pose = sample(all[name], defaults, u);
      for (const field of ['az', 'el', 'dist', 'fov']) if (!keyed(name).has(field)) close(pose[field], current[field], `${name} ${field} at ${u}`);
    }
  }
});

test('chat camera moves: relative values add to the current camera, out-of-range requests are refused, not clamped', () => {
  const cam = { pivot: [0, 38.5, 0], az: -40, el: 56.2, dist: 504, fov: 39.6 };
  const moved = cameraTarget(cam, { elevation: 10, distance: -50, relative: true });
  close(moved.el, 66.2, 'elevation'); close(moved.dist, 454, 'distance'); close(moved.az, -40, 'azimuth untouched');
  close(cameraTarget(cam, { distance: 300 }).dist, 300, 'absolute distance');
  // The live failure: the model read KeyShot's raw 4540 mm and sent +3500 mm "relative". It used to land at 3000 mm, top-down.
  assert.throws(() => cameraTarget(cam, { azimuth: 30, elevation: 20, distance: 3500, relative: true }),
    error => error.status === 400 && /distance would be 4004 mm/.test(error.message) && /Current camera: .*distance 504 mm/.test(error.message));
  assert.throws(() => cameraTarget(cam, { elevation: 90 }), /elevation would be 90°/);
  assert.throws(() => cameraTarget(cam, { fov: 'wide' }), /field of view must be a number/);
});

test('the AI scene context reports the camera in set_camera units, not KeyShot raw distance', () => {
  const context = { scene: { display_name: 'x.bip' }, camera: { name: 'active', pos: [144.16, 457.72, 240.57], pivot: [0, 38.5, 0], dist: 4540.58,
    lookat: [-1153, -3316, -1925], fov: 39.6, up: [0, 1, 0] } };
  const out = withDirectorCamera(context);
  assert.equal(out.camera.dist, undefined); assert.equal(out.camera.lookat, undefined);
  assert.ok(Math.abs(out.camera.set_camera_values.distance_mm - 504) < 1, `distance ${out.camera.set_camera_values.distance_mm}`);
  assert.ok(Math.abs(out.camera.set_camera_values.elevation - 56.2) < 0.2);
  assert.equal(out.scene.display_name, 'x.bip');
  assert.equal(withDirectorCamera({ camera: { name: 'broken', pos: 'ERR' } }).camera.name, 'broken', 'unusable camera data passes through');
});

test('before any camera move the connect-time pose is used', () => {
  assert.deepEqual(motionDefaults(connect, null), connect);
});
