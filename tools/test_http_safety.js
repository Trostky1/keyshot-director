// Opt-in checks against a running local Director. All writes are intentionally invalid; scene stays unchanged.
const assert = require('node:assert/strict');
const base='http://localhost:8787';
(async()=>{
  let r=await fetch(base+'/api/photo',{method:'POST',headers:{'Content-Type':'application/json'},body:'not json'});
  assert.equal(r.status,400);
  r=await fetch(base+'/api/photo',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"image":"wrong"}'});
  assert.equal(r.status,400);
  r=await fetch(base+'/api/photo/stop',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:'{}'});
  assert.equal(r.status,403);
  r=await fetch(base+'/api/photo/file?id=..%2Fprivate&slot=after'); assert.ok(!r.ok);
  r=await fetch(base+'/api/rig',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"name":"does_not_exist"}'}); assert.ok(!r.ok);
  r=await fetch(base+'/api/photo'); assert.equal(r.status,200); assert.equal((await r.json()).running,false);
  console.log('PASS: malformed JSON, invalid photo, cross-site command, output traversal and invalid rig safely rejected.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
