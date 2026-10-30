// The capability record is data; the document is generated from it. These checks keep the two, the code and the
// "no match percentage" rule from drifting apart. Offline: reads source files only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { EVIDENCE, RECORD, MATRIX, MATRIX_COLUMNS } = require('../server/lighting-capabilities');
const { render, target } = require('./render_capability_record');
const { cleanPlan } = require('../server/photo');

const all = () => [...RECORD.sources.flatMap(s => s.parameters), ...RECORD.environment, ...RECORD.controls, ...RECORD.recovery, ...RECORD.measurement, ...RECORD.search];

test('every entry has a unique id and a known evidence label, a location and a basis', () => {
  const ids = all().map(e => e.id);
  assert.equal(ids.length, new Set(ids).size);
  for (const entry of all()) {
    assert.ok(Object.hasOwn(EVIDENCE, entry.evidence), `${entry.id}: unknown label ${entry.evidence}`);
    assert.ok(entry.name && entry.where && entry.basis, `${entry.id}: incomplete`);
  }
  assert.deepEqual(Object.keys(EVIDENCE), ['source-confirmed', 'recorded-live-evidence', 'documented', 'proposed', 'open']);
});
test('the committed document is exactly what the data module renders', () => {
  assert.equal(fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n'), render());
});
test('the plan grammar flags match what cleanPlan can actually build', () => {
  for (const family of RECORD.sources) {
    const buildable = (() => { try { return cleanPlan({ lights: [{ type: family.id, ies_asset_id: 'Light/IES Light/x.ies' }] }).lights[0].type === family.id; } catch { return false; } })();
    assert.equal(buildable, family.in_photo_grammar, `${family.id}`);
  }
});
test('experiments E01-E16 are all listed and none is closed by offline coverage alone', () => {
  assert.deepEqual(RECORD.experiments.map(e => e.id), Array.from({ length: 16 }, (_, i) => 'E' + String(i + 1).padStart(2, '0')));
  for (const e of RECORD.experiments) assert.match(e.live, /^open/, `${e.id} must stay open until a live run is recorded`);
});
test('Planar is documented only and never claimed constructible', () => {
  const planar = RECORD.sources.find(s => s.id === 'planar');
  assert.equal(planar.in_photo_grammar, false);
  assert.ok(planar.parameters.every(p => ['documented', 'open'].includes(p.evidence)));
});
test('referenced source files exist and nothing claims a match percentage', () => {
  for (const entry of all()) for (const file of entry.where.match(/(?:server|bridge|tools|docs)\/[\w./-]+\.(?:js|py|md)/g) || [])
    assert.ok(fs.existsSync(path.join(__dirname, '..', file)), `${entry.id} cites missing ${file}`);
  const text = render();
  assert.doesNotMatch(text, /\d\s?%\s+(?:match|similar)/i);
  assert.match(text, /Nothing here is a similarity percentage/);
});

test('the native-light matrix covers every column for every source with a valid label, and open cells name a probe', () => {
  const sources = new Set(RECORD.sources.map(s => s.id));
  for (const row of MATRIX) {
    if (row.id !== 'environment') assert.ok(sources.has(row.id), `${row.id} is a documented source family`);
    for (const [key] of MATRIX_COLUMNS) {
      const cell = row.cells[key];
      assert.ok(cell && Object.hasOwn(EVIDENCE, cell[0]) && cell[1].length >= 8, `${row.id}.${key}`);
      if (cell[0] === 'open') assert.match(cell[1], /Probe/, `${row.id}.${key} must say how to close it`);
    }
  }
  assert.deepEqual(MATRIX.map(r => r.id), ['area', 'point', 'spotlight', 'ies', 'planar', 'environment']);
});
test('Planar claims nothing recorded or source-confirmed, and the matrix keeps the IES output cell honest', () => {
  const planar = MATRIX.find(r => r.id === 'planar');
  assert.ok(Object.values(planar.cells).every(([label]) => ['open', 'documented'].includes(label)));
  const ies = MATRIX.find(r => r.id === 'ies');
  assert.equal(ies.cells.output[0], 'source-confirmed'); assert.match(ies.cells.output[1], /live plan-to-render round trip is open/);
  assert.match(MATRIX.find(r => r.id === 'environment').cells.aim[1], /HDRI pins/);
});
