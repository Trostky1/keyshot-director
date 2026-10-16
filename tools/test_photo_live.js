// Opt-in live smoke test. Captures its own reference render, then restores the scene.
if (process.env.KD_RUN_LIVE_TESTS !== '1') { console.log('Skipped live KeyShot smoke test; set KD_RUN_LIVE_TESTS=1 to run it.'); process.exit(0); }
const assert = require('node:assert/strict');
const fs = require('fs');
const bridge = require('../server/bridge');
const path = require('path');
const base = 'http://localhost:8787';
async function api(route, data) {
  const r = await fetch(base + route, data === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const j = await r.json(); if(!r.ok) throw new Error(j.error); return j;
}
(async()=>{
  const camera = await bridge.send('get_camera'), lights = await bridge.send('lights_list'), environment = await bridge.send('env_info');
  const referencePath=path.join(bridge.SHOTS,'photo_smoke_reference_'+Date.now()+'.png');
  await bridge.send('grab',{path:referencePath,width:640,height:360,secs:2},120000);
  const png = fs.readFileSync(referencePath);
  const started = await api('/api/photo',{image:'data:image/png;base64,'+png.toString('base64'),quality:process.argv.includes('--refined')?'refined':'quick',framing:false,
    brief:'Match the reference neutral white-background phone render. Soft directional light, believable ground shadow. Preserve current viewing angle and every product material. This is an integration check.'});
  console.log('Started live match:',started.id);
  let status, phase=''; const deadline=Date.now()+240000;
  do { await new Promise(r=>setTimeout(r,2500)); status=await api('/api/photo');
    if(status.phase!==phase){phase=status.phase;console.log(phase+': '+status.log.at(-1));}
    if(Date.now()>deadline){await api('/api/photo/stop',{});throw new Error('Live match exceeded test budget; restoration requested.');}
  } while(status.running);
  if(status.error) throw new Error(status.error);
  assert.equal(status.phase,'complete'); assert.equal(status.result.engine,'codex');
  console.log('Vision plan:',status.plan.title, '|', status.plan.lights.length,'lights');
  console.log('Output:',path.join('references','_photos',started.id));
  try {
    const current=await bridge.send('lights_list');
    for(const id of Object.keys(lights)) assert.equal(current[id].hidden,true);
  } finally { await api('/api/photo/undo',{}); }
  const restored=await bridge.send('lights_list'), env=await bridge.send('env_info'), cam=await bridge.send('get_camera');
  assert.deepEqual(restored,lights); assert.deepEqual(env,environment);
  for(const key of ['pos','pivot','up']) for(let i=0;i<3;i++) assert.ok(Math.abs(cam[key][i]-camera[key][i])<0.01, key+' changed');
  console.log('PASS: actual signed-in Codex vision + native lights + actual render + original light/environment/camera restoration.');
})().catch(e=>{console.error('LIVE TEST FAILED:',e.message);process.exitCode=1;});
