// test_video.js - drive the "match a video" pipeline without a browser, from PNG frames on disk.
//   node tools/test_video.js <duration> [lighting=0|1] [render=WxH@fps:secs] frame1.png frame2.png ...
if (process.env.KD_RUN_LIVE_TESTS !== '1') { console.log('Skipped running-server video integration test; set KD_RUN_LIVE_TESTS=1 to run it.'); process.exit(0); }
const fs = require('fs');
const [duration, lighting, render, ...files] = process.argv.slice(2);
const post = (p, b) => fetch('http://localhost:' + (process.env.PORT || 8787) + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
const get = p => fetch('http://localhost:' + (process.env.PORT || 8787) + p).then(r => r.json());
const poll = async (p, tag) => { let n = 0; for (;;) { await new Promise(r => setTimeout(r, 2000)); const j = await get(p); for (; n < j.log.length; n++) console.log(tag, j.log[n]); if (!j.running) return j; } };
(async () => {
  const frames = files.map((f, i) => ({ t: +(i / (files.length - 1) * duration).toFixed(3), png: 'data:image/png;base64,' + fs.readFileSync(f).toString('base64') }));
  console.log(await post('/api/video', { frames, duration: +duration, lighting: lighting === '1', camera: true, rounds: 1 }));
  const j = await poll('/api/video', '[video]');
  if (j.result.error) return console.log('FAILED', j.result.error);
  console.log('calibration', JSON.stringify(j.result.calibration));
  console.log('recipe', JSON.stringify(j.result.recipe));
  if (render && render !== '0' && j.result.recipe) {
    const m = /^(\d+)x(\d+)@(\d+):(\d+)$/.exec(render);
    console.log(await post('/api/render', { recipe: j.result.recipe, width: +m[1], height: +m[2], fps: +m[3], secs: +m[4] }));
    const r = await poll('/api/render', '[render]'); console.log(JSON.stringify(r.result));
  }
})();
