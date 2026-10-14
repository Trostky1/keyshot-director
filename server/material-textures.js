// Local, lossless intake for texture sets. Source files stay byte-for-byte unchanged;
// no KeyShot material or product object is touched by this module.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', 'materials', 'texture-sets');
const MAX_FILES = 24;
const MAX_SET_BYTES = 512 * 1024 * 1024;
const MAX_FILE_BYTES = 80 * 1024 * 1024;
const MAX_HEADER_BYTES = 1024 * 1024;
const METADATA_CACHE = new Map();
const EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.exr', '.hdr', '.mtlx']);
const ROLES = [
  ['ambient-occlusion', /(?:^|[_ .-])(?:ambient.?occlusion|ao)(?:[_ .-]|$)/i],
  ['base-color', /(?:^|[_ .-])(?:base.?color|albedo|diffuse|color|col)(?:[_ .-]|$)/i],
  ['displacement', /(?:^|[_ .-])(?:displacement|height|disp(?:16)?)(?:[_ .-]|$)/i],
  ['metallic', /(?:^|[_ .-])(?:metallic|metalness|metal)(?:[_ .-]|$)/i],
  ['normal', /(?:^|[_ .-])(?:normal|normalgl|normaldx|nrm(?:16)?)(?:[_ .-]|$)/i],
  ['roughness', /(?:^|[_ .-])(?:roughness|rough)(?:[_ .-]|$)/i],
  ['specular', /(?:^|[_ .-])(?:specular|spec)(?:[_ .-]|$)/i],
  ['glossiness', /(?:^|[_ .-])(?:glossiness|gloss)(?:[_ .-]|$)/i],
  ['bump', /(?:^|[_ .-])(?:bump(?:16)?)(?:[_ .-]|$)/i],
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
function cstring(buffer, offset, limit = buffer.length) {
  if (offset < 0 || offset >= limit || limit > buffer.length) return null;
  const end = buffer.indexOf(0, offset);
  if (end < 0 || end >= limit) return null;
  return buffer.toString('utf8', offset, end);
}
function textureMetadata(buffer, extension) {
  try {
    if (extension === '.png' && buffer.length >= 26 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
      const type = buffer[25], channels = ({0:1,2:3,3:1,4:2,6:4})[type];
      if (!channels) return null;
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), bit_depth: buffer[24], channels };
    }
    if ((extension === '.jpg' || extension === '.jpeg') && buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      const sof = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
      let offset = 2;
      while (offset + 4 <= buffer.length) {
        if (buffer[offset++] !== 0xff) continue;
        while (offset < buffer.length && buffer[offset] === 0xff) offset++;
        if (offset >= buffer.length) break;
        const marker = buffer[offset++];
        if (marker === 0xd9 || marker === 0xda) break;
        if (marker >= 0xd0 && marker <= 0xd7 || marker === 0x01) continue;
        if (offset + 2 > buffer.length) break;
        const length = buffer.readUInt16BE(offset);
        if (length < 2 || offset + length > buffer.length) break;
        if (sof.has(marker) && length >= 8) return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3), bit_depth: buffer[offset + 2], channels: buffer[offset + 7] };
        offset += length;
      }
      return null;
    }
    if ((extension === '.tif' || extension === '.tiff') && buffer.length >= 8) {
      const little = buffer.toString('ascii', 0, 2) === 'II';
      if (!little && buffer.toString('ascii', 0, 2) !== 'MM') return null;
      const u16 = o => little ? buffer.readUInt16LE(o) : buffer.readUInt16BE(o);
      const u32 = o => little ? buffer.readUInt32LE(o) : buffer.readUInt32BE(o);
      if (u16(2) !== 42) return null;
      const ifd = u32(4);
      if (ifd + 2 > buffer.length) return null;
      const count = Math.min(u16(ifd), 4096), tags = new Map();
      const typeSize = {1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8};
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > buffer.length) break;
        const tag = u16(entry), type = u16(entry + 2), n = u32(entry + 4), size = typeSize[type];
        if (!size || n > 65536) continue;
        const byteLength = n * size, data = byteLength <= 4 ? entry + 8 : u32(entry + 8);
        if (data < 0 || data + byteLength > buffer.length) continue;
        const read = position => type === 3 ? u16(position) : type === 4 ? u32(position) : null;
        const values = [];
        for (let j = 0; j < n && values.length < 16; j++) values.push(read(data + j * size));
        tags.set(tag, values.filter(Number.isFinite));
      }
      const width = tags.get(256)?.[0], height = tags.get(257)?.[0];
      if (!width || !height) return null;
      const bits = tags.get(258) || [], samples = tags.get(277)?.[0] || bits.length || 1, format = tags.get(339)?.[0] || 1;
      return { width, height, bit_depth: bits.length ? Math.max(...bits) : null, channels: samples,
        sample_format: format === 3 ? 'float' : format === 2 ? 'signed integer' : 'unsigned integer' };
    }
    if (extension === '.exr' && buffer.length >= 16 && buffer.readUInt32LE(0) === 20000630) {
      let offset = 8, width = null, height = null, channels = [], headerLimit = Math.min(buffer.length, 1024 * 1024);
      while (offset < headerLimit) {
        const name = cstring(buffer, offset, headerLimit);
        if (name === null) return null;
        offset += Buffer.byteLength(name, 'utf8') + 1;
        if (!name) break;
        const kind = cstring(buffer, offset, headerLimit);
        if (kind === null) return null;
        offset += Buffer.byteLength(kind, 'utf8') + 1;
        if (offset + 4 > headerLimit) return null;
        const size = buffer.readUInt32LE(offset); offset += 4;
        if (size > headerLimit - offset) return null;
        const end = offset + size;
        if (name === 'dataWindow' && kind === 'box2i' && size >= 16) {
          const x0 = buffer.readInt32LE(offset), y0 = buffer.readInt32LE(offset + 4), x1 = buffer.readInt32LE(offset + 8), y1 = buffer.readInt32LE(offset + 12);
          width = x1 - x0 + 1; height = y1 - y0 + 1;
        }
        if (name === 'channels' && kind === 'chlist') {
          let p = offset;
          while (p < end) {
            const channel = cstring(buffer, p, end);
            if (channel === null) break;
            p += Buffer.byteLength(channel, 'utf8') + 1;
            if (!channel) break;
            if (p + 16 > end) break;
            const pixelType = buffer.readInt32LE(p); p += 16;
            channels.push({ name: channel, bit_depth: pixelType === 1 ? 16 : 32, sample_format: pixelType === 1 ? 'half float' : pixelType === 2 ? 'float' : 'unsigned integer' });
          }
        }
        offset = end;
      }
      if (!width || !height) return null;
      return { width, height, bit_depth: channels.length ? Math.max(...channels.map(channel => channel.bit_depth)) : null,
        channels: channels.length, channel_names: channels.map(channel => channel.name), sample_format: channels[0]?.sample_format || null };
    }
    if (extension === '.hdr' || extension === '.pic') {
      const header = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('ascii');
      const match = header.match(/\n-?Y\s+(\d+)\s+\+?X\s+(\d+)/);
      return match ? { width: Number(match[2]), height: Number(match[1]), bit_depth: 32, channels: 3, sample_format: 'float' } : null;
    }
  } catch { return null; }
  return null;
}
function textureMetadataForPath(filePath, extension) {
  try {
    const stat = fs.statSync(filePath);
    const key = `${filePath}|${stat.size}|${stat.mtimeMs}`;
    if (METADATA_CACHE.has(key)) return METADATA_CACHE.get(key);
    const fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(Math.min(stat.size, MAX_HEADER_BYTES));
    let read = 0;
    try { read = fs.readSync(fd, header, 0, header.length, 0); }
    finally { fs.closeSync(fd); }
    const metadata = textureMetadata(header.subarray(0, read), extension);
    METADATA_CACHE.set(key, metadata);
    if (METADATA_CACHE.size > 2048) METADATA_CACHE.delete(METADATA_CACHE.keys().next().value);
    return metadata;
  } catch { return null; }
}
function listTextureSets({ includeMetadata = false } = {}) {
  if (!fs.existsSync(ROOT)) return [];
  return fs.readdirSync(ROOT, { withFileTypes: true }).filter(e => e.isDirectory()).map(entry => {
    const dir = path.join(ROOT, entry.name), manifestFile = path.join(dir, 'director-texture-set.json');
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      const files = manifest.files.filter(f => fs.existsSync(path.join(dir, f.name))).map(file => {
        const metadata = file.metadata || (includeMetadata ? textureMetadataForPath(path.join(dir, file.name), path.extname(file.name).toLowerCase()) : null);
        return { ...file, metadata };
      });
      const derivedDir = path.join(dir, 'derived');
      if (fs.existsSync(derivedDir)) for (const name of fs.readdirSync(derivedDir)) {
        if (path.extname(name).toLowerCase() === '.png' && fs.statSync(path.join(derivedDir, name)).isFile())
          files.push({ name: `derived/${name}`, role: roleFor(name.replace(/__(invert|contrast|tile-offset|horizontal-grain|vertical-grain).*$/i, '.png')), bytes: fs.statSync(path.join(derivedDir, name)).size, derived: true,
            metadata: includeMetadata ? textureMetadataForPath(path.join(derivedDir, name), '.png') : null });
      }
      const present = new Set(files.map(file => path.basename(file.name).toLowerCase()));
      const missing = (manifest.materialx?.imageNodes || []).map(node => path.basename(String(node.file || '').replace(/\\/g, '/')))
        .filter(name => name && !present.has(name.toLowerCase()));
      return { id: entry.name, name: manifest.name, path: dir, imported: manifest.imported, files, materialx: manifest.materialx || null, missing,
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
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error(`${name} exceeds the 80 MB per-file limit.`);
  const currentBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
  if (manifest.files.length >= MAX_FILES) throw new Error(`A texture set can contain up to ${MAX_FILES} files.`);
  if (currentBytes + bytes.length > MAX_SET_BYTES) throw new Error('This texture set exceeds the 512 MB limit.');
  const materialx = path.extname(name).toLowerCase() === '.mtlx' ? materialXSummary(bytes.toString('utf8')) : null;
  const filePath = path.join(setDir, name);
  fs.writeFileSync(filePath, bytes, { flag: 'wx' });
  const role = roleFor(name);
  const metadata = role === 'MaterialX metadata (reference only)' ? null : textureMetadata(bytes, path.extname(name).toLowerCase());
  const file = { name, role, bytes: bytes.length, metadata };
  manifest.files.push(file);
  if (materialx) manifest.materialx = materialx;
  try { fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2)); }
  catch (error) { try { fs.unlinkSync(filePath); } catch { /* keep source data safe */ } throw error; }
  return file;
}

module.exports = { ROOT, MAX_FILES, MAX_FILE_BYTES, MAX_SET_BYTES, createTextureSet, addTextureFile, listTextureSets, roleFor, materialXSummary, textureMetadata, textureMetadataForPath };
