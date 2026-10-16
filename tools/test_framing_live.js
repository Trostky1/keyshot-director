// Opt-in cropped-detail smoke test; native checkpoint always restores the user's view.
if (process.env.KD_RUN_LIVE_TESTS !== '1') { console.log('Skipped live KeyShot smoke test; set KD_RUN_LIVE_TESTS=1 to run it.'); process.exit(0); }
const assert=require('node:assert/strict');
const path=require('path');
const fs=require('fs');
const bridge=require('../server/bridge');
const {decode}=require('../server/png');
async function api(route,data){const r=await fetch('http://localhost:8787'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const j=await r.json();if(!r.ok)throw new Error(j.error);return j;}
(async()=>{
  const before=await bridge.send('get_camera'), backup=await bridge.send('camera_checkpoint',{},30000);
  try {
    await api('/api/frame',{kind:'detail',focus:[0,0.3,0],fill:1.5,fov:35,aspect:0.8});
    const p=path.resolve('bridge/shots/closeup_live_'+Date.now()+'.png');
    await bridge.send('grab',{path:p,width:384,height:480,secs:3},120000);
    const img=decode(fs.readFileSync(p)); assert.equal(img.w,384);assert.equal(img.h,480);
    const cam=await bridge.send('get_camera'); assert.ok(Math.abs(cam.fov-35)<0.01); console.log('Detail render:',p);
  } finally {
    await bridge.send('camera_restore',{name:backup.name},30000);await api('/api/rebase',{});
  }
  const after=await bridge.send('get_camera');for(const key of ['pos','up'])for(let i=0;i<3;i++)assert.ok(Math.abs(before[key][i]-after[key][i])<0.01);
  assert.ok(Math.abs(after.fov-before.fov)<0.01);console.log('PASS: actual portrait close-up rendered and native camera restored.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
