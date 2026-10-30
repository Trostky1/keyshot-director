#!/usr/bin/env node
// install-launcher.js - writes the "KeyShot Director.py" launcher that KeyShot lists in its Scripts tab (macOS installer).
// It does what install.ps1 does on Windows: find KeyShot's Scripts folder, refuse to replace a script it did not write,
// and point the launcher at this folder. Every outside input is a parameter so tests run it on any platform.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const MARKER = '# AUTHOR KeyShot Director';
const OLD_MARKER = 'KEYSHOT_DIRECTOR_MANAGED_LAUNCHER';          // written by the first macOS installer
const LAUNCHER_NAME = 'KeyShot Director.py';

function launcherSource(root) {
  const kdHome = JSON.stringify(root);
  return `# -*- coding: utf-8 -*-
${MARKER}
# VERSION 1.0
# Connects KeyShot to the KeyShot Director app. Start the app first (Start KeyShot Director.command), save your scene, then run this.
# (Written by install-mac.sh. You can also paste the one-line connect command shown in the app into the scripting console.)
# SAVE YOUR SCENE FIRST. While it runs, plain viewport interaction is fine; do not run other scripts, open dialogs or close panels.
import os
KD_HOME = ${kdHome}
if not os.path.isfile(os.path.join(KD_HOME, "bridge", "cc_bridge.py")):
    raise Exception("KeyShot Director was moved or deleted. Run install-mac.sh again from its folder. Looked in: " + KD_HOME)
exec(open(os.path.join(KD_HOME, "bridge", "cc_bridge.py"), encoding="utf-8-sig").read())
`;
}

function isManaged(text) { return text.includes(MARKER) || text.includes(OLD_MARKER); }

// KeyShot keeps its user folder at ~/Documents/KeyShot <version>; the Scripts folder is inside it. Newest version first.
function discoverScriptsFolders({ home, fsx = fs }) {
  const documents = path.join(home, 'Documents');
  let names = [];
  try { names = fsx.readdirSync(documents); } catch { return []; }
  const year = name => Number((name.match(/(\d{4})/) || [])[1]) || 0;
  return names.filter(name => /^KeyShot/i.test(name))
    .map(name => ({ name, scripts: path.join(documents, name, 'Scripts') }))
    .filter(entry => { try { return fsx.statSync(entry.scripts).isDirectory(); } catch { return false; } })
    .sort((a, b) => year(b.name) - year(a.name) || b.name.localeCompare(a.name))
    .map(entry => entry.scripts);
}

function fallbackScriptsFolder(home) { return path.join(home, 'Library', 'Application Support', 'KeyShot Director', 'Scripts'); }

function installLauncher({ root, scriptsFolder, fsx = fs }) {
  fsx.mkdirSync(scriptsFolder, { recursive: true });
  const target = path.join(scriptsFolder, LAUNCHER_NAME);
  let existing = null;
  try { existing = fsx.readFileSync(target, 'utf8'); } catch { /* none yet */ }
  if (existing !== null && !isManaged(existing)) return { ok: false, target, reason: 'unmanaged' };
  fsx.writeFileSync(target, launcherSource(root), { encoding: 'utf8', mode: 0o644 });
  return { ok: true, target };
}

async function choose(candidates, ask) {
  console.log('Several KeyShot folders found:');
  candidates.forEach((c, i) => console.log(`  [${i}] ${c}`));
  for (;;) {
    const answer = String(await ask('Enter the number for the KeyShot version you use, or paste its Scripts folder path: ')).trim();
    if (/^\d+$/.test(answer) && Number(answer) < candidates.length) return candidates[Number(answer)];
    if (answer && fs.existsSync(answer) && fs.statSync(answer).isDirectory()) return answer;
    console.log('That choice is not valid. Enter one of the listed numbers or an existing Scripts folder path.');
  }
}

async function main(argv, deps = {}) {
  const home = deps.home || os.homedir(), fsx = deps.fs || fs, log = deps.log || console.log;
  const root = path.resolve(argv[0] || path.join(__dirname, '..'));
  let scriptsFolder = null;
  const flag = argv.indexOf('--scripts-folder');
  if (flag >= 0) {
    scriptsFolder = argv[flag + 1];
    if (!scriptsFolder) { log('--scripts-folder needs a folder path.'); return 2; }
  }
  let manualStep = false;
  if (!scriptsFolder) {
    const found = discoverScriptsFolders({ home, fsx });
    if (found.length === 1) scriptsFolder = found[0];
    else if (found.length > 1) {
      if (deps.ask || process.stdin.isTTY) {
        const rl = deps.ask ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
        try { scriptsFolder = await choose(found, deps.ask || (q => new Promise(resolve => rl.question(q, resolve)))); } finally { if (rl) rl.close(); }
      } else {
        scriptsFolder = found[0];
        log(`Several KeyShot folders found; using the newest: ${scriptsFolder}`);
      }
    } else {
      scriptsFolder = fallbackScriptsFolder(home);
      manualStep = true;
      log("Could not find KeyShot's Scripts folder under ~/Documents (KeyShot creates it the first time it runs).");
    }
  }
  const result = installLauncher({ root, scriptsFolder, fsx });
  if (!result.ok) {
    log(`An existing KeyShot script is already named ${LAUNCHER_NAME} and was not written by this installer, so it was left untouched:\n${result.target}`);
    log("Rename that script in KeyShot's Scripts folder, then run this installer again.");
    return 1;
  }
  log(`KeyShot launcher installed: ${result.target}`);
  if (manualStep) {
    log('Add this folder in KeyShot: Preferences > Folders > Scripts');
    log(`  ${scriptsFolder}`);
    log('(Or run:  bash install-mac.sh --scripts-folder "<your KeyShot Scripts folder>"  once KeyShot has created it.)');
  }
  log('\nDone. To use it:');
  log('  1. Double-click Start KeyShot Director.command (leave its window open; the page opens in your browser).');
  log("  2. In KeyShot: open your scene, SAVE IT, then Scripting window -> 'KeyShot Director' -> Run.");
  log("  3. The page header turns to 'KeyShot connected'.");
  return 0;
}

if (require.main === module) {
  // argv[2] is the app folder passed by install-mac.sh; the rest are options.
  main(process.argv.slice(2)).then(code => process.exit(code), error => { console.error(error.message); process.exit(1); });
}

module.exports = { launcherSource, isManaged, discoverScriptsFolders, fallbackScriptsFolder, installLauncher, main, LAUNCHER_NAME };
