#!/usr/bin/env node
// stop.js - macOS/Linux counterpart of stop.ps1: stops the KeyShot Director process recorded by its own runtime marker,
// and nothing else. Anything else listening on the same port is left alone.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { serverMarkerFile } = require('../server/platform');

const START_TOLERANCE_MS = 15000;      // the marker is written just after the process starts; a reused PID is hours or days off

// What `ps` says about a process, or null when it is not running. Output is parsed in the C locale.
function inspectProcess(pid, run = execFileSync) {
  const ps = field => String(run('ps', ['-p', String(pid), '-o', field + '='], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } })).trim();
  try {
    const command = ps('command');
    if (!command) return null;
    return { command, started: Date.parse(ps('lstart')) };      // ps prints local time, which Date.parse also assumes
  } catch { return null; }                                       // ps exits non-zero when the process does not exist
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function stopServer({ root, port = null, fsx = fs, inspect = inspectProcess, kill = (pid, signal) => process.kill(pid, signal), wait = sleep, log = console.log }) {
  const marker = serverMarkerFile(root);
  if (!fsx.existsSync(marker)) { log(`No KeyShot Director process marker was found. Any other process using ${port ? 'port ' + port : 'a port'} was left alone.`); return 0; }
  let record;
  try { record = JSON.parse(fsx.readFileSync(marker, 'utf8')); }
  catch { log('The KeyShot Director process marker is invalid; no process was stopped.'); return 1; }
  const pid = Number(record.pid);
  if (!Number.isInteger(pid) || pid <= 0 || (port !== null && record.port !== port)) {
    log('The KeyShot Director process marker does not match this port; no process was stopped.');
    return 1;
  }
  const info = inspect(pid);
  const removeMarker = () => { try { fsx.unlinkSync(marker); } catch { /* already gone */ } };
  if (!info) { removeMarker(); log('KeyShot Director is not running; removed its stale process marker.'); return 0; }
  const expected = path.resolve(root, 'server', 'server.js');
  const at = info.command.toLowerCase().indexOf(expected.toLowerCase());
  if (at < 0 || !/\bnode\b/i.test(info.command.slice(0, at))) {
    log('The recorded process no longer matches this KeyShot Director installation; no process was stopped.');
    return 1;
  }
  // PID reuse can leave a stale marker pointing at an unrelated later process.
  if (record.started) {
    if (!Number.isFinite(info.started) || Math.abs(info.started - Number(record.started)) > START_TOLERANCE_MS) {
      log(Number.isFinite(info.started) ? 'The recorded process start time no longer matches; no process was stopped.' : 'Could not verify the recorded process start time; no process was stopped.');
      return 1;
    }
  }
  kill(pid, 'SIGTERM');
  for (let i = 0; i < 15 && inspect(pid); i++) await wait(200);
  if (inspect(pid)) kill(pid, 'SIGKILL');
  removeMarker();
  log(`Stopped KeyShot Director (process ${pid}).`);
  return 0;
}

if (require.main === module) {
  const at = process.argv.indexOf('--port');
  stopServer({ root: path.resolve(__dirname, '..'), port: at >= 0 ? Number(process.argv[at + 1]) : null })
    .then(code => process.exit(code), error => { console.error(error.message); process.exit(1); });
}

module.exports = { stopServer, inspectProcess, START_TOLERANCE_MS };
