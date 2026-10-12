// Local, lossless intake for texture sets. Source files stay byte-for-byte unchanged;
// no KeyShot material or product object is touched by this module.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', 'materials', 'texture-sets');
const MAX_FILES = 24;
const MAX_FILE_BYTES = 11 * 1024 * 1024;
const MAX_SET_BYTES = 80 * 1024 * 1024;
const EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.exr', '.hdr', '.mtlx']);
const ROLES = [
  ['ambient-occlusion', /(?:^|[_ .-])(?:ambient.?occlusion|ao)(?:[_ .-]|$)/i],
  ['base-color', /(?:^|[_ .-])(?:base.?color|albedo|diffuse|color|col)(?:[_ .-]|$)/i],
  ['displacement', /(?:^|[_ .-])(?:displacement|height|disp)(?:[_ .-]|$)/i],
  ['metallic', /(?:^|[_ .-])(?:metallic|metalness|metal)(?:[_ .-]|$)/i],
  ['normal', /(?:^|[_ .-])(?:normal|normalgl|normaldx|nrm)(?:[_ .-]|$)/i],
  ['roughness', /(?:^|[_ .-])(?:roughness|rough)(?:[_ .-]|$)/i],
  ['specular', /(?:^|[_ .-])(?:specular|spec)(?:[_ .-]|$)/i],
  ['glossiness', /(?:^|[_ .-])(?:glossiness|gloss)(?:[_ .-]|$)/i],
  ['bump', /(?:^|[_ .-])(?:bump)(?:[_ .-]|$)/i],
];

function roleFor(name) {
  if (/preview|thumbnail|swatch/i.test(name)) return 'preview (not a shader map)';
  for (const [role, pattern] of ROLES) if (pattern.test(path.basename(name, path.extname(name)))) return role;
  if (path.extname(name).toLowerCase() === '.mtlx') return 'MaterialX metadata (reference only)';
  return 'unassigned — review before use';
}
function materialXSummary(text) {
  if (text.length > 1024 * 1024 || !/<materialx\b/i.test(text)) throw new Error('This MaterialX file is invalid or too large to inspect.');
  const outputNodes = new Map();
  for (const match of text.matchAll(/<output\b([^>]*?)\/>/gi)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
    if (attrs.name && attrs.nodename) outputNodes.set(attrs.name, attrs.nodename);
  }
  const connectionMap = new Map();
  for (const match of text.matchAll(/<input\b([^>]*?)\/>/gi)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
    if (attrs.name && attrs.output && !['subsurface_color', 'displacementshader'].includes(attrs.name))
      connectionMap.set(attrs.name, { input: attrs.name, source: outputNodes.get(attrs.output) || attrs.output });
  }
  const connections = [...connectionMap.values()];
  const values = {};
  for (const key of ['AO_Mix_Strength']) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const found = text.match(new RegExp(`<input\\s+name="${escaped}"\\s+type="float"\\s+value="([^"]+)"`, 'i'));
    if (found) values[key] = Number(found[1]);
  }
  const displacement = text.match(/<displacement\b[^>]*>[\s\S]*?<input\s+name="scale"\s+type="float"\s+value="([^"]+)"/i);
  if (displacement) values.displacementScale = Number(displacement[1]);
  const imageNodes = [];
  for (const match of text.matchAll(/<tiledimage\b([^>]*)>([\s\S]*?)<\/tiledimage>/gi)) {
    const nodeAttrs = Object.fromEntries([...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
    const file = match[2].match(/<input\s+name="file"\s+type="filename"\s+value="([^"]+)"(?:\s+colorspace="([^"]+)")?/i);
    if (nodeAttrs.name && file) imageNodes.push({ node: nodeAttrs.name, file: file[1], colorSpace: file[2] || 'unspecified' });
  }
  return { version: (text.match(/<materialx\s+version="([^"]+)"/i) || [])[1] || null,
    imageNodes, connections, values, note: 'Parsed as a conversion hint only; this MaterialX graph is not executed or imported into KeyShot.' };
}
function safeFilename(value) {
  const name = path.basename(String(value || '').replace(/\\/g, '/'));
  if (!name || name === '.' || name === '..' || /[\u0000-\u001f]/.test(name)) throw new Error('Invalid texture filename.');
  if (!EXTENSIONS.has(path.extname(name).toLowerCase())) throw new Error(`Unsupported texture file: ${name}`);
  return name;
}
function listTextureSets() {
  if (!fs.existsSync(ROOT)) return [];
  return fs.readdirSync(ROOT, { withFileTypes: true }).filter(e => e.isDirectory()).map(entry => {
    const dir = path.join(ROOT, entry.name), manifestFile = path.join(dir, 'director-texture-set.json');
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      const files = manifest.files.filter(f => fs.existsSync(path.join(dir, f.name)));
      return { id: entry.name, name: manifest.name, path: dir, imported: manifest.imported, files, materialx: manifest.materialx || null,
        bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => b.imported.localeCompare(a.imported));
}
function createTextureSet(name) {
  const clean = String(name || '').trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').slice(0, 100);
  if (!clean) throw new Error('Name this texture set before importing it.');
  fs.mkdirSync(ROOT, { recursive: true });
  const id = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  fs.mkdirSync(path.join(ROOT, id));
  const manifest = { version: 1, id, name: clean, imported: new Date().toISOString(), files: [] };
  fs.writeFileSync(path.join(ROOT, id, 'director-texture-set.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  return { id, name: clean, path: path.join(ROOT, id) };
}
function addTextureFile(id, originalName, data) {
  if (!/^[a-z0-9-]{1,40}$/i.test(String(id))) throw new Error('Invalid texture set. Refresh the page and try again.');
  const setDir = path.resolve(ROOT, String(id));
  if (path.dirname(setDir) !== ROOT) throw new Error('Invalid texture set location.');
  const manifestPath = path.join(setDir, 'director-texture-set.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const name = safeFilename(originalName);
  if (manifest.files.some(file => file.name.toLowerCase() === name.toLowerCase())) throw new Error(`A file named ${name} is already in this set.`);
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error(`${name} exceeds the 11 MB per-file limit.`);
  const currentBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
  if (manifest.files.length >= MAX_FILES) throw new Error(`A texture set can contain up to ${MAX_FILES} files.`);
  if (currentBytes + bytes.length > MAX_SET_BYTES) throw new Error('This texture set exceeds the 80 MB limit.');
  const materialx = path.extname(name).toLowerCase() === '.mtlx' ? materialXSummary(bytes.toString('utf8')) : null;
  const filePath = path.join(setDir, name);
  fs.writeFileSync(filePath, bytes, { flag: 'wx' });
  const file = { name, role: roleFor(name), bytes: bytes.length };
  manifest.files.push(file);
  if (materialx) manifest.materialx = materialx;
  try { fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2)); }
  catch (error) { try { fs.unlinkSync(filePath); } catch { /* keep source data safe */ } throw error; }
  return file;
}

module.exports = { ROOT, MAX_FILES, MAX_FILE_BYTES, MAX_SET_BYTES, createTextureSet, addTextureFile, listTextureSets, roleFor, materialXSummary };
