#!/usr/bin/env node
// zip-release.js - writes the release ZIP for package.ps1. Windows' Compress-Archive and the .NET ZIP classes cannot record
// Unix permissions, so a ZIP made with them extracts on a Mac with the .command and .sh files not executable.
// This writer marks entries as created on Unix, sets mode 0755 for shell scripts and 0644 for everything else, uses forward
// slashes, and converts shell scripts to LF line endings (CRLF breaks "#!/bin/bash" on macOS).
//   node tools/zip-release.js <folder> <out.zip> [--top KeyShotDirector]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SHELL_SCRIPT = /\.(sh|command)$/i;
const UNIX_HOST = 3;
const MODE_FILE = 0o100644, MODE_EXEC = 0o100755, MODE_DIR = 0o040755;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
function crc32(buffer) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return { time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1), date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate() };
}

// entries: [{ name: 'Top/file.txt', data: Buffer, mode, mtime } | { name: 'Top/dir/', mode }]
function buildZip(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const isDir = entry.name.endsWith('/');
    const data = isDir ? Buffer.alloc(0) : entry.data;
    const deflated = isDir ? data : zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = !isDir && deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const stamp = dosTime(entry.mtime || new Date());
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8); local.writeUInt16LE(stamp.time, 10); local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE((UNIX_HOST << 8) | 30, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(useDeflate ? 8 : 0, 10); header.writeUInt16LE(stamp.time, 12); header.writeUInt16LE(stamp.date, 14);
    header.writeUInt32LE(crc, 16); header.writeUInt32LE(body.length, 20); header.writeUInt32LE(data.length, 24); header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE((((entry.mode << 16) >>> 0) | (isDir ? 0x10 : 0)) >>> 0, 38); header.writeUInt32LE(offset, 42);
    central.push(header, name);
    offset += 30 + name.length + body.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBytes, end]);
}

// Reads a ZIP back (central directory), so the release can be checked after it is written.
function readZip(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a ZIP file');
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('bad central directory');
    const method = buffer.readUInt16LE(at + 10), csize = buffer.readUInt32LE(at + 20), usize = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28), extraLength = buffer.readUInt16LE(at + 30), commentLength = buffer.readUInt16LE(at + 32);
    const external = buffer.readUInt32LE(at + 38), localAt = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    const dataAt = localAt + 30 + buffer.readUInt16LE(localAt + 26) + buffer.readUInt16LE(localAt + 28);
    entries.push({ name, host: buffer.readUInt16LE(at + 4) >> 8, mode: external >>> 16, size: usize,
      read: () => { const raw = buffer.subarray(dataAt, dataAt + csize); const out = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw); if (out.length !== usize) throw new Error('size mismatch for ' + name); return out; } });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function listFolder(root) {
  const out = [];
  const walk = dir => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) { out.push({ rel: path.relative(root, full).split(path.sep).join('/') + '/', full }); walk(full); }
      else if (item.isFile()) out.push({ rel: path.relative(root, full).split(path.sep).join('/'), full });
    }
  };
  walk(root);
  return out;
}

function zipFolder(folder, zipPath, { top = path.basename(path.resolve(folder)) } = {}) {
  const entries = [{ name: top + '/', mode: MODE_DIR }];
  for (const item of listFolder(folder)) {
    if (item.rel.endsWith('/')) { entries.push({ name: `${top}/${item.rel}`, mode: MODE_DIR }); continue; }
    let data = fs.readFileSync(item.full);
    const script = SHELL_SCRIPT.test(item.rel);
    if (script) data = Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    entries.push({ name: `${top}/${item.rel}`, data, mode: script ? MODE_EXEC : MODE_FILE, mtime: fs.statSync(item.full).mtime });
  }
  const zip = buildZip(entries);
  fs.writeFileSync(zipPath, zip);
  // Read it back and refuse a release a Mac could not use.
  const problems = [];
  for (const entry of readZip(zip)) {
    if (entry.name.includes('\\')) problems.push('backslash in entry name: ' + entry.name);
    if (entry.host !== UNIX_HOST) problems.push('not marked as created on Unix: ' + entry.name);
    if (!entry.name.endsWith('/') && SHELL_SCRIPT.test(entry.name)) {
      if ((entry.mode & 0o111) !== 0o111) problems.push('shell script is not executable: ' + entry.name);
      const text = entry.read().toString('utf8');
      if (text.includes('\r')) problems.push('shell script has CR line endings: ' + entry.name);
      if (!text.startsWith('#!')) problems.push('shell script has no #! line: ' + entry.name);
    }
  }
  if (problems.length) { fs.rmSync(zipPath, { force: true }); throw new Error('Release ZIP failed its macOS checks:\n' + problems.join('\n')); }
  return { entries: entries.length, bytes: zip.length };
}

if (require.main === module) {
  const [folder, zipPath] = process.argv.slice(2);
  const topAt = process.argv.indexOf('--top');
  if (!folder || !zipPath) { console.error('usage: node tools/zip-release.js <folder> <out.zip> [--top name]'); process.exit(2); }
  try {
    const result = zipFolder(folder, zipPath, topAt >= 0 ? { top: process.argv[topAt + 1] } : {});
    console.log(`Wrote ${zipPath} (${result.entries} entries, ${Math.round(result.bytes / 1024)} KB)`);
  } catch (error) { console.error(error.message); process.exit(1); }
}

module.exports = { buildZip, readZip, zipFolder, crc32, SHELL_SCRIPT, MODE_EXEC, MODE_FILE, MODE_DIR };
