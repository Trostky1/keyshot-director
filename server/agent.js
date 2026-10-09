// agent.js - the prompt box. Turns plain language (and attached reference images) into actions on the live KeyShot scene.
//
// Two engines share one tool loop:
//   * Claude (needs the user's own Anthropic API key, saved locally in config.local.json - never shared or uploaded elsewhere)
//   * Offline mode (no key): a small keyword router for the basic commands, so the app is usable and testable without AI.
const fs = require('fs');
const path = require('path');

const CONFIG = path.join(__dirname, '..', 'config.local.json');
const getConfig = () => { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; } };
const setConfig = patch => { const c = { ...getConfig(), ...patch }; fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2)); return c; };
const publicConfig = () => { const c = getConfig(); return { hasKey: !!(c.apiKey || process.env.ANTHROPIC_API_KEY), model: c.model || 'claude-sonnet-5-5' }; };

const SYSTEM = `You are the director inside "KeyShot Director", a companion app that drives the user's OPEN KeyShot scene live. You light and move the camera around the user's own product, so a non-expert can get studio-grade results in plain language.

How to work
- Act through the tools; do not just describe. After changing something, call look to check the live viewport and judge it like a photographer (exposure, contrast, highlights, backdrop, where the light falls) and fix obvious problems before reporting.
- Lighting is the priority. Start from a rig (apply_rig) that fits the request, then tune with set_light / set_exposure / auto_expose. A rig adapts to the product's size automatically. Only build lights by hand when no rig is close.
- For "make it look like these images": use_attached_images_as_style, then match_style. If the user names an existing style folder, analyze_style (if needed) then match_style.
- Camera: set_camera for a still angle; play_motion for a move (orbit, push-in, reveal, crane, whip). These preview live in the viewport. To turn a move into a video, or to copy the lighting and camera work of a reference VIDEO, point the user at the "Reference video" panel (drop a clip, then Play move / Render video); you cannot do that from here.
- KeyShot already has its own materials, environments, cameras, timeline and render dialog. Do not try to replace those; tell the user to use KeyShot for them. Never save the scene or render unless asked.
- Be concise. Say what you changed in one or two plain sentences. If a request is ambiguous in a way that changes the result a lot, ask one short question; otherwise pick a sensible default and say which.
- Everything you create is named CC_L_* and can be removed with studio_off, which restores the user's original environment. Mention that when you first add lights.

Rigs: hero_soft (3-point, graphite backdrop), dark_moody (single big side key, near-black), glass_edge (edge-lit strips + back glow for glass/liquid), blank_studio (clean seamless white, catalog look), warm_luxe (warm key, deep brown-black). Light angles: azimuth 0 = straight on from the camera, negative = camera-left, positive = camera-right; elevation 0 = level, 90 = overhead; distance in multiples of the product size.`;

const TOOLS = [
  { name: 'get_state', description: 'Current rig, lights, exposure, camera pose, product size, and the style folders available.', input_schema: { type: 'object', properties: {} } },
  { name: 'look', description: 'Take a picture of the live KeyShot viewport (it is noisy while the real-time render converges; judge tone and light, not noise) plus brightness stats of the product.', input_schema: { type: 'object', properties: {} } },
  { name: 'apply_rig', description: 'Replace any previous AI lights with a ready-made studio rig scaled to the product, and auto-balance its exposure.', input_schema: { type: 'object', properties: { name: { type: 'string', enum: ['hero_soft', 'dark_moody', 'glass_edge', 'blank_studio', 'warm_luxe'] }, mirror: { type: 'boolean', description: 'flip left/right' }, auto_exposure: { type: 'boolean', description: 'default true' } }, required: ['name'] } },
  { name: 'set_light', description: 'Create or adjust one light (rectangular softbox/strip). Omitted fields keep their value.', input_schema: { type: 'object', properties: { id: { type: 'string' }, azimuth: { type: 'number', description: 'degrees, 0 = from camera side, negative = camera-left' }, elevation: { type: 'number', description: 'degrees above level' }, distance: { type: 'number', description: 'multiples of product size, 1.2-6' }, width: { type: 'number', description: 'multiples of product size' }, height: { type: 'number' }, brightness: { type: 'number', description: 'multiplier, 1 = rig default' }, kelvin: { type: 'number', description: '2000 warm - 9000 cool' }, in_reflections: { type: 'boolean' } }, required: ['id'] } },
  { name: 'remove_light', description: 'Remove one light.', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'set_exposure', description: 'Scale all lights (and the environment on white rigs). 1 = rig default, 2 = one stop brighter.', input_schema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] } },
  { name: 'auto_expose', description: 'Measure the viewport and adjust exposure to the rig\'s target brightness.', input_schema: { type: 'object', properties: {} } },
  { name: 'studio_off', description: 'Remove every light this app made and restore the original environment.', input_schema: { type: 'object', properties: {} } },
  { name: 'set_camera', description: 'Set the camera around the product. Angles in degrees; with relative=true values are added to the current camera.', input_schema: { type: 'object', properties: { azimuth: { type: 'number' }, elevation: { type: 'number' }, distance: { type: 'number', description: 'mm from product centre' }, fov: { type: 'number', description: 'field of view degrees' }, relative: { type: 'boolean' } } } },
  { name: 'play_motion', description: 'Play a camera move in the live viewport.', input_schema: { type: 'object', properties: { preset: { type: 'string', enum: ['orbit_360', 'push_in', 'hero_reveal', 'crane_up', 'whip_settle'] }, duration: { type: 'number', description: 'seconds' } }, required: ['preset'] } },
  { name: 'analyze_style', description: 'Measure every image in a style folder (references/<name>) and build its look profile.', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'use_attached_images_as_style', description: 'Save the images attached to this message as a style folder named "_prompt" and analyze them.', input_schema: { type: 'object', properties: {} } },
  { name: 'match_style', description: 'Tune the current rig toward a style folder\'s look by measuring the live viewport (takes 1-3 minutes). Build a rig first.', input_schema: { type: 'object', properties: { name: { type: 'string' }, look: { type: 'string', description: 'optional look id, e.g. light or dark' } }, required: ['name'] } },
];

