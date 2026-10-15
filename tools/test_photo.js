const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { cleanPlan, frame, reference, createDirector } = require('../server/photo');
const { decode } = require('../server/png');
// Minimal test PNG, no user files or KeyShot session needed.
const chunk = (type, data) => { const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type,4); data.copy(b,8); return b; };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(64); ihdr.writeUInt32BE(64,4); ihdr[8]=8; ihdr[9]=2;
const raw = Buffer.alloc(64 * 193, 180); for(let y=0;y<64;y++) raw[y*193]=0;
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',ihdr), chunk('IDAT',zlib.deflateSync(raw)), chunk('IEND',Buffer.alloc(0))]);
const image = 'data:image/png;base64,' + png.toString('base64');
const subject = {center:[0,0,0],size:[100,200,50],span:200};
const pose = {az:0,el:0,dist:400,fov:40,pivot:[0,0,0]};
const plan = {lights:[{gain:1}],environment:{background:[250,250,250]}};
function setup(t, overrides={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kd-photo-test-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const calls=[];
  const d=createDirector({root, snapshot:async()=>({subject,camera:pose}), capture:async(file)=>fs.writeFileSync(file,png),
    apply:async(p)=>calls.push(['apply',p]), restore:async()=>calls.push(['restore']), ask:async()=>({plan,engine:'stub-vision'}), ...overrides});
  return {d,calls};
}
test('plan bounds unsafe values and rejects missing lighting',()=>{
  assert.throws(()=>cleanPlan({lights:[]}));
  const p=cleanPlan({lights:[{gain:Infinity,az:1000,w:-10}],environment:{hdri:'../../private'}});
  assert.equal(p.lights[0].az,180); assert.equal(p.lights[0].w,0.05); assert.equal(p.lights[0].gain,1);
  assert.ok(!p.environment.hdri.includes('..')); assert.equal(p.lights[0].eye,false);
});
test('frame fits hero; detail permits closer camera; portrait backs away',()=>{
  const a=frame(subject,pose,{fill:0.75},16/9), b=frame(subject,pose,{kind:'detail',fill:1.5},16/9);
  assert.ok(a.dist>b.dist); assert.ok(frame(subject,pose,{fill:0.75},1).dist<a.dist);
  assert.deepEqual(frame(subject,pose,{focus:[0,0.3,0]}).pivot,[0,60,0]);
  assert.throws(()=>frame({size:[NaN,2,3]},pose,{}));
});
test('PNG upload validates format, pixel payload and dimensions',()=>{
  assert.equal(reference(image).aspect,1);
  assert.throws(()=>reference('data:image/jpeg;base64,eA=='));
  assert.throws(()=>decode(png.subarray(0,25)));
  const bad=Buffer.from(png); bad.writeUInt32BE(100000,16); assert.throws(()=>decode(bad));
});
test('successful match persists originals, outputs and recipe; undo once',async t=>{
  const {d,calls}=setup(t); const r=await d.start({image,quality:'quick'}); await d.wait();
  assert.equal(d.status().phase,'complete'); assert.equal(d.status().running,false);
  assert.ok(fs.existsSync(d.file(r.id,'recipe'))); assert.deepEqual(fs.readFileSync(d.file(r.id,'reference')),png);
  assert.throws(()=>d.file('../secret','after')); assert.throws(()=>d.file(r.id,'../../secret'));
  await d.undo(); assert.equal(calls.at(-1)[0],'restore'); await assert.rejects(()=>d.undo());
});
test('failed scene application rolls back baseline',async t=>{
  const {d,calls}=setup(t,{apply:async()=>{throw new Error('renderer failed');}});
  await d.start({image}); await d.wait(); assert.equal(d.status().phase,'failed'); assert.equal(calls.at(-1)[0],'restore');
});
test('cancel while planning prevents any scene change',async t=>{
  let entered; const ready=new Promise(r=>entered=r);
  const {d,calls}=setup(t,{ask:async(_i,_c,signal)=>{entered(); return new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});
  await d.start({image}); await ready; d.stop(); await d.wait(); assert.equal(d.status().phase,'canceled'); assert.equal(calls.length,0);
});
test('missing explicit reference region retains first plan without speculative refinement',async t=>{
  let n=0; const {d,calls}=setup(t,{ask:async()=>{if(n++) throw new Error('provider unavailable'); return {plan,engine:'stub'};}});
  await d.start({image}); await d.wait(); assert.equal(d.status().phase,'complete'); assert.equal(calls.filter(c=>c[0]==='apply').length,1);
  assert.match(d.status().result.limitations.join(' '),/Choose a reference measurement region/);
});
test('busy jobs reject a second start and undo',async t=>{
  let release; const held=new Promise(r=>release=r); const {d}=setup(t,{snapshot:async()=>{await held; return {subject};}});
  await d.start({image,quality:'quick'}); await assert.rejects(()=>d.start({image})); await assert.rejects(()=>d.undo()); release(); await d.wait();
});
