// test_cli_engine.js - checks the CLI engine's plumbing with the real `claude` call stubbed out (no sign-in needed).
// Verifies: conversation is rendered with image files, JSON replies become tool calls, prose replies end the turn,
// and video analysis hands frame files to the CLI and parses its plan.
const fs = require('fs');
const cli = require('../server/cli');
const seen = [];
cli.status = async () => ({ found: true, loggedIn: true, path: 'fake-claude' });
let n = 0;
cli.ask = async ({ system, prompt, dir }) => {
  const imgs = [...prompt.matchAll(/\[image: ([^\]]+)\]/g)].map(m => m[1]);
  seen.push({ n: ++n, sys: system.length, prompt, imgs: imgs.map(p => fs.existsSync(p)), tools: /apply_rig/.test(system) });
  if (/frame_01/.test(prompt)) return 'Sure:\n```json\n' + JSON.stringify({ summary: 'stub', lighting: { rig: 'dark_moody', mirror: true, notes: 'n' }, keys: [{ t: 0, azimuth: 0, elevation: 8, fill: 0.5 }, { t: 2, azimuth: 120, elevation: 15, fill: 0.9 }] }) + '\n```';
  if (n === 1) return JSON.stringify({ say: 'Building a moody rig.', calls: [{ name: 'apply_rig', input: { name: 'dark_moody' } }, { name: 'not_a_tool', input: {} }] });
  return 'All set - moody rig is on.';
};
const agent = require('../server/agent');
const video = require('../server/video');
const png = fs.readFileSync(process.argv[2]);
(async () => {
  const eng = await agent.pickEngine({}); console.log('engine:', eng.engine);
  const job = { events: [], done: false }; const called = [];
  const actions = { setAttachments() {}, async apply_rig(i) { called.push(i); return { summary: 'rig ok' }; } };
  await agent.run(job, { text: 'moody please', images: ['data:image/png;base64,' + png.toString('base64')] }, actions);
  console.log('calls:', JSON.stringify(called), '| events:', job.events.map(e => e.type + (e.text ? ':' + e.text : '')).join(' / '));
  console.log('image file existed when the CLI was called:', seen[0].imgs, '| tools described:', seen[0].tools);
  const r = await video.analyze([{ t: 0, png }, { t: 1, png }, { t: 2, png }], 2, {});
  console.log('video plan via CLI:', r.engine, r.plan.lighting.rig, r.plan.lighting.mirror, r.plan.keys.map(k => k.azimuth).join(','));
  process.exit(0);
})().catch(e => { console.log('FAILED', e); process.exit(1); });