// ------------------------------------------------------------------------------------------------------------------------
async function callClaude(cfg, messages, signal) {
  const key = cfg.apiKey || process.env.ANTHROPIC_API_KEY;
  const base = (cfg.baseUrl || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');   // override only for proxies / tests
  const r = await fetch(base + '/v1/messages', {
    method: 'POST', signal,
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: cfg.model || 'claude-sonnet-5-5', max_tokens: 2048, system: SYSTEM, tools: TOOLS, messages }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 401 ? 'The API key was rejected - check it in Settings.' : (j.error && j.error.message) || ('API error ' + r.status));
  return j;
}

// Offline engine: maps simple phrases to the same tool calls. Not AI - it only knows the basics.
function offlineModel(text) {
  const t = (text || '').toLowerCase(); const calls = []; let say = '';
  const rig = [['hero', 'hero_soft'], ['3-point', 'hero_soft'], ['three point', 'hero_soft'], ['moody', 'dark_moody'], ['dark', 'dark_moody'], ['glass', 'glass_edge'], ['edge', 'glass_edge'], ['blank', 'blank_studio'], ['white', 'blank_studio'], ['clean', 'blank_studio'], ['catalog', 'blank_studio'], ['e-commerce', 'blank_studio'], ['ecommerce', 'blank_studio'], ['warm', 'warm_luxe'], ['luxe', 'warm_luxe'], ['luxury', 'warm_luxe']].find(([k]) => t.includes(k));
  if (/studio off|remove (all )?(the )?lights|reset (the )?light|clear (the )?light|restore/.test(t)) calls.push({ name: 'studio_off', input: {} });
  else if (/match|look like|style/.test(t)) { const m = t.match(/(?:style|folder|match)\s+(?:to\s+)?["']?([a-z0-9_\-]+)/); calls.push(...(m && !['the', 'my', 'these', 'this'].includes(m[1]) ? [{ name: 'match_style', input: { name: m[1] } }] : [])); if (!calls.length) say = 'Name a style folder, e.g. "match ecommerce" (offline mode cannot read attached images).'; }
  else if (rig) calls.push({ name: 'apply_rig', input: { name: rig[1], mirror: /mirror|flip/.test(t) } });
  if (/auto.?expos/.test(t)) calls.push({ name: 'auto_expose', input: {} });
  else if (/brighter|more light|increase exposure|lighter/.test(t)) calls.push({ name: 'set_exposure', input: { value: 1.4 } });
  else if (/darker|less light|decrease exposure|dim/.test(t)) calls.push({ name: 'set_exposure', input: { value: 0.7 } });
  const mot = [['orbit', 'orbit_360'], ['turntable', 'orbit_360'], ['spin', 'orbit_360'], ['push', 'push_in'], ['zoom in', 'push_in'], ['reveal', 'hero_reveal'], ['crane', 'crane_up'], ['whip', 'whip_settle']].find(([k]) => t.includes(k));
  if (mot) calls.push({ name: 'play_motion', input: { preset: mot[1] } });
  if (/\b(look|show|see|check)\b/.test(t) && !calls.length) calls.push({ name: 'look', input: {} });
  if (/state|status|what.*(now|rig|lights)/.test(t) && !calls.length) calls.push({ name: 'get_state', input: {} });
  if (!calls.length && !say) say = 'Offline mode understands: a rig name (hero, moody, glass, blank/white, warm), "studio off", "brighter/darker", "auto expose", "orbit / push in / reveal / crane / whip", "match <style folder>", "look". Add an API key in Settings for free-form prompts and attached images.';
  return { offline: true, text: say, calls };
}

// ------------------------------------------------------------------------------------------------------------------------
const history = [];                                   // conversation memory (server session)
// A conversation window must start at a plain user message: a tool_result with no tool_use before it is rejected by the API.
const isPlainUser = m => m.role === 'user' && (typeof m.content === 'string' || !m.content.some(b => b.type === 'tool_result'));
function trimHistory() {
  while (history.length > 24) history.shift();
  while (history.length && !isPlainUser(history[0])) history.shift();
  // drop images from older turns to keep requests small
  history.forEach((m, i) => { if (i < history.length - 2 && Array.isArray(m.content)) m.content = m.content.map(b => b.type === 'image' ? { type: 'text', text: '[earlier image omitted]' } : (b.type === 'tool_result' && Array.isArray(b.content) ? { ...b, content: b.content.map(c => c.type === 'image' ? { type: 'text', text: '[earlier image omitted]' } : c) } : b)); });
}

async function run(job, { text, images = [] }, actions) {
  const ev = (type, data) => job.events.push({ type, ...data, t: Date.now() });
  const cfg = getConfig(); const useClaude = !!(cfg.apiKey || process.env.ANTHROPIC_API_KEY);
  try {
    ev('mode', { mode: useClaude ? 'claude' : 'offline', model: useClaude ? (cfg.model || 'claude-sonnet-5-5') : null });
    actions.setAttachments(images);
    const content = [...images.map(d => { const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(d); return m ? { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } } : null; }).filter(Boolean), { type: 'text', text: text || '' }];
    history.push({ role: 'user', content: useClaude ? content : text });
    const ctl = new AbortController(); job.abort = () => ctl.abort();
    for (let turn = 0; turn < 14; turn++) {
      let resp;
      if (useClaude) resp = await callClaude(cfg, history, ctl.signal);
      else {
        if (turn > 0) break;                                    // offline: one pass of calls, then stop
        const o = offlineModel(text); resp = { stop_reason: o.calls.length ? 'tool_use' : 'end_turn', content: [...(o.text ? [{ type: 'text', text: o.text }] : []), ...o.calls.map((c, i) => ({ type: 'tool_use', id: 'off' + i, name: c.name, input: c.input }))] };
      }
      history.push({ role: 'assistant', content: resp.content });
      for (const b of resp.content) if (b.type === 'text' && b.text.trim()) ev('text', { text: b.text.trim() });
      const uses = resp.content.filter(b => b.type === 'tool_use');
      if (resp.stop_reason !== 'tool_use' || !uses.length) break;
      const results = []; let anyFail = false;
      for (const u of uses) {
        ev('tool', { name: u.name, input: u.input });
        let out;
        try { out = await actions[u.name](u.input || {}); } catch (e) { out = { error: e.message }; }
        const isErr = out && out.error; if (isErr) anyFail = true;
        ev('result', { name: u.name, ok: !isErr, summary: isErr ? out.error : (out && out.summary) || 'done', ...(out && out.imageDataUrl ? { image: out.imageDataUrl } : {}) });
        const block = [];
        if (out && out.imageBase64) block.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: out.imageBase64 } });
        const { imageBase64, imageDataUrl, ...rest } = out || {};
        block.push({ type: 'text', text: JSON.stringify(rest).slice(0, 6000) });
        results.push({ type: 'tool_result', tool_use_id: u.id, content: block, ...(isErr ? { is_error: true } : {}) });
      }
      history.push({ role: 'user', content: useClaude ? results : [{ type: 'text', text: 'tool results ' + JSON.stringify(results.map(r => r.content[r.content.length - 1].text)).slice(0, 2000) }] });
      if (!useClaude) { ev('text', { text: anyFail ? "That didn't work (see the line above)." : 'Done.' }); break; }
      if (turn === 13) ev('text', { text: '(stopped after 14 steps)' });
    }
  } catch (e) { ev('error', { message: e.name === 'AbortError' ? 'Stopped.' : e.message }); }
  finally { trimHistory(); job.done = true; ev('done', {}); }
}

module.exports = { run, getConfig, setConfig, publicConfig, TOOLS, SYSTEM, history };
