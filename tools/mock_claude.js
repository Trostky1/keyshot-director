// mock_claude.js - a tiny stand-in for the Anthropic Messages API, used only to test the prompt box's plumbing without a key.
// It plays a fixed conversation (look -> set_light -> final answer) and checks that each request is shaped the way the real API expects.
const http = require('http');
const PORT = +(process.env.MOCK_PORT || 8899);
let turn = 0; const problems = [];
http.createServer((req, res) => {
  let d = ''; req.on('data', c => d += c); req.on('end', () => {
    const j = JSON.parse(d || '{}'), h = req.headers;
    const check = (c, m) => { if (!c) { problems.push(m); console.log('PROBLEM:', m); } };
    check(h['x-api-key'] === 'test-key', 'x-api-key header missing/wrong');
    check(h['anthropic-version'] === '2023-06-01', 'anthropic-version header missing');
    check(Array.isArray(j.tools) && j.tools.length >= 10 && j.tools.every(t => t.name && t.input_schema), 'tools malformed');
    check(typeof j.system === 'string' && j.system.length > 200, 'system prompt missing');
    check(Array.isArray(j.messages) && j.messages[0].role === 'user', 'first message must be user');
    const last = j.messages[j.messages.length - 1];
    if (turn === 0) { check(Array.isArray(last.content) && last.content.some(b => b.type === 'text'), 'turn0: user text block'); check(last.content.some(b => b.type === 'image'), 'turn0: attached image block missing'); }
    if (turn >= 1) {
      const tr = last.content.find(b => b.type === 'tool_result');
      check(tr && tr.tool_use_id, 'turn' + turn + ': tool_result missing/without id');
      if (turn === 1) check(Array.isArray(tr.content) && tr.content.some(b => b.type === 'image' && b.source.media_type === 'image/jpeg' && b.source.data.length > 1000), 'turn1: look() image not returned to the model');
    }
    let out;
    if (turn === 0) out = { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Let me look at the viewport first.' }, { type: 'tool_use', id: 'tu_1', name: 'look', input: {} }] };
    else if (turn === 1) out = { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_2', name: 'set_light', input: { id: 'key', brightness: 1.3, kelvin: 4800 } }] };
    else out = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Warmed the key light and raised it 30%.' }] };
    turn++;
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'msg_mock', type: 'message', role: 'assistant', ...out }));
    if (turn >= 3) setTimeout(() => { console.log(problems.length ? 'MOCK RESULT: ' + problems.length + ' problem(s)' : 'MOCK RESULT: all requests well-formed'); }, 300);
  });
}).listen(PORT, () => console.log('mock claude on', PORT));
