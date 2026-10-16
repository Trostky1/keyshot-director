// Small, deterministic recipe planner for imported texture sets.
// It runs in Node so end-user installs do not need Rust, Cargo, or a generated WASM file.
'use strict';

const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_NAME_BYTES = 80;
const ROLE_ORDER = new Map([
  ['base-color', 0], ['ambient-occlusion', 1], ['roughness', 2], ['normal', 3], ['bump', 4],
]);

function safeRelativePath(value) {
  const normalized = value.replace(/\\/g, '/');
  return normalized.length > 0 && !normalized.startsWith('/') && !normalized.includes(':') &&
    !/\p{Cc}/u.test(normalized) &&
    normalized.split('/').every(part => part.length > 0 && part !== '.' && part !== '..');
}

function compileTexturePlan({ name, files } = {}) {
  let requestBytes;
  try { requestBytes = Buffer.byteLength(JSON.stringify({ name, files }), 'utf8'); }
  catch { throw new Error('Recipe must be valid JSON data.'); }
  if (!requestBytes || requestBytes > MAX_INPUT_BYTES) throw new Error('Material recipe request is too large.');
  if (typeof name !== 'string') throw new Error("Recipe field 'name' must be a string");
  if (!Array.isArray(files)) throw new Error("Recipe field 'files' must be an array");

  name = name.trim();
  if (!name || Buffer.byteLength(name, 'utf8') > MAX_NAME_BYTES || /\p{Cc}/u.test(name))
    throw new Error('Material name must contain 1 to 80 printable characters.');
  if (files.length < 1 || files.length > 24)
    throw new Error('A texture set must contain between 1 and 24 files.');

  const ordered = files.map((file, index) => {
    if (!file || typeof file !== 'object' || Array.isArray(file))
      throw new Error('Each texture file must be an object');
    if (typeof file.name !== 'string') throw new Error("Recipe field 'name' must be a string");
    if (typeof file.role !== 'string') throw new Error("Recipe field 'role' must be a string");
    return { name: file.name, role: file.role, index };
  }).sort((a, b) => (ROLE_ORDER.get(a.role) ?? 5) - (ROLE_ORDER.get(b.role) ?? 5) || a.index - b.index);

  const chosen = [];
  const warnings = [];
  const skipped = [];
  for (const file of ordered) {
    if (!safeRelativePath(file.name)) throw new Error(`Unsafe texture path: ${file.name}`);
    if (!ROLE_ORDER.has(file.role)) {
      skipped.push({ name: file.name, role: file.role, reason: 'This channel is outside the Simple Plastic material path.' });
      continue;
    }
    const conflict = chosen.some(current => current.role === file.role ||
      (['normal', 'bump'].includes(file.role) && ['normal', 'bump'].includes(current.role)));
    if (conflict) {
      warnings.push(`Ignored additional ${file.role} map '${file.name}'; one file can drive this input.`);
      skipped.push({ name: file.name, role: file.role, reason: 'Another map already supplies this shader input.' });
    } else chosen.push(file);
  }

  if (!chosen.length) throw new Error('No supported Base Color, Roughness, Normal or Bump maps were found.');
  if (chosen.some(file => file.role === 'ambient-occlusion') && !chosen.some(file => file.role === 'base-color')) {
    const index = chosen.findIndex(file => file.role === 'ambient-occlusion');
    const [ao] = chosen.splice(index, 1);
    skipped.push({ name: ao.name, role: ao.role, reason: 'AO needs Base Color to blend into the Plastic diffuse color.' });
  }
  if (!chosen.length) throw new Error('No supported Base Color, Roughness, Normal or Bump maps were found.');

  const useAo = chosen.some(file => file.role === 'ambient-occlusion');
  const maps = [];
  const nodes = [
    { id: 'root', kind: 'Material' },
    { id: 'surface', kind: 'Plastic' },
  ];
  const edges = [{ from: 'surface', to: 'root', input: 'surface' }];
  if (useAo) {
    nodes.push({ id: 'composite:ao', kind: 'Color Composite Multiply' });
    edges.push({ from: 'composite:ao', to: 'surface', input: 'diffuse' });
  }

  for (const file of chosen) {
    let colorSpace, target;
    if (file.role === 'base-color') { colorSpace = 'srgb'; target = useAo ? 'background' : 'diffuse'; }
    else if (file.role === 'ambient-occlusion') { colorSpace = 'linear'; target = 'source'; }
    else if (file.role === 'roughness') { colorSpace = 'linear'; target = 'roughness'; }
    else { colorSpace = 'linear'; target = 'bumpmap'; }

    const id = `map:${file.role}`;
    nodes.push({ id, kind: 'Texture Map' });
    if (file.role === 'roughness') {
      nodes.push({ id: 'convert:roughness', kind: 'Color To Number' });
      edges.push({ from: id, to: 'convert:roughness', input: 'input' });
      edges.push({ from: 'convert:roughness', to: 'surface', input: 'roughness' });
    } else if (file.role === 'base-color') {
      edges.push({ from: id, to: useAo ? 'composite:ao' : 'surface', input: target });
    } else if (file.role === 'ambient-occlusion') {
      edges.push({ from: id, to: 'composite:ao', input: 'source' });
    } else edges.push({ from: id, to: 'surface', input: target });
    maps.push({ role: file.role, path: file.name, color_space: colorSpace, target });
  }

  return {
    schema_version: 1,
    material: { name, model: 'Plastic' },
    maps,
    graph: { root: 'root', nodes, edges },
    warnings,
    skipped,
  };
}

module.exports = { compileTexturePlan };
