const test = require('node:test');
const assert = require('node:assert/strict');
const style = require('../server/style');
const { runStyleSearch } = require('../server/style-search');
const { compareCaptures } = require('../server/lighting-evidence');
const image = (w, h, px) => ({ w, h, px });

test('Clown mask meters a dark target and projected bounds exclude an unrelated bright object', () => {
  const beauty = image(20, 10, x => x < 10 ? [12,12,12] : [240,240,240]);
  const mask = image(20, 10, () => [255,0,0]);
  const measured = style.features(beauty, { mask, region: { x0: 0, y0: 0, x1: 0.5, y1: 1 } });
  assert.equal(measured.p50, 0.047);
  assert.equal(measured.p95, 0.047);
  assert.match(measured.measurement_scope, /occluders/);
  assert.equal(style.features(beauty, { mask }).p95, 0.941);
});

test('empty, mismatched and invalid projected masks fail rather than falling back to the whole frame', () => {
  const beauty = image(20, 10, () => [100,100,100]);
  assert.throws(() => style.features(beauty, { mask: image(19,10,()=>[255,0,0]) }), /dimensions/);
  assert.throws(() => style.features(beauty, { mask: image(20,10,()=>[0,0,0]) }), /No labelled/);
  assert.throws(() => style.features(beauty, { region: {x0:0,y0:0,x1:1,y1:1} }), /aligned object mask/);
  assert.throws(() => style.features(beauty, { mask: beauty, region: {x0:1,y0:0,x1:0,y1:1} }), /normalized bounds/);
});

test('style profiles reject nonfinite metrics instead of returning a NaN objective', () => {
  assert.throws(() => style.score({ p50: NaN }, { p50: { med:1,lo:0,hi:2,iqr:1 } }), /no finite/);
  assert.throws(() => style.score({ p50: 0.3 }, {}), /no finite/);
  assert.equal(style.score({ p50:0.3 }, {p50:{ med:0.3,lo:0.2,hi:0.4 }}).distance, 0);
});

function setup(distance, changes = {}) {
  let value = 1, renders = 0;
  const writes = [];
  const param = { id:'gain', get:()=>value, set:async v=>{ value=v; writes.push(v); }, min:0.1,max:5,step:2,mul:true };
  const measure = async ({previousRunId,phase}) => {
    renders++;
    return { distance:distance(value,renders,phase), run_id:'run-'+renders, comparison: previousRunId ? {available:true} : undefined };
  };
  return { options:{ params:[param],measure,...changes }, value:()=>value, renders:()=>renders, writes };
}

test('style search estimates repeat error and keeps a better measured state', async () => {
  const s=setup(v=>Math.abs(v-2));
  const result=await runStyleSearch(s.options);
  assert.equal(s.value(),2); assert.equal(result.finalDistance,0); assert.equal(result.tuned.gain,2);
  assert.equal(result.noiseDistance,0); assert.equal(result.acceptanceMargin,0.004);
  assert.ok(result.captures<=16);
});

test('an apparent improvement smaller than repeated score noise is rejected and restored', async () => {
  const s=setup((v,n)=>n===2 ? 1.2 : v===1 ? 1 : 0.9);
  const result=await runStyleSearch(s.options);
  assert.ok(Math.abs(result.acceptanceMargin-0.4)<1e-10);
  assert.equal(s.value(),1); assert.equal(result.finalDistance,1);
  assert.equal(result.stopReason,'no_measured_improvement');
});

test('capture limit is clamped to sixteen and no unmeasured probe survives a deadline', async () => {
  let clock=0;
  const s=setup(v=>5-v,{maxMs:5,now:()=>clock});
  s.options.params[0].set=async v=>{s.writes.push(v); clock+=10;};
  const result=await runStyleSearch(s.options);
  assert.equal(result.stopReason,'deadline'); assert.equal(result.captures,2);
  assert.deepEqual(s.writes,[2,1]);
  let captures=0;
  const params=Array.from({length:20},(_,i)=>({id:'p'+i,get:()=>1,set:async()=>{},min:0,max:2,step:0.1,mul:false}));
  const bounded=await runStyleSearch({params,maxCaptures:999,measure:async({previousRunId})=>({distance:10-0.1*++captures,run_id:'r'+captures,comparison:previousRunId?{available:true}:undefined})});
  assert.equal(bounded.captures,16); assert.equal(bounded.stopReason,'capture_budget');
});

test('failed or incompatible captures restore best values and expose useful failure state', async () => {
  const s=setup(()=>1);
  const base=s.options.measure;
  s.options.measure=async input=>{const result=await base(input); if(input.phase==='probe') throw new Error('Renderer failed'); return result;};
  await assert.rejects(runStyleSearch(s.options),error=>error.message==='Renderer failed' && error.searchResult.tuned.gain===1);
  assert.equal(s.value(),1);
  const bad=setup(()=>1), baseline=bad.options.measure;
  const compatibility={camera_hash:'a',scene_identity_hash:'s',geometry_identity_hash:'g',render_options_hash:'o',render_engine:1,width:640,height:400,max_render_seconds:2};
  bad.options.measure=async input=>{const r=await baseline(input); if(input.phase==='probe') r.comparison=compareCaptures([],[],1e-4,{require_metadata:true,reference:{compatibility},candidate:{compatibility:{...compatibility,camera_hash:'changed'}}}); return r;};
  await assert.rejects(runStyleSearch(bad.options),/incompatible/);
  assert.equal(bad.value(),1);
});

test('cancellation and restoration failures are reported without hiding the original error', async () => {
  const controller=new AbortController(), s=setup(()=>1,{signal:controller.signal});
  const measure=s.options.measure;
  s.options.measure=async input=>{const r=await measure(input);if(input.phase==='probe')controller.abort(new Error('User stopped'));return r;};
  await assert.rejects(runStyleSearch(s.options),error=>/User stopped/.test(error.message)&&error.searchResult.stopReason==='canceled');
  assert.equal(s.value(),1);
  const broken=setup(()=>1); let writes=0;
  broken.options.params[0].set=async()=>{if(++writes>1)throw new Error('Bridge disconnected');};
  broken.options.measure=async input=>{if(input.phase==='probe')throw new Error('Capture lost'); return {distance:1,run_id:'baseline',comparison:{available:true}};};
  await assert.rejects(runStyleSearch(broken.options),/Capture lost.*restoration needs attention.*Bridge disconnected/);
});
