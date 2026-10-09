// mock_plan.js - stand-in for the Anthropic API when testing "match a video" without a key. Returns a fixed shot plan
// and checks the request is shaped the way the real API expects (frames as image blocks, system prompt, no tools).
//   set ANTHROPIC_API_KEY=test-key & set ANTHROPIC_BASE_URL=http://localhost:8899 & node server\server.js
const http = require('http');
const PLAN = { summary: 'mock: slow orbit with a push-in, then a cut to a low close-up',
  lighting: { rig: 'glass_edge', mirror: false, notes: 'rim strips both sides, black backdrop' },
  keys: [{ t: 0, azimuth: 0, elevation: 10, fill: 0.5, x: 0, y: 0 }, { t: 2, azimuth: 90, elevation: 20, fill: 0.8, x: 0, y: 0, ease: 'easeInOut' }, { t: 2.2, azimuth: 30, elevation: 2, fill: 1.3, x: 0.1, y: 0, cut: true }, { t: 3, azimuth: 10, elevation: 2, fill: 1.3, x: -0.1, y: 0, ease: 'linear' }] };
http.createServer((req, res) => { let d = ''; req.on('data', c => d += c); req.on('end', () => {
  const j = JSON.parse(d || '{}'), imgs = (j.messages?.[0]?.content || []).filter(b => b.type === 'image');
  const bad = []; if (req.headers['x-api-key'] !== 'test-key') bad.push('x-api-key'); if (!j.system || j.system.length < 200) bad.push('system'); if (imgs.length < 2) bad.push('images'); if (imgs.some(i => i.source.media_type !== 'image/png' || i.source.data.length < 500)) bad.push('image blocks'); if (j.tools) bad.push('unexpected tools');
  console.log(bad.length ? 'PROBLEMS: ' + bad.join(', ') : `request ok: ${imgs.length} frames, model ${j.model}`);
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'msg_mock', type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here is the plan:\n' + JSON.stringify(PLAN) }] }));
}); }).listen(+(process.env.MOCK_PORT || 8899), () => console.log('mock plan API on', process.env.MOCK_PORT || 8899));
