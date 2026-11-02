// Platform-specific image conversion used for AI previews and style-folder analysis.
// Keep all external programs behind execFile so paths with spaces remain safe.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RESIZE_PS = path.join(ROOT, 'tools', 'resize.ps1');
const NORMALIZE_PS = path.join(ROOT, 'tools', 'normalize.ps1');
const IMAGE_EXT = /\.(jpe?g|png|bmp|tiff?|gif|webp|avif|heic|heif|jxl)$/i;

function run(file, args) {
  return new Promise((resolve, reject) => execFile(file, args, { maxBuffer: 1 << 26 }, (error, stdout, stderr) => {
    if (error) reject(new Error(String(stderr || error.message).trim()));
    else resolve(stdout);
  }));
}

// `deps` lets tests choose the platform and replace the program runner and file system.
async function resizeJpeg(input, output, maxDim = 900, deps = {}) {
  const platform = deps.platform || process.platform, exec = deps.run || run;
  if (platform === 'win32') {
    await exec('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', RESIZE_PS,
      '-In', input, '-Out', output, '-MaxDim', String(maxDim)]);
    return output;
  }
  if (platform === 'darwin') {
    await exec('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '-Z', String(maxDim), input, '--out', output]);
    return output;
  }
  throw new Error('Image conversion is supported on Windows and macOS.');
}

async function normalizeFolder(folder, outDir, maxDim = 900, deps = {}) {
  const platform = deps.platform || process.platform, exec = deps.run || run, fsx = deps.fs || fs;
  if (platform === 'win32') {
    const stdout = await exec('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', NORMALIZE_PS,
      '-Folder', folder, '-OutDir', outDir, '-MaxDim', String(maxDim)]);
    const data = JSON.parse(stdout || '[]');
    return Array.isArray(data) ? data : [data];
  }
  if (platform !== 'darwin') throw new Error('Style image conversion is supported on Windows and macOS.');

  fsx.mkdirSync(outDir, { recursive: true });
  const names = fsx.readdirSync(folder).filter(name => IMAGE_EXT.test(name) && !name.startsWith('.')).sort((a, b) => a.localeCompare(b));
  const results = [];
  for (const name of names) {
    const source = path.join(folder, name), png = path.join(outDir, path.parse(name).name + '.png');
    try {
      if (fsx.existsSync(png) && fsx.statSync(png).mtimeMs >= fsx.statSync(source).mtimeMs) {
        results.push({ name, png, status: 'cached' });
        continue;
      }
      await exec('sips', ['-s', 'format', 'png', '-Z', String(maxDim), source, '--out', png]);
      results.push({ name, png, status: 'ok' });
    } catch (error) {
      results.push({ name, png: null, status: 'error: ' + String(error.message).split('\n')[0] });
    }
  }
  return results;
}

module.exports = { resizeJpeg, normalizeFolder };
