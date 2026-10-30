// platform.js - the few places where Windows, macOS and other systems differ. Every input is a parameter, so tests can
// run each platform's branch on any machine without touching the real file system or launching a program.
const path = require('path');

// The program that opens a page in the user's default browser, or null when this platform has no known opener.
function openUrlCommand(url, platform = process.platform) {
  if (platform === 'win32') return { file: 'cmd', args: ['/c', 'start', '""', url] };
  if (platform === 'darwin') return { file: 'open', args: [url] };
  return null;
}

// The program that shows a folder in the system file manager.
function openFolderCommand(target, platform = process.platform) {
  if (platform === 'win32') return { file: 'explorer.exe', args: [target] };
  if (platform === 'darwin') return { file: 'open', args: [target] };
  return { file: 'xdg-open', args: [target] };
}

// The runtime marker the server writes so a launcher can stop exactly this server and nothing else.
function serverMarkerFile(appRoot) { return path.join(appRoot, 'bridge', 'director-server.json'); }

function serverMarkerRecord({ pid, port, entry, now = Date.now() }) {
  return { pid, port, started: now, entry: path.resolve(entry) };
}

function writeServerMarker(appRoot, record, fs) {
  fs.writeFileSync(serverMarkerFile(appRoot), JSON.stringify(record), 'utf8');
}

// Only the process that wrote the marker removes it.
function removeServerMarker(appRoot, { pid, entry }, fs) {
  const marker = serverMarkerFile(appRoot);
  try {
    const record = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (record.pid === pid && path.resolve(record.entry || '') === path.resolve(entry)) { fs.unlinkSync(marker); return true; }
  } catch { /* already stopped, or a different app instance owns the marker */ }
  return false;
}

// A research-lab scene path arrives from the browser and names a Windows or a macOS file. Both spellings must work on
// either host, so the check is purely textual.
function isAbsoluteScenePath(value) {
  return typeof value === 'string' && (path.win32.isAbsolute(value) || path.posix.isAbsolute(value));
}
function sceneBaseName(value) {
  return String(value).split(/[\\/]/).pop();
}

// The one statement pasted into KeyShot's scripting console. The folder sits inside a Python string that is itself inside an
// exec("...") string, so a quote or backslash in the path (Ben's Files) must be escaped once for each level.
function connectLine(appRoot) {
  const root = path.resolve(appRoot).split(path.sep).join('/');
  const inner = root.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const outer = inner.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `exec("KD_HOME = '${outer}'; exec(open(KD_HOME + '/bridge/cc_bridge.py', encoding='utf-8-sig').read())")`;
}

module.exports = { connectLine, openUrlCommand, openFolderCommand, serverMarkerFile, serverMarkerRecord, writeServerMarker, removeServerMarker, isAbsoluteScenePath, sceneBaseName };
